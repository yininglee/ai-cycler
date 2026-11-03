import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { POST as chat } from "../app/api/chat/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { executeChatTool, parseChatToolInvocation } from "../src/chat/chat-tools.ts";
import { parseChatHistoryDateRange } from "../src/chat/chat-history-range.ts";
import { appendChatTurn, buildChatSessionSummaries, createChatSession, getActiveChatConversation, startChatConversation } from "../src/chat/chat-session.ts";
import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import { sanitizeChatSummaries } from "../src/chat/chat-routing.ts";
import { lastChatRideChoice } from "../src/chat/chat-context.ts";

function owner() {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  return { id: session.userId, request: (body: unknown) => new Request("http://localhost/api/chat", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }) };
}
function ride(id: string, date: string, power = 111) {
  const fixture = getRideFixture("l3-fit-power");
  const record = structuredClone({ activity: fixture.activity, series: fixture.series });
  record.activity.rideId = id; record.series.rideId = id; record.activity.startTime = date;
  record.activity.metrics.avgPowerW!.value = power;
  return record;
}
type RequestData = { text: string; route: string; repairInstruction?: string; evidenceRequest?: string; toolCatalog: { anchorRideId: string }; toolCallError?: { tool: string }; toolResults?: Array<{ context: any }>; sessionSummaries?: Array<{ answerContext?: string }> };
const tool = (name: string, input: unknown) => ({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: name, input }] });
const answer = (request: RequestData, reply: string, claimIds: string[] = [], knowledgeIds: string[] = []) => ({ schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "answer", reply, claimIds, capabilityKeys: [], knowledgeIds });
async function scripted(reply: (request: RequestData) => unknown, run: () => Promise<void>) {
  const env = { CHAT_MODEL_ENABLED: "true", CHAT_CLASSIFIER_ENABLED: "false", CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const original = globalThis.fetch; Object.assign(process.env, env);
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const request = JSON.parse(body.messages[1].content.split("<chat_request>\n")[1].split("\n</chat_request>")[0]);
    request.repairInstruction = body.messages[1].content.split("<repair_instruction>\n")[1].split("\n</repair_instruction>")[0];
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply(request)) } }] });
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("SCN-03: explicit Shanghai dates include both boundaries, all same-day rides and historical ranges", async () => {
  const f = owner(), repository = getApplicationRepository();
  for (const record of [ride("before", "2026-10-31T15:59:59.999Z"), ride("am", "2026-10-31T16:00:00Z"), ride("pm", "2026-11-01T15:59:59.999Z"), ride("after", "2026-11-01T16:00:00Z"), ride("old", "2019-01-01T00:00:00Z")]) await repository.saveRide(f.id, record);
  const result = await executeChatTool(repository, f.id, parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, dateRange: { startDate: "2026-11-01", endDate: "2026-11-01" }, metrics: ["avgPowerW"] } }));
  assert.equal(result.tool, "get_ride_history"); if (result.tool !== "get_ride_history") return;
  assert.equal(result.rideCount, 2); assert.deepEqual(result.rows.map(row => row.rideId), ["pm", "am"]);
  assert.equal(result.windowDays, 1); assert.equal(result.windowStartDate, "2026-11-01"); assert.equal(result.windowEndDate, "2026-11-01");
  const old = await executeChatTool(repository, f.id, parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, dateRange: { startDate: "2019-01-01", endDate: "2019-01-01" }, metrics: ["distanceM"] } }));
  assert.equal(old.tool === "get_ride_history" && old.rideCount, 1);
  const another = owner();
  const hidden = await executeChatTool(repository, another.id, parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, dateRange: { startDate: "2026-11-01", endDate: "2026-11-01" }, metrics: ["distanceM"] } }));
  assert.equal(hidden.tool === "get_ride_history" && hidden.rideCount, 0);
});

test("SCN-03: invalid, reversed, overlong and mixed ranges are rejected without shortening", () => {
  for (const dateRange of [{ startDate: "2026-02-30", endDate: "2026-03-01" }, { startDate: "2026-11-02", endDate: "2026-11-01" }, { startDate: "2024-01-01", endDate: "2024-12-31" }, { startDate: "2026-01-01" }]) assert.equal(parseChatHistoryDateRange(dateRange), undefined);
  const dateRange = { startDate: "2026-01-01", endDate: "2026-12-31" };
  assert.ok(parseChatHistoryDateRange(dateRange));
  for (const input of [{ rideId: "some-ride", dateRange, metrics: ["distanceM"] }, { rideId: null, dateRange, windowDays: 30, metrics: ["distanceM"] }]) assert.throws(() => parseChatToolInvocation({ tool: "get_ride_history", input }));
});

