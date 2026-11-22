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

async function withAnalysisEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const settings = { AI_ANALYSIS_ENABLED: "true", ...vars };
  const previous = Object.keys(settings).map(key => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(settings)) {
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

test("ride-analysis defaults to V2 without an engine selector or provider token", async () => {
  await withAnalysisEnv({ RIDE_INTERPRETATION_ENGINE: undefined, SILICONFLOW_API_TOKEN: undefined }, async () => {
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      body: JSON.stringify({ rideId: "l3-power-preview" }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "AI_NOT_CONFIGURED");
    assert.equal(body.engine, "v2");
    assert.match(body.versions.service, /^ride-interpretation-service-v2/);
  });
});

test("legacy engine settings still use SiliconFlow and a failed call never falls back to Coze", async t => {
  const siliconflowUrl = "https://siliconflow.example.test/v1/chat/completions";
  await withAnalysisEnv({
    RIDE_INTERPRETATION_ENGINE: "v1",
    COZE_API_URL: "https://coze.example.test/workflow/run",
    COZE_API_TOKEN: "test-only",
    COZE_INTERPRETATION_WORKFLOW_ID: "fixture",
    COZE_INTERPRETATION_WORKFLOW_VERSION: "v0.0.11",
    COZE_INTERPRETATION_WORKFLOW_NAME: "ride_analysis_v3",
    SILICONFLOW_API_URL: siliconflowUrl,
    SILICONFLOW_API_TOKEN: "test-only",
  }, async () => {
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(null, { status: 401 });
    });
    const response = await POST(new Request("http://localhost/api/ride-analysis", {
      method: "POST",
      body: JSON.stringify({ rideId: "l3-power-preview", engine: "v1" }),
    }));
    const body = await response.json();

    assert.deepEqual(urls, [siliconflowUrl]);
    assert.equal(body.source, "b0");
    assert.equal(body.fallbackCode, "PROVIDER_AUTH_ERROR");
    assert.equal(body.engine, "v2");
  });
});
