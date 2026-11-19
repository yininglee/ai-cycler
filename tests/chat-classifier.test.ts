import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_CLASSIFIER_INTENTS,
  classifierAgreesWithRule,
  classifierOutcomeAttributes,
  DEFAULT_SILICONFLOW_CLASSIFIER_MODEL_ID,
  intentToRoutingDecision,
  parseClassifierResult,
  readSiliconFlowClassifierConfig,
  resolveChatRouting,
  routingEventAttributes,
  SiliconFlowClassifierClient,
  type ChatClassifierClient,
  type SiliconFlowClassifierConfig,
} from "../src/chat/chat-classifier.ts";
import { CHAT_CLASSIFIER_PROMPT_VERSION, CHAT_CLASSIFIER_SYSTEM_PROMPT } from "../src/chat/chat-classifier-prompt.ts";
import { ChatProviderError } from "../src/chat/chat-agent.ts";

const config: SiliconFlowClassifierConfig = {
  apiUrl: "https://api.siliconflow.cn/v1/chat/completions",
  apiToken: "chat-token",
  modelId: "deepseek-ai/DeepSeek-V4-Flash",
  timeoutMs: 8_000,
  maxResponseBytes: 16 * 1_024,
};

const classifierOutput = {
  schemaVersion: "chat-classifier-v0.3",
  intent: "allow",
  needsClarification: false,
};

function completionEnvelope(rawText: string): string {
  return JSON.stringify({ choices: [{ message: { role: "assistant", content: rawText } }] });
}

test("classifier configuration is gated by its own flag, shares the SiliconFlow token, and never reads ride-analysis settings", () => {
  assert.equal(readSiliconFlowClassifierConfig({
    CHAT_CLASSIFIER_ENABLED: "true",
    RIDE_MODEL_V2_MODEL_ID: "must-not-be-used",
    RIDE_INTERPRETATION_ENGINE: "V2",
  }), undefined);
  assert.equal(readSiliconFlowClassifierConfig({
    CHAT_CLASSIFIER_ENABLED: "false",
    SILICONFLOW_API_TOKEN: "chat-token",
  }), undefined);
  const loaded = readSiliconFlowClassifierConfig({
    CHAT_CLASSIFIER_ENABLED: "true",
    SILICONFLOW_API_TOKEN: "chat-token",
    SILICONFLOW_CLASSIFIER_TIMEOUT_MS: "99999",
  });
  assert.ok(loaded);
  assert.equal(loaded.apiUrl, "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(loaded.modelId, DEFAULT_SILICONFLOW_CLASSIFIER_MODEL_ID);
  assert.equal(loaded.timeoutMs, 25_000);
  const overridden = readSiliconFlowClassifierConfig({
    CHAT_CLASSIFIER_ENABLED: "true",
    SILICONFLOW_API_TOKEN: "chat-token",
    SILICONFLOW_CLASSIFIER_MODEL_ID: "Qwen/Qwen3.5-9B",
    SILICONFLOW_CLASSIFIER_TIMEOUT_MS: "5000",
  });
  assert.ok(overridden);
  assert.equal(overridden.modelId, "Qwen/Qwen3.5-9B");
  assert.equal(overridden.timeoutMs, 5_000);
});

test("classifier client sends the code-hosted prompt with a de-identified classify_request and parses completion output", async () => {
  const requests: RequestInit[] = [];
  const client = new SiliconFlowClassifierClient(config, async (_url, init) => {
    requests.push(init ?? {});
    return new Response(completionEnvelope(JSON.stringify(classifierOutput)), { status: 200 });
  });
  const result = await client.classify({ requestId: "request", text: "本次骑行平均功率是多少？" });
  assert.deepEqual(result, classifierOutput);
  assert.equal((requests[0]?.headers as Record<string, string>).Authorization, "Bearer chat-token");

  const body = JSON.parse(String(requests[0]?.body)) as {
    model: string;
    temperature: number;
    enable_thinking: boolean;
    response_format: { type: string };
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(body.temperature, 0.3);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.response_format.type, "json_object");
  // Prompt 从代码库发送：system = v0.4 常量（版本归档于 chat-classifier-prompt.ts）。
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0]?.role, "system");
  assert.equal(body.messages[0]?.content, CHAT_CLASSIFIER_SYSTEM_PROMPT);
  assert.equal(CHAT_CLASSIFIER_PROMPT_VERSION, "ride-chat-classifier-prompt-v0.5.0");

  const userContent = body.messages[1]?.content ?? "";
  const requestTag = /<classify_request>\n([\s\S]*?)\n<\/classify_request>/.exec(userContent)?.[1] ?? "";
  const request = JSON.parse(requestTag) as Record<string, unknown>;
  assert.equal(request.agent, "ride_chat_v1");
  assert.equal(request.classifierVersion, "chat-classifier-v0.3");
  assert.equal(request.text, "本次骑行平均功率是多少？");
  assert.doesNotMatch(JSON.stringify(request), /ownerId|rideId|chat-token|toolContext/);
});

