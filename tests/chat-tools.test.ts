import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHAT_TOOL_MAX_RESULT_BYTES,
  ChatToolError,
  executeChatTool,
  parseChatToolInvocation,
} from "../src/chat/chat-tools.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { FileApplicationRepository } from "../src/persistence/application-repository.ts";

function privateRecord(fixtureId: string, rideId: string) {
  const fixture = getRideFixture(fixtureId);
  return {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

// CHAT-13：比较测试记录——覆盖出发时间与距离值，构造 30 天窗口内的历史基线。
// 距离覆盖后按同比例缩放均速，保持 distance/时长/均速 口径一致（INCONSISTENT_AVG_SPEED 校验）。
function comparisonRecord(fixtureId: string, rideId: string, startTime: string, distanceKm: number) {
  const record = privateRecord(fixtureId, rideId);
  const originalDistanceM = record.activity.metrics.distanceM!.value;
  const avgSpeed = record.activity.metrics.avgSpeedMps;
  record.activity.startTime = startTime;
  record.activity.metrics.distanceM = { ...record.activity.metrics.distanceM!, value: distanceKm * 1_000 };
  if (avgSpeed) {
    record.activity.metrics.avgSpeedMps = { ...avgSpeed, value: (avgSpeed.value * distanceKm * 1_000) / originalDistanceM };
  }
  return record;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ChatToolError ? error.code : undefined;
}

test("chat tool invocation rejects unknown fields, dimensions, capabilities and oversized lists", () => {
  assert.throws(() => parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "ride-1", dims: ["summary"], userId: "other" } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "ride-1", dims: ["route"] } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "ride-1", caps: ["distance", "distance"] } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "ride-1", caps: ["distance", "timing", "speed", "elevation", "heartRate", "power", "cadence", "route", "trend"] } }), (error) => errorCode(error) === "INVALID_INPUT");
});

test("get_ride_context returns only requested dimensions and no private raw data", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l3-fit-power", "private-ride"));
    const invocation = parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "private-ride", dims: ["power"] } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "get_ride_context");
    if (result.tool !== "get_ride_context") return;
    assert.deepEqual(result.dimensions, ["power"]);
    // CHAT-15：日期标签来自 activity.startTime（Asia/Shanghai 口径，与详情页一致）。
    assert.equal(result.rideDateLabel, "2026年8月12日");
    assert.ok(result.claims.some((claim) => claim.key === "avgPowerW"));
    assert.equal(result.claims.some((claim) => claim.key === "distanceM" || claim.key === "avgHeartRateBpm"), false);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= CHAT_TOOL_MAX_RESULT_BYTES);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["fileName", "points", "coordinateSpace", "userScope", "owner-a", "sourceField"]) assert.equal(serialized.includes(forbidden), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("get_capabilities returns only requested capability states", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l1-built-in-sample", "private-ride"));
    const invocation = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "private-ride", caps: ["distance", "power"] } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "get_capabilities");
    if (result.tool !== "get_capabilities") return;
    assert.deepEqual(result.capabilities.map((capability) => capability.key), ["distance", "power"]);
    assert.equal(result.capabilities[0].available, true);
    assert.equal(result.capabilities[1].available, false);
    assert.equal(result.capabilities[1].unavailableReason, "FIELD_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing and cross-owner rides return the same NOT_FOUND error", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l2-fit-heart-rate", "private-ride"));
    const ownedByOther = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "private-ride", caps: ["heartRate"] } });
    const missing = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "missing-ride", caps: ["heartRate"] } });
    await assert.rejects(executeChatTool(repository, "owner-b", ownedByOther), (error) => errorCode(error) === "NOT_FOUND");
    await assert.rejects(executeChatTool(repository, "owner-b", missing), (error) => errorCode(error) === "NOT_FOUND");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat tools never call repository write methods", async () => {
  const record = privateRecord("l1-built-in-sample", "read-only-ride");
  const writes: string[] = [];
  const repository = {
    getRide: async (ownerId: string, rideId: string) => ownerId === "owner" && rideId === "read-only-ride" ? record : null,
    getProfile: async () => null,
    listRides: async () => [],
    findRideIdByContentHash: async () => null,
    saveRide: async () => { writes.push("saveRide"); },
    deleteRide: async () => { writes.push("deleteRide"); return true; },
    saveProfile: async () => { writes.push("saveProfile"); },
    saveAnalysisRun: async () => { writes.push("saveAnalysisRun"); },
    getAnalysisRun: async () => null,
    getConsent: async () => null,
    saveConsent: async () => { writes.push("saveConsent"); },
    saveDemoEvent: async () => { writes.push("saveDemoEvent"); },
    listDemoEvents: async () => [],
    deleteAccount: async () => { writes.push("deleteAccount"); },
  };
  await executeChatTool(repository, "owner", parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "read-only-ride", caps: ["distance"] } }));
  assert.deepEqual(writes, []);
});

