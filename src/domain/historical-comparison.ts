import { buildRideFeatureSnapshot, getRideFeature, type RideFeatureKey, type RideFeatureSnapshot } from "./ride-features.ts";
import { validateRideRecord } from "./ride-series.ts";
import type { MetricKey, RideRecord } from "./ride-schema.ts";

export const HISTORICAL_COMPARISON_SCHEMA_VERSION = "0.1" as const;
export const HISTORICAL_COMPARISON_RULES_VERSION = "historical-comparison-rules-v0.2" as const;
export const ROUTE_MATCH_RULES_VERSION = "route-match-key-v0.1" as const;
export const METRIC_COMPARABILITY_RULES_VERSION = "metric-comparability-v0.2" as const;
export const DEFAULT_COMPARISON_WINDOW_DAYS = 30 as const;
export const MIN_COMPARABLE_SAMPLES = 2 as const;

export type ComparisonMetricKey = MetricKey | RideFeatureKey;
export type RouteScope = "all" | "same_route";
export type MatchScope = "any" | "same";
export type ComparabilityStatus = "comparable" | "not_comparable";
export type ComparisonConclusion = "change" | "reference_change" | "none";

export type ComparisonReasonCode =
  | "ANCHOR_INVALID"
  | "ANCHOR_TIME_MISSING"
  | "WINDOW_EMPTY"
  | "NO_CANDIDATES"
  | "METRIC_MISSING"
  | "QUALITY_INSUFFICIENT"
  | "SAMPLE_COUNT_BELOW_MINIMUM"
  | "ROUTE_KEY_MISSING"
  | "ROUTE_NOT_MATCHED"
  | "SPORT_NOT_MATCHED"
  | "DEVICE_NOT_MATCHED"
  | "SCENE_NOT_MATCHED"
  | "SOURCE_SCOPE_REQUIRED"
  | "METHOD_SCOPE_REQUIRED"
  | "ROUTE_SCOPE_REQUIRED"
  | "DEVICE_SCOPE_REQUIRED"
  | "SCENE_SCOPE_REQUIRED"
  | "METRIC_POLICY_UNAVAILABLE"
  | "BASELINE_ZERO"
  | "UNSUPPORTED_METRIC";

export type MetricRouteSensitivity = "low" | "context" | "high";
export type MetricMatchScope = "any" | "same_source_class" | "same_method";

export interface MetricComparabilityPolicy {
  routeSensitivity: MetricRouteSensitivity;
  sourceScope: MetricMatchScope;
  methodScope: MetricMatchScope;
  sceneScope: MatchScope;
  crossRouteConclusion: ComparisonConclusion;
}

export interface HistoricalRideMetadata {
  historyId: string;
  routeKey?: string;
  deviceKey?: string;
  sceneKey?: string;
  metricSourceClass?: Partial<Record<ComparisonMetricKey, string>>;
  metricMethodKey?: Partial<Record<ComparisonMetricKey, string>>;
}

export interface HistoricalRide {
  metadata: HistoricalRideMetadata;
  record: RideRecord;
  featureSnapshot?: RideFeatureSnapshot;
}

export interface ComparisonScope {
  windowDays: number;
  routeScope: RouteScope;
  deviceScope: MatchScope;
  sceneScope: MatchScope;
}

export interface Comparability {
  status: ComparabilityStatus;
  reasonCodes: ComparisonReasonCode[];
  sampleCount: number;
  minimumSampleCount: number;
  allowedConclusion: ComparisonConclusion;
}

export interface ComparisonValue {
  value: number;
  unit: string;
  evidenceId: string;
  historyId?: string;
}

export interface HistoricalMetricComparison {
  metricKey: ComparisonMetricKey;
  anchor?: ComparisonValue;
  baseline?: ComparisonValue & { sampleCount: number; sourceHistoryIds: string[] };
  absoluteChange?: number;
  relativeChange?: number;
  comparability: Comparability;
  claimIds: string[];
  evidenceIds: string[];
}

export interface SameRouteComparison {
  routeMatchVersion: typeof ROUTE_MATCH_RULES_VERSION;
  routeKey?: string;
  comparability: Comparability;
  metrics: HistoricalMetricComparison[];
}

