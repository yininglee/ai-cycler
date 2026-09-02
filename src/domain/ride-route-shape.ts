import type { RideElevationPoint, RideElevationSummary } from "./ride-elevation.ts";

export const RIDE_ROUTE_SHAPE_RULES_VERSION = "ride-route-shape-rules-v0.2" as const;

const CLASSIFICATION_HALF_GRADE_WINDOW_M = 50;
const CLASSIFICATION_MIN_GRADE_WINDOW_M = 60;
const DISPLAY_HALF_GRADE_WINDOW_M = 125;
const DISPLAY_MIN_GRADE_WINDOW_M = 150;
const MOVE_SPEED_MPS = 1 / 3.6;
const CLIMB_ENTER_GRADE = 0.03;
const CLIMB_EXIT_GRADE = 0.02;
const DESCENT_ENTER_GRADE = -0.03;
const DESCENT_EXIT_GRADE = -0.02;
const SHORT_SEGMENT_M = 100;
const MIN_COVERAGE_RATIO = 0.8;
const FULL_COVERAGE_RATIO = 0.95;
// Long-trend terrain is intentionally separate from the local grade used by the chart.
// A 500m centered window keeps gentle ramps and short rollbacks in one route phase.
const TREND_HALF_GRADE_WINDOW_M = 250;
// Endpoints may only have a one-sided window; 200m keeps short valid rides
// classifiable while the 500m centered trend remains the dominant signal.
const TREND_MIN_GRADE_WINDOW_M = 200;
const TREND_CLIMB_ENTER_GRADE = 0.01;
const TREND_CLIMB_EXIT_GRADE = 0.005;
const TREND_DESCENT_ENTER_GRADE = -0.01;
const TREND_DESCENT_EXIT_GRADE = -0.005;
const TREND_SHORT_SEGMENT_M = 300;

export type RideRouteType = "climb" | "flat" | "descent";

export interface RideRouteShapePoint {
  distanceM: number;
  grade: number;
}

export interface RideRouteShapeSegment {
  type: RideRouteType;
  startDistanceM: number;
  endDistanceM: number;
  distanceM: number;
}

export interface RideRouteShapeSummary {
  rulesVersion: typeof RIDE_ROUTE_SHAPE_RULES_VERSION;
  isAvailable: boolean;
  // 100m centered window for terrain classification and distance totals.
  gradeSegments: RideRouteShapePoint[][];
  // 250m centered window for the user-facing grade chart and range labels.
  displayGradeSegments: RideRouteShapePoint[][];
  // Long trend runs used for terrain mileage and event-climb candidates.
  trendSegments: RideRouteShapeSegment[];
  segments: RideRouteShapeSegment[];
  movingDistanceM: number;
  classifiedDistanceM: number;
  climbDistanceM: number;
  flatDistanceM: number;
  descentDistanceM: number;
  trendClimbDistanceM: number;
  trendFlatDistanceM: number;
  trendDescentDistanceM: number;
  trendClassifiedDistanceM: number;
  coverageRatio: number;
  needsCoverageNotice: boolean;
}

interface ClassifiedInterval {
  type: RideRouteType;
  startDistanceM: number;
  endDistanceM: number;
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function interpolateElevation(points: RideElevationPoint[], distanceM: number): number | undefined {
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    if (distanceM < before.distanceM || distanceM > after.distanceM) continue;
    const spanM = after.distanceM - before.distanceM;
    if (spanM <= 0) return undefined;
    const progress = (distanceM - before.distanceM) / spanM;
    return before.elevationM + (after.elevationM - before.elevationM) * progress;
  }
  return undefined;
}

function gradeAt(
  points: RideElevationPoint[],
  distanceM: number,
  halfWindowM: number,
  minWindowM: number,
): number | undefined {
  const startDistanceM = Math.max(points[0]!.distanceM, distanceM - halfWindowM);
  const endDistanceM = Math.min(points.at(-1)!.distanceM, distanceM + halfWindowM);
  const windowM = endDistanceM - startDistanceM;
  if (windowM < minWindowM) return undefined;
  const startElevationM = interpolateElevation(points, startDistanceM);
  const endElevationM = interpolateElevation(points, endDistanceM);
  return startElevationM === undefined || endElevationM === undefined ? undefined : (endElevationM - startElevationM) / windowM;
}

