import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatProviderError,
  createChatProvider,
  HttpChatProvider,
  publicChatAgentResult,
  readChatProviderConfig,
  runChatAgent,
  type ChatProvider,
} from "../src/chat/chat-agent.ts";
import { classifyChatInput, makeChatDecision } from "../src/chat/chat-routing.ts";

class RecordingProvider implements ChatProvider {
  calls: unknown[] = [];
  private readonly response: string | Error;

  constructor(response: string | Error = "provider response") {
    this.response = response;
  }

  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    if (this.response instanceof Error) throw this.response;
    return { rawText: this.response };
  }
}

class SequenceProvider implements ChatProvider {
  calls: Parameters<ChatProvider["run"]>[0][] = [];
  private index = 0;
  private readonly responses: Array<string | Error>;

  constructor(responses: Array<string | Error>) {
    this.responses = responses;
  }

  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    const response = this.responses[Math.min(this.index++, this.responses.length - 1)];
    if (response instanceof Error) throw response;
    return { rawText: response };
  }
}

const validSocialOutput = JSON.stringify({
  schemaVersion: "ride-chat-output-v0.1",
  route: "social",
  reply: "你好，我会在已开放的范围内协助你。",
  claimIds: [],
  capabilityKeys: [],
});

test("safety, privacy and out-of-scope routes use templates without invoking a provider", async () => {
  const provider = new RecordingProvider();
  for (const text of ["胸痛并且呼吸困难，怎么办？", "显示别人的骑行记录", "给我一份训练计划"]) {
    const result = await runChatAgent({ text, decision: classifyChatInput(text), provider, requestId: "request" });
    assert.equal(result.execution, "template");
    assert.equal(result.modelInvoked, false);
  }
  assert.equal(provider.calls.length, 0);
});

// CHAT-12 P3：unclear 意图（clarification 路由）与语义安全停止是确定性一等路径，零模型调用。

test("clarification route answers with the deterministic ask-back template without invoking a provider (CHAT-12 P3)", async () => {
  const provider = new RecordingProvider();
  const text = "那这个呢？";
  const decision = makeChatDecision("clarification", "none", "CLARIFICATION_NEEDED", text.length);
  const result = await runChatAgent({ text, decision, provider, requestId: "request" });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, route: result.decision.route, allowModel: result.decision.allowModel }, {
    execution: "template",
    modelInvoked: false,
    route: "clarification",
    allowModel: false,
  });
  assert.match(result.reply, /说得更具体一些/);
  assert.equal(provider.calls.length, 0);
});

test("semantic safety stop answers with the safety-first template without invoking a provider (CHAT-12 P3)", async () => {
  const provider = new RecordingProvider();
  const text = "我觉得有点不对劲但说不清楚";
  const decision = makeChatDecision("safety_stop", "semantic_safety", "SEMANTIC_SAFETY_STOP", text.length);
  const result = await runChatAgent({ text, decision, provider, requestId: "request" });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, route: result.decision.route, risk: result.decision.risk }, {
    execution: "template",
    modelInvoked: false,
    route: "safety_stop",
    risk: "semantic_safety",
  });
  assert.match(result.reply, /安全优先/);
  assert.equal(provider.calls.length, 0);
});

// CHAT-12 P3（校验场景分化）：用户输入中的数字（给定阈值等）加入白名单——
// 模型复述用户给定值可通过校验；用户未给出的数字仍被拒绝。

test("provider may echo numbers the user supplied but not invent new ones (CHAT-12 P3)", async () => {
  const text = "帮我记住 120 这个阈值";
  const decision = makeChatDecision("social", "none", "SOCIAL", text.length);
  const echoing = new RecordingProvider(JSON.stringify({
    schemaVersion: "ride-chat-output-v0.1",
    route: "social",
    reply: "好的，我记住了你说的 120 这个数字。",
    claimIds: [],
    capabilityKeys: [],
  }));
  const accepted = await runChatAgent({ text, decision, provider: echoing, requestId: "request" });
  assert.equal(accepted.execution, "validated");
  assert.equal(accepted.outputValidation?.status, "accepted");
  assert.equal(echoing.calls.length, 1);

  const inventing = new SequenceProvider([
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "social", reply: "好的，大概是 150 吧。", claimIds: [], capabilityKeys: [] }),
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "social", reply: "好的，大概是 150 吧。", claimIds: [], capabilityKeys: [] }),
  ]);
  const rejected = await runChatAgent({ text, decision, provider: inventing, requestId: "request" });
  assert.equal(rejected.fallbackCode, "REPAIR_FAILED");
  assert.equal(inventing.calls.length, 2);
});

