import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SILICONFLOW_CHAT_MODEL_ID,
  readSiliconFlowChatProviderConfig,
  SiliconFlowChatProvider,
  type SiliconFlowChatProviderConfig,
} from "../src/chat/siliconflow-chat-provider.ts";
import { CHAT_WORKFLOW_PROMPT_VERSION, CHAT_WORKFLOW_SYSTEM_PROMPT } from "../src/chat/chat-workflow-prompt.ts";
import { ChatProviderError } from "../src/chat/chat-agent.ts";

const config: SiliconFlowChatProviderConfig = {
  apiUrl: "https://api.siliconflow.cn/v1/chat/completions",
  apiToken: "chat-token",
  modelId: "deepseek-ai/DeepSeek-V3.2",
  timeoutMs: 8_000,
  maxResponseBytes: 64 * 1_024,
};

const output = {
  schemaVersion: "ride-chat-output-v0.1",
  route: "current_ride",
  reply: "本次平均功率是 205 W。",
  claimIds: ["claim:context:1"],
  capabilityKeys: [],
};

function completionEnvelope(rawText: string): string {
  return JSON.stringify({ choices: [{ message: { role: "assistant", content: rawText } }] });
}

test("SiliconFlow chat provider sends the code-hosted prompt with a de-identified chat_request projection", async () => {
  const requests: RequestInit[] = [];
  const client = new SiliconFlowChatProvider(config, async (_url, init) => {
    requests.push(init ?? {});
    return new Response(completionEnvelope(JSON.stringify(output)), { status: 200 });
  });
  const result = await client.run({
    requestId: "request",
    agentVersion: "ride-chat-agent-v0.1",
    route: "current_ride",
    text: "本次骑行平均功率是多少？",
    // CHAT-14 P1：白名单摘要进入 chat_request 投影（仅 question/route/rideAnchor）。
    sessionSummaries: [{ question: "最近一次骑行的距离是多少？", route: "current_ride", rideAnchor: "2026-08-20" }],
    toolContext: {
      tool: "get_ride_context",
      dimensions: ["power"],
      claims: [{
        claimId: "claim:context:1",
        kind: "metric",
        key: "avgPowerW",
        value: 205,
        unit: "W",
        confidence: "high",
        displayValue: "205",
        displayUnit: "W",
      }],
      limitations: [],
    },
  });
  assert.equal(result.rawText, JSON.stringify(output));
  assert.equal((requests[0]?.headers as Record<string, string>).Authorization, "Bearer chat-token");

  const body = JSON.parse(String(requests[0]?.body)) as {
    model: string;
    temperature: number;
    enable_thinking: boolean;
    response_format: { type: string };
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.model, "deepseek-ai/DeepSeek-V3.2");
  // 采样锁定（骑后链路 2026-10-06 决策的同一原则）：低温 + 关闭 thinking + JSON mode。
  assert.equal(body.temperature, 0.3);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.response_format.type, "json_object");
  // Prompt 从代码库发送：system = v0.1.6 常量（版本归档于 chat-workflow-prompt.ts）。
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0]?.role, "system");
  assert.equal(body.messages[0]?.content, CHAT_WORKFLOW_SYSTEM_PROMPT);
  assert.equal(CHAT_WORKFLOW_PROMPT_VERSION, "ride-chat-prompt-v0.1.6");
  const userContent = body.messages[1]?.content ?? "";
  assert.match(userContent, /<chat_request>/);
  assert.match(userContent, /<repair_instruction>\n\n<\/repair_instruction>/);
  assert.match(userContent, /<previous_output>\n\n<\/previous_output>/);

  const requestTag = /<chat_request>\n([\s\S]*?)\n<\/chat_request>/.exec(userContent)?.[1] ?? "";
  const request = JSON.parse(requestTag) as Record<string, unknown>;
  assert.equal(request.agent, "ride_chat_v1");
  assert.equal(request.route, "current_ride");
  assert.deepEqual(request.sessionSummaries, [{ question: "最近一次骑行的距离是多少？", route: "current_ride", rideAnchor: "2026-08-20" }]);
  assert.doesNotMatch(JSON.stringify(request), /ownerId|rideId|latest-ride|chat-token/);
});