export interface HistoricalComparisonSnapshot {
  schemaVersion: typeof HISTORICAL_COMPARISON_SCHEMA_VERSION;
  comparisonVersion: typeof HISTORICAL_COMPARISON_RULES_VERSION;
  anchorRideId: string;
  range: {
    windowDays: number;
    startTime?: string;
    endTime?: string;
    timeZone: string;
    routeScope: RouteScope;
    deviceScope: MatchScope;
    sceneScope: MatchScope;
  };
  inclusionPolicy: "prior-same-sport-within-window-v0.1";
  metricPolicyVersion: typeof METRIC_COMPARABILITY_RULES_VERSION;
  candidateHistoryIds: string[];
  sampleCount: number;
  comparability: Comparability;
  metrics: HistoricalMetricComparison[];
  sameRoute: SameRouteComparison;
}

export interface HistoryQueryRequest {
  anchorRideId: string;
  metricKeys: ComparisonMetricKey[];
  windowDays?: number;
  routeScope?: RouteScope;
  deviceScope?: MatchScope;
  sceneScope?: MatchScope;
  timeZone?: string;
}

export interface HistoryQueryResult {
  snapshot: HistoricalComparisonSnapshot;
  error?: "ANCHOR_NOT_FOUND" | "HISTORY_EMPTY";
}

export interface HistoricalComparisonValidationResult {
  valid: boolean;
  issues: Array<{ code: string; message: string; metricKey?: ComparisonMetricKey }>;
}

const LOW_ROUTE_ANY_CONTEXT: MetricComparabilityPolicy = { routeSensitivity: "low", sourceScope: "any", methodScope: "any", sceneScope: "any", crossRouteConclusion: "change" };
const LOW_ROUTE_SAME_METHOD: MetricComparabilityPolicy = { routeSensitivity: "low", sourceScope: "any", methodScope: "same_method", sceneScope: "any", crossRouteConclusion: "reference_change" };
const CONTEXT_SAME_SOURCE_SCENE: MetricComparabilityPolicy = { routeSensitivity: "context", sourceScope: "same_source_class", methodScope: "any", sceneScope: "same", crossRouteConclusion: "reference_change" };
const HIGH_ROUTE_SAME_SOURCE_SCENE: MetricComparabilityPolicy = { routeSensitivity: "high", sourceScope: "same_source_class", methodScope: "any", sceneScope: "same", crossRouteConclusion: "none" };
const HIGH_ROUTE_SAME_SOURCE_ANY_SCENE: MetricComparabilityPolicy = { routeSensitivity: "high", sourceScope: "same_source_class", methodScope: "any", sceneScope: "any", crossRouteConclusion: "none" };

export const metricComparabilityMatrix: Readonly<Partial<Record<ComparisonMetricKey, MetricComparabilityPolicy>>> = {
  distanceM: LOW_ROUTE_ANY_CONTEXT,
  elapsedTimeS: LOW_ROUTE_ANY_CONTEXT,
  movingTimeS: LOW_ROUTE_ANY_CONTEXT,
  activityEnergyKcal: LOW_ROUTE_SAME_METHOD,
  avgSpeedMps: HIGH_ROUTE_SAME_SOURCE_SCENE,
  maxSpeedMps: HIGH_ROUTE_SAME_SOURCE_SCENE,
  elevationGainM: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  avgHeartRateBpm: CONTEXT_SAME_SOURCE_SCENE,
  maxHeartRateBpm: CONTEXT_SAME_SOURCE_SCENE,
  avgPowerW: CONTEXT_SAME_SOURCE_SCENE,
  maxPowerW: CONTEXT_SAME_SOURCE_SCENE,
  normalizedPowerW: CONTEXT_SAME_SOURCE_SCENE,
  avgCadenceRpm: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  maxCadenceRpm: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  speedSeriesMeanMps: HIGH_ROUTE_SAME_SOURCE_SCENE,
  speedStdDevMps: HIGH_ROUTE_SAME_SOURCE_SCENE,
  speedCoefficientOfVariation: HIGH_ROUTE_SAME_SOURCE_SCENE,
  speedFirstLastDeltaMps: HIGH_ROUTE_SAME_SOURCE_SCENE,
  heartRateSeriesMeanBpm: CONTEXT_SAME_SOURCE_SCENE,
  heartRateStdDevBpm: CONTEXT_SAME_SOURCE_SCENE,
  heartRateFirstLastDeltaBpm: CONTEXT_SAME_SOURCE_SCENE,
  powerSeriesMeanW: CONTEXT_SAME_SOURCE_SCENE,
  powerStdDevW: CONTEXT_SAME_SOURCE_SCENE,
  powerCoefficientOfVariation: CONTEXT_SAME_SOURCE_SCENE,
  powerFirstLastDeltaW: CONTEXT_SAME_SOURCE_SCENE,
  normalizedPowerRatio: CONTEXT_SAME_SOURCE_SCENE,
  cadenceSeriesMeanRpm: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  cadenceStdDevRpm: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  cadenceCoefficientOfVariation: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  cadenceFirstLastDeltaRpm: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  elevationMinM: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  elevationMaxM: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  elevationRangeM: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
  elevationPositiveGainM: HIGH_ROUTE_SAME_SOURCE_ANY_SCENE,
};

