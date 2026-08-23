import type {
  RideRecord,
  RideSeriesKey,
  RideSeriesPoint,
} from "../domain/ride-schema.ts";

type ChartSeriesKey = Exclude<RideSeriesKey, "route" | "distance">;

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
  key: ChartSeriesKey;
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
}

export interface RideVisualDisplay {
  route?: RideRouteDisplay;
  charts: RideSeriesChartDisplay[];
}

function qualityLabel(status: "valid" | "degraded"): string {
  return status === "valid" ? "质量通过" : "降级数据";
}

function pathFromPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join(" ");
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

function formatRangeValue(value: number, decimals: number, unit: string): string {
  return `${value.toFixed(decimals)} ${unit}`;
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
): RideSeriesChartDisplay | undefined {
  if (!record.series.availableSeries.includes(config.key)) return undefined;
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
  const points = rawPoints.map((point, index) => ({
    x: 12 + normalize(xAxis.value(point), minX, maxX) * 296,
    y: 10 + (1 - normalize(values[index], minValue, maxValue)) * 96,
  }));
  const linePath = pathFromPoints(points);

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
  };
}

export function buildRideVisualDisplay(record: RideRecord, sourceLabel: string): RideVisualDisplay {
  return {
    route: buildRouteDisplay(record, sourceLabel),
    charts: CHART_CONFIGS.flatMap((config) => {
      const chart = buildChartDisplay(record, config, sourceLabel);
      return chart ? [chart] : [];
    }),
  };
}