test("SiliconFlow chat configuration is gated by the chat flag, defaults to the DeepSeek model, and never reads ride-analysis settings", () => {
  assert.equal(readSiliconFlowChatProviderConfig({
    CHAT_MODEL_ENABLED: "true",
    RIDE_MODEL_V2_MODEL_ID: "must-not-be-used",
    RIDE_INTERPRETATION_ENGINE: "V2",
  }), undefined);
  assert.equal(readSiliconFlowChatProviderConfig({
    CHAT_MODEL_ENABLED: "false",
    SILICONFLOW_API_TOKEN: "chat-token",
  }), undefined);
  const loaded = readSiliconFlowChatProviderConfig({
    CHAT_MODEL_ENABLED: "true",
    SILICONFLOW_API_TOKEN: "chat-token",
    SILICONFLOW_CHAT_TIMEOUT_MS: "99999",
  });
  assert.ok(loaded);
  assert.equal(loaded.apiUrl, "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(loaded.modelId, DEFAULT_SILICONFLOW_CHAT_MODEL_ID);
  assert.equal(loaded.timeoutMs, 25_000);
  assert.equal(readSiliconFlowChatProviderConfig({
    CHAT_MODEL_ENABLED: "true",
    SILICONFLOW_API_TOKEN: "chat-token",
    SILICONFLOW_CHAT_MODEL_ID: "deepseek-ai/DeepSeek-V3.2",
    SILICONFLOW_CHAT_TIMEOUT_MS: "12000",
  })?.timeoutMs, 12_000);
});

test("SiliconFlow chat errors map to stable chat error codes", async () => {
  const rateLimited = new SiliconFlowChatProvider(config, async () => new Response("{}", { status: 429 }));
  await assert.rejects(
    () => rateLimited.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_RATE_LIMITED",
  );
  const unauthorized = new SiliconFlowChatProvider(config, async () => new Response("{}", { status: 403 }));
  await assert.rejects(
    () => unauthorized.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_TEMPORARY_UNAVAILABLE",
  );
  const malformed = new SiliconFlowChatProvider(config, async () => new Response("not-json", { status: 200 }));
  await assert.rejects(
    () => malformed.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
  const missingContent = new SiliconFlowChatProvider(config, async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
  await assert.rejects(
    () => missingContent.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
  const timeout = new SiliconFlowChatProvider(config, async (_url, init) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  await assert.rejects(
    () => timeout.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_TIMEOUT",
  );
});

// CHAT-17 P5：L2b 循环投影与工具调用请求输出——chat_request 随行 toolCatalog/toolResults
// （合同不变）；ride-chat-tool-call-v0.1 是合法输出（循环首轮），不再判无效。
test("SiliconFlow chat carries L2b toolCatalog/toolResults and repair turns (CHAT-17)", async () => {
  const toolCallRequest = { schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "find_ride", input: { metric: "distanceM", mode: "max" } }] };
  const requests: RequestInit[] = [];
  const client = new SiliconFlowChatProvider(config, async (_url, init) => {
    requests.push(init ?? {});
    return new Response(completionEnvelope(JSON.stringify(toolCallRequest)), { status: 200 });
  });
  const result = await client.run({
    requestId: "request",
    agentVersion: "ride-chat-agent-v0.1",
    route: "autonomous_tools",
    text: "距离最远的那次骑行是哪次？",
    toolCatalog: {
      schemaVersion: "ride-chat-tool-catalog-v0.1",
      anchorRideId: "anchor-ride",
      tools: [{ tool: "find_ride", input: { metric: ["distanceM"], mode: ["max", "min", "threshold"] } }],
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
    repairInstruction: "修复数字引用",
    previousOutput: "{\"schemaVersion\":\"ride-chat-output-v0.1\"}",
  });
  // 工具调用请求被识别为合法输出原样返回（编排层解析后执行）。
  assert.equal(result.rawText, JSON.stringify(toolCallRequest));
  const body = JSON.parse(String(requests[0]?.body)) as { messages: Array<{ role: string; content: string }> };
  const userContent = body.messages[1]?.content ?? "";
  assert.match(userContent, /<repair_instruction>\n修复数字引用\n<\/repair_instruction>/);
  assert.match(userContent, /<previous_output>\n\{"schemaVersion":"ride-chat-output-v0\.1"\}\n<\/previous_output>/);
  const requestTag = /<chat_request>\n([\s\S]*?)\n<\/chat_request>/.exec(userContent)?.[1] ?? "";
  const request = JSON.parse(requestTag) as { toolCatalog?: { anchorRideId: string }; toolResults?: Array<{ call: number }> };
  assert.equal(request.toolCatalog?.anchorRideId, "anchor-ride");
  assert.equal(request.toolResults?.length, 1);
  assert.equal(request.toolResults?.[0]?.call, 1);
  assert.doesNotMatch(JSON.stringify(request), /ownerId|chat-token/);
});
