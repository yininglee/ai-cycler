import { buildRideAnalysisContext } from "../../../src/domain/ride-analysis-context.ts";
import { buildAnalysisEligibility } from "../../../src/domain/analysis-eligibility.ts";
import { getRideRecord } from "../../../src/imports/demo-ride-store.ts";
import { AuthConfigurationError, getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { getRideRepository } from "../../../src/persistence/demo-ride-repository.ts";
import { buildRidePageViewModelFromRecord, isDemoRideId } from "../../../src/ui/ride-view-model.ts";
import { runRideInterpretationV2, getRideInterpretationV2Versions } from "../../../src/ai/ride-interpretation-service-v2.ts";
import { canCacheRideInterpretation, readCachedRideInterpretation, rideInterpretationFingerprint } from "../../../src/ai/ride-interpretation-cache.ts";
import type { RideRecord } from "../../../src/domain/ride-schema.ts";
import type { UserProfile } from "../../../src/domain/user-profile.ts";
import { readRideModelProviderConfigV2, readRideSemanticModelIdV2, RideModelClientV2, DEFAULT_RIDE_MODEL_V2_MODEL_ID } from "../../../src/ai/ride-model-provider-v2.ts";
import { bindRideV2DimensionChartsV2 } from "../../../src/ai/ride-output-chart-binding-v2.ts";

export const runtime = "nodejs";

const RIDE_INTERPRETATION_ROUTE_VERSION = "ride-interpretation-route-v2";
const MAX_REQUEST_BYTES = 1_024;

function noStoreJson(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function cacheFingerprint(record: RideRecord, profile: UserProfile | null) {
  return rideInterpretationFingerprint(record, profile, {
    engine: "v2",
    versions: getRideInterpretationV2Versions(),
    model: process.env.RIDE_MODEL_V2_MODEL_ID?.trim() || DEFAULT_RIDE_MODEL_V2_MODEL_ID,
    semanticModel: readRideSemanticModelIdV2(process.env),
  });
}

/** Read existing verified output only. Never invokes a provider or revives a deleted record. */
export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const rideId = query.get("rideId");
    if (!rideId || rideId.length > 128) return noStoreJson({ error: "UNKNOWN_RIDE" }, 400);
    const session = getRequestSession(request);
    const record = isDemoRideId(rideId) ? getRideRecord(rideId) : (await (await getRideRepository()).listRides(session?.userId ?? "")).find(entry => entry.record.activity.rideId === rideId)?.record;
    if (!record) return noStoreJson({ error: "UNKNOWN_RIDE" }, 400);
    if (!session || isDemoRideId(rideId)) return noStoreJson({ rideId, cached: false });
    const repository = getApplicationRepository();
    const profile = await repository.getProfile(session.userId);
    const cache = readCachedRideInterpretation((await repository.getAnalysisRun(session.userId, rideId))?.result, cacheFingerprint(record, profile), rideId);
    return noStoreJson(cache ? { rideId, cached: true, generatedAt: cache.generatedAt, response: cache.response } : { rideId, cached: false });
  } catch { return noStoreJson({ error: "ANALYSIS_CACHE_UNAVAILABLE" }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return noStoreJson({ error: "REQUEST_TOO_LARGE" }, 413);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
      return noStoreJson({ error: "REQUEST_TOO_LARGE" }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return noStoreJson({ error: "INVALID_JSON" }, 400);
  }

  const rideId = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).rideId
    : undefined;
  if (typeof rideId !== "string") {
    return noStoreJson({ error: "UNKNOWN_RIDE" }, 400);
  }
  const isFixture = isDemoRideId(rideId);
  let session = getRequestSession(request);
  if (!session) {
    try { session = resolveOrCreateRequestSession(request); } catch (error) {
      if (!(error instanceof AuthConfigurationError)) throw error;
    }
  }
  // DEMO-IMPORTED-RIDES：演示记录对所有人可读，因此走带演示视图的仓储而不是原仓储。
  const record = isFixture
    ? getRideRecord(rideId)
    : (await (await getRideRepository()).listRides(session?.userId ?? "")).find(entry => entry.record.activity.rideId === rideId)?.record;
  if (!record) return noStoreJson({ error: "UNKNOWN_RIDE" }, 400, session ? sessionCookieHeader(session) : {});
  const cookieHeaders = session ? sessionCookieHeader(session) : {};
  const profile = session ? await getApplicationRepository().getProfile(session.userId) : null;
  const fingerprint = cacheFingerprint(record, profile);
  if (session) await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_requested", rideId }));

  const finalize = async (payload: Record<string, unknown>, run: Record<string, unknown>): Promise<Response> => {
    if (session) {
      if (!isFixture) {
        const repository = getApplicationRepository();
        const previousCache = readCachedRideInterpretation((await repository.getAnalysisRun(session.userId, rideId))?.result, fingerprint, rideId);
        const successfulCache = canCacheRideInterpretation(payload) ? { fingerprint, generatedAt: new Date().toISOString(), response: payload } : previousCache;
        await repository.saveAnalysisRun(session.userId, rideId, { ...run, ...(successfulCache ? { successfulCache } : {}) });
      }
      if (payload.source === "v2" || payload.source === "safety_stop") {
        await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_completed", rideId, attributes: { source: String(payload.source) } }));
      } else {
        await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_degraded", rideId, attributes: { code: String(payload.fallbackCode ?? "UNKNOWN") } }));
      }
    }
    return noStoreJson(payload, 200, cookieHeaders);
  };

  const context = buildRideAnalysisContext(record);
  const eligibility = buildAnalysisEligibility(context);

  const versions = { route: RIDE_INTERPRETATION_ROUTE_VERSION, ...getRideInterpretationV2Versions() };

  if (eligibility.fallback === "safety_stop") {
    return finalize(
      { rideId, source: "safety_stop", output: null, fallbackCode: "SAFETY_STOP", versions },
      { source: "safety_stop", fallbackCode: "SAFETY_STOP", versions },
    );
  }

  if (process.env.AI_ANALYSIS_ENABLED !== "true") {
    return finalize(
      { rideId, source: "b0", output: null, fallbackCode: "AI_DISABLED", engine: "v2", versions },
      { source: "b0", engine: "v2", fallbackCode: "AI_DISABLED", versions },
    );
  }
  const providerConfig = readRideModelProviderConfigV2(process.env);
  const modelClient = providerConfig ? new RideModelClientV2(providerConfig) : undefined;
  const semanticModelId = readRideSemanticModelIdV2(process.env);
  // DEMO-VALIDATION-BYPASS=on (user decision 2026-10-14): demo-only. The
  // validator still runs and records issues, but nothing is enforced — no
  // repair, no fallback. Default off; eval scripts never set it.
  const demoValidationBypass = process.env.DEMO_VALIDATION_BYPASS?.trim().toLowerCase() === "on";
  const result = await runRideInterpretationV2({
    record,
    profile,
    analysisRunId: `ride-v2-${crypto.randomUUID()}`,
    userScope: session?.userId ?? "anonymous",
    requestId: crypto.randomUUID(),
    modelCaller: modelClient ? (invocation) => modelClient.run(invocation) : undefined,
    semanticModelId,
    ...(demoValidationBypass ? { demoValidationBypass: true } : {}),
  });
  const resultVersions = { route: RIDE_INTERPRETATION_ROUTE_VERSION, ...result.versions };
  if (result.source === "b0") {
    return finalize(
      {
        rideId,
        source: "b0",
        output: null,
        fallbackCode: result.fallbackCode,
        ...(result.failureCodes ? { failureCodes: result.failureCodes } : {}),
        engine: "v2",
        versions: resultVersions,
      },
      { source: "b0", engine: "v2", fallbackCode: result.fallbackCode, ...(result.failureCodes ? { failureCodes: result.failureCodes } : {}), versions: resultVersions },
    );
  }
  const pageView = buildRidePageViewModelFromRecord(record);
  const charts = bindRideV2DimensionChartsV2(
    pageView.visuals,
    result.presentation.dimensions.map((dimension) => dimension.dimensionId),
  );
  return finalize(
    {
      rideId,
      source: "v2",
      output: null,
      v2Candidate: {
        presentation: result.presentation,
        charts,
        stage: result.stage,
        modelRepairCalls: result.modelRepairCalls,
        ...(result.demoValidationBypass ? {
          demoValidationBypass: true,
          bypassedIssueCount: result.bypassedIssueCount,
          bypassedIssueCodes: result.bypassedIssueCodes,
        } : {}),
        versions: resultVersions,
      },
      versions: resultVersions,
    },
    { source: "v2", stage: result.stage, modelRepairCalls: result.modelRepairCalls, versions: resultVersions, ...(result.callRecords.length ? { callRecords: result.callRecords } : {}) },
  );
}
