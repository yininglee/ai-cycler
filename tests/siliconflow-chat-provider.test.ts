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
  // AGT-B0/B3/B4 预期变更：Prompt 升 v0.2.0（输出合同 v0.2 + 数字等价类 + 三路由 + 预算 4/5 + 能力清单）。
  assert.equal(CHAT_WORKFLOW_PROMPT_VERSION, "ride-chat-prompt-v0.3.0");
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
  // AGT-B5：本行测的是**上限钳制**（输入 99999 → 钳到上限）。上限从 25s 提到 40s，
  // 理由：实测服务端 headers p90 22.1s / max 24.9s，25s 会把一批"正常但偏慢"的调用
  // 误判为 MODEL_TIMEOUT（16 次失败全是 25.00s 到点，无一次 TCP 超时）。
  assert.equal(loaded.timeoutMs, 40_000);
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
  const toolCallRequest = { schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "find_ride", purpose: "在窗口内检索某一条骑行", input: { metric: "distanceM", mode: "max" } }] };
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

// AGT-B5（227s 预算失效修复）：provider 超时的 race 兜底。实测编排第三轮 ORCH-08 r1
// 单次 provider 调用跑了 ~207 秒仍"成功"返回——abort 信号在某种连接状态下概率性失效。
// 本地复现实验证明常规场景 abort 生效，因此不能依赖单一机制：race 到点必然抛 MODEL_TIMEOUT。
test("provider 超时有 race 兜底：挂起的 fetch 在 timeoutMs 抛 MODEL_TIMEOUT（不依赖 abort 语义）", async () => {
  const config = readSiliconFlowChatProviderConfig({ SILICONFLOW_API_TOKEN: "test-token", CHAT_MODEL_ENABLED: "true" });
  assert.ok(config);
  const provider = new SiliconFlowChatProvider(
    { ...config, timeoutMs: 120 },
    // fetch 永不 resolve，也完全忽略 signal——模拟 abort 失效的连接状态
    (() => new Promise<Response>(() => {})) as unknown as typeof fetch,
  );
  const startedAt = Date.now();
  await assert.rejects(
    provider.run({ requestId: "hang", agentVersion: "ride-chat-agent-v0.1", route: "kb_qa", text: "hi" }),
    (error: Error & { code?: string }) => error.code === "MODEL_TIMEOUT",
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 500, `挂起 fetch 应在 ~120ms 被掐断，实际 ${elapsed}ms（227s 预算失效的回归）`);
});

test("provider 超时 race 兜底覆盖 body 读取阶段（慢速滴流响应体）", async () => {
  const config = readSiliconFlowChatProviderConfig({ SILICONFLOW_API_TOKEN: "test-token", CHAT_MODEL_ENABLED: "true" });
  assert.ok(config);
  const provider = new SiliconFlowChatProvider(
    { ...config, timeoutMs: 120 },
    // headers 立即返回，body 永不结束
    (async () => new Response(new ReadableStream({ start() {} }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch,
  );
  const startedAt = Date.now();
  await assert.rejects(
    provider.run({ requestId: "slow-body", agentVersion: "ride-chat-agent-v0.1", route: "kb_qa", text: "hi" }),
    (error: Error & { code?: string }) => error.code === "MODEL_TIMEOUT",
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 500, `挂起 body 应在 ~120ms 被掐断，实际 ${elapsed}ms`);
});
