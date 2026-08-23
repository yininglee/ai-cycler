import { isRideSensorUsable } from "./ride-rules.ts";
import { validateRideRecord } from "./ride-series.ts";
import type { MetricKey, RideRecord, RideSeriesKey, SensorKind } from "./ride-schema.ts";
import type { UserProfile } from "./user-profile.ts";

export const ATOMIC_CAPABILITY_SCHEMA_VERSION = "0.1" as const;
export const ATOMIC_CAPABILITY_RULES_VERSION = "atomic-capability-rules-v0.1" as const;

/**
 * L1/L2/L3 deliberately do not appear in this contract. They remain fixture
 * group labels only and must not decide business or model capabilities.
 */
export const atomicCapabilityKeys = [
  "route",
  "distance",
  "timing",
  "speed",
  "elevation",
  "heartRate",
  "maxHeartRateBaseline",
  "heartRateZones",
  "power",
  "normalizedPower",
  "verifiedFtp",
  "powerZones",
  "trainingLoad",
  "cadence",
  "userProfile",
  "historyComparison",
  "sameRouteComparison",
  "trend",
] as const;

export type AtomicCapabilityKey = typeof atomicCapabilityKeys[number];
export type CapabilitySource = "ride_activity" | "ride_series" | "user_profile" | "deterministic_rule" | "history_snapshot";
export type CapabilityQuality = "valid" | "estimated" | "unavailable";
export type CapabilityUnavailableReason =
  | "RECORD_INVALID"
  | "FIELD_MISSING"
  | "SERIES_MISSING"
  | "QUALITY_INSUFFICIENT"
  | "TIME_BASIS_MISSING"
  | "PROFILE_MISSING"
  | "PROFILE_EMPTY"
  | "MAX_HEART_RATE_MISSING"
  | "FTP_MISSING"
  | "DEPENDENCY_UNAVAILABLE"
  | "RULE_NOT_IMPLEMENTED"
  | "HISTORY_NOT_AVAILABLE";

export interface AtomicCapability {
  key: AtomicCapabilityKey;
  available: boolean;
  sources: CapabilitySource[];
  qualityStatus: CapabilityQuality;
  dependencyKeys: AtomicCapabilityKey[];
  evidenceIds: string[];
  unavailableReason?: CapabilityUnavailableReason;
  provenance?: {
    source: "user_provided" | "system_estimated";
    updatedAt: string;
    formulaVersion?: string;
  };
}

export interface AtomicCapabilityProfile {
  schemaVersion: typeof ATOMIC_CAPABILITY_SCHEMA_VERSION;
  rulesVersion: typeof ATOMIC_CAPABILITY_RULES_VERSION;
  rideId: string;
  capabilities: AtomicCapability[];
}

type CapabilityDraft = Omit<AtomicCapability, "key">;

function available(
  sources: CapabilitySource[],
  evidenceIds: string[] = [],
  options: Pick<AtomicCapability, "dependencyKeys"> & Partial<Pick<AtomicCapability, "qualityStatus" | "provenance">> = { dependencyKeys: [] },
): CapabilityDraft {
  return {
    available: true,
    sources,
    qualityStatus: options.qualityStatus ?? "valid",
    dependencyKeys: options.dependencyKeys,
    evidenceIds,
    ...(options.provenance ? { provenance: options.provenance } : {}),
  };
}

function unavailable(
  reason: CapabilityUnavailableReason,
  dependencyKeys: AtomicCapabilityKey[] = [],
): CapabilityDraft {
  return {
    available: false,
    sources: [],
    qualityStatus: "unavailable",
    dependencyKeys,
    evidenceIds: [],
    unavailableReason: reason,
  };
}

function metricEvidence(record: RideRecord, keys: MetricKey[]): string[] {
  return keys.flatMap((key) => record.activity.metrics[key]?.evidenceId ?? []);
}

function validMetricExists(record: RideRecord, keys: MetricKey[]): boolean {
  return keys.some((key) => record.activity.metrics[key]?.qualityStatus === "valid");
}