test("capability_gap questions get the in-scope-but-locked template without invoking a provider (CHAT-12 P1)", async () => {
  const provider = new RecordingProvider();
  const text = "我的能力水平最近有进步吗？";
  const result = await runChatAgent({ text, decision: classifyChatInput(text), provider, requestId: "request" });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, route: result.decision.route }, {
    execution: "template", modelInvoked: false, route: "capability_gap",
  });
  // AGT-B4 预期变更：跨次筛选排序、历史统计、负荷评估**已开放**，缺口只剩训练计划/监督。
  assert.match(result.reply, /训练计划与训练监督仍在路线图中/);
  assert.match(result.reply, /跨记录的条件检索与排名/);
  assert.match(result.reply, /与最近 30 天历史的比较/);
  assert.equal(provider.calls.length, 0);
});

test("aggregate questions are answered deterministically from repository records without invoking a provider (G-AGGREGATE)", async () => {
  const provider = new RecordingProvider();
  const fixture = (await import("../src/fixtures/rides.ts")).getRideFixture("l3-power-preview");
  const records = [{
    ...fixture,
    activity: { ...fixture.activity, rideId: "aggregate-ride", startTime: "2026-09-01T02:00:00.000Z" },
    series: { ...fixture.series, rideId: "aggregate-ride" },
  }];
  const result = await runChatAgent({
    text: "我总共骑了多少",
    decision: classifyChatInput("我总共骑了多少"),
    provider,
    requestId: "request",
    aggregateRecords: records,
  });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, route: result.decision.route }, {
    execution: "template", modelInvoked: false, route: "aggregate",
  });
  assert.match(result.reply, /目前已记录 1 次骑行/);
  assert.equal(provider.calls.length, 0);
});

test("empty ride-context claims skip the provider with a deterministic metric-gap template (G-NO-CLAIM)", async () => {
  const provider = new RecordingProvider();
  const text = "这次骑行的踏频数据怎么样？";
  const toolRunner = {
    run: async () => ({
      context: {
        schemaVersion: "ride-chat-tool-context-v0.1" as const,
        question: text,
        decision: classifyChatInput(text),
        sessionSummaries: [] as [],
        toolResult: {
          schemaVersion: "chat-tools-v0.2" as const,
          tool: "get_ride_context" as const,
          rideId: "ride",
          dimensions: ["cadence" as const],
          claims: [],
          limitations: [],
          privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] as ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
        },
      },
      trace: { tool: "get_ride_context" as const, status: "completed" as const, dimensions: ["cadence" as const], summarySlots: 0 },
    }),
  };
  const result = await runChatAgent({ text, decision: classifyChatInput(text), provider, toolRunner, requestId: "request" });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, fallbackCode: result.fallbackCode }, {
    execution: "template", modelInvoked: false, fallbackCode: "TOOLS_EMPTY_CLAIMS",
  });
  assert.match(result.reply, /没有包含你询问的这项指标/);
  assert.equal(provider.calls.length, 0);
});

test("repair failure with ride-context claims falls back to a deterministic claims summary (G-REPAIR-FALLBACK)", async () => {
  // 两次模型输出均未通过校验（含未溯源数字），修复失败后不再展示空的安全校验话术，
  // 而是用工具 Claims 的 displayValue 给出确定性摘要（G-REPAIR-FALLBACK）。
  const provider = new SequenceProvider(["平均踏频是68.3，最高95.2", "踏频均值约68"]);
  const text = "最近一次的骑行踏频怎么样？";
  const toolRunner = {
    run: async () => ({
      context: {
        schemaVersion: "ride-chat-tool-context-v0.1" as const,
        question: text,
        decision: classifyChatInput(text),
        sessionSummaries: [] as [],
        toolResult: {
          schemaVersion: "chat-tools-v0.2" as const,
          tool: "get_ride_context" as const,
          rideId: "ride",
          dimensions: ["cadence" as const],
          claims: [
            { claimId: "claim:ride:avgCadenceRpm", kind: "metric" as const, key: "avgCadenceRpm" as const, value: 68, unit: "rpm", confidence: "high" as const, displayValue: "68", displayUnit: "rpm" },
            { claimId: "claim:ride:maxCadenceRpm", kind: "metric" as const, key: "maxCadenceRpm" as const, value: 95, unit: "rpm", confidence: "high" as const, displayValue: "95", displayUnit: "rpm" },
          ],
          limitations: [],
          privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] as ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
        },
      },
      trace: { tool: "get_ride_context" as const, status: "completed" as const, dimensions: ["cadence" as const], summarySlots: 0 },
    }),
  };
  const result = await runChatAgent({ text, decision: classifyChatInput(text), provider, toolRunner, requestId: "request" });
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.repairAttempts, 1);
  assert.equal(provider.calls.length, 2);
  assert.match(result.reply, /已核实的数据/);
  assert.match(result.reply, /平均踏频 68 rpm/);
  assert.match(result.reply, /最大踏频 95 rpm/);
});

