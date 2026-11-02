import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { runChatAgent, type ChatProvider } from "../src/chat/chat-agent.ts";
import { makeChatDecision } from "../src/chat/chat-routing.ts";
import { activeChatCapabilities } from "../src/chat/chat-capability-registry.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";
import { POST } from "../app/api/chat/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";

function repository(withRide = true): ApplicationRepository {
  const fixture = getRideFixture("l3-built-in-sample");
  const record = structuredClone({ activity: fixture.activity, series: fixture.series });
  record.activity.rideId = "arch-ride"; record.series.rideId = "arch-ride";
  return {
    listRides: async () => withRide ? [{ record }] : [],
    getRide: async (_owner: string, id: string) => withRide && id === "arch-ride" ? record : null,
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
}

const toolRequest = (tool: string, input: unknown) => ({ rawText: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool, input }] }) });

test("ARCH-02: every legacy data hint uses the same model loop, catalog and evidence rules", async () => {
  const cases = [
    ["current_ride", "CURRENT_RIDE"], ["capabilities", "CAPABILITIES"],
    ["history_compare", "HISTORY_COMPARE"], ["autonomous_tools", "AUTONOMOUS_TOOLS"],
    ["kb_qa", "KB_QA"], ["level_assessment", "LEVEL_ASSESSMENT"],
  ] as const;
  for (const [route, reason] of cases) {
    let calls = 0;
    const provider: ChatProvider = { async run(input) {
      calls++;
      assert.equal(input.route, "autonomous_tools");
      assert.equal(input.toolCatalog?.tools.length, 14);
      assert.ok(input.toolCatalog.tools.some(entry => entry.tool === "compare_rides"));
      assert.ok(input.toolCatalog.tools.some(entry => entry.tool === "search_knowledge_base"));
      if (!input.toolResults) return toolRequest("get_ride_context", { rideRef: { ordinal: -1 }, dims: ["summary"] });
      const context = input.toolResults[0].context;
      assert.ok("claims" in context && context.claims.length);
      return { rawText: JSON.stringify({ schemaVersion: "ride-chat-output-v0.2", route: input.route,
        reply: "已查看这次骑行的数据，结论以实际记录为依据。", claimIds: [context.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] }) };
    } };
    const result = await runChatAgent({ text: "请解释所选骑行的数据。", decision: makeChatDecision(route, "none", reason, 12),
      provider, loopRunner: createChatToolLoopRunner(repository(), "owner"), anchorOverride: { rideId: "arch-ride" },
      toolRunner: { async run() { throw new Error("fixed executor must never run"); } },
    });
    assert.equal(result.execution, "validated", JSON.stringify(result));
    assert.equal(result.executionRoute, "agent_loop");
    assert.equal(result.decision.route, route, "legacy local-history metadata must remain readable");
    assert.equal(result.loopTrace?.toolCalls, 1);
    assert.equal(calls, 2);
    assert.equal(result.toolTrace, undefined);
  }
});

test("ARCH-02: knowledge-only answers work without any ride and require retrieved evidence", async () => {
  const provider: ChatProvider = { async run(input) {
    if (!input.toolResults) return toolRequest("search_knowledge_base", { keywords: ["心率"], maxEntries: 1 });
    const context = input.toolResults[0].context;
    assert.equal(context.tool, "search_knowledge_base");
    if (context.tool !== "search_knowledge_base") throw new Error("expected KB result");
    assert.ok(context.items.length);
    return { rawText: JSON.stringify({ schemaVersion: "ride-chat-output-v0.2", route: input.route,
      reply: "心率可以帮助理解训练强度，个人判断还需结合实际记录。", claimIds: [], capabilityKeys: [], knowledgeIds: [context.items[0].knowledgeId] }) };
  } };
  const result = await runChatAgent({ text: "解释心率与训练强度。", decision: makeChatDecision("kb_qa", "none", "KB_QA", 12),
    provider, loopRunner: createChatToolLoopRunner(repository(false), "owner") });
  assert.equal(result.execution, "validated", JSON.stringify(result));
  assert.equal(result.outputValidation?.referencedKnowledgeCount, 1);
  assert.equal(result.outputValidation.referencedClaimCount, 0);
});

