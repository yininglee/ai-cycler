import { getAtomicCapability, buildAtomicCapabilityProfile } from "./atomic-capabilities.ts";
import { validateRideRecord } from "./ride-series.ts";
import type {
  Confidence,
  MetricKey,
  RideRecord,
  RideSeriesKey,
  RideSeriesPoint,
} from "./ride-schema.ts";
import type { UserProfile } from "./user-profile.ts";

export const RIDE_FEATURE_SCHEMA_VERSION = "0.1" as const;
export const RIDE_FEATURE_RULES_VERSION = "ride-feature-rules-v0.2" as const;

const MIN_STAT_SAMPLE_COUNT = 5;
const MIN_SEGMENT_SAMPLE_COUNT = 8;

export type RideFeatureDimension = "speed" | "heartRate" | "power" | "cadence" | "elevation";
export type RideFeatureKey =
  | "speedSeriesMeanMps"
  | "speedStdDevMps"
  | "speedCoefficientOfVariation"
  | "speedFirstLastDeltaMps"
  | "heartRateSeriesMeanBpm"
  | "heartRateStdDevBpm"
  | "heartRateFirstLastDeltaBpm"
  | "powerSeriesMeanW"
  | "powerStdDevW"
  | "powerCoefficientOfVariation"
  | "powerFirstLastDeltaW"
  | "normalizedPowerRatio"
  | "cadenceSeriesMeanRpm"
  | "cadenceStdDevRpm"
  | "cadenceCoefficientOfVariation"
  | "cadenceFirstLastDeltaRpm"
  | "elevationMinM"
  | "elevationMaxM"
  | "elevationRangeM"
  | "elevationPositiveGainM";

export type RideFeatureUnavailableReason =
  | "RECORD_INVALID"
  | "CAPABILITY_UNAVAILABLE"
  | "SERIES_MISSING"
  | "QUALITY_INSUFFICIENT"
  | "INSUFFICIENT_SAMPLES"
  | "METRIC_MISSING"
  | "INVALID_INPUT";

export interface RideFeature {
  key: RideFeatureKey;
  dimension: RideFeatureDimension;
  value: number;
  unit: "m/s" | "bpm" | "W" | "rpm" | "ratio" | "m";
  confidence: Confidence;
  formulaVersion: string;
  input: {
    seriesKey?: RideSeriesKey;
    metricKeys?: MetricKey[];
    sampleCount?: number;
  };
  claimId: string;
  evidenceIds: string[];
}

export interface RideFeatureUnavailable {
  key: RideFeatureKey;
  dimension: RideFeatureDimension;
  reason: RideFeatureUnavailableReason;
  requiredCapabilities: string[];
}

export interface RideFeatureSnapshot {
  schemaVersion: typeof RIDE_FEATURE_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_FEATURE_RULES_VERSION;
  rideId: string;
  features: RideFeature[];
  unavailable: RideFeatureUnavailable[];
}

export interface RideFeatureValidationResult {
  valid: boolean;
  issues: Array<{ code: string; message: string; key?: string }>;
}

type SeriesValue = number[];

interface SeriesDefinition {
  dimension: RideFeatureDimension;
  seriesKey: Exclude<RideSeriesKey, "route" | "distance">;
  field: keyof RideSeriesPoint;
  unit: RideFeature["unit"];
  capability: "speed" | "heartRate" | "power" | "cadence" | "elevation";
  meanKey: RideFeatureKey;
  stdDevKey: RideFeatureKey;
  cvKey?: RideFeatureKey;
  deltaKey: RideFeatureKey;
}

const SERIES_DEFINITIONS: SeriesDefinition[] = [
  { dimension: "speed", seriesKey: "speed", field: "speedMps", unit: "m/s", capability: "speed", meanKey: "speedSeriesMeanMps", stdDevKey: "speedStdDevMps", cvKey: "speedCoefficientOfVariation", deltaKey: "speedFirstLastDeltaMps" },
  { dimension: "heartRate", seriesKey: "heart_rate", field: "heartRateBpm", unit: "bpm", capability: "heartRate", meanKey: "heartRateSeriesMeanBpm", stdDevKey: "heartRateStdDevBpm", deltaKey: "heartRateFirstLastDeltaBpm" },
  { dimension: "power", seriesKey: "power", field: "powerW", unit: "W", capability: "power", meanKey: "powerSeriesMeanW", stdDevKey: "powerStdDevW", cvKey: "powerCoefficientOfVariation", deltaKey: "powerFirstLastDeltaW" },
  { dimension: "cadence", seriesKey: "cadence", field: "cadenceRpm", unit: "rpm", capability: "cadence", meanKey: "cadenceSeriesMeanRpm", stdDevKey: "cadenceStdDevRpm", cvKey: "cadenceCoefficientOfVariation", deltaKey: "cadenceFirstLastDeltaRpm" },
];

