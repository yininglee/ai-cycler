import type { RideRecord } from "../domain/ride-schema.ts";

// AGT-H1（SD-4）：**记录选择（rideRef）合同与解析**——「用户指哪条就分析哪条」的唯一实现点。
//
// ## 为什么要这一层（现状的三个体验问题）
//
// 1. 说"分析一下那次骑行" → 系统猜不出，**默默当最近一次答**，而且不告诉你它选了哪条；
// 2. 说"倒数第二次" → 不认识，照样回最近一次；
// 3. 同一天骑了两次 → 永远只答出发较晚的那次，另一次问不到（`findRideRecordByDate` 同天取最晚）。
//
// 改造后的规则只有三条：**指得清就按指的答**（回复里写明是哪次）｜**指不清就列候选让用户点**
// （绝不偷偷替用户选最近一次）｜**点选后绝不混淆**（后续追问沿用同一条）。
//
// ## 与既有锚点通道的关系（迁移期两套并存，退役归 AGT-R）
//
// 旧的 `RideAnchorOverride`（日期/最新）**不删除**，它在编排层被映射成本模块的 rideRef 之一
// （`{date}` / `{ordinal:-1}`）。工具层自此只认 rideRef；"默认取最新"不再是工具的隐含行为，
// 而是编排层显式写下的 `{ordinal:-1}`——可观测、可被 H2 换成"问用户"。
//
// ## 四种结局（不放宽成布尔）
//
// resolved（唯一定位）/ ambiguous（同日多条，需要人区分）/ need_reference（没给指涉）/
// not_found（给的日期或序数在本人记录里没有对应）。后三者都带 `candidates`，
// 因为"没找到"时用户最需要的下一句就是"最近这几次你要哪个"。

export const CHAT_RIDE_REFERENCE_SCHEMA_VERSION = "chat-ride-ref-v0.1" as const;
/** 候选上限：与 D-H1 建议的展示密度（最近 5 条）对齐，H2 直接投给前端即可。 */
export const CHAT_RIDE_REFERENCE_MAX_CANDIDATES = 5;
/** 序数下限：从最新往前数最多 365 次，超出视为非法输入（不是"没找到"）。 */
export const CHAT_RIDE_REFERENCE_MIN_ORDINAL = -365;

export type RideAnchorDate = { year?: number; month: number; day: number };

// 三选一（parse 层强制互斥）：
//   {date}    绝对日期 YYYY-MM-DD（Asia/Shanghai 口径）
//   {ordinal} 按出发时间倒序的负数序号，-1 = 最近一次
//   {rideId}  唯一标识（点选/前轮 choice 回传，已含同日区分能力）
export type ChatRideRef = { date: string } | { ordinal: number } | { rideId: string };

export type ChatRideCandidate = {
  rideId: string;
  /** "8月20日"（无有效出发时间时缺省）。 */
  dateLabel?: string;
  /** "06:12"（Asia/Shanghai）——**仅在候选列表里用于同日区分**，不作为事实进入 Claims。 */
  timeLabel?: string;
  distanceKm?: number;
  hasPower: boolean;
  hasHeartRate: boolean;
};

export type ChatRideRefSource = "date" | "ordinal";

export type ChatRideRefReason =
  | "same_day_multiple"
  | "date_not_found"
  | "ordinal_out_of_range"
  | "reference_missing"
  | "no_records";

export type ChatRideRefResolution =
  | { status: "resolved"; record: RideRecord; date?: string; source: ChatRideRefSource }
  | { status: "ambiguous"; reason: "same_day_multiple"; candidates: ChatRideCandidate[] }
  | { status: "not_found"; reason: "date_not_found" | "ordinal_out_of_range"; candidates: ChatRideCandidate[] }
  | { status: "need_reference"; reason: "reference_missing" | "no_records"; candidates: ChatRideCandidate[] };

