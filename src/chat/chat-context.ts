import type { ChatSessionSummary } from "./chat-routing.ts";
import type { ChatChoiceRef } from "./chat-interaction.ts";

export const CHAT_CONTEXT_CONTRACT_VERSION = "ride-chat-context-v0.2" as const;

export type ChatRideScope = "overview" | "cleared" | "pending";
export function isChatRideScope(value: unknown): value is ChatRideScope {
  return value === "overview" || value === "cleared" || value === "pending";
}

/** Neutral turns preserve the object; an explicit scope reset is a barrier. */
export function lastChatRideChoice(summaries: readonly ChatSessionSummary[]): ChatChoiceRef | undefined {
  for (let index = summaries.length - 1; index >= 0; index--) {
    const summary = summaries[index];
    if (summary.rideScope || summary.route === "level_assessment") return undefined;
    if (summary.choice?.kind === "ride") return summary.choice;
  }
  return undefined;
}

export function hasExplicitChatRideReference(text: string): boolean {
  return /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}[日号]|最近一次|最近一条|最新|上次|上一次|倒数/.test(text.replaceAll(/\s/g, ""));
}

export function isStandaloneChatKnowledge(text: string): boolean {
  return !/这次|本次|那次|我的|我这|上次|最近一次|倒数/.test(text) && !hasExplicitChatRideReference(text)
    && /什么是|是什么|原理|概念|术语|如何理解|怎么理解|解释|讲讲|含义|意思/.test(text);
}
