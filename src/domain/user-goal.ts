/** Shared goal form contract; language interpretation belongs to the Agent. */
export const USER_GOAL_TITLES = ["保持规律骑行", "提升耐力／完成长距离", "提升 FTP", "提升爬坡表现", "备赛", "自定义"] as const;
export type UserGoalDraft = { title: string; detail: string };

export function isUserGoalDraft(value: unknown): value is UserGoalDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const goal = value as Record<string, unknown>;
  return Object.keys(goal).length === 2 && USER_GOAL_TITLES.includes(goal.title as typeof USER_GOAL_TITLES[number])
    && typeof goal.detail === "string" && goal.detail.length <= 400 && !/[\u0000-\u001f\u007f]/.test(goal.detail)
    && (!["自定义", "备赛"].includes(goal.title as string) || Boolean(goal.detail.trim()));
}