function claimId(rideId: string, key: RideFeatureKey): string {
  return `claim:${rideId}:feature:${key}`;
}

function seriesEvidenceId(rideId: string, seriesKey: RideSeriesKey): string {
  return `evidence:${rideId}:series:${seriesKey}`;
}

function mean(values: SeriesValue): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: SeriesValue, average = mean(values)): number {
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function finiteSeriesValues(record: RideRecord, definition: SeriesDefinition): SeriesValue {
  return record.series.points
    .map((point) => point[definition.field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function addFeature(
  features: RideFeature[],
  record: RideRecord,
  definition: SeriesDefinition,
  key: RideFeatureKey,
  value: number,
  formulaVersion: string,
  sampleCount: number,
  unit: RideFeature["unit"] = definition.unit,
): void {
  if (!Number.isFinite(value)) return;
  features.push({
    key,
    dimension: definition.dimension,
    value,
    unit,
    confidence: "high",
    formulaVersion,
    input: { seriesKey: definition.seriesKey, sampleCount },
    claimId: claimId(record.activity.rideId, key),
    evidenceIds: [seriesEvidenceId(record.activity.rideId, definition.seriesKey)],
  });
}

function unavailable(
  items: RideFeatureUnavailable[],
  key: RideFeatureKey,
  dimension: RideFeatureDimension,
  reason: RideFeatureUnavailableReason,
  requiredCapabilities: string[],
): void {
  items.push({ key, dimension, reason, requiredCapabilities });
}

function addSeriesFeatures(
  record: RideRecord,
  definition: SeriesDefinition,
  features: RideFeature[],
  unavailableFeatures: RideFeatureUnavailable[],
  capabilityAvailable: boolean,
): void {
  const requiredCapabilities = [definition.capability];
  const values = finiteSeriesValues(record, definition);
  const metadata = record.series.seriesMetadata[definition.seriesKey];
  if (!capabilityAvailable) {
    for (const key of [definition.meanKey, definition.stdDevKey, ...(definition.cvKey ? [definition.cvKey] : []), definition.deltaKey]) {
      unavailable(unavailableFeatures, key, definition.dimension, "CAPABILITY_UNAVAILABLE", requiredCapabilities);
    }
    return;
  }
  if (!metadata || !record.series.availableSeries.includes(definition.seriesKey)) {
    for (const key of [definition.meanKey, definition.stdDevKey, ...(definition.cvKey ? [definition.cvKey] : []), definition.deltaKey]) {
      unavailable(unavailableFeatures, key, definition.dimension, "SERIES_MISSING", requiredCapabilities);
    }
    return;
  }
  if (metadata.qualityStatus !== "valid") {
    for (const key of [definition.meanKey, definition.stdDevKey, ...(definition.cvKey ? [definition.cvKey] : []), definition.deltaKey]) {
      unavailable(unavailableFeatures, key, definition.dimension, "QUALITY_INSUFFICIENT", requiredCapabilities);
    }
    return;
  }
  if (values.length < MIN_STAT_SAMPLE_COUNT) {
    for (const key of [definition.meanKey, definition.stdDevKey, ...(definition.cvKey ? [definition.cvKey] : []), definition.deltaKey]) {
      unavailable(unavailableFeatures, key, definition.dimension, "INSUFFICIENT_SAMPLES", requiredCapabilities);
    }
    return;
  }

  const average = mean(values);
  const deviation = standardDeviation(values, average);
  addFeature(features, record, definition, definition.meanKey, average, "series-mean-v0.1", values.length);
  addFeature(features, record, definition, definition.stdDevKey, deviation, "series-population-stddev-v0.1", values.length);
  if (definition.cvKey && average > 0) {
    addFeature(features, record, definition, definition.cvKey, deviation / average, "series-coefficient-of-variation-v0.1", values.length, "ratio");
  }
  if (values.length >= MIN_SEGMENT_SAMPLE_COUNT) {
    const segmentSize = Math.max(1, Math.floor(values.length / 4));
    const first = values.slice(0, segmentSize);
    const last = values.slice(values.length - segmentSize);
    addFeature(features, record, definition, definition.deltaKey, mean(last) - mean(first), "series-first-last-quarter-delta-v0.1", values.length);
  } else {
    unavailable(unavailableFeatures, definition.deltaKey, definition.dimension, "INSUFFICIENT_SAMPLES", requiredCapabilities);
  }
}

function addElevationFeatures(
  record: RideRecord,
  features: RideFeature[],
  unavailableFeatures: RideFeatureUnavailable[],
  capabilityAvailable: boolean,
): void {
  const requiredCapabilities = ["elevation"];
  const values = record.series.points
    .map((point) => point.elevationM)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const add = (key: RideFeatureKey, value: number, formulaVersion: string, evidenceIds: string[], input: RideFeature["input"]): void => {
    if (!Number.isFinite(value)) return;
    features.push({
      key,
      dimension: "elevation",
      value,
      unit: "m",
      confidence: "high",
      formulaVersion,
      input,
      claimId: claimId(record.activity.rideId, key),
      evidenceIds,
    });
  };

  const metric = record.activity.metrics.elevationGainM;
  if (metric && metric.qualityStatus === "valid" && capabilityAvailable) {
    add("elevationPositiveGainM", metric.value, metric.formulaVersion ?? "recorded-elevation-gain-v0.1", [metric.evidenceId], { metricKeys: ["elevationGainM"] });
  } else {
    unavailable(unavailableFeatures, "elevationPositiveGainM", "elevation", capabilityAvailable ? "METRIC_MISSING" : "CAPABILITY_UNAVAILABLE", requiredCapabilities);
  }

  if (!capabilityAvailable) {
    for (const key of ["elevationMinM", "elevationMaxM", "elevationRangeM"] as RideFeatureKey[]) unavailable(unavailableFeatures, key, "elevation", "CAPABILITY_UNAVAILABLE", requiredCapabilities);
    return;
  }
  if (!record.series.availableSeries.includes("elevation") || !record.series.seriesMetadata.elevation) {
    for (const key of ["elevationMinM", "elevationMaxM", "elevationRangeM"] as RideFeatureKey[]) unavailable(unavailableFeatures, key, "elevation", "SERIES_MISSING", requiredCapabilities);
    return;
  }
  if (record.series.seriesMetadata.elevation.qualityStatus !== "valid" || values.length < MIN_STAT_SAMPLE_COUNT) {
    for (const key of ["elevationMinM", "elevationMaxM", "elevationRangeM"] as RideFeatureKey[]) unavailable(unavailableFeatures, key, "elevation", values.length < MIN_STAT_SAMPLE_COUNT ? "INSUFFICIENT_SAMPLES" : "QUALITY_INSUFFICIENT", requiredCapabilities);
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const evidenceIds = [seriesEvidenceId(record.activity.rideId, "elevation")];
  const input = { seriesKey: "elevation" as const, sampleCount: values.length };
  add("elevationMinM", min, "series-min-v0.1", evidenceIds, input);
  add("elevationMaxM", max, "series-max-v0.1", evidenceIds, input);
  add("elevationRangeM", max - min, "series-range-v0.1", evidenceIds, input);
}

function addNormalizedPowerFeature(record: RideRecord, features: RideFeature[], unavailableFeatures: RideFeatureUnavailable[], powerAvailable: boolean): void {
  const np = record.activity.metrics.normalizedPowerW;
  const avg = record.activity.metrics.avgPowerW;
  if (!powerAvailable) {
    unavailable(unavailableFeatures, "normalizedPowerRatio", "power", "CAPABILITY_UNAVAILABLE", ["power", "normalizedPower"]);
    return;
  }
  if (!np || !avg || np.qualityStatus !== "valid" || avg.qualityStatus !== "valid" || avg.value <= 0) {
    unavailable(unavailableFeatures, "normalizedPowerRatio", "power", "METRIC_MISSING", ["power", "normalizedPower"]);
    return;
  }
  features.push({
    key: "normalizedPowerRatio",
    dimension: "power",
    value: np.value / avg.value,
    unit: "ratio",
    confidence: "high",
    formulaVersion: "normalized-power-to-average-power-v0.1",
    input: { metricKeys: ["normalizedPowerW", "avgPowerW"] },
    claimId: claimId(record.activity.rideId, "normalizedPowerRatio"),
    evidenceIds: [np.evidenceId, avg.evidenceId],
  });
}

export function buildRideFeatureSnapshot(record: RideRecord, profile?: UserProfile): RideFeatureSnapshot {
  const validation = validateRideRecord(record);
  const features: RideFeature[] = [];
  const unavailableFeatures: RideFeatureUnavailable[] = [];
  if (!validation.valid) {
    const keys: RideFeatureKey[] = [
      "speedSeriesMeanMps", "speedStdDevMps", "speedCoefficientOfVariation", "speedFirstLastDeltaMps",
      "heartRateSeriesMeanBpm", "heartRateStdDevBpm", "heartRateFirstLastDeltaBpm",
      "powerSeriesMeanW", "powerStdDevW", "powerCoefficientOfVariation", "powerFirstLastDeltaW", "normalizedPowerRatio",
      "cadenceSeriesMeanRpm", "cadenceStdDevRpm", "cadenceCoefficientOfVariation", "cadenceFirstLastDeltaRpm",
      "elevationMinM", "elevationMaxM", "elevationRangeM", "elevationPositiveGainM",
    ];
    for (const key of keys) unavailableFeatures.push({ key, dimension: key.startsWith("speed") ? "speed" : key.startsWith("heartRate") ? "heartRate" : key.startsWith("power") || key === "normalizedPowerRatio" ? "power" : key.startsWith("cadence") ? "cadence" : "elevation", reason: "RECORD_INVALID", requiredCapabilities: [] });
    return { schemaVersion: RIDE_FEATURE_SCHEMA_VERSION, rulesVersion: RIDE_FEATURE_RULES_VERSION, rideId: record.activity.rideId, features, unavailable: unavailableFeatures };
  }

  const capabilities = buildAtomicCapabilityProfile(record, profile);
  for (const definition of SERIES_DEFINITIONS) {
    addSeriesFeatures(record, definition, features, unavailableFeatures, getAtomicCapability(capabilities, definition.capability).available);
  }
  addNormalizedPowerFeature(record, features, unavailableFeatures, getAtomicCapability(capabilities, "power").available);
  addElevationFeatures(record, features, unavailableFeatures, getAtomicCapability(capabilities, "elevation").available);

  return { schemaVersion: RIDE_FEATURE_SCHEMA_VERSION, rulesVersion: RIDE_FEATURE_RULES_VERSION, rideId: record.activity.rideId, features, unavailable: unavailableFeatures };
}

export function getRideFeature(snapshot: RideFeatureSnapshot, key: RideFeatureKey): RideFeature | undefined {
  return snapshot.features.find((feature) => feature.key === key);
}

export function validateRideFeatureSnapshot(snapshot: RideFeatureSnapshot): RideFeatureValidationResult {
  const issues: RideFeatureValidationResult["issues"] = [];
  if (snapshot.schemaVersion !== RIDE_FEATURE_SCHEMA_VERSION) issues.push({ code: "UNSUPPORTED_FEATURE_SCHEMA_VERSION", message: "不支持的特征Schema版本" });
  if (snapshot.rulesVersion !== RIDE_FEATURE_RULES_VERSION) issues.push({ code: "UNSUPPORTED_FEATURE_RULES_VERSION", message: "不支持的特征规则版本" });
  if (!snapshot.rideId.trim()) issues.push({ code: "MISSING_RIDE_ID", message: "特征快照缺少骑行记录ID" });

  const featureKeys = new Set<RideFeatureKey>();
  const unavailableKeys = new Set<RideFeatureKey>();
  for (const feature of snapshot.features) {
    if (featureKeys.has(feature.key)) issues.push({ code: "DUPLICATE_FEATURE_KEY", message: `特征重复：${feature.key}`, key: feature.key });
    featureKeys.add(feature.key);
    if (!Number.isFinite(feature.value)) issues.push({ code: "NON_FINITE_FEATURE", message: `特征不是有限数值：${feature.key}`, key: feature.key });
    if (feature.claimId !== claimId(snapshot.rideId, feature.key)) issues.push({ code: "INVALID_FEATURE_CLAIM", message: `特征claim不匹配：${feature.key}`, key: feature.key });
    if (!feature.formulaVersion.trim()) issues.push({ code: "MISSING_FEATURE_FORMULA", message: `特征缺少公式版本：${feature.key}`, key: feature.key });
    if (feature.evidenceIds.length === 0) issues.push({ code: "MISSING_FEATURE_EVIDENCE", message: `特征缺少证据：${feature.key}`, key: feature.key });
    if (unavailableKeys.has(feature.key)) issues.push({ code: "FEATURE_AND_UNAVAILABLE_CONFLICT", message: `特征同时标记可用和不可用：${feature.key}`, key: feature.key });
  }
  for (const item of snapshot.unavailable) {
    if (unavailableKeys.has(item.key)) issues.push({ code: "DUPLICATE_UNAVAILABLE_KEY", message: `不可用特征重复：${item.key}`, key: item.key });
    unavailableKeys.add(item.key);
    if (featureKeys.has(item.key)) issues.push({ code: "FEATURE_AND_UNAVAILABLE_CONFLICT", message: `特征同时标记可用和不可用：${item.key}`, key: item.key });
  }
  return { valid: issues.length === 0, issues };
}
