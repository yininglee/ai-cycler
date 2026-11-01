import type { ChatRoute, ChatSessionSummary } from "./chat-routing.ts";
import { isChatChoiceRef, type ChatChoiceRef } from "./chat-interaction.ts";
import { chatInitialMessage, type ChatHomeSnapshot, type ChatMessage } from "./chat-home.ts";

export const CHAT_SESSION_SUMMARY_LIMIT = 6;
export const CHAT_SESSION_QUESTION_MAX_CHARS = 120;

export type ChatSessionSummarySource = "quick_question" | "typed_input";

// CHAT-14 P1：摘要槽位升级——session_turn 携带白名单上下文（question ≤120 字截断、该轮 route、
// 该轮解析到的骑乘锚点日期）；deterministic_turn 为旧结构（本地历史对话兼容读取，不参与摘要传递）。
// AGT-H0（摘要槽位 v0.3）：新增可选 `choice {kind, id}`——跨轮选择记忆。旧槽位（v0.2，无 choice）
// 照常读取与传递，因此不需要迁移或清空用户本地历史。
export type ChatSessionSummarySlot = {
  kind: "deterministic_turn" | "session_turn";
  source: ChatSessionSummarySource;
  question?: string;
  route?: ChatRoute;
  rideAnchor?: string;
  choice?: ChatChoiceRef;
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
    messages: [{ role: "assistant", kind: "welcome", text: chatInitialMessage(snapshot) }],
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
    snapshotFingerprint: chatHomeSnapshotFingerprint(snapshot),
    conversations: [...state.conversations, conversation],
    activeConversationId: conversation.id,
    nextConversationIndex: state.nextConversationIndex + 1,
  };
}

export function selectChatConversation(state: ChatSessionState, id: string): ChatSessionState {
  if (!state.conversations.some((conversation) => conversation.id === id)) return state;
  return { ...state, activeConversationId: id };
}

// CHAT-14 P1：已知该轮 route 时记 session_turn 槽位（服务端响应返回 route/rideAnchor）；
// route 未知（客户端兜底回复、API 失败）退回 deterministic_turn，不参与摘要传递。
export function appendChatTurn(
  state: ChatSessionState,
  userText: string,
  assistantText: string,
  source: ChatSessionSummarySource,
  turn?: { route: ChatRoute; rideAnchor?: string; choice?: ChatChoiceRef },
): ChatSessionState {
  const summarySlot: ChatSessionSummarySlot = turn
    ? {
      kind: "session_turn",
      source,
      question: userText.slice(0, CHAT_SESSION_QUESTION_MAX_CHARS),
      route: turn.route,
      ...(turn.rideAnchor ? { rideAnchor: turn.rideAnchor } : {}),
      ...(turn.choice ? { choice: turn.choice } : {}),
    }
    : { kind: "deterministic_turn", source };
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

// 仅当前活跃对话的 session_turn 槽位随请求发送（≤6 条）；旧结构槽位与切换后的对话不发送。
export function buildChatSessionSummaries(conversation: ChatConversation): ChatSessionSummary[] {
  return conversation.summarySlots.flatMap((slot): ChatSessionSummary[] => {
    if (slot.kind !== "session_turn" || !slot.question || !slot.route) return [];
    return [{
      kind: "session_turn",
      question: slot.question,
      route: slot.route,
      ...(slot.rideAnchor ? { rideAnchor: slot.rideAnchor } : {}),
      ...(slot.choice ? { choice: slot.choice } : {}),
    }];
  });
}

export function isChatSessionStale(state: ChatSessionState, snapshot: ChatHomeSnapshot): boolean {
  return state.snapshotFingerprint !== chatHomeSnapshotFingerprint(snapshot);
}

export const CHAT_SESSION_STORAGE_KEY = "ai-ride-chat-session-v0.1";

function isChatSessionSummarySlot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const slot = value as Partial<ChatSessionSummarySlot>;
  if (slot.kind !== "deterministic_turn" && slot.kind !== "session_turn") return false;
  if (slot.question !== undefined && typeof slot.question !== "string") return false;
  if (slot.rideAnchor !== undefined && typeof slot.rideAnchor !== "string") return false;
  // AGT-H0：v0.3 choice 槽位——缺省合法（旧会话），提供则必须结构正确。
  if (slot.choice !== undefined && !isChatChoiceRef(slot.choice)) return false;
  return slot.route === undefined || typeof slot.route === "string";
}

function isChatSessionState(value: unknown): value is ChatSessionState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<ChatSessionState>;
  if (typeof state.snapshotFingerprint !== "string") return false;
  if (typeof state.activeConversationId !== "string") return false;
  if (typeof state.nextConversationIndex !== "number") return false;
  if (!Array.isArray(state.conversations) || state.conversations.length === 0) return false;
  if (!state.conversations.some((conversation) => conversation?.id === state.activeConversationId)) return false;
  return state.conversations.every((conversation) =>
    typeof conversation?.id === "string"
    && Array.isArray(conversation.messages)
    && conversation.messages.every((message) =>
      (message?.role === "user" || message?.role === "assistant") && typeof message?.text === "string")
    && Array.isArray(conversation.summarySlots)
    && conversation.summarySlots.every(isChatSessionSummarySlot));
}

// 对话记录仅保存在用户本地浏览器（localStorage），不上传服务端——与脱敏事件不落用户原文的隐私边界一致。
export function readStoredChatSession(): ChatSessionState | null {
  try {
    const raw = globalThis.localStorage?.getItem(CHAT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isChatSessionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function storeChatSession(state: ChatSessionState): void {
  try {
    globalThis.localStorage?.setItem(CHAT_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 本地存储不可用时静默降级为仅当前标签页保留
  }
}
