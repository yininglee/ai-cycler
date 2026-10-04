import { validateRideRecord } from "./ride-series.ts";
import { buildRideTimingSummary, type RideStopSegment } from "./ride-timing.ts";
import type { RideRecord, RideSeriesKey, RideSeriesPoint } from "./ride-schema.ts";

export const RIDE_TEMPORAL_RULES_VERSION = "ride-temporal-v2.1" as const;

const MAX_CONTINUOUS_INTERVAL_S = 10;
const STOP_SPEED_MPS = 1 / 3.6;
const MIN_STAT_INTERVALS = 3;
const MIN_STAT_WEIGHT_S = 30;
const MIN_STAT_WEIGHT_M = 100;
const MIN_STABILITY_INTERVALS = 5;
const MIN_STABILITY_WEIGHT_S = 60;
const MIN_STAGE_INTERVALS = 2;
const MIN_STAGE_WEIGHT_S = 20;
const MIN_STABILITY_COVERAGE = 0.8;
const MIN_STAGE_COVERAGE = 0.7;

type SensorKey = "speed" | "heart_rate" | "power" | "cadence";
export type TemporalUnavailableReason =
  | "RECORD_INVALID" | "AXIS_MISSING" | "AXIS_INCOMPLETE" | "TIME_AXIS_REQUIRED"
  | "SERIES_MISSING" | "QUALITY_INSUFFICIENT" | "INSUFFICIENT_SAMPLES"
  | "INSUFFICIENT_COVERAGE" | "CONTINUITY_GAP" | "UNLOCATED_STOP_TIME" | "ALL_ZERO_SERIES";

const SENSOR_FIELDS = {
  speed: { field: "speedMps", unit: "m/s", qualityKey: "gps" },
  heart_rate: { field: "heartRateBpm", unit: "bpm", qualityKey: "heart_rate" },
  power: { field: "powerW", unit: "W", qualityKey: "power" },
  cadence: { field: "cadenceRpm", unit: "rpm", qualityKey: "cadence" },
} as const satisfies Record<SensorKey, { field: keyof RideSeriesPoint; unit: string; qualityKey: string }>;

export interface WeightedStatisticsV2 {
  mean: number;
  standardDeviation: number;
  coefficientOfVariation?: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  medianAbsoluteDeviation: number;
}

export interface TemporalStageV2 {
  part: "first" | "middle" | "last";
  start: number;
  end: number;
  eligibleWeight: number;
  validWeight: number;
  coverage: number;
  validIntervalCount: number;
  mean?: number;
}

export interface TemporalSeriesFeatureV2 {
  seriesKey: SensorKey;
  unit: string;
  weightUnit: "s" | "m";
  eligibleWeight: number;
  validWeight: number;
  coverage: number;
  validIntervalCount: number;
  statistics?: WeightedStatisticsV2;
  stages: TemporalStageV2[];
  // A gate only permits a later builder to form the corresponding Claim; it is not a Claim.
  stability: { eligible: boolean; reason?: TemporalUnavailableReason };
  stageComparison: { eligible: boolean; reason?: TemporalUnavailableReason; lastMinusFirst?: number };
  unavailable: TemporalUnavailableReason[];
  evidenceIds: string[];
  formulaVersion: typeof RIDE_TEMPORAL_RULES_VERSION;
}

export interface RideTemporalFeatureSnapshotV2 {
  rideId: string;
  rulesVersion: typeof RIDE_TEMPORAL_RULES_VERSION;
  axis: "time" | "distance" | "none";
  span: number;
  axisIncomplete: boolean;
  gaps: Array<{ startElapsedTimeS: number; endElapsedTimeS: number; durationS: number }>;
  longestGapS: number;
  stops: RideStopSegment[];
  unlocatedStopTimeS: number;
  series: TemporalSeriesFeatureV2[];
}

interface Piece {
  start: number;
  end: number;
  moving: boolean | "unknown";
  gap: boolean;
  point: RideSeriesPoint;
  intervalIndex: number;
}

