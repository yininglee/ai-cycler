import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { updatePlatform } from "../src/ux/platform.ts";
import { GET as summaries } from "../app/api/rides/summary/route.ts";
import { GET, POST } from "../app/api/platform/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { appendImportedRides, createChatSession, refreshChatSnapshot } from "../src/chat/chat-session.ts";
import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";

test("platform sync is scoped, retryable, idempotent and incremental", async () => {
  const repo = getApplicationRepository();
  await updatePlatform(repo, "sync-owner", "connect", 7);
  const partial = await updatePlatform(repo, "sync-owner", "sync", 7, "partial");
  assert.equal(partial.result?.added, 1); assert.equal(partial.result?.failed, 1);
  const retry = await updatePlatform(repo, "sync-owner", "retry");
  assert.equal(retry.result?.added, 1); assert.equal(retry.platform?.failedIds.length, 0);
  const concurrent = await Promise.all([updatePlatform(repo, "sync-owner", "sync"), updatePlatform(repo, "sync-owner", "sync")]);
  assert.ok(concurrent.every(r => r.result?.added === 0 && r.result?.duplicate === 2));
  await updatePlatform(repo, "sync-owner", "add-sample");
  assert.equal((await updatePlatform(repo, "sync-owner", "sync")).result?.added, 1);
  const record = (await repo.listRides("sync-owner"))[0].record;
  assert.equal(record.activity.rideId, record.series.rideId);
  assert.equal(record.activity.source.parserVersion, "platform-demo-v1");
  assert.equal((await repo.listRides("other-owner")).length, 0);
  await updatePlatform(repo, "sync-owner", "expire");
  await assert.rejects(updatePlatform(repo, "sync-owner", "sync"), /失效/);
  await updatePlatform(repo, "sync-owner", "connect", 7);
  await assert.rejects(updatePlatform(repo, "sync-owner", "sync", 7, "network"), /中断/);
  assert.equal((await updatePlatform(repo, "sync-owner", "sync")).result?.added, 0);
  await updatePlatform(repo, "sync-owner", "disconnect");
  assert.equal((await repo.listRides("sync-owner")).length, 3);
  await assert.rejects(updatePlatform(repo, "sync-owner", "sync"), /授权/);
});

test("history range, platform API persistence and visible record authorization", async () => {
  const initial = await GET(new Request("http://localhost/api/platform"));
  const cookie = initial.headers.get("set-cookie")!.split(";")[0];
  const request = (body: unknown) => new Request("http://localhost/api/platform", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ action: "connect", range: 9 }))).status, 422);
  assert.equal((await POST(request({ action: "connect", provider: "__proto__" }))).status, 422);
  assert.equal((await GET(new Request("http://localhost/api/platform?provider=unknown"))).status, 422);
  await POST(request({ action: "connect", range: 90 }));
  const result = await (await POST(request({ action: "sync" }))).json();
  assert.equal(result.result.added, 4);
  const id = result.result.rideIds[0];
  const visible = await (await summaries(new Request(`http://localhost/api/rides/summary?id=${id}`, { headers: { cookie } }))).json();
  assert.equal(visible.rides[0].id, id);
  const other = await (await summaries(new Request(`http://localhost/api/rides/summary?id=${id}`))).json();
  assert.equal(other.rides.length, 0);
  const owner = resolveOrCreateRequestSession(new Request("http://localhost", { headers: { cookie } })).userId;
  const repo = getApplicationRepository();
  const profile = (await repo.getProfile(owner))!;
  profile.ux = { ...profile.ux, mode: "blank", blankSince: "2999-01-01T00:00:00Z" };
  await repo.saveProfile(owner, profile);
  const hidden = await (await summaries(new Request(`http://localhost/api/rides/summary?id=${id}`, { headers: { cookie } }))).json();
  assert.equal(hidden.rides.length, 0);
});

test("new ride data updates current conversation without replacing messages or ids", () => {
  const snapshot = buildChatHomeSnapshot([]);
  const original = createChatSession(snapshot);
  const withRides = appendImportedRides(original, ["platform-explicit-id"], "模拟同步完成");
  const updated = refreshChatSnapshot(withRides, { ...snapshot, totalRideCount: 1 });
  assert.equal(updated.activeConversationId, original.activeConversationId);
  assert.equal(updated.conversations.length, 1);
  assert.deepEqual(updated.conversations[0].messages.at(-1)?.rideIds, ["platform-explicit-id"]);
});

test("named platforms keep independent connections, records and disconnect states", async () => {
  const repo = getApplicationRepository();
  await updatePlatform(repo, "multi-platform-owner", "connect", 7, undefined, "garmin");
  await updatePlatform(repo, "multi-platform-owner", "connect", 30, undefined, "xingzhe");
  const garmin = await updatePlatform(repo, "multi-platform-owner", "sync", 7, undefined, "garmin");
  const xingzhe = await updatePlatform(repo, "multi-platform-owner", "sync", 30, undefined, "xingzhe");
  assert.equal(garmin.result?.added, 2);
  assert.equal(xingzhe.result?.added, 3);
  assert.equal(new Set([...garmin.result!.rideIds, ...xingzhe.result!.rideIds]).size, 5);
  assert.equal((await repo.getRide("multi-platform-owner", xingzhe.result!.rideIds[0]))?.activity.source.platformId, "xingzhe");
  await updatePlatform(repo, "multi-platform-owner", "disconnect", 7, undefined, "garmin");
  assert.equal((await repo.getProfile("multi-platform-owner"))?.ux?.platforms?.xingzhe?.status, "connected");
  await assert.rejects(updatePlatform(repo, "multi-platform-owner", "sync", 7, undefined, "garmin"), /授权/);
});

test("legacy generic connection migrates to Garmin without leaking into other platforms", async () => {
  const repo = getApplicationRepository();
  await repo.saveProfile("legacy-owner", { schemaVersion: "0.1", updatedAt: new Date().toISOString(), ux: { platform: { status: "connected", connectedAt: "2026-11-01T00:00:00Z", range: 7, failedIds: [] } } });
  await updatePlatform(repo, "legacy-owner", "connect", 30, undefined, "onelap");
  const profile = await repo.getProfile("legacy-owner");
  assert.equal(profile?.ux?.platforms?.garmin?.range, 7);
  assert.equal(profile?.ux?.platforms?.onelap?.range, 30);
});

test("platform result returns to its originating conversation", () => {
  const first = createChatSession(buildChatHomeSnapshot([]));
  const second = { ...first, conversations: [...first.conversations, { id: "another-chat", messages: [], summarySlots: [] }], activeConversationId: "another-chat" };
  const updated = appendImportedRides(second, ["selected-ride"], "佳明模拟同步完成", first.activeConversationId);
  assert.equal(updated.activeConversationId, "another-chat");
  assert.equal(updated.conversations[0].messages.at(-1)?.text, "佳明模拟同步完成");
  assert.equal(updated.conversations[1].messages.length, 0);
});
