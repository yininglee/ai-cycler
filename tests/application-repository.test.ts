import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileApplicationRepository } from "../src/persistence/application-repository.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { createDemoEvent } from "../src/observability/demo-events.ts";

test("file repository persists private records, strips filenames, and enforces owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-cycling-repo-"));
  try {
    const first = new FileApplicationRepository(root);
    const record = getRideFixture("l2-fit-heart-rate");
    await first.saveRide("user-a", { activity: { ...record.activity, rideId: "private-1" }, series: { ...record.series, rideId: "private-1" } });
    await first.saveProfile("user-a", createUserProfile({ age: 35 }));
    await first.saveAnalysisRun("user-a", "private-1", { source: "b0" });

    const restarted = new FileApplicationRepository(root);
    const own = await restarted.getRide("user-a", "private-1");
    assert.ok(own);
    assert.equal(own.activity.source.fileName, undefined);
    assert.equal(await restarted.getRide("user-b", "private-1"), null);
    assert.equal(await restarted.deleteRide("user-b", "private-1"), false);
    const listed = await restarted.listRides("user-a");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].record.activity.rideId, "private-1");
    listed[0].record.activity.metrics.distanceM!.value = 999;
    assert.equal((await restarted.listRides("user-a"))[0].record.activity.metrics.distanceM?.value, 42_000);
    assert.equal((await restarted.listRides("user-b")).length, 0);
    assert.deepEqual((await restarted.getAnalysisRun("user-a", "private-1"))?.result, { source: "b0" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ride listing is scoped to owner and ordered by newest save", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-cycling-repo-"));
  try {
    const repository = new FileApplicationRepository(root);
    const fixture = getRideFixture("l1-built-in-sample");
    const first = { activity: { ...fixture.activity, rideId: "first" }, series: { ...fixture.series, rideId: "first" } };
    const second = { activity: { ...fixture.activity, rideId: "second" }, series: { ...fixture.series, rideId: "second" } };
    await repository.saveRide("owner-a", first);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await repository.saveRide("owner-a", second);
    await repository.saveRide("owner-b", { ...first, activity: { ...first.activity, rideId: "other" }, series: { ...first.series, rideId: "other" } });
    assert.deepEqual((await repository.listRides("owner-a")).map((item) => item.record.activity.rideId), ["second", "first"]);
    assert.deepEqual((await repository.listRides("owner-b")).map((item) => item.record.activity.rideId), ["other"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ride and account deletion cascade only the requesting user's data", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-cycling-repo-"));
  try {
    const repository = new FileApplicationRepository(root);
    const record = getRideFixture("l1-built-in-sample");
    const a = { activity: { ...record.activity, rideId: "a-ride" }, series: { ...record.series, rideId: "a-ride" } };
    const b = { activity: { ...record.activity, rideId: "b-ride" }, series: { ...record.series, rideId: "b-ride" } };
    await repository.saveRide("a", a); await repository.saveRide("b", b);
    await repository.saveAnalysisRun("a", "a-ride", { ok: true });
    await repository.saveProfile("a", createUserProfile({ age: 30 }));
    assert.equal(await repository.deleteRide("a", "a-ride"), true);
    assert.equal(await repository.getAnalysisRun("a", "a-ride"), null);
    await repository.saveRide("a", a); await repository.saveAnalysisRun("a", "a-ride", { ok: true });
    await repository.saveConsent("a", { policyVersion: "privacy-v1", acceptedAt: "2026-09-04T00:00:00.000Z" });
    await repository.saveDemoEvent("a", createDemoEvent({ type: "import_started" }));
    await repository.deleteAccount("a");
    assert.equal(await repository.getRide("a", "a-ride"), null);
    assert.equal(await repository.getProfile("a"), null);
    assert.equal(await repository.getConsent("a"), null);
    assert.deepEqual(await repository.listDemoEvents("a"), []);
    assert.ok(await repository.getRide("b", "b-ride"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("content-hash lookup scopes idempotent import dedup to the owner and deletion clears it", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-cycling-repo-"));
  try {
    const repository = new FileApplicationRepository(root);
    const record = getRideFixture("l1-built-in-sample");
    const ride = { activity: { ...record.activity, rideId: "hash-ride-1" }, series: { ...record.series, rideId: "hash-ride-1" } };
    const unhashed = { activity: { ...record.activity, rideId: "hash-ride-2" }, series: { ...record.series, rideId: "hash-ride-2" } };

    await repository.saveRide("user-a", ride, "sha-256:sample-hash");
    // 未携带哈希的记录不参与去重索引。
    await repository.saveRide("user-a", unhashed);

    assert.equal(await repository.findRideIdByContentHash("user-a", "sha-256:sample-hash"), "hash-ride-1");
    // 归属隔离：其他会话查不到该哈希。
    assert.equal(await repository.findRideIdByContentHash("user-b", "sha-256:sample-hash"), null);
    assert.equal(await repository.findRideIdByContentHash("user-a", "sha-256:other"), null);
    assert.equal(await repository.findRideIdByContentHash("user-a", "sha-256:unhashed"), null);

    // 删除记录后哈希随之移除，重新导入不再命中去重。
    assert.equal(await repository.deleteRide("user-a", "hash-ride-1"), true);
    assert.equal(await repository.findRideIdByContentHash("user-a", "sha-256:sample-hash"), null);

    // 账户删除同样级联清除哈希索引。
    await repository.saveRide("user-a", ride, "sha-256:sample-hash");
    await repository.deleteAccount("user-a");
    assert.equal(await repository.findRideIdByContentHash("user-a", "sha-256:sample-hash"), null);

    // 重启（重新加载状态文件）后哈希索引仍可追溯。
    const restarted = new FileApplicationRepository(root);
    const persisted = { activity: { ...record.activity, rideId: "hash-ride-3" }, series: { ...record.series, rideId: "hash-ride-3" } };
    await restarted.saveRide("user-c", persisted, "sha-256:persisted-hash");
    const reloaded = new FileApplicationRepository(root);
    assert.equal(await reloaded.findRideIdByContentHash("user-c", "sha-256:persisted-hash"), "hash-ride-3");
  } finally { await rm(root, { recursive: true, force: true }); }
});
