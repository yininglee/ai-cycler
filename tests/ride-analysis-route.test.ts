import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/ride-analysis/route.ts";

test("ride-analysis route accepts only known demo rides and keeps B0 available", async () => {
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

test("ride-analysis route rejects arbitrary ride or user identifiers", async () => {
  const response = await POST(new Request("http://localhost/api/ride-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rideId: "other-user-private" }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "UNKNOWN_DEMO_RIDE" });
});