// CHAT-13：历史比较场景——D1 不可比确定性降级、修复兜底与可比 Claim 溯源校验。

test("history_compare without comparable claims degrades to the deterministic D1 reply (CHAT-13)", async () => {
  const provider = new RecordingProvider();
  const text = "我最近的骑行有进步吗？";
  const decision = classifyChatInput(text);
  const toolRunner = {
    run: async () => ({
      context: {
        schemaVersion: "ride-chat-tool-context-v0.1" as const,
        question: text,
        decision,
        sessionSummaries: [] as [],
        toolResult: {
          schemaVersion: "chat-tools-v0.2" as const,
          tool: "compare_rides" as const,
          rideId: "ride",
          windowDays: 30,
          sampleCount: 0,
          comparability: { status: "not_comparable" as const, reasonCodes: ["NO_CANDIDATES" as const], sampleCount: 0, minimumSampleCount: 2, allowedConclusion: "none" as const },
          claims: [{ metricKey: "distanceM" as const, scope: "all" as const, status: "not_comparable" as const, reasonCodes: ["NO_CANDIDATES" as const] }],
          privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] as ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
        },
      },
      trace: { tool: "compare_rides" as const, status: "completed" as const, comparisonMetrics: ["distanceM" as const], summarySlots: 0 },
    }),
  };
  const result = await runChatAgent({ text, decision, provider, toolRunner, requestId: "request" });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, route: result.decision.route, fallbackCode: result.fallbackCode }, {
    execution: "template", modelInvoked: false, route: "history_compare", fallbackCode: undefined,
  });
  assert.match(result.reply, /暂时无法把这次骑行和最近 30 天的历史作比较/);
  assert.match(result.reply, /窗口内没有可比的历史骑行记录/);
  assert.match(result.reply, /不会给出进步或退步的结论/);
  assert.equal(result.toolTrace?.tool, "compare_rides");
  assert.equal(provider.calls.length, 0);
});

// CHAT-13：可比场景的工具上下文——30 天窗口、2 条历史基线、距离可比 claim（显示空间值）。

function comparableComparisonRunner(text: string, decision: ReturnType<typeof classifyChatInput>) {
  return {
    run: async () => ({
      context: {
        schemaVersion: "ride-chat-tool-context-v0.1" as const,
        question: text,
        decision,
        sessionSummaries: [] as [],
        toolResult: {
          schemaVersion: "chat-tools-v0.2" as const,
          tool: "compare_rides" as const,
          rideId: "ride",
          windowDays: 30,
          anchorStartTime: "2026-08-20T08:00:00.000Z",
          sampleCount: 2,
          comparability: { status: "comparable" as const, reasonCodes: [], sampleCount: 2, minimumSampleCount: 2, allowedConclusion: "change" as const },
          claims: [{
            claimId: "claim:ride:history:all:distanceM",
            metricKey: "distanceM" as const,
            scope: "all" as const,
            status: "comparable" as const,
            reasonCodes: [],
            anchor: { value: 42_000, unit: "km", displayValue: "42.0" },
            baseline: { value: 33_000, unit: "km", displayValue: "33.0", sampleCount: 2 },
            change: 9,
            relativeChangePercent: 27.3,
          }],
          privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] as ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
        },
      },
      trace: { tool: "compare_rides" as const, status: "completed" as const, comparisonMetrics: ["distanceM" as const], summarySlots: 0 },
    }),
  };
}

