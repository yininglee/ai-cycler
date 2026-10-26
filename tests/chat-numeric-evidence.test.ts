import assert from "node:assert/strict";
import test from "node:test";

import { chatNumbersSupported, chatNumberTokens } from "../src/chat/chat-numeric-evidence.ts";


// AGT-B5（第五轮 REPAIR_FAILED 根因）：模型在 reply 正文内联「（claim:loop:1:2）」标注来源，
// claimId 里的 1、2 不是数据数字——旧提取器把它们当数字，白名单无裸 1/2 → 误伤整轮。
test("chatNumberTokens 剥离 claimId/knowledgeId 引用标记，编号不算数据数字", () => {
  const tokens = chatNumberTokens("约1001公里（claim:loop:1:2），共21次（claim:loop:1:1），参考 kb-v21-pacingExecution");
  assert.deepEqual(tokens, ["1001", "21"]);
});

test("chatNumbersSupported 不因正文内联 claimId 而误伤（第五轮 ORCH-04 复现）", () => {
  const facts = [
    { value: 1001000, unit: "m", key: "distanceM", displayValue: "1001000" },
    { value: 21, unit: "count", key: "rideCount", displayValue: "21" },
    { value: 90, unit: "days", key: "windowDays", displayValue: "90" },
  ];
  const reply = "根据最近90天的记录，您一共骑行了约1001公里（claim:loop:1:2），共21次骑行（claim:loop:1:1）。";
  assert.equal(chatNumbersSupported(reply, facts, "最近三个月我一共骑了多少公里？"), true);
});
