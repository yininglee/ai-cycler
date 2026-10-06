import type { RideEventClimbSummary } from "./ride-event-climbs.ts";
import type { RideRouteShapeSummary, RideRouteType } from "./ride-route-shape.ts";
import type { RideRecord, RideSeriesPoint } from "./ride-schema.ts";
import { buildRideTemporalFeaturesV2 } from "./ride-temporal-features-v2.ts";
import { buildRideTimingSummary, type RideTimingSummary } from "./ride-timing.ts";

// S2-03 (PD-AI-16): version upgraded together with the claims layer so the
// aggregation rule change is traceable across S1 window snapshots and S2 claims.
// S2-05 (user decision 2026-10-06, option B): climb representative selection
// (V1 precedent) added; segments no longer emit per-segment joint windows —
// cross-sensor pairing evidence is the fixed-window aggregate only.
export const RIDE_TEMPORAL_WINDOWS_RULES_VERSION = "ride-temporal-windows-v2.5" as const;

const MAX_INTERVAL_S = 10;
const MOVING_SPEED_MPS = 1 / 3.6;
const JOINT_WINDOW_S = 30;
const MIN_SHARED_S = 20;
const MIN_SHARED_INTERVALS = 2;
const MIN_COVERAGE = 0.7;
const PEAK_WINDOWS_S = [10, 20, 30] as const;

type Sensor = "speed" | "heart_rate" | "power" | "cadence";
type Pair = readonly [Sensor, Sensor];
export type WindowUnavailableReason = "TIME_AXIS_REQUIRED" | "AXIS_INCOMPLETE" | "RECORD_INVALID"
  | "UNLOCATED_STOP_TIME" | "SOURCE_UNAVAILABLE" | "BOUNDARY_UNAVAILABLE"
  | "INSUFFICIENT_CONTINUOUS_DATA" | "NO_COMMON_WINDOW";

const FIELDS = {
  speed: "speedMps", heart_rate: "heartRateBpm", power: "powerW", cadence: "cadenceRpm",
} as const satisfies Record<Sensor, keyof RideSeriesPoint>;

const PAIRS: Pair[] = [
  ["power", "heart_rate"], ["power", "speed"], ["power", "cadence"], ["speed", "heart_rate"],
];

interface Interval {
  start: number;
  end: number;
  index: number;
  values: Partial<Record<Sensor, number>>;
}

export interface JointWindowV2 {
  seriesKeys: Pair;
  startElapsedTimeS: number;
  endElapsedTimeS: number;
  eligibleTimeS: number;
  sharedTimeS: number;
  commonCoverage: number;
  sharedIntervalCount: number;
  means: Partial<Record<Sensor, number>>;
  evidenceIds: string[];
  rulesVersion: typeof RIDE_TEMPORAL_WINDOWS_RULES_VERSION;
  // Paired means permit same-window description, never causation or an inferred trend.
  expressionBoundary: "same_window_observation_only";
}

export interface SegmentWindowV2 {
  id: string;
  kind: "climb" | "cruise" | "terrain";
  sourceRulesVersion: string;
  startElapsedTimeS?: number;
  endElapsedTimeS?: number;
  startDistanceM?: number;
  endDistanceM?: number;
  unavailableReason?: WindowUnavailableReason;
  // S2-05: climb segments carry the deterministic climb facts the detail page
  // shows (category, distance, net gain, average grade, difficulty) so the
  // claims layer can expose them as model-citable evidence.
  climbFacts?: {
    category: string;
    distanceM: number;
    netElevationGainM: number;
    averageGrade: number;
    difficultyScore: number;
  };
  // S2-05: adjacent terrain segments of the same type are merged into one
  // window; the merged count is disclosed here and in the claim text.
  mergedFromCount?: number;
  sensorMeans: Partial<Record<Sensor, { mean: number; coverage: number; validIntervalCount: number }>>;
  evidenceIds: string[];
}