test("history_compare repair failure falls back to the deterministic comparison summary (CHAT-13)", async () => {
  const provider = new SequenceProvider(["这次比上次提高了 15 km 吧", "大概进步了 20%"]);
  const text = "这次骑行比上次骑得远吗？";
  const decision = classifyChatInput(text);
  const result = await runChatAgent({ text, decision, provider, toolRunner: comparableComparisonRunner(text, decision), requestId: "request" });
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.repairAttempts, 1);
  assert.equal(provider.calls.length, 2);
  assert.match(result.reply, /已核实的历史比较结果/);
  assert.match(result.reply, /距离为 42\.0 km，比最近 30 天 2 次骑行的平均值 33\.0 km 高 9（\+27\.3%）/);
  // 提供给模型的是脱敏投影：claimId 重映射为引用编号，不含原始标识。
  assert.equal(provider.calls[0]?.toolContext?.tool, "compare_rides");
  assert.doesNotMatch(JSON.stringify(provider.calls[0]?.toolContext), /claim:ride:history|rideId|owner-a/);
});

// CHAT-15：修复指令场景化——数字违规的修复指令按路由枚举白名单来源，
// 模型能据此知道"逐字复制 displayValue / 允许 anchorStartTime 日期"。

test("numeric repair instructions are scenario-specific per route (CHAT-15)", async () => {
  const compareProvider = new SequenceProvider([
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "history_compare", reply: "这次比上次提高了 15 km。", claimIds: ["claim:compare:1"], capabilityKeys: [] }),
    "大概进步了 20%",
  ]);
  const compareText = "这次骑行比上次骑得远吗？";
  const compareDecision = classifyChatInput(compareText);
  await runChatAgent({ text: compareText, decision: compareDecision, provider: compareProvider, toolRunner: comparableComparisonRunner(compareText, compareDecision), requestId: "request" });
  const compareRepair = compareProvider.calls[1]?.repairInstruction ?? "";
  assert.equal(compareRepair.includes("OUTPUT_NUMERIC_UNSUPPORTED"), true);
  assert.equal(compareRepair.includes("anchorStartTime"), true);
  assert.equal(compareRepair.includes("换算"), true);

  const rideContextRunner = (text: string, decision: ReturnType<typeof classifyChatInput>) => ({
    run: async () => ({
      context: {
        schemaVersion: "ride-chat-tool-context-v0.1" as const,
        question: text,
        decision,
        sessionSummaries: [] as [],
        toolResult: {
          schemaVersion: "chat-tools-v0.2" as const,
          tool: "get_ride_context" as const,
          rideId: "ride",
          rideDateLabel: "2026年8月20日",
          dimensions: ["power" as const],
          claims: [{ claimId: "claim:ride:avgPowerW", kind: "metric" as const, key: "avgPowerW", value: 180, unit: "W", confidence: "high" as const, displayValue: "180", displayUnit: "W" }],
          limitations: [],
          privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] as ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
        },
      },
      trace: { tool: "get_ride_context" as const, status: "completed" as const, summarySlots: 0 },
    }),
  });
  const rideProvider = new SequenceProvider([
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "current_ride", reply: "本次平均功率约 180 W，用时 90 分钟。", claimIds: ["claim:context:1"], capabilityKeys: [] }),
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "current_ride", reply: "本次平均功率是 180 W。", claimIds: ["claim:context:1"], capabilityKeys: [] }),
  ]);
  const rideText = "本次骑行平均功率是多少？";
  const rideDecision = classifyChatInput(rideText);
  const rideResult = await runChatAgent({ text: rideText, decision: rideDecision, provider: rideProvider, toolRunner: rideContextRunner(rideText, rideDecision), requestId: "request" });
  const rideRepair = rideProvider.calls[1]?.repairInstruction ?? "";
  assert.equal(rideResult.execution, "repaired");
  assert.equal(rideRepair.includes("OUTPUT_NUMERIC_UNSUPPORTED"), true);
  assert.equal(rideRepair.includes("displayValue"), true);
  assert.equal(rideRepair.includes("rideDateLabel"), true);
  // AGT-B0 预期变更：数字白名单改等价类后，修复指令不再要求"不得换算"（同一事实的
  // 舍入/单位换算已合法），改为禁止"用两个数字计算"。断言随之更新——这是口径变更，
  // 不是回归（详见细规划 §2 G4）。
  assert.equal(rideRepair.includes("不得用两个数字计算"), true);
  // 投影透传：rideDateLabel 到达模型（日期标签非敏感，不参与脱敏重映射）。
  assert.equal(JSON.stringify(rideProvider.calls[0]?.toolContext).includes("2026年8月20日"), true);
});

