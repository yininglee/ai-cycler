import {
  RIDE_SERIES_SCHEMA_VERSION,
  type DataSourceKind,
  type RideActivity,
  type RideIssue,
  type RideRecord,
  type RideSeries,
  type RideSeriesKey,
  type RideSeriesMetadata,
  type RideSeriesPoint,
  type RideValidationResult,
} from "./ride-schema.ts";
import { validateRideActivity } from "./ride-rules.ts";

export interface RideSeriesInputPoint extends Omit<RideSeriesPoint, "sequence" | "route"> {
  latitude?: number;
  longitude?: number;
}

interface BuildRideSeriesInput {
  rideId: string;
  sourceKind: DataSourceKind;
  parserVersion: string;
  startTime?: string;
  seriesMetadata?: Partial<Record<RideSeriesKey, Omit<RideSeriesMetadata, "sampleCount">>>;
  points: RideSeriesInputPoint[];
}

const FIELD_BY_SERIES: Record<Exclude<RideSeriesKey, "route">, keyof RideSeriesPoint> = {
  distance: "distanceM",
  elevation: "elevationM",
  speed: "speedMps",
  heart_rate: "heartRateBpm",
  power: "powerW",
  cadence: "cadenceRpm",
};

const UNIT_BY_SERIES: Record<RideSeriesKey, string> = {
  route: "relative",
  distance: "m",
  elevation: "m",
  speed: "m/s",
  heart_rate: "bpm",
  power: "W",
  cadence: "rpm",
};

const SERIES_VALUE_BOUNDS: Partial<Record<keyof RideSeriesPoint, { min: number; max: number }>> = {
  elapsedTimeS: { min: 0, max: 604_800 },
  distanceM: { min: 0, max: 2_000_000 },
  elevationM: { min: -500, max: 10_000 },
  speedMps: { min: 0, max: 60 },
  heartRateBpm: { min: 30, max: 260 },
  powerW: { min: 0, max: 3_000 },
  cadenceRpm: { min: 0, max: 250 },
};

function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function buildRelativeRoute(points: RideSeriesInputPoint[]): Array<{ x: number; y: number } | undefined> {
  const coordinates = points
    .map((point, index) => ({ index, latitude: finite(point.latitude), longitude: finite(point.longitude) }))
    .filter((point): point is { index: number; latitude: number; longitude: number } =>
      point.latitude !== undefined && point.longitude !== undefined
    );
  if (coordinates.length < 2) return points.map(() => undefined);

  const meanLatitude = coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length;
  const longitudeScale = Math.max(0.01, Math.cos(meanLatitude * Math.PI / 180));
  const projected = coordinates.map((point) => ({
    index: point.index,
    x: point.longitude * longitudeScale,
    y: point.latitude,
  }));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const width = Math.max(maxX - minX, Number.EPSILON);
  const height = Math.max(maxY - minY, Number.EPSILON);
  const normalized = new Map(projected.map((point) => [point.index, {
    x: (point.x - minX) / width,
    y: 1 - (point.y - minY) / height,
  }]));
  return points.map((_, index) => normalized.get(index));
}

