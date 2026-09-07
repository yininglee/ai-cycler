import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/ride-analysis/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { parseRideRecord } from "../src/parsers/index.ts";

const TIMED_GPX = `<gpx version="1.1"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><ele>10</ele><time>2026-08-17T06:00:00Z</time></trkpt>
  <trkpt lat="31.2304" lon="121.4937"><ele>30</ele><time>2026-08-17T06:10:00Z</time></trkpt>
  <trkpt lat="31.2304" lon="121.5137"><ele>25</ele><time>2026-08-17T06:20:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test("ride-analysis route accepts known local rides and keeps B0 available", async () => {
  const previous = process.env.AI_ANALYSIS_ENABLED;
  process.env.AI_ANALYSIS_ENABLED = "false";
  try {
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: "l1-built-in-sample" }),
    }));
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_DISABLED");
    assert.equal(body.rideId, "l1-built-in-sample");
  } finally {
    if (previous === undefined) delete process.env.AI_ANALYSIS_ENABLED;
    else process.env.AI_ANALYSIS_ENABLED = previous;
  }
});

test("ride-analysis route rejects unknown ride identifiers", async () => {
  const response = await POST(new Request("http://localhost/api/ride-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rideId: "other-user-private" }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "UNKNOWN_RIDE" });
});

test("ride-analysis route can analyze a record imported into the local demo store", async () => {
  const previous = process.env.AI_ANALYSIS_ENABLED;
  process.env.AI_ANALYSIS_ENABLED = "false";
  try {
    const record = await parseRideRecord({
      rideId: "upload-analysis-route",
      fileName: "private-ride.gpx",
      content: TIMED_GPX,
    });
    const sessionRequest = new Request("http://localhost");
    const session = resolveOrCreateRequestSession(sessionRequest);
    await getApplicationRepository().saveRide(session.userId, record);

    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.setCookie!.split(";", 1)[0] },
      body: JSON.stringify({ rideId: "upload-analysis-route" }),
    }));
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_DISABLED");
    assert.equal(body.rideId, "upload-analysis-route");
  } finally {
    if (previous === undefined) delete process.env.AI_ANALYSIS_ENABLED;
    else process.env.AI_ANALYSIS_ENABLED = previous;
  }
});
