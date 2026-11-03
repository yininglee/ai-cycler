import { planDate } from "../domain/training-plan.ts";
export type PlanDiscussion = { planId: string; version: number; date?: string };
export const planDiscussionKey = (conversationId: string) => `cycler-plan-discussion:${conversationId}`;
export function parsePlanDiscussion(value: unknown): PlanDiscussion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["planId", "version", "date"].includes(key)) || typeof v.planId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v.planId) || typeof v.version !== "number" || !Number.isSafeInteger(v.version) || v.version < 1 || v.date !== undefined && !planDate(v.date)) return;
  return { planId: v.planId, version: v.version, ...(v.date ? { date: v.date as string } : {}) };
}
export const planDiscussionText = (focus: PlanDiscussion) => `刚查看训练计划第${focus.version}版${focus.date ? `，日期${focus.date}` : ""}；仅作话题线索，安排须重新读取，以当前用户问题为准。`;
