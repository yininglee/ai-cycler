import "./helpers/route-test-env.ts";
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

test("ride-analysis route reaches the v0.4 candidate chain and reports its version matrix", async () => {
  const previousEnabled = process.env.AI_ANALYSIS_ENABLED;
  const trackedVars = [
    "RIDE_INTERPRETATION_ENGINE",
    "COZE_API_URL",
    "COZE_API_TOKEN",
    "COZE_INTERPRETATION_WORKFLOW_NAME",
    "COZE_INTERPRETATION_WORKFLOW_ID",
    "COZE_INTERPRETATION_WORKFLOW_VERSION",
    "COZE_INTERPRETATION_PROMPT_VERSION",
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
    assert.equal(versions.workflowName, "not_configured");
    assert.equal(versions.workflowVersion, "not_configured");
    assert.equal(versions.promptVersion, "unreported");
  } finally {
    if (previousEnabled === undefined) delete process.env.AI_ANALYSIS_ENABLED;
    else process.env.AI_ANALYSIS_ENABLED = previousEnabled;
    for (const [key, value] of previousVars) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// Shared helper for the S6-03 engine-switch tests: AI on, engine + provider
// vars tracked so every test restores the developer's environment.
async function withEngineVars(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const trackedKeys = ["AI_ANALYSIS_ENABLED", "RIDE_INTERPRETATION_ENGINE", "SILICONFLOW_API_TOKEN"];
  const previous = [...new Set([...trackedKeys, ...Object.keys(vars)])].map((key) => [key, process.env[key]] as const);
  process.env.AI_ANALYSIS_ENABLED = "true";
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("ride-analysis route cuts over to the V2 chain via RIDE_INTERPRETATION_ENGINE=V2", async () => {
  await withEngineVars({ RIDE_INTERPRETATION_ENGINE: "V2", SILICONFLOW_API_TOKEN: undefined }, async () => {
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: "l3-power-preview" }),
    }));
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    // No provider token configured -> V2 chain degrades through its own b0
    // contract (never a silent V1 fallback).
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_NOT_CONFIGURED");
    assert.equal(body.engine, "v2");
    const versions = body.versions as Record<string, unknown>;
    assert.ok(String(versions.service).startsWith("ride-interpretation-service-v2."));
  });
});

test("ride-analysis route forces the V2 chain for a single request via body engine", async () => {
  await withEngineVars({ RIDE_INTERPRETATION_ENGINE: undefined, SILICONFLOW_API_TOKEN: undefined }, async () => {
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: "l3-power-preview", engine: "v2" }),
    }));
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_NOT_CONFIGURED");
    assert.equal(body.engine, "v2");
  });
});

test("ride-analysis route body engine v1 overrides a V2 environment cut-over", async () => {
  await withEngineVars({ RIDE_INTERPRETATION_ENGINE: "V2", SILICONFLOW_API_TOKEN: undefined }, async () => {
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: "l1-built-in-sample", engine: "v1" }),
    }));
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    // V1 Coze chain (no Coze config) — its own version matrix, no engine field.
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_NOT_CONFIGURED");
    assert.equal(body.engine, undefined);
    const versions = body.versions as Record<string, unknown>;
    assert.equal(versions.workflowName, "not_configured");
  });
});

test("V1 reports the workflow version sent to the provider", async t => {
  await withEngineVars({
    RIDE_INTERPRETATION_ENGINE: "v1", COZE_API_URL: "https://coze.example.test/workflow/run",
    COZE_API_TOKEN: "test-only", COZE_INTERPRETATION_WORKFLOW_ID: "fixture",
    COZE_INTERPRETATION_WORKFLOW_NAME: "test-workflow", COZE_INTERPRETATION_WORKFLOW_VERSION: "v9.9.9",
    COZE_INTERPRETATION_PROMPT_VERSION: undefined,
  }, async () => {
    const sent: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).workflow_version);
      return Response.json({ code: 1, msg: "test rejection" });
    });
    const response = await POST(new Request("http://localhost/api/ride-analysis", { method: "POST", body: JSON.stringify({ rideId: "l1-built-in-sample" }) }));
    const { versions } = await response.json();
    assert.ok(sent.length > 0);
    assert.ok(sent.every(version => version === versions.workflowVersion));
    assert.equal(versions.workflowVersion, "v9.9.9");
    assert.equal(versions.promptVersion, "unreported");
  });
});
