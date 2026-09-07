import { analyzeRideRecord } from "../../../src/ai/ride-analysis-service.ts";
import { getRideRecord } from "../../../src/imports/demo-ride-store.ts";
import { AuthConfigurationError, getRequestSession, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { isDemoRideId } from "../../../src/ui/ride-view-model.ts";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;

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

  const isFixture = isDemoRideId(rideId);
  let session = getRequestSession(request);
  if (!session) {
    try { session = resolveOrCreateRequestSession(request); } catch (error) {
      if (!(error instanceof AuthConfigurationError)) throw error;
    }
  }
  const record = isFixture
    ? getRideRecord(rideId)
    : session ? await getApplicationRepository().getRide(session.userId, rideId) : null;
  if (!record) return noStoreJson({ error: "UNKNOWN_RIDE" }, 400, session ? sessionCookieHeader(session) : {});
  if (session) await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_requested", rideId }));
  const result = await analyzeRideRecord(record);
  if (session) {
    if (!isFixture) await getApplicationRepository().saveAnalysisRun(session.userId, rideId, result);
    if (result.source === "b2" || result.source === "safety_stop") {
      await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_completed", rideId, attributes: { source: result.source } }));
    } else {
      await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "ai_degraded", rideId, attributes: { code: result.fallbackCode } }));
    }
  }
  return noStoreJson({ rideId, ...result }, 200, session ? sessionCookieHeader(session) : {});
}