interface Observation { value: number; weight: number; intervalIndex: number; start: number; end: number }

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function overlap(start: number, end: number, otherStart: number, otherEnd: number): number {
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}

function weightedQuantile(samples: Observation[], percentile: number): number {
  const ordered = [...samples].sort((a, b) => a.value - b.value);
  const threshold = ordered.reduce((sum, item) => sum + item.weight, 0) * percentile;
  let accumulated = 0;
  for (const item of ordered) {
    accumulated += item.weight;
    if (accumulated >= threshold) return item.value;
  }
  return ordered.at(-1)!.value;
}

function statistics(samples: Observation[]): WeightedStatisticsV2 {
  const weight = samples.reduce((sum, item) => sum + item.weight, 0);
  const mean = samples.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
  const deviation = Math.sqrt(samples.reduce((sum, item) => sum + (item.value - mean) ** 2 * item.weight, 0) / weight);
  const median = weightedQuantile(samples, 0.5);
  return {
    mean,
    standardDeviation: deviation,
    ...(mean > 0 ? { coefficientOfVariation: deviation / mean } : {}),
    median,
    p10: weightedQuantile(samples, 0.1),
    p25: weightedQuantile(samples, 0.25),
    p75: weightedQuantile(samples, 0.75),
    p90: weightedQuantile(samples, 0.9),
    medianAbsoluteDeviation: weightedQuantile(samples.map((item) => ({ ...item, value: Math.abs(item.value - median) })), 0.5),
  };
}

function buildPieces(record: RideRecord, axis: "time" | "distance", stops: RideStopSegment[]): Piece[] {
  const points = record.series.points;
  const field = axis === "time" ? "elapsedTimeS" : "distanceM";
  const pieces: Piece[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const start = previous[field];
    const end = current[field];
    if (!finite(start) || !finite(end) || end <= start) continue;
    const duration = finite(previous.elapsedTimeS) && finite(current.elapsedTimeS)
      ? current.elapsedTimeS - previous.elapsedTimeS : undefined;
    const distance = finite(previous.distanceM) && finite(current.distanceM)
      ? current.distanceM - previous.distanceM : undefined;
    const gap = axis === "time" && end - start > MAX_CONTINUOUS_INTERVAL_S;
    const speed = finite(duration) && duration > 0 && finite(distance)
      ? distance / duration : current.speedMps;
    const moving = finite(speed) ? speed >= STOP_SPEED_MPS
      : axis === "distance" && finite(distance) ? distance > 0 : "unknown";
    const boundaries = axis === "time"
      ? [start, ...stops.flatMap((stop) => [stop.startElapsedTimeS, stop.endElapsedTimeS]).filter((time) => time > start && time < end), end].sort((a, b) => a - b)
      : [start, end];
    for (let part = 1; part < boundaries.length; part += 1) {
      const partStart = boundaries[part - 1]!;
      const partEnd = boundaries[part]!;
      const stopped = axis === "time" && stops.some((stop) => overlap(partStart, partEnd, stop.startElapsedTimeS, stop.endElapsedTimeS) > 0);
      if (partEnd > partStart && !stopped) pieces.push({ start: partStart, end: partEnd, moving, gap, point: current, intervalIndex: index });
    }
  }
  return pieces;
}

function gate(reason?: TemporalUnavailableReason): { eligible: boolean; reason?: TemporalUnavailableReason } {
  return reason ? { eligible: false, reason } : { eligible: true };
}