export function buildRideSeries(input: BuildRideSeriesInput): RideSeries {
  const relativeRoute = buildRelativeRoute(input.points);
  const points = input.points.map((point, sequence): RideSeriesPoint => {
    const route = relativeRoute[sequence];
    return {
      sequence,
      ...(finite(point.elapsedTimeS) !== undefined ? { elapsedTimeS: finite(point.elapsedTimeS) } : {}),
      ...(finite(point.distanceM) !== undefined ? { distanceM: finite(point.distanceM) } : {}),
      ...(route ? { route } : {}),
      ...(finite(point.elevationM) !== undefined ? { elevationM: finite(point.elevationM) } : {}),
      ...(finite(point.speedMps) !== undefined ? { speedMps: finite(point.speedMps) } : {}),
      ...(finite(point.heartRateBpm) !== undefined ? { heartRateBpm: finite(point.heartRateBpm) } : {}),
      ...(finite(point.powerW) !== undefined ? { powerW: finite(point.powerW) } : {}),
      ...(finite(point.cadenceRpm) !== undefined ? { cadenceRpm: finite(point.cadenceRpm) } : {}),
    };
  });

  const availableSeries: RideSeriesKey[] = [];
  if (points.filter((point) => point.route).length >= 2) availableSeries.push("route");
  for (const [series, field] of Object.entries(FIELD_BY_SERIES) as [Exclude<RideSeriesKey, "route">, keyof RideSeriesPoint][]) {
    if (points.some((point) => point[field] !== undefined)) availableSeries.push(series);
  }
  const seriesMetadata = Object.fromEntries(availableSeries.map((series) => {
    const configured = input.seriesMetadata?.[series];
    const sampleCount = series === "route"
      ? points.filter((point) => point.route !== undefined).length
      : points.filter((point) => point[FIELD_BY_SERIES[series]] !== undefined).length;
    return [series, {
      sourceField: configured?.sourceField ?? `${input.sourceKind}.series.${series}`,
      unit: configured?.unit ?? UNIT_BY_SERIES[series],
      qualityStatus: configured?.qualityStatus ?? "valid",
      sampleCount,
    } satisfies RideSeriesMetadata];
  })) as Partial<Record<RideSeriesKey, RideSeriesMetadata>>;

  return {
    schemaVersion: RIDE_SERIES_SCHEMA_VERSION,
    rideId: input.rideId,
    source: { kind: input.sourceKind, parserVersion: input.parserVersion },
    coordinateSpace: "relative_normalized",
    privacy: { ruleVersion: "relative-route-v0.1", preciseCoordinatesExcluded: true },
    availableSeries,
    seriesMetadata,
    timeBasis: input.startTime ? { kind: "elapsed_from_start", startTime: input.startTime } : { kind: "none" },
    points,
  };
}

function issue(code: string, message: string, field?: string): RideIssue {
  return { code, severity: "error", message, ...(field ? { field } : {}) };
}

function actualSeriesKeys(series: RideSeries): RideSeriesKey[] {
  const keys: RideSeriesKey[] = [];
  if (series.points.filter((point) => point.route).length >= 2) keys.push("route");
  for (const [key, field] of Object.entries(FIELD_BY_SERIES) as [Exclude<RideSeriesKey, "route">, keyof RideSeriesPoint][]) {
    if (series.points.some((point) => point[field] !== undefined)) keys.push(key);
  }
  return keys;
}

