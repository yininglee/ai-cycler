import type { MetricKey, RideRecord } from "../domain/ride-schema.ts";
import { RIDE_IDENTITY } from "./chat-routing.ts";

export const CHAT_HOME_SNAPSHOT_VERSION = "chat-home-v0.1" as const;

export type ChatCapability = "ride_summary" | "heart_rate" | "power" | "cadence";
export type ChatQuickQuestionId = "total" | "week" | "latest" | "capabilities";

export type ChatHomeSnapshot = {
  version: typeof CHAT_HOME_SNAPSHOT_VERSION;
  totalRideCount: number;
  totalDistanceKm: number;
  weekRideCount: number;
  weekDistanceKm: number;
  latestRideDateLabel: string | null;
  capabilities: ChatCapability[];
};

export type ChatMessage = { role: "assistant" | "user"; text: string };

export type ChatQuickQuestion = { id: ChatQuickQuestionId; label: string };

const CAPABILITY_LABELS: Record<ChatCapability, string> = {
  ride_summary: "基础骑行摘要",
  heart_rate: "心率",
  power: "功率",
  cadence: "踏频",
};

const CAPABILITY_METRICS: Array<{ capability: Exclude<ChatCapability, "ride_summary">; metrics: MetricKey[] }> = [
  { capability: "heart_rate", metrics: ["avgHeartRateBpm", "maxHeartRateBpm"] },
  { capability: "power", metrics: ["avgPowerW", "maxPowerW", "normalizedPowerW"] },
  { capability: "cadence", metrics: ["avgCadenceRpm", "maxCadenceRpm"] },
];

function finiteMetric(record: RideRecord, metric: MetricKey): boolean {
  const value = record.activity.metrics[metric]?.value;
  return value !== undefined && Number.isFinite(value);
}

function compactNumber(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(value);
}

function startOfWeek(now: Date): Date {
  const start = new Date(now);
  const weekday = start.getDay() || 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - weekday + 1);
  return start;
}

export function buildChatHomeSnapshot(records: RideRecord[], now = new Date()): ChatHomeSnapshot {
  const validNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const weekStart = startOfWeek(validNow);
  const datedRecords = records
    .map((record) => ({ record, date: record.activity.startTime ? new Date(record.activity.startTime) : null }))
    .filter((item): item is { record: RideRecord; date: Date } => item.date !== null && !Number.isNaN(item.date.getTime()));
  const latest = datedRecords.sort((left, right) => right.date.getTime() - left.date.getTime())[0]?.date ?? null;
  const isThisWeek = (date: Date) => date.getTime() >= weekStart.getTime() && date.getTime() <= validNow.getTime();
  const distanceKm = (items: RideRecord[]) => items.reduce((total, record) => {
    const distance = record.activity.metrics.distanceM?.value;
    return total + (distance !== undefined && Number.isFinite(distance) ? distance / 1_000 : 0);
  }, 0);
  const weekRecords = datedRecords.filter(({ date }) => isThisWeek(date)).map(({ record }) => record);
  const capabilities: ChatCapability[] = records.length > 0 ? ["ride_summary"] : [];
  for (const entry of CAPABILITY_METRICS) {
    if (records.some((record) => entry.metrics.some((metric) => finiteMetric(record, metric)))) capabilities.push(entry.capability);
  }

  return {
    version: CHAT_HOME_SNAPSHOT_VERSION,
    totalRideCount: records.length,
    totalDistanceKm: Number(distanceKm(records).toFixed(1)),
    weekRideCount: weekRecords.length,
    weekDistanceKm: Number(distanceKm(weekRecords).toFixed(1)),
    latestRideDateLabel: latest ? formatDate(latest) : null,
    capabilities,
  };
}

export function chatInitialMessage(snapshot: ChatHomeSnapshot): string {
  if (snapshot.totalRideCount === 0) return "你好，我是你的 AI 骑行伙伴。导入一条骑行记录后，我会在这里展示你的累计和本周摘要。";
  return `你好，我是你的 AI 骑行伙伴。\n累计骑行 ${snapshot.totalRideCount} 次 · 总里程 ${compactNumber(snapshot.totalDistanceKm)} km\n本周骑行 ${snapshot.weekRideCount} 次 · 累计 ${compactNumber(snapshot.weekDistanceKm)} km\n有什么想问的？`;
}

