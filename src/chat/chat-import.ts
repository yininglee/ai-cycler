import { appendImportedRides, readStoredChatSession, rememberChatRideSelection, storeChatSession, type ChatSessionState } from "./chat-session.ts";

export type ChatImportReceipt = { receiptId: string; conversationId: string; ids: string[]; text: string };
export const CHAT_IMPORT_QUEUE_KEY = "cycler-import-results";
export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function chatReturnPath(conversationId?: string, discussPlan = false): string {
  if (!isConversationId(conversationId)) return "/chat";
  const query = new URLSearchParams({ conversation: conversationId });
  if (discussPlan) query.set("discussPlan", "1");
  return `/chat?${query}`;
}
export function rememberStoredRideInspection(rideId: string, conversationId?: string, scope?: string): void {
  const state = readStoredChatSession(scope);
  if (state) storeChatSession(rememberChatRideSelection(state, rideId, conversationId ?? state.activeConversationId), scope);
}
export function parseImportReceipts(value: unknown, fallbackConversationId: string): ChatImportReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item.text !== "string" || item.text.length > 600 || !Array.isArray(item.ids) || item.ids.length > 20
      || !item.ids.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id))) return [];
    const conversationId = isConversationId(item.conversationId) ? item.conversationId : fallbackConversationId;
    const ids = [...new Set<string>(item.ids)];
    // Stable legacy identity also prevents replay after persistence but before queue acknowledgement.
    const receiptId = typeof item.receiptId === "string" && item.receiptId.length <= 4096 ? item.receiptId : `legacy:${JSON.stringify([conversationId, ids, item.text])}`;
    return [{ receiptId, conversationId, ids, text: item.text }];
  });
}
export function restoreImportReceipts(state: ChatSessionState, receipts: readonly ChatImportReceipt[]): ChatSessionState {
  let next = state;
  for (const receipt of receipts) next = appendImportedRides(next, receipt.ids, receipt.text, receipt.conversationId, receipt.receiptId);
  return next;
}
