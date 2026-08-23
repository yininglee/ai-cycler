import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  RIDE_SCHEMA_VERSION,
  type RideActivity,
  type RideIssue,
  type RideMetrics,
  type RideRecord,
} from "../domain/ride-schema.ts";
import { buildRideSeries, type RideSeriesInputPoint } from "../domain/ride-series.ts";
import { RideParseError } from "./parse-errors.ts";
import { assertUploadSize, compactObject, metric } from "./parser-utils.ts";

export const GPX_ADAPTER_VERSION = "gpx-parser-v0.3";
export const GPX_GPS_QUALITY_RULE_VERSION = "gpx-gps-quality-v0.1";
export const MAX_PLAUSIBLE_CYCLING_SPEED_MPS = 200 / 3.6;
const MAX_TRACK_POINTS = 200_000;
const EARTH_RADIUS_M = 6_371_000;
const MIN_MOVING_SPEED_MPS = 0.5;

interface GpxPointNode {
  lat?: string | number;
  lon?: string | number;
  ele?: string | number;
  time?: string;
}

interface GpxSegmentNode {
  trkpt?: GpxPointNode | GpxPointNode[];
}

interface GpxTrackNode {
  trkseg?: GpxSegmentNode | GpxSegmentNode[];
}

interface GpxDocument {
  gpx?: {
    version?: string | number;
    trk?: GpxTrackNode | GpxTrackNode[];
  };
}

interface NormalizedPoint {
  lat: number;
  lon: number;
  elevation?: number;
  timeMs?: number;
}

export interface ParseGpxInput {
  rideId: string;
  fileName: string;
  xml: string;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function distanceBetween(a: NormalizedPoint, b: NormalizedPoint): number {
  const latDelta = radians(b.lat - a.lat);
  const lonDelta = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function segmentSpeedMps(a: NormalizedPoint, b: NormalizedPoint): number | undefined {
  if (a.timeMs === undefined || b.timeMs === undefined) return undefined;
  const deltaS = (b.timeMs - a.timeMs) / 1_000;
  if (deltaS <= 0) return undefined;
  return distanceBetween(a, b) / deltaS;
}

function applyGpsQualityGate(points: NormalizedPoint[]): {
  points: NormalizedPoint[];
  invalidPointCount: number;
  issues: RideIssue[];
} {
  if (points.length < 2 || !points.every((point) => point.timeMs !== undefined)) {
    return { points, invalidPointCount: 0, issues: [] };
  }

  const isolatedSpikeIndexes = new Set<number>();
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incomingSpeed = segmentSpeedMps(previous, current);
    const outgoingSpeed = segmentSpeedMps(current, next);
    const bridgeSpeed = segmentSpeedMps(previous, next);

    if (
      incomingSpeed !== undefined &&
      outgoingSpeed !== undefined &&
      bridgeSpeed !== undefined &&
      incomingSpeed > MAX_PLAUSIBLE_CYCLING_SPEED_MPS &&
      outgoingSpeed > MAX_PLAUSIBLE_CYCLING_SPEED_MPS &&
      bridgeSpeed <= MAX_PLAUSIBLE_CYCLING_SPEED_MPS
    ) {
      isolatedSpikeIndexes.add(index);
    }
  }

  const filteredPoints = points.filter((_, index) => !isolatedSpikeIndexes.has(index));
  for (let index = 1; index < filteredPoints.length; index += 1) {
    const speed = segmentSpeedMps(filteredPoints[index - 1]!, filteredPoints[index]!);
    if (speed !== undefined && speed > MAX_PLAUSIBLE_CYCLING_SPEED_MPS) {
      throw new RideParseError(
        "GPX_IMPLAUSIBLE_TRACK",
        `GPX存在无法安全修复的异常轨迹跳变（${GPX_GPS_QUALITY_RULE_VERSION}）`,
      );
    }
  }

  const invalidPointCount = isolatedSpikeIndexes.size;
  return {
    points: filteredPoints,
    invalidPointCount,
    issues: invalidPointCount === 0 ? [] : [{
      code: "GPX_GPS_SPIKE_FILTERED",
      severity: "warning",
      message: `已按${GPX_GPS_QUALITY_RULE_VERSION}过滤${invalidPointCount}个GPS孤立跳点`,
    }],
  };
}

function normalizePoint(point: GpxPointNode): NormalizedPoint {
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new RideParseError("GPX_INVALID_COORDINATES", "GPX包含无效经纬度");
  }

