import { analyzeRideRecord } from "../../../src/ai/ride-analysis-service.ts";
import { getRideFixture } from "../../../src/fixtures/rides.ts";
import { isDemoRideId } from "../../../src/ui/ride-view-model.ts";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;

function noStoreJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
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
  if (typeof rideId !== "string" || !isDemoRideId(rideId)) {
    return noStoreJson({ error: "UNKNOWN_DEMO_RIDE" }, 400);
  }

  const fixture = getRideFixture(rideId);
  const result = await analyzeRideRecord({ activity: fixture.activity, series: fixture.series });
  return noStoreJson({ rideId, ...result });
}