// S2-05: aggregate terrain distances from the route-shape summary, surfaced on
// the windows result so the claims layer can emit them as evidence.
export interface TerrainDistanceSummaryV2 {
  rulesVersion: string;
  climbDistanceM: number;
  flatDistanceM: number;
  descentDistanceM: number;
  trendClimbDistanceM: number;
  trendFlatDistanceM: number;
  trendDescentDistanceM: number;
  coverageRatio: number;
  // Merged terrain run counts per type and how many representative windows
  // are kept (PD-AI-16-style bounded representative selection).
  segmentCounts: { climb: number; flat: number; descent: number };
  representativeCounts: { climb: number; flat: number; descent: number };
  evidenceIds: string[];
}

export interface PowerPeakV2 {
  durationS: typeof PEAK_WINDOWS_S[number];
  startElapsedTimeS?: number;
  endElapsedTimeS?: number;
  meanPowerW?: number;
  unavailableReason?: WindowUnavailableReason;
  evidenceIds: string[];
  rulesVersion: typeof RIDE_TEMPORAL_WINDOWS_RULES_VERSION;
}

export interface RideTemporalWindowsV2 {
  rideId: string;
  rulesVersion: typeof RIDE_TEMPORAL_WINDOWS_RULES_VERSION;
  unavailableReason?: WindowUnavailableReason;
  powerPeaks: PowerPeakV2[];
  segments: SegmentWindowV2[];
  jointWindows: JointWindowV2[];
  pairAvailability: Array<{ seriesKeys: Pair; eligible: boolean; reason?: WindowUnavailableReason }>;
  // S2-05: aggregate terrain distances (climb/flat/descent) from the
  // route-shape summary when the caller provides one.
  terrainDistances?: TerrainDistanceSummaryV2;
  // S2-05: how many event climbs existed and how many representative climb
  // segments were kept (PD-AI-16-style bounded selection, V1 precedent).
  climbRepresentativeCounts?: { totalClimbs: number; representativeClimbs: number };
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function overlap(start: number, end: number, otherStart: number, otherEnd: number): number {
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}

function availableSensors(record: RideRecord, unavailable: Record<Sensor, string[]>): Sensor[] {
  return (Object.keys(FIELDS) as Sensor[]).filter((sensor) => {
    const metadata = record.series.seriesMetadata[sensor];
    return record.series.availableSeries.includes(sensor) && metadata?.qualityStatus === "valid"
      && !unavailable[sensor].some((reason) => ["RECORD_INVALID", "SERIES_MISSING", "QUALITY_INSUFFICIENT", "ALL_ZERO_SERIES"].includes(reason));
  });
}

function intervalsFor(record: RideRecord, timing: RideTimingSummary, sensors: Sensor[]): Interval[] {
  const points = record.series.points;
  const intervals: Interval[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const start = previous.elapsedTimeS;
    const end = point.elapsedTimeS;
    if (!finite(start) || !finite(end) || end <= start || end - start > MAX_INTERVAL_S) continue;
    if (timing.stops.some((stop) => overlap(start, end, stop.startElapsedTimeS, stop.endElapsedTimeS) > 0)) continue;
    const distance = finite(previous.distanceM) && finite(point.distanceM) ? point.distanceM - previous.distanceM : undefined;
    const speed = finite(distance) ? distance / (end - start) : point.speedMps;
    if (!finite(speed) || speed < MOVING_SPEED_MPS) continue;
    const values: Partial<Record<Sensor, number>> = {};
    for (const sensor of sensors) {
      const value = point[FIELDS[sensor]];
      if (finite(value)) values[sensor] = value;
    }
    intervals.push({ start, end, index, values });
  }
  return intervals;
}

function eligibleTime(start: number, end: number, timing: RideTimingSummary): number {
  return Math.max(0, end - start - timing.stops.reduce((sum, stop) =>
    sum + overlap(start, end, stop.startElapsedTimeS, stop.endElapsedTimeS), 0));
}

function jointFor(
  record: RideRecord, pair: Pair, start: number, end: number, intervals: Interval[],
  timing: RideTimingSummary,
): JointWindowV2 | undefined {
  const eligible = eligibleTime(start, end, timing);
  if (eligible < MIN_SHARED_S) return undefined;
  let shared = 0;
  let first = 0;
  let second = 0;
  const indexes = new Set<number>();
  for (const interval of intervals) {
    const weight = overlap(start, end, interval.start, interval.end);
    const a = interval.values[pair[0]];
    const b = interval.values[pair[1]];
    if (weight <= 0 || !finite(a) || !finite(b)) continue;
    shared += weight;
    first += a * weight;
    second += b * weight;
    indexes.add(interval.index);
  }
  if (shared < MIN_SHARED_S || indexes.size < MIN_SHARED_INTERVALS || shared / eligible < MIN_COVERAGE) return undefined;
  return {
    seriesKeys: pair, startElapsedTimeS: start, endElapsedTimeS: end,
    eligibleTimeS: eligible, sharedTimeS: shared, commonCoverage: shared / eligible,
    sharedIntervalCount: indexes.size, means: { [pair[0]]: first / shared, [pair[1]]: second / shared },
    evidenceIds: pair.map((sensor) => `evidence:${record.activity.rideId}:series:${sensor}`),
    rulesVersion: RIDE_TEMPORAL_WINDOWS_RULES_VERSION, expressionBoundary: "same_window_observation_only",
  };
}

function powerPeak(record: RideRecord, durationS: PowerPeakV2["durationS"], intervals: Interval[], powerAvailable: boolean): PowerPeakV2 {
  const evidenceIds = [`evidence:${record.activity.rideId}:series:power`];
  if (!powerAvailable) return { durationS, unavailableReason: "SOURCE_UNAVAILABLE", evidenceIds, rulesVersion: RIDE_TEMPORAL_WINDOWS_RULES_VERSION };
  const power = intervals.filter((item) => finite(item.values.power));
  let best: { start: number; end: number; mean: number } | undefined;
  let run: Interval[] = [];
  const checkRun = () => {
    if (run.length === 0) return;
    const first = run[0]!.start;
    const last = run.at(-1)!.end;
    if (last - first < durationS) return;
    const prefix = [0];
    for (const item of run) prefix.push(prefix.at(-1)! + (item.end - item.start) * item.values.power!);
    const integralAt = (time: number): number => {
      let low = 0;
      let high = run.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (run[middle]!.end <= time) low = middle + 1;
        else high = middle;
      }
      return low === run.length ? prefix[low]! : prefix[low]! + (time - run[low]!.start) * run[low]!.values.power!;
    };
    const candidates = new Set([...run.flatMap((item) => [item.end, item.start + durationS])]);
    for (const end of candidates) {
      const start = end - durationS;
      if (start < first || end > last) continue;
      const mean = (integralAt(end) - integralAt(start)) / durationS;
      if (!best || mean > best.mean) best = { start, end, mean };
    }
  };
  for (const interval of power) {
    if (run.length && interval.start !== run.at(-1)!.end) {
      checkRun();
      run = [];
    }
    run.push(interval);
  }
  checkRun();
  return best
    ? { durationS, startElapsedTimeS: best.start, endElapsedTimeS: best.end, meanPowerW: best.mean,
      evidenceIds, rulesVersion: RIDE_TEMPORAL_WINDOWS_RULES_VERSION }
    : { durationS, unavailableReason: "INSUFFICIENT_CONTINUOUS_DATA", evidenceIds, rulesVersion: RIDE_TEMPORAL_WINDOWS_RULES_VERSION };
}

