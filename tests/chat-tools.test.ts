import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHAT_FIND_RIDE_MAX_MATCHES,
  CHAT_TOOL_MAX_RESULT_BYTES,
  ChatToolError,
  executeChatTool,
  isRideReferencePending,
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
  // AGT-B5（ORCH-09 驱动）：caps 上限已从 8 放宽到全集（18）——
  // "最近一次骑行有哪些数据可以看"的正确答案就是全部能力，旧上限会让正确请求被判非法。
  // 因此不再存在"少于全集但超上限"的用例；长度相关的非法只剩"重复"（上一行已覆盖）。
});

test("get_ride_context returns only requested dimensions and no private raw data", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l3-fit-power", "private-ride"));
    const invocation = parseChatToolInvocation({ tool: "get_ride_context", input: { rideId: "private-ride", dims: ["power"] } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "get_ride_context");
    // AGT-H1：`{rideId}` 一定唯一解析，不会落到"记录选择未定"。
    assert.equal(isRideReferencePending(result), false);
    if (result.tool !== "get_ride_context" || isRideReferencePending(result)) return;
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
  // CHAT-17：find_ride 检索路径同样只读（stub listRides 为空 → no_match，不产生写调用）。
  await executeChatTool(repository, "owner", parseChatToolInvocation({ tool: "find_ride", input: { rideId: "read-only-ride", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 30 } }));
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

// CHAT-17 P1：find_ride 只读检索工具——本人记录窗口内按指标白名单做极值/阈值筛选。

// 检索测试记录：按 fixture 派生并覆盖出发时间（窗口与排序控制）。
function findRideRecord(fixtureId: string, rideId: string, startTime: string) {
  const record = privateRecord(fixtureId, rideId);
  record.activity.startTime = startTime;
  return record;
}

test("find_ride validates mode, metric whitelist, threshold presence and window bounds (CHAT-17)", () => {
  // 非白名单指标 / 非法模式
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "maxSpeedMps", mode: "max", metrics: ["distanceM"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "average", metrics: ["distanceM"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  // threshold 模式缺 threshold / threshold 非数字；其他模式携带 threshold（多余键）
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "avgHeartRateBpm", mode: "threshold", metrics: ["avgHeartRateBpm"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "avgHeartRateBpm", mode: "threshold", threshold: "120", metrics: ["avgHeartRateBpm"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "max", threshold: 120, metrics: ["distanceM"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  // AGT-B2 预期变更：窗口上限 30 → 365（D-B1/P7 解冻）。缺省仍 30 由编排层注入，
  // 所以这里改测"超过 365 才拒"；31~365 现在是合法输入。
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 366 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.equal(parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 365 } }).tool, "find_ride");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "max", metrics: ["distanceM", "distanceM"], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "max", metrics: [], windowDays: 30 } }), (error) => errorCode(error) === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "ride-1", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 30, userId: "other" } }), (error) => errorCode(error) === "INVALID_INPUT");
});