test("ARCH-02: data and knowledge from one query can be cited together under any old intent", async () => {
  const provider: ChatProvider = { async run(input) {
    if (!input.toolResults) return { rawText: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [
      { tool: "get_ride_context", input: { dims: ["summary"] } },
      { tool: "search_knowledge_base", input: { keywords: ["心率"], maxEntries: 1 } },
    ] }) };
    const data = input.toolResults.find(entry => entry.context.tool === "get_ride_context")!.context;
    const knowledge = input.toolResults.find(entry => entry.context.tool === "search_knowledge_base")!.context;
    assert.ok("claims" in data && data.claims.length);
    assert.equal(knowledge.tool, "search_knowledge_base");
    if (knowledge.tool !== "search_knowledge_base") throw new Error("expected knowledge");
    return { rawText: JSON.stringify({ schemaVersion: "ride-chat-output-v0.2", route: input.route,
      reply: "训练表现需要结合实际数据与训练目的理解。", claimIds: [data.claims[0].claimId], capabilityKeys: [], knowledgeIds: [knowledge.items[0].knowledgeId] }) };
  } };
  const result = await runChatAgent({ text: "解释这次数据与训练原理。", decision: makeChatDecision("current_ride", "none", "CURRENT_RIDE", 12),
    provider, loopRunner: createChatToolLoopRunner(repository(), "owner"), anchorOverride: { rideId: "arch-ride" } });
  assert.equal(result.execution, "validated", JSON.stringify(result));
  assert.equal(result.loopTrace?.toolCalls, 2);
  assert.equal(result.outputValidation?.referencedClaimCount, 1);
  assert.equal(result.outputValidation?.referencedKnowledgeCount, 1);
});

test("ARCH-02: unimplemented writes stay outside both model catalog and execution admission", async () => {
  assert.ok(activeChatCapabilities().every(capability => capability.effect === "read"));
  const result = await runChatAgent({ text: "查看骑行数据。", decision: makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", 12),
    loopRunner: createChatToolLoopRunner(repository(), "owner"),
    provider: { async run() { return toolRequest("generate_training_plan", {}); } },
  });
  assert.equal(result.fallbackCode, "TOOLS_LOOP_INVALID_TOOL_CALL");
  assert.equal(result.loopTrace?.steps[0]?.status, "rejected");
});

test("ARCH-02: L0 boundaries override benign hints and never execute a provider", async () => {
  for (const [text, expected] of [["胸痛怎么办？", "stop"], ["你好", "deterministic"]] as const) {
    const decision = text.includes("计划") ? makeChatDecision("training_plan", "none", "TRAINING_PLAN", text.length)
      : makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", text.length);
    const result = await runChatAgent({ text, decision,
      provider: { async run() { throw new Error("must not execute"); } },
      loopRunner: { async startLoop() { throw new Error("must not start"); }, async executeLoopCalls() { throw new Error("must not execute"); } },
    });
    assert.equal(result.executionRoute, expected);
    assert.equal(result.modelInvoked, false);
  }
});