test("SCN-03: API overview -> explicit old ride -> one argument correction -> knowledge -> overview", async () => {
  const f = owner(), repository = getApplicationRepository();
  await repository.saveRide(f.id, ride("selected-am", "2026-10-31T16:05:00Z", 111));
  await repository.saveRide(f.id, ride("latest-pm", "2026-11-01T10:00:00Z", 222));
  let state = createChatSession(buildChatHomeSnapshot([])); let repaired = false;
  const summaries = () => buildChatSessionSummaries(getActiveChatConversation(state));
  await scripted(request => {
    if (request.text === "这次的平均功率是多少？") {
      assert.equal(request.toolCatalog.anchorRideId, "selected-am");
      if (!request.toolResults) {
        if (!request.toolCallError) return tool("get_ride_context", { dims: ["avgPowerW"] });
        repaired = true; assert.equal(request.toolCallError.tool, "get_ride_context");
        return tool("get_ride_context", { dims: ["power"] });
      }
      const context = request.toolResults[0].context;
      assert.equal(context.rideId, "selected-am");
      const power = context.claims.find((claim: any) => claim.key === "avgPowerW");
      return answer(request, `这次的平均功率为${power.value}瓦。`, [power.claimId]);
    }
    if (request.text === "这个指标是什么意思？") {
      assert.ok(request.sessionSummaries?.some(summary => summary.answerContext?.includes("平均功率")));
      if (!request.toolResults) return tool("search_knowledge_base", { dimensionIds: ["powerOutput"] });
      const context = request.toolResults[0].context;
      return answer(request, "功率表示骑行时的输出，解读还需要结合可用数据和骑行条件。", [], [context.items[0].knowledgeId]);
    }
    if (!request.toolResults) return tool("get_ride_history", { dateRange: { startDate: "2026-11-01", endDate: "2026-11-01" } });
    const context = request.toolResults[0].context;
    return answer(request, "该范围共有2次骑行，不能只凭次数判断能力变化。", [context.claims[0].claimId]);
  }, async () => {
    const overview = await (await chat(f.request({ text: "回顾2026年11月1日的整体骑行表现" }))).json();
    assert.equal(overview.execution, "validated"); assert.equal(overview.rideScope, "overview"); assert.equal(overview.choice, undefined);
    assert.deepEqual(overview.artifact.payload.items.map((item: any) => item.rideId), ["latest-pm", "selected-am"]);
    const selected = await (await chat(f.request({ text: "这次的平均功率是多少？", choice: { kind: "ride", id: "selected-am" } }))).json();
    assert.equal(selected.execution, "validated"); assert.match(selected.reply, /111/); assert.doesNotMatch(selected.reply, /222/);
    assert.ok(repaired); assert.equal(selected.loopTrace.toolArgumentRepairAttempts, 1);
    assert.equal(selected.loopTrace.toolCalls, 1); assert.equal(selected.loopTrace.providerCalls, 3);
    state = appendChatTurn(state, "这次的平均功率是多少？", selected.reply, "typed_input", { route: selected.decision.route, choice: selected.choice });
    const knowledge = await (await chat(f.request({ text: "这个指标是什么意思？", summaries: summaries() }))).json();
    assert.equal(knowledge.execution, "validated"); assert.match(knowledge.reply, /知识依据：.*功率/);
    state = appendChatTurn(state, "这个指标是什么意思？", knowledge.reply, "typed_input", { route: knowledge.decision.route });
    assert.equal(lastChatRideChoice(summaries())?.id, "selected-am");
    const back = await (await chat(f.request({ text: "再回顾2026年11月1日的整体骑行表现", summaries: summaries() }))).json();
    assert.equal(back.rideScope, "overview"); assert.equal(back.choice, undefined);
    state = appendChatTurn(state, "回顾整体", back.reply, "typed_input", { route: back.decision.route, rideScope: back.rideScope });
    assert.equal(lastChatRideChoice(summaries()), undefined);
    assert.deepEqual(buildChatSessionSummaries(getActiveChatConversation(startChatConversation(state, buildChatHomeSnapshot([])))), []);
  });
});

test("SCN-03: one-row date range remains an overview rather than silently selecting that ride", async () => {
  const f = owner(); await getApplicationRepository().saveRide(f.id, ride("only", "2025-04-01T03:00:00Z"));
  await scripted(request => !request.toolResults ? tool("get_ride_history", { dateRange: { startDate: "2025-04-01", endDate: "2025-04-01" } })
    : answer(request, "这个日期范围只有1次记录，不能判断趋势。", [request.toolResults[0].context.claims[0].claimId]), async () => {
    const result = await (await chat(f.request({ text: "回顾2025年4月1日的骑行表现" }))).json();
    assert.equal(result.execution, "validated"); assert.equal(result.rideScope, "overview"); assert.equal(result.choice, undefined); assert.equal(result.artifact.payload.items.length, 1);
  });
});

