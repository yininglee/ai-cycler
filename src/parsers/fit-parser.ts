import FitParser from "fit-file-parser";

import {
  RIDE_SCHEMA_VERSION,
  type RideActivity,
  type RideIssue,
  type RideMetrics,
  type RideRecord,
} from "../domain/ride-schema.ts";
import { buildRideSeries, type RideSeriesInputPoint } from "../domain/ride-series.ts";
import { RideParseError } from "./parse-errors.ts";
import { assertUploadSize, compactObject, metric, sensorQuality } from "./parser-utils.ts";

export const FIT_ADAPTER_VERSION = "fit-parser-v0.2";

type ParsedFit = Awaited<ReturnType<FitParser["parseAsync"]>>;
type ParsedSession = NonNullable<ParsedFit["sessions"]>[number];
type ParsedRecord = NonNullable<ParsedFit["records"]>[number];

export interface ParseFitInput {
  rideId: string;
  fileName: string;
  bytes: Uint8Array;
}

function isCyclingSession(session: ParsedSession): boolean {
  return session.sport === "cycling" || session.sport === "e_biking";
}

function normalizeIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readDevice(parsed: ParsedFit): {
  manufacturer?: string;
  product?: string;
} {
  const file = parsed.file_ids?.[0];
  const device = parsed.device_infos?.find((item) => item.device_index === 0) ?? parsed.device_infos?.[0];
  const manufacturer = file?.manufacturer ?? device?.manufacturer;
  const product = file?.product_name ?? device?.product_name ?? file?.product ?? device?.product;
  return {
    ...(manufacturer !== undefined ? { manufacturer: String(manufacturer) } : {}),
    ...(product !== undefined ? { product: String(product) } : {}),
  };
}

function hasUsefulPower(records: ParsedRecord[], session: ParsedSession): boolean {
  if (records.length === 0) return (session.avg_power ?? 0) > 0;
  return records.some((record) => Number.isFinite(record.power) && record.power! > 0);
}

function buildMetrics(
  rideId: string,
  session: ParsedSession,
  usefulPower: boolean,
  recordedAt: string | undefined,
): RideMetrics {
  const recorded = (
    value: number | undefined,
    unit: Parameters<typeof metric>[1],
    evidenceSuffix: string,
    sourceField: string,
  ) => metric(value, unit, `${rideId}:fit:session:${evidenceSuffix}`, "recorded", "high", undefined, {
    sourceField: `session.${sourceField}`,
    sourceUnit: unit,
    ...(recordedAt ? { recordedAt } : {}),
  });
  return compactObject({
    distanceM: recorded(session.total_distance, "m", "distance", "total_distance"),
    elapsedTimeS: recorded(session.total_elapsed_time, "s", "elapsed-time", "total_elapsed_time"),
    movingTimeS: recorded(
      session.total_moving_time ?? session.total_timer_time,
      "s",
      "moving-time",
      session.total_moving_time !== undefined ? "total_moving_time" : "total_timer_time",
    ),
    elevationGainM: recorded(session.total_ascent, "m", "ascent", "total_ascent"),
    avgSpeedMps: recorded(
      session.enhanced_avg_speed ?? session.avg_speed,
      "m/s",
      "avg-speed",
      session.enhanced_avg_speed !== undefined ? "enhanced_avg_speed" : "avg_speed",
    ),
    maxSpeedMps: recorded(
      session.enhanced_max_speed ?? session.max_speed,
      "m/s",
      "max-speed",
      session.enhanced_max_speed !== undefined ? "enhanced_max_speed" : "max_speed",
    ),
    avgHeartRateBpm: recorded(session.avg_heart_rate, "bpm", "avg-heart-rate", "avg_heart_rate"),
    maxHeartRateBpm: recorded(session.max_heart_rate, "bpm", "max-heart-rate", "max_heart_rate"),
    avgPowerW: recorded(usefulPower ? session.avg_power : undefined, "W", "avg-power", "avg_power"),
    maxPowerW: recorded(usefulPower ? session.max_power : undefined, "W", "max-power", "max_power"),
    normalizedPowerW: recorded(
      usefulPower ? session.normalized_power : undefined,
      "W",
      "normalized-power",
      "normalized_power",
    ),
    avgCadenceRpm: recorded(session.avg_cadence, "rpm", "avg-cadence", "avg_cadence"),
    maxCadenceRpm: recorded(session.max_cadence, "rpm", "max-cadence", "max_cadence"),
    activityEnergyKcal: recorded(session.total_calories, "kcal", "total-calories", "total_calories"),
  } satisfies RideMetrics);
}