function timeAtDistance(points: RideSeriesPoint[], distanceM: number): number | undefined {
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (point.distanceM === distanceM && finite(point.elapsedTimeS)) return point.elapsedTimeS;
    if (index === 0) continue;
    const previous = points[index - 1]!;
    if (!finite(previous.distanceM) || !finite(point.distanceM) || !finite(previous.elapsedTimeS)
      || !finite(point.elapsedTimeS) || point.distanceM <= previous.distanceM || point.elapsedTimeS - previous.elapsedTimeS > MAX_INTERVAL_S
      || distanceM <= previous.distanceM || distanceM >= point.distanceM) continue;
    return previous.elapsedTimeS + (point.elapsedTimeS - previous.elapsedTimeS)
      * (distanceM - previous.distanceM) / (point.distanceM - previous.distanceM);
  }
  return undefined;
}

export function buildRideTemporalWindowsV2(
  record: RideRecord,
  sources: { timing?: RideTimingSummary; climbs?: RideEventClimbSummary; routeShape?: RideRouteShapeSummary } = {},
): RideTemporalWindowsV2 {
  const temporal = buildRideTemporalFeaturesV2(record);
  const unavailableReason: WindowUnavailableReason | undefined = temporal.series.some((item) => item.unavailable.includes("RECORD_INVALID"))
    ? "RECORD_INVALID" : temporal.axis !== "time" ? "TIME_AXIS_REQUIRED"
      : temporal.axisIncomplete ? "AXIS_INCOMPLETE" : !temporal.unlocatedStopTolerated ? "UNLOCATED_STOP_TIME" : undefined;
  const unavailable = Object.fromEntries(temporal.series.map((item) => [item.seriesKey, item.unavailable])) as Record<Sensor, string[]>;
  const sensors = unavailableReason ? [] : availableSensors(record, unavailable);
  const timing = sources.timing ?? buildRideTimingSummary(record);
  const intervals = unavailableReason ? [] : intervalsFor(record, timing, sensors);
  const points = record.series.points;
  const firstTime = points[0]?.elapsedTimeS;
  const lastTime = points.at(-1)?.elapsedTimeS;
  const peakWindows: PowerPeakV2[] = PEAK_WINDOWS_S.map((duration) => unavailableReason
    ? { durationS: duration, unavailableReason, evidenceIds: [`evidence:${record.activity.rideId}:series:power`], rulesVersion: RIDE_TEMPORAL_WINDOWS_RULES_VERSION }
    : powerPeak(record, duration, intervals, sensors.includes("power")));
  const segments: SegmentWindowV2[] = [];
  const addSegment = (segment: Omit<SegmentWindowV2, "sensorMeans" | "evidenceIds" | "unavailableReason">) => {
    const start = segment.startElapsedTimeS;
    const end = segment.endElapsedTimeS;
    const reason = unavailableReason ?? (!finite(start) || !finite(end) || !finite(firstTime) || !finite(lastTime)
      || start < firstTime || end > lastTime || end <= start ? "BOUNDARY_UNAVAILABLE" : undefined);
    const sensorMeans: SegmentWindowV2["sensorMeans"] = {};
    if (!reason) {
      const eligible = eligibleTime(start!, end!, timing);
      for (const sensor of sensors) {
        let weight = 0;
        let sum = 0;
        const indexes = new Set<number>();
        for (const interval of intervals) {
          const value = interval.values[sensor];
          const part = overlap(start!, end!, interval.start, interval.end);
          if (part <= 0 || !finite(value)) continue;
          weight += part;
          sum += value * part;
          indexes.add(interval.index);
        }
        if (eligible >= MIN_SHARED_S && weight >= MIN_SHARED_S && indexes.size >= MIN_SHARED_INTERVALS
          && weight / eligible >= MIN_COVERAGE) {
          sensorMeans[sensor] = { mean: sum / weight, coverage: weight / eligible, validIntervalCount: indexes.size };
        }
      }
    }
    segments.push({ ...segment, ...(reason ? { unavailableReason: reason } : {}), sensorMeans,
      evidenceIds: [`evidence:${record.activity.rideId}:segment:${segment.id}`] });
  };
  // S2-05: keep at most CLIMB_REPRESENTATIVES representative climbs (V1
  // precedent, ride-advanced-claims.ts representativeClimbs: category rank ->
  // difficulty -> distance) so long rides with many climbs do not explode the
  // claim budget. Dropped climbs stay disclosed via climbRepresentativeCounts
  // and the aggregate climb-distance claims on terrainDistances.
  const CLIMB_REPRESENTATIVES = 3;
  const allClimbs = sources.climbs?.isAvailable ? sources.climbs.climbs : [];
  const categoryRank: Record<string, number> = { HC: 5, "1": 4, "2": 3, "3": 2, "4": 1 };
  const representativeClimbs = [...allClimbs]
    .sort((left, right) => (categoryRank[right.category] ?? 0) - (categoryRank[left.category] ?? 0)
      || right.difficultyScore - left.difficultyScore || right.distanceM - left.distanceM)
    .slice(0, CLIMB_REPRESENTATIVES)
    .sort((left, right) => left.startDistanceM - right.startDistanceM);
  for (const climb of representativeClimbs) {
    addSegment({ id: climb.id, kind: "climb", sourceRulesVersion: climb.rulesVersion,
      startDistanceM: climb.startDistanceM, endDistanceM: climb.endDistanceM,
      startElapsedTimeS: timeAtDistance(points, climb.startDistanceM),
      endElapsedTimeS: timeAtDistance(points, climb.endDistanceM),
      climbFacts: {
        category: climb.category,
        distanceM: climb.distanceM,
        netElevationGainM: climb.netElevationGainM,
        averageGrade: climb.averageGrade,
        difficultyScore: climb.difficultyScore,
      } });
  }
  timing.cruiseSegments.forEach((cruise, index) => addSegment({ id: `cruise-${index}-${cruise.startElapsedTimeS}`,
    kind: "cruise", sourceRulesVersion: timing.rulesVersion,
    startElapsedTimeS: cruise.startElapsedTimeS, endElapsedTimeS: cruise.endElapsedTimeS,
    startDistanceM: cruise.startDistanceM, endDistanceM: cruise.endDistanceM }));
  // S2-05: merge adjacent same-type terrain trend segments into runs, then keep
  // at most TERRAIN_REPRESENTATIVES_PER_TYPE runs per type (longest first,
  // PD-AI-16-style bounded representative selection) so long rides do not
  // explode into dozens of terrain windows. Dropped runs stay disclosed via
  // the per-type counts on terrainDistances and the aggregate distance claims.
  const TERRAIN_REPRESENTATIVES_PER_TYPE = 3;
  const mergedTerrain: Array<{ type: RideRouteType; startDistanceM: number; endDistanceM: number; mergedFromCount: number }> = [];
  for (const terrain of sources.routeShape?.isAvailable ? sources.routeShape.trendSegments : []) {
    const previous = mergedTerrain.at(-1);
    if (previous && previous.type === terrain.type && previous.endDistanceM === terrain.startDistanceM) {
      previous.endDistanceM = terrain.endDistanceM;
      previous.mergedFromCount += 1;
    } else {
      mergedTerrain.push({ type: terrain.type, startDistanceM: terrain.startDistanceM,
        endDistanceM: terrain.endDistanceM, mergedFromCount: 1 });
    }
  }
  const terrainByType = new Map<RideRouteType, typeof mergedTerrain>();
  for (const run of mergedTerrain) terrainByType.set(run.type, [...(terrainByType.get(run.type) ?? []), run]);
  const selectedTerrain: typeof mergedTerrain = [];
  for (const runs of terrainByType.values()) {
    selectedTerrain.push(...[...runs]
      .sort((left, right) => (right.endDistanceM - right.startDistanceM) - (left.endDistanceM - left.startDistanceM))
      .slice(0, TERRAIN_REPRESENTATIVES_PER_TYPE));
  }
  selectedTerrain.sort((left, right) => left.startDistanceM - right.startDistanceM);
  for (const terrain of selectedTerrain) {
    addSegment({ id: `terrain-${terrain.type}-${terrain.startDistanceM}-${terrain.endDistanceM}`,
      kind: "terrain", sourceRulesVersion: sources.routeShape!.rulesVersion,
      startDistanceM: terrain.startDistanceM, endDistanceM: terrain.endDistanceM,
      startElapsedTimeS: timeAtDistance(points, terrain.startDistanceM),
      endElapsedTimeS: timeAtDistance(points, terrain.endDistanceM),
      ...(terrain.mergedFromCount > 1 ? { mergedFromCount: terrain.mergedFromCount } : {}) });
  }
  const jointWindows: JointWindowV2[] = [];
  if (!unavailableReason && finite(firstTime) && finite(lastTime)) {
    for (let start = firstTime; start + JOINT_WINDOW_S <= lastTime; start += JOINT_WINDOW_S) {
      for (const pair of PAIRS) {
        if (!pair.every((sensor) => sensors.includes(sensor))) continue;
        const joint = jointFor(record, pair, start, start + JOINT_WINDOW_S, intervals, timing);
        if (joint) jointWindows.push(joint);
      }
    }
  }
  const pairAvailability: RideTemporalWindowsV2["pairAvailability"] = PAIRS.map((pair) => {
    const eligible = jointWindows.some((joint) => joint.seriesKeys === pair);
    const reason: WindowUnavailableReason | undefined = eligible ? undefined
      : unavailableReason ?? (pair.every((sensor) => sensors.includes(sensor)) ? "NO_COMMON_WINDOW" : "SOURCE_UNAVAILABLE");
    return { seriesKeys: pair, eligible, ...(reason ? { reason } : {}) };
  });
  const terrainDistances: TerrainDistanceSummaryV2 | undefined = sources.routeShape?.isAvailable
    ? {
        rulesVersion: sources.routeShape.rulesVersion,
        climbDistanceM: sources.routeShape.climbDistanceM,
        flatDistanceM: sources.routeShape.flatDistanceM,
        descentDistanceM: sources.routeShape.descentDistanceM,
        trendClimbDistanceM: sources.routeShape.trendClimbDistanceM,
        trendFlatDistanceM: sources.routeShape.trendFlatDistanceM,
        trendDescentDistanceM: sources.routeShape.trendDescentDistanceM,
        coverageRatio: sources.routeShape.coverageRatio,
        segmentCounts: {
          climb: mergedTerrain.filter((run) => run.type === "climb").length,
          flat: mergedTerrain.filter((run) => run.type === "flat").length,
          descent: mergedTerrain.filter((run) => run.type === "descent").length,
        },
        representativeCounts: {
          climb: selectedTerrain.filter((run) => run.type === "climb").length,
          flat: selectedTerrain.filter((run) => run.type === "flat").length,
          descent: selectedTerrain.filter((run) => run.type === "descent").length,
        },
        evidenceIds: [`evidence:${record.activity.rideId}:route-shape:${sources.routeShape.rulesVersion}`],
      }
    : undefined;
  return { rideId: record.activity.rideId, rulesVersion: RIDE_TEMPORAL_WINDOWS_RULES_VERSION,
    ...(unavailableReason ? { unavailableReason } : {}), powerPeaks: peakWindows, segments, jointWindows, pairAvailability,
    ...(terrainDistances ? { terrainDistances } : {}),
    ...(allClimbs.length
      ? { climbRepresentativeCounts: { totalClimbs: allClimbs.length, representativeClimbs: representativeClimbs.length } }
      : {}) };
}