// ---------------------------------------------------------------------------
// 日期工具（AGT-H1：自 chat-ride-anchor 下移，由该模块 re-export 保持既有导入不变）
// ---------------------------------------------------------------------------

// Asia/Shanghai 日历日（YYYY-MM-DD）——锚点存储口径，与摘要网关合同（chat-routing）一致。
export function rideAnchorDate(startTime: string | undefined): string | undefined {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(startTime));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

export function parseRideAnchorDate(date: string): RideAnchorDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

// "2026-08-20" → "8月20日"——回复展示口径（月/日），与 /chat 首页 latestRideDateLabel 一致。
export function rideAnchorDateLabel(date: string): string {
  const parsed = parseRideAnchorDate(date);
  if (!parsed) return date;
  return `${parsed.month}月${parsed.day}日`;
}

// 出发时刻（Asia/Shanghai，HH:mm）——只给候选列表做同日区分用。
export function rideAnchorTimeLabel(startTime: string | undefined): string | undefined {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(startTime));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : undefined;
}

function isRealCalendarDate(value: string): boolean {
  const parsed = parseRideAnchorDate(value);
  if (!parsed?.year) return false;
  const composed = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  return composed.getUTCFullYear() === parsed.year && composed.getUTCMonth() === parsed.month - 1 && composed.getUTCDate() === parsed.day;
}

/**
 * 把"年月日 + 出发时间"折成候选对象所需的两个标签。
 * 两者都来自 Asia/Shanghai 同一时区，避免"日期对了但时刻是 UTC"的错位。
 */
export function formatRideCandidateLabels(startTime: string | undefined): { dateLabel?: string; timeLabel?: string } {
  const date = rideAnchorDate(startTime);
  const timeLabel = rideAnchorTimeLabel(startTime);
  return {
    ...(date ? { dateLabel: rideAnchorDateLabel(date) } : {}),
    ...(timeLabel ? { timeLabel } : {}),
  };
}

// ---------------------------------------------------------------------------
// 输入解析
// ---------------------------------------------------------------------------

// 与 chat-tools 的 validRideId 同口径：非空、无首尾空白、≤128 字。
// 不做字面前缀白名单——`upload-<uuid>` / `private-ride-0` / `r-0820` 都是实现的偶然，不是合同。
function isRideIdValue(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 128;
}

/**
 * 解析 rideRef 入参：**必须恰好一个键**，且值合法。
 * 多键（{date, rideId}）不接受——"日期与 id 不一致时听谁的"没有正确答案，让调用方先说清楚。
 */