function finite(value: number | undefined, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function seriesQuality(quality: RideActivity["sensorQuality"][keyof RideActivity["sensorQuality"]]): "valid" | "degraded" {
  if (!quality || quality.sampleCount === 0) return "degraded";
  return quality.coverage >= 0.8 && quality.invalidSampleCount / quality.sampleCount <= 0.02 ? "valid" : "degraded";
}

function buildFitSeries(
  records: ParsedRecord[],
  rideId: string,
  usefulPower: boolean,
  startTime: string | undefined,
  quality: RideActivity["sensorQuality"],
) {
  const timestamps = records.map((record) => Date.parse(record.timestamp));
  const firstTime = timestamps.find((value) => Number.isFinite(value));
  const points: RideSeriesInputPoint[] = records.map((record, index) => {
    const timestamp = timestamps[index];
    return {
      ...(firstTime !== undefined && timestamp !== undefined && Number.isFinite(timestamp)
        ? { elapsedTimeS: Math.max(0, (timestamp - firstTime) / 1_000) }
        : {}),
      ...(finite(record.distance, 0) !== undefined ? { distanceM: finite(record.distance, 0) } : {}),
      ...(finite(record.position_lat, -90, 90) !== undefined ? { latitude: finite(record.position_lat, -90, 90) } : {}),
      ...(finite(record.position_long, -180, 180) !== undefined ? { longitude: finite(record.position_long, -180, 180) } : {}),
      ...(finite(record.enhanced_altitude ?? record.altitude, -500, 10_000) !== undefined
        ? { elevationM: finite(record.enhanced_altitude ?? record.altitude, -500, 10_000) }
        : {}),
      ...(finite(record.enhanced_speed ?? record.speed, 0, 60) !== undefined
        ? { speedMps: finite(record.enhanced_speed ?? record.speed, 0, 60) }
        : {}),
      ...(finite(record.heart_rate, 30, 260) !== undefined ? { heartRateBpm: finite(record.heart_rate, 30, 260) } : {}),
      ...(usefulPower && finite(record.power, 0, 3_000) !== undefined ? { powerW: finite(record.power, 0, 3_000) } : {}),
      ...(finite(record.cadence, 0, 250) !== undefined ? { cadenceRpm: finite(record.cadence, 0, 250) } : {}),
    };
  });
  return buildRideSeries({
    rideId,
    sourceKind: "fit",
    parserVersion: FIT_ADAPTER_VERSION,
    ...(startTime ? { startTime } : {}),
    seriesMetadata: {
      route: { sourceField: "records.position_lat+position_long", unit: "relative", qualityStatus: seriesQuality(quality.gps) },
      distance: { sourceField: "records.distance", unit: "m", qualityStatus: "valid" },
      elevation: { sourceField: "records.enhanced_altitude|altitude", unit: "m", qualityStatus: "valid" },
      speed: { sourceField: "records.enhanced_speed|speed", unit: "m/s", qualityStatus: seriesQuality(quality.gps) },
      heart_rate: { sourceField: "records.heart_rate", unit: "bpm", qualityStatus: seriesQuality(quality.heart_rate) },
      power: { sourceField: "records.power", unit: "W", qualityStatus: seriesQuality(quality.power) },
      cadence: { sourceField: "records.cadence", unit: "rpm", qualityStatus: seriesQuality(quality.cadence) },
    },
    points,
  });
}

function buildSensorQuality(
  records: ParsedRecord[],
  usefulPower: boolean,
): RideActivity["sensorQuality"] {
  return compactObject({
    gps: sensorQuality(
      records,
      (record) => record.position_lat !== undefined && record.position_long !== undefined ? 1 : undefined,
      (value) => value === 1,
    ),
    heart_rate: sensorQuality(records, (record) => record.heart_rate, (value) => value >= 30 && value <= 260),
    power: usefulPower
      ? sensorQuality(records, (record) => record.power, (value) => value >= 0 && value <= 3_000)
      : undefined,
    cadence: sensorQuality(records, (record) => record.cadence, (value) => value >= 0 && value <= 250),
  });
}

export async function parseFitRide(input: ParseFitInput): Promise<RideRecord> {
  assertUploadSize(input.bytes.byteLength);
  if (!input.fileName.toLowerCase().endsWith(".fit")) {
    throw new RideParseError("UNSUPPORTED_FILE_TYPE", "FIT解析器只接受.fit文件");
  }

  const parser = new FitParser({
    mode: "list",
    force: false,
    lengthUnit: "m",
    speedUnit: "m/s",
  });

  let parsed: ParsedFit;
  try {
    const arrayBuffer: ArrayBuffer = Uint8Array.from(input.bytes).buffer;
    parsed = await parser.parseAsync(arrayBuffer);
  } catch (error) {
    throw new RideParseError("FIT_INVALID_OR_CORRUPT", "FIT文件无效、被截断或校验失败", error);
  }

  const cyclingSessions = (parsed.sessions ?? []).filter(isCyclingSession);
  if (cyclingSessions.length === 0) {
    throw new RideParseError("FIT_NO_CYCLING_SESSION", "FIT文件中没有可识别的骑行活动");
  }
  if (cyclingSessions.length > 1) {
    throw new RideParseError("FIT_MULTIPLE_CYCLING_SESSIONS", "当前版本暂不支持一个FIT文件中的多段骑行");
  }

  const session = cyclingSessions[0]!;
  const records = parsed.records ?? [];
  const usefulPower = hasUsefulPower(records, session);
  const device = readDevice(parsed);
  const sourceIssues: RideIssue[] = [];
  if ((parsed.developer_data_ids?.length ?? 0) > 0 || (parsed.field_descriptions?.length ?? 0) > 0) {
    sourceIssues.push({
      code: "FIT_DEVELOPER_FIELD_IGNORED",
      severity: "warning",
      message: "检测到FIT开发字段；当前版本只使用标准字段",
    });
  }
  const hasPowerFields = records.some((record) => record.power !== undefined) || session.avg_power !== undefined;
  if (hasPowerFields && !usefulPower) {
    sourceIssues.push({
      code: "FIT_ALL_ZERO_POWER_IGNORED",
      severity: "warning",
      message: "FIT功率字段全程为0，按无有效功率数据处理",
    });
  }

  const indoor = session.sub_sport === "indoor_cycling" || session.sub_sport === "spin";
  const startTime = normalizeIso(session.start_time);
  const sensorQuality = buildSensorQuality(records, usefulPower);
  const activity: RideActivity = {
    schemaVersion: RIDE_SCHEMA_VERSION,
    rideId: input.rideId,
    sport: indoor ? "indoor_cycling" : "cycling",
    source: {
      kind: "fit",
      fileName: input.fileName,
      parserVersion: FIT_ADAPTER_VERSION,
      formatVersion: [parsed.protocolVersion, parsed.profileVersion].filter(Boolean).join("/") || undefined,
      deviceManufacturer: device.manufacturer,
      deviceProduct: device.product,
    },
    startTime,
    metrics: buildMetrics(input.rideId, session, usefulPower, startTime),
    sensorQuality,
    sourceIssues,
  };
  return { activity, series: buildFitSeries(records, input.rideId, usefulPower, startTime, sensorQuality) };
}

export async function parseFitActivity(input: ParseFitInput): Promise<RideActivity> {
  return (await parseFitRide(input)).activity;
}
