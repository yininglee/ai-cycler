import type { RideRecord, RideSeriesPoint, SensorKind } from "./ride-schema.ts";
import { buildRideTimingSummary } from "./ride-timing.ts";
import type { UserProfile } from "./user-profile.ts";

export const RIDE_ZONE_RULES_VERSION = "ride-zone-rules-v0.1" as const;

const MIN_COVERAGE = 0.7;
const MAX_SAMPLE_INTERVAL_S = 10;
const STOP_SPEED_MPS = 1 / 3.6;

export type ZoneAvailabilityReason =
  | "missing_time_axis"
  | "missing_riding_time"
  | "missing_heart_rate_baseline"
  | "sensor_quality_failed"
  | "insufficient_coverage"
  | "zero_placeholder";

export interface ZoneBin {
  key: string;
  label: string;
  durationS: number;
  share: number;
}

export interface ZoneDistribution {
  rulesVersion: typeof RIDE_ZONE_RULES_VERSION;
  sensor: "heart_rate" | "cadence";
  ridingDurationS?: number;
  validDurationS: number;
  missingDurationS: number;
  stoppedDurationS: number;
  coverage: number;
  bins: ZoneBin[];
  unavailableReason?: ZoneAvailabilityReason;
}

export interface HeartRateZoneDistribution extends ZoneDistribution {
  sensor: "heart_rate";
  baseline?: {
    maxHeartRateBpm: number;
    source: "user_provided" | "system_estimated";
  };
}

export interface CadenceZoneDistribution extends ZoneDistribution {
  sensor: "cadence";
}

type ZoneDefinition = { key: string; label: string; matches: (value: number) => boolean };

const CADENCE_ZONES: ZoneDefinition[] = [
  { key: "zero", label: "0 rpm", matches: (value) => value === 0 },
  { key: "low", label: "1–59 rpm", matches: (value) => value >= 1 && value < 60 },
  { key: "steady", label: "60–74 rpm", matches: (value) => value >= 60 && value < 75 },
  { key: "endurance", label: "75–89 rpm", matches: (value) => value >= 75 && value < 90 },
  { key: "high", label: "90–104 rpm", matches: (value) => value >= 90 && value < 105 },
  { key: "very-high", label: "≥105 rpm", matches: (value) => value >= 105 },
];

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function valueInRange(value: number | undefined, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}

function sensorQualityPasses(record: RideRecord, sensor: SensorKind): boolean {
  const quality = record.activity.sensorQuality[sensor];
  return Boolean(
    quality
    && quality.sampleCount > 0
    && quality.coverage >= MIN_COVERAGE
    && quality.invalidSampleCount / quality.sampleCount <= 0.02,
  );
}

function intervalIsStopped(previous: RideSeriesPoint, current: RideSeriesPoint, startS: number, endS: number, stopIntervals: Array<{ startElapsedTimeS: number; endElapsedTimeS: number }>): boolean {
  if (stopIntervals.some((stop) => startS >= stop.startElapsedTimeS && endS <= stop.endElapsedTimeS)) return true;
  const speed = finite(current.speedMps) ? current.speedMps : previous.speedMps;
  return finite(speed) && speed < STOP_SPEED_MPS;
}

