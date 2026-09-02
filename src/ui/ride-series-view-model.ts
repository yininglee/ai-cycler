import type {
  RideRecord,
  RideSeriesKey,
  RideSeriesPoint,
} from "../domain/ride-schema.ts";
import type { RideCruiseSegment } from "../domain/ride-timing.ts";
import type { RideElevationSummary } from "../domain/ride-elevation.ts";
import type { RideEventClimbSummary } from "../domain/ride-event-climbs.ts";
import type { RideRouteShapeSummary } from "../domain/ride-route-shape.ts";

type ChartSeriesKey = Exclude<RideSeriesKey, "route" | "distance">;
export type RideChartKey = ChartSeriesKey | "grade";

interface ChartConfig {
  key: ChartSeriesKey;
  label: string;
  field: keyof RideSeriesPoint;
  unit: string;
  decimals: number;
  multiplier: number;
}

const CHART_CONFIGS: ChartConfig[] = [
  { key: "speed", label: "速度", field: "speedMps", unit: "km/h", decimals: 1, multiplier: 3.6 },
  { key: "elevation", label: "海拔", field: "elevationM", unit: "m", decimals: 0, multiplier: 1 },
  { key: "heart_rate", label: "心率", field: "heartRateBpm", unit: "bpm", decimals: 0, multiplier: 1 },
  { key: "power", label: "功率", field: "powerW", unit: "W", decimals: 0, multiplier: 1 },
  { key: "cadence", label: "踏频", field: "cadenceRpm", unit: "rpm", decimals: 0, multiplier: 1 },
];

export interface RideRouteDisplay {
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  sampleCount: number;
  qualityLabel: string;
  sourceLabel: string;
  privacyLabel: string;
}

export interface RideSeriesChartDisplay {
  key: RideChartKey;
  label: string;
  unit: string;
  path: string;
  areaPath: string;
  minLabel: string;
  maxLabel: string;
  axisLabel: string;
  sampleCount: number;
  qualityLabel: string;
  sourceLabel: string;
  cruiseHighlights: Array<{
    x: number;
    width: number;
    isLong: boolean;
  }>;
  points?: Array<{ x: number; y: number; value: number }>;
}

export interface RideVisualDisplay {
  route?: RideRouteDisplay;
  charts: RideSeriesChartDisplay[];
  routeShape?: {
    rulesVersion: string;
    gradeChart: RideSeriesChartDisplay;
    climbDistanceM: number;
    flatDistanceM: number;
    descentDistanceM: number;
    classifiedDistanceM: number;
    movingDistanceM: number;
    needsCoverageNotice: boolean;
    eventClimbs: Array<{
      id: string;
      categoryLabel: string;
      distanceLabel: string;
      netElevationGainLabel: string;
      averageGradeLabel: string;
      durationLabel?: string;
      movingAverageSpeedLabel?: string;
      averageHeartRateLabel?: string;
      averagePowerLabel?: string;
      powerQualityLabel?: string;
      startPosition: number;
      endPosition: number;
    }>;
  };
}

function qualityLabel(status: "valid" | "degraded"): string {
  return status === "valid" ? "质量通过" : "降级数据";
}

function pathFromPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join(" ");
}