function request(cookie: string, body: unknown) {
  return new Request("http://localhost/api/chat", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("ARCH-02 API: stale choices cannot suppress an independent safety answer or exact aggregate", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  for (const [text, expected] of [["胸痛怎么办？", "stop"], ["我总共骑了多少？", "deterministic"]] as const) {
    const response = await POST(request(cookie, { text, choice: { kind: "ride", id: "deleted-ride" },
      summaries: [{ kind: "session_turn", question: "分析这次", route: "current_ride", choice: { kind: "ride", id: "deleted-ride" } }] }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.executionRoute, expected);
    assert.equal(body.modelInvoked, false);
    assert.equal(body.choice, undefined);
  }
});

test("ARCH-02 API: unclassified knowledge wording enters the actual model/tool chain", async () => {
  const environment = { CHAT_CLASSIFIER_ENABLED: "false", CHAT_MODEL_ENABLED: "true", CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const original = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = (async (_url, options) => {
    modelCalls++;
    const body = JSON.parse(String(options?.body));
    const raw = body.messages[1].content.match(/<chat_request>\s*([\s\S]*?)\s*<\/chat_request>/)![1];
    const input = JSON.parse(raw);
    assert.equal(input.route, "autonomous_tools");
    const knowledge = input.toolResults?.find((entry: any) => entry.context.tool === "search_knowledge_base")?.context;
    const output = knowledge ? { schemaVersion: "ride-chat-output-v0.2", route: input.route,
      reply: "心率可以辅助理解训练强度。", claimIds: [], capabilityKeys: [], knowledgeIds: [knowledge.items[0].knowledgeId] }
      : { schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "search_knowledge_base", input: { keywords: ["心率"], maxEntries: 1 } }] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const session = resolveOrCreateRequestSession(new Request("http://localhost"));
    const response = await POST(request(session.setCookie!.split(";")[0], { text: "如何理解有氧区间？" }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.execution, "validated", JSON.stringify(body));
    assert.equal(body.executionRoute, "agent_loop");
    assert.equal(body.loopTrace.toolCalls, 1);
    assert.equal(body.outputValidation.referencedKnowledgeCount, 1);
    assert.equal(body.artifact, undefined, "knowledge alone must not manufacture ride cards");
    assert.equal(modelCalls, 2);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ARCH-02: compound aggregate questions use the loop while plain totals remain exact", async () => {
  const { classifyChatInput } = await import("../src/chat/chat-routing.ts");
  const text = "本周骑了多少，为什么感觉更累？";
  let calls = 0;
  const { resolveChatExecutionRouting } = await import("../src/chat/chat-classifier.ts");
  const resolution = await resolveChatExecutionRouting({ text, ruleDecision: classifyChatInput(text), requestId: "compound-test" });
  const result = await runChatAgent({ text, decision: resolution.decision!,
    loopRunner: createChatToolLoopRunner(repository(), "owner"),
    provider: { async run() { calls++; return toolRequest("search_knowledge_base", { keywords: ["负荷"], maxEntries: 1 }); } },
  });
  assert.equal(result.executionRoute, "agent_loop");
  assert.equal(result.decision.allowModel, true);
  assert.ok(calls > 0);
  const total = await runChatAgent({ text: "我总共骑了多少？", decision: classifyChatInput("我总共骑了多少？"), aggregateRecords: [] });
  assert.equal(total.executionRoute, "deterministic");
  assert.equal(total.decision.allowModel, false);
  assert.equal(total.modelInvoked, false);
});

test("ARCH-02: rule-era historical data gaps are admitted, unimplemented plans remain explicit", async () => {
  const { classifyChatInput } = await import("../src/chat/chat-routing.ts");
  const { resolveChatExecutionRouting } = await import("../src/chat/chat-classifier.ts");
  for (const [text, expected] of [["分析那次骑行", "autonomous_tools"], ["我的体能水平怎么样？", "level_assessment"], ["帮我制定训练计划", "training_plan"]] as const) {
    const resolution = await resolveChatExecutionRouting({ text, ruleDecision: classifyChatInput(text), requestId: "arch-test" });
    assert.equal(resolution.decision?.route, expected);
  }
});

test("ARCH execution: the model can resolve a ride, then use its authorized ID for dependent tools", async () => {
  let round = 0;
  const provider: ChatProvider = { async run(input) {
    round++;
    if (round === 1) return toolRequest("get_ride_context", { rideRef: { ordinal: -1 }, dims: ["summary"] });
    if (round === 2) {
      const context = input.toolResults![0].context;
      assert.equal(context.tool, "get_ride_context");
      if (context.tool !== "get_ride_context") throw new Error("expected resolved ride");
      assert.equal(context.rideId, "arch-ride");
      return toolRequest("get_capabilities", { rideId: context.rideId, caps: ["power"] });
    }
    const context = input.toolResults![1].context;
    assert.ok("claims" in context);
    return { rawText: JSON.stringify({ schemaVersion: "ride-chat-output-v0.2", route: input.route,
      reply: "已核实该记录的数据可用性。", claimIds: [context.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] }) };
  } };
  const result = await runChatAgent({ text: "最近一次有哪些数据？", decision: makeChatDecision("capabilities", "none", "CAPABILITIES", 12),
    provider, loopRunner: createChatToolLoopRunner(repository(), "owner") });
  assert.equal(result.execution, "validated", JSON.stringify(result));
  assert.equal(result.loopTrace?.toolCalls, 2);
});
