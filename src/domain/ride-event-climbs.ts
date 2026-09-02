import type { RideElevationPoint, RideElevationSummary } from "./ride-elevation.ts";
import type { RideRouteShapeSegment, RideRouteShapeSummary } from "./ride-route-shape.ts";
import type { RideRecord, RideSeriesPoint } from "./ride-schema.ts";
import { buildRideTimingSummary } from "./ride-timing.ts";

export const RIDE_EVENT_CLIMB_RULES_VERSION = "ride-event-climb-rules-v0.2" as const;

const MIN_CANDIDATE_DISTANCE_M = 1_000;
const MIN_CANDIDATE_AVERAGE_GRADE = 0.013;
const MOVE_SPEED_MPS = 1 / 3.6;
// Keeps an exact decimal threshold from being crossed by binary floating-point noise.
const GRADE_COMPARISON_EPSILON = 1e-9;

export type RideEventClimbCategory = "HC" | "1" | "2" | "3" | "4";
export type RideEventClimbUnavailableReason =
  | "ELEVATION_SERIES_UNAVAILABLE"
  | "ROUTE_SHAPE_UNAVAILABLE"
  | "TIME_UNAVAILABLE"
  | "MOVING_SPEED_UNAVAILABLE";

export type RideEventClimbPowerQuality = "hard" | "soft";

export interface RideEventClimb {
  id: string;
  rulesVersion: typeof RIDE_EVENT_CLIMB_RULES_VERSION;
  elevationRulesVersion: string;
  routeShapeRulesVersion: string;
  category: RideEventClimbCategory;
  startDistanceM: number;
  endDistanceM: number;
  distanceM: number;
  netElevationGainM: number;
  averageGrade: number;
  difficultyScore: number;
  elapsedTimeS?: number;
  movingAverageSpeedMps?: number;
  averageHeartRateBpm?: number;
  averagePowerW?: number;
  powerQuality?: RideEventClimbPowerQuality;
  unavailableReasons: RideEventClimbUnavailableReason[];
}

export interface RideEventClimbSummary {
  rulesVersion: typeof RIDE_EVENT_CLIMB_RULES_VERSION;
  isAvailable: boolean;
  climbs: RideEventClimb[];
  unavailableReasons: RideEventClimbUnavailableReason[];
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function interpolateValue(
  points: RideElevationPoint[],
  distanceM: number,
  field: "elevationM" | "elapsedTimeS",
): number | undefined {
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    if (distanceM < before.distanceM || distanceM > after.distanceM) continue;
    const beforeValue = before[field];
    const afterValue = after[field];
    const spanM = after.distanceM - before.distanceM;
    if (!finite(beforeValue) || !finite(afterValue) || spanM <= 0) return undefined;
    const progress = (distanceM - before.distanceM) / spanM;
    return beforeValue + (afterValue - beforeValue) * progress;
  }
  return undefined;
}

function elevationSegmentFor(
  elevation: RideElevationSummary,
  climb: RideRouteShapeSegment,
): RideElevationPoint[] | undefined {
  return elevation.smoothedSegments.find((points) => points.length >= 2
    && climb.startDistanceM >= points[0]!.distanceM
    && climb.endDistanceM <= points.at(-1)!.distanceM);
}

function movingAverageSpeed(
  points: RideElevationPoint[],
  startDistanceM: number,
  endDistanceM: number,
): number | undefined {
  let movingDistanceM = 0;
  let movingTimeS = 0;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    if (before.distanceM < startDistanceM || after.distanceM > endDistanceM) continue;
    const distanceM = after.distanceM - before.distanceM;
    const elapsedTimeS = finite(before.elapsedTimeS) && finite(after.elapsedTimeS)
      ? after.elapsedTimeS - before.elapsedTimeS
      : undefined;
    const inferredSpeedMps = elapsedTimeS && elapsedTimeS > 0 ? distanceM / elapsedTimeS : undefined;
    const speedMps = finite(after.speedMps) ? after.speedMps : inferredSpeedMps;
    if (distanceM <= 0 || !finite(speedMps) || speedMps < MOVE_SPEED_MPS) continue;
    movingDistanceM += distanceM;
    movingTimeS += elapsedTimeS && elapsedTimeS > 0 ? elapsedTimeS : distanceM / speedMps;
  }
  return movingDistanceM > 0 && movingTimeS > 0 ? movingDistanceM / movingTimeS : undefined;
}

