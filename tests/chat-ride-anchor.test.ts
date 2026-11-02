import assert from "node:assert/strict";
import test from "node:test";

import { runLegacyChatAgent } from "../src/chat/chat-agent.ts";
import {
  ChatToolOrchestrationError,
  createChatToolRunner,
} from "../src/chat/chat-tool-orchestration.ts";
import {
  detectAnchorConfirmation,
  extractExplicitRideDate,
  findRideRecordByDate,
  lastSummarizedAnchor,
  latestRideRecord,
  resolveAnchorConfirmation,
  resolveRideAnchor,
  rideAnchorDate,
  rideAnchorDateLabel,
  rideIdentityReply,
} from "../src/chat/chat-ride-anchor.ts";
import { classifyChatInput, sanitizeChatSummaries, type ChatSessionSummary } from "../src/chat/chat-routing.ts";
import { buildChatSessionSummaries } from "../src/chat/chat-session.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";

// CHAT-14（G-RIDE-DEIXIS）：骑乘指涉解析——锚点来源次序（显式日期 → 显式序数 →
// 上下文继承 → 澄清）、确认轮落地与摘要网关合同。

function anchoredRecord(rideId: string, startTime: string) {
  const fixture = getRideFixture("l3-fit-power");
  return {
    activity: { ...structuredClone(fixture.activity), rideId, startTime },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

// Asia/Shanghai 日历日：08-15/08-20（UTC 上午出发同日）、08-12（+08:00 显式时区）。
const RECORDS = [
  anchoredRecord("ride-0812", "2026-08-12T18:30:00+08:00"),
  anchoredRecord("ride-0815", "2026-08-15T08:00:00Z"),
  anchoredRecord("ride-0820", "2026-08-20T08:00:00Z"),
];
const ENTRIES = RECORDS.map((record) => ({ record }));
const NOW = new Date("2026-09-09T00:00:00Z");

function summary(question: string, route: ChatSessionSummary["route"], rideAnchor?: string): ChatSessionSummary {
  return { kind: "session_turn", question, route, ...(rideAnchor ? { rideAnchor } : {}) };
}

test("rideAnchorDate resolves Asia/Shanghai calendar days including the midnight boundary", () => {
  assert.equal(rideAnchorDate("2026-08-20T08:00:00Z"), "2026-08-20");
  assert.equal(rideAnchorDate("2026-08-20T20:00:00Z"), "2026-08-21");
  assert.equal(rideAnchorDate("2026-08-12T18:30:00+08:00"), "2026-08-12");
  assert.equal(rideAnchorDate(undefined), undefined);
  assert.equal(rideAnchorDate("not-a-date"), undefined);
  assert.equal(rideAnchorDateLabel("2026-08-20"), "8月20日");
});

test("extractExplicitRideDate accepts full, month-day and ISO forms with calendar bounds", () => {
  assert.deepEqual(extractExplicitRideDate("2026年8月15日骑行的功率"), { year: 2026, month: 8, day: 15 });
  assert.deepEqual(extractExplicitRideDate("8月15号那次"), { month: 8, day: 15 });
  assert.deepEqual(extractExplicitRideDate("看下2026-08-15的骑行"), { year: 2026, month: 8, day: 15 });
  assert.equal(extractExplicitRideDate("13月5日"), undefined);
  assert.equal(extractExplicitRideDate("没有日期"), undefined);
});

test("findRideRecordByDate matches explicit years and falls back across year boundaries", () => {
  assert.equal(findRideRecordByDate(ENTRIES, { year: 2026, month: 8, day: 15 }, NOW)?.activity.rideId, "ride-0815");
  // 无年份：先试当前年（2026 无 8 月 1 日记录），不跨到上一年编造。
  assert.equal(findRideRecordByDate(ENTRIES, { month: 8, day: 1 }, NOW), undefined);
  assert.equal(findRideRecordByDate(ENTRIES, { year: 2025, month: 8, day: 20 }, NOW), undefined);
});

test("resolveRideAnchor resolves explicit dates, ordinals and inherits session anchors (CHAT-14)", () => {
  // ① 显式日期：命中本人记录。
  const explicit = resolveRideAnchor({ text: "2026年8月15日骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(explicit.status, "resolved");
  if (explicit.status === "resolved") {
    assert.equal(explicit.record.activity.rideId, "ride-0815");
    assert.equal(explicit.date, "2026-08-15");
    assert.equal(explicit.source, "explicit_date");
  }

  // ② 显式序数：锚定最新出发时间记录。
  const ordinal = resolveRideAnchor({ text: "最近一次骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(ordinal.status, "resolved");
  if (ordinal.status === "resolved") {
    assert.equal(ordinal.record.activity.rideId, "ride-0820");
    assert.equal(ordinal.source, "explicit_ordinal");
  }

  // ③ 上下文继承：裸指涉继承最近一轮锚点，而非偷换最新记录。
  const inherited = resolveRideAnchor({
    text: "本次骑行的平均功率是多少？",
    route: "current_ride",
    summaries: [summary("上次问过什么", "current_ride", "2026-08-12")],
    entries: ENTRIES,
    now: NOW,
  });
  assert.equal(inherited.status, "resolved");
  if (inherited.status === "resolved") {
    assert.equal(inherited.record.activity.rideId, "ride-0812");
    assert.equal(inherited.source, "inherited");
  }

  // ④ 继承锚点的记录已不在（被删除）：确定性澄清，不静默换记录。
  const vanished = resolveRideAnchor({
    text: "本次骑行的平均功率是多少？",
    route: "current_ride",
    summaries: [summary("之前的问题", "current_ride", "2026-08-01")],
    entries: ENTRIES,
    now: NOW,
  });
  assert.equal(vanished.status, "clarify");
  if (vanished.status === "clarify") assert.match(vanished.reply, /已经不在了/);
});

test("resolveRideAnchor clarifies bare deixis without an anchor and keeps capability questions on latest", () => {
  // 裸“本次”无锚点：确定性确认话术（含最新记录日期），零模型调用前提。
  const bare = resolveRideAnchor({ text: "本次骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(bare.status, "clarify");
  if (bare.status === "clarify") assert.match(bare.reply, /最近一次（8月20日）/);

  // history_compare 的比较主体是“这次”：同样走继承/澄清。
  const compareBare = resolveRideAnchor({ text: "这次骑行比上次骑得远吗？", route: "history_compare", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(compareBare.status, "clarify");
  // “最近一次”作比较主体：显式序数锚定最新。
  const compareOrdinal = resolveRideAnchor({ text: "最近一次骑行比上次骑得远吗？", route: "history_compare", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(compareOrdinal.status, "resolved");
  // 无指涉比较（“有进步吗”）：比较主体即最近一次。
  const compareDefault = resolveRideAnchor({ text: "我最近的骑行有进步吗？", route: "history_compare", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(compareDefault.status, "resolved");
  if (compareDefault.status === "resolved") assert.equal(compareDefault.source, "default_latest");

  // capabilities 无指涉：能力清单对记录不敏感，默认最新不澄清。
  const capabilities = resolveRideAnchor({ text: "我可以分析哪些数据？", route: "capabilities", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(capabilities.status, "resolved");
  if (capabilities.status === "resolved") assert.equal(capabilities.source, "default_latest");

  // capabilities 带指涉词（“当前/这次”）：问的是能力范围而非某次骑行，同样不澄清。
  const capabilitiesDeixis = resolveRideAnchor({ text: "当前可以分析哪些数据？", route: "capabilities", summaries: [], entries: ENTRIES, now: NOW });
  assert.equal(capabilitiesDeixis.status, "resolved");
  if (capabilitiesDeixis.status === "resolved") assert.equal(capabilitiesDeixis.source, "default_latest");

  // 无记录：确定性澄清。
  const empty = resolveRideAnchor({ text: "本次骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: [], now: NOW });
  assert.equal(empty.status, "clarify");
});

test("resolveRideAnchor honours confirmation overrides and reports unmatchable dates deterministically", () => {
  const latest = resolveRideAnchor({ text: "本次骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: ENTRIES, override: { latest: true }, now: NOW });
  assert.equal(latest.status, "resolved");
  if (latest.status === "resolved") {
    assert.equal(latest.record.activity.rideId, "ride-0820");
    assert.equal(latest.source, "override");
  }

  const byDate = resolveRideAnchor({ text: "本次骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: ENTRIES, override: { date: "2026-08-15" }, now: NOW });
  assert.equal(byDate.status, "resolved");
  if (byDate.status === "resolved") {
    assert.equal(byDate.record.activity.rideId, "ride-0815");
    assert.equal(byDate.source, "override");
  }

  const missing = resolveRideAnchor({ text: "本次骑行的平均功率是多少？", route: "current_ride", summaries: [], entries: ENTRIES, override: { date: "2026-08-01" }, now: NOW });
  assert.equal(missing.status, "clarify");
  if (missing.status === "clarify") assert.match(missing.reply, /没有找到 8月1日/);
});

test("detectAnchorConfirmation recognises pending clarification turns only for pure confirmations", () => {
  const pending = [summary("本次骑行的平均功率是多少？", "current_ride")];
  const base = { decision: classifyChatInput("是的"), summaries: pending };

  assert.deepEqual(detectAnchorConfirmation({ ...base, text: "是的" }), { type: "latest", question: "本次骑行的平均功率是多少？", route: "current_ride" });
  assert.deepEqual(detectAnchorConfirmation({ ...base, text: "最近一次" }), { type: "latest", question: "本次骑行的平均功率是多少？", route: "current_ride" });
  assert.deepEqual(detectAnchorConfirmation({ ...base, text: "8月12日" }), { type: "date", question: "本次骑行的平均功率是多少？", route: "current_ride", date: { month: 8, day: 12 } });

  // 非纯确认语 / 末轮已有锚点 / 末轮非工具路由 / 空摘要：不构成确认轮。
  assert.equal(detectAnchorConfirmation({ ...base, text: "那功率是多少" }), null);
  assert.equal(detectAnchorConfirmation({ decision: base.decision, summaries: [summary("问过了", "current_ride", "2026-08-20")], text: "是的" }), null);
  assert.equal(detectAnchorConfirmation({ decision: base.decision, summaries: [summary("你好", "social")], text: "是的" }), null);
  assert.equal(detectAnchorConfirmation({ ...base, text: "是的", summaries: [] }), null);
});

test("resolveAnchorConfirmation completes the pending question with an anchor or replies deterministically", () => {
  const latest = resolveAnchorConfirmation({
    confirmation: { type: "latest", question: "本次骑行的平均功率是多少？", route: "current_ride" },
    entries: ENTRIES,
    now: NOW,
  });
  assert.equal(latest.kind, "complete");
  if (latest.kind === "complete") {
    assert.equal(latest.text, "本次骑行的平均功率是多少？");
    assert.deepEqual(latest.anchor, { latest: true });
    assert.equal(latest.decision.route, "current_ride");
  }

  const byDate = resolveAnchorConfirmation({
    confirmation: { type: "date", question: "本次骑行的平均功率是多少？", route: "current_ride", date: { month: 8, day: 12 } },
    entries: ENTRIES,
    now: NOW,
  });
  assert.equal(byDate.kind, "complete");
  if (byDate.kind === "complete") assert.deepEqual(byDate.anchor, { date: "2026-08-12" });

  const missing = resolveAnchorConfirmation({
    confirmation: { type: "date", question: "本次骑行的平均功率是多少？", route: "current_ride", date: { month: 8, day: 1 } },
    entries: ENTRIES,
    now: NOW,
  });
  assert.equal(missing.kind, "reply");
  if (missing.kind === "reply") assert.match(missing.reply, /没有找到 8月1日/);
});

test("rideIdentityReply discloses the inherited anchor or the latest-record default (CHAT-14)", () => {
  assert.match(rideIdentityReply([summary("聊过功率", "current_ride", "2026-08-12")], ENTRIES), /按 8月12日 这次骑行处理/);
  assert.match(rideIdentityReply([], ENTRIES), /按最近一次（8月20日）的骑行处理/);
  assert.equal(lastSummarizedAnchor([summary("无锚点", "current_ride"), summary("有锚点", "current_ride", "2026-08-15")]), "2026-08-15");
  assert.equal(latestRideRecord(ENTRIES)?.activity.rideId, "ride-0820");
});

test("sanitizeChatSummaries enforces the whitelist gateway contract (CHAT-14 P1)", () => {
  const valid = [summary("最近一次骑行功率是多少？", "current_ride", "2026-08-20")];
  assert.deepEqual(sanitizeChatSummaries(valid), { summaries: valid, dropped: false });
  assert.deepEqual(sanitizeChatSummaries(undefined), { summaries: [], dropped: false });
  // 显式携带 null / 非数组：结构非法（区别于字段缺省），整体丢弃记事件。
  assert.deepEqual(sanitizeChatSummaries(null), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([]), { summaries: [], dropped: false });

  // 非数组 / 超量 / 白名单外字段 / 超长问题 / 非法路由 / 伪日期锚点：整体静默丢弃。
  assert.deepEqual(sanitizeChatSummaries("not-an-array"), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries(Array.from({ length: 7 }, () => summary("问题", "current_ride"))), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([{ kind: "session_turn", question: "问题", route: "current_ride", reply: "assistant 回复不得进入摘要" }]), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([{ kind: "session_turn", question: "x".repeat(121), route: "current_ride" }]), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([{ kind: "session_turn", question: "问题", route: "not_a_route" }]), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([{ kind: "session_turn", question: "问题", route: "current_ride", rideAnchor: "2026-02-30" }]), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([{ kind: "session_turn", question: "问题", route: "current_ride", rideAnchor: "2026-8-15" }]), { summaries: [], dropped: true });
  assert.deepEqual(sanitizeChatSummaries([{ kind: "deterministic_turn", question: "问题", route: "current_ride" }]), { summaries: [], dropped: true });
});

test("buildChatSessionSummaries projects only complete session_turn slots", () => {
  const conversation = {
    id: "conversation-1",
    messages: [],
    summarySlots: [
      { kind: "session_turn" as const, source: "typed_input" as const, question: "本次骑行的功率是多少？", route: "current_ride" as const, rideAnchor: "2026-08-20" },
      { kind: "session_turn" as const, source: "typed_input" as const, question: "缺路由的脏槽位" },
      { kind: "deterministic_turn" as const, source: "quick_question" as const },
      { kind: "session_turn" as const, source: "typed_input" as const, question: "最近一次骑多远？", route: "current_ride" as const },
    ],
  };
  assert.deepEqual(buildChatSessionSummaries(conversation), [
    { kind: "session_turn", question: "本次骑行的功率是多少？", route: "current_ride", rideAnchor: "2026-08-20" },
    { kind: "session_turn", question: "最近一次骑多远？", route: "current_ride" },
  ]);
});

function repositoryFor(entries: typeof ENTRIES): ApplicationRepository {
  return {
    listRides: async (ownerId: string) => ownerId === "owner-a" ? entries : [],
    getRide: async (ownerId: string, rideId: string) => ownerId === "owner-a" ? RECORDS.find((record) => record.activity.rideId === rideId) ?? null : null,
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
}

test("tool orchestration surfaces TOOLS_ANCHOR_CLARIFY for bare deixis and the agent answers deterministically", async () => {
  const runner = createChatToolRunner(repositoryFor(ENTRIES), "owner-a");
  const text = "本次骑行的平均功率是多少？";
  await assert.rejects(
    () => runner.run({ text, decision: classifyChatInput(text) }),
    (error: unknown) => error instanceof ChatToolOrchestrationError && error.code === "TOOLS_ANCHOR_CLARIFY" && /最近一次（8月20日）/.test(error.message),
  );

  // 编排错误进入 agent 后成为一等确定性路径：template、零模型调用、澄清话术直达用户。
  const result = await runLegacyChatAgent({ text, decision: classifyChatInput(text), toolRunner: runner });
  assert.equal(result.execution, "template");
  assert.equal(result.modelInvoked, false);
  assert.equal(result.fallbackCode, "TOOLS_ANCHOR_CLARIFY");
  assert.match(result.reply, /最近一次（8月20日）/);
  assert.equal("rideAnchor" in result, false);
});
