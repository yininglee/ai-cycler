import { AuthConfigurationError, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { createDemoEvent, parseDemoEventInput } from "../../../src/observability/demo-events.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { getRideRepository } from "../../../src/persistence/demo-ride-repository.ts";
import { isDemoRideId } from "../../../src/ui/ride-view-model.ts";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;

function noStoreJson(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function sessionFor(request: Request) {
  try {
    return resolveOrCreateRequestSession(request);
  } catch (error) {
    if (error instanceof AuthConfigurationError) return null;
    throw error;
  }
}

export async function GET(request: Request): Promise<Response> {
  const session = sessionFor(request);
  if (!session) return noStoreJson({ error: "AUTH_CONFIGURATION_REQUIRED" }, 503);
  const events = await getApplicationRepository().listDemoEvents(session.userId);
  return noStoreJson({ dictionaryVersion: "demo-events-v1", events }, 200, sessionCookieHeader(session));
}

export async function POST(request: Request): Promise<Response> {
  const session = sessionFor(request);
  if (!session) return noStoreJson({ error: "AUTH_CONFIGURATION_REQUIRED" }, 503);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return noStoreJson({ error: "REQUEST_TOO_LARGE" }, 413, sessionCookieHeader(session));

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) return noStoreJson({ error: "REQUEST_TOO_LARGE" }, 413, sessionCookieHeader(session));
    body = JSON.parse(text);
  } catch {
    return noStoreJson({ error: "INVALID_EVENT" }, 400, sessionCookieHeader(session));
  }
  const input = parseDemoEventInput(body);
  if (!input) return noStoreJson({ error: "INVALID_EVENT" }, 400, sessionCookieHeader(session));
  // DEMO-IMPORTED-RIDES：演示记录不属于任何会话，用带演示视图的仓储做存在性校验。
  if (!isDemoRideId(input.rideId) && !await (await getRideRepository()).getRide(session.userId, input.rideId)) {
    return noStoreJson({ error: "UNKNOWN_RIDE" }, 404, sessionCookieHeader(session));
  }
  const event = createDemoEvent(input);
  await getApplicationRepository().saveDemoEvent(session.userId, event);
  return noStoreJson({ event }, 201, sessionCookieHeader(session));
}
