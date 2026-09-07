import { chatInitialMessage, type ChatHomeSnapshot, type ChatMessage } from "./chat-home.ts";

export const CHAT_SESSION_SUMMARY_LIMIT = 6;

export type ChatSessionSummarySource = "quick_question" | "typed_input";

export type ChatSessionSummarySlot = {
  kind: "deterministic_turn";
  source: ChatSessionSummarySource;
};

export type ChatConversation = {
  id: string;
  messages: ChatMessage[];
  summarySlots: ChatSessionSummarySlot[];
};

export type ChatSessionState = {
  snapshotFingerprint: string;
  conversations: ChatConversation[];
  activeConversationId: string;
  nextConversationIndex: number;
};

export function chatHomeSnapshotFingerprint(snapshot: ChatHomeSnapshot): string {
  return JSON.stringify([
    snapshot.version,
    snapshot.totalRideCount,
    snapshot.totalDistanceKm,
    snapshot.weekRideCount,
    snapshot.weekDistanceKm,
    snapshot.latestRideDateLabel,
    snapshot.capabilities,
  ]);
}

function initialConversation(snapshot: ChatHomeSnapshot): ChatConversation {
  return {
    id: "conversation-1",
    messages: [{ role: "assistant", text: chatInitialMessage(snapshot) }],
    summarySlots: [],
  };
}

export function createChatSession(snapshot: ChatHomeSnapshot): ChatSessionState {
  const conversation = initialConversation(snapshot);
  return {
    snapshotFingerprint: chatHomeSnapshotFingerprint(snapshot),
    conversations: [conversation],
    activeConversationId: conversation.id,
    nextConversationIndex: 2,
  };
}

export function getActiveChatConversation(state: ChatSessionState): ChatConversation {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) ?? state.conversations[0]!;
}

export function startChatConversation(state: ChatSessionState, snapshot: ChatHomeSnapshot): ChatSessionState {
  const conversation = {
    ...initialConversation(snapshot),
    id: `conversation-${state.nextConversationIndex}`,
  };
  return {
    ...state,
    conversations: [...state.conversations, conversation],
    activeConversationId: conversation.id,
    nextConversationIndex: state.nextConversationIndex + 1,
  };
}

export function selectChatConversation(state: ChatSessionState, id: string): ChatSessionState {
  if (!state.conversations.some((conversation) => conversation.id === id)) return state;
  return { ...state, activeConversationId: id };
}

export function appendChatTurn(
  state: ChatSessionState,
  userText: string,
  assistantText: string,
  source: ChatSessionSummarySource,
): ChatSessionState {
  const summarySlot: ChatSessionSummarySlot = { kind: "deterministic_turn", source };
  return {
    ...state,
    conversations: state.conversations.map((conversation) => conversation.id === state.activeConversationId
      ? {
        ...conversation,
        messages: [...conversation.messages, { role: "user", text: userText }, { role: "assistant", text: assistantText }],
        summarySlots: [...conversation.summarySlots, summarySlot].slice(-CHAT_SESSION_SUMMARY_LIMIT),
      }
      : conversation),
  };
}

export function isChatSessionStale(state: ChatSessionState, snapshot: ChatHomeSnapshot): boolean {
  return state.snapshotFingerprint !== chatHomeSnapshotFingerprint(snapshot);
}
