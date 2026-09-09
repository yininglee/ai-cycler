import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runChatAgent } from "../src/chat/chat-agent.ts";
import { createChatToolRunner } from "../src/chat/chat-tool-orchestration.ts";
import { classifyChatInput } from "../src/chat/chat-routing.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";

type FixedCase = {
  caseId: string;
  input: string;
  fixture?: string;
  expected: { route: string; action?: string; provider?: string; fallbackCode?: string; tool?: string; dimensions?: string[] };
};

const fixedSet = JSON.parse(await readFile("eval/ride-chat-v0.1/cases.json", "utf8")) as { datasetId: string; cases: FixedCase[] };

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
  assert.equal(fixedSet.cases.length, 27);

  for (const item of fixedSet.cases) {
    const decision = classifyChatInput(item.input);
    assert.equal(decision.route, item.expected.route, item.caseId);
    if (item.expected.action) assert.equal(decision.action, item.expected.action, item.caseId);

    if (item.expected.provider === "never") {
      const result = await runChatAgent({ text: item.input, decision, toolRunner: runner });
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
  const clarifyResult = await runChatAgent({
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
