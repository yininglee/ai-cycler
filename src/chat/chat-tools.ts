import {
  atomicCapabilityKeys,
  buildAtomicCapabilityProfile,
  getAtomicCapability,
  type AtomicCapabilityKey,
  type CapabilityQuality,
  type CapabilitySource,
  type CapabilityUnavailableReason,
} from "../domain/atomic-capabilities.ts";
import {
  buildHistoricalComparisonSnapshot,
  type ComparisonConclusion,
  type ComparabilityStatus,
  type ComparisonReasonCode,
  type HistoricalMetricComparison,
} from "../domain/historical-comparison.ts";
import { buildRideAnalysisContext, type AnalysisContextClaim } from "../domain/ride-analysis-context.ts";
import type { MetricKey, RideRecord } from "../domain/ride-schema.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { buildHistoricalRide, buildHistoricalRides } from "../persistence/persistent-history.ts";

export const CHAT_TOOL_SCHEMA_VERSION = "chat-tools-v0.1" as const;
export const CHAT_TOOL_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_MAX_INPUT_BYTES = 4 * 1_024;
export const CHAT_TOOL_MAX_RESULT_BYTES = 32 * 1_024;

export const rideContextDimensions = ["summary", "heart_rate", "power", "cadence", "elevation"] as const;
export type RideContextDimension = typeof rideContextDimensions[number];

// CHAT-13：compare_rides 只读工具的比较指标白名单与窗口口径。
// 窗口冻结为 30 天（MVP-REPEAT-01 持久历史口径）；更长窗口属 BX-TREND，不在本工具范围。
export const chatComparisonMetricKeys = ["distanceM", "avgSpeedMps", "avgPowerW", "avgHeartRateBpm", "avgCadenceRpm", "elevationGainM"] as const;
export type ChatComparisonMetricKey = (typeof chatComparisonMetricKeys)[number];
export const CHAT_COMPARISON_WINDOW_DAYS = 30 as const;

// CHAT-17 P1：find_ride 只读检索工具（CHAT-16 取消后并入作 L2b 首个场景）——
// 在本人记录范围内按指标枚举（比较指标白名单口径）做跨记录筛选/排名：
// 极值模式（max/min：最远/最快/最高/最短…）、阈值模式（threshold：平均心率>N 等，
// 严格大于）与窗口上限（1..30 天，编排层默认 30）。窗口以锚点记录出发时间为界
// （与 compare_rides 同口径），与比较不同：锚点本身也是候选。阈值模式命中可能多条，
// 按出发时间倒序返回并设返回条数上限；极值模式至多一条（同值取最近一次）。
export const chatFindRideModes = ["max", "min", "threshold"] as const;
export type ChatFindRideMode = (typeof chatFindRideModes)[number];
export const CHAT_FIND_RIDE_MAX_WINDOW_DAYS = CHAT_COMPARISON_WINDOW_DAYS;
export const CHAT_FIND_RIDE_MAX_MATCHES = 5 as const;

export type ChatToolName = "get_ride_context" | "get_capabilities" | "compare_rides" | "find_ride";
export type ChatToolErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "TIMEOUT" | "TEMPORARY_UNAVAILABLE";

type RideContextInput = { rideId: string; dims: RideContextDimension[] };
type CapabilitiesInput = { rideId: string; caps: AtomicCapabilityKey[] };
type CompareRidesInput = { rideId: string; metrics: ChatComparisonMetricKey[]; windowDays: number };
type FindRideInputBase = { rideId: string; metric: ChatComparisonMetricKey; metrics: ChatComparisonMetricKey[]; windowDays: number };
export type FindRideInput = FindRideInputBase & ({ mode: "max" | "min" } | { mode: "threshold"; threshold: number });
export type ChatToolInvocation =
  | { tool: "get_ride_context"; input: RideContextInput }
  | { tool: "get_capabilities"; input: CapabilitiesInput }
  | { tool: "compare_rides"; input: CompareRidesInput }
  | { tool: "find_ride"; input: FindRideInput };

type ChatToolClaim = Pick<AnalysisContextClaim, "claimId" | "kind" | "key" | "value" | "unit" | "confidence" | "formulaVersion" | "displayValue" | "displayUnit">;