test("find_ride max mode returns the farthest in-window ride with claim projection and owner isolation (CHAT-17)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    // 窗口外（>30 天）与他人记录不参与；锚点本身参与候选。
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "outside-window", "2026-07-01T08:00:00Z", 80));
    await repository.saveRide("owner-b", comparisonRecord("l3-fit-power", "other-owner", "2026-08-16T08:00:00Z", 99));
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "history-short", "2026-08-10T08:00:00Z", 30));
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "history-far", "2026-08-15T08:00:00Z", 55));
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "anchor-ride", "2026-08-20T08:00:00Z", 42));
    const invocation = parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-ride", metric: "distanceM", mode: "max", metrics: ["distanceM", "avgHeartRateBpm"], windowDays: 30 } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "find_ride");
    if (result.tool !== "find_ride") return;
    assert.equal(result.status, "matched");
    assert.equal(result.matchedCount, 1);
    assert.equal(result.candidateCount, 3);
    assert.equal(result.matches.length, 1);
    const match = result.matches[0];
    assert.equal(match.rideId, "history-far");
    assert.equal(match.rideDateLabel, "2026年8月15日");
    const distanceClaim = match.claims.find((claim) => claim.metricKey === "distanceM");
    assert.equal(distanceClaim?.claimId, "claim:find:history-far:distanceM");
    assert.equal(distanceClaim?.displayValue, "55.0");
    assert.equal(distanceClaim?.unit, "km");
    const heartRateClaim = match.claims.find((claim) => claim.metricKey === "avgHeartRateBpm");
    assert.equal(heartRateClaim?.displayValue, "151");
    const serialized = JSON.stringify(result);
    for (const forbidden of ["fileName", "points", "coordinateSpace", "owner-a", "owner-b", "sourceField"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.ok(Buffer.byteLength(serialized, "utf8") <= CHAT_TOOL_MAX_RESULT_BYTES);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("find_ride threshold mode filters above threshold, orders by recency and caps matches (CHAT-17)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    // 六条含有效平均心率的记录（144–151 bpm）+ 无心率锚点；阈值 140 全部命中，按时间倒序取前 5。
    await repository.saveRide("owner-a", findRideRecord("fit-unknown-developer-field", "hr-144", "2026-08-01T08:00:00Z"));
    await repository.saveRide("owner-a", findRideRecord("l2-built-in-sample", "hr-145", "2026-08-03T08:00:00Z"));
    await repository.saveRide("owner-a", findRideRecord("l2-fit-heart-rate", "hr-146", "2026-08-05T08:00:00Z"));
    await repository.saveRide("owner-a", findRideRecord("fit-power-dropout-with-heart-rate", "hr-149", "2026-08-07T08:00:00Z"));
    await repository.saveRide("owner-a", findRideRecord("l3-built-in-sample", "hr-150", "2026-08-09T08:00:00Z"));
    await repository.saveRide("owner-a", findRideRecord("l3-fit-power", "hr-151", "2026-08-11T08:00:00Z"));
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "anchor-ride", "2026-08-20T08:00:00Z", 42));
    const invocation = parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-ride", metric: "avgHeartRateBpm", mode: "threshold", threshold: 140, metrics: ["avgHeartRateBpm"], windowDays: 30 } });
    const result = await executeChatTool(repository, "owner-a", invocation);
    assert.equal(result.tool, "find_ride");
    if (result.tool !== "find_ride") return;
    assert.equal(result.status, "matched");
    assert.equal(result.threshold, 140);
    assert.equal(result.matchedCount, 6);
    assert.equal(result.matches.length, CHAT_FIND_RIDE_MAX_MATCHES);
    assert.deepEqual(result.matches.map((match) => match.rideId), ["hr-151", "hr-150", "hr-149", "hr-146", "hr-145"]);
    assert.deepEqual(result.matches[0].claims.map((claim) => claim.displayValue), ["151"]);
    assert.equal(result.matches[0].rideDateLabel, "2026年8月11日");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("find_ride breaks extreme ties by recency and includes the anchor as candidate (CHAT-17)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "tie-older", "2026-08-10T08:00:00Z", 50));
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "tie-newer", "2026-08-15T08:00:00Z", 50));
    await repository.saveRide("owner-a", comparisonRecord("l3-fit-power", "anchor-ride", "2026-08-20T08:00:00Z", 42));
    const maxResult = await executeChatTool(repository, "owner-a", parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-ride", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 30 } }));
    assert.equal(maxResult.tool, "find_ride");
    if (maxResult.tool !== "find_ride") return;
    assert.equal(maxResult.matches[0]?.rideId, "tie-newer");
    // min 模式：锚点本身是候选且距离最短——验证与 compare_rides 不同的“含锚点”口径。
    const minResult = await executeChatTool(repository, "owner-a", parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-ride", metric: "distanceM", mode: "min", metrics: ["distanceM"], windowDays: 30 } }));
    assert.equal(minResult.tool, "find_ride");
    if (minResult.tool !== "find_ride") return;
    assert.equal(minResult.matches[0]?.rideId, "anchor-ride");
    assert.equal(minResult.matches[0]?.claims[0]?.displayValue, "42.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("find_ride reports deterministic no_match reason codes (CHAT-17)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    // METRIC_MISSING：窗口内记录均不含该指标有效值（L1 无功率）。
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "l1-history", "2026-08-10T08:00:00Z", 30));
    await repository.saveRide("owner-a", comparisonRecord("l1-built-in-sample", "anchor-ride", "2026-08-20T08:00:00Z", 42));
    const metricMissing = await executeChatTool(repository, "owner-a", parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-ride", metric: "avgPowerW", mode: "max", metrics: ["avgPowerW"], windowDays: 30 } }));
    assert.equal(metricMissing.tool, "find_ride");
    if (metricMissing.tool !== "find_ride") return;
    assert.equal(metricMissing.status, "no_match");
    assert.deepEqual(metricMissing.reasonCodes, ["METRIC_MISSING"]);
    assert.equal(metricMissing.candidateCount, 2);
    assert.equal(metricMissing.matchedCount, 0);
    assert.deepEqual(metricMissing.matches, []);
    // THRESHOLD_NO_MATCH：有有效值但无记录超过阈值。
    await repository.saveRide("owner-a", findRideRecord("l3-fit-power", "hr-151", "2026-08-12T08:00:00Z"));
    const thresholdMissed = await executeChatTool(repository, "owner-a", parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-ride", metric: "avgHeartRateBpm", mode: "threshold", threshold: 200, metrics: ["avgHeartRateBpm"], windowDays: 30 } }));
    assert.equal(thresholdMissed.tool, "find_ride");
    if (thresholdMissed.tool !== "find_ride") return;
    assert.equal(thresholdMissed.status, "no_match");
    assert.deepEqual(thresholdMissed.reasonCodes, ["THRESHOLD_NO_MATCH"]);
    // ANCHOR_TIME_MISSING：锚点无有效出发时间，窗口无法确定。
    await repository.saveRide("owner-a", privateRecord("gpx-no-timestamps", "anchor-no-time"));
    const anchorMissing = await executeChatTool(repository, "owner-a", parseChatToolInvocation({ tool: "find_ride", input: { rideId: "anchor-no-time", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 30 } }));
    assert.equal(anchorMissing.tool, "find_ride");
    if (anchorMissing.tool !== "find_ride") return;
    assert.equal(anchorMissing.status, "no_match");
    assert.deepEqual(anchorMissing.reasonCodes, ["ANCHOR_TIME_MISSING"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("find_ride rejects cross-owner and missing anchors with NOT_FOUND (CHAT-17)", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"));
  try {
    const repository = new FileApplicationRepository(root);
    await repository.saveRide("owner-a", privateRecord("l1-built-in-sample", "private-ride"));
    const ownedByOther = parseChatToolInvocation({ tool: "find_ride", input: { rideId: "private-ride", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 30 } });
    const missing = parseChatToolInvocation({ tool: "find_ride", input: { rideId: "missing-ride", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 30 } });
    await assert.rejects(executeChatTool(repository, "owner-b", ownedByOther), (error) => errorCode(error) === "NOT_FOUND");
    await assert.rejects(executeChatTool(repository, "owner-a", missing), (error) => errorCode(error) === "NOT_FOUND");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