export function buildRideTemporalFeaturesV2(record: RideRecord): RideTemporalFeatureSnapshotV2 {
  const valid = validateRideRecord(record).valid;
  const points = record.series.points;
  const hasTime = record.series.timeBasis.kind === "elapsed_from_start" && points.filter((point) => finite(point.elapsedTimeS)).length >= 2;
  const hasDistance = points.filter((point) => finite(point.distanceM)).length >= 2;
  const axis = hasTime ? "time" : hasDistance ? "distance" : "none";
  const field = axis === "time" ? "elapsedTimeS" : "distanceM";
  const anchored = axis !== "none" && finite(points[0]?.[field]) && finite(points.at(-1)?.[field]);
  const start = anchored ? points[0]![field]! : 0;
  const end = anchored ? points.at(-1)![field]! : 0;
  const span = Math.max(0, end - start);
  const axisIncomplete = !anchored || points.some((point) => !finite(point[field]));
  const timing = valid && axis === "time" ? buildRideTimingSummary(record) : undefined;
  const stops = timing?.stops ?? [];
  const locatedStopTimeS = stops.reduce((sum, stop) => sum + overlap(start, end, stop.startElapsedTimeS, stop.endElapsedTimeS), 0);
  const unlocatedStopTimeS = Math.max(0, (timing?.stoppedTimeS ?? 0) - locatedStopTimeS);
  const gaps = axis === "time" ? points.slice(1).flatMap((point, index) => {
    const previous = points[index]!;
    const a = previous.elapsedTimeS;
    const b = point.elapsedTimeS;
    if (!finite(a) || !finite(b) || b - a <= MAX_CONTINUOUS_INTERVAL_S) return [];
    const boundaries = [a, ...stops.flatMap((stop) => [stop.startElapsedTimeS, stop.endElapsedTimeS])
      .filter((time) => time > a && time < b), b].sort((left, right) => left - right);
    return boundaries.slice(1).flatMap((boundary, part) => {
      const partStart = boundaries[part]!;
      const stopped = stops.some((stop) => overlap(partStart, boundary, stop.startElapsedTimeS, stop.endElapsedTimeS) > 0);
      return stopped || boundary <= partStart ? []
        : [{ startElapsedTimeS: partStart, endElapsedTimeS: boundary, durationS: boundary - partStart }];
    });
  }) : [];
  const pieces = valid && axis !== "none" ? buildPieces(record, axis, stops) : [];
  const eligibleWeight = pieces.reduce((sum, piece) => sum + (piece.moving === false ? 0 : piece.end - piece.start), 0);

  const series = (Object.keys(SENSOR_FIELDS) as SensorKey[]).map((seriesKey): TemporalSeriesFeatureV2 => {
    const definition = SENSOR_FIELDS[seriesKey];
    const sourceQuality = record.activity.sensorQuality[definition.qualityKey];
    const metadata = record.series.seriesMetadata[seriesKey];
    const sourceReason: TemporalUnavailableReason | undefined = !valid ? "RECORD_INVALID"
      : axis === "none" || span <= 0 ? "AXIS_MISSING"
      : !record.series.availableSeries.includes(seriesKey) || !metadata ? "SERIES_MISSING"
      : metadata.qualityStatus !== "valid" || (sourceQuality && sourceQuality.coverage < MIN_STABILITY_COVERAGE) ? "QUALITY_INSUFFICIENT" : undefined;
    const available = !sourceReason;
    const observed = pieces.flatMap((piece): Observation[] => {
      const value = piece.point[definition.field];
      return available && !piece.gap && piece.moving === true && typeof value === "number" && Number.isFinite(value)
        ? [{ value, weight: piece.end - piece.start, intervalIndex: piece.intervalIndex, start: piece.start, end: piece.end }] : [];
    });
    const validWeight = observed.reduce((sum, item) => sum + item.weight, 0);
    // Unknown time and a missing axis lower coverage instead of silently disappearing.
    const denominator = axis === "time" ? Math.max(0, span - locatedStopTimeS) : eligibleWeight;
    const coverage = denominator > 0 ? validWeight / denominator : 0;
    const validIntervalCount = new Set(observed.map((item) => item.intervalIndex)).size;
    const allZero = (seriesKey === "power" || seriesKey === "cadence") && observed.length > 0
      && observed.every((item) => item.value === 0);
    const sufficientStats = !sourceReason && !axisIncomplete && !allZero && unlocatedStopTimeS === 0 && validIntervalCount >= MIN_STAT_INTERVALS
      && (axis === "distance" ? validWeight >= MIN_STAT_WEIGHT_M : validWeight >= MIN_STAT_WEIGHT_S);
    const stats = sufficientStats ? statistics(observed) : undefined;
    const stageNames = ["first", "middle", "last"] as const;
    const stages = stageNames.map((part, index): TemporalStageV2 => {
      const stageStart = start + span * index / 3;
      const stageEnd = start + span * (index + 1) / 3;
      const eligible = pieces.reduce((sum, piece) => sum + (piece.moving === false ? 0 : overlap(piece.start, piece.end, stageStart, stageEnd)), 0);
      const samples = observed.flatMap((item) => {
        const weight = overlap(item.start, item.end, stageStart, stageEnd);
        return weight > 0 ? [{ ...item, weight }] : [];
      });
      const weight = samples.reduce((sum, item) => sum + item.weight, 0);
      const intervalCount = new Set(samples.map((item) => item.intervalIndex)).size;
      const stageCoverage = eligible > 0 ? weight / eligible : 0;
      const stageQualified = !sourceReason && !axisIncomplete && !allZero && unlocatedStopTimeS === 0 && axis === "time"
        && intervalCount >= MIN_STAGE_INTERVALS && weight >= MIN_STAGE_WEIGHT_S && stageCoverage >= MIN_STAGE_COVERAGE;
      return { part, start: stageStart, end: stageEnd, eligibleWeight: eligible, validWeight: weight,
        coverage: stageCoverage, validIntervalCount: intervalCount,
        ...(stageQualified ? { mean: statistics(samples).mean } : {}) };
    });
    const sharedReason: TemporalUnavailableReason | undefined = sourceReason ?? (axisIncomplete ? "AXIS_INCOMPLETE" : allZero ? "ALL_ZERO_SERIES" : axis !== "time" ? "TIME_AXIS_REQUIRED" : unlocatedStopTimeS > 0 ? "UNLOCATED_STOP_TIME" : undefined);
    const stabilityReason: TemporalUnavailableReason | undefined = sharedReason ?? (!stats || validIntervalCount < MIN_STABILITY_INTERVALS || validWeight < MIN_STABILITY_WEIGHT_S
      ? "INSUFFICIENT_SAMPLES" : coverage < MIN_STABILITY_COVERAGE ? "INSUFFICIENT_COVERAGE" : gaps.length > 0 ? "CONTINUITY_GAP" : undefined);
    const stageReason: TemporalUnavailableReason | undefined = sharedReason ?? (stages.some((stage) => stage.validIntervalCount < MIN_STAGE_INTERVALS || stage.validWeight < MIN_STAGE_WEIGHT_S)
      ? "INSUFFICIENT_SAMPLES" : stages.some((stage) => stage.coverage < MIN_STAGE_COVERAGE)
      ? "INSUFFICIENT_COVERAGE" : undefined);
    const unavailable = [...new Set([sourceReason, !stats && !sourceReason ? axisIncomplete ? "AXIS_INCOMPLETE" : allZero ? "ALL_ZERO_SERIES" : unlocatedStopTimeS > 0 ? "UNLOCATED_STOP_TIME" : "INSUFFICIENT_SAMPLES" : undefined,
      stabilityReason, stageReason].filter((reason): reason is TemporalUnavailableReason => reason !== undefined))];
    return {
      seriesKey, unit: definition.unit, weightUnit: axis === "distance" ? "m" : "s", eligibleWeight: denominator, validWeight, coverage,
      validIntervalCount, ...(stats ? { statistics: stats } : {}), stages, stability: gate(stabilityReason),
      stageComparison: { ...gate(stageReason), ...(!stageReason ? { lastMinusFirst: stages[2]!.mean! - stages[0]!.mean! } : {}) },
      unavailable, evidenceIds: [`evidence:${record.activity.rideId}:series:${seriesKey}`], formulaVersion: RIDE_TEMPORAL_RULES_VERSION,
    };
  });
  return { rideId: record.activity.rideId, rulesVersion: RIDE_TEMPORAL_RULES_VERSION, axis, span, axisIncomplete,
    gaps, longestGapS: Math.max(0, ...gaps.map((gap) => gap.durationS)), stops, unlocatedStopTimeS, series };
}