function gradePoints(points: RideElevationPoint[], halfWindowM: number, minWindowM: number): RideRouteShapePoint[] {
  return points.flatMap((point) => {
    const grade = gradeAt(points, point.distanceM, halfWindowM, minWindowM);
    return grade === undefined ? [] : [{ distanceM: point.distanceM, grade }];
  });
}

function intervalIsMoving(before: RideElevationPoint, after: RideElevationPoint): boolean {
  const distanceM = after.distanceM - before.distanceM;
  if (distanceM <= 0) return false;
  const speedMps = finite(after.speedMps)
    ? after.speedMps
    : finite(before.elapsedTimeS) && finite(after.elapsedTimeS) && after.elapsedTimeS > before.elapsedTimeS
      ? distanceM / (after.elapsedTimeS - before.elapsedTimeS)
      : undefined;
  return speedMps !== undefined && speedMps >= MOVE_SPEED_MPS;
}

function nextType(
  current: RideRouteType | undefined,
  grade: number,
  rules: {
    climbEnter: number;
    climbExit: number;
    descentEnter: number;
    descentExit: number;
  } = {
    climbEnter: CLIMB_ENTER_GRADE,
    climbExit: CLIMB_EXIT_GRADE,
    descentEnter: DESCENT_ENTER_GRADE,
    descentExit: DESCENT_EXIT_GRADE,
  },
): RideRouteType {
  if (current === "climb") return grade < rules.climbExit ? (grade <= rules.descentEnter ? "descent" : "flat") : "climb";
  if (current === "descent") return grade > rules.descentExit ? (grade >= rules.climbEnter ? "climb" : "flat") : "descent";
  if (grade >= rules.climbEnter) return "climb";
  if (grade <= rules.descentEnter) return "descent";
  return "flat";
}

function buildIntervals(
  points: RideElevationPoint[],
  options: {
    halfWindowM: number;
    minWindowM: number;
    shortSegmentM: number;
    rules: Parameters<typeof nextType>[2];
  },
): { intervals: ClassifiedInterval[]; movingDistanceM: number } {
  const intervals: ClassifiedInterval[] = [];
  let movingDistanceM = 0;
  let currentType: RideRouteType | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1]!;
    const after = points[index]!;
    if (!intervalIsMoving(before, after)) continue;
    movingDistanceM += after.distanceM - before.distanceM;
    const grade = gradeAt(points, (before.distanceM + after.distanceM) / 2, options.halfWindowM, options.minWindowM);
    if (grade === undefined) continue;
    currentType = nextType(currentType, grade, options.rules);
    intervals.push({ type: currentType, startDistanceM: before.distanceM, endDistanceM: after.distanceM });
  }
  return { intervals, movingDistanceM };
}

function mergeAdjacent(intervals: ClassifiedInterval[]): RideRouteShapeSegment[] {
  const merged: RideRouteShapeSegment[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && previous.type === interval.type && previous.endDistanceM === interval.startDistanceM) {
      previous.endDistanceM = interval.endDistanceM;
      previous.distanceM = previous.endDistanceM - previous.startDistanceM;
      continue;
    }
    merged.push({
      type: interval.type,
      startDistanceM: interval.startDistanceM,
      endDistanceM: interval.endDistanceM,
      distanceM: interval.endDistanceM - interval.startDistanceM,
    });
  }
  return merged;
}

function mergeShortSandwiches(segments: RideRouteShapeSegment[], shortSegmentM = SHORT_SEGMENT_M): RideRouteShapeSegment[] {
  const result = segments.map((segment) => ({ ...segment }));
  for (let index = 1; index < result.length - 1; index += 1) {
    const previous = result[index - 1]!;
    const current = result[index]!;
    const next = result[index + 1]!;
    if (current.distanceM >= shortSegmentM || previous.type !== next.type) continue;
    previous.endDistanceM = next.endDistanceM;
    previous.distanceM = previous.endDistanceM - previous.startDistanceM;
    result.splice(index, 2);
    index = Math.max(0, index - 2);
  }
  return mergeAdjacent(result.map((segment) => ({
    type: segment.type,
    startDistanceM: segment.startDistanceM,
    endDistanceM: segment.endDistanceM,
  })));
}