  const elevation = point.ele === undefined ? undefined : Number(point.ele);
  const parsedTime = point.time === undefined ? undefined : Date.parse(point.time);
  return {
    lat,
    lon,
    ...(elevation !== undefined && Number.isFinite(elevation) ? { elevation } : {}),
    ...(parsedTime !== undefined && Number.isFinite(parsedTime) ? { timeMs: parsedTime } : {}),
  };
}

function buildGpxMetrics(rideId: string, points: NormalizedPoint[]): {
  metrics: RideMetrics;
  seriesPoints: RideSeriesInputPoint[];
  startTime?: string;
  issues: RideIssue[];
} {
  let distanceM = 0;
  let elevationGainM = 0;
  let movingTimeS = 0;
  let timesUsable = points.every((point) => point.timeMs !== undefined);
  const cumulativeDistances = [0];
  const segmentSpeeds: Array<number | undefined> = [undefined];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const segmentDistance = distanceBetween(previous, current);
    distanceM += segmentDistance;
    cumulativeDistances.push(distanceM);

    if (previous.elevation !== undefined && current.elevation !== undefined) {
      elevationGainM += Math.max(0, current.elevation - previous.elevation);
    }

    if (timesUsable) {
      const deltaS = (current.timeMs! - previous.timeMs!) / 1_000;
      if (deltaS <= 0) {
        timesUsable = false;
        movingTimeS = 0;
        segmentSpeeds.push(undefined);
      } else if (segmentDistance / deltaS >= MIN_MOVING_SPEED_MPS) {
        movingTimeS += deltaS;
        segmentSpeeds.push(segmentDistance / deltaS);
      } else {
        segmentSpeeds.push(segmentDistance / deltaS);
      }
    } else {
      segmentSpeeds.push(undefined);
    }
  }

  const issues: RideIssue[] = [];
  const firstTime = points[0]?.timeMs;
  const lastTime = points.at(-1)?.timeMs;
  const elapsedTimeS = timesUsable && firstTime !== undefined && lastTime !== undefined
    ? (lastTime - firstTime) / 1_000
    : undefined;

  if (!timesUsable || elapsedTimeS === undefined || elapsedTimeS <= 0) {
    issues.push({
      code: "GPX_TIMING_UNAVAILABLE",
      severity: "warning",
      message: "GPX时间戳缺失、无效或非递增；不生成时长与速度",
    });
  }

  const usableMovingTime = timesUsable && movingTimeS > 0 ? movingTimeS : undefined;
  const startTime = timesUsable && firstTime !== undefined ? new Date(firstTime).toISOString() : undefined;
  const sourceMetadata = (sourceUnit: string) => ({
    sourceField: "gpx.trk.trkseg.trkpt",
    sourceUnit,
    ...(startTime ? { recordedAt: startTime } : {}),
  });
  return {
    metrics: compactObject({
      distanceM: metric(
        distanceM,
        "m",
        `${rideId}:gpx:track:distance`,
        "calculated",
        "high",
        "haversine-v0.1",
        sourceMetadata("degrees"),
      ),
      elapsedTimeS: metric(
        elapsedTimeS,
        "s",
        `${rideId}:gpx:track:elapsed-time`,
        "calculated",
        "high",
        "timestamp-span-v0.1",
        sourceMetadata("ISO-8601"),
      ),
      movingTimeS: metric(
        usableMovingTime,
        "s",
        `${rideId}:gpx:track:moving-time`,
        "calculated",
        "medium",
        "moving-time-0.5mps-v0.1",
        sourceMetadata("ISO-8601"),
      ),
      elevationGainM: metric(
        elevationGainM,
        "m",
        `${rideId}:gpx:track:ascent`,
        "calculated",
        "medium",
        "positive-elevation-delta-v0.1",
        sourceMetadata("m"),
      ),
      avgSpeedMps: metric(
        usableMovingTime ? distanceM / usableMovingTime : undefined,
        "m/s",
        `${rideId}:gpx:track:avg-speed`,
        "calculated",
        "medium",
        "distance-over-moving-time-v0.1",
        sourceMetadata("degrees+ISO-8601"),
      ),
      maxSpeedMps: metric(
        usableMovingTime
          ? Math.max(...segmentSpeeds.filter((value): value is number => value !== undefined && value >= MIN_MOVING_SPEED_MPS))
          : undefined,
        "m/s",
        `${rideId}:gpx:track:max-speed`,
        "calculated",
        "medium",
        "max-segment-speed-v0.1",
        sourceMetadata("degrees+ISO-8601"),
      ),
    } satisfies RideMetrics),
    seriesPoints: points.map((point, index) => ({
      latitude: point.lat,
      longitude: point.lon,
      distanceM: cumulativeDistances[index] ?? distanceM,
      ...(point.elevation !== undefined ? { elevationM: point.elevation } : {}),
      ...(timesUsable && firstTime !== undefined && point.timeMs !== undefined
        ? { elapsedTimeS: (point.timeMs - firstTime) / 1_000 }
        : {}),
      ...(timesUsable && segmentSpeeds[index] !== undefined ? { speedMps: segmentSpeeds[index] } : {}),
    })),
    ...(startTime ? { startTime } : {}),
    issues,
  };
}

