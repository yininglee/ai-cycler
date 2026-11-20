import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runLegacyChatAgent } from "../src/chat/chat-agent.ts";
import { createChatToolLoopRunner, createChatToolRunner } from "../src/chat/chat-tool-orchestration.ts";
import { classifyChatInput } from "../src/chat/chat-routing.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";

type FixedCase = {
  caseId: string;
  input: string;
  fixture?: string;
  expected: { route: string; action?: string; provider?: string; fallbackCode?: string; tool?: string; dimensions?: string[]; loopStatus?: string };
};

const fixedSetFile = new URL("./fixtures/ride-chat-fixed-set-v0.1.json", import.meta.url);
const fixedSet = JSON.parse(await readFile(fixedSetFile, "utf8")) as { datasetId: string; cases: FixedCase[] };

// CHAT-14（固定集 v0.4）：锚点用例需要真实编排链路——同 fixture 三条记录，
// 出发时间最新为 2026-08-20（Asia/Shanghai 日历日）。
function anchoredRecord(rideId: string, startTime: string) {
  const fixture = getRideFixture("l3-fit-power");
  return {
    activity: { ...structuredClone(fixture.activity), rideId, startTime },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

const RECORDS = [
  anchoredRecord("ride-0812", "2026-08-12T18:30:00+08:00"),
  anchoredRecord("ride-0815", "2026-08-15T08:00:00Z"),
  anchoredRecord("ride-0820", "2026-08-20T08:00:00Z"),
];

const repository = {
  listRides: async (ownerId: string) => ownerId === "owner-a" ? RECORDS.map((record) => ({ record })) : [],
  getRide: async (ownerId: string, rideId: string) => ownerId === "owner-a" ? RECORDS.find((record) => record.activity.rideId === rideId) ?? null : null,
  getProfile: async () => null,
} as unknown as ApplicationRepository;
const runner = createChatToolRunner(repository, "owner-a");

test("AEVAL-M3-CHAT fixed set drives the frozen routing contract", async () => {
  assert.equal(fixedSet.datasetId, "AEVAL-M3-CHAT");
  assert.equal(fixedSet.cases.length, 34);

  for (const item of fixedSet.cases) {
    const decision = classifyChatInput(item.input);
    assert.equal(decision.route, item.expected.route, item.caseId);
    if (item.expected.action) assert.equal(decision.action, item.expected.action, item.caseId);

    if (item.expected.provider === "never") {
      const result = await runLegacyChatAgent({ text: item.input, decision, toolRunner: runner });
      assert.equal(result.modelInvoked, false, item.caseId);
      assert.equal(result.execution, "template", item.caseId);
      if (item.expected.fallbackCode) assert.equal(result.fallbackCode, item.expected.fallbackCode, item.caseId);
    }
  }
});

// CHAT-14：锚点用例（anchor_clarify / anchor_explicit_date / 显式序数）驱动
// 骑乘锚点解析合同——澄清零模型、显式日期与序数锚定到具体记录日期。
test("AEVAL-M3-CHAT anchor cases drive the CHAT-14 ride-anchor contract", async () => {
  const clarifyCase = fixedSet.cases.find((item) => item.caseId === "CHAT-REG-17");
  assert.ok(clarifyCase, "CHAT-REG-17 present");
  const clarifyResult = await runLegacyChatAgent({
    text: clarifyCase.input,
    decision: classifyChatInput(clarifyCase.input),
    toolRunner: runner,
  });
  assert.equal(clarifyResult.fallbackCode, "TOOLS_ANCHOR_CLARIFY");
  assert.equal(clarifyResult.modelInvoked, false);
  assert.match(clarifyResult.reply, /最近一次（8月20日）/);

  const explicitCase = fixedSet.cases.find((item) => item.caseId === "CHAT-REG-18");
  assert.ok(explicitCase, "CHAT-REG-18 present");
  const explicitRun = await runner.run({ text: explicitCase.input, decision: classifyChatInput(explicitCase.input) });
  assert.equal(explicitRun.context.toolResult.tool, "get_ride_context");
  assert.deepEqual(explicitRun.trace.dimensions, ["power"]);
  assert.equal(explicitRun.resolvedAnchor?.date, "2026-08-20");
  assert.equal(explicitRun.resolvedAnchor?.source, "explicit_date");

  const ordinalCase = fixedSet.cases.find((item) => item.caseId === "CHAT-DEV-02");
  assert.ok(ordinalCase, "CHAT-DEV-02 present");
  const ordinalRun = await runner.run({ text: ordinalCase.input, decision: classifyChatInput(ordinalCase.input) });
  assert.equal(ordinalRun.context.toolResult.tool, "get_ride_context");
  assert.deepEqual(ordinalRun.trace.dimensions, ["power"]);
  assert.equal(ordinalRun.resolvedAnchor?.date, "2026-08-20");
  assert.equal(ordinalRun.resolvedAnchor?.source, "explicit_ordinal");
});

// CHAT-17（固定集 v0.6）：L2b 自主工具循环用例驱动循环合同——检索成功（completed）、
// 阈值无命中（no_match）走真实编排循环；失败注入 fixture 用例（预算耗尽/白名单外/
// 越权锚点/无 Provider）由 Runner 层 fixture 承载，此处校验 loopStatus 期望完备。
test("AEVAL-M3-CHAT L2b cases drive the CHAT-17 autonomous tool loop contract", async () => {
  const l2bCases = fixedSet.cases.filter((item) => item.expected.route === "autonomous_tools");
  assert.equal(l2bCases.length, 8);
  const knownLoopStatuses = new Set(["completed", "budget_exhausted", "no_match", "invalid_tool_call"]);
  // 循环启动并产生轨迹的用例必须声明 loopStatus；无 Provider 用例循环不启动（无轨迹）。
  const loopTracedCases = l2bCases.filter((item) => item.expected.provider !== "never");
  assert.equal(loopTracedCases.length, 7);
  for (const item of loopTracedCases) {
    assert.ok(item.expected.loopStatus && knownLoopStatuses.has(item.expected.loopStatus), `${item.caseId} loopStatus`);
    if (item.expected.fallbackCode?.startsWith("TOOLS_LOOP_")) {
      assert.notEqual(item.expected.loopStatus, "completed", `${item.caseId} degraded loopStatus`);
    }
  }

  // CHAT-REG-19（find_ride 极值成功）：模型检索后引用检索 Claims 回答（距离并列时
  // max 模式按最新出发时间破签，仍返回唯一命中）。
  const l2bRepository = {
    listRides: async (ownerId: string) => ownerId === "owner-a" ? RECORDS.map((record) => ({ record })) : [],
    getRide: async (ownerId: string, rideId: string) => ownerId === "owner-a" ? RECORDS.find((record) => record.activity.rideId === rideId) ?? null : null,
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
  const loopRunner = createChatToolLoopRunner(l2bRepository, "owner-a");
  const successCase = fixedSet.cases.find((item) => item.caseId === "CHAT-REG-19");
  assert.ok(successCase, "CHAT-REG-19 present");
  const successResult = await runLegacyChatAgent({
    text: successCase.input,
    decision: classifyChatInput(successCase.input),
    provider: {
      async run(invocation) {
        if (invocation.toolResults === undefined) {
          return { rawText: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "find_ride", input: { metric: "distanceM", mode: "max" } }] }) };
        }
        const match = invocation.toolResults[0]?.context.tool === "find_ride"
          ? (invocation.toolResults[0].context as { matches: Array<{ rideDateLabel?: string; claims: Array<{ displayValue: string; unit: string; claimId: string }> }> }).matches[0]
          : undefined;
        const claim = match?.claims[0];
        return {
          rawText: JSON.stringify({
            schemaVersion: "ride-chat-output-v0.1",
            route: "autonomous_tools",
            reply: `距离最远的是${match?.rideDateLabel ?? ""}那次骑行，共 ${claim?.displayValue ?? ""} ${claim?.unit ?? ""}。`,
            claimIds: [claim?.claimId ?? ""],
            capabilityKeys: [],
          }),
        };
      },
    },
    loopRunner,
  });
  assert.equal(successResult.execution, "validated");
  assert.equal(successResult.loopTrace?.status, "completed");
  assert.equal(successResult.loopTrace?.toolCalls, 1);
  assert.deepEqual(successResult.loopTrace?.steps.map((step) => [step.tool, step.status]), [["find_ride", "completed"]]);

  // CHAT-REG-21（阈值无命中）：工具检索无匹配 → 确定性降级，零额外模型调用。
  const noMatchCase = fixedSet.cases.find((item) => item.caseId === "CHAT-REG-21");
  assert.ok(noMatchCase, "CHAT-REG-21 present");
  let noMatchProviderCalls = 0;
  const noMatchResult = await runLegacyChatAgent({
    text: noMatchCase.input,
    decision: classifyChatInput(noMatchCase.input),
    provider: {
      async run() {
        noMatchProviderCalls += 1;
        return { rawText: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "find_ride", input: { metric: "avgHeartRateBpm", mode: "threshold", threshold: 250 } }] }) };
      },
    },
    loopRunner,
  });
  assert.equal(noMatchResult.execution, "template");
  assert.equal(noMatchResult.fallbackCode, "TOOLS_LOOP_NO_MATCH");
  assert.equal(noMatchResult.loopTrace?.status, "no_match");
  assert.equal(noMatchProviderCalls, 1);

  // CHAT-REG-25（无 Provider）：autonomous_tools 无模型配置 → 确定性降级，零模型调用。
  const noProviderCase = fixedSet.cases.find((item) => item.caseId === "CHAT-REG-25");
  assert.ok(noProviderCase, "CHAT-REG-25 present");
  const noProviderResult = await runLegacyChatAgent({
    text: noProviderCase.input,
    decision: classifyChatInput(noProviderCase.input),
    loopRunner,
  });
  assert.equal(noProviderResult.modelInvoked, false);
  assert.equal(noProviderResult.fallbackCode, "MODEL_NOT_CONFIGURED");
});