export function validateRideSeries(series: RideSeries, activity: RideActivity): RideValidationResult {
  const issues: RideIssue[] = [];
  if (series.schemaVersion !== RIDE_SERIES_SCHEMA_VERSION) {
    issues.push(issue("UNSUPPORTED_SERIES_SCHEMA_VERSION", "不支持的序列Schema版本", "series.schemaVersion"));
  }
  if (series.rideId !== activity.rideId) {
    issues.push(issue("SERIES_RIDE_ID_MISMATCH", "序列与活动的rideId不一致", "series.rideId"));
  }
  if (series.source.kind !== activity.source.kind || series.source.parserVersion !== activity.source.parserVersion) {
    issues.push(issue("SERIES_SOURCE_MISMATCH", "序列与活动的来源不一致", "series.source"));
  }

  let previousTime = -1;
  let previousDistance = -1;
  for (const [index, point] of series.points.entries()) {
    if (point.sequence !== index) {
      issues.push(issue("INVALID_SERIES_SEQUENCE", "序列点编号必须连续", `series.points.${index}.sequence`));
    }
    for (const [field, value] of Object.entries(point)) {
      if (field !== "route" && typeof value === "number" && !Number.isFinite(value)) {
        issues.push(issue("NON_FINITE_SERIES_VALUE", "序列包含非有限数值", `series.points.${index}.${field}`));
      }
      const bounds = SERIES_VALUE_BOUNDS[field as keyof RideSeriesPoint];
      if (bounds && typeof value === "number" && (value < bounds.min || value > bounds.max)) {
        issues.push(issue("SERIES_VALUE_OUT_OF_RANGE", "序列数值超出合理范围", `series.points.${index}.${field}`));
      }
    }
    if (point.route && (point.route.x < 0 || point.route.x > 1 || point.route.y < 0 || point.route.y > 1)) {
      issues.push(issue("INVALID_RELATIVE_ROUTE", "相对轨迹坐标必须位于0到1", `series.points.${index}.route`));
    }
    if (point.elapsedTimeS !== undefined) {
      if (point.elapsedTimeS < previousTime) {
        issues.push(issue("NON_MONOTONIC_SERIES_TIME", "序列时间必须单调递增", `series.points.${index}.elapsedTimeS`));
      }
      previousTime = point.elapsedTimeS;
    }
    if (point.distanceM !== undefined) {
      if (point.distanceM < previousDistance) {
        issues.push(issue("NON_MONOTONIC_SERIES_DISTANCE", "序列距离必须单调递增", `series.points.${index}.distanceM`));
      }
      previousDistance = point.distanceM;
    }
  }

  const expectedKeys = actualSeriesKeys(series);
  if (JSON.stringify(series.availableSeries) !== JSON.stringify(expectedKeys)) {
    issues.push(issue("SERIES_CAPABILITY_MISMATCH", "availableSeries与实际序列字段不一致", "series.availableSeries"));
  }
  if (JSON.stringify(Object.keys(series.seriesMetadata)) !== JSON.stringify(expectedKeys)) {
    issues.push(issue("SERIES_METADATA_MISMATCH", "序列元数据与可用序列不一致", "series.seriesMetadata"));
  }
  for (const key of expectedKeys) {
    const metadata = series.seriesMetadata[key];
    const actualSampleCount = key === "route"
      ? series.points.filter((point) => point.route !== undefined).length
      : series.points.filter((point) => point[FIELD_BY_SERIES[key]] !== undefined).length;
    if (!metadata || !metadata.sourceField.trim() || !metadata.unit.trim() || metadata.sampleCount !== actualSampleCount) {
      issues.push(issue("INVALID_SERIES_METADATA", "序列缺少来源、单位或样本量", `series.seriesMetadata.${key}`));
    }
    if (metadata && metadata.qualityStatus !== "valid" && metadata.qualityStatus !== "degraded") {
      issues.push(issue("INVALID_SERIES_QUALITY", "序列质量状态无效", `series.seriesMetadata.${key}.qualityStatus`));
    }
  }
  if (series.timeBasis.kind === "elapsed_from_start" && Number.isNaN(Date.parse(series.timeBasis.startTime))) {
    issues.push(issue("INVALID_SERIES_TIME_BASIS", "序列起始时间无效", "series.timeBasis.startTime"));
  }
  if (series.points.some((point) => point.elapsedTimeS !== undefined) && series.timeBasis.kind === "none") {
    issues.push(issue("MISSING_SERIES_TIME_BASIS", "含时间点的序列缺少起始时间", "series.timeBasis"));
  }
  if (activity.source.kind === "gpx" && !activity.startTime &&
      series.points.some((point) => point.elapsedTimeS !== undefined || point.speedMps !== undefined)) {
    issues.push(issue("UNTRUSTED_GPX_SERIES_TIMING", "无时间戳GPX不得包含时间或速度序列", "series.points"));
  }
  if (series.availableSeries.includes("heart_rate") && !activity.sensorQuality.heart_rate) {
    issues.push(issue("UNTRACED_HEART_RATE_SERIES", "心率序列缺少质量记录", "series.availableSeries"));
  }
  if (series.availableSeries.includes("power") && !activity.sensorQuality.power) {
    issues.push(issue("UNTRACED_POWER_SERIES", "功率序列缺少质量记录", "series.availableSeries"));
  }
  if (series.availableSeries.includes("cadence") && !activity.sensorQuality.cadence) {
    issues.push(issue("UNTRACED_CADENCE_SERIES", "踏频序列缺少质量记录", "series.availableSeries"));
  }
  return { valid: issues.length === 0, issues };
}

export function validateRideRecord(record: RideRecord): RideValidationResult {
  const activity = validateRideActivity(record.activity);
  const series = validateRideSeries(record.series, record.activity);
  const issues = [...activity.issues, ...series.issues];
  return { valid: !issues.some((item) => item.severity === "error"), issues };
}