export type RideContextToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_ride_context";
  rideId: string;
  // CHAT-15：本次骑行日期标签（Asia/Shanghai，与详情页 formatRideTitle 同口径，补年份）。
  // 投影提供与校验允许成对：模型可表述“8月17日这次骑行”，日期数字进入 current_ride 白名单。
  rideDateLabel?: string;
  dimensions: RideContextDimension[];
  claims: ChatToolClaim[];
  limitations: string[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

export type CapabilityToolItem = {
  key: AtomicCapabilityKey;
  available: boolean;
  sources: CapabilitySource[];
  qualityStatus: CapabilityQuality;
  dependencyKeys: AtomicCapabilityKey[];
  unavailableReason?: CapabilityUnavailableReason;
};

export type CapabilitiesToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_capabilities";
  rideId: string;
  capabilities: CapabilityToolItem[];
};

// CHAT-13：compare_rides 结果——锚点（当前记录）与 30 天窗口历史基线的比较投影。
// claimId 仅在可比时存在（领域层冻结：不可比指标不产生趋势 claim），
// 输出校验只允许模型引用可比 claim；change/relativeChangePercent 为显示空间内的舍入值，
// 模型回复中的数字必须能溯源到这些值（输出校验数字白名单）。
export type ComparisonClaimValue = { value: number; unit: string; displayValue: string };

export type CompareRidesClaim = {
  claimId?: string;
  metricKey: ChatComparisonMetricKey;
  scope: "all" | "same_route";
  status: ComparabilityStatus;
  reasonCodes: ComparisonReasonCode[];
  anchor?: ComparisonClaimValue;
  baseline?: ComparisonClaimValue & { sampleCount: number };
  change?: number;
  relativeChangePercent?: number;
};