test("classifier accepts valid completion output and rejects contract violations", async () => {
  const unclear = new SiliconFlowClassifierClient(config, async () => new Response(completionEnvelope(JSON.stringify({
    schemaVersion: "chat-classifier-v0.3",
    intent: "allow",
    needsClarification: false,
  })), { status: 200 }));
  assert.deepEqual(await unclear.classify({ requestId: "request", text: "那这个呢？" }), {
    schemaVersion: "chat-classifier-v0.3",
    intent: "allow",
    needsClarification: false,
  });
  const invalidIntent = new SiliconFlowClassifierClient(config, async () => new Response(completionEnvelope(JSON.stringify({
    schemaVersion: "chat-classifier-v0.3",
    intent: "chitchat",
    needsClarification: false,
  })), { status: 200 }));
  await assert.rejects(
    () => invalidIntent.classify({ requestId: "request", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
  const missingFlag = new SiliconFlowClassifierClient(config, async () => new Response(completionEnvelope(JSON.stringify({
    schemaVersion: "chat-classifier-v0.3",
    intent: "social",
  })), { status: 200 }));
  await assert.rejects(
    () => missingFlag.classify({ requestId: "request", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
  assert.throws(() => parseClassifierResult("not json"), (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE");
  assert.throws(
    () => parseClassifierResult(JSON.stringify({ schemaVersion: "chat-classifier-v0.0", intent: "open_chat", needsClarification: false })),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
  // 合同冻结：needsClarification 必须与 unclear 耦合，反向组合视为不匹配合同。
  assert.throws(
    () => parseClassifierResult(JSON.stringify({ schemaVersion: "chat-classifier-v0.3", intent: "aggregate", needsClarification: true })),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
  const rateLimited = new SiliconFlowClassifierClient(config, async () => new Response("{}", { status: 429 }));
  await assert.rejects(
    () => rateLimited.classify({ requestId: "request", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_RATE_LIMITED",
  );
  const malformed = new SiliconFlowClassifierClient(config, async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
  await assert.rejects(
    () => malformed.classify({ requestId: "request", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
});

// Prompt and archived copy must declare the same boundary contract.
test("classifier prompt declares the boundary contract and its archived copy stays identical", () => {
  const prompt = CHAT_CLASSIFIER_SYSTEM_PROMPT;
  for (const intent of CHAT_CLASSIFIER_INTENTS) {
    assert.match(prompt, new RegExp(`\\b${intent}\\b`), `prompt does not declare intent ${intent}`);
  }
  assert.match(prompt, /chat-classifier-v0\.3/);
  assert.deepEqual(CHAT_CLASSIFIER_INTENTS, ["safety_stop", "privacy_boundary", "injection_stop", "out_of_scope", "allow"]);
  assert.doesNotMatch(prompt, /ride_summary|training_plan|training_supervision|level_assessment|kb_qa/);

  const archived = readFileSync(new URL("../prompts/ride-chat-classifier-v0.2.md", import.meta.url), "utf8");
  const archivedPrompt = /```text\n([\s\S]*?)\n```/.exec(archived)?.[1];
  assert.ok(archivedPrompt, "archived prompt block missing");
  assert.equal(archivedPrompt, prompt, "archived copy drifted from code constant");
});

test("boundary contract rejects old business tags, clarification flags and extra fields", () => {
  for (const patch of [
    ...["ride_summary", "aggregate", "history_compare", "level_assessment", "capability_gap", "capabilities", "kb_qa", "training_plan", "training_supervision", "companion", "open_chat", "unclear"].map(intent => ({ intent })),
    { needsClarification: true }, { unexpected: "allow" }, { schemaVersion: "chat-classifier-v0.2" },
  ]) assert.throws(() => parseClassifierResult(JSON.stringify({ ...classifierOutput, ...patch })), ChatProviderError);
});

test("boundary routing admits contextual and compound requests regardless of old business rule labels", async () => {
  const { classifyChatInput, makeChatDecision } = await import("../src/chat/chat-routing.ts");
  for (const text of ["按刚才的情况调整一下", "帮我制定训练计划", "最近整体表现怎么样", "为什么要做区间训练？", "哪次最远，那次爬坡多吗？"]) {
    const result = await resolveChatRouting({ text, ruleDecision: classifyChatInput(text), requestId: "boundary" });
    assert.equal(result.decision?.route, "autonomous_tools");
  }
  for (const intent of CHAT_CLASSIFIER_INTENTS) {
    const client: ChatClassifierClient = { async classify() { return { ...classifierOutput, intent, schemaVersion: "chat-classifier-v0.3" }; } };
    const result = await resolveChatRouting({ text: "一条待判断的请求", ruleDecision: makeChatDecision("training_plan", "none", "TRAINING_PLAN", 8), requestId: "boundary", classifier: client });
    assert.equal(result.decision?.route, intent === "allow" ? "autonomous_tools" : intent);
  }
});