export function chatQuickQuestions(): ChatQuickQuestion[] {
  return [
    { id: "total", label: "我一共骑了多少？" },
    { id: "week", label: "这周骑了多少？" },
    { id: "latest", label: "我最近一次骑行是什么时候？" },
    { id: "capabilities", label: "目前可以分析哪些数据？" },
  ];
}

function capabilityText(snapshot: ChatHomeSnapshot): string {
  if (snapshot.capabilities.length === 0) return "导入骑行记录后，我会根据已读取到的数据说明可用范围。";
  return `当前可用的是：${snapshot.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join("、")}。体能评分、历史趋势、路线和训练建议尚未开放。`;
}

function responseForQuestion(id: ChatQuickQuestionId, snapshot: ChatHomeSnapshot): string {
  if (id === "total") return snapshot.totalRideCount === 0
    ? "你还没有可汇总的骑行记录。可以先从“骑行”页导入一条 FIT 或 GPX。"
    : `目前已记录 ${snapshot.totalRideCount} 次骑行，累计 ${compactNumber(snapshot.totalDistanceKm)} km。`;
  if (id === "week") return `本周已记录 ${snapshot.weekRideCount} 次骑行，累计 ${compactNumber(snapshot.weekDistanceKm)} km。`;
  if (id === "latest") return snapshot.latestRideDateLabel
    ? `最近一次可用骑行记录的日期是 ${snapshot.latestRideDateLabel}。`
    : "还没有带有效日期的骑行记录。";
  return capabilityText(snapshot);
}

function classifyInput(text: string): ChatQuickQuestionId | "social" | "boundary" {
  const compact = text.replaceAll(/\s/g, "");
  if (/^(你好|嗨|哈喽|谢谢|感谢)/.test(compact)) return "social";
  if (/(累计|一共|总里程|总共)/.test(compact)) return "total";
  if (/(本周|这周)/.test(compact)) return "week";
  if (/(最近|上次).*(骑行|记录)|(骑行|记录).*(最近|上次)/.test(compact)) return "latest";
  if (/(能力|哪些数据|可分析|有什么数据)/.test(compact)) return "capabilities";
  return "boundary";
}

export function replyToChatInput(input: string, snapshot: ChatHomeSnapshot): string | null {
  const text = input.trim();
  if (!text) return null;
  const intent = classifyInput(text);
  if (intent === "social") return "你好。这里目前只提供基于你的最小骑行摘要的确定性回答。";
  if (intent === "boundary") return "对话服务暂时不可用。我可以直接回答累计、本周、最近一次记录和可用数据范围；趋势比较、路线、体能评分和训练建议尚未开放。";
  return responseForQuestion(intent, snapshot);
}

export function replyToQuickQuestion(id: ChatQuickQuestionId, snapshot: ChatHomeSnapshot): string {
  return responseForQuestion(id, snapshot);
}

// CHAT-12 P1（G-AGGREGATE）：聚合问题由服务端确定性路由回答（classifyChatInput 命中 "aggregate"），
// 数据源与 /chat 页 buildChatHomeSnapshot 同源，不进入模型链路、不新增模型输入。
export type ChatAggregateKind = Extract<ChatQuickQuestionId, "total" | "week" | "latest">;

export function classifyAggregateQuestion(text: string): ChatAggregateKind | null {
  const noSpace = text.replaceAll(/\s/g, "");
  // G-IDENTITY：骑行身份问题（“当次/本次/最近一次是哪一次”）先于单次指涉守卫，
  // 与 chat-routing 的 RIDE_IDENTITY 路由口径一致，确定性回答最近一次记录日期。
  if (RIDE_IDENTITY.test(noSpace)) return "latest";
  if (/(本次|这次|当前|刚才|最新一条)/.test(noSpace)) return null;
  if (/(累计|一共|总里程|总共|总计)/.test(noSpace)) return "total";
  if (/(本周|这周|这一周)/.test(noSpace)) return "week";
  if (/(最近一次|上次|上一次|最近一条)/.test(noSpace) && /(什么时候|何时|哪天|几号|日期|时间)/.test(noSpace)) return "latest";
  return null;
}

export function aggregateReply(kind: ChatAggregateKind, records: RideRecord[], now = new Date()): string {
  return responseForQuestion(kind, buildChatHomeSnapshot(records, now));
}
