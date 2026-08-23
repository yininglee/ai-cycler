import {
  atomicCapabilityKeys,
  buildAtomicCapabilityProfile,
  type AtomicCapability,
  type AtomicCapabilityProfile,
} from "./atomic-capabilities.ts";
import {
  validateHistoricalComparisonSnapshot,
  type HistoricalComparisonSnapshot,
} from "./historical-comparison.ts";
import {
  buildRideFeatureSnapshot,
  validateRideFeatureSnapshot,
  type RideFeature,
  type RideFeatureSnapshot,
} from "./ride-features.ts";
import type {
  Confidence,
  Metric,
  MetricKey,
  MetricProvenance,
  RideRecord,
} from "./ride-schema.ts";
import type { UserProfile } from "./user-profile.ts";

export const RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION = "0.2" as const;
export const RIDE_ANALYSIS_CONTEXT_RULES_VERSION = "ride-analysis-context-rules-v0.2" as const;

export type ContextMetricBucket = "recorded" | "derived" | "estimated";
export type ContextClaimKind = "metric" | "feature" | "history";
export type ProfileContextKey = "age" | "heightCm" | "weightKg" | "maxHeartRate" | "ftp";

export interface AnalysisContextMetric {
  value: number;
  unit: Metric["unit"];
  provenance: MetricProvenance;
  confidence: Confidence;
  evidenceId: string;
  sourceField: string;
  sourceUnit: string;
  qualityStatus: Metric["qualityStatus"];
  recordedAt?: string;
  formulaVersion?: string;
  displayValue?: string;
  displayUnit?: string;
  displayFormulaVersion?: string;
}

export interface AnalysisContextProfileFact {
  value: number;
  unit: "years" | "cm" | "kg" | "bpm" | "W";
  source: "user_provided" | "system_estimated";
  updatedAt: string;
  formulaVersion?: string;
  trustStatus?: "user_confirmed";
}

export interface AnalysisContextClaim {
  claimId: string;
  kind: ContextClaimKind;
  key: string;
  value?: number;
  unit?: string;
  text?: string;
  provenance?: MetricProvenance;
  confidence: Confidence;
  evidenceIds: string[];
  formulaVersion?: string;
  displayValue?: string;
  displayUnit?: string;
  displayFormulaVersion?: string;
}

export interface RideAnalysisContext {
  schemaVersion: typeof RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_ANALYSIS_CONTEXT_RULES_VERSION;
  contextType: "ride_analysis";
  rideId: string;
  userScope: string;
  capabilities: AtomicCapability[];
  recordedMetrics: Partial<Record<MetricKey, AnalysisContextMetric>>;
  derivedMetrics: Partial<Record<MetricKey, AnalysisContextMetric>>;
  estimatedMetrics: Partial<Record<MetricKey, AnalysisContextMetric>>;
  featureSnapshot: RideFeatureSnapshot;
  historicalComparison?: HistoricalComparisonSnapshot;
  profileFacts: Partial<Record<ProfileContextKey, AnalysisContextProfileFact>>;
  allowedClaims: AnalysisContextClaim[];
  forbiddenClaims: string[];
  limitations: string[];
  safetyFlags: string[];
  privacyFlags: string[];
}

export interface BuildRideAnalysisContextOptions {
  userScope?: string;
  featureSnapshot?: RideFeatureSnapshot;
  historicalComparison?: HistoricalComparisonSnapshot;
  profile?: UserProfile;
  profileFieldKeys?: ProfileContextKey[];
  safetyFlags?: string[];
}

export interface RideAnalysisContextValidationResult {
  valid: boolean;
  issues: Array<{ code: string; message: string; claimId?: string; key?: string }>;
}

