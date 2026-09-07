import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runChatAgent } from "../src/chat/chat-agent.ts";
import { classifyChatInput } from "../src/chat/chat-routing.ts";

type FixedCase = {
  caseId: string;
  input: string;
  expected: { route: string; action?: string; provider?: string };
};

const fixedSet = JSON.parse(await readFile("eval/ride-chat-v0.1/cases.json", "utf8")) as { datasetId: string; cases: FixedCase[] };

test("AEVAL-M3-CHAT fixed set drives the frozen routing contract", async () => {
  assert.equal(fixedSet.datasetId, "AEVAL-M3-CHAT");
  assert.equal(fixedSet.cases.length, 15);

  for (const item of fixedSet.cases) {
    const decision = classifyChatInput(item.input);
    assert.equal(decision.route, item.expected.route, item.caseId);
    if (item.expected.action) assert.equal(decision.action, item.expected.action, item.caseId);

    if (item.expected.provider === "never") {
      const result = await runChatAgent({ text: item.input, decision });
      assert.equal(result.modelInvoked, false, item.caseId);
      assert.equal(result.execution, "template", item.caseId);
    }
  }
});