export type CompareRidesToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "compare_rides";
  rideId: string;
  windowDays: number;
  anchorStartTime?: string;
  sampleCount: number;
  comparability: {
    status: ComparabilityStatus;
    reasonCodes: ComparisonReasonCode[];
    sampleCount: number;
    minimumSampleCount: number;
    allowedConclusion: ComparisonConclusion;
  };
  claims: CompareRidesClaim[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

// CHAT-17 P1：find_ride 结果——本人记录窗口内的跨记录筛选/排名投影。
// claimId 为 claim:find:<rideId>:<metricKey>；displayValue 与 compare_rides 共用
// 同一显示空间（COMPARISON_METRIC_FORMAT），模型引用与输出校验数字白名单同口径。
// no_match 时 matches 为空、reasonCodes 解释确定性原因（编排层零模型降级话术依据）。
export type FindRideClaim = {
  claimId: string;
  metricKey: ChatComparisonMetricKey;
  value: number;
  unit: string;
  displayValue: string;
};

export type FindRideMatch = {
  rideId: string;
  rideDateLabel?: string;
  claims: FindRideClaim[];
};

export type FindRideReasonCode = "ANCHOR_TIME_MISSING" | "METRIC_MISSING" | "THRESHOLD_NO_MATCH";

export type FindRideToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "find_ride";
  rideId: string;
  windowDays: number;
  metric: ChatComparisonMetricKey;
  mode: ChatFindRideMode;
  threshold?: number;
  status: "matched" | "no_match";
  reasonCodes: FindRideReasonCode[];
  candidateCount: number;
  matchedCount: number;
  matches: FindRideMatch[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

export type ChatToolResult = RideContextToolResult | CapabilitiesToolResult | CompareRidesToolResult | FindRideToolResult;

export class ChatToolError extends Error {
  readonly code: ChatToolErrorCode;

  constructor(code: ChatToolErrorCode) {
    super(code);
    this.code = code;
  }
}

const DIMENSION_METRICS: Record<RideContextDimension, MetricKey[]> = {
  summary: ["distanceM", "elapsedTimeS", "movingTimeS", "avgSpeedMps", "maxSpeedMps"],
  heart_rate: ["avgHeartRateBpm", "maxHeartRateBpm"],
  power: ["avgPowerW", "maxPowerW", "normalizedPowerW"],
  cadence: ["avgCadenceRpm", "maxCadenceRpm"],
  elevation: ["elevationGainM"],
};

const DIMENSION_FEATURES: Record<RideContextDimension, string[]> = {
  summary: ["speed"],
  heart_rate: ["heartRate"],
  power: ["power"],
  cadence: ["cadence"],
  elevation: ["elevation"],
};

const DIMENSION_CAPABILITIES: Record<RideContextDimension, AtomicCapabilityKey[]> = {
  summary: ["distance", "timing", "speed"],
  heart_rate: ["heartRate"],
  power: ["power", "normalizedPower"],
  cadence: ["cadence"],
  elevation: ["elevation"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validRideId(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 128;
}

function uniqueEnumValues<T extends string>(value: unknown, allowed: readonly T[], maximum: number): value is T[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximum
    && value.every((item): item is T => typeof item === "string" && allowed.includes(item as T))
    && new Set(value).size === value.length;
}

function validWindowDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365;
}

// CHAT-17 P1：find_ride 输入校验——窗口上限冻结 30 天（与比较口径一致）；
// threshold 仅在 threshold 模式下允许出现（hasExactKeys 按模式区分键集）且必须为有限数。
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function validFindRideWindowDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CHAT_FIND_RIDE_MAX_WINDOW_DAYS;
}

function validThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseChatToolInvocation(value: unknown): ChatToolInvocation {
  if (!isPlainObject(value) || !hasExactKeys(value, ["tool", "input"]) || !isPlainObject(value.input)) throw new ChatToolError("INVALID_INPUT");
  if (value.tool === "get_ride_context") {
    if (!hasExactKeys(value.input, ["rideId", "dims"]) || !validRideId(value.input.rideId) || !uniqueEnumValues(value.input.dims, rideContextDimensions, rideContextDimensions.length)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, dims: value.input.dims } };
  }
  if (value.tool === "get_capabilities") {
    if (!hasExactKeys(value.input, ["rideId", "caps"]) || !validRideId(value.input.rideId) || !uniqueEnumValues(value.input.caps, atomicCapabilityKeys, 8)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, caps: value.input.caps } };
  }
  if (value.tool === "compare_rides") {
    if (
      !hasExactKeys(value.input, ["rideId", "metrics", "windowDays"])
      || !validRideId(value.input.rideId)
      || !uniqueEnumValues(value.input.metrics, chatComparisonMetricKeys, chatComparisonMetricKeys.length)
      || !validWindowDays(value.input.windowDays)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, metrics: value.input.metrics, windowDays: value.input.windowDays } };
  }
  if (value.tool === "find_ride") {
    const mode = value.input.mode;
    const expectedKeys = mode === "threshold"
      ? ["rideId", "metric", "mode", "threshold", "metrics", "windowDays"]
      : ["rideId", "metric", "mode", "metrics", "windowDays"];
    if (
      !hasExactKeys(value.input, expectedKeys)
      || !validRideId(value.input.rideId)
      || !enumValue(value.input.metric, chatComparisonMetricKeys)
      || !enumValue(mode, chatFindRideModes)
      || !uniqueEnumValues(value.input.metrics, chatComparisonMetricKeys, chatComparisonMetricKeys.length)
      || !validFindRideWindowDays(value.input.windowDays)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    if (mode === "threshold") {
      if (!validThreshold(value.input.threshold)) throw new ChatToolError("INVALID_INPUT");
      return { tool: value.tool, input: { rideId: value.input.rideId, metric: value.input.metric, mode, threshold: value.input.threshold, metrics: value.input.metrics, windowDays: value.input.windowDays } };
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, metric: value.input.metric, mode, metrics: value.input.metrics, windowDays: value.input.windowDays } };
  }
  throw new ChatToolError("INVALID_INPUT");
}

async function withinToolTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ChatToolError("TIMEOUT")), CHAT_TOOL_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function enforceResultSize<T extends ChatToolResult>(result: T): T {
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > CHAT_TOOL_MAX_RESULT_BYTES) throw new ChatToolError("TEMPORARY_UNAVAILABLE");
  return result;
}

function publicClaim(claim: AnalysisContextClaim): ChatToolClaim {
  return {
    claimId: claim.claimId,
    kind: claim.kind,
    key: claim.key,
    confidence: claim.confidence,
    ...(claim.value !== undefined ? { value: claim.value } : {}),
    ...(claim.unit ? { unit: claim.unit } : {}),
    ...(claim.formulaVersion ? { formulaVersion: claim.formulaVersion } : {}),
    ...(claim.displayValue ? { displayValue: claim.displayValue } : {}),
    ...(claim.displayUnit ? { displayUnit: claim.displayUnit } : {}),
  };
}

