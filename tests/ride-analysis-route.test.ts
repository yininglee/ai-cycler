import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/ride-analysis/route.ts";
import { saveImportedRide } from "../src/imports/demo-ride-store.ts";
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
    saveImportedRide(record);

    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

test("ride-analysis route reaches the v0.4 candidate chain and reports its version matrix", async () => {
  const previousEnabled = process.env.AI_ANALYSIS_ENABLED;
  const trackedVars = [
    "COZE_API_URL",
    "COZE_API_TOKEN",
    "COZE_INTERPRETATION_WORKFLOW_NAME",
    "COZE_INTERPRETATION_WORKFLOW_ID",
    "COZE_INTERPRETATION_WORKFLOW_VERSION",
  ];
  const previousVars = trackedVars.map((key) => [key, process.env[key]] as const);
  process.env.AI_ANALYSIS_ENABLED = "true";
  for (const key of trackedVars) delete process.env[key];
  try {
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: "l1-built-in-sample" }),
    }));
    const body = await response.json() as Record<string, unknown>;
    const versions = body.versions as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_NOT_CONFIGURED");
    assert.equal(body.output, null);
    assert.equal(versions.workflowName, "ride_analysis_v3");
    assert.equal(versions.workflowVersion, "v0.0.11");
    assert.equal(versions.promptVersion, "v0.4.14");
  } finally {
    if (previousEnabled === undefined) delete process.env.AI_ANALYSIS_ENABLED;
    else process.env.AI_ANALYSIS_ENABLED = previousEnabled;
    for (const [key, value] of previousVars) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
