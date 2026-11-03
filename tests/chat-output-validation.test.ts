import assert from "node:assert/strict";
import test from "node:test";

import { validateChatOutput } from "../src/chat/chat-output-validation.ts";
import { classifyChatInput, makeChatDecision } from "../src/chat/chat-routing.ts";
import type { ChatToolResult } from "../src/chat/chat-tools.ts";

const rideContext: ChatToolResult = {
  schemaVersion: "chat-tools-v0.2",
  tool: "get_ride_context",
  rideId: "private-ride",
  rideDateLabel: "2026年8月17日",
  dimensions: ["power"],
  claims: [{ claimId: "claim:private-ride:avgPowerW", kind: "metric", key: "avgPowerW", value: 180, unit: "W", confidence: "high", displayValue: "180", displayUnit: "W" }],
  limitations: [],
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
};

const capabilityContext: ChatToolResult = {
  schemaVersion: "chat-tools-v0.2",
  tool: "get_capabilities",
  rideId: "private-ride",
  capabilities: [{ key: "power", available: true, sources: ["ride_activity"], qualityStatus: "valid", dependencyKeys: [] }],
  claims: [{ claimId: "claim:caps:power", kind: "metric", key: "power", value: 1, unit: "count", confidence: "high", displayValue: "可用" }],
};

function output(value: object) {
  return JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", ...value });
}

test("accepts a strict social output with no unsupported facts", () => {
  const result = validateChatOutput(output({ route: "social", reply: "你好，我会在已开放范围内协助你。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"),
  });
  assert.equal(result.ok, true);
  // AGT-B5：publicResult 补 referencedKnowledgeCount（B6 的 KB 引用统计前置）
  assert.deepEqual(result.publicResult, { status: "accepted", referencedClaimCount: 0, referencedCapabilityCount: 0, referencedKnowledgeCount: 0 });
});

