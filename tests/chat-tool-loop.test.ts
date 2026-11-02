import assert from "node:assert/strict";
import test from "node:test";

import { publicChatAgentResult, runChatAgent, type ChatProvider } from "../src/chat/chat-agent.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import { classifyChatInput, makeChatDecision } from "../src/chat/chat-routing.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";

// CHAT-17 P3：L2b 自主工具循环——模型在只读工具白名单与既有预算内自行组合调用工具
// （find_ride 首场景）。覆盖：单检索成功、组合调用（find_ride → get_ride_context
// 越权锚点扩展）、预算耗尽、白名单外工具拒绝、越权锚点拒绝、检索无命中零模型降级、
// 修复失败确定性摘要兜底、startLoop 失败与锚点澄清。

function privateRecord(fixtureId: string, rideId: string) {
  const fixture = getRideFixture(fixtureId);
  return {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

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

// 本人记录集：anchor-ride（最新，42km）+ history-far（55km，2026-08-15）+ history-short（30km）。
function loopRecords() {
  return {
    "history-short": comparisonRecord("l3-fit-power", "history-short", "2026-08-10T08:00:00Z", 30),
    "history-far": comparisonRecord("l3-fit-power", "history-far", "2026-08-15T08:00:00Z", 55),
    "anchor-ride": comparisonRecord("l3-fit-power", "anchor-ride", "2026-08-20T08:00:00Z", 42),
  };
}

function loopRepository(records: Record<string, ReturnType<typeof privateRecord>>, rideIds: readonly string[]) {
  return {
    listRides: async (ownerId: string) => ownerId === "owner-a"
      ? rideIds.map((rideId) => ({ record: records[rideId]!, storedAt: "2026-09-05T00:00:00.000Z" }))
      : [],
    getRide: async (ownerId: string, rideId: string) => ownerId === "owner-a" ? records[rideId] ?? null : null,
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
}

class SequenceProvider implements ChatProvider {
  calls: Parameters<ChatProvider["run"]>[0][] = [];
  private index = 0;
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    return { rawText: this.responses[Math.min(this.index++, this.responses.length - 1)]! };
  }
}

function toolCallRequest(tool: string, input: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool, input }] });
}

function finalAnswer(reply: string, claimIds: string[]): string {
  return JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "autonomous_tools", reply, claimIds, capabilityKeys: [] });
}

async function runLoop(provider: ChatProvider, repository: ApplicationRepository, text: string) {
  return await runChatAgent({
    text,
    decision: classifyChatInput(text),
    provider,
    toolRunner: undefined,
    loopRunner: createChatToolLoopRunner(repository, "owner-a"),
  });
}

test("L2b loop answers a find_ride question via tool call then validated final answer (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  const provider = new SequenceProvider([
    toolCallRequest("find_ride", { metric: "distanceM", mode: "max" }),
    finalAnswer("距离最远的是8月15日那次骑行，共 55.0 公里。", ["claim:loop:1:1"]),
  ]);
  const text = "距离最远的那次骑行是哪次？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.decision.route, "autonomous_tools");
  assert.equal(result.execution, "validated");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.reply, "距离最远的是8月15日那次骑行，共 55.0 公里。");
  assert.equal(result.outputValidation?.status, "accepted");
  // 轨迹：1 次工具调用、2 次模型调用（工具请求 + 最终回答）。
  assert.equal(result.loopTrace?.status, "completed");
  assert.equal(result.loopTrace?.toolCalls, 1);
  assert.equal(result.loopTrace?.providerCalls, 2);
  assert.deepEqual(result.loopTrace?.steps.map((step) => [step.tool, step.status]), [["find_ride", "completed"]]);
  // 首轮随行工具目录（白名单 + 锚点，无用户数据）；次轮回传脱敏工具结果（claim:loop:<call>:<n>）。
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]!.toolCatalog?.anchorRideId, "");
  assert.ok(provider.calls[0]!.toolCatalog!.tools.some((tool) => tool.tool === "find_ride"));
  assert.equal(provider.calls[0]!.toolResults, undefined);
  const second = provider.calls[1]!.toolResults?.[0];
  assert.equal(second?.call, 1);
  assert.ok(second && second.context.tool === "find_ride");
  assert.equal(second.context.matches[0]?.claims[0]?.claimId, "claim:loop:1:1");
  // 公开结果脱敏：不含 owner 标识。
  assert.equal(JSON.stringify(publicChatAgentResult(result)).includes("owner-a"), false);
});

