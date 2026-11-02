import { withRequestedChatTool } from "./helpers/scripted-chat.ts";
import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { lastChatRideChoice } from "../src/chat/chat-context.ts";
import { lastSummarizedAnchor, resolveRideAnchor, rideIdentityReply } from "../src/chat/chat-ride-anchor.ts";
import { sanitizeChatSummaries, makeChatDecision, type ChatSessionSummary } from "../src/chat/chat-routing.ts";
import { appendChatTurn, buildChatSessionSummaries, createChatSession, getActiveChatConversation, startChatConversation, storeChatSession, readStoredChatSession } from "../src/chat/chat-session.ts";
import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import { buildChatRecordInteraction } from "../src/chat/chat-artifacts.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ChatToolResult } from "../src/chat/chat-tools.ts";
import { POST } from "../app/api/chat/route.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { runChatAgent } from "../src/chat/chat-agent.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";

function ride(id: string, day: string) {
  const f = getRideFixture("l3-built-in-sample");
  const r = structuredClone({ activity: f.activity, series: f.series });
  r.activity.rideId = id; r.series.rideId = id; r.activity.startTime = `${day}T08:00:00+08:00`;
  return r;
}
const chosen: ChatSessionSummary = { kind: "session_turn", question: "看这次", route: "current_ride", rideAnchor: "2026-10-30", choice: { kind: "ride", id: "chosen" } };
const neutral: ChatSessionSummary = { kind: "session_turn", question: "谢谢", route: "social" };

test("ARCH-03: neutral turns preserve choice, explicit reset blocks both IDs and legacy dates", () => {
  assert.deepEqual(lastChatRideChoice([chosen, neutral]), chosen.choice);
  for (const rideScope of ["overview", "cleared"] as const) {
    const reset: ChatSessionSummary = { kind: "session_turn", question: "近期整体", route: "autonomous_tools", rideScope };
    assert.equal(lastChatRideChoice([chosen, reset, neutral]), undefined);
    assert.equal(lastSummarizedAnchor([chosen, reset, neutral]), undefined);
  }
});

test("ARCH-03: scope markers round-trip storage without changing old sessions or new-conversation boundaries", () => {
  const snapshot = buildChatHomeSnapshot([]);
  let session = createChatSession(snapshot);
  session = appendChatTurn(session, "看这次", "已选择", "typed_input", chosen);
  session = appendChatTurn(session, "近期整体", "整体", "typed_input", { route: "autonomous_tools", rideScope: "overview" });
  let raw = "";
  const before = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } } });
  try {
    storeChatSession(session);
    const restored = readStoredChatSession()!;
    assert.ok(restored);
    const summaries = buildChatSessionSummaries(getActiveChatConversation(restored));
    assert.equal(summaries.at(-1)?.rideScope, "overview");
    assert.equal(lastChatRideChoice(summaries), undefined);
    assert.equal(sanitizeChatSummaries(summaries).dropped, false);
    assert.deepEqual(buildChatSessionSummaries(getActiveChatConversation(startChatConversation(restored, snapshot))), []);
  } finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: before }); }
});

test("ARCH-03: contradictory scope/choice summaries are dropped as a whole", () => {
  assert.equal(sanitizeChatSummaries([{ ...chosen, rideScope: "overview" }]).dropped, true);
  assert.equal(sanitizeChatSummaries([{ ...neutral, rideScope: "unknown" }]).dropped, true);
  assert.equal(sanitizeChatSummaries([chosen]).dropped, false);
});

test("ARCH-03: explicit ordinal overrides inherited choice and never silently chooses latest", () => {
  const entries = [ride("newest", "2026-11-01"), ride("second", "2026-10-31"), ride("chosen", "2026-10-30")].map(record => ({ record }));
  const result = resolveRideAnchor({ text: "倒数第二次骑行怎么样？", route: "current_ride", summaries: [chosen], entries });
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") assert.equal(result.record.activity.rideId, "second");
  const missing = resolveRideAnchor({ text: "倒数第九次骑行", route: "current_ride", summaries: [chosen], entries });
  assert.equal(missing.status, "clarify");
});

