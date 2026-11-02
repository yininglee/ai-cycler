// AGT-H0 合同正反例：交互平面 v0.3（choices / artifact / quickActions）+ 摘要槽位 choice
// + 动作 7 值。全部为纯函数校验，不触网、不调模型。
import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_ARTIFACT_PAYLOAD_MAX_BYTES,
  CHAT_CHOICE_MAX_ITEMS,
  CHAT_INTERACTION_CONTRACT_VERSION,
  isChatChoiceRef,
  sanitizeChatArtifact,
  sanitizeChatChoices,
  sanitizeChatInteractionPayload,
  sanitizeChatQuickActions,
  type ChatChoice,
} from "../src/chat/chat-interaction.ts";
import { CHAT_ROUTING_ACTIONS, isChatRoutingAction, makeChatDecision, sanitizeChatSummaries } from "../src/chat/chat-routing.ts";
import {
  appendChatTurn,
  buildChatSessionSummaries,
  CHAT_SESSION_STORAGE_KEY,
  createChatSession,
  readStoredChatSession,
  storeChatSession,
} from "../src/chat/chat-session.ts";
import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import { publicChatAgentResult } from "../src/chat/chat-agent.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function snapshot() {
  const fixture = getRideFixture("l3-power-preview");
  return buildChatHomeSnapshot([{
    ...fixture,
    activity: { ...fixture.activity, rideId: "upload-ride-0820", startTime: "2026-08-20T02:00:00.000Z" },
    series: { ...fixture.series, rideId: "upload-ride-0820" },
  }], new Date("2026-08-21T12:00:00.000Z"));
}

const rideChoice: ChatChoice = { kind: "ride", id: "upload-ride-0820", label: "8月20日", sublabel: "31.1 km · 有功率" };

// ---------------------------------------------------------------------------
// choices
// ---------------------------------------------------------------------------

test("H0 合同版本号锁定：ride-chat-interaction-v0.3", () => {
  assert.equal(CHAT_INTERACTION_CONTRACT_VERSION, "ride-chat-interaction-v0.3");
});

test("choices 正例：合法项原样通过（含可选 sublabel）", () => {
  const result = sanitizeChatChoices([rideChoice, { kind: "goal", id: "ftp", label: "提升 FTP" }]);
  assert.equal(result.dropped, false);
  assert.deepEqual(result.value, [rideChoice, { kind: "goal", id: "ftp", label: "提升 FTP" }]);
});

test("choices 重复项（同 kind+id）去重并保留首次出现的文案", () => {
  const result = sanitizeChatChoices([rideChoice, { ...rideChoice, label: "另一条文案" }]);
  assert.equal(result.dropped, false);
  assert.equal(result.value?.length, 1);
  assert.equal(result.value?.[0]?.label, "8月20日");
});

test("choices 同 id 不同 kind 不算重复（ride 与 goal 可共存）", () => {
  const result = sanitizeChatChoices([{ kind: "ride", id: "x1", label: "8月20日" }, { kind: "goal", id: "x1", label: "减重" }]);
  assert.equal(result.value?.length, 2);
});

test("choices 反例：缺 label / kind 不在枚举 → 整体丢弃（不部分渲染）", () => {
  assert.equal(sanitizeChatChoices([rideChoice, { kind: "ride", id: "r2" }]).dropped, true);
  assert.equal(sanitizeChatChoices([{ kind: "route", id: "r1", label: "8月20日" }]).dropped, true);
  assert.equal(sanitizeChatChoices("ride").dropped, true);
});

test("choices 反例：超合同上限整体丢弃；未提供不算非法", () => {
  const many = Array.from({ length: CHAT_CHOICE_MAX_ITEMS }, (_, index) => ({ kind: "ride", id: `r-${index}`, label: `8月${index + 1}日` }));
  assert.equal(sanitizeChatChoices(many).dropped, false);
  assert.equal(sanitizeChatChoices([...many, { kind: "ride", id: "r-overflow", label: "溢出" }]).dropped, true);
  assert.deepEqual(sanitizeChatChoices(undefined), { dropped: false });
});