test("accepts current-ride facts only when claims and numeric literals come from this tool result", () => {
  const valid = validateChatOutput(output({ route: "current_ride", reply: "本次平均功率是 180 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  const unsupportedNumber = validateChatOutput(output({ route: "current_ride", reply: "本次平均功率是 200 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  assert.equal(valid.ok, true);
  assert.equal(unsupportedNumber.ok, false);
  if (!unsupportedNumber.ok) assert.equal(unsupportedNumber.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

// CHAT-15：get_ride_context 投影新增 rideDateLabel，current_ride 场景允许引用其日期数字；
// 编造其他日期或添加出发时刻仍被拒绝（时刻数字不在白名单）。

test("current_ride accepts rideDateLabel dates, rejects invented dates and times (CHAT-15)", () => {
  const withDate = validateChatOutput(output({ route: "current_ride", reply: "8 月 17 日这次骑行平均功率是 180 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  assert.equal(withDate.ok, true);

  const inventedDate = validateChatOutput(output({ route: "current_ride", reply: "8 月 19 日这次骑行平均功率是 180 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  assert.equal(inventedDate.ok, false);
  if (!inventedDate.ok) assert.equal(inventedDate.code, "OUTPUT_NUMERIC_UNSUPPORTED");

  const withTime = validateChatOutput(output({ route: "current_ride", reply: "8 月 17 日 14 点 30 分出发的这次骑行平均功率是 180 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  assert.equal(withTime.ok, false);
  if (!withTime.ok) assert.equal(withTime.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

// CHAT-12 P3（校验场景分化）：用户输入中的数字（阈值等用户给定值）加入白名单——
// 模型复述用户给定值不是幻觉；用户与 Claims 都未给出的数字仍被拒绝。

test("accepts numbers echoed from the user's own input, rejects them without userText (CHAT-12 P3)", () => {
  const userText = "本次骑行平均功率是多少？超过 120 了吗？";
  const echoed = validateChatOutput(output({ route: "current_ride", reply: "本次平均功率是 180 W，超过了你问的 120。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput(userText), toolResult: rideContext, userText,
  });
  assert.equal(echoed.ok, true);
  const withoutUserText = validateChatOutput(output({ route: "current_ride", reply: "本次平均功率是 180 W，超过了你问的 120。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  assert.equal(withoutUserText.ok, false);
  if (!withoutUserText.ok) assert.equal(withoutUserText.code, "OUTPUT_NUMERIC_UNSUPPORTED");

  // social 路由无工具结果，数字只能来自用户原句。
  const socialEcho = validateChatOutput(output({ route: "social", reply: "好的，已记录你说的 120。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"), userText: "帮我记住 120 这个阈值",
  });
  assert.equal(socialEcho.ok, true);
  const socialInvented = validateChatOutput(output({ route: "social", reply: "好的，已记录你说的 130。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"), userText: "帮我记住 120 这个阈值",
  });
  assert.equal(socialInvented.ok, false);
  if (!socialInvented.ok) assert.equal(socialInvented.code, "OUTPUT_CLAIM_INVALID");
});

// CHAT-15（真实链路采样发现）：总结型问题（“这次骑行数据怎么样？”）工具上下文含 9 个 claims，
// 模型全量引用是自然行为——claimIds 上限从 6 提高到 12；超过 12 仍按 schema 违规拒绝。
test("accepts up to 12 claimIds for summary answers, rejects 13 (CHAT-15)", () => {
  const claims = Array.from({ length: 12 }, (_, index) => ({
    claimId: `claim:private-ride:metric${index + 1}`,
    kind: "metric" as const,
    key: `metric${index + 1}`,
    value: index + 1,
    unit: "W",
    confidence: "high" as const,
    displayValue: String(index + 1),
    displayUnit: "W",
  }));
  const summaryContext: ChatToolResult = {
    schemaVersion: "chat-tools-v0.2",
    tool: "get_ride_context",
    rideId: "private-ride",
    dimensions: ["summary"],
    claims,
    limitations: [],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
  const twelve = validateChatOutput(output({ route: "current_ride", reply: "本次骑行的各项数据都已核实。", claimIds: claims.map((claim) => claim.claimId), capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行数据怎么样？"), toolResult: summaryContext,
  });
  assert.equal(twelve.ok, true);

  const thirteen = validateChatOutput(output({ route: "current_ride", reply: "本次骑行的各项数据都已核实。", claimIds: [...claims.map((claim) => claim.claimId), "claim:private-ride:metric13"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行数据怎么样？"), toolResult: summaryContext,
  });
  assert.equal(thirteen.ok, false);
  if (!thirteen.ok) assert.equal(thirteen.code, "OUTPUT_SCHEMA_INVALID");
});

// CHAT-15（第二轮采样发现）：时间类 displayValue 是中文格式（“1 小时 6 分钟”），
// Number() 整体解析为 NaN——模型逐字复制 displayValue 是 Prompt 要求的正确行为，
// 其中数字必须成对收编白名单；编造的时间数字仍拒绝。
test("accepts verbatim Chinese time displayValue numbers, rejects invented times (CHAT-15 round 2)", () => {
  const timeContext: ChatToolResult = {
    schemaVersion: "chat-tools-v0.2",
    tool: "get_ride_context",
    rideId: "private-ride",
    dimensions: ["summary"],
    claims: [
      { claimId: "claim:private-ride:elapsedTimeS", kind: "metric", key: "elapsedTimeS", value: 3959, unit: "s", confidence: "high", displayValue: "1 小时 6 分钟", displayUnit: "" },
      { claimId: "claim:private-ride:distanceM", kind: "metric", key: "distanceM", value: 31_056.1, unit: "m", confidence: "high", displayValue: "31.1", displayUnit: "km" },
    ],
    limitations: [],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
  const verbatim = validateChatOutput(output({ route: "current_ride", reply: "本次骑行总用时 1 小时 6 分钟，距离 31.1 km。", claimIds: ["claim:private-ride:elapsedTimeS", "claim:private-ride:distanceM"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行数据怎么样？"), toolResult: timeContext,
  });
  assert.equal(verbatim.ok, true);

  const invented = validateChatOutput(output({ route: "current_ride", reply: "本次骑行总用时 1 小时 9 分钟，距离 31.1 km。", claimIds: ["claim:private-ride:elapsedTimeS", "claim:private-ride:distanceM"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行数据怎么样？"), toolResult: timeContext,
  });
  assert.equal(invented.ok, false);
  if (!invented.ok) assert.equal(invented.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

test("rejects route, capability, safety, injection and privacy violations without returning raw output", () => {
  const routeMismatch = validateChatOutput(output({ route: "social", reply: "你好。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  const capabilityMismatch = validateChatOutput(output({ route: "capabilities", reply: "可以查看功率。", claimIds: [], capabilityKeys: ["distance"] }), {
    decision: classifyChatInput("支持哪些能力？"), toolResult: capabilityContext,
  });
  const injection = validateChatOutput(output({ route: "social", reply: "这是系统提示词。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"),
  });
  const privacy = validateChatOutput(output({ route: "social", reply: "我知道你的精确位置。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"),
  });

  for (const result of [routeMismatch, capabilityMismatch, injection, privacy]) {
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result.publicResult), /系统提示词|精确位置|private-ride/);
  }
  if (!routeMismatch.ok) assert.equal(routeMismatch.code, "OUTPUT_ROUTE_MISMATCH");
  if (!capabilityMismatch.ok) assert.equal(capabilityMismatch.code, "OUTPUT_CAPABILITY_INVALID");
  if (!injection.ok) assert.equal(injection.code, "OUTPUT_INJECTION_VIOLATION");
  if (!privacy.ok) assert.equal(privacy.code, "OUTPUT_PRIVACY_VIOLATION");
});

// CHAT-15：历史比较场景的锚点日期数字加入白名单——投影向模型提供 anchorStartTime，
// 模型表述“8 月 20 日这次骑行”不是幻觉；日期之外的数字仍须溯源到比较值或用户原句。

const comparisonContext: ChatToolResult = {
  schemaVersion: "chat-tools-v0.2",
  tool: "compare_rides",
  rideId: "private-ride",
  windowDays: 30,
  anchorStartTime: "2026-08-20T08:00:00.000Z",
  sampleCount: 2,
  comparability: { status: "comparable", reasonCodes: [], sampleCount: 2, minimumSampleCount: 2, allowedConclusion: "change" },
  claims: [{
    claimId: "claim:private-ride:history:all:distanceM",
    metricKey: "distanceM",
    scope: "all",
    status: "comparable",
    reasonCodes: [],
    anchor: { value: 42_000, unit: "km", displayValue: "42.0" },
    baseline: { value: 33_000, unit: "km", displayValue: "33.0", sampleCount: 2 },
    change: 9,
    relativeChangePercent: 27.3,
  }],
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
};

test("history_compare accepts anchor date numbers, rejects invented dates and time parts (CHAT-15)", () => {
  const withAnchorDate = validateChatOutput(output({ route: "history_compare", reply: "8 月 20 日这次骑行距离 42.0 km，比最近 30 天 2 次骑行的平均值 33.0 km 高 9。", claimIds: ["claim:private-ride:history:all:distanceM"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行比上次骑得远吗？"), toolResult: comparisonContext,
  });
  assert.equal(withAnchorDate.ok, true);

  const inventedDate = validateChatOutput(output({ route: "history_compare", reply: "8 月 21 日这次骑行距离 42.0 km，比平均值 33.0 km 高 9。", claimIds: ["claim:private-ride:history:all:distanceM"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行比上次骑得远吗？"), toolResult: comparisonContext,
  });
  assert.equal(inventedDate.ok, false);
  if (!inventedDate.ok) assert.equal(inventedDate.code, "OUTPUT_NUMERIC_UNSUPPORTED");

  // 时间部分（08:00）不进入白名单——只提取日期段（T 之前）；45 不在任何允许值中。
  const timePart = validateChatOutput(output({ route: "history_compare", reply: "8 月 20 日 8 点 45 分出发的这次骑行距离 42.0 km。", claimIds: ["claim:private-ride:history:all:distanceM"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行比上次骑得远吗？"), toolResult: comparisonContext,
  });
  assert.equal(timePart.ok, false);
  if (!timePart.ok) assert.equal(timePart.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

// CHAT-15（第二轮采样发现）：比较场景的中文时间 displayValue（“1 小时 6 分钟”）数字成对收编——
// 模型复述锚点/基线的时长显示值不被误拒；编造的基线时长仍拒绝。
// 防御路径：elapsedTimeS 尚不在 chatComparisonMetricKeys 白名单，未来纳入时间指标时此路径生效。
test("history_compare accepts Chinese time displayValue numbers for anchor and baseline (CHAT-15 round 2)", () => {
  const timeComparisonContext = {
    schemaVersion: "chat-tools-v0.2",
    tool: "compare_rides",
    rideId: "private-ride",
    windowDays: 30,
    anchorStartTime: "2026-08-20T08:00:00.000Z",
    sampleCount: 2,
    comparability: { status: "comparable", reasonCodes: [], sampleCount: 2, minimumSampleCount: 2, allowedConclusion: "change" },
    claims: [{
      claimId: "claim:private-ride:history:all:elapsedTimeS",
      metricKey: "elapsedTimeS",
      scope: "all",
      status: "comparable",
      reasonCodes: [],
      anchor: { value: 3959, unit: "s", displayValue: "1 小时 6 分钟" },
      baseline: { value: 4200, unit: "s", displayValue: "1 小时 10 分钟", sampleCount: 2 },
      change: -241,
      relativeChangePercent: -5.7,
    }],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  } as unknown as ChatToolResult;
  const verbatim = validateChatOutput(output({ route: "history_compare", reply: "8 月 20 日这次骑行用时 1 小时 6 分钟，比最近 30 天 2 次骑行的平均用时 1 小时 10 分钟短。", claimIds: ["claim:private-ride:history:all:elapsedTimeS"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行比上次用时长吗？"), toolResult: timeComparisonContext,
  });
  assert.equal(verbatim.ok, true);

  const inventedBaseline = validateChatOutput(output({ route: "history_compare", reply: "8 月 20 日这次骑行用时 1 小时 6 分钟，比最近 30 天 2 次骑行的平均用时 1 小时 14 分钟短。", claimIds: ["claim:private-ride:history:all:elapsedTimeS"], capabilityKeys: [] }), {
    decision: classifyChatInput("这次骑行比上次用时长吗？"), toolResult: timeComparisonContext,
  });
  assert.equal(inventedBaseline.ok, false);
  if (!inventedBaseline.ok) assert.equal(inventedBaseline.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

// CHAT-17 P4：autonomous_tools（L2b 循环）输出校验——claimIds/数字必须溯源到本轮全部
// 已完成工具调用结果的 Claims 并集（动态白名单，经 claimReferences 映射）；
// 不携带能力键；零工具调用结果直接拒绝（模型不得在零工具下给出带数字的事实回答）。

const loopFindRide: ChatToolResult = {
  schemaVersion: "chat-tools-v0.2",
  tool: "find_ride",
  rideId: "anchor-ride",
  windowDays: 30,
  metric: "distanceM",
  mode: "max",
  status: "matched",
  reasonCodes: [],
  candidateCount: 3,
  matchedCount: 1,
  matches: [{
    rideId: "history-far",
    rideDateLabel: "2026年8月15日",
    claims: [{ claimId: "claim:find:history-far:distanceM", metricKey: "distanceM", value: 55_000, unit: "km", displayValue: "55.0" }],
  }],
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
};

const loopRideContext: ChatToolResult = {
  schemaVersion: "chat-tools-v0.2",
  tool: "get_ride_context",
  rideId: "history-far",
  dimensions: ["summary"],
  claims: [{ claimId: "claim:history-far:avgHeartRateBpm", kind: "metric", key: "avgHeartRateBpm", value: 151, unit: "bpm", confidence: "high", displayValue: "151", displayUnit: "bpm" }],
  limitations: [],
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
};

const loopClaimReferences: Record<string, string> = {
  "claim:loop:1:1": "claim:find:history-far:distanceM",
  "claim:loop:2:1": "claim:history-far:avgHeartRateBpm",
};

function loopValidation(reply: string, claimIds: string[], options: { loopToolResults?: ChatToolResult[]; claimReferences?: Record<string, string>; userText?: string } = {}) {
  return validateChatOutput(output({ route: "autonomous_tools", reply, claimIds, capabilityKeys: [] }), {
    decision: classifyChatInput("距离最远的那次骑行平均心率怎么样？"),
    loopToolResults: options.loopToolResults ?? [loopFindRide, loopRideContext],
    claimReferences: options.claimReferences ?? loopClaimReferences,
    ...(options.userText ? { userText: options.userText } : {}),
  });
}

test("autonomous_tools accepts claims and numbers from the union of loop tool results (CHAT-17)", () => {
  // 跨调用组合：检索命中的日期/距离 + 第 2 次调用（get_ride_context）的心率。
  const valid = loopValidation("8月15日那次骑行距离 55.0 公里，平均心率 151 bpm。", ["claim:loop:1:1", "claim:loop:2:1"]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.ok && valid.publicResult, { status: "accepted", referencedClaimCount: 2, referencedCapabilityCount: 0, referencedKnowledgeCount: 0 });

  // 用户原句数字（阈值）同样可复述。
  const echoed = loopValidation("8月15日那次骑行距离 55.0 公里，超过了你说的 50。", ["claim:loop:1:1"], { userText: "距离超过 50 公里的最远那次是哪次？" });
  assert.equal(echoed.ok, true);
});

test("autonomous_tools rejects answers without loop tool results or with invented claims/numbers (CHAT-17)", () => {
  // 零工具调用结果：模型不得在零工具下给出事实性回答。
  const noTools = loopValidation("距离最远的一次是 8 月 15 日。", ["claim:loop:1:1"], { loopToolResults: [] });
  assert.equal(noTools.ok, false);
  if (!noTools.ok) assert.equal(noTools.code, "OUTPUT_TOOL_CONTEXT_MISSING");

  // 引用未随行映射的编号（claimReferences 缺失该键）。
  const unmapped = loopValidation("距离最远的一次是 8 月 15 日。", ["claim:loop:9:1"]);
  assert.equal(unmapped.ok, false);
  if (!unmapped.ok) assert.equal(unmapped.code, "OUTPUT_CLAIM_INVALID");

  // 编造数字：60 不在任何工具结果白名单或用户原句中。
  const inventedNumber = loopValidation("距离最远的那次骑行共 60.0 公里。", ["claim:loop:1:1"]);
  assert.equal(inventedNumber.ok, false);
  if (!inventedNumber.ok) assert.equal(inventedNumber.code, "OUTPUT_NUMERIC_UNSUPPORTED");

  // 编造日期：8 月 19 日不在命中记录的日期标签中。
  const inventedDate = loopValidation("8月19日那次骑行距离 55.0 公里。", ["claim:loop:1:1"]);
  assert.equal(inventedDate.ok, false);
  if (!inventedDate.ok) assert.equal(inventedDate.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

test("autonomous_tools accepts find_ride threshold, window and match-count numbers (CHAT-17)", () => {
  const thresholdFindRide: ChatToolResult = {
    schemaVersion: "chat-tools-v0.2",
    tool: "find_ride",
    rideId: "anchor-ride",
    windowDays: 30,
    metric: "avgHeartRateBpm",
    mode: "threshold",
    threshold: 150,
    status: "matched",
    reasonCodes: [],
    candidateCount: 3,
    matchedCount: 2,
    matches: [{ rideId: "hr-151", rideDateLabel: "2026年8月11日", claims: [{ claimId: "claim:find:hr-151:avgHeartRateBpm", metricKey: "avgHeartRateBpm", value: 151, unit: "bpm", displayValue: "151" }] }],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
  const result = validateChatOutput(output({ route: "autonomous_tools", reply: "最近 30 天内平均心率超过 150 的骑行有 2 次，最近一次是8月11日，心率 151 bpm。", claimIds: ["claim:loop:1:1"], capabilityKeys: [] }), {
    decision: classifyChatInput("最近的骑行中，哪次平均心率超过了120？"),
    loopToolResults: [thresholdFindRide],
    claimReferences: { "claim:loop:1:1": "claim:find:hr-151:avgHeartRateBpm" },
    userText: "最近的骑行中，哪次平均心率超过了120？",
  });
  assert.equal(result.ok, true);
});

test("contextual clarification requires its typed question contract, empty evidence and supported numbers", () => {
  const decision = makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", 4);
  const output = { schemaVersion: "ride-chat-output-v0.3", route: "autonomous_tools", responseKind: "clarification", reply: "你想调整哪个目标？", claimIds: [], capabilityKeys: [], knowledgeIds: [] };
  assert.equal(validateChatOutput(JSON.stringify(output), { decision }).ok, true);
  assert.equal(validateChatOutput(JSON.stringify({ ...output, reply: "你的目标是什么？也可以在信息卡填写。" }), { decision }).ok, true);
  for (const override of [{ reply: "已经完成目标修改。" }, { reply: "要改成99999吗？" }, { responseKind: "answer" }, { claimIds: ["claim:loop:1:1"] }, { responseKind: "confirm_write" }])
    assert.equal(validateChatOutput(JSON.stringify({ ...output, ...override }), { decision }).ok, false);
});
