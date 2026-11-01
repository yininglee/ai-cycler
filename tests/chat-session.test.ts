import assert from "node:assert/strict";
import test from "node:test";

import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import {
  appendChatTurn,
  CHAT_SESSION_STORAGE_KEY,
  CHAT_SESSION_SUMMARY_LIMIT,
  chatHomeSnapshotFingerprint,
  createChatSession,
  getActiveChatConversation,
  isChatSessionStale,
  readStoredChatSession,
  selectChatConversation,
  startChatConversation,
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

test("chat session starts new conversations and switches only within the current page state", () => {
  const snapshot = snapshotWithRideCount(1);
  const first = appendChatTurn(createChatSession(snapshot), "我一共骑了多少？", "目前已记录 1 次骑行。", "quick_question");
  const second = startChatConversation(first, snapshot);

  assert.equal(second.conversations.length, 2);
  assert.equal(getActiveChatConversation(second).id, "conversation-2");
  assert.equal(getActiveChatConversation(second).messages.length, 1);
  assert.equal(getActiveChatConversation(second).messages[0]?.kind, "welcome");
  assert.equal(getActiveChatConversation(selectChatConversation(second, "conversation-1")).messages[0]?.kind, "welcome");
  assert.equal(getActiveChatConversation(selectChatConversation(second, "conversation-1")).messages.length, 3);
  assert.equal(selectChatConversation(second, "missing"), second);
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
