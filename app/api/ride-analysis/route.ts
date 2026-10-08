import { buildRideAnalysisContext } from "../../../src/domain/ride-analysis-context.ts";
import { buildAnalysisEligibility } from "../../../src/domain/analysis-eligibility.ts";
import { buildRideInterpretationPlan } from "../../../src/ai/ride-interpretation-plan.ts";
import { projectRideInterpretationInputV04Candidate } from "../../../src/ai/ride-interpretation-input-v04-candidate.ts";
import { runRideInterpretationV04Candidate } from "../../../src/ai/ride-interpretation-service-v04-candidate.ts";
import { assembleRideInterpretationPresentationV04Candidate } from "../../../src/ai/ride-interpretation-presentation-v04-candidate.ts";
import { buildRideInterpretationPresentationViewModelV04Candidate } from "../../../src/ai/ride-interpretation-presentation-view-model-v04-candidate.ts";
import {
  readRideInterpretationCozeConfigV04Candidate,
  RideInterpretationCozeClientV04Candidate,
} from "../../../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { getRideRecord } from "../../../src/imports/demo-ride-store.ts";
import { AuthConfigurationError, getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { getRideRepository } from "../../../src/persistence/demo-ride-repository.ts";
import { isDemoRideId } from "../../../src/ui/ride-view-model.ts";
import { buildRidePageViewModelFromRecord } from "../../../src/ui/ride-view-model.ts";
import { runRideInterpretationV2 } from "../../../src/ai/ride-interpretation-service-v2.ts";
import { readRideModelProviderConfigV2, readRideSemanticModelIdV2, RideModelClientV2 } from "../../../src/ai/ride-model-provider-v2.ts";
import { bindRideV2DimensionChartsV2 } from "../../../src/ai/ride-output-chart-binding-v2.ts";

export const runtime = "nodejs";

/**
 * Production ride interpretation entry migrated to the v0.4 candidate chain
 * (ride_analysis_v3 v0.0.11 / Prompt v0.4.14, including the FIX-018
 * deterministic action-language fallback). The response keeps the legacy
 * `/api/ride-analysis` contract so the existing client component renders
 * without structural changes; rollback = restore the previous route revision.
 *
 * M2 session/ownership layer: built-in fixture rides come from the demo
 * store; every other ride must belong to the current server session, and
 * analysis outcomes are persisted as AnalysisRun + demo events for the
 * owning session only.
 */
export const RIDE_INTERPRETATION_ROUTE_VERSION = "ride-interpretation-route-v0.4-candidate" as const;
export const RIDE_INTERPRETATION_ROUTE_VERSION_MATRIX = {
  workflowName: "ride_analysis_v3",
  workflowVersion: "v0.0.11",
  promptVersion: "v0.4.14",
} as const;

const MAX_REQUEST_BYTES = 1_024;

// S6-03 engine switch: default stays on the V1 Coze candidate chain. Set
// RIDE_INTERPRETATION_ENGINE=V2 (env) for a global cut-over, or send
// {"engine":"v2"} in the request body to force V2 for a single request
// (the drawer's ?ai=v2 page parameter). One-click rollback = remove the env
// var (or send engine:"v1"); the V1 code path below is untouched.
function resolveInterpretationEngine(requestedEngine: unknown, environment: NodeJS.ProcessEnv): "v1" | "v2" {
  if (requestedEngine === "v2" || requestedEngine === "v1") return requestedEngine;
  return environment.RIDE_INTERPRETATION_ENGINE?.trim().toLowerCase() === "v2" ? "v2" : "v1";
}

function noStoreJson(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
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
  const requestedEngine = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).engine
    : undefined;
  const engine = resolveInterpretationEngine(requestedEngine, process.env);

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
    : await (await getRideRepository()).getRide(session?.userId ?? "", rideId);
  if (!record) return noStoreJson({ error: "UNKNOWN_RIDE" }, 400, session ? sessionCookieHeader(session) : {});
  const cookieHeaders = session ? sessionCookieHeader(session) : {};
  if (session) await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_requested", rideId }));

  const finalize = async (payload: Record<string, unknown>, run: Record<string, unknown>): Promise<Response> => {
    if (session) {
      if (!isFixture) await getApplicationRepository().saveAnalysisRun(session.userId, rideId, run);
      if (payload.source === "b2" || payload.source === "v2" || payload.source === "safety_stop") {
        await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_completed", rideId, attributes: { source: String(payload.source) } }));
      } else {
        await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_degraded", rideId, attributes: { code: String(payload.fallbackCode ?? "UNKNOWN") } }));
      }
    }
    return noStoreJson(payload, 200, cookieHeaders);
  };

  // L6 plan runs in expanded mode (all eligible dimensions) on every call —
  // the drawer decides how many to *display* (top 3 by default, all when
  // expanded). Running expanded once keeps a single Provider call per open /
  // refresh, regardless of which view the user toggles. The legacy "mode"
  // body field is accepted but ignored for backward compatibility.
  const context = buildRideAnalysisContext(record);
  const eligibility = buildAnalysisEligibility(context);

  const versions = { route: RIDE_INTERPRETATION_ROUTE_VERSION, ...RIDE_INTERPRETATION_ROUTE_VERSION_MATRIX };

  if (eligibility.fallback === "safety_stop") {
    return finalize(
      { rideId, source: "safety_stop", output: null, fallbackCode: "SAFETY_STOP", versions },
      { source: "safety_stop", fallbackCode: "SAFETY_STOP", versions },
    );
  }

  // S6-03 V2 branch: full V2 chain against real data sources. Any internal
  // failure degrades through the b0 contract (never a silent V1 fallback, so
  // a V2 problem is always traceable and no double model calls happen).
  if (engine === "v2") {
    if (process.env.AI_ANALYSIS_ENABLED !== "true") {
      return finalize(
        { rideId, source: "b0", output: null, fallbackCode: "AI_DISABLED", engine: "v2", versions },
        { source: "b0", engine: "v2", fallbackCode: "AI_DISABLED", versions },
      );
    }
    const profile = session ? await getApplicationRepository().getProfile(session.userId) : null;
    const providerConfig = readRideModelProviderConfigV2(process.env);
    const modelClient = providerConfig ? new RideModelClientV2(providerConfig) : undefined;
    const semanticModelId = readRideSemanticModelIdV2(process.env);
    const result = await runRideInterpretationV2({
      record,
      profile,
      analysisRunId: `ride-v2-${crypto.randomUUID()}`,
      userScope: session?.userId ?? "anonymous",
      requestId: crypto.randomUUID(),
      modelCaller: modelClient ? (invocation) => modelClient.run(invocation) : undefined,
      semanticModelId,
    });
    if (result.source === "b0") {
      return finalize(
        {
          rideId,
          source: "b0",
          output: null,
          fallbackCode: result.fallbackCode,
          ...(result.failureCodes ? { failureCodes: result.failureCodes } : {}),
          engine: "v2",
          versions: result.versions,
        },
        { source: "b0", engine: "v2", fallbackCode: result.fallbackCode, ...(result.failureCodes ? { failureCodes: result.failureCodes } : {}), versions: result.versions },
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
          versions: result.versions,
        },
        versions: result.versions,
      },
      { source: "v2", stage: result.stage, modelRepairCalls: result.modelRepairCalls, versions: result.versions, ...(result.callRecords.length ? { callRecords: result.callRecords } : {}) },
    );
  }

  const plan = buildRideInterpretationPlan(context, eligibility, "expanded");
  const input = plan.candidate ? projectRideInterpretationInputV04Candidate(context, plan) : undefined;
  if (!input) {
    return finalize(
      { rideId, source: "b0", output: null, fallbackCode: "DATA_NOT_ELIGIBLE", versions },
      { source: "b0", fallbackCode: "DATA_NOT_ELIGIBLE", versions },
    );
  }

  if (process.env.AI_ANALYSIS_ENABLED !== "true") {
    return finalize(
      { rideId, source: "b0", output: null, fallbackCode: "AI_DISABLED", versions },
      { source: "b0", fallbackCode: "AI_DISABLED", versions },
    );
  }

  const config = readRideInterpretationCozeConfigV04Candidate(process.env);
  const provider = config ? new RideInterpretationCozeClientV04Candidate(config) : undefined;
  const result = await runRideInterpretationV04Candidate(input, provider);

  if (result.source === "b0") {
    return finalize(
      {
        rideId,
        source: "b0",
        output: null,
        fallbackCode: result.fallbackCode,
        attempts: result.attempts,
        validationIssues: result.validationIssues,
        versions,
      },
      { source: "b0", fallbackCode: result.fallbackCode, attempts: result.attempts, validationIssues: result.validationIssues, versions },
    );
  }

  const presentation = assembleRideInterpretationPresentationV04Candidate(result.output, input);
  const viewModel = buildRideInterpretationPresentationViewModelV04Candidate(record, presentation, {
    mode: "expanded",
    eligibleDimensionIds: plan.eligibleDimensionIds,
  });

  return finalize(
    {
      rideId,
      source: "b2",
      output: null,
      v04Candidate: {
        output: result.output,
        presentation,
        viewModel,
      },
      attempts: result.attempts,
      validationIssues: result.validationIssues,
      versions,
    },
    { source: "b2", output: result.output, attempts: result.attempts, validationIssues: result.validationIssues, versions },
  );
}
