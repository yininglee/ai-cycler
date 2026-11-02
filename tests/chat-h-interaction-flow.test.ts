import { withRequestedChatTool } from "./helpers/scripted-chat.ts";
import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/chat/route.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { calendarDate } from "../src/ui/ride-calendar.ts";
import { buildChatRecordInteraction } from "../src/chat/chat-artifacts.ts";
import { sanitizeChatInteractionPayload } from "../src/chat/chat-interaction.ts";
import { createChatSession, appendChatTurn, buildChatSessionSummaries, getActiveChatConversation, startChatConversation, refreshChatSnapshot } from "../src/chat/chat-session.ts";
import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import { makeChatDecision } from "../src/chat/chat-routing.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

function record(id: string, days = 1, hour = 8): RideRecord {
  const f = getRideFixture("l3-built-in-sample");
  const r = structuredClone({ activity: f.activity, series: f.series });
  const date = calendarDate(new Date(Date.now() - days * 86400000).toISOString())!;
  r.activity.rideId = id; r.series.rideId = id; r.activity.startTime = `${date}T${String(hour).padStart(2,"0")}:00:00+08:00`;
  return r;
}
function request(cookie: string, body: unknown) { return new Request("http://localhost/api/chat", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });

test("real chat API: semantic intent -> autonomous data/KB tools -> validated answer + same-source cards -> choice -> inherited choice", async () => {
  const env = { CHAT_CLASSIFIER_ENABLED: "true", CHAT_MODEL_ENABLED: "true", SILICONFLOW_API_TOKEN: "unit-test-only", SILICONFLOW_CLASSIFIER_MODEL_ID: "test-classifier", SILICONFLOW_CHAT_MODEL_ID: "test-agent" };
  const before = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const original = globalThis.fetch;
  let mode: "overview" | "single" = "overview";
  const invocations: any[] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    if (body.model === "test-classifier") return reply({ schemaVersion: "chat-classifier-v0.2", intent: mode === "overview" ? "level_assessment" : "ride_summary", needsClarification: false });
    const raw = body.messages[1].content.match(/<chat_request>\s*([\s\S]*?)\s*<\/chat_request>/)![1];
    const input = JSON.parse(raw); invocations.push(input);
    if (mode === "single" && !input.toolResults) return reply({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "get_ride_context", input: { dims: ["summary", "heart_rate"] } }] });
    if (mode === "overview" && !input.toolResults) return reply({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "get_ride_history", input: { rideId: null, windowDays: 30, metrics: ["distanceM", "avgPowerW"] } }, { tool: "search_knowledge_base", input: { keywords: ["心率"], maxEntries: 1 } }] });
    const history = input.toolResults?.find((r: any) => r.context?.tool === "get_ride_history")?.context;
    const knowledge = input.toolResults?.find((r: any) => r.context?.tool === "search_knowledge_base")?.context;
    const context = history ?? input.toolResults?.find((r: any) => r.context?.tool === "get_ride_context")?.context;
    assert.ok(context?.claims?.length);
    return reply({ schemaVersion: "ride-chat-output-v0.2", route: input.route, reply: mode === "overview" ? `近期有 ${history.rideCount} 次骑行。应结合骑行目的理解负荷，不能只凭均速判断进步。` : "已查看你选择的这次骑行，可以结合时长和强度理解这些数据。", claimIds: [context.claims[0].claimId], knowledgeIds: knowledge ? [knowledge.items[0].knowledgeId] : [], capabilityKeys: [] });
  }) as typeof fetch;
  try {
    const session = resolveOrCreateRequestSession(new Request("http://localhost")); const cookie = session.setCookie!.split(";")[0];
    const repo = getApplicationRepository();
    for (let i = 0; i < 7; i++) await repo.saveRide(session.userId, record(`interaction-${i}`, i < 2 ? 1 : i, i === 0 ? 8 : 18));
    await repo.saveRide(session.userId, record("old-outside", 80));
    const response = await POST(request(cookie, { text: "最近骑行表现怎么样？" }));
    const body = await response.json();
    assert.equal(body.execution, "validated", JSON.stringify(body));
    assert.equal(body.loopTrace.toolCalls, 2);
    assert.equal(body.artifact.kind, "ride_list"); assert.equal(body.artifact.payload.items.length, 7);
    assert.match(body.reply, /7 次/); assert.equal(body.choice, undefined); assert.equal(body.rideAnchor, undefined);
    assert.ok(!body.artifact.payload.items.some((r: any) => r.rideId === "old-outside"));
    const second = body.artifact.payload.items.find((r: any) => r.rideId === "interaction-0");
    assert.match(second.dateLabel, /08:00/);
    assert.equal(body.providerRawOutput, undefined); assert.equal(body.droppedFields, undefined);
    assert.ok(invocations.at(-1).toolResults.some((r: any) => r.context.tool === "search_knowledge_base"));
    assert.equal(invocations.at(-1).toolResults.find((r: any) => r.context.tool === "get_ride_history").context.rows[0].rideId, "interaction-1");
    const queriedWindow = invocations.at(-1).toolResults.find((r: any) => r.context.tool === "get_ride_history").context;
    assert.equal(queriedWindow.windowEndDate, calendarDate(new Date().toISOString()));
    assert.equal((Date.parse(queriedWindow.windowEndDate) - Date.parse(queriedWindow.windowStartDate)) / 86400000, 29);
    assert.deepEqual(queriedWindow.limitations, []);
    mode = "single";
    const chosen = await (await POST(request(cookie, { text: "这次骑行表现怎么样？", choice: { kind: "ride", id: second.rideId } }))).json();
    assert.equal(chosen.execution, "validated", JSON.stringify(chosen));
    assert.equal(chosen.artifact.payload.items[0].rideId, "interaction-0");
    assert.deepEqual(chosen.choice, { kind: "ride", id: "interaction-0" });
    const summaries = [{ kind: "session_turn", question: "这次骑行表现怎么样？", route: chosen.decision.route, rideAnchor: chosen.rideAnchor, choice: chosen.choice }];
    const followup = await (await POST(request(cookie, { text: "那心率呢？", summaries }))).json();
    assert.equal(followup.execution, "validated", JSON.stringify(followup));
    assert.equal(followup.artifact.payload.items[0].rideId, "interaction-0");
    mode = "overview";
    const overallAgain = await (await POST(request(cookie, { text: "这阵子练得如何？", summaries }))).json();
    assert.equal(overallAgain.artifact.payload.items.length, 7);
    assert.equal(overallAgain.choice, undefined); assert.equal(overallAgain.rideAnchor, undefined);
    const serialized = JSON.stringify(body.artifact);
    assert.doesNotMatch(serialized, /fileName|latitude|longitude|rawText|apiToken/);
  } finally { globalThis.fetch = original; for (const [k,v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test("choice rejects malformed/date IDs, foreign ownership, removed records and blank-view records before generation", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost")); const cookie = session.setCookie!.split(";")[0]; const repo = getApplicationRepository();
  await repo.saveRide("someone-else", record("foreign"));
  for (const choice of [{ kind: "ride", id: "2026-11-01" }, { kind: "ride", id: "contains space" }, { kind: "goal", id: "foreign" }]) assert.equal((await POST(request(cookie, { text: "这次怎么样", choice }))).status, 400);
  assert.equal((await POST(request(cookie, { text: "这次怎么样", choice: { kind: "ride", id: "foreign" } }))).status, 404);
  await repo.saveRide(session.userId, record("hidden"));
  await repo.saveProfile(session.userId, { schemaVersion: "0.1", updatedAt: new Date().toISOString(), ux: { mode: "blank", blankSince: "2999-01-01T00:00:00Z" } });
  assert.equal((await POST(request(cookie, { text: "这次怎么样", choice: { kind: "ride", id: "hidden" } }))).status, 404);
});

test("ambiguous same-day query offers actual candidates with unique IDs and select action", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost")); const cookie = session.setCookie!.split(";")[0]; const repo = getApplicationRepository();
  const a = record("same-a", 1, 8), b = record("same-b", 1, 18); await repo.saveRide(session.userId, a); await repo.saveRide(session.userId, b); await repo.saveRide(session.userId, record("unrelated", 9));
  const date = calendarDate(a.activity.startTime!)!;
  await withRequestedChatTool("get_ride_context", { rideRef: { date }, dims: ["heart_rate"] }, async () => {
  const body = await (await POST(request(cookie, { text: `${date}骑行平均心率多少？` }))).json();
  assert.equal(body.decision.action, "select", JSON.stringify(body));
  assert.deepEqual(new Set(body.artifact.payload.items.map((i: any) => i.rideId)), new Set(["same-a", "same-b"]));
  assert.equal(body.choices.length, 2);
  assert.equal(body.modelInvoked, true);
  });
});

test("recent defaults use today's global window, while explicitly supplied tool windows remain intact", async () => {
  const repo = getApplicationRepository(); await repo.saveRide("window-owner", record("window-old", 80));
  const runner = createChatToolLoopRunner(repo, "window-owner");
  const start = await runner.startLoop({ text: "最近骑行表现怎么样？", decision: makeChatDecision("level_assessment", "none", "LEVEL_ASSESSMENT", 10) }); assert.ok(start.ok);
  if (!start.ok) return;
  const receipts = await runner.executeLoopCalls({ calls: [{ tool: "get_ride_history", input: {} }], anchorRideId: start.anchorRideId, allowedRideIds: [start.anchorRideId] });
  const result = receipts[0]; assert.equal(result.status, "completed");
  if (result.status === "completed" && result.result.tool === "get_ride_history") { assert.equal(result.result.windowDays, 30); assert.equal(result.result.rideCount, 0); }
  const explicit = await runner.executeLoopCalls({ calls: [{ tool: "get_ride_history", input: { rideId: null, windowDays: 90 } }], anchorRideId: start.anchorRideId, allowedRideIds: [start.anchorRideId] });
  assert.equal(explicit[0].status, "completed");
  if (explicit[0].status === "completed" && explicit[0].result.tool === "get_ride_history") { assert.equal(explicit[0].result.windowDays, 90); assert.equal(explicit[0].result.rideCount, 1); }
});

test("empty history never invents record cards or a selected ride", async () => {
  const previousEnabled = process.env.CHAT_MODEL_ENABLED, previousToken = process.env.SILICONFLOW_API_TOKEN;
  process.env.CHAT_MODEL_ENABLED = "true"; process.env.SILICONFLOW_API_TOKEN = "unit-test-only";
  const original = globalThis.fetch;
  globalThis.fetch = (async () => reply({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "get_ride_history", input: { rideId: null, windowDays: 30 } }] })) as typeof fetch;
  try {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  const body = await (await POST(request(cookie, { text: "最近骑行表现怎么样？" }))).json();
  assert.equal(body.fallbackCode, "TOOLS_LOOP_NO_MATCH");
  assert.match(body.reply, /同步或导入/);
  assert.equal(body.artifact, undefined); assert.equal(body.choice, undefined);
  assert.equal(body.loopTrace.providerCalls, 1);
  } finally {
    globalThis.fetch = original;
    if (previousEnabled === undefined) delete process.env.CHAT_MODEL_ENABLED; else process.env.CHAT_MODEL_ENABLED = previousEnabled;
    if (previousToken === undefined) delete process.env.SILICONFLOW_API_TOKEN; else process.env.SILICONFLOW_API_TOKEN = previousToken;
  }
});