test("L2b loop composes find_ride then get_ride_context on the returned rideId (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  // 组合调用：检索距离最远 → 用返回的 rideId 追问该记录上下文 → 最终回答引用第 2 次调用的 Claims。
  const provider = new SequenceProvider([
    toolCallRequest("find_ride", { metric: "distanceM", mode: "max" }),
    toolCallRequest("get_ride_context", { rideId: "history-far", dims: ["summary"] }),
    finalAnswer("8月15日那次骑行距离 55.0 公里。", ["claim:loop:2:1"]),
  ]);
  const text = "距离最远的那次骑行平均心率怎么样？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.execution, "validated");
  assert.equal(result.reply, "8月15日那次骑行距离 55.0 公里。");
  assert.equal(result.loopTrace?.status, "completed");
  assert.equal(result.loopTrace?.toolCalls, 2);
  assert.equal(result.loopTrace?.providerCalls, 3);
  assert.deepEqual(result.loopTrace?.steps.map((step) => [step.tool, step.status]), [["find_ride", "completed"], ["get_ride_context", "completed"]]);
  // 第 3 次模型调用同时携带两次工具结果的脱敏投影（claim:loop:1:* / claim:loop:2:*）。
  const toolResults = provider.calls[2]!.toolResults ?? [];
  assert.equal(toolResults.length, 2);
  assert.ok(toolResults[0] && toolResults[0].context.tool === "find_ride");
  assert.equal(toolResults[0].context.matches[0]?.claims[0]?.claimId, "claim:loop:1:1");
  assert.ok(toolResults[1] && toolResults[1].context.tool === "get_ride_context");
  assert.equal(toolResults[1].context.claims[0]?.claimId, "claim:loop:2:1");
  assert.equal(JSON.stringify(provider.calls[2]).includes("owner-a"), false);
});

test("L2b loop degrades deterministically when the tool budget is exhausted (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  // AGT-B3 预期变更：累计工具预算 3 → 5（D-B5）。模型每轮只请求 1 次且从不给最终回答：
  // 第 5 次调用用尽累计预算，第 6 轮请求被拒。
  const endlessRequest = toolCallRequest("get_ride_context", { rideRef: { ordinal: -1 } });
  const provider = new SequenceProvider(Array.from({ length: 7 }, () => endlessRequest));
  const text = "哪次骑行距离最远？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.execution, "template");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.fallbackCode, "TOOLS_LOOP_BUDGET_EXHAUSTED");
  assert.equal(result.loopTrace?.status, "budget_exhausted");
  assert.equal(result.loopTrace?.toolCalls, 5);
  assert.equal(result.loopTrace?.providerCalls, 6);
  assert.equal(result.loopTrace?.steps.length, 5);
  assert.ok(result.reply.includes("预算"));
});

test("L2b loop rejects an out-of-whitelist tool call without consuming tool budget (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  const provider = new SequenceProvider([toolCallRequest("delete_ride", {})]);
  const text = "距离最远的那次骑行是哪次？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.execution, "template");
  assert.equal(result.fallbackCode, "TOOLS_LOOP_INVALID_TOOL_CALL");
  assert.equal(result.loopTrace?.status, "invalid_tool_call");
  assert.equal(result.loopTrace?.toolCalls, 0);
  assert.deepEqual(result.loopTrace?.steps, [{ tool: "delete_ride", status: "rejected", errorCode: "INVALID_TOOL_CALL", durationMs: result.loopTrace?.steps[0]?.durationMs }]);
  assert.equal(provider.calls.length, 1);
});

test("L2b loop rejects a model-specified rideId outside the anchor and returned set (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  const provider = new SequenceProvider([toolCallRequest("get_ride_context", { rideId: "not-my-ride" })]);
  const text = "距离最远的那次骑行是哪次？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.fallbackCode, "TOOLS_LOOP_INVALID_TOOL_CALL");
  assert.equal(result.loopTrace?.status, "invalid_tool_call");
  assert.deepEqual(result.loopTrace?.steps.map((step) => step.errorCode), ["RIDE_NOT_ALLOWED"]);
  // 越权调用不触达仓储（getRide 未被调用过越权 rideId）。
  assert.equal(provider.calls.length, 1);
});