function emptyDistribution(sensor: "heart_rate" | "cadence", bins: ZoneDefinition[], unavailableReason?: ZoneAvailabilityReason): ZoneDistribution {
  return {
    rulesVersion: RIDE_ZONE_RULES_VERSION,
    sensor,
    validDurationS: 0,
    missingDurationS: 0,
    stoppedDurationS: 0,
    coverage: 0,
    bins: bins.map((bin) => ({ key: bin.key, label: bin.label, durationS: 0, share: 0 })),
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

function buildDistribution(
  record: RideRecord,
  sensor: "heart_rate" | "cadence",
  zones: ZoneDefinition[],
  readValue: (point: RideSeriesPoint) => number | undefined,
  isValueValid: (value: number | undefined) => value is number,
): ZoneDistribution {
  if (record.series.timeBasis.kind === "none") return emptyDistribution(sensor, zones, "missing_time_axis");
  if (!sensorQualityPasses(record, sensor)) return emptyDistribution(sensor, zones, "sensor_quality_failed");

  const timing = buildRideTimingSummary(record);
  if (!finite(timing.movingTimeS) || timing.movingTimeS <= 0) return emptyDistribution(sensor, zones, "missing_riding_time");

  const durationByKey = new Map(zones.map((zone) => [zone.key, 0]));
  let validDurationS = 0;
  let missingDurationS = 0;
  let stoppedDurationS = 0;
  const points = record.series.points;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (!finite(previous.elapsedTimeS) || !finite(current.elapsedTimeS)) continue;
    const intervalS = current.elapsedTimeS - previous.elapsedTimeS;
    if (intervalS <= 0 || intervalS > MAX_SAMPLE_INTERVAL_S) continue;
    if (intervalIsStopped(previous, current, previous.elapsedTimeS, current.elapsedTimeS, timing.stops)) {
      stoppedDurationS += intervalS;
      continue;
    }
    const value = readValue(previous);
    if (!isValueValid(value)) {
      missingDurationS += intervalS;
      continue;
    }
    const zone = zones.find((candidate) => candidate.matches(value));
    if (!zone) {
      missingDurationS += intervalS;
      continue;
    }
    durationByKey.set(zone.key, (durationByKey.get(zone.key) ?? 0) + intervalS);
    validDurationS += intervalS;
  }

  // Interval rounding and device timing totals can make the accumulated
  // numerator exceed the reported moving time by a small amount. Coverage is
  // a bounded quality ratio and must never be displayed above 100%.
  const coverage = Math.min(1, validDurationS / timing.movingTimeS);
  const insufficientCoverage = coverage < MIN_COVERAGE;
  return {
    rulesVersion: RIDE_ZONE_RULES_VERSION,
    sensor,
    ridingDurationS: timing.movingTimeS,
    validDurationS,
    missingDurationS,
    stoppedDurationS,
    coverage,
    bins: zones.map((zone) => {
      const durationS = durationByKey.get(zone.key) ?? 0;
      return { key: zone.key, label: zone.label, durationS, share: validDurationS > 0 ? durationS / validDurationS : 0 };
    }),
    ...(insufficientCoverage ? { unavailableReason: "insufficient_coverage" as const } : {}),
  };
}

function heartRateZones(maxHeartRateBpm: number): ZoneDefinition[] {
  const z1Start = Math.ceil(maxHeartRateBpm * 0.5);
  const z2Start = Math.ceil(maxHeartRateBpm * 0.6);
  const z3Start = Math.ceil(maxHeartRateBpm * 0.7);
  const z4Start = Math.ceil(maxHeartRateBpm * 0.8);
  const z5Start = Math.ceil(maxHeartRateBpm * 0.9);
  return [
    { key: "below-z1", label: `低于 ${z1Start} bpm`, matches: (value) => value < maxHeartRateBpm * 0.5 },
    { key: "z1", label: `Z1 · ${z1Start}–${z2Start - 1} bpm`, matches: (value) => value >= maxHeartRateBpm * 0.5 && value < maxHeartRateBpm * 0.6 },
    { key: "z2", label: `Z2 · ${z2Start}–${z3Start - 1} bpm`, matches: (value) => value >= maxHeartRateBpm * 0.6 && value < maxHeartRateBpm * 0.7 },
    { key: "z3", label: `Z3 · ${z3Start}–${z4Start - 1} bpm`, matches: (value) => value >= maxHeartRateBpm * 0.7 && value < maxHeartRateBpm * 0.8 },
    { key: "z4", label: `Z4 · ${z4Start}–${z5Start - 1} bpm`, matches: (value) => value >= maxHeartRateBpm * 0.8 && value < maxHeartRateBpm * 0.9 },
    { key: "z5", label: `Z5 · ${z5Start}–${maxHeartRateBpm} bpm`, matches: (value) => value >= maxHeartRateBpm * 0.9 && value <= maxHeartRateBpm },
    { key: "above-baseline", label: `超出 ${maxHeartRateBpm} bpm`, matches: (value) => value > maxHeartRateBpm },
  ];
}

export function buildHeartRateZoneDistribution(record: RideRecord, profile?: UserProfile | null): HeartRateZoneDistribution {
  const baseline = profile?.maxHeartRate;
  if (!baseline) {
    return { ...emptyDistribution("heart_rate", [], "missing_heart_rate_baseline"), sensor: "heart_rate" };
  }
  const distribution = buildDistribution(
    record,
    "heart_rate",
    heartRateZones(baseline.valueBpm),
    (point) => point.heartRateBpm,
    (value): value is number => valueInRange(value, 30, 260),
  );
  return {
    ...distribution,
    sensor: "heart_rate",
    baseline: { maxHeartRateBpm: baseline.valueBpm, source: baseline.source },
  };
}

export function buildCadenceZoneDistribution(record: RideRecord): CadenceZoneDistribution {
  const recordedCadence = record.series.points
    .map((point) => point.cadenceRpm)
    .filter((value): value is number => valueInRange(value, 0, 250));
  // A device may encode an unsupported cadence sensor as a complete sequence
  // of zeroes. Keep real coasting zeroes only when pedaling evidence exists.
  if (recordedCadence.length > 0 && recordedCadence.every((value) => value === 0)) {
    return { ...emptyDistribution("cadence", CADENCE_ZONES, "zero_placeholder"), sensor: "cadence" };
  }
  return {
    ...buildDistribution(
      record,
      "cadence",
      CADENCE_ZONES,
      (point) => point.cadenceRpm,
      (value): value is number => valueInRange(value, 0, 250),
    ),
    sensor: "cadence",
  };
}
