export type ChatHistoryDateRange = { startDate: string; endDate: string };

export function parseChatHistoryDateRange(value: unknown): ChatHistoryDateRange | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const range = value as Record<string, unknown>;
  if (Object.keys(range).length !== 2 || !Object.hasOwn(range, "startDate") || !Object.hasOwn(range, "endDate")) return undefined;
  const valid = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!valid(range.startDate) || !valid(range.endDate)) return undefined;
  const days = historyRangeDays({ startDate: range.startDate, endDate: range.endDate });
  return days >= 1 && days <= 365 ? { startDate: range.startDate, endDate: range.endDate } : undefined;
}

export function historyRangeDays(range: ChatHistoryDateRange): number {
  return (Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) / 86_400_000 + 1;
}