test("a deleted inherited record cannot silently switch to the remaining latest ride", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  await getApplicationRepository().saveRide(session.userId, record("remaining"));
  await withRequestedChatTool("get_ride_context", { dims: ["heart_rate"] }, async () => {
    const response = await POST(request(cookie, { text: "那心率呢？", summaries: [{ kind: "session_turn", question: "分析这次骑行", route: "current_ride", choice: { kind: "ride", id: "removed" } }] }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.fallbackCode, "TOOLS_REFERENCE_NEEDED");
    assert.equal(body.choice, undefined);
    assert.equal(body.rideScope, "pending");
    assert.ok(body.choices.some((choice: any) => choice.id === "remaining"));
  });
});

test("storage persists validated interaction and choice, refresh preserves the chat and new chats inherit no chosen record", () => {
  const snapshot = buildChatHomeSnapshot([]);
  const state = appendChatTurn(createChatSession(snapshot), "选这次", "已查询", "typed_input", { route: "current_ride", choice: { kind: "ride", id: "unique" } }, { artifact: { kind: "ride_list", payload: { items: [{ rideId: "unique", dateLabel: "11月1日 08:00" }], totalCount: 1, truncated: false } } });
  const refreshed = refreshChatSnapshot(state, { ...snapshot, totalRideCount: 7 });
  assert.equal(buildChatSessionSummaries(getActiveChatConversation(refreshed)).at(-1)?.choice?.id, "unique");
  assert.deepEqual(buildChatSessionSummaries(getActiveChatConversation(startChatConversation(refreshed, snapshot))), []);
  assert.equal(getActiveChatConversation(refreshed).messages.at(-1)?.interaction?.artifact?.kind, "ride_list");
  assert.equal(sanitizeChatInteractionPayload({ artifact: { kind: "ride_list", payload: { items: [{ rideId: "unique", dateLabel: "11月1日", title: "标题", unsupported: true }] } } }).artifact, undefined);
  assert.deepEqual(buildChatRecordInteraction([], [record("not-queried")]), {});
});

test("a stale choice in summaries never intercepts an independent safety response", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  const response = await POST(request(cookie, { text: "胸痛并且呼吸困难，怎么办？", summaries: [{ kind: "session_turn", question: "分析这次骑行", route: "current_ride", choice: { kind: "ride", id: "removed" } }] }));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.decision.route, "safety_stop");
  assert.equal(body.choice, undefined); assert.equal(body.artifact, undefined); assert.equal(body.modelInvoked, false);
});
