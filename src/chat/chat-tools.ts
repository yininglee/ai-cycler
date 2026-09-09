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
import type { MetricKey } from "../domain/ride-schema.ts";
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

export type ChatToolName = "get_ride_context" | "get_capabilities" | "compare_rides";
export type ChatToolErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "TIMEOUT" | "TEMPORARY_UNAVAILABLE";

type RideContextInput = { rideId: string; dims: RideContextDimension[] };
type CapabilitiesInput = { rideId: string; caps: AtomicCapabilityKey[] };
type CompareRidesInput = { rideId: string; metrics: ChatComparisonMetricKey[]; windowDays: number };
export type ChatToolInvocation =
  | { tool: "get_ride_context"; input: RideContextInput }
  | { tool: "get_capabilities"; input: CapabilitiesInput }
  | { tool: "compare_rides"; input: CompareRidesInput };

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

export type ChatToolResult = RideContextToolResult | CapabilitiesToolResult | CompareRidesToolResult;

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