test("choices 反例：sublabel 超长 / 含控制字符 → 整体丢弃", () => {
  assert.equal(sanitizeChatChoices([{ ...rideChoice, sublabel: "x".repeat(61) }]).dropped, true);
  assert.equal(sanitizeChatChoices([{ ...rideChoice, label: "8月\u0000日" }]).dropped, true);
});

// ---------------------------------------------------------------------------
// artifact
// ---------------------------------------------------------------------------

test("artifact 正例：ride_list 缺省归一（totalCount=items.length，truncated=false）", () => {
  const result = sanitizeChatArtifact({
    kind: "ride_list",
    payload: { items: [{ rideId: "ride-0820", dateLabel: "8月20日", distanceKm: 31.1, hasPower: true, hasHeartRate: true }] },
  });
  assert.equal(result.dropped, false);
  assert.deepEqual(result.value, {
    kind: "ride_list",
    payload: { items: [{ rideId: "ride-0820", dateLabel: "8月20日", distanceKm: 31.1, hasPower: true, hasHeartRate: true }], totalCount: 1, truncated: false },
  });
});

test("artifact 反例：kind 不在枚举 / 多键 / 非对象 → 整体丢弃", () => {
  assert.equal(sanitizeChatArtifact({ kind: "route_map", payload: {} }).dropped, true);
  assert.equal(sanitizeChatArtifact({ kind: "ride_list", payload: { items: [{ rideId: "r1", dateLabel: "8月20日" }] }, extra: 1 }).dropped, true);
  assert.equal(sanitizeChatArtifact("ride_list").dropped, true);
  assert.deepEqual(sanitizeChatArtifact(undefined), { dropped: false });
});

test("artifact 反例：ride_list 的 truncated 与 totalCount 自相矛盾 → 丢弃", () => {
  assert.equal(sanitizeChatArtifact({
    kind: "ride_list",
    payload: { items: [{ rideId: "r1", dateLabel: "8月20日" }], totalCount: 3, truncated: false },
  }).dropped, true);
  const truncated = sanitizeChatArtifact({
    kind: "ride_list",
    payload: { items: [{ rideId: "r1", dateLabel: "8月20日" }], totalCount: 3, truncated: true },
  });
  assert.equal(truncated.dropped, false);
});

test("artifact 正例：goal_options 合法且同 id 去重", () => {
  const result = sanitizeChatArtifact({
    kind: "goal_options",
    payload: { options: [{ id: "ftp", label: "提升 FTP" }, { id: "ftp", label: "重复项" }, { id: "century", label: "完成首次百公里" }] },
  });
  assert.equal(result.value?.kind, "goal_options");
  assert.deepEqual(result.value?.payload, { options: [{ id: "ftp", label: "提升 FTP" }, { id: "century", label: "完成首次百公里" }] });
});

test("artifact 反例：payload 超体积上限 → 丢弃（plan 的形状归 AGT-F，此处只卡体积）", () => {
  const huge = { blob: "x".repeat(CHAT_ARTIFACT_PAYLOAD_MAX_BYTES) };
  assert.equal(sanitizeChatArtifact({ kind: "plan", payload: huge }).dropped, true);
  assert.equal(sanitizeChatArtifact({ kind: "plan", payload: { weeks: 4 } }).dropped, false);
});

// ---------------------------------------------------------------------------
// quickActions
// ---------------------------------------------------------------------------

test("quickActions 正例：deepAnalysis 通过，同 rideId 去重", () => {
  const action = { kind: "deepAnalysis", rideId: "ride-0820", dateLabel: "8月20日" };
  const result = sanitizeChatQuickActions([action, { ...action, dateLabel: "8月20日（重复）" }]);
  assert.equal(result.dropped, false);
  assert.deepEqual(result.value, [action]);
});