export function buildRideRouteShapeSummary(elevation: RideElevationSummary): RideRouteShapeSummary {
  const segmentGroups: RideRouteShapeSegment[][] = [];
  const trendSegmentGroups: RideRouteShapeSegment[][] = [];
  let movingDistanceM = 0;
  for (const points of elevation.smoothedSegments) {
    const result = buildIntervals(points, {
      halfWindowM: CLASSIFICATION_HALF_GRADE_WINDOW_M,
      minWindowM: CLASSIFICATION_MIN_GRADE_WINDOW_M,
      shortSegmentM: SHORT_SEGMENT_M,
      rules: {
        climbEnter: CLIMB_ENTER_GRADE,
        climbExit: CLIMB_EXIT_GRADE,
        descentEnter: DESCENT_ENTER_GRADE,
        descentExit: DESCENT_EXIT_GRADE,
      },
    });
    const trendResult = buildIntervals(points, {
      halfWindowM: TREND_HALF_GRADE_WINDOW_M,
      minWindowM: TREND_MIN_GRADE_WINDOW_M,
      shortSegmentM: TREND_SHORT_SEGMENT_M,
      rules: {
        climbEnter: TREND_CLIMB_ENTER_GRADE,
        climbExit: TREND_CLIMB_EXIT_GRADE,
        descentEnter: TREND_DESCENT_ENTER_GRADE,
        descentExit: TREND_DESCENT_EXIT_GRADE,
      },
    });
    // A smoothed segment boundary represents an unreliable gap or distance reversal.
    // Keep its terrain runs separate even if the adjacent distances happen to meet.
    segmentGroups.push(mergeShortSandwiches(mergeAdjacent(result.intervals)));
    trendSegmentGroups.push(mergeShortSandwiches(mergeAdjacent(trendResult.intervals), TREND_SHORT_SEGMENT_M));
    movingDistanceM += result.movingDistanceM;
  }
  const segments = segmentGroups.flat();
  const trendSegments = trendSegmentGroups.flat();
  const classifiedDistanceM = segments.reduce((sum, segment) => sum + segment.distanceM, 0);
  const distanceFor = (type: RideRouteType) => segments.filter((segment) => segment.type === type).reduce((sum, segment) => sum + segment.distanceM, 0);
  const trendDistanceFor = (type: RideRouteType) => trendSegments.filter((segment) => segment.type === type).reduce((sum, segment) => sum + segment.distanceM, 0);
  const coverageRatio = movingDistanceM > 0 ? classifiedDistanceM / movingDistanceM : 0;
  const isAvailable = movingDistanceM > 0 && coverageRatio >= MIN_COVERAGE_RATIO;
  return {
    rulesVersion: RIDE_ROUTE_SHAPE_RULES_VERSION,
    isAvailable,
    gradeSegments: elevation.smoothedSegments
      .map((points) => gradePoints(points, CLASSIFICATION_HALF_GRADE_WINDOW_M, CLASSIFICATION_MIN_GRADE_WINDOW_M))
      .filter((points) => points.length >= 2),
    displayGradeSegments: elevation.smoothedSegments
      .map((points) => gradePoints(points, DISPLAY_HALF_GRADE_WINDOW_M, DISPLAY_MIN_GRADE_WINDOW_M))
      .filter((points) => points.length >= 2),
    trendSegments: isAvailable ? trendSegments : [],
    segments: isAvailable ? segments : [],
    movingDistanceM,
    classifiedDistanceM,
    climbDistanceM: isAvailable ? distanceFor("climb") : 0,
    flatDistanceM: isAvailable ? distanceFor("flat") : 0,
    descentDistanceM: isAvailable ? distanceFor("descent") : 0,
    trendClimbDistanceM: isAvailable ? trendDistanceFor("climb") : 0,
    trendFlatDistanceM: isAvailable ? trendDistanceFor("flat") : 0,
    trendDescentDistanceM: isAvailable ? trendDistanceFor("descent") : 0,
    trendClassifiedDistanceM: isAvailable ? trendSegments.reduce((sum, segment) => sum + segment.distanceM, 0) : 0,
    coverageRatio,
    needsCoverageNotice: isAvailable && coverageRatio < FULL_COVERAGE_RATIO,
  };
}
