import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { POST as chatRoute } from "../app/api/chat/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";

const cookie = (setCookie: string | undefined) => setCookie?.split(";", 1)[0] ?? "";

test("chat route derives a missing current ride server-side without accepting or exposing identifiers", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "本次骑行平均功率是多少？" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { decision: { route: string; allowModel: boolean }; modelInvoked: boolean; execution: string; fallbackCode: string; providerRawOutput?: string; toolContext?: unknown; toolTrace?: unknown };
  assert.equal(body.decision.route, "current_ride");
  assert.equal(body.decision.allowModel, true);
  assert.equal(body.modelInvoked, false);
  assert.equal(body.execution, "template");
  assert.equal(body.fallbackCode, "TOOLS_NO_CURRENT_RIDE");
  assert.equal(body.providerRawOutput, undefined);
  assert.equal(body.toolContext, undefined);
  assert.equal(body.toolTrace, undefined);
});

test("chat route blocks safety input before any model path", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "胸痛并且呼吸困难，怎么办？" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { decision: { route: string; action: string; allowModel: boolean }; modelInvoked: boolean; execution: string };
  assert.deepEqual({ route: body.decision.route, action: body.decision.action, allowModel: body.decision.allowModel, modelInvoked: body.modelInvoked, execution: body.execution }, {
    route: "safety_stop",
    action: "safety_stop",
    allowModel: false,
    modelInvoked: false,
    execution: "template",
  });
});

// CHAT-13：历史比较路由——首骑（窗口内无历史）走 D1 确定性降级，
// 零模型调用、不生成进步/退步结论，事件只记录脱敏观测属性。

test("chat route answers history_compare with the deterministic D1 degradation for a first ride (CHAT-13)", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const repository = getApplicationRepository();
  const fixture = (await import("../src/fixtures/rides.ts")).getRideFixture("l1-built-in-sample");
  await repository.saveRide(session.userId, {
    activity: { ...structuredClone(fixture.activity), rideId: "history-compare-ride" },
    series: { ...structuredClone(fixture.series), rideId: "history-compare-ride" },
  });
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "最近一次骑行比上次骑得远吗？" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    decision: { route: string; action: string };
    modelInvoked: boolean;
    execution: string;
    fallbackCode?: string;
    reply: string;
    toolContext?: unknown;
    toolTrace?: { tool: string; status: string };
    providerRawOutput?: string;
  };
  assert.deepEqual({ route: body.decision.route, action: body.decision.action, modelInvoked: body.modelInvoked, execution: body.execution }, {
    route: "history_compare", action: "tool_then_model", modelInvoked: false, execution: "template",
  });
  assert.equal(body.fallbackCode, undefined);
  assert.match(body.reply, /暂时无法把这次骑行和最近 30 天的历史作比较/);
  assert.match(body.reply, /不会给出进步或退步的结论/);
  assert.equal(body.toolTrace?.tool, "compare_rides");
  assert.equal(body.toolTrace?.status, "completed");
  assert.equal(body.toolContext, undefined);
  assert.equal(body.providerRawOutput, undefined);
  assert.equal(JSON.stringify(body).includes("history-compare-ride"), false);
  const events = await repository.listDemoEvents(session.userId);
  const completed = events.filter((event) => event.type !== "chat_requested").at(-1);
  assert.ok(completed);
  assert.equal(completed.type, "chat_completed");
  assert.equal(completed.attributes?.route, "history_compare");
  assert.equal(completed.attributes?.toolStatus, "completed");
  assert.equal(completed.attributes?.toolCalls, "1");
});

test("chat route records only redacted observability metadata", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "你好" }),
  }));
  assert.equal(response.status, 200);
  const events = await getApplicationRepository().listDemoEvents(session.userId);
  const chatEvents = events.filter((event) => event.type.startsWith("chat_"));
  assert.deepEqual(chatEvents.map((event) => event.type), ["chat_requested", "chat_degraded"]);
  assert.equal(chatEvents[0]?.requestRef?.length, 20);
  assert.equal(chatEvents[0]?.attributes?.route, "social");
  assert.equal(chatEvents[1]?.attributes?.fallbackCode, "MODEL_NOT_CONFIGURED");
  assert.equal(chatEvents[1]?.attributes?.tokenStatus, "not_observed");
  assert.equal(chatEvents[1]?.attributes?.costStatus, "not_observed");
  const serialized = JSON.stringify(chatEvents);
  assert.doesNotMatch(serialized, /你好|"(?:prompt|token|secret|ownerId|rideId|providerRawOutput)"/i);
  assert.doesNotMatch(serialized, new RegExp(session.userId));
});