function areaPathFromSegments(segments: Array<Array<{ x: number; y: number }>>): string {
  return segments.map((points) => {
    const linePath = pathFromPoints(points);
    return `${linePath} L ${points.at(-1)!.x.toFixed(2)} 112 L ${points[0]!.x.toFixed(2)} 112 Z`;
  }).join(" ");
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/** Keep visual extrema while capping SVG point count for dense sensor traces. */
function downsampleByExtrema<T>(points: T[], valueOf: (point: T) => number, maxPoints = 220): T[] {
  if (points.length <= maxPoints) return points;
  const interiorCount = points.length - 2;
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const sampled: Array<{ index: number; point: T }> = [{ index: 0, point: points[0]! }];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * interiorCount / bucketCount);
    const end = 1 + Math.floor((bucket + 1) * interiorCount / bucketCount);
    const bucketEnd = Math.max(start + 1, end);
    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < Math.min(bucketEnd, points.length - 1); index += 1) {
      if (valueOf(points[index]!) < valueOf(points[minIndex]!)) minIndex = index;
      if (valueOf(points[index]!) > valueOf(points[maxIndex]!)) maxIndex = index;
    }
    for (const index of [minIndex, maxIndex].sort((left, right) => left - right)) {
      if (sampled.at(-1)?.index !== index) sampled.push({ index, point: points[index]! });
    }
  }
  if (sampled.at(-1)?.index !== points.length - 1) sampled.push({ index: points.length - 1, point: points.at(-1)! });
  return sampled.sort((left, right) => left.index - right.index).map(({ point }) => point);
}

function formatRangeValue(value: number, decimals: number, unit: string): string {
  return `${value.toFixed(decimals)} ${unit}`;
}