test("SCN-03: correction is bounded, unknown and unauthorized tools never get correction", async () => {
  const f = owner(); let calls = 0;
  for (const [name, input, expected] of [["get_ride_context", { dims: ["invalid"] }, 2], ["delete_ride", {}, 1], ["get_ride_context", { rideRef: { rideId: "not-owned" } }, 1]] as const) {
    calls = 0;
    await scripted(() => { calls++; return tool(name, input); }, async () => {
      const result = await (await chat(f.request({ text: "请看一下骑行数据" }))).json();
      assert.equal(result.fallbackCode, "TOOLS_LOOP_INVALID_TOOL_CALL"); assert.equal(calls, expected); assert.equal(result.loopTrace.toolCalls, 0);
      assert.equal(result.artifact, undefined); assert.doesNotMatch(result.reply, /不在.*范围|换成支持的问法/);
    });
  }
});

test("SCN-03: missing metrics are not zero totals; unknown knowledge reports a distinct boundary", async () => {
  const f = owner(), record = ride("missing", "2020-03-04T00:00:00Z");
  delete record.activity.metrics.distanceM; delete record.activity.metrics.elevationGainM;
  await getApplicationRepository().saveRide(f.id, record);
  const result = await executeChatTool(getApplicationRepository(), f.id, parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, dateRange: { startDate: "2020-03-04", endDate: "2020-03-04" }, metrics: ["distanceM"] } }));
  if (result.tool !== "get_ride_history") assert.fail();
  assert.equal(result.rideCount, 1); assert.equal(result.claims.some(claim => claim.key === "distanceM"), false);
  assert.ok(result.reasonCodes.includes("METRIC_MISSING")); assert.match(result.limitations.join(""), /不将缺失当作零/);
  await scripted(() => tool("search_knowledge_base", { keywords: ["uncoveredxyz987"] }), async () => {
    const response = await (await chat(f.request({ text: "解释这个骑行概念" }))).json();
    assert.equal(response.fallbackCode, "TOOLS_LOOP_NO_MATCH"); assert.match(response.reply, /知识库尚未覆盖/);
  });
});

test("SCN-03: answer context is bounded and cannot authorize historical numbers as evidence", async () => {
  assert.equal(sanitizeChatSummaries([{ kind: "session_turn", question: "指标", route: "kb_qa", answerContext: "x".repeat(161) }]).dropped, true);
  const f = owner();
  await scripted(request => !request.toolResults ? tool("get_user_context", {}) : answer(request, "你的FTP为999瓦。", [request.toolResults[0].context.claims[0].claimId]), async () => {
    const result = await (await chat(f.request({ text: "查看我的基础资料", summaries: [{ kind: "session_turn", route: "kb_qa", question: "之前说过什么", answerContext: "你的FTP为999瓦。" }] }))).json();
    assert.equal(result.fallbackCode, "REPAIR_FAILED"); assert.doesNotMatch(result.reply, /999/);
  });
});

test("SCN-03: malformed final output is corrected using the current seven-field contract", async () => {
  const f = owner(); let calls = 0;
  await scripted(request => {
    calls++;
    if (!request.toolResults) return tool("get_user_context", {});
    const output = answer(request, "当前资料以已保存状态为准。", [request.toolResults[0].context.claims[0].claimId]);
    if (!request.repairInstruction) return { ...output, responseKind: "invalid" };
    assert.match(request.repairInstruction, /ride-chat-output-v0\.3/); assert.match(request.repairInstruction, /responseKind/);
    return output;
  }, async () => {
    const result = await (await chat(f.request({ text: "看看当前资料" }))).json();
    assert.equal(result.execution, "repaired"); assert.equal(result.repairAttempts, 1); assert.equal(calls, 3);
  });
});

test("SCN-03: premature no-data answer gets one opportunity to choose evidence tools", async () => {
  const f = owner(); let calls = 0;
  await scripted(request => {
    calls++;
    if (!request.toolResults && !request.evidenceRequest) return answer(request, "当前没有已提供的资料。");
    if (!request.toolResults) return tool("get_user_context", {});
    return answer(request, "已读取当前资料状态。", [request.toolResults[0].context.claims[0].claimId]);
  }, async () => {
    const result = await (await chat(f.request({ text: "看看当前资料" }))).json();
    assert.equal(result.execution, "validated"); assert.equal(result.loopTrace.evidenceRecoveryAttempts, 1);
    assert.equal(result.loopTrace.toolCalls, 1); assert.equal(calls, 3);
  });
});