// CHAT-12 P2：影子模式在分类器已配置时只追加脱敏事件属性，不改变规则路由与回复；
// 未配置时（上一条测试）事件形状保持完全不变。
test("chat route records shadow classifier attributes without changing the rule-based reply", async () => {
  const environment = {
    CHAT_CLASSIFIER_ENABLED: "true",
    COZE_CHAT_CLASSIFIER_WORKFLOW_ID: "classifier-workflow-test",
    COZE_CHAT_CLASSIFIER_WORKFLOW_VERSION: "v0.1.0",
    COZE_CHAT_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_CHAT_API_TOKEN: "chat-token",
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const originalFetch = globalThis.fetch;
  const classifierCalls: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    classifierCalls.push(init ?? {});
    return new Response(JSON.stringify({
      code: 0,
      data: { classifier_output: JSON.stringify({ schemaVersion: "chat-classifier-v0.1", intent: "open_chat", needsClarification: false }) },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const session = resolveOrCreateRequestSession(new Request("http://localhost"));
    const response = await chatRoute(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
      body: JSON.stringify({ text: "你好" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { decision: { route: string }; modelInvoked: boolean; fallbackCode?: string };
    assert.equal(body.decision.route, "social");
    assert.equal(body.modelInvoked, false);
    assert.equal(body.fallbackCode, "MODEL_NOT_CONFIGURED");
    assert.equal(classifierCalls.length, 1);
    const events = await getApplicationRepository().listDemoEvents(session.userId);
    const completed = events.filter((event) => event.type !== "chat_requested").at(-1);
    assert.ok(completed);
    assert.equal(completed.type, "chat_degraded");
    assert.equal(completed.attributes?.classifierStatus, "ok");
    assert.equal(completed.attributes?.classifierIntent, "open_chat");
    assert.equal(completed.attributes?.classifierNeedsClarification, "false");
    assert.equal(completed.attributes?.classifierAgrees, "true");
    assert.ok(completed.attributes?.classifierDurationMs !== undefined);
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /你好|chat-token|classifier-workflow-test/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// CHAT-12 P3：CHAT_CLASSIFIER_MODE=active 时分类器接管主路由——
// L0 未命中的输入由 L1 语义分类器决定路由（unclear → 澄清话术），事件记录 routedBy=classifier。

test("active mode lets the classifier reroute an unclear question to the clarification path (CHAT-12 P3)", async () => {
  const environment = {
    CHAT_CLASSIFIER_MODE: "active",
    CHAT_CLASSIFIER_ENABLED: "true",
    COZE_CHAT_CLASSIFIER_WORKFLOW_ID: "classifier-workflow-test",
    COZE_CHAT_CLASSIFIER_WORKFLOW_VERSION: "v0.1.0",
    COZE_CHAT_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_CHAT_API_TOKEN: "chat-token",
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const originalFetch = globalThis.fetch;
  const classifierCalls: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    classifierCalls.push(init ?? {});
    return new Response(JSON.stringify({
      code: 0,
      data: { classifier_output: JSON.stringify({ schemaVersion: "chat-classifier-v0.1", intent: "unclear", needsClarification: true }) },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const session = resolveOrCreateRequestSession(new Request("http://localhost"));
    const response = await chatRoute(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
      body: JSON.stringify({ text: "那这个呢？" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { decision: { route: string }; modelInvoked: boolean; execution: string; reply: string };
    assert.deepEqual({ route: body.decision.route, modelInvoked: body.modelInvoked, execution: body.execution }, {
      route: "clarification",
      modelInvoked: false,
      execution: "template",
    });
    assert.match(body.reply, /说得更具体一些/);
    assert.equal(classifierCalls.length, 1);
    const events = await getApplicationRepository().listDemoEvents(session.userId);
    const requested = events.find((event) => event.type === "chat_requested");
    assert.equal(requested?.attributes?.routedBy, "classifier");
    assert.equal(requested?.attributes?.classifierIntent, "unclear");
    assert.equal(requested?.attributes?.route, "clarification");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// CHAT-12 P3：active 模式下 L0 快路径（高置信聚合）零调用直答——分类器不发起请求。

test("active mode answers L0 aggregate inputs without calling the classifier (CHAT-12 P3)", async () => {
  const environment = {
    CHAT_CLASSIFIER_MODE: "active",
    CHAT_CLASSIFIER_ENABLED: "true",
    COZE_CHAT_CLASSIFIER_WORKFLOW_ID: "classifier-workflow-test",
    COZE_CHAT_CLASSIFIER_WORKFLOW_VERSION: "v0.1.0",
    COZE_CHAT_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_CHAT_API_TOKEN: "chat-token",
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const originalFetch = globalThis.fetch;
  const classifierCalls: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    classifierCalls.push(init ?? {});
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  try {
    const session = resolveOrCreateRequestSession(new Request("http://localhost"));
    const response = await chatRoute(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
      body: JSON.stringify({ text: "我总共骑了多少" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { decision: { route: string }; modelInvoked: boolean; execution: string };
    assert.deepEqual({ route: body.decision.route, modelInvoked: body.modelInvoked, execution: body.execution }, {
      route: "aggregate",
      modelInvoked: false,
      execution: "template",
    });
    assert.equal(classifierCalls.length, 0);
    const events = await getApplicationRepository().listDemoEvents(session.userId);
    const requested = events.find((event) => event.type === "chat_requested");
    assert.equal(requested?.attributes?.routedBy, "rules_l0");
    assert.equal(requested?.attributes?.classifierStatus, "skipped_l0");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// CHAT-12 P3：active 模式但分类器未配置——安全降级 P1 规则，回复与纯规则完全一致。

test("active mode without classifier configuration degrades to the rule layer (CHAT-12 P3)", async () => {
  const previous = process.env.CHAT_CLASSIFIER_MODE;
  process.env.CHAT_CLASSIFIER_MODE = "active";
  try {
    const session = resolveOrCreateRequestSession(new Request("http://localhost"));
    const response = await chatRoute(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
      body: JSON.stringify({ text: "本次骑行平均功率是多少？" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { decision: { route: string }; modelInvoked: boolean; execution: string; fallbackCode: string };
    assert.deepEqual({ route: body.decision.route, modelInvoked: body.modelInvoked, execution: body.execution, fallbackCode: body.fallbackCode }, {
      route: "current_ride",
      modelInvoked: false,
      execution: "template",
      fallbackCode: "TOOLS_NO_CURRENT_RIDE",
    });
    const events = await getApplicationRepository().listDemoEvents(session.userId);
    const requested = events.find((event) => event.type === "chat_requested");
    assert.equal(requested?.attributes?.routedBy, "rules_fallback");
    assert.equal(requested?.attributes?.classifierStatus, "not_configured");
  } finally {
    if (previous === undefined) delete process.env.CHAT_CLASSIFIER_MODE;
    else process.env.CHAT_CLASSIFIER_MODE = previous;
  }
});

// CHAT-14 P2（G-RIDE-DEIXIS）：锚点澄清 → 挂起确认识别 → 确认轮重答的端到端链路；
// 摘要网关丢弃非法摘要且请求照常；骑行身份问题按锚点应答。

async function seededSession() {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const repository = getApplicationRepository();
  const fixture = (await import("../src/fixtures/rides.ts")).getRideFixture("l1-built-in-sample");
  await repository.saveRide(session.userId, {
    // 固定出发时间（Asia/Shanghai 日历日 2026-08-18），使锚点断言不依赖 fixture 默认值。
    activity: { ...structuredClone(fixture.activity), rideId: "anchor-e2e-ride", startTime: "2026-08-18T00:00:00Z" },
    series: { ...structuredClone(fixture.series), rideId: "anchor-e2e-ride" },
  });
  return { session, repository };
}

test("chat route clarifies bare deixis, then completes the pending question on confirmation (CHAT-14)", async () => {
  const { session } = await seededSession();
  // 距离指标：样例记录必含该维度，确认轮后可走“工具完成 + 等待输出校验”链路。
  const pendingSummary = { kind: "session_turn", question: "本次骑行的距离是多少？", route: "current_ride" };

  // 第一问：裸“本次”无锚点 → 确定性澄清（零模型），不携带 rideAnchor。
  const first = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "本次骑行的距离是多少？" }),
  }));
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { reply: string; fallbackCode: string; rideAnchor?: string; modelInvoked: boolean };
  assert.equal(firstBody.fallbackCode, "TOOLS_ANCHOR_CLARIFY");
  assert.equal(firstBody.modelInvoked, false);
  assert.match(firstBody.reply, /最近一次（8月18日）/);
  assert.equal(firstBody.rideAnchor, undefined);

  // 第二问：纯确认语 + 挂起摘要 → 建立锚点并重答原问题（Demo 态等待输出校验）。
  const second = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "是的", summaries: [pendingSummary] }),
  }));
  assert.equal(second.status, 200);
  const secondBody = await second.json() as { decision: { route: string }; execution: string; rideAnchor?: string; reply: string };
  assert.equal(secondBody.decision.route, "current_ride");
  assert.equal(secondBody.execution, "tool_context_pending_validation");
  assert.equal(secondBody.rideAnchor, "2026-08-18");
  assert.equal(JSON.stringify(secondBody).includes("anchor-e2e-ride"), false);

  const events = await getApplicationRepository().listDemoEvents(session.userId);
  // 最后一轮（确认轮）的 chat_requested 事件携带 anchorConfirmation 属性。
  const requested = events.filter((event) => event.type === "chat_requested").at(-1);
  assert.equal(requested?.attributes?.anchorConfirmation, "completed");
  assert.equal(requested?.attributes?.summariesCount, "1");
});

test("chat route answers an unmatched confirmation date deterministically (CHAT-14)", async () => {
  const { session } = await seededSession();
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({
      text: "8月1日",
      summaries: [{ kind: "session_turn", question: "本次骑行平均功率是多少？", route: "current_ride" }],
    }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { reply: string };
  assert.match(body.reply, /没有找到 8月1日/);
  const events = await getApplicationRepository().listDemoEvents(session.userId);
  const requested = events.find((event) => event.type === "chat_requested");
  assert.equal(requested?.attributes?.anchorConfirmation, "date_not_found");
});

test("chat route drops malformed summaries silently and keeps the request baseline (CHAT-14 P1)", async () => {
  const { session } = await seededSession();
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "本次骑行平均功率是多少？", summaries: "not-an-array" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { fallbackCode: string; reply: string };
  // 丢弃后回退无上下文基线：与不带摘要的裸指涉行为一致（锚点澄清）。
  assert.equal(body.fallbackCode, "TOOLS_ANCHOR_CLARIFY");
  assert.match(body.reply, /最近一次（8月18日）/);
  const events = await getApplicationRepository().listDemoEvents(session.userId);
  const requested = events.find((event) => event.type === "chat_requested");
  assert.equal(requested?.attributes?.summariesDropped, "true");
  assert.equal(requested?.attributes?.summariesCount, "0");
});

test("chat route answers ride identity questions from the inherited anchor (CHAT-14)", async () => {
  const { session } = await seededSession();
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({
      text: "当次是哪一次？",
      summaries: [{ kind: "session_turn", question: "聊过功率", route: "current_ride", rideAnchor: "2026-08-18" }],
    }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { decision: { route: string }; reply: string; modelInvoked: boolean };
  assert.equal(body.decision.route, "aggregate");
  assert.equal(body.modelInvoked, false);
  assert.match(body.reply, /按 8月18日 这次骑行处理/);
});

// CHAT-17：L2b 自主工具循环——find_ride 问题经 API 网关路由至 autonomous_tools；
// 无 Provider 时确定性降级（零模型调用，事件不带循环轨迹）。

test("chat route degrades find_ride questions deterministically without a provider (CHAT-17)", async () => {
  const { session } = await seededSession();
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "最近的骑行中，哪次距离最远？" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { decision: { route: string }; modelInvoked: boolean; execution: string; fallbackCode: string; loopTrace?: unknown };
  assert.deepEqual({
    route: body.decision.route,
    modelInvoked: body.modelInvoked,
    execution: body.execution,
    fallbackCode: body.fallbackCode,
  }, {
    route: "autonomous_tools",
    modelInvoked: false,
    execution: "template",
    fallbackCode: "MODEL_NOT_CONFIGURED",
  });
  assert.equal(body.loopTrace, undefined);
  const events = await getApplicationRepository().listDemoEvents(session.userId);
  const degraded = events.filter((event) => event.type !== "chat_requested").at(-1);
  assert.ok(degraded);
  assert.equal(degraded.type, "chat_degraded");
  assert.equal(degraded.attributes?.route, "autonomous_tools");
  assert.equal(degraded.attributes?.fallbackCode, "MODEL_NOT_CONFIGURED");
  assert.equal(degraded.attributes?.loopStatus, undefined);
  assert.doesNotMatch(JSON.stringify(events), new RegExp("anchor-e2e-ride"));
});

// CHAT-17：脚本化 Provider 驱动完整 L2b 循环——首轮工具调用请求（find_ride）→
// 次轮回传脱敏投影 → 最终回答引用 claim:loop:1:1 且通过动态溯源校验。

test("chat route completes the autonomous tool loop end-to-end with a scripted provider (CHAT-17)", async () => {
  const environment = {
    CHAT_MODEL_ENABLED: "true",
    COZE_CHAT_WORKFLOW_NAME: "ride_chat_v1",
    COZE_CHAT_WORKFLOW_ID: "chat-workflow-test",
    COZE_CHAT_WORKFLOW_VERSION: "v0.0.5",
    COZE_CHAT_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_CHAT_API_TOKEN: "chat-token",
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const originalFetch = globalThis.fetch;
  const providerCalls: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const parameters = JSON.parse(String(init?.body)) as { parameters: { chat_request: string } };
    providerCalls.push(parameters.parameters.chat_request);
    const request = JSON.parse(parameters.parameters.chat_request) as {
      toolCatalog?: { anchorRideId?: string };
      toolResults?: Array<{ context: { tool: string; matches?: Array<{ rideDateLabel?: string; claims: Array<{ displayValue: string; unit: string; claimId: string }> }> } }>;
    };
    // 首轮：携带工具目录、无工具结果 → 请求 find_ride（极值模式，锚点/窗口由编排层补全）。
    if (!request.toolResults) {
      return new Response(JSON.stringify({
        code: 0,
        data: { chat_output: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "find_ride", input: { metric: "distanceM", mode: "max" } }] }) },
      }), { status: 200 });
    }
    // 次轮：回传投影中距离最远命中的日期与显示值，引用 claim:loop:1:1。
    const match = request.toolResults[0]?.context.matches?.[0];
    const claim = match?.claims[0];
    return new Response(JSON.stringify({
      code: 0,
      data: { chat_output: JSON.stringify({
        schemaVersion: "ride-chat-output-v0.1",
        route: "autonomous_tools",
        reply: `距离最远的是${match?.rideDateLabel ?? ""}那次骑行，共 ${claim?.displayValue ?? ""} ${claim?.unit ?? ""}。`,
        claimIds: [claim?.claimId ?? ""],
        capabilityKeys: [],
      }) },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const { session } = await seededSession();
    const response = await chatRoute(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
      body: JSON.stringify({ text: "最近的骑行中，哪次距离最远？" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      decision: { route: string };
      modelInvoked: boolean;
      execution: string;
      reply: string;
      loopTrace?: { status: string; toolCalls: number; providerCalls: number; steps: Array<{ tool: string; status: string }> };
    };
    assert.deepEqual({
      route: body.decision.route,
      modelInvoked: body.modelInvoked,
      execution: body.execution,
    }, {
      route: "autonomous_tools",
      modelInvoked: true,
      execution: "validated",
    });
    assert.match(body.reply, /距离最远的是/);
    assert.deepEqual({
      status: body.loopTrace?.status,
      toolCalls: body.loopTrace?.toolCalls,
      providerCalls: body.loopTrace?.providerCalls,
      steps: body.loopTrace?.steps.map((step) => [step.tool, step.status]),
    }, {
      status: "completed",
      toolCalls: 1,
      providerCalls: 2,
      steps: [["find_ride", "completed"]],
    });
    // 首轮请求携带工具目录（白名单 + 锚点，无用户数据）；次轮回传脱敏投影。
    assert.equal(providerCalls.length, 2);
    const first = JSON.parse(providerCalls[0]!) as { toolCatalog?: { anchorRideId?: string } };
    assert.equal(first.toolCatalog?.anchorRideId, "anchor-e2e-ride");
    const second = JSON.parse(providerCalls[1]!) as { toolResults?: Array<{ context: { tool: string; matches?: Array<{ claims: Array<{ claimId: string }> }> } }> };
    assert.equal(second.toolResults?.[0]?.context.tool, "find_ride");
    assert.equal(second.toolResults?.[0]?.context.matches?.[0]?.claims[0]?.claimId, "claim:loop:1:1");
    assert.doesNotMatch(providerCalls.join("|"), new RegExp(session.userId));
    // 事件：chat_completed 携带循环轨迹（脱敏状态与计数）。
    const events = await getApplicationRepository().listDemoEvents(session.userId);
    const completed = events.filter((event) => event.type !== "chat_requested").at(-1);
    assert.ok(completed);
    assert.equal(completed.type, "chat_completed");
    assert.equal(completed.attributes?.route, "autonomous_tools");
    assert.equal(completed.attributes?.loopStatus, "completed");
    assert.equal(completed.attributes?.loopToolCalls, "1");
    assert.equal(completed.attributes?.loopProviderCalls, "2");
    assert.equal(completed.attributes?.loopSteps, "find_ride:completed");
    assert.doesNotMatch(JSON.stringify(events), new RegExp("anchor-e2e-ride"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