test("ARCH-03: cards follow the latest history query and deduplicate visible candidates", () => {
  const records = [ride("old", "2026-10-30"), ride("new", "2026-11-01")];
  const history = (id: string) => ({ tool: "get_ride_history", rows: [{ rideId: id }], rideCount: 1 }) as unknown as ChatToolResult;
  const result = buildChatRecordInteraction([history("old"), history("new")], records);
  assert.equal(result.artifact?.kind, "ride_list");
  if (result.artifact?.kind === "ride_list") assert.deepEqual(result.artifact.payload.items.map(item => item.rideId), ["new"]);
  const pending = buildChatRecordInteraction([], records, true, ["new", "new", "foreign"]);
  if (pending.artifact?.kind === "ride_list") { assert.equal(pending.artifact.payload.totalCount, 1); assert.equal(pending.artifact.payload.items.length, 1); }
});

async function seeded() {
  const s = resolveOrCreateRequestSession(new Request("http://localhost"));
  const repo = getApplicationRepository();
  await repo.saveRide(s.userId, ride("chosen", "2026-10-30"));
  await repo.saveRide(s.userId, ride("newest", "2026-11-01"));
  return { repo, owner: s.userId, request: (body: unknown) => new Request("http://localhost/api/chat", { method: "POST", headers: { Cookie: s.setCookie!.split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify(body) }) };
}

test("ARCH-03 API: neutral turns retain unique selection even without configured model", async () => {
  const { request } = await seeded();
  const response = await POST(request({ text: "那心率呢？", summaries: [chosen, neutral] }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.choice, chosen.choice);
});

test("ARCH-03 API: explicit text changes the object; conflicting click/text asks again", async () => {
  const { request } = await seeded();
  const changed = await (await POST(request({ text: "最近一次骑行的心率", summaries: [chosen] }))).json();
  assert.equal(changed.choice.id, "newest");
  const conflict = await (await POST(request({ text: "最近一次骑行的心率", choice: chosen.choice }))).json();
  assert.equal(conflict.rideScope, "cleared");
  assert.match(conflict.reply, /不一致/);
});

test("ARCH-03 API: pure knowledge does not read a stale personal object; personal followup resets it", async () => {
  const { request } = await seeded();
  const stale = { ...chosen, choice: { kind: "ride", id: "deleted" } };
  const knowledge = await POST(request({ text: "什么是功率？", summaries: [stale] }));
  assert.equal(knowledge.status, 200);
  const body = await knowledge.json();
  assert.equal(body.fallbackCode, "MODEL_NOT_CONFIGURED");
  assert.equal(body.choice, undefined);
  assert.equal(body.rideAnchor, undefined);
  const missing = await POST(request({ text: "那心率呢？", summaries: [stale] }));
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).rideScope, "cleared");
});

test("ARCH-03: an unspecified analysis asks for a record after a model-selected ride tool", async () => {
  const { repo, owner } = await seeded();
  const result = await runChatAgent({ text: "分析一下我的骑行数据", decision: makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", 12), loopRunner: createChatToolLoopRunner(repo, owner),
    provider: { async run() { return { rawText: JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "get_ride_context", input: { dims: ["summary"] } }] }) }; } } });
  assert.equal(result.fallbackCode, "TOOLS_REFERENCE_NEEDED");
  assert.equal(result.modelInvoked, true);
});

test("ARCH-03 API: pending reset still permits confirmation of the original question", async () => {
  const { request } = await seeded();
  await withRequestedChatTool("get_ride_context", { dims: ["summary"] }, async () => {
  const first = await (await POST(request({ text: "本次骑行的距离是多少？" }))).json();
  assert.equal(first.rideScope, "pending");
  });
  const second = await (await POST(request({ text: "是的", summaries: [{ kind: "session_turn", question: "本次骑行的距离是多少？", route: "current_ride", rideScope: "pending" }] }))).json();
  assert.equal(second.choice.id, "newest");
  assert.equal(second.decision.route, "current_ride");
  assert.equal(second.rideScope, undefined);
});


test("ARCH-03: identity follows unique choice and never resurrects latest after scope reset", () => {
  const entries = [ride("chosen", "2026-10-30"), ride("newest", "2026-11-01")].map(record => ({ record }));
  assert.match(rideIdentityReply([chosen, neutral], entries), /10月30日 08:00/);
  assert.match(rideIdentityReply([{ ...neutral, rideScope: "overview" }, { kind: "session_turn", question: "看这天", route: "current_ride", rideAnchor: "2026-10-30" }], entries), /10月30日/);
  assert.match(rideIdentityReply([chosen, { ...neutral, rideScope: "overview" }, neutral], entries), /没有选定/);
});
