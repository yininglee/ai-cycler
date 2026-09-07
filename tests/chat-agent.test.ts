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
import { classifyChatInput } from "../src/chat/chat-routing.ts";

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

test("Chat provider selects the dedicated Coze Workflow adapter without reading ride-analysis configuration", () => {
  const provider = createChatProvider({
    CHAT_MODEL_ENABLED: "true",
    CHAT_PROVIDER_KIND: "coze_workflow",
    COZE_CHAT_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_CHAT_WORKFLOW_NAME: "ride_chat_v1",
    COZE_CHAT_WORKFLOW_ID: "chat-workflow-id",
    COZE_CHAT_WORKFLOW_VERSION: "v0.1.0",
    COZE_CHAT_API_TOKEN: "chat-token",
    COZE_API_URL: "https://ride-analysis.example.test",
    COZE_API_TOKEN: "ride-analysis-token",
  });
  assert.ok(provider);
  assert.equal(provider.constructor.name, "CozeChatWorkflowClient");
});