function compactNumber(value: number, fractionDigits = 1): string {
  return Number(value.toFixed(fractionDigits)).toString();
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分钟`;
  return minutes === 0 ? `${hours}小时` : `${hours}小时${minutes}分钟`;
}

function buildRouteDisplay(record: RideRecord, sourceLabel: string): RideRouteDisplay | undefined {
  if (!record.series.availableSeries.includes("route") || !record.series.privacy.preciseCoordinatesExcluded) {
    return undefined;
  }
  const route = record.series.points.flatMap((point) => point.route ? [point.route] : []);
  const metadata = record.series.seriesMetadata.route;
  if (route.length < 2 || !metadata) return undefined;

  const points = route.map((point) => ({
    x: 20 + point.x * 280,
    y: 20 + point.y * 180,
  }));
  return {
    path: pathFromPoints(points),
    start: points[0],
    end: points[points.length - 1],
    sampleCount: metadata.sampleCount,
    qualityLabel: qualityLabel(metadata.qualityStatus),
    sourceLabel,
    privacyLabel: "已移除精确坐标",
  };
}

function chooseXAxis(points: RideSeriesPoint[]): {
  axisLabel: string;
  value: (point: RideSeriesPoint) => number;
} {
  if (points.every((point) => point.elapsedTimeS !== undefined)) {
    return { axisLabel: "骑行时间", value: (point) => point.elapsedTimeS ?? point.sequence };
  }
  if (points.every((point) => point.distanceM !== undefined)) {
    return { axisLabel: "骑行距离", value: (point) => point.distanceM ?? point.sequence };
  }
  return { axisLabel: "记录进度", value: (point) => point.sequence };
}

function buildChartDisplay(
  record: RideRecord,
  config: ChartConfig,
  sourceLabel: string,
  cruiseSegments: RideCruiseSegment[],
  elevation?: RideElevationSummary,
): RideSeriesChartDisplay | undefined {
  if (config.key === "elevation" && elevation?.smoothedPoints.length) {
    return buildElevationChartDisplay(elevation, sourceLabel);
  }
  if (!record.series.availableSeries.includes(config.key) || config.key === "elevation") return undefined;
  const metadata = record.series.seriesMetadata[config.key];
  if (!metadata) return undefined;

  const rawPoints = record.series.points.filter((point) => typeof point[config.field] === "number");
  if (rawPoints.length < 2) return undefined;
  const xAxis = chooseXAxis(rawPoints);
  const values = rawPoints.map((point) => Number(point[config.field]) * config.multiplier);
  const xValues = rawPoints.map(xAxis.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const displayPoints = downsampleByExtrema(rawPoints, (point) => Number(point[config.field]), 220);
  const points = displayPoints.map((point) => ({
    x: 12 + normalize(xAxis.value(point), minX, maxX) * 296,
    y: 10 + (1 - normalize(Number(point[config.field]) * config.multiplier, minValue, maxValue)) * 96,
  }));
  const linePath = pathFromPoints(points);
  const cruiseHighlights = config.key === "speed" && xAxis.axisLabel === "骑行时间" && maxX > minX
    ? cruiseSegments.flatMap((segment) => {
      const start = Math.max(minX, segment.startElapsedTimeS);
      const end = Math.min(maxX, segment.endElapsedTimeS);
      if (end <= start) return [];
      const x = 12 + normalize(start, minX, maxX) * 296;
      const endX = 12 + normalize(end, minX, maxX) * 296;
      return [{ x, width: Math.max(2, endX - x), isLong: segment.isLong }];
    })
    : [];

  return {
    key: config.key,
    label: config.label,
    unit: config.unit,
    path: linePath,
    areaPath: `${linePath} L ${points[points.length - 1].x.toFixed(2)} 112 L ${points[0].x.toFixed(2)} 112 Z`,
    minLabel: formatRangeValue(minValue, config.decimals, config.unit),
    maxLabel: formatRangeValue(maxValue, config.decimals, config.unit),
    axisLabel: xAxis.axisLabel,
    sampleCount: metadata.sampleCount,
    qualityLabel: qualityLabel(metadata.qualityStatus),
    sourceLabel,
    cruiseHighlights,
    points: points.map((point, index) => ({ x: point.x, y: point.y, value: Number(displayPoints[index]![config.field]) * config.multiplier })),
  };
}

function buildElevationChartDisplay(
  elevation: RideElevationSummary,
  sourceLabel: string,
): RideSeriesChartDisplay | undefined {
  if (elevation.smoothedPoints.length < 2 || elevation.minM === undefined || elevation.maxM === undefined) return undefined;
  const minDistanceM = Math.min(...elevation.smoothedPoints.map((point) => point.distanceM));
  const maxDistanceM = Math.max(...elevation.smoothedPoints.map((point) => point.distanceM));
  const segments = elevation.smoothedSegments.map((segment) => downsampleByExtrema(segment, (point) => point.elevationM).map((point) => ({
    x: 12 + normalize(point.distanceM, minDistanceM, maxDistanceM) * 296,
    y: 10 + (1 - normalize(point.elevationM, elevation.minM!, elevation.maxM!)) * 96,
  }))).filter((segment) => segment.length >= 2);
  if (segments.length === 0) return undefined;
  const linePath = segments.map(pathFromPoints).join(" ");
  return {
    key: "elevation",
    label: "海拔",
    unit: "m",
    path: linePath,
    areaPath: areaPathFromSegments(segments),
    minLabel: formatRangeValue(elevation.minM, 0, "m"),
    maxLabel: formatRangeValue(elevation.maxM, 0, "m"),
    axisLabel: "骑行距离",
    sampleCount: elevation.smoothedPoints.length,
    qualityLabel: "质量通过",
    sourceLabel: elevation.gainSource === "rule_calculated" ? `规则计算 · ${elevation.rulesVersion}` : sourceLabel,
    cruiseHighlights: [],
  };
}

function buildGradeChartDisplay(
  routeShape: RideRouteShapeSummary,
): RideSeriesChartDisplay | undefined {
  const points = routeShape.displayGradeSegments.flat();
  if (points.length < 2) return undefined;
  const minDistanceM = Math.min(...points.map((point) => point.distanceM));
  const maxDistanceM = Math.max(...points.map((point) => point.distanceM));
  if (maxDistanceM <= minDistanceM) return undefined;
  const values = points.map((point) => point.grade * 100);
  const minGrade = Math.min(...values);
  const maxGrade = Math.max(...values);
  const segments = routeShape.displayGradeSegments.map((segment) => downsampleByExtrema(segment, (point) => point.grade).map((point) => ({
    x: 12 + normalize(point.distanceM, minDistanceM, maxDistanceM) * 296,
    y: 10 + (1 - normalize(point.grade * 100, minGrade, maxGrade)) * 96,
  }))).filter((segment) => segment.length >= 2);
  if (segments.length === 0) return undefined;
  return {
    key: "grade",
    label: "坡度",
    unit: "%",
    path: segments.map(pathFromPoints).join(" "),
    areaPath: areaPathFromSegments(segments),
    minLabel: formatRangeValue(minGrade, 1, "%"),
    maxLabel: formatRangeValue(maxGrade, 1, "%"),
    axisLabel: "骑行距离",
    sampleCount: points.length,
    qualityLabel: "质量通过",
    sourceLabel: `规则计算 · ${routeShape.rulesVersion}`,
    cruiseHighlights: [],
  };
}

function buildEventClimbDisplays(
  record: RideRecord,
  elevation: RideElevationSummary | undefined,
  eventClimbs: RideEventClimbSummary | undefined,
): NonNullable<RideVisualDisplay["routeShape"]>["eventClimbs"] {
  if (!elevation || !eventClimbs?.isAvailable || eventClimbs.climbs.length === 0 || elevation.smoothedPoints.length < 2) return [];
  const minDistanceM = Math.min(...elevation.smoothedPoints.map((point) => point.distanceM));
  const maxDistanceM = Math.max(...elevation.smoothedPoints.map((point) => point.distanceM));
  if (maxDistanceM <= minDistanceM) return [];
  return eventClimbs.climbs.map((climb) => ({
    id: climb.id,
    categoryLabel: climb.category === "HC" ? "HC级" : `${climb.category}级`,
    distanceLabel: `${compactNumber(climb.distanceM / 1_000)} km`,
    netElevationGainLabel: `${Math.round(climb.netElevationGainM)} m`,
    averageGradeLabel: `${compactNumber(climb.averageGrade * 100)}%`,
    ...(climb.elapsedTimeS !== undefined ? { durationLabel: formatDuration(climb.elapsedTimeS) } : {}),
    ...(climb.movingAverageSpeedMps !== undefined ? { movingAverageSpeedLabel: `${compactNumber(climb.movingAverageSpeedMps * 3.6)} km/h` } : {}),
    ...(climb.averageHeartRateBpm !== undefined ? { averageHeartRateLabel: `${Math.round(climb.averageHeartRateBpm)} bpm` } : {}),
    ...(climb.averagePowerW !== undefined ? { averagePowerLabel: `${Math.round(climb.averagePowerW)} W` } : {}),
    ...(climb.powerQuality === "soft" ? { powerQualityLabel: "功率部分缺失" } : {}),
    startPosition: normalize(climb.startDistanceM, minDistanceM, maxDistanceM),
    endPosition: normalize(climb.endDistanceM, minDistanceM, maxDistanceM),
  }));
}

export function buildRideVisualDisplay(
  record: RideRecord,
  sourceLabel: string,
  cruiseSegments: RideCruiseSegment[] = [],
  elevation?: RideElevationSummary,
  routeShape?: RideRouteShapeSummary,
  eventClimbs?: RideEventClimbSummary,
): RideVisualDisplay {
  const gradeChart = routeShape?.isAvailable ? buildGradeChartDisplay(routeShape) : undefined;
  return {
    route: buildRouteDisplay(record, sourceLabel),
    charts: CHART_CONFIGS.flatMap((config) => {
      const chart = buildChartDisplay(record, config, sourceLabel, cruiseSegments, elevation);
      return chart ? [chart] : [];
    }),
    ...(routeShape?.isAvailable && gradeChart ? {
      routeShape: {
        rulesVersion: routeShape.rulesVersion,
        gradeChart,
        climbDistanceM: routeShape.trendClimbDistanceM,
        flatDistanceM: routeShape.trendFlatDistanceM,
        descentDistanceM: routeShape.trendDescentDistanceM,
        classifiedDistanceM: routeShape.trendClassifiedDistanceM,
        movingDistanceM: routeShape.movingDistanceM,
        needsCoverageNotice: routeShape.needsCoverageNotice,
        eventClimbs: buildEventClimbDisplays(record, elevation, eventClimbs),
      },
    } : {}),
  };
}