test("L2b loop degrades with a deterministic no-match reply on empty search results (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  const provider = new SequenceProvider([
    toolCallRequest("find_ride", { metric: "avgHeartRateBpm", mode: "threshold", threshold: 999 }),
  ]);
  const text = "最近的骑行中，哪次平均心率超过了120？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.execution, "template");
  assert.equal(result.fallbackCode, "TOOLS_LOOP_NO_MATCH");
  assert.equal(result.loopTrace?.status, "no_match");
  // 无命中降级话术由编排层生成（检索轮后零额外模型调用）。
  assert.equal(provider.calls.length, 1);
  assert.equal(result.reply, "最近 30 天内没有找到平均心率超过 999 的骑行记录。");
  assert.equal(result.loopTrace?.toolCalls, 1);
});

test("L2b loop falls back to a claims summary when repair still fails (CHAT-17)", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  const provider = new SequenceProvider([
    toolCallRequest("find_ride", { metric: "distanceM", mode: "max" }),
    "invalid output",
    "still invalid",
  ]);
  const text = "距离最远的那次骑行是哪次？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.execution, "template");
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.repairAttempts, 1);
  // 修复失败兜底：确定性检索摘要（数字全部来自工具 Claims 的 displayValue）。
  assert.equal(result.reply, "这次回复暂时没能通过安全校验，先直接给你已核实的检索结果：2026年8月15日那次骑行的距离为 55.0 km。");
  assert.equal(provider.calls.length, 3);
  assert.equal(provider.calls[2]!.repairInstruction?.includes("OUTPUT_INVALID_JSON"), true);
});

// AGT-B5（预期契约变更，边界集 no_records 3/9 驱动）：旧契约是"无记录 → 零模型降级"，
// 但问知识库原理 / 健康档案是**全局工具**（anchorMode: "none"），不该依赖骑行记录——
// 旧行为让"没有骑行记录的新用户问什么是负分割"直接得到"还没有可供查看的骑行记录"。
// 新契约：该 route 的 catalog 里含全局工具时，用**空锚点**启动循环（要查某次骑行会因
// 空 rideId 被判 INVALID_TOOL_CALL，属合理拒绝）；catalog 全是锚点工具时才降级。
test("L2b startLoop starts with empty anchor when no rides but catalog has anchor-free tools (AGT-B5)", async () => {
  const runner = createChatToolLoopRunner(loopRepository({}, []), "owner-a");
  for (const [route, reasonCode] of [["kb_qa", "KB_QA"], ["autonomous_tools", "AUTONOMOUS_TOOLS"]] as const) {
    const start = await runner.startLoop({ text: "什么是负分割？", decision: makeChatDecision(route, "none", reasonCode, 8) });
    assert.equal(start.ok, true, `${route}：无记录时也应能启动（catalog 含全局工具）`);
    assert.equal(start.ok && start.anchorRideId, "", `${route}：空锚点`);
  }
  // 若 catalog 只有锚点工具（模拟：none 路由没有工具）则仍降级
  const noneRoute = await runner.startLoop({ text: "什么是负分割？", decision: makeChatDecision("training_plan", "none", "TRAINING_PLAN", 8) });
  assert.equal(noneRoute.ok, false);
});

test("L2b loop asks for ride selection only after the model requests an unbound ride tool", async () => {
  const records = loopRecords();
  const repository = loopRepository(records, ["history-short", "history-far", "anchor-ride"]);
  const provider = new SequenceProvider([toolCallRequest("get_ride_context", {})]);
  // 「这次」指涉 + 筛选问法：无继承锚点 → 确定性澄清（零模型调用）。
  const text = "这次骑得最快的那次是哪次？";

  const result = await runLoop(provider, repository, text);

  assert.equal(result.decision.route, "autonomous_tools");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.fallbackCode, "TOOLS_REFERENCE_NEEDED");
  assert.ok(result.reply.length);
  assert.equal(provider.calls.length, 1);
});