export interface HistoryQueryService {
  compare(request: HistoryQueryRequest): HistoryQueryResult;
}

interface ResolvedValue {
  value: number;
  unit: string;
  evidenceId: string;
}

function isFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function reasonCodes(...codes: Array<ComparisonReasonCode | undefined>): ComparisonReasonCode[] {
  return [...new Set(codes.filter((code): code is ComparisonReasonCode => Boolean(code)))];
}

function notComparable(reasons: ComparisonReasonCode[], sampleCount = 0): Comparability {
  return {
    status: "not_comparable",
    reasonCodes: reasonCodes(...reasons),
    sampleCount,
    minimumSampleCount: MIN_COMPARABLE_SAMPLES,
    allowedConclusion: "none",
  };
}

function comparable(sampleCount: number, allowedConclusion: ComparisonConclusion = "change"): Comparability {
  return {
    status: "comparable",
    reasonCodes: [],
    sampleCount,
    minimumSampleCount: MIN_COMPARABLE_SAMPLES,
    allowedConclusion,
  };
}

function aggregateComparability(metrics: HistoricalMetricComparison[], fallbackReasons: ComparisonReasonCode[], fallbackSampleCount: number): Comparability {
  const comparableMetrics = metrics.filter((metric) => metric.comparability.status === "comparable");
  if (comparableMetrics.length === 0) return notComparable(fallbackReasons, fallbackSampleCount);
  const allowedConclusion = comparableMetrics.some((metric) => metric.comparability.allowedConclusion === "change")
    ? "change"
    : "reference_change";
  return comparable(
    comparableMetrics.reduce((max, metric) => Math.max(max, metric.comparability.sampleCount), 0),
    allowedConclusion,
  );
}

function claimId(anchorRideId: string, metricKey: ComparisonMetricKey, scope: "all" | "same_route"): string {
  return `claim:${anchorRideId}:history:${scope}:${metricKey}`;
}

function historyEvidenceId(historyId: string, metricKey: ComparisonMetricKey): string {
  return `evidence:${historyId}:history:${metricKey}`;
}

function metricSourceClass(ride: HistoricalRide, metricKey: ComparisonMetricKey): string | undefined {
  return ride.metadata.metricSourceClass?.[metricKey]
    ?? ride.metadata.deviceKey
    ?? (ride.record.activity.source.deviceManufacturer && ride.record.activity.source.deviceProduct
      ? `${ride.record.activity.source.deviceManufacturer}:${ride.record.activity.source.deviceProduct}`
      : undefined);
}

function metricMethodKey(ride: HistoricalRide, metricKey: ComparisonMetricKey): string | undefined {
  const explicit = ride.metadata.metricMethodKey?.[metricKey];
  if (explicit) return explicit;
  const metric = ride.record.activity.metrics[metricKey as MetricKey];
  if (!metric) return undefined;
  if (metric.provenance === "recorded") return "recorded-device-value";
  return metric.formulaVersion ? `${metric.provenance}:${metric.formulaVersion}` : `${metric.provenance}:unknown`;
}