const PRIVACY_FLAGS = [
  "raw_track_excluded",
  "precise_coordinates_excluded",
  "source_filename_excluded",
  "untrusted_free_text_excluded",
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function copyMetric(metricKey: MetricKey, metric: Metric): AnalysisContextMetric {
  return {
    value: metric.value,
    unit: metric.unit,
    provenance: metric.provenance,
    confidence: metric.confidence,
    evidenceId: metric.evidenceId,
    sourceField: metric.sourceField,
    sourceUnit: metric.sourceUnit,
    qualityStatus: metric.qualityStatus,
    ...(metric.recordedAt ? { recordedAt: metric.recordedAt } : {}),
    ...(metric.formulaVersion ? { formulaVersion: metric.formulaVersion } : {}),
    ...displayFields(metricKey, metric),
  };
}

function compactNumber(value: number, fractionDigits = 1): string {
  return Number(value.toFixed(fractionDigits)).toString();
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function displayFields(metricKey: MetricKey, metric: Metric): Pick<AnalysisContextMetric, "displayValue" | "displayUnit" | "displayFormulaVersion"> {
  let displayValue: string;
  let displayUnit: string;
  switch (metricKey) {
    case "distanceM": displayValue = compactNumber(metric.value / 1_000); displayUnit = "km"; break;
    case "elapsedTimeS":
    case "movingTimeS": displayValue = formatDuration(metric.value); displayUnit = "duration"; break;
    case "avgSpeedMps":
    case "maxSpeedMps": displayValue = compactNumber(metric.value * 3.6); displayUnit = "km/h"; break;
    case "elevationGainM": displayValue = compactNumber(metric.value, 0); displayUnit = "m"; break;
    case "avgHeartRateBpm":
    case "maxHeartRateBpm": displayValue = compactNumber(metric.value, 0); displayUnit = "bpm"; break;
    case "avgPowerW":
    case "maxPowerW":
    case "normalizedPowerW": displayValue = compactNumber(metric.value, 0); displayUnit = "W"; break;
    case "avgCadenceRpm":
    case "maxCadenceRpm": displayValue = compactNumber(metric.value, 0); displayUnit = "rpm"; break;
    case "activityEnergyKcal": displayValue = compactNumber(metric.value, 0); displayUnit = "kcal"; break;
  }
  return { displayValue, displayUnit, displayFormulaVersion: "metric-display-v0.1" };
}

function metricClaim(rideId: string, metricKey: MetricKey, metric: Metric): AnalysisContextClaim {
  const display = displayFields(metricKey, metric);
  return {
    claimId: `claim:${rideId}:${metricKey}`,
    kind: "metric",
    key: metricKey,
    value: metric.value,
    unit: metric.unit,
    provenance: metric.provenance,
    confidence: metric.confidence,
    evidenceIds: [metric.evidenceId],
    ...(metric.formulaVersion ? { formulaVersion: metric.formulaVersion } : {}),
    ...display,
  };
}

function featureDisplayFields(feature: RideFeature): Pick<AnalysisContextClaim, "displayValue" | "displayUnit" | "displayFormulaVersion"> {
  if (feature.unit === "m/s") {
    return {
      displayValue: compactNumber(feature.value * 3.6, 2),
      displayUnit: "km/h",
      displayFormulaVersion: "metric-display-v0.1",
    };
  }
  if (feature.unit === "ratio") {
    return {
      displayValue: compactNumber(feature.value, 2),
      displayUnit: "ratio",
      displayFormulaVersion: "metric-display-v0.1",
    };
  }
  return {
    displayValue: compactNumber(feature.value, feature.unit === "m" ? 1 : 2),
    displayUnit: feature.unit,
    displayFormulaVersion: "metric-display-v0.1",
  };
}

function featureClaims(snapshot: RideFeatureSnapshot): AnalysisContextClaim[] {
  return snapshot.features.map((feature) => ({
    claimId: feature.claimId,
    kind: "feature" as const,
    key: feature.key,
    value: feature.value,
    unit: feature.unit,
    confidence: feature.confidence,
    evidenceIds: [...feature.evidenceIds],
    formulaVersion: feature.formulaVersion,
    ...featureDisplayFields(feature),
  }));
}

function historyClaims(snapshot: HistoricalComparisonSnapshot): AnalysisContextClaim[] {
  const claims: AnalysisContextClaim[] = [];
  for (const metric of [...snapshot.metrics, ...snapshot.sameRoute.metrics]) {
    if (metric.comparability.status !== "comparable" || !metric.baseline || !metric.anchor) continue;
    for (const claimId of metric.claimIds) {
      claims.push({
        claimId,
        kind: "history",
        key: metric.metricKey,
        value: metric.absoluteChange,
        unit: metric.anchor.unit,
        confidence: "high",
        evidenceIds: [...metric.evidenceIds],
      });
    }
  }
  return claims;
}

function profileFacts(profile: UserProfile | undefined, requested: ProfileContextKey[]): Partial<Record<ProfileContextKey, AnalysisContextProfileFact>> {
  if (!profile || requested.length === 0) return {};
  const selected: Partial<Record<ProfileContextKey, AnalysisContextProfileFact>> = {};
  const has = (key: ProfileContextKey): boolean => requested.includes(key);
  if (has("age") && profile.age) selected.age = { value: profile.age.value, unit: "years", source: profile.age.source, updatedAt: profile.age.updatedAt };
  if (has("heightCm") && profile.heightCm) selected.heightCm = { value: profile.heightCm.value, unit: "cm", source: profile.heightCm.source, updatedAt: profile.heightCm.updatedAt };
  if (has("weightKg") && profile.weightKg) selected.weightKg = { value: profile.weightKg.value, unit: "kg", source: profile.weightKg.source, updatedAt: profile.weightKg.updatedAt };
  if (has("maxHeartRate") && profile.maxHeartRate) {
    selected.maxHeartRate = {
      value: profile.maxHeartRate.valueBpm,
      unit: "bpm",
      source: profile.maxHeartRate.source,
      updatedAt: profile.maxHeartRate.updatedAt,
      ...(profile.maxHeartRate.formulaVersion ? { formulaVersion: profile.maxHeartRate.formulaVersion } : {}),
    };
  }
  if (has("ftp") && profile.ftp) {
    selected.ftp = {
      value: profile.ftp.valueWatts,
      unit: "W",
      source: profile.ftp.source,
      updatedAt: profile.ftp.updatedAt,
      trustStatus: profile.ftp.trustStatus,
    };
  }
  return selected;
}

function withHistoryCapabilities(profile: AtomicCapabilityProfile, history: HistoricalComparisonSnapshot | undefined): AtomicCapability[] {
  if (!history) return profile.capabilities;
  const historyEvidence = unique(history.metrics.flatMap((metric) => metric.evidenceIds));
  const historyAvailable = history.metrics.some((metric) => metric.comparability.status === "comparable");
  const sameRouteAvailable = history.sameRoute.metrics.some((metric) => metric.comparability.status === "comparable");
  return profile.capabilities.map((capability) => {
    if (capability.key === "historyComparison") {
      return historyAvailable
        ? { ...capability, available: true, sources: ["history_snapshot"], qualityStatus: "valid", evidenceIds: historyEvidence, unavailableReason: undefined }
        : { ...capability, dependencyKeys: ["historyComparison"], unavailableReason: "DEPENDENCY_UNAVAILABLE" };
    }
    if (capability.key === "sameRouteComparison") {
      return sameRouteAvailable
        ? { ...capability, available: true, sources: ["history_snapshot"], qualityStatus: "valid", evidenceIds: unique(history.sameRoute.metrics.flatMap((metric) => metric.evidenceIds)), unavailableReason: undefined }
        : { ...capability, dependencyKeys: ["historyComparison", "route"], unavailableReason: "DEPENDENCY_UNAVAILABLE" };
    }
    if (capability.key === "trend") {
      return { ...capability, unavailableReason: "RULE_NOT_IMPLEMENTED" };
    }
    return capability;
  });
}

function unavailableClaims(capabilities: AtomicCapability[]): string[] {
  return capabilities.filter((capability) => !capability.available).map((capability) => capability.key);
}

export function buildRideAnalysisContext(record: RideRecord, options: BuildRideAnalysisContextOptions = {}): RideAnalysisContext {
  const userScope = options.userScope ?? "local-demo";
  if (!userScope.trim()) throw new Error("userScope must not be empty");
  const featureSnapshot = options.featureSnapshot ?? buildRideFeatureSnapshot(record, options.profile);
  const featureValidation = validateRideFeatureSnapshot(featureSnapshot);
  if (!featureValidation.valid || featureSnapshot.rideId !== record.activity.rideId) throw new Error("featureSnapshot does not match the ride or violates its contract");
  if (options.historicalComparison) {
    const historyValidation = validateHistoricalComparisonSnapshot(options.historicalComparison);
    if (!historyValidation.valid || options.historicalComparison.anchorRideId !== record.activity.rideId) throw new Error("historicalComparison does not match the ride or violates its contract");
  }

  const atomic = buildAtomicCapabilityProfile(record, options.profile);
  const capabilities = withHistoryCapabilities(atomic, options.historicalComparison);
  const recordedMetrics: RideAnalysisContext["recordedMetrics"] = {};
  const derivedMetrics: RideAnalysisContext["derivedMetrics"] = {};
  const estimatedMetrics: RideAnalysisContext["estimatedMetrics"] = {};
  const claims: AnalysisContextClaim[] = [];

  for (const [metricKey, metric] of Object.entries(record.activity.metrics) as [MetricKey, Metric][]) {
    if (!metric || metric.qualityStatus !== "valid" || !finite(metric.value)) continue;
    const bucket = metric.provenance === "recorded" ? recordedMetrics : metric.provenance === "calculated" ? derivedMetrics : estimatedMetrics;
    bucket[metricKey] = copyMetric(metricKey, metric);
    claims.push(metricClaim(record.activity.rideId, metricKey, metric));
  }
  claims.push(...featureClaims(featureSnapshot), ...(options.historicalComparison ? historyClaims(options.historicalComparison) : []));
  const dedupedClaims = [...new Map(claims.map((claim) => [claim.claimId, claim])).values()];
  const limitations = unique([
    ...featureSnapshot.unavailable.map((item) => `${item.key}:${item.reason}`),
    ...capabilities.filter((capability) => !capability.available && capability.unavailableReason).map((capability) => `${capability.key}:${capability.unavailableReason}`),
  ]);

  return {
    schemaVersion: RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
    rulesVersion: RIDE_ANALYSIS_CONTEXT_RULES_VERSION,
    contextType: "ride_analysis",
    rideId: record.activity.rideId,
    userScope,
    capabilities,
    recordedMetrics,
    derivedMetrics,
    estimatedMetrics,
    featureSnapshot,
    ...(options.historicalComparison ? { historicalComparison: options.historicalComparison } : {}),
    profileFacts: profileFacts(options.profile, options.profileFieldKeys ?? []),
    allowedClaims: dedupedClaims,
    forbiddenClaims: unavailableClaims(capabilities),
    limitations,
    safetyFlags: unique(options.safetyFlags ?? []),
    privacyFlags: [...PRIVACY_FLAGS],
  };
}

export function validateRideAnalysisContext(context: RideAnalysisContext): RideAnalysisContextValidationResult {
  const issues: RideAnalysisContextValidationResult["issues"] = [];
  if (context.schemaVersion !== RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION) issues.push({ code: "UNSUPPORTED_CONTEXT_SCHEMA_VERSION", message: "不支持的AI上下文Schema版本" });
  if (context.rulesVersion !== RIDE_ANALYSIS_CONTEXT_RULES_VERSION) issues.push({ code: "UNSUPPORTED_CONTEXT_RULES_VERSION", message: "不支持的AI上下文规则版本" });
  if (context.contextType !== "ride_analysis") issues.push({ code: "INVALID_CONTEXT_TYPE", message: "上下文类型必须是ride_analysis" });
  if (!context.rideId.trim()) issues.push({ code: "MISSING_RIDE_ID", message: "AI上下文缺少骑行ID" });
  if (!context.userScope.trim()) issues.push({ code: "MISSING_USER_SCOPE", message: "AI上下文缺少用户范围" });
  if ("dataLevel" in (context as unknown as Record<string, unknown>)) issues.push({ code: "LEGACY_DATA_LEVEL_PRESENT", message: "新AI上下文不得包含dataLevel" });
  if (!atomicCapabilityKeys.every((key) => context.capabilities.some((capability) => capability.key === key))) issues.push({ code: "CAPABILITY_SET_INCOMPLETE", message: "原子能力集合不完整" });
  if (!context.privacyFlags.includes("raw_track_excluded") || !context.privacyFlags.includes("precise_coordinates_excluded")) issues.push({ code: "PRIVACY_FLAGS_INCOMPLETE", message: "AI上下文缺少轨迹隐私边界" });
  if (context.featureSnapshot.rideId !== context.rideId) issues.push({ code: "FEATURE_RIDE_MISMATCH", message: "特征快照与上下文骑行不匹配" });
  if (!validateRideFeatureSnapshot(context.featureSnapshot).valid) issues.push({ code: "INVALID_FEATURE_SNAPSHOT", message: "特征快照不满足合同" });
  if (context.historicalComparison) {
    if (context.historicalComparison.anchorRideId !== context.rideId) issues.push({ code: "HISTORY_RIDE_MISMATCH", message: "历史快照与上下文骑行不匹配" });
    if (!validateHistoricalComparisonSnapshot(context.historicalComparison).valid) issues.push({ code: "INVALID_HISTORY_SNAPSHOT", message: "历史快照不满足合同" });
  }
  const seenClaims = new Set<string>();
  for (const claim of context.allowedClaims) {
    if (seenClaims.has(claim.claimId)) issues.push({ code: "DUPLICATE_CLAIM", message: `claim重复：${claim.claimId}`, claimId: claim.claimId });
    seenClaims.add(claim.claimId);
    if (!claim.claimId.trim() || !claim.key.trim()) issues.push({ code: "INVALID_CLAIM_ID", message: "claim缺少ID或key", claimId: claim.claimId });
    if (claim.value !== undefined && !finite(claim.value)) issues.push({ code: "NON_FINITE_CLAIM_VALUE", message: `claim数值无效：${claim.claimId}`, claimId: claim.claimId });
    if (claim.evidenceIds.length === 0) issues.push({ code: "CLAIM_EVIDENCE_MISSING", message: `claim缺少证据：${claim.claimId}`, claimId: claim.claimId });
  }
  return { valid: issues.length === 0, issues };
}