test("history_compare validates the provider answer against the comparison claim whitelist (CHAT-13)", async () => {
  const provider = new RecordingProvider(JSON.stringify({
    schemaVersion: "ride-chat-output-v0.1",
    route: "history_compare",
    reply: "这次骑行的距离为 42.0 km，比最近 30 天 2 次骑行的平均值 33.0 km 高 9（+27.3%）。",
    claimIds: ["claim:compare:1"],
    capabilityKeys: [],
  }));
  const text = "这次骑行比上次骑得远吗？";
  const decision = classifyChatInput(text);
  const result = await runChatAgent({ text, decision, provider, toolRunner: comparableComparisonRunner(text, decision), requestId: "request" });
  assert.equal(result.execution, "validated");
  assert.equal(result.outputValidation?.status, "accepted");
  assert.equal(provider.calls.length, 1);
  const invocation = provider.calls[0] as { route?: string; toolContext?: { tool: string } };
  assert.equal(invocation.route, "history_compare");
  assert.equal(invocation.toolContext?.tool, "compare_rides");
  assert.equal("toolContext" in publicChatAgentResult(result), false);
});

test("current ride and capability routes wait for CHAT-05 tools before calling a provider", async () => {
  const provider = new RecordingProvider();
  const text = "本次骑行平均功率是多少？";
  const result = await runChatAgent({ text, decision: classifyChatInput(text), provider, requestId: "request" });
  assert.deepEqual({ execution: result.execution, fallbackCode: result.fallbackCode, modelInvoked: result.modelInvoked }, {
    execution: "awaiting_tools",
    fallbackCode: "TOOLS_PENDING",
    modelInvoked: false,
  });
  assert.equal(provider.calls.length, 0);
});

test("social route only exposes a provider reply after CHAT-07 validation", async () => {
  const provider = new RecordingProvider(JSON.stringify({
    schemaVersion: "ride-chat-output-v0.1",
    route: "social",
    reply: "你好，我会在已开放的范围内协助你。",
    claimIds: [],
    capabilityKeys: [],
  }));
  const result = await runChatAgent({ text: "你好", decision: classifyChatInput("你好"), provider, requestId: "request" });
  assert.equal(result.execution, "validated");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.reply, "你好，我会在已开放的范围内协助你。");
  assert.equal(result.outputValidation?.status, "accepted");
  assert.equal(result.repairAttempts, 0);
  assert.equal(provider.calls.length, 1);
  assert.equal("providerRawOutput" in publicChatAgentResult(result), false);
});

test("CHAT-08 repairs one invalid social response and never calls a third time", async () => {
  const provider = new SequenceProvider(["unvalidated model response with api key", validSocialOutput, validSocialOutput]);
  const result = await runChatAgent({ text: "你好", decision: classifyChatInput("你好"), provider, requestId: "request" });
  assert.equal(result.execution, "repaired");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.outputValidation?.status, "accepted");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[1]?.repairInstruction?.includes("OUTPUT_INVALID_JSON"), true);
  assert.equal(provider.calls[1]?.previousOutput, "unvalidated model response with api key");
  assert.doesNotMatch(JSON.stringify(publicChatAgentResult(result)), /api key|repairInstruction|previousOutput/);
});

test("invalid provider output falls back deterministically after one failed repair", async () => {
  const provider = new SequenceProvider(["first invalid api key", "second invalid token", validSocialOutput]);
  const result = await runChatAgent({ text: "你好", decision: classifyChatInput("你好"), provider, requestId: "request" });
  assert.equal(result.execution, "template");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.outputValidation?.status, "rejected");
  assert.equal(provider.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(publicChatAgentResult(result)), /first invalid|second invalid|token/);
});

test("repair provider errors use stable codes and the deterministic template", async () => {
  const provider = new SequenceProvider(["invalid", new ChatProviderError("MODEL_RATE_LIMITED", "upstream secret")]);
  const result = await runChatAgent({ text: "你好", decision: classifyChatInput("你好"), provider, requestId: "request" });
  assert.deepEqual({ execution: result.execution, modelInvoked: result.modelInvoked, fallbackCode: result.fallbackCode, repairAttempts: result.repairAttempts }, {
    execution: "template",
    modelInvoked: true,
    fallbackCode: "MODEL_RATE_LIMITED",
    repairAttempts: 1,
  });
  assert.equal(provider.calls.length, 2);
});