function intervalStopped(
  previous: RideSeriesPoint,
  current: RideSeriesPoint,
  startS: number,
  endS: number,
  stops: ReturnType<typeof buildRideTimingSummary>["stops"],
): boolean {
  if (stops.some((stop) => startS >= stop.startElapsedTimeS && endS <= stop.endElapsedTimeS)) return true;
  const speedMps = finite(current.speedMps) ? current.speedMps : previous.speedMps;
  return finite(speedMps) && speedMps < MOVE_SPEED_MPS;
}

function segmentSensorAverage(
  record: RideRecord,
  startDistanceM: number,
  endDistanceM: number,
  field: "heartRateBpm" | "powerW",
): { average: number; coverage: number } | undefined {
  const quality = record.activity.sensorQuality[field === "heartRateBpm" ? "heart_rate" : "power"];
  if (!quality || quality.sampleCount <= 0) return undefined;
  const timing = buildRideTimingSummary(record);
  const points = record.series.points;
  let validDurationS = 0;
  let movingDurationS = 0;
  let weightedValue = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (!finite(previous.elapsedTimeS) || !finite(current.elapsedTimeS)
      || !finite(previous.distanceM) || !finite(current.distanceM)) continue;
    if (previous.distanceM < startDistanceM || current.distanceM > endDistanceM) continue;
    const durationS = current.elapsedTimeS - previous.elapsedTimeS;
    const distanceM = current.distanceM - previous.distanceM;
    if (durationS <= 0 || durationS > 10 || distanceM < 0) continue;
    if (intervalStopped(previous, current, previous.elapsedTimeS, current.elapsedTimeS, timing.stops)) continue;
    movingDurationS += durationS;
    const value = previous[field];
    if (!finite(value) || (field === "heartRateBpm" ? value < 30 || value > 260 : value < 0 || value > 3_000)) continue;
    validDurationS += durationS;
    weightedValue += value * durationS;
  }
  if (movingDurationS <= 0 || validDurationS / movingDurationS < (field === "heartRateBpm" ? 0.7 : 0.8)) return undefined;
  return { average: weightedValue / validDurationS, coverage: validDurationS / movingDurationS };
}

function categoryFor(score: number): RideEventClimbCategory {
  if (score >= 600) return "HC";
  if (score >= 300) return "1";
  if (score >= 150) return "2";
  if (score >= 75) return "3";
  return "4";
}