function getValue(ride: HistoricalRide, metricKey: ComparisonMetricKey): ResolvedValue | undefined {
  const metric = ride.record.activity.metrics[metricKey as MetricKey];
  if (metric && metric.qualityStatus === "valid" && isFinite(metric.value)) {
    return { value: metric.value, unit: metric.unit, evidenceId: metric.evidenceId };
  }
  const featureSnapshot = ride.featureSnapshot ?? buildRideFeatureSnapshot(ride.record);
  const feature = getRideFeature(featureSnapshot, metricKey as RideFeatureKey);
  if (feature && isFinite(feature.value)) return { value: feature.value, unit: feature.unit, evidenceId: feature.claimId };
  return undefined;
}

function startTime(ride: HistoricalRide): number | undefined {
  const value = ride.record.activity.startTime;
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sameContext(anchor: HistoricalRide, candidate: HistoricalRide, scope: Pick<ComparisonScope, "deviceScope" | "sceneScope">): ComparisonReasonCode | undefined {
  if (anchor.record.activity.sport !== candidate.record.activity.sport) return "SPORT_NOT_MATCHED";
  if (scope.deviceScope === "same" && anchor.metadata.deviceKey !== candidate.metadata.deviceKey) return "DEVICE_NOT_MATCHED";
  if (scope.sceneScope === "same" && anchor.metadata.sceneKey !== candidate.metadata.sceneKey) return "SCENE_NOT_MATCHED";
  return undefined;
}

function buildMetricComparison(anchor: HistoricalRide, candidates: HistoricalRide[], metricKey: ComparisonMetricKey, scope: "all" | "same_route", noCandidateReason: ComparisonReasonCode = "METRIC_MISSING"): HistoricalMetricComparison {
  const policy = metricComparabilityMatrix[metricKey];
  if (!policy) {
    return { metricKey, comparability: notComparable(["METRIC_POLICY_UNAVAILABLE"]), claimIds: [], evidenceIds: [] };
  }
  const anchorValue = getValue(anchor, metricKey);
  const anchorResolved: ComparisonValue | undefined = anchorValue
    ? { ...anchorValue, historyId: anchor.metadata.historyId }
    : undefined;
  if (scope === "all" && policy.routeSensitivity === "high") {
    return {
      metricKey,
      anchor: anchorValue ? { ...anchorValue, historyId: anchor.metadata.historyId } : undefined,
      comparability: notComparable(["ROUTE_SCOPE_REQUIRED"]),
      claimIds: [],
      evidenceIds: anchorValue ? [anchorValue.evidenceId] : [],
    };
  }
  const contextCandidates = candidates.filter((candidate) => {
    if (policy.sourceScope === "same_source_class" && (!metricSourceClass(anchor, metricKey) || metricSourceClass(candidate, metricKey) !== metricSourceClass(anchor, metricKey))) return false;
    if (policy.methodScope === "same_method" && (!metricMethodKey(anchor, metricKey) || metricMethodKey(candidate, metricKey) !== metricMethodKey(anchor, metricKey))) return false;
    if (policy.sceneScope === "same" && (!anchor.metadata.sceneKey || candidate.metadata.sceneKey !== anchor.metadata.sceneKey)) return false;
    return true;
  });
  const validCandidates = contextCandidates
    .map((candidate) => ({ candidate, value: getValue(candidate, metricKey) }))
    .filter((item): item is { candidate: HistoricalRide; value: ResolvedValue } => Boolean(item.value));
  const evidenceIds = [
    ...(anchorValue ? [anchorValue.evidenceId] : []),
    ...validCandidates.map((item) => item.value.evidenceId),
  ];
  const claimIds = validCandidates.length >= MIN_COMPARABLE_SAMPLES && anchorValue
    ? [claimId(anchor.record.activity.rideId, metricKey, scope)]
    : [];
  if (!anchorValue) {
    return { metricKey, comparability: notComparable(["METRIC_MISSING"]), claimIds, evidenceIds };
  }
  if (validCandidates.length < MIN_COMPARABLE_SAMPLES) {
    const contextReason = contextCandidates.length === 0 && candidates.length > 0
      ? policy.sourceScope === "same_source_class" && (!metricSourceClass(anchor, metricKey) || candidates.some((candidate) => metricSourceClass(candidate, metricKey) !== metricSourceClass(anchor, metricKey)))
        ? "SOURCE_SCOPE_REQUIRED"
        : policy.methodScope === "same_method" && (!metricMethodKey(anchor, metricKey) || candidates.some((candidate) => metricMethodKey(candidate, metricKey) !== metricMethodKey(anchor, metricKey)))
          ? "METHOD_SCOPE_REQUIRED"
          : policy.sceneScope === "same" && (!anchor.metadata.sceneKey || candidates.some((candidate) => candidate.metadata.sceneKey !== anchor.metadata.sceneKey))
            ? "SCENE_SCOPE_REQUIRED"
            : noCandidateReason
      : undefined;
    return {
      metricKey,
      anchor: anchorResolved,
      comparability: notComparable(validCandidates.length === 0 ? [contextReason ?? noCandidateReason] : ["SAMPLE_COUNT_BELOW_MINIMUM"], validCandidates.length),
      claimIds,
      evidenceIds,
    };
  }
  const baseline = validCandidates.reduce((sum, item) => sum + item.value.value, 0) / validCandidates.length;
  const unit = anchorValue.unit;
  const absoluteChange = anchorValue.value - baseline;
  const relativeChange = baseline === 0 ? undefined : absoluteChange / Math.abs(baseline);
  const baselineValue: ComparisonValue & { sampleCount: number; sourceHistoryIds: string[] } = {
    value: baseline,
    unit,
    evidenceId: historyEvidenceId(anchor.record.activity.rideId, metricKey),
    sampleCount: validCandidates.length,
    sourceHistoryIds: validCandidates.map((item) => item.candidate.metadata.historyId),
  };
  return {
    metricKey,
    anchor: anchorResolved,
    baseline: baselineValue,
    absoluteChange,
    ...(relativeChange !== undefined ? { relativeChange } : {}),
    comparability: relativeChange === undefined ? notComparable(["BASELINE_ZERO"], validCandidates.length) : comparable(validCandidates.length, scope === "all" ? policy.crossRouteConclusion : "change"),
    claimIds: relativeChange === undefined ? [] : claimIds,
    evidenceIds: [...evidenceIds, baselineValue.evidenceId],
  };
}

function buildSnapshot(anchor: HistoricalRide, history: HistoricalRide[], request: Required<Pick<HistoryQueryRequest, "anchorRideId" | "metricKeys">> & Omit<HistoryQueryRequest, "anchorRideId" | "metricKeys">, anchorReason?: ComparisonReasonCode): HistoricalComparisonSnapshot {
  const end = startTime(anchor);
  const windowDays = Math.min(365, Math.max(1, Math.floor(request.windowDays ?? DEFAULT_COMPARISON_WINDOW_DAYS)));
  const start = end === undefined ? undefined : end - windowDays * 86_400_000;
  const routeScope = request.routeScope ?? "all";
  const deviceScope = request.deviceScope ?? "any";
  const sceneScope = request.sceneScope ?? "any";
  const baseRange = {
    windowDays,
    ...(start !== undefined ? { startTime: new Date(start).toISOString() } : {}),
    ...(end !== undefined ? { endTime: new Date(end).toISOString() } : {}),
    timeZone: request.timeZone ?? "UTC",
    routeScope,
    deviceScope,
    sceneScope,
  };
  if (!end || anchorReason) {
    const comparability = notComparable([anchorReason ?? "ANCHOR_TIME_MISSING"]);
    const metrics = request.metricKeys.map((metricKey) => ({ metricKey, comparability, claimIds: [], evidenceIds: [] }));
    return {
      schemaVersion: HISTORICAL_COMPARISON_SCHEMA_VERSION,
      comparisonVersion: HISTORICAL_COMPARISON_RULES_VERSION,
      anchorRideId: anchor.record.activity.rideId,
      range: baseRange,
      inclusionPolicy: "prior-same-sport-within-window-v0.1",
      metricPolicyVersion: METRIC_COMPARABILITY_RULES_VERSION,
      candidateHistoryIds: [],
      sampleCount: 0,
      comparability,
      metrics,
      sameRoute: { routeMatchVersion: ROUTE_MATCH_RULES_VERSION, routeKey: anchor.metadata.routeKey, comparability, metrics: request.metricKeys.map((metricKey) => ({ metricKey, comparability, claimIds: [], evidenceIds: [] })) },
    };
  }
  const windowStart = start as number;
  const candidates = history.filter((item) => {
    if (item.metadata.historyId === anchor.metadata.historyId || item.record.activity.rideId === anchor.record.activity.rideId) return false;
    const candidateTime = startTime(item);
    if (candidateTime === undefined || candidateTime >= end || candidateTime < windowStart) return false;
    if (sameContext(anchor, item, { deviceScope, sceneScope })) return false;
    if (routeScope === "same_route" && (!anchor.metadata.routeKey || item.metadata.routeKey !== anchor.metadata.routeKey)) return false;
    return true;
  });
  const metrics = request.metricKeys.map((metricKey) => buildMetricComparison(anchor, candidates, metricKey, routeScope, routeScope === "same_route" ? "ROUTE_NOT_MATCHED" : "METRIC_MISSING"));
  const overall = aggregateComparability(metrics, candidates.length === 0 ? ["NO_CANDIDATES"] : ["SAMPLE_COUNT_BELOW_MINIMUM"], candidates.length);

  const sameRouteCandidates = anchor.metadata.routeKey
    ? candidates.filter((item) => item.metadata.routeKey === anchor.metadata.routeKey)
    : [];
  const sameRouteMetrics = request.metricKeys.map((metricKey) => buildMetricComparison(anchor, sameRouteCandidates, metricKey, "same_route", "ROUTE_NOT_MATCHED"));
  const sameRouteComparability = !anchor.metadata.routeKey
    ? notComparable(["ROUTE_KEY_MISSING"])
    : aggregateComparability(sameRouteMetrics, sameRouteCandidates.length === 0 ? ["ROUTE_NOT_MATCHED"] : ["SAMPLE_COUNT_BELOW_MINIMUM"], sameRouteCandidates.length);

  return {
    schemaVersion: HISTORICAL_COMPARISON_SCHEMA_VERSION,
    comparisonVersion: HISTORICAL_COMPARISON_RULES_VERSION,
    anchorRideId: anchor.record.activity.rideId,
    range: baseRange,
    inclusionPolicy: "prior-same-sport-within-window-v0.1",
    metricPolicyVersion: METRIC_COMPARABILITY_RULES_VERSION,
    candidateHistoryIds: candidates.map((item) => item.metadata.historyId),
    sampleCount: candidates.length,
    comparability: overall,
    metrics,
    sameRoute: { routeMatchVersion: ROUTE_MATCH_RULES_VERSION, ...(anchor.metadata.routeKey ? { routeKey: anchor.metadata.routeKey } : {}), comparability: sameRouteComparability, metrics: sameRouteMetrics },
  };
}

export function buildHistoricalComparisonSnapshot(anchor: HistoricalRide, history: HistoricalRide[], request: Partial<Omit<HistoryQueryRequest, "anchorRideId">> = {}): HistoricalComparisonSnapshot {
  const validation = validateRideRecord(anchor.record);
  if (!validation.valid) {
    return buildSnapshot(anchor, [], { ...request, anchorRideId: anchor.metadata.historyId, metricKeys: request.metricKeys ?? [] }, "ANCHOR_INVALID");
  }
  return buildSnapshot(anchor, history, { ...request, anchorRideId: anchor.metadata.historyId, metricKeys: request.metricKeys ?? ["avgSpeedMps"] });
}

export class FixtureHistoryQueryService implements HistoryQueryService {
  private readonly rides: HistoricalRide[];

  constructor(rides: HistoricalRide[]) {
    this.rides = rides;
  }

  compare(request: HistoryQueryRequest): HistoryQueryResult {
    const anchor = this.rides.find((ride) => ride.metadata.historyId === request.anchorRideId || ride.record.activity.rideId === request.anchorRideId);
    if (!anchor) {
      const fallback: HistoricalRide = {
        metadata: { historyId: request.anchorRideId },
        record: {
          activity: {
            schemaVersion: "0.2",
            rideId: request.anchorRideId,
            sport: "cycling",
            source: { kind: "sample", parserVersion: "history-missing" },
            metrics: {},
            sensorQuality: {},
            sourceIssues: [{ code: "ANCHOR_NOT_FOUND", severity: "error", message: "历史锚点不存在" }],
          },
          series: {
            schemaVersion: "0.1",
            rideId: request.anchorRideId,
            source: { kind: "sample", parserVersion: "history-missing" },
            coordinateSpace: "relative_normalized",
            privacy: { ruleVersion: "relative-route-v0.1", preciseCoordinatesExcluded: true },
            availableSeries: [],
            seriesMetadata: {},
            timeBasis: { kind: "none" },
            points: [],
          },
        },
      };
      return { snapshot: buildHistoricalComparisonSnapshot(fallback, [], request), error: "ANCHOR_NOT_FOUND" };
    }
    return { snapshot: buildHistoricalComparisonSnapshot(anchor, this.rides, request), ...(this.rides.length <= 1 ? { error: "HISTORY_EMPTY" as const } : {}) };
  }
}

export function validateHistoricalComparisonSnapshot(snapshot: HistoricalComparisonSnapshot): HistoricalComparisonValidationResult {
  const issues: HistoricalComparisonValidationResult["issues"] = [];
  if (snapshot.schemaVersion !== HISTORICAL_COMPARISON_SCHEMA_VERSION) issues.push({ code: "UNSUPPORTED_HISTORY_SCHEMA_VERSION", message: "不支持的历史快照Schema版本" });
  if (snapshot.comparisonVersion !== HISTORICAL_COMPARISON_RULES_VERSION) issues.push({ code: "UNSUPPORTED_HISTORY_RULES_VERSION", message: "不支持的历史比较规则版本" });
  if (snapshot.inclusionPolicy !== "prior-same-sport-within-window-v0.1") issues.push({ code: "UNSUPPORTED_INCLUSION_POLICY", message: "不支持的历史纳入口径" });
  if (snapshot.metricPolicyVersion !== METRIC_COMPARABILITY_RULES_VERSION) issues.push({ code: "UNSUPPORTED_METRIC_POLICY_VERSION", message: "不支持的指标可比性规则版本" });
  if (snapshot.sameRoute.routeMatchVersion !== ROUTE_MATCH_RULES_VERSION) issues.push({ code: "UNSUPPORTED_ROUTE_MATCH_VERSION", message: "不支持的同路线判定版本" });
  if (!snapshot.anchorRideId.trim()) issues.push({ code: "MISSING_ANCHOR_RIDE_ID", message: "历史快照缺少锚点骑行ID" });
  if (!Number.isInteger(snapshot.range.windowDays) || snapshot.range.windowDays < 1 || snapshot.range.windowDays > 365) issues.push({ code: "INVALID_WINDOW", message: "历史窗口必须是1到365天的整数" });
  if (snapshot.sampleCount !== snapshot.candidateHistoryIds.length) issues.push({ code: "SAMPLE_COUNT_MISMATCH", message: "样本量与候选记录数不一致" });
  const seen = new Set<ComparisonMetricKey>();
  for (const metric of [...snapshot.metrics, ...snapshot.sameRoute.metrics]) {
    if (seen.has(metric.metricKey) && snapshot.metrics.includes(metric)) issues.push({ code: "DUPLICATE_METRIC", message: `历史指标重复：${metric.metricKey}`, metricKey: metric.metricKey });
    if (snapshot.metrics.includes(metric)) seen.add(metric.metricKey);
    if (metric.absoluteChange !== undefined && !Number.isFinite(metric.absoluteChange)) issues.push({ code: "INVALID_ABSOLUTE_CHANGE", message: `绝对变化不是有限值：${metric.metricKey}`, metricKey: metric.metricKey });
    if (metric.relativeChange !== undefined && !Number.isFinite(metric.relativeChange)) issues.push({ code: "INVALID_RELATIVE_CHANGE", message: `相对变化不是有限值：${metric.metricKey}`, metricKey: metric.metricKey });
    if (metric.comparability.status === "comparable") {
      if (!metric.anchor || !metric.baseline || !["change", "reference_change"].includes(metric.comparability.allowedConclusion)) issues.push({ code: "COMPARABLE_MISSING_VALUES", message: `可比指标缺少锚点或基线：${metric.metricKey}`, metricKey: metric.metricKey });
      if (metric.claimIds.length === 0) issues.push({ code: "COMPARABLE_MISSING_CLAIM", message: `可比指标缺少claim：${metric.metricKey}`, metricKey: metric.metricKey });
    } else if (metric.claimIds.length > 0) {
      issues.push({ code: "INCOMPARABLE_HAS_CLAIM", message: `不可比指标不应有趋势claim：${metric.metricKey}`, metricKey: metric.metricKey });
    }
  }
  return { valid: issues.length === 0, issues };
}