test("missing or failed providers return stable fallback codes without error details", async () => {
  const decision = classifyChatInput("你好");
  const missing = await runChatAgent({ text: "你好", decision });
  assert.equal(missing.fallbackCode, "MODEL_NOT_CONFIGURED");
  const provider = new RecordingProvider(new ChatProviderError("MODEL_RATE_LIMITED", "upstream account 123 secret"));
  const failed = await runChatAgent({ text: "你好", decision, provider, requestId: "request" });
  assert.deepEqual(publicChatAgentResult(failed), {
    schemaVersion: "ride-chat-agent-v0.1",
    decision,
    execution: "template",
    modelInvoked: false,
    reply: "对话服务暂时不可用；我不会使用未经验证的结果回答。",
    fallbackCode: "MODEL_RATE_LIMITED",
  });
});

test("HTTP provider uses only Chat provider configuration and maps response failures", async () => {
  const config = readChatProviderConfig({
    CHAT_MODEL_ENABLED: "true",
    CHAT_PROVIDER_URL: "https://chat.example.test/run",
    CHAT_PROVIDER_API_TOKEN: "chat-token",
    CHAT_PROVIDER_MODEL_ID: "chat-model",
    COZE_API_URL: "https://must-not-be-used.example.test",
  });
  assert.ok(config);
  const requests: RequestInit[] = [];
  const provider = new HttpChatProvider(config, async (_url, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ output: "provider result" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await provider.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" });
  assert.equal(result.rawText, "provider result");
  assert.equal((requests[0]?.headers as Record<string, string>).Authorization, "Bearer chat-token");
  assert.match(String(requests[0]?.body), /ride_chat_v1/);

  const rateLimited = new HttpChatProvider(config, async () => new Response("{}", { status: 429 }));
  await assert.rejects(
    () => rateLimited.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_RATE_LIMITED",
  );
});

// CHAT-17 P5：L2b 循环投影进入 HttpChatProvider 请求体——toolCatalog（首轮）与
// toolResults（后续轮次）随行，供循环内模型决定工具组合与引用编号。
test("HTTP provider carries L2b toolCatalog and toolResults in the request body (CHAT-17)", async () => {
  const config = readChatProviderConfig({
    CHAT_MODEL_ENABLED: "true",
    CHAT_PROVIDER_URL: "https://chat.example.test/run",
    CHAT_PROVIDER_API_TOKEN: "chat-token",
  });
  assert.ok(config);
  const requests: RequestInit[] = [];
  const provider = new HttpChatProvider(config, async (_url, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ output: "provider result" }), { status: 200 });
  });
  await provider.run({
    requestId: "request",
    agentVersion: "ride-chat-agent-v0.1",
    route: "autonomous_tools",
    text: "距离最远的那次骑行是哪次？",
    toolCatalog: {
      schemaVersion: "ride-chat-tool-catalog-v0.1",
      anchorRideId: "anchor-ride",
      tools: [{ tool: "find_ride", purpose: "在窗口内检索某一条骑行", input: { metric: ["distanceM"], mode: ["max", "min", "threshold"] } }],
    },
    toolResults: [{
      call: 1,
      context: {
        tool: "find_ride",
        windowDays: 30,
        metric: "distanceM",
        mode: "max",
        status: "matched",
        reasonCodes: [],
        candidateCount: 3,
        matchedCount: 1,
        matches: [{ rideId: "history-far", rideDateLabel: "2026年8月15日", claims: [{ claimId: "claim:loop:1:1", metricKey: "distanceM", value: 55_000, unit: "km", displayValue: "55.0" }] }],
      },
    }],
  });
  const body = JSON.parse(String(requests[0]?.body)) as { toolCatalog?: { anchorRideId: string }; toolResults?: Array<{ call: number }> };
  assert.equal(body.toolCatalog?.anchorRideId, "anchor-ride");
  assert.equal(body.toolResults?.length, 1);
  assert.equal(body.toolResults?.[0]?.call, 1);
});