function buildClimb(
  segment: RideRouteShapeSegment,
  elevation: RideElevationSummary,
  routeShape: RideRouteShapeSummary,
  record?: RideRecord,
): RideEventClimb | undefined {
  if (segment.type !== "climb" || segment.distanceM <= MIN_CANDIDATE_DISTANCE_M) return undefined;
  const elevationSegment = elevationSegmentFor(elevation, segment);
  if (!elevationSegment) return undefined;

  const startElevationM = interpolateValue(elevationSegment, segment.startDistanceM, "elevationM");
  const endElevationM = interpolateValue(elevationSegment, segment.endDistanceM, "elevationM");
  if (!finite(startElevationM) || !finite(endElevationM)) return undefined;
  const netElevationGainM = endElevationM - startElevationM;
  const averageGrade = netElevationGainM / segment.distanceM;
  if (averageGrade <= MIN_CANDIDATE_AVERAGE_GRADE + GRADE_COMPARISON_EPSILON) return undefined;

  const startElapsedTimeS = interpolateValue(elevationSegment, segment.startDistanceM, "elapsedTimeS");
  const endElapsedTimeS = interpolateValue(elevationSegment, segment.endDistanceM, "elapsedTimeS");
  const elapsedTimeS = finite(startElapsedTimeS) && finite(endElapsedTimeS) && endElapsedTimeS > startElapsedTimeS
    ? endElapsedTimeS - startElapsedTimeS
    : undefined;
  const movingAverageSpeedMps = movingAverageSpeed(elevationSegment, segment.startDistanceM, segment.endDistanceM);
  const unavailableReasons: RideEventClimbUnavailableReason[] = [
    ...(elapsedTimeS === undefined ? ["TIME_UNAVAILABLE" as const] : []),
    ...(movingAverageSpeedMps === undefined ? ["MOVING_SPEED_UNAVAILABLE" as const] : []),
  ];
  const distanceKm = segment.distanceM / 1_000;
  const averageGradePercent = averageGrade * 100;
  const difficultyScore = distanceKm * averageGradePercent ** 2;
  const heartRate = record ? segmentSensorAverage(record, segment.startDistanceM, segment.endDistanceM, "heartRateBpm") : undefined;
  const power = record ? segmentSensorAverage(record, segment.startDistanceM, segment.endDistanceM, "powerW") : undefined;
  const powerCoverage = record?.activity.sensorQuality.power?.coverage;

  return {
    id: `event-climb-${Math.round(segment.startDistanceM)}-${Math.round(segment.endDistanceM)}`,
    rulesVersion: RIDE_EVENT_CLIMB_RULES_VERSION,
    elevationRulesVersion: elevation.rulesVersion,
    routeShapeRulesVersion: routeShape.rulesVersion,
    category: categoryFor(difficultyScore),
    startDistanceM: segment.startDistanceM,
    endDistanceM: segment.endDistanceM,
    distanceM: segment.distanceM,
    netElevationGainM,
    averageGrade,
    difficultyScore,
    ...(elapsedTimeS !== undefined ? { elapsedTimeS } : {}),
    ...(movingAverageSpeedMps !== undefined ? { movingAverageSpeedMps } : {}),
    ...(heartRate ? { averageHeartRateBpm: heartRate.average } : {}),
    ...(power ? {
      averagePowerW: power.average,
      ...(powerCoverage !== undefined && powerCoverage < 0.9 ? { powerQuality: "soft" as const } : { powerQuality: "hard" as const }),
    } : {}),
    unavailableReasons,
  };
}

export function buildRideEventClimbSummary(
  elevation: RideElevationSummary,
  routeShape: RideRouteShapeSummary,
  record?: RideRecord,
): RideEventClimbSummary {
  const unavailableReasons: RideEventClimbUnavailableReason[] = [
    ...(elevation.smoothedSegments.length === 0 ? ["ELEVATION_SERIES_UNAVAILABLE" as const] : []),
    ...(!routeShape.isAvailable ? ["ROUTE_SHAPE_UNAVAILABLE" as const] : []),
  ];
  if (unavailableReasons.length > 0) {
    return { rulesVersion: RIDE_EVENT_CLIMB_RULES_VERSION, isAvailable: false, climbs: [], unavailableReasons };
  }
  // Event climbs consume the long-trend terrain runs. Fall back to the legacy
  // local runs for callers constructing an older summary in tests or caches.
  const candidateSegments = routeShape.trendSegments ?? routeShape.segments;
  const climbs = candidateSegments.flatMap((segment) => {
    const climb = buildClimb(segment, elevation, routeShape, record);
    return climb ? [climb] : [];
  });
  return {
    rulesVersion: RIDE_EVENT_CLIMB_RULES_VERSION,
    isAvailable: true,
    climbs,
    unavailableReasons,
  };
}