// CHAT-13：比较指标的显示空间（单位换算 + 舍入口径）——模型引用与输出校验数字白名单
// 都基于这里的 displayValue/change/relativeChangePercent，避免原始浮点漂移进入回复。
const COMPARISON_METRIC_FORMAT: Record<ChatComparisonMetricKey, { unit: string; display: (value: number) => string; round: (value: number) => number }> = {
  distanceM: { unit: "km", display: (value) => (value / 1_000).toFixed(1), round: (value) => Math.round(value / 100) / 10 },
  avgSpeedMps: { unit: "km/h", display: (value) => (value * 3.6).toFixed(1), round: (value) => Math.round(value * 36) / 10 },
  avgPowerW: { unit: "W", display: (value) => String(Math.round(value)), round: Math.round },
  avgHeartRateBpm: { unit: "bpm", display: (value) => String(Math.round(value)), round: Math.round },
  avgCadenceRpm: { unit: "rpm", display: (value) => String(Math.round(value)), round: Math.round },
  elevationGainM: { unit: "m", display: (value) => String(Math.round(value)), round: Math.round },
};

// CHAT-17 P3：比较指标显示空间格式化（确定性降级话术用）——与 Claims displayValue 同口径，
// 编排层生成的服务端话术可用该值（服务端模板不经模型输出校验，但保持同一显示空间）。
export function formatChatMetricValue(metricKey: ChatComparisonMetricKey, value: number): string {
  return COMPARISON_METRIC_FORMAT[metricKey].display(value);
}

function comparisonClaim(metric: HistoricalMetricComparison, scope: "all" | "same_route"): CompareRidesClaim {
  const format = COMPARISON_METRIC_FORMAT[metric.metricKey as ChatComparisonMetricKey];
  const anchor = metric.anchor && format
    ? { value: metric.anchor.value, unit: format.unit, displayValue: format.display(metric.anchor.value) }
    : metric.anchor
      ? { value: metric.anchor.value, unit: metric.anchor.unit, displayValue: String(metric.anchor.value) }
      : undefined;
  const baseline = metric.baseline && format
    ? { value: metric.baseline.value, unit: format.unit, displayValue: format.display(metric.baseline.value), sampleCount: metric.baseline.sampleCount }
    : metric.baseline
      ? { value: metric.baseline.value, unit: metric.baseline.unit, displayValue: String(metric.baseline.value), sampleCount: metric.baseline.sampleCount }
      : undefined;
  // CHAT-13：change 为显示空间内的舍入值——round 的输入是原始单位差值（m、m/s、W…），
  // 由各指标的 round 口径换算舍入到显示空间（km、km/h、W…），避免显示值二次换算。
  const change = anchor && baseline
    ? format
      ? format.round(anchor.value - baseline.value)
      : Math.round((Number(anchor.displayValue) - Number(baseline.displayValue)) * 10) / 10
    : undefined;
  return {
    ...(metric.claimIds.length > 0 ? { claimId: metric.claimIds[0] } : {}),
    metricKey: metric.metricKey as ChatComparisonMetricKey,
    scope,
    status: metric.comparability.status,
    reasonCodes: [...metric.comparability.reasonCodes],
    ...(anchor ? { anchor } : {}),
    ...(baseline ? { baseline } : {}),
    ...(change !== undefined ? { change } : {}),
    ...(metric.relativeChange !== undefined && change !== undefined ? { relativeChangePercent: Math.round(metric.relativeChange * 1_000) / 10 } : {}),
  };
}