test("quickActions 反例：未知 kind / rideId 含空白 / 缺 dateLabel → 整体丢弃", () => {
  assert.equal(sanitizeChatQuickActions([{ kind: "openPlan", rideId: "r1", dateLabel: "8月20日" }]).dropped, true);
  assert.equal(sanitizeChatQuickActions([{ kind: "deepAnalysis", rideId: "r 1", dateLabel: "8月20日" }]).dropped, true);
  assert.equal(sanitizeChatQuickActions([{ kind: "deepAnalysis", rideId: "r1" }]).dropped, true);
});

// ---------------------------------------------------------------------------
// 三件套出口净化 + 响应形状兼容
// ---------------------------------------------------------------------------

test("出口净化：非法列表一并剔除依赖选项，独立选项仍兼容", () => {
  const sanitized = sanitizeChatInteractionPayload({
    choices: [rideChoice],
    artifact: { kind: "route_map", payload: {} },
    quickActions: undefined,
  });
  assert.equal(sanitized.choices, undefined);
  assert.deepEqual(sanitizeChatInteractionPayload({ choices: [rideChoice] }).choices, [rideChoice]);
  assert.equal(sanitized.artifact, undefined);
  assert.equal(sanitized.quickActions, undefined);
  assert.deepEqual(sanitized.droppedFields, ["choices", "artifact"]);
});

test("publicChatAgentResult：旧结果（无新字段）响应形状零变化", () => {
  const decision = makeChatDecision("out_of_scope", "none", "OUT_OF_SCOPE", 6);
  const publicResult = publicChatAgentResult({
    schemaVersion: "ride-chat-agent-v0.1",
    decision,
    execution: "template",
    modelInvoked: false,
    reply: "不属于骑行范围。",
    providerRawOutput: "raw",
  });
  assert.equal("choices" in publicResult, false);
  assert.equal("artifact" in publicResult, false);
  assert.equal("quickActions" in publicResult, false);
  assert.equal("providerRawOutput" in publicResult, false);
});

test("publicChatAgentResult：合法载荷透传，非法载荷整字段剔除（不进前端）", () => {
  const decision = makeChatDecision("current_ride", "none", "CURRENT_RIDE", 8);
  const base = {
    schemaVersion: "ride-chat-agent-v0.1" as const,
    decision,
    execution: "validated" as const,
    modelInvoked: true,
    reply: "8月20日这次骑了 31.1 公里。",
  };
  const kept = publicChatAgentResult({ ...base, choices: [rideChoice] });
  assert.deepEqual(kept.choices, [rideChoice]);
  const dropped = publicChatAgentResult({ ...base, choices: [{ kind: "ride", id: "r1" }] as never });
  assert.equal("choices" in dropped, false);
});

// ---------------------------------------------------------------------------
// 摘要槽位 v0.3：choice
// ---------------------------------------------------------------------------

test("摘要网关正例：带 choice 的槽位通过；旧槽位（无 choice）照常通过（双版本兼容）", () => {
  const fresh = sanitizeChatSummaries([{ kind: "session_turn", question: "分析一下这次骑行", route: "current_ride", choice: { kind: "ride", id: "upload-ride-0820" } }]);
  assert.equal(fresh.dropped, false);
  assert.deepEqual(fresh.summaries[0]?.choice, { kind: "ride", id: "upload-ride-0820" });

  const legacy = sanitizeChatSummaries([{ kind: "session_turn", question: "分析一下这次骑行", route: "current_ride", rideAnchor: "2026-08-20" }]);
  assert.equal(legacy.dropped, false);
  assert.equal(legacy.summaries[0]?.choice, undefined);
  assert.equal(legacy.summaries[0]?.rideAnchor, "2026-08-20");
});

test("摘要网关反例：choice 结构非法（kind 枚举 / 缺 id / 多键）→ 整体丢弃", () => {
  const bad = [
    { kind: "session_turn", question: "看看这条", route: "current_ride", choice: { kind: "route", id: "r1" } },
    { kind: "session_turn", question: "看看这条", route: "current_ride", choice: { kind: "ride" } },
    { kind: "session_turn", question: "看看这条", route: "current_ride", choice: { kind: "ride", id: "r1", label: "8月20日" } },
    { kind: "session_turn", question: "看看这条", route: "current_ride", choice: "upload-ride-0820" },
  ];
  for (const summary of bad) {
    assert.deepEqual(sanitizeChatSummaries([summary]), { summaries: [], dropped: true }, JSON.stringify(summary));
  }
});

