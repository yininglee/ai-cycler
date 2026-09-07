import assert from "node:assert/strict";
import test from "node:test";

import { POST as callChatTool } from "../app/api/chat/tools/route.ts";
import { POST as importRide } from "../app/api/rides/import/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";

const GPX = `<gpx version="1.1"><trk><trkseg><trkpt lat="31.23" lon="121.47"><ele>10</ele><time>2026-08-17T06:00:00Z</time></trkpt><trkpt lat="31.23" lon="121.49"><ele>30</ele><time>2026-08-17T06:10:00Z</time></trkpt></trkseg></trk></gpx>`;
const cookie = (setCookie: string | null) => setCookie?.split(";", 1)[0] ?? "";

function toolRequest(body: unknown, sessionCookie?: string) {
  return new Request("http://localhost/api/chat/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
    body: JSON.stringify(body),
  });
}

test("chat tool route binds the current session and does not create anonymous tool sessions", async () => {
  const anonymous = await callChatTool(toolRequest({ tool: "get_capabilities", input: { rideId: "unknown", caps: ["distance"] } }));
  assert.equal(anonymous.status, 404);
  assert.deepEqual(await anonymous.json(), { error: "NOT_FOUND" });
  assert.equal(anonymous.headers.get("set-cookie"), null);

  const form = new FormData();
  form.set("file", new Blob([GPX], { type: "application/gpx+xml" }), "chat-tool.gpx");
  const imported = await importRide(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));
  const ownerCookie = cookie(imported.headers.get("set-cookie"));
  const rideId = (await imported.json() as { rideId: string }).rideId;

  const response = await callChatTool(toolRequest({ tool: "get_capabilities", input: { rideId, caps: ["route", "distance", "power"] } }, ownerCookie));
  assert.equal(response.status, 200);
  const result = await response.json() as { rideId: string; capabilities: Array<{ key: string; available: boolean }> };
  assert.equal(result.rideId, rideId);
  assert.deepEqual(result.capabilities.map((capability) => capability.key), ["route", "distance", "power"]);
  assert.deepEqual(result.capabilities.map((capability) => capability.available), [true, true, false]);
});

test("chat tool route makes missing and cross-user rides indistinguishable", async () => {
  const form = new FormData();
  form.set("file", new Blob([GPX], { type: "application/gpx+xml" }), "private-chat-tool.gpx");
  const imported = await importRide(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));
  const rideId = (await imported.json() as { rideId: string }).rideId;
  const otherSession = resolveOrCreateRequestSession(new Request("http://localhost"));
  const otherCookie = cookie(otherSession.setCookie ?? null);

  const crossOwner = await callChatTool(toolRequest({ tool: "get_ride_context", input: { rideId, dims: ["summary"] } }, otherCookie));
  const missing = await callChatTool(toolRequest({ tool: "get_ride_context", input: { rideId: "missing-ride", dims: ["summary"] } }, otherCookie));
  assert.equal(crossOwner.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await crossOwner.json(), { error: "NOT_FOUND" });
  assert.deepEqual(await missing.json(), { error: "NOT_FOUND" });
});

test("chat tool route rejects extra identity and unknown dimension fields", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await callChatTool(toolRequest({
    tool: "get_ride_context",
    input: { rideId: "some-ride", dims: ["summary", "route"], userId: "other-user" },
  }, cookie(session.setCookie ?? null)));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_INPUT" });

  const oversized = await callChatTool(toolRequest({
    tool: "get_ride_context",
    input: { rideId: "x".repeat(5_000), dims: ["summary"] },
  }, cookie(session.setCookie ?? null)));
  assert.equal(oversized.status, 400);
  assert.deepEqual(await oversized.json(), { error: "INVALID_INPUT" });
});