export function parseGpxRide(input: ParseGpxInput): RideRecord {
  const byteLength = Buffer.byteLength(input.xml, "utf8");
  assertUploadSize(byteLength);
  if (!input.fileName.toLowerCase().endsWith(".gpx")) {
    throw new RideParseError("UNSUPPORTED_FILE_TYPE", "GPX解析器只接受.gpx文件");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(input.xml)) {
    throw new RideParseError("GPX_UNSAFE_XML", "GPX包含不允许的DOCTYPE或实体声明");
  }

  const validation = XMLValidator.validate(input.xml);
  if (validation !== true) {
    throw new RideParseError("GPX_INVALID_XML", `GPX XML格式无效：${validation.err.msg}`);
  }

  let document: GpxDocument;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseAttributeValue: true,
      parseTagValue: true,
      removeNSPrefix: true,
      processEntities: false,
      trimValues: true,
      isArray: (tagName) => tagName === "trk" || tagName === "trkseg" || tagName === "trkpt",
    }).parse(input.xml) as GpxDocument;
  } catch (error) {
    throw new RideParseError("GPX_INVALID_XML", "GPX XML无法解析", error);
  }

  const pointNodes = toArray(document.gpx?.trk)
    .flatMap((track) => toArray(track.trkseg))
    .flatMap((segment) => toArray(segment.trkpt));
  if (pointNodes.length === 0) {
    throw new RideParseError("GPX_NO_TRACK_POINTS", "GPX中没有轨迹点");
  }
  if (pointNodes.length > MAX_TRACK_POINTS) {
    throw new RideParseError("GPX_TOO_MANY_TRACK_POINTS", "GPX轨迹点超过20万上限");
  }

  const normalizedPoints = pointNodes.map(normalizePoint);
  const gpsQuality = applyGpsQualityGate(normalizedPoints);
  const result = buildGpxMetrics(input.rideId, gpsQuality.points);
  const activity: RideActivity = {
    schemaVersion: RIDE_SCHEMA_VERSION,
    rideId: input.rideId,
    sport: "cycling",
    source: {
      kind: "gpx",
      fileName: input.fileName,
      parserVersion: GPX_ADAPTER_VERSION,
      formatVersion: document.gpx?.version === undefined ? undefined : String(document.gpx.version),
    },
    startTime: result.startTime,
    metrics: result.metrics,
    sensorQuality: {
      gps: {
        coverage: gpsQuality.points.length / normalizedPoints.length,
        sampleCount: normalizedPoints.length,
        invalidSampleCount: gpsQuality.invalidPointCount,
      },
    },
    sourceIssues: [...gpsQuality.issues, ...result.issues],
  };
  const series = buildRideSeries({
    rideId: input.rideId,
    sourceKind: "gpx",
    parserVersion: GPX_ADAPTER_VERSION,
    ...(result.startTime ? { startTime: result.startTime } : {}),
    seriesMetadata: {
      route: {
        sourceField: "gpx.trk.trkseg.trkpt@lat+lon",
        unit: "relative",
        qualityStatus: gpsQuality.invalidPointCount > 0 ? "degraded" : "valid",
      },
      distance: { sourceField: "gpx.trk.trkseg.trkpt@lat+lon", unit: "m", qualityStatus: "valid" },
      elevation: { sourceField: "gpx.trk.trkseg.trkpt.ele", unit: "m", qualityStatus: "valid" },
      speed: {
        sourceField: "gpx.trk.trkseg.trkpt@lat+lon+time",
        unit: "m/s",
        qualityStatus: gpsQuality.invalidPointCount > 0 ? "degraded" : "valid",
      },
    },
    points: result.seriesPoints,
  });
  return { activity, series };
}

export function parseGpxActivity(input: ParseGpxInput): RideActivity {
  return parseGpxRide(input).activity;
}