export function parseChatRideRef(value: unknown): ChatRideRef | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1) return undefined;
  const record = value as Record<string, unknown>;
  if (keys[0] === "date") {
    return typeof record.date === "string" && isRealCalendarDate(record.date) ? { date: record.date } : undefined;
  }
  if (keys[0] === "ordinal") {
    const ordinal = record.ordinal;
    return typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal <= -1 && ordinal >= CHAT_RIDE_REFERENCE_MIN_ORDINAL
      ? { ordinal }
      : undefined;
  }
  if (keys[0] === "rideId") {
    return isRideIdValue(record.rideId) ? { rideId: record.rideId } : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 候选与查找
// ---------------------------------------------------------------------------

function candidateOf(record: RideRecord): ChatRideCandidate {
  const labels = formatRideCandidateLabels(record.activity.startTime);
  const distance = record.activity.metrics.distanceM;
  const power = record.activity.metrics.avgPowerW;
  const heartRate = record.activity.metrics.avgHeartRateBpm;
  const usable = (metric: typeof distance): boolean => Boolean(metric) && metric!.qualityStatus === "valid" && Number.isFinite(metric!.value);
  return {
    rideId: record.activity.rideId,
    ...labels,
    ...(usable(distance) ? { distanceKm: Math.round((distance!.value / 1_000) * 10) / 10 } : {}),
    // "有没有功率/心率"是**可用性**判断，不是数值：同一日两条记录靠它就能区分"哪条有功率数据"。
    hasPower: Boolean(power) && power!.qualityStatus === "valid",
    hasHeartRate: Boolean(heartRate) && heartRate!.qualityStatus === "valid",
  };
}

function startTimeOf(record: RideRecord): number {
  const value = Date.parse(record.activity.startTime ?? "");
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/** 按出发时间倒序（最新在前）；无有效出发时间的记录排最后，顺序稳定。 */
function sortByStartTimeDesc(records: readonly RideRecord[]): RideRecord[] {
  return [...records]
    .map((record) => ({ record, time: startTimeOf(record) }))
    .sort((left, right) => (right.time === left.time ? 0 : right.time - left.time))
    .map((entry) => entry.record);
}

/** 最近 N 次候选（默认 5 条，与 D-H1 展示密度对齐）。 */
export function chatRideCandidates(entries: ReadonlyArray<{ record: RideRecord }>, limit = CHAT_RIDE_REFERENCE_MAX_CANDIDATES): ChatRideCandidate[] {
  return sortByStartTimeDesc(entries.map((entry) => entry.record)).slice(0, Math.max(0, limit)).map(candidateOf);
}

/**
 * 日期查找**返回全部命中**（不再"同天取最晚"）。
 * 年份口径与旧实现一致：显式年份精确匹配；未给年份时依次试当前/上一年（跨年同月日取最近）。
 */
export function findRideRecordsByDate(entries: ReadonlyArray<{ record: RideRecord }>, target: RideAnchorDate, now = new Date()): RideRecord[] {
  const dated = entries
    .map((entry) => ({ record: entry.record, date: rideAnchorDate(entry.record.activity.startTime) }))
    .filter((entry): entry is { record: RideRecord; date: string } => entry.date !== undefined);
  const years = target.year ? [target.year] : [now.getFullYear(), now.getFullYear() - 1];
  for (const year of years) {
    const sameDay = dated
      .filter((entry) => {
        const parsed = parseRideAnchorDate(entry.date)!;
        return parsed.year === year && parsed.month === target.month && parsed.day === target.day;
      })
      .map((entry) => entry.record);
    if (sameDay.length > 0) return sortByStartTimeDesc(sameDay);
  }
  return [];
}

/** 出发时间最新记录（CHAT-15 口径）：无有效 startTime 的记录不参与"最新"判定，全部缺失时回退存储顺序首条。 */
export function latestRideRecord(entries: ReadonlyArray<{ record: RideRecord }>): RideRecord | undefined {
  const dated = entries
    .map((entry) => ({ record: entry.record, time: entry.record.activity.startTime ? Date.parse(entry.record.activity.startTime) : Number.NaN }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => right.time - left.time);
  return (dated[0] ?? entries[0])?.record;
}

/** 第 n 次（从最新往前数，1 起）：1 = 最近一次。 */
export function rideRecordByOrdinal(entries: ReadonlyArray<{ record: RideRecord }>, ordinal: number): RideRecord | undefined {
  if (ordinal > -1) return undefined;
  const index = -ordinal - 1;
  return sortByStartTimeDesc(entries.map((entry) => entry.record))[index];
}

// ---------------------------------------------------------------------------
// 解析（唯一实现点）
// ---------------------------------------------------------------------------

/**
 * rideRef → 记录。**`{rideId}` 不在这里解析**：它要走工具层的归属校验
 * （`ownedRide`，越权 id 报 NOT_FOUND），本函数只处理"服务端自己查"的日期与序数。
 */
export function resolveChatRideRef(input: {
  ref?: ChatRideRef;
  entries: ReadonlyArray<{ record: RideRecord }>;
  now?: Date;
}): ChatRideRefResolution {
  const { ref, entries } = input;
  const candidates = chatRideCandidates(entries);
  if (!ref) {
    return { status: "need_reference", reason: entries.length === 0 ? "no_records" : "reference_missing", candidates };
  }
  if ("date" in ref) {
    const target = parseRideAnchorDate(ref.date);
    const matches = target ? findRideRecordsByDate(entries, target, input.now) : [];
    if (matches.length === 0) return { status: "not_found", reason: "date_not_found", candidates };
    // 同日多条 → **不猜**：把两条都摆出来，让用户点（H2 转成 choices）。
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        reason: "same_day_multiple",
        candidates: matches.slice(0, CHAT_RIDE_REFERENCE_MAX_CANDIDATES).map(candidateOf),
      };
    }
    const record = matches[0]!;
    return { status: "resolved", record, ...(rideAnchorDate(record.activity.startTime) ? { date: rideAnchorDate(record.activity.startTime) } : {}), source: "date" };
  }
  // `{rideId}` 不归本函数解析（要走工具层的归属校验），落到这里说明调用方漏了前置分支：
  // 按"没给指涉"处理，让上层去问，而不是在这里放行一个未校验的 id。
  if (!("ordinal" in ref)) {
    return { status: "need_reference", reason: "reference_missing", candidates };
  }
  const record = rideRecordByOrdinal(entries, ref.ordinal);
  if (!record) return { status: "not_found", reason: "ordinal_out_of_range", candidates };
  return { status: "resolved", record, ...(rideAnchorDate(record.activity.startTime) ? { date: rideAnchorDate(record.activity.startTime) } : {}), source: "ordinal" };
}

// ---------------------------------------------------------------------------
// 确定性话术（零模型）
// ---------------------------------------------------------------------------

/** 候选的一句话描述："8月20日 06:12 · 31.1 km · 功率" */
export function chatRideCandidateLabel(candidate: ChatRideCandidate): string {
  const when = [candidate.dateLabel ?? "日期未知", candidate.timeLabel].filter(Boolean).join(" ");
  const distance = candidate.distanceKm !== undefined ? `${candidate.distanceKm} km` : "距离未知";
  const data = [candidate.hasPower ? "功率" : undefined, candidate.hasHeartRate ? "心率" : undefined].filter(Boolean).join("/");
  return `${when} · ${distance}${data ? ` · ${data}` : ""}`;
}

/**
 * 把"未定"的解析结果（ambiguous / not_found / need_reference）翻成**零模型**话术。
 * 有候选时一定把候选列出来——用户刚说"那次"，看到"最近这几次"通常就够点了。
 */
export function chatRideRefReply(
  resolution: { status: "ambiguous" | "not_found" | "need_reference"; reason: ChatRideRefReason; candidates: ChatRideCandidate[] },
  options: { dateLabel?: string; ordinal?: number } = {},
): string {
  const list = resolution.candidates.map((candidate) => chatRideCandidateLabel(candidate)).join("；");
  switch (resolution.status) {
    case "ambiguous":
      return `${options.dateLabel ?? "这一天"}有 ${resolution.candidates.length} 条骑行记录：${list}。你想看哪一条？`;
    case "not_found":
      if (resolution.reason === "ordinal_out_of_range") {
        const count = resolution.candidates.length;
        return count === 0
          ? "还没有可供查看的骑行记录。导入一条自己的骑行记录后再试。"
          : `没有找到倒数第 ${Math.abs(options.ordinal ?? 2)} 次骑行（目前只有最近这几条）：${list}。你想看哪一条？`;
      }
      return `没有找到 ${options.dateLabel ?? "这个日期"} 的骑行记录。${resolution.candidates.length ? `最近几次是：${list}。你想看哪一条？` : "导入记录后再试。"}`;
    case "need_reference":
      return resolution.reason === "no_records"
        ? "还没有可供查看的骑行记录。导入一条自己的骑行记录后再试。"
        : `你想分析哪一次骑行？最近几次是：${list}。可以直接说日期，或点选其中一条。`;
  }
}