function validSeriesExists(record: RideRecord, key: RideSeriesKey): boolean {
  const metadata = record.series.seriesMetadata[key];
  return record.series.availableSeries.includes(key) && Boolean(metadata && metadata.qualityStatus === "valid" && metadata.sampleCount > 0);
}

function sensorCapability(
  record: RideRecord,
  sensor: SensorKind,
  metricKeys: MetricKey[],
  seriesKey: RideSeriesKey,
): CapabilityDraft {
  if (!validMetricExists(record, metricKeys) && !validSeriesExists(record, seriesKey)) return unavailable("FIELD_MISSING");
  if (!isRideSensorUsable(record.activity, sensor)) return unavailable("QUALITY_INSUFFICIENT");
  const sources: CapabilitySource[] = ["ride_activity"];
  if (validSeriesExists(record, seriesKey)) sources.push("ride_series");
  return available(sources, metricEvidence(record, metricKeys), { dependencyKeys: [] });
}

function profileHasFacts(profile: UserProfile | undefined): boolean {
  return Boolean(profile && (profile.age || profile.heightCm || profile.weightKg || profile.maxHeartRate || profile.ftp));
}

export function buildAtomicCapabilityProfile(record: RideRecord, profile?: UserProfile): AtomicCapabilityProfile {
  const validation = validateRideRecord(record);
  const drafts = new Map<AtomicCapabilityKey, CapabilityDraft>();

  if (!validation.valid) {
    for (const key of atomicCapabilityKeys) drafts.set(key, unavailable("RECORD_INVALID"));
  } else {
    drafts.set("route", validSeriesExists(record, "route")
      ? available(["ride_series"], [], { dependencyKeys: [] })
      : unavailable("SERIES_MISSING"));

    drafts.set("distance", validMetricExists(record, ["distanceM"])
      ? available(
          validSeriesExists(record, "distance") ? ["ride_activity", "ride_series"] : ["ride_activity"],
          metricEvidence(record, ["distanceM"]),
          { dependencyKeys: [] },
        )
      : unavailable("FIELD_MISSING"));

    const hasTimingMetric = validMetricExists(record, ["movingTimeS", "elapsedTimeS"]);
    drafts.set("timing", hasTimingMetric && record.series.timeBasis.kind === "elapsed_from_start"
      ? available(["ride_activity", "ride_series"], metricEvidence(record, ["movingTimeS", "elapsedTimeS"]), { dependencyKeys: [] })
      : unavailable(hasTimingMetric ? "TIME_BASIS_MISSING" : "FIELD_MISSING"));

    const timing = drafts.get("timing")!;
    drafts.set("speed", timing.available && validMetricExists(record, ["avgSpeedMps", "maxSpeedMps"])
      ? available(
          validSeriesExists(record, "speed") ? ["ride_activity", "ride_series"] : ["ride_activity"],
          metricEvidence(record, ["avgSpeedMps", "maxSpeedMps"]),
          { dependencyKeys: ["timing"] },
        )
      : unavailable(timing.available ? "FIELD_MISSING" : "DEPENDENCY_UNAVAILABLE", ["timing"]));

    drafts.set("elevation", validMetricExists(record, ["elevationGainM"]) || validSeriesExists(record, "elevation")
      ? available(
          validSeriesExists(record, "elevation") ? ["ride_activity", "ride_series"] : ["ride_activity"],
          metricEvidence(record, ["elevationGainM"]),
          { dependencyKeys: [] },
        )
      : unavailable("FIELD_MISSING"));

    drafts.set("heartRate", sensorCapability(record, "heart_rate", ["avgHeartRateBpm", "maxHeartRateBpm"], "heart_rate"));
    drafts.set("power", sensorCapability(record, "power", ["avgPowerW", "maxPowerW"], "power"));
    drafts.set("cadence", sensorCapability(record, "cadence", ["avgCadenceRpm", "maxCadenceRpm"], "cadence"));

    const power = drafts.get("power")!;
    const normalizedPowerMetric = record.activity.metrics.normalizedPowerW;
    drafts.set("normalizedPower", power.available && normalizedPowerMetric?.qualityStatus === "valid"
      ? available(
          normalizedPowerMetric.provenance === "calculated" ? ["ride_activity", "deterministic_rule"] : ["ride_activity"],
          metricEvidence(record, ["normalizedPowerW"]),
          { dependencyKeys: ["power"] },
        )
      : unavailable(power.available ? "FIELD_MISSING" : "DEPENDENCY_UNAVAILABLE", ["power"]));

    const hasProfile = profileHasFacts(profile);
    drafts.set("userProfile", hasProfile
      ? available(["user_profile"], [], { dependencyKeys: [] })
      : unavailable(profile ? "PROFILE_EMPTY" : "PROFILE_MISSING"));

    const userProfile = drafts.get("userProfile")!;
    drafts.set("maxHeartRateBaseline", profile?.maxHeartRate
      ? available(["user_profile"], [], {
          dependencyKeys: ["userProfile"],
          qualityStatus: profile.maxHeartRate.source === "system_estimated" ? "estimated" : "valid",
          provenance: {
            source: profile.maxHeartRate.source,
            updatedAt: profile.maxHeartRate.updatedAt,
            ...(profile.maxHeartRate.formulaVersion ? { formulaVersion: profile.maxHeartRate.formulaVersion } : {}),
          },
        })
      : unavailable(userProfile.available ? "MAX_HEART_RATE_MISSING" : "DEPENDENCY_UNAVAILABLE", ["userProfile"]));

    drafts.set("verifiedFtp", profile?.ftp?.trustStatus === "user_confirmed"
      ? available(["user_profile"], [], {
          dependencyKeys: ["userProfile"],
          provenance: { source: profile.ftp.source, updatedAt: profile.ftp.updatedAt },
        })
      : unavailable(userProfile.available ? "FTP_MISSING" : "DEPENDENCY_UNAVAILABLE", ["userProfile"]));

    const heartRate = drafts.get("heartRate")!;
    const maxHeartRate = drafts.get("maxHeartRateBaseline")!;
    drafts.set("heartRateZones", !heartRate.available || !maxHeartRate.available
      ? unavailable("DEPENDENCY_UNAVAILABLE", ["heartRate", "maxHeartRateBaseline"])
      : unavailable("RULE_NOT_IMPLEMENTED", ["heartRate", "maxHeartRateBaseline"]));

    const verifiedFtp = drafts.get("verifiedFtp")!;
    drafts.set("powerZones", !power.available || !verifiedFtp.available
      ? unavailable("DEPENDENCY_UNAVAILABLE", ["power", "verifiedFtp"])
      : unavailable("RULE_NOT_IMPLEMENTED", ["power", "verifiedFtp"]));

    drafts.set("trainingLoad", !power.available || !verifiedFtp.available
      ? unavailable("DEPENDENCY_UNAVAILABLE", ["power", "verifiedFtp"])
      : unavailable("RULE_NOT_IMPLEMENTED", ["power", "verifiedFtp"]));

    drafts.set("historyComparison", unavailable("HISTORY_NOT_AVAILABLE"));
    drafts.set("sameRouteComparison", unavailable("HISTORY_NOT_AVAILABLE", ["historyComparison", "route"]));
    drafts.set("trend", unavailable("HISTORY_NOT_AVAILABLE", ["historyComparison"]));
  }

  return {
    schemaVersion: ATOMIC_CAPABILITY_SCHEMA_VERSION,
    rulesVersion: ATOMIC_CAPABILITY_RULES_VERSION,
    rideId: record.activity.rideId,
    capabilities: atomicCapabilityKeys.map((key) => ({ key, ...drafts.get(key)! })),
  };
}

export function getAtomicCapability(profile: AtomicCapabilityProfile, key: AtomicCapabilityKey): AtomicCapability {
  const capability = profile.capabilities.find((item) => item.key === key);
  if (!capability) throw new Error(`Atomic capability is missing: ${key}`);
  return capability;
}