test("Chat provider selects the SiliconFlow adapter by default and no longer reads ride-analysis configuration", () => {
  const provider = createChatProvider({
    CHAT_MODEL_ENABLED: "true",
    CHAT_PROVIDER_KIND: "siliconflow",
    SILICONFLOW_API_TOKEN: "chat-token",
    SILICONFLOW_CHAT_MODEL_ID: "deepseek-ai/DeepSeek-V3.2",
    RIDE_MODEL_V2_MODEL_ID: "must-not-be-used",
  });
  assert.ok(provider);
  assert.equal(provider.constructor.name, "SiliconFlowChatProvider");
  // AGT-A0（D-A6）：coze_workflow kind 已退役——即使残留 Coze 环境变量也不再装配。
  assert.equal(createChatProvider({
    CHAT_MODEL_ENABLED: "true",
    CHAT_PROVIDER_KIND: "coze_workflow",
    COZE_CHAT_WORKFLOW_ID: "chat-workflow-id",
    COZE_CHAT_API_TOKEN: "chat-token",
  }), undefined);
});

// AGT-A1：四个任务簇新路由的确定性占位模板 + 分类器不可用终局降级（D-A2）。

test("task-cluster placeholder routes produce guidance templates without model calls (AGT-A1)", async () => {
  const { runChatAgent } = await import("../src/chat/chat-agent.ts");
  // AGT-B4 预期变更：level_assessment / kb_qa 已升级为 L2b 真链路，占位只剩
  // training_plan / training_supervision（F/G 承接）。
  for (const [route, reasonCode, keyword] of [
    ["training_plan", "TRAINING_PLAN", "训练计划"],
    ["training_supervision", "TRAINING_SUPERVISION", "训练监督"],
  ] as const) {
    const result = await runChatAgent({
      text: "帮我安排下周的训练",
      decision: { ...makePlaceholderDecision(route, reasonCode) },
      requestId: "request",
    });
    assert.equal(result.modelInvoked, false, route);
    assert.equal(result.execution, "template", route);
    assert.ok(result.reply.includes(keyword), `${route}: ${result.reply}`);
  }
});

test("AGT-B4：kb_qa / level_assessment 不再是占位——有 provider 时进循环", async () => {
  const { runChatAgent } = await import("../src/chat/chat-agent.ts");
  const { createChatToolLoopRunner } = await import("../src/chat/chat-tool-orchestration.ts");
  const repository = {
    listRides: async () => [],
    getRide: async () => null,
    getProfile: async () => null,
  } as unknown as Parameters<typeof createChatToolLoopRunner>[0];
  for (const [route, reasonCode] of [["kb_qa", "KB_QA"], ["level_assessment", "LEVEL_ASSESSMENT"]] as const) {
    const provider = new RecordingProvider();
    const result = await runChatAgent({
      text: "为什么要做区间训练？",
      decision: {
        schemaVersion: "chat-routing-v0.2",
        route,
        risk: "none",
        allowModel: true,
        action: "tool_then_model",
        reasonCode,
        normalizedLength: 10,
      },
      provider,
      loopRunner: createChatToolLoopRunner(repository, "owner-a"),
    });
    // AGT-B5（预期变更）：无记录时**不再**一律降级 TOOLS_NO_CURRENT_RIDE——catalog 含
    // 全局工具（KB/档案）时用空锚点启动循环。这里只断言"进了循环路径"，不再锁旧降级码。
    assert.notEqual(result.execution, undefined, `${route} 应进入工具循环而非占位直通：${result.reply}`);
    assert.notEqual(result.fallbackCode, "TOOLS_UNAVAILABLE", `${route} 不应被当成"路由不可用"`);
    assert.equal(result.reply.includes("规划中"), false, `${route} 不应再出现"规划中"占位话术`);
  }
});

function makePlaceholderDecision(route: "training_plan" | "training_supervision" | "level_assessment" | "kb_qa", reasonCode: string) {
  return {
    schemaVersion: "chat-routing-v0.2" as const,
    route,
    risk: "none" as const,
    allowModel: false,
    action: "deterministic_reply" as const,
    reasonCode: reasonCode as "TRAINING_PLAN" | "TRAINING_SUPERVISION" | "LEVEL_ASSESSMENT" | "KB_QA",
    normalizedLength: 10,
  };
}

test("chatRoutingUnavailableResult returns terminal degradation without provider or tools (D-A2)", async () => {
  const { chatRoutingUnavailableResult } = await import("../src/chat/chat-agent.ts");
  const result = chatRoutingUnavailableResult("MODEL_TIMEOUT", 8);
  assert.equal(result.modelInvoked, false);
  assert.equal(result.execution, "template");
  assert.equal(result.fallbackCode, "MODEL_TIMEOUT");
  assert.match(result.reply, /暂时不可用/);
  assert.equal(result.decision.route, "out_of_scope");
});