test("chat tool timeout uses the stable TIMEOUT error without exposing repository details", async () => {
  const repository = {
    getRide: async () => await new Promise<null>(() => {}),
    getProfile: async () => null,
  } as unknown as FileApplicationRepository;
  const invocation = parseChatToolInvocation({ tool: "get_capabilities", input: { rideId: "slow-ride", caps: ["distance"] } });
  await assert.rejects(executeChatTool(repository, "owner", invocation), (error) => errorCode(error) === "TIMEOUT");
});

// CHAT-13：compare_rides 只读工具——锚点与 30 天窗口历史基线的白名单比较投影。

test("compare_rides projects a comparable 30-day baseline without private data (CHAT-13)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "history-older", "2026-08-10T08:00:00Z", 30));
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "history-recent", "2026-08-15T08:00:00Z", 36));
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "anchor-ride", "2026-08-20T08:00:00Z", 42));
    const invocation = parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "anchor-ride", metrics: ["distanceM"], windowDays: 30 } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "compare_rides");
    if (result.tool !== "compare_rides") return;
    assert.equal(result.windowDays, 30);
    assert.equal(result.comparability.status, "comparable");
    assert.equal(result.comparability.sampleCount, 2);
    assert.equal(result.comparability.minimumSampleCount, 2);
    const claim = result.claims.find((item) => item.metricKey === "distanceM" && item.scope === "all");
    assert.ok(claim?.claimId, "comparable metric must carry a claimId");
    assert.equal(claim?.status, "comparable");
    assert.equal(claim?.anchor?.displayValue, "42.0");
    assert.equal(claim?.anchor?.unit, "km");
    assert.equal(claim?.baseline?.displayValue, "33.0");
    assert.equal(claim?.baseline?.sampleCount, 2);
    assert.equal(claim?.change, 9);
    assert.equal(claim?.relativeChangePercent, 27.3);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["fileName", "points", "coordinateSpace", "owner-a", "sourceField", "sourceHistoryIds", "evidenceId"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compare_rides stays not_comparable for the first ride and rejects cross-owner anchors (CHAT-13 D1)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "first-ride", "2026-08-20T08:00:00Z", 42));
    const invocation = parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "first-ride", metrics: ["distanceM"], windowDays: 30 } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "compare_rides");
    if (result.tool !== "compare_rides") return;
    assert.equal(result.comparability.status, "not_comparable");
    assert.equal(result.comparability.sampleCount, 0);
    assert.equal(result.claims.some((claim) => claim.claimId), false);
    assert.ok(result.claims.some((claim) => claim.reasonCodes.length > 0));
    // 跨用户锚点与缺失记录返回同一 NOT_FOUND，不泄露归属信息。
    await assert.rejects(executeChatTool(repository, "owner-b", invocation), (error) => errorCode(error) === "NOT_FOUND");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compare_rides validates metrics against the whitelist and the window bounds (CHAT-13)", () => {
  assert.throws(() => parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "ride-1", metrics: ["maxSpeedMps"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "ride-1", metrics: ["distanceM", "distanceM"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "ride-1", metrics: ["distanceM"], windowDays: 0 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "ride-1", metrics: ["distanceM"], windowDays: 366 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "compare_rides", input: { rideId: "ride-1", metrics: ["distanceM"] } }), (error) => errorCode(error) === "INVALID_INPUT");
});
