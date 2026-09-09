import assert from "node:assert/strict";
import test from "node:test";

import {
  COZE_CHAT_INPUT_VARIABLES,
  CozeChatWorkflowClient,
  readCozeChatWorkflowConfig,
  type CozeChatWorkflowConfig,
} from "../src/chat/coze-chat-workflow.ts";
import { ChatProviderError } from "../src/chat/chat-agent.ts";

const config: CozeChatWorkflowConfig = {
  apiUrl: "https://api.coze.cn/v1/workflow/run",
  workflowName: "ride_chat_v1",
  workflowId: "chat-workflow-test",
  workflowVersion: "v0.1.0",
  apiToken: "chat-token",
  modelId: "chat-model",
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

test("Coze Chat adapter uses a dedicated workflow contract and only de-identified request data", async () => {
  const requests: RequestInit[] = [];
  const client = new CozeChatWorkflowClient(config, async (_url, init) => {
    requests.push(init ?? {});
    return new Response(JSON.stringify({ code: 0, data: JSON.stringify({ chat_output: JSON.stringify(output) }) }), { status: 200 });
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
  const body = JSON.parse(String(requests[0]?.body)) as { workflow_id: string; workflow_version: string; is_async: boolean; parameters: Record<string, string> };
  assert.equal(body.workflow_id, "chat-workflow-test");
  assert.equal(body.workflow_version, "v0.1.0");
  assert.equal(body.is_async, false);
  assert.deepEqual(Object.keys(body.parameters), [...COZE_CHAT_INPUT_VARIABLES]);
  const request = JSON.parse(body.parameters.chat_request) as Record<string, unknown>;
  assert.equal(request.agent, "ride_chat_v1");
  assert.equal(request.route, "current_ride");
  assert.deepEqual(request.sessionSummaries, [{ question: "最近一次骑行的距离是多少？", route: "current_ride", rideAnchor: "2026-08-20" }]);
  assert.doesNotMatch(JSON.stringify(request), /ownerId|rideId|latest-ride|chat-token/);
});

test("Coze Chat configuration is disabled without explicit Chat activation and never reads ride-analysis settings", () => {
  assert.equal(readCozeChatWorkflowConfig({
    CHAT_MODEL_ENABLED: "true",
    COZE_API_URL: "https://must-not-be-used.example.test",
    COZE_WORKFLOW_ID: "ride-analysis-workflow",
    COZE_API_TOKEN: "ride-analysis-token",
  }), undefined);
  const environment = {
    CHAT_MODEL_ENABLED: "true",
    COZE_CHAT_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_CHAT_WORKFLOW_NAME: "ride_chat_v1",
    COZE_CHAT_WORKFLOW_ID: "chat-workflow-id",
    COZE_CHAT_WORKFLOW_VERSION: "v0.1.0",
    COZE_CHAT_API_TOKEN: "chat-token",
    COZE_CHAT_MODEL_ID: "chat-model",
    COZE_CHAT_TIMEOUT_MS: "99999",
  };
  const loaded = readCozeChatWorkflowConfig(environment);
  assert.ok(loaded);
  assert.equal(loaded.timeoutMs, 25_000);
  assert.equal(readCozeChatWorkflowConfig({ ...environment, CHAT_MODEL_ENABLED: "false" }), undefined);
});

test("Coze Chat errors map to stable chat error codes", async () => {
  const rateLimited = new CozeChatWorkflowClient(config, async () => new Response("{}", { status: 429 }));
  await assert.rejects(
    () => rateLimited.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_RATE_LIMITED",
  );
  const malformed = new CozeChatWorkflowClient(config, async () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }));
  await assert.rejects(
    () => malformed.run({ requestId: "request", agentVersion: "ride-chat-agent-v0.1", route: "social", text: "你好" }),
    (error: unknown) => error instanceof ChatProviderError && error.code === "MODEL_INVALID_RESPONSE",
  );
});
