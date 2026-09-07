import assert from "node:assert/strict";
import test from "node:test";

import { GET, POST } from "../app/api/demo-events/route.ts";
import { DELETE as deleteAccount } from "../app/api/account/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { createDemoEvent, parseDemoEventInput } from "../src/observability/demo-events.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const cookie = (setCookie: string | null | undefined) => setCookie?.split(";", 1)[0] ?? "";

function request(cookieHeader: string, body?: unknown): Request {
  return new Request("http://localhost/api/demo-events", {
    method: body ? "POST" : "GET",
    headers: { ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("demo event contract rejects owner IDs, arbitrary text, and sensitive fields", () => {
  assert.equal(parseDemoEventInput({ type: "feedback_submitted", rideId: "ride-a", feedback: "helpful", ownerId: "user-a" }), null);
  assert.equal(parseDemoEventInput({ type: "feedback_submitted", rideId: "ride-a", feedback: "helpful", note: "health text" }), null);
  assert.equal(parseDemoEventInput({ type: "b0_visible", rideId: "ride-a", code: "AI_DISABLED", latitude: 31.23 }), null);
  assert.deepEqual(parseDemoEventInput({ type: "share_previewed", rideId: "ride-a", template: "dark" }), { type: "share_previewed", rideId: "ride-a", template: "dark" });
});

test("demo events are scoped to the signed session and private rides require ownership", async () => {
  const first = resolveOrCreateRequestSession(new Request("http://localhost"));
  const second = resolveOrCreateRequestSession(new Request("http://localhost"));
  const ride = getRideFixture("l1-built-in-sample");
  const rideId = `event-private-${crypto.randomUUID()}`;
  await getApplicationRepository().saveRide(first.userId, { activity: { ...ride.activity, rideId }, series: { ...ride.series, rideId } });

  const rejected = await POST(request(cookie(second.setCookie), { type: "evidence_viewed", rideId }));
  assert.equal(rejected.status, 404);
  const recorded = await POST(request(cookie(first.setCookie), { type: "feedback_submitted", rideId, feedback: "helpful" }));
  assert.equal(recorded.status, 201);

  const firstEvents = await GET(request(cookie(first.setCookie)));
  const firstBody = await firstEvents.json() as { events: Array<{ rideRef?: string; attributes?: Record<string, string> }> };
  const event = firstBody.events.at(-1);
  assert.ok(event?.rideRef);
  assert.notEqual(event?.rideRef, rideId);
  assert.deepEqual(event?.attributes, { feedback: "helpful" });
  const safe = JSON.stringify(firstBody);
  assert.doesNotMatch(safe, new RegExp(rideId));
  assert.doesNotMatch(safe, new RegExp(first.userId));
  assert.doesNotMatch(safe, /filename|latitude|longitude|prompt|token|secret/i);

  const secondEvents = await GET(request(cookie(second.setCookie)));
  assert.deepEqual((await secondEvents.json() as { events: unknown[] }).events, []);
});

test("account deletion removes the current session's event history", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "import_started" }));
  const response = await deleteAccount(new Request("http://localhost/api/account", { method: "DELETE", headers: { Cookie: cookie(session.setCookie) } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await getApplicationRepository().listDemoEvents(session.userId), []);
});