test("isChatChoiceRef：只认 kind + id，rideId 字符集受限", () => {
  assert.equal(isChatChoiceRef({ kind: "ride", id: "upload-9f3a" }), true);
  assert.equal(isChatChoiceRef({ kind: "ride", id: "upload 9f3a" }), false);
  assert.equal(isChatChoiceRef({ kind: "ride", id: "" }), false);
  assert.equal(isChatChoiceRef(null), false);
});

test("会话往返：带 choice 的槽位存入 localStorage 后可原样读回并进入摘要", () => {
  const store = new Map<string, string>();
  const holder = globalThis as { localStorage?: Storage };
  const previous = holder.localStorage;
  holder.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  } as unknown as Storage;
  try {
    const state = appendChatTurn(
      createChatSession(snapshot()),
      "分析一下 8 月 20 日这次",
      "8月20日这次骑了 31.1 公里。",
      "typed_input",
      { route: "current_ride", rideAnchor: "2026-08-20", choice: { kind: "ride", id: "upload-ride-0820" } },
    );
    storeChatSession(state);
    const restored = readStoredChatSession();
    assert.deepEqual(restored, state);
    const summaries = buildChatSessionSummaries(restored!.conversations[0]!);
    assert.deepEqual(summaries[0]?.choice, { kind: "ride", id: "upload-ride-0820" });
    assert.equal(summaries[0]?.rideAnchor, "2026-08-20");

    // 旧会话（v0.2 槽位，无 choice）必须仍能加载——否则用户一上线就丢历史。
    const legacyState = { ...state, conversations: [{ ...state.conversations[0]!, summarySlots: [{ kind: "session_turn", source: "typed_input", question: "看看这条", route: "current_ride", rideAnchor: "2026-08-20" }] }] };
    store.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify(legacyState));
    assert.notEqual(readStoredChatSession(), null);

    // 损坏的 choice 让整个会话作废（严格：半截上下文比没有上下文更容易答错对象）。
    const brokenState = { ...state, conversations: [{ ...state.conversations[0]!, summarySlots: [{ kind: "session_turn", source: "typed_input", question: "看看这条", route: "current_ride", choice: { kind: "ride" } }] }] };
    store.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify(brokenState));
    assert.equal(readStoredChatSession(), null);
  } finally {
    if (previous === undefined) delete holder.localStorage;
    else holder.localStorage = previous;
  }
});

// ---------------------------------------------------------------------------
// 动作 7 值
// ---------------------------------------------------------------------------

test("动作合同：7 值枚举完整，原 4 值映射行为不变", () => {
  assert.equal(CHAT_ROUTING_ACTIONS.length, 7);
  for (const action of ["select", "produce_artifact", "confirm_write"]) {
    assert.equal(isChatRoutingAction(action), true, action);
  }
  assert.equal(isChatRoutingAction("tool_then_artifact"), false);
  assert.equal(isChatRoutingAction(undefined), false);

  // 行为零变化：现有路由仍只产出原 4 值（新值由 H2/F 开始产出）。
  assert.equal(makeChatDecision("current_ride", "none", "CURRENT_RIDE", 8).action, "tool_then_model");
  assert.equal(makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", 8).action, "tool_then_model");
  assert.equal(makeChatDecision("aggregate", "none", "AGGREGATE", 8).action, "deterministic_reply");
  assert.equal(makeChatDecision("safety_stop", "medical_emergency", "MEDICAL_EMERGENCY", 8).action, "safety_stop");
  assert.equal(makeChatDecision("out_of_scope", "none", "OUT_OF_SCOPE", 8).action, "deterministic_reply");
});