function projectComparisonSnapshot(snapshot: ReturnType<typeof buildHistoricalComparisonSnapshot>): CompareRidesToolResult {
  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "compare_rides",
    rideId: snapshot.anchorRideId,
    windowDays: snapshot.range.windowDays,
    ...(snapshot.range.endTime ? { anchorStartTime: snapshot.range.endTime } : {}),
    sampleCount: snapshot.sampleCount,
    comparability: {
      status: snapshot.comparability.status,
      reasonCodes: [...snapshot.comparability.reasonCodes],
      sampleCount: snapshot.comparability.sampleCount,
      minimumSampleCount: snapshot.comparability.minimumSampleCount,
      allowedConclusion: snapshot.comparability.allowedConclusion,
    },
    claims: [
      ...snapshot.metrics.map((metric) => comparisonClaim(metric, "all")),
      ...snapshot.sameRoute.metrics.map((metric) => comparisonClaim(metric, "same_route")),
    ],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

async function ownedRide(repository: ApplicationRepository, ownerId: string, rideId: string) {
  const record = await repository.getRide(ownerId, rideId);
  if (!record) throw new ChatToolError("NOT_FOUND");
  return record;
}

// CHAT-15：骑行日期标签——与 UI formatRideTitle 同口径（Asia/Shanghai 月/日）并补年份；
// 不提供出发时刻（UTC→本地换算易误导，且非必要），无有效开始时间时不生成。
function formatRideDateLabel(startTime: string | undefined): string | undefined {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return undefined;
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(startTime));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}年${month}月${day}日` : undefined;
}

// CHAT-17 P1：find_ride 指标取值——只接受 qualityStatus=valid 的有限值（低置信/降级
// 指标不参与筛选与排名，与比较工具的有效值口径一致）。
function findRideMetricValue(record: RideRecord, metricKey: ChatComparisonMetricKey): number | undefined {
  const metric = record.activity.metrics[metricKey];
  return metric && metric.qualityStatus === "valid" && Number.isFinite(metric.value) ? metric.value : undefined;
}

function parseStartTime(startTime: string | undefined): number | undefined {
  if (!startTime) return undefined;
  const parsed = Date.parse(startTime);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findRideClaim(rideId: string, metricKey: ChatComparisonMetricKey, value: number): FindRideClaim {
  const format = COMPARISON_METRIC_FORMAT[metricKey];
  return { claimId: `claim:find:${rideId}:${metricKey}`, metricKey, value, unit: format.unit, displayValue: format.display(value) };
}

// CHAT-17 P1：find_ride 执行——窗口以锚点出发时间为界（含锚点；与 compare_rides 的
// 锚点排除口径不同），owner 隔离由 listRides 保证。极值同值取最近一次（再按 rideId
// 稳定排序）；阈值模式严格大于、按出发时间倒序、返回条数设上限（matchedCount 为
// 命中总数）。筛选指标的有效值始终进入命中记录的 claims（枚举指标缺失时不生成）。
function buildFindRideResult(anchor: RideRecord, records: RideRecord[], input: FindRideInput): FindRideToolResult {
  const base: Omit<FindRideToolResult, "status" | "reasonCodes" | "candidateCount" | "matchedCount" | "matches"> = {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "find_ride",
    rideId: anchor.activity.rideId,
    windowDays: input.windowDays,
    metric: input.metric,
    mode: input.mode,
    ...(input.mode === "threshold" ? { threshold: input.threshold } : {}),
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
  const anchorTime = parseStartTime(anchor.activity.startTime);
  if (anchorTime === undefined) {
    return { ...base, status: "no_match", reasonCodes: ["ANCHOR_TIME_MISSING"], candidateCount: 0, matchedCount: 0, matches: [] };
  }
  const windowStart = anchorTime - input.windowDays * 86_400_000;
  const candidates = records
    .map((record) => ({ record, time: parseStartTime(record.activity.startTime) }))
    .filter((entry): entry is { record: RideRecord; time: number } => entry.time !== undefined && entry.time <= anchorTime && entry.time >= windowStart);
  const valued = candidates
    .map((entry) => ({ ...entry, value: findRideMetricValue(entry.record, input.metric) }))
    .filter((entry): entry is { record: RideRecord; time: number; value: number } => entry.value !== undefined);
  if (valued.length === 0) {
    return { ...base, status: "no_match", reasonCodes: ["METRIC_MISSING"], candidateCount: candidates.length, matchedCount: 0, matches: [] };
  }
  const reportMetrics = [...new Set([input.metric, ...input.metrics])];
  const toMatch = (entry: { record: RideRecord }): FindRideMatch => {
    const dateLabel = formatRideDateLabel(entry.record.activity.startTime);
    const claims = reportMetrics
      .map((metricKey) => {
        const value = findRideMetricValue(entry.record, metricKey);
        return value === undefined ? undefined : findRideClaim(entry.record.activity.rideId, metricKey, value);
      })
      .filter((claim): claim is FindRideClaim => claim !== undefined);
    return {
      rideId: entry.record.activity.rideId,
      ...(dateLabel ? { rideDateLabel: dateLabel } : {}),
      claims,
    };
  };
  if (input.mode === "threshold") {
    const matched = valued.filter((entry) => entry.value > input.threshold);
    if (matched.length === 0) {
      return { ...base, status: "no_match", reasonCodes: ["THRESHOLD_NO_MATCH"], candidateCount: candidates.length, matchedCount: 0, matches: [] };
    }
    matched.sort((a, b) => b.time - a.time || (a.record.activity.rideId < b.record.activity.rideId ? -1 : 1));
    return { ...base, status: "matched", reasonCodes: [], candidateCount: candidates.length, matchedCount: matched.length, matches: matched.slice(0, CHAT_FIND_RIDE_MAX_MATCHES).map(toMatch) };
  }
  const extreme = valued.reduce((best, entry) => {
    const better = input.mode === "max" ? entry.value > best.value : entry.value < best.value;
    const tieBreak = entry.value === best.value && (entry.time > best.time || (entry.time === best.time && entry.record.activity.rideId < best.record.activity.rideId));
    return better || tieBreak ? entry : best;
  });
  return { ...base, status: "matched", reasonCodes: [], candidateCount: candidates.length, matchedCount: 1, matches: [toMatch(extreme)] };
}

async function executeChatToolWithinBoundary(repository: ApplicationRepository, ownerId: string, invocation: ChatToolInvocation): Promise<ChatToolResult> {
  try {
    const record = await ownedRide(repository, ownerId, invocation.input.rideId);
    const profile = await repository.getProfile(ownerId);

    if (invocation.tool === "get_capabilities") {
      const capabilityProfile = buildAtomicCapabilityProfile(record, profile ?? undefined);
      const requested = new Set(invocation.input.caps);
      return enforceResultSize({
        schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
        tool: invocation.tool,
        rideId: record.activity.rideId,
        capabilities: invocation.input.caps
          .filter((key) => requested.has(key))
          .map((key) => getAtomicCapability(capabilityProfile, key))
          .map((capability) => ({
            key: capability.key,
            available: capability.available,
            sources: [...capability.sources],
            qualityStatus: capability.qualityStatus,
            dependencyKeys: [...capability.dependencyKeys],
            ...(capability.unavailableReason ? { unavailableReason: capability.unavailableReason } : {}),
          })),
      });
    }

    // CHAT-13：compare_rides——锚点（ownedRide 已校验归属）与本人全部持久记录的
    // 30 天窗口比较（listRides 按 owner 隔离）；不可比性由快照原因码承载，不在工具层拦截。
    if (invocation.tool === "compare_rides") {
      const history = buildHistoricalRides((await repository.listRides(ownerId)).map((entry) => entry.record));
      const snapshot = buildHistoricalComparisonSnapshot(buildHistoricalRide(record), history, {
        metricKeys: invocation.input.metrics,
        windowDays: invocation.input.windowDays,
      });
      return enforceResultSize(projectComparisonSnapshot(snapshot));
    }

    // CHAT-17 P1：find_ride——锚点（ownedRide 已校验归属）确定检索窗口；
    // listRides 按 owner 隔离；no_match 由结果状态承载（编排层零模型降级），不在工具层拦截。
    if (invocation.tool === "find_ride") {
      const records = (await repository.listRides(ownerId)).map((entry) => entry.record);
      return enforceResultSize(buildFindRideResult(record, records, invocation.input));
    }

    const context = buildRideAnalysisContext(record, { profile: profile ?? undefined, userScope: "chat-tool" });
    const metricKeys = new Set(invocation.input.dims.flatMap((dimension) => DIMENSION_METRICS[dimension]));
    const featureDimensions = new Set(invocation.input.dims.flatMap((dimension) => DIMENSION_FEATURES[dimension]));
    const capabilityKeys = new Set(invocation.input.dims.flatMap((dimension) => DIMENSION_CAPABILITIES[dimension]));
    const claims = context.allowedClaims.filter((claim) =>
      (claim.kind === "metric" && metricKeys.has(claim.key as MetricKey))
      || (claim.kind === "feature" && context.featureSnapshot.features.some((feature) => feature.claimId === claim.claimId && featureDimensions.has(feature.dimension))),
    );
    const limitations = context.capabilities
      .filter((capability) => capabilityKeys.has(capability.key) && !capability.available)
      .map((capability) => `${capability.key}:${capability.unavailableReason ?? "CAPABILITY_UNAVAILABLE"}`);

    return enforceResultSize({
      schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
      tool: invocation.tool,
      rideId: record.activity.rideId,
      ...(formatRideDateLabel(record.activity.startTime) ? { rideDateLabel: formatRideDateLabel(record.activity.startTime) } : {}),
      dimensions: [...invocation.input.dims],
      claims: claims.map(publicClaim),
      limitations: [...new Set(limitations)],
      privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
    });
  } catch (error) {
    if (error instanceof ChatToolError) throw error;
    throw new ChatToolError("TEMPORARY_UNAVAILABLE");
  }
}

export function executeChatTool(repository: ApplicationRepository, ownerId: string, invocation: ChatToolInvocation): Promise<ChatToolResult> {
  return withinToolTimeout(executeChatToolWithinBoundary(repository, ownerId, invocation));
}
