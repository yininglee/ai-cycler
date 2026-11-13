import assert from "node:assert/strict";
import test from "node:test";

import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import {
  appendChatTurn,
  buildChatSessionSummaries,
  buildChatTimeline,
  CHAT_SESSION_IDLE_MS,
  CHAT_SESSION_STORAGE_KEY,
  CHAT_SESSION_SUMMARY_LIMIT,
  chatHomeSnapshotFingerprint,
  createChatSession,
  getActiveChatConversation,
  isChatSessionStale,
  readStoredChatSession,
  resumeChatSession,
  storeChatSession,
} from "../src/chat/chat-session.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function snapshotWithRideCount(count: number) {
  const fixture = getRideFixture("l3-power-preview");
  return buildChatHomeSnapshot(Array.from({ length: count }, (_, index) => ({
    ...fixture,
    activity: { ...fixture.activity, rideId: `private-ride-${index}`, startTime: "2026-09-01T02:00:00.000Z" },
    series: { ...fixture.series, rideId: `private-ride-${index}` },
  })), new Date("2026-09-04T12:00:00.000Z"));
}

test("24 hours after a completed turn, a fresh context opens and old messages remain in the timeline", () => {
  const snapshot = snapshotWithRideCount(1);
  const completedAt = 1_000;
  const first = appendChatTurn(createChatSession(snapshot), "我一共骑了多少？", "目前已记录 1 次骑行。", "quick_question", { route: "aggregate" }, undefined, undefined, completedAt);
  assert.equal(resumeChatSession(first, snapshot, completedAt + CHAT_SESSION_IDLE_MS - 1).activeConversationId, first.activeConversationId);
  const second = resumeChatSession(first, snapshot, completedAt + CHAT_SESSION_IDLE_MS);

  assert.equal(second.conversations.length, 2);
  assert.equal(getActiveChatConversation(second).id, "conversation-2");
  assert.equal(getActiveChatConversation(second).messages.length, 1);
  assert.equal(getActiveChatConversation(second).messages[0]?.kind, "welcome");
  assert.deepEqual(buildChatSessionSummaries(getActiveChatConversation(second)), []);
  assert.deepEqual(buildChatTimeline(second).map(row => [row.conversationId, row.message.role]), [["conversation-1", "user"], ["conversation-1", "assistant"]]);
  assert.equal(resumeChatSession(second, snapshot, completedAt + 2 * CHAT_SESSION_IDLE_MS).conversations.length, 2);
});

test("opening a legacy history preserves its messages and clears the inherited ride choice", () => {
  const snapshot = snapshotWithRideCount(1);
  const original = appendChatTurn(createChatSession(snapshot), "这次骑得怎样？", "已找到所选记录。", "typed_input", { route: "current_ride", choice: { kind: "ride", id: "old-ride" } });
  const [previous] = original.conversations;
  const legacy = { ...original, conversations: [{ ...previous, lastTurnAt: undefined }] };
  const restored = resumeChatSession(legacy, snapshot);
  assert.deepEqual(restored.conversations[0], legacy.conversations[0]);
  assert.deepEqual(buildChatSessionSummaries(getActiveChatConversation(restored)), []);
  assert.equal(buildChatTimeline(restored).length, 2);
});

test("chat session keeps at most six structured summary slots per conversation", () => {
  const snapshot = snapshotWithRideCount(1);
  const state = Array.from({ length: CHAT_SESSION_SUMMARY_LIMIT + 3 }, (_, index) => index).reduce(
    (current, index) => appendChatTurn(current, `问题 ${index}`, `回答 ${index}`, index % 2 === 0 ? "quick_question" : "typed_input"),
    createChatSession(snapshot),
  );
  const conversation = getActiveChatConversation(state);

  assert.equal(conversation.summarySlots.length, CHAT_SESSION_SUMMARY_LIMIT);
  assert.deepEqual(conversation.summarySlots, [
    { kind: "deterministic_turn", source: "typed_input" },
    { kind: "deterministic_turn", source: "quick_question" },
    { kind: "deterministic_turn", source: "typed_input" },
    { kind: "deterministic_turn", source: "quick_question" },
    { kind: "deterministic_turn", source: "typed_input" },
    { kind: "deterministic_turn", source: "quick_question" },
  ]);
  assert.doesNotMatch(JSON.stringify(conversation.summarySlots), /问题|回答|rideId|ownerId/);
});

test("a changed aggregate snapshot invalidates the in-page session without private identifiers", () => {
  const beforeDelete = snapshotWithRideCount(1);
  const afterDelete = snapshotWithRideCount(0);
  const state = appendChatTurn(createChatSession(beforeDelete), "本周骑了多少？", "本周已记录 1 次骑行。", "typed_input");

  assert.equal(isChatSessionStale(state, beforeDelete), false);
  assert.equal(isChatSessionStale(state, afterDelete), true);
  assert.doesNotMatch(chatHomeSnapshotFingerprint(beforeDelete), /rideId|ownerId|private-ride/);
  assert.doesNotMatch(chatHomeSnapshotFingerprint(afterDelete), /rideId|ownerId|private-ride/);
});

test("chat session round-trips through local storage and rejects corrupt or malformed data", () => {
  const snapshot = snapshotWithRideCount(1);
  const store = new Map<string, string>();
  const storageStub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  } as unknown as Storage;
  const holder = globalThis as { localStorage?: Storage };
  const previous = holder.localStorage;
  holder.localStorage = storageStub;
  try {
    const state = appendChatTurn(createChatSession(snapshot), "我一共骑了多少？", "目前已记录 1 次骑行。", "typed_input");
    storeChatSession(state);
    assert.deepEqual(readStoredChatSession(), state);
    assert.equal(isChatSessionStale(readStoredChatSession()!, snapshot), false);

    store.set(CHAT_SESSION_STORAGE_KEY, "{not json");
    assert.equal(readStoredChatSession(), null);
    store.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({ conversations: [], activeConversationId: "missing" }));
    assert.equal(readStoredChatSession(), null);
    store.set(CHAT_SESSION_STORAGE_KEY, JSON.stringify({ ...state, conversations: [{ id: "conversation-1", messages: [{ role: "guest", text: "hi" }], summarySlots: [] }] }));
    assert.equal(readStoredChatSession(), null);
  } finally {
    if (previous === undefined) delete holder.localStorage;
    else holder.localStorage = previous;
  }
});
