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

export const FIT_ADAPTER_VERSION = "fit-parser-v0.3";

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

function hasUsefulHeartRate(records: ParsedRecord[], session: ParsedSession): boolean {
  const sessionHeartRate = [session.avg_heart_rate, session.max_heart_rate]
    .some((value) => Number.isFinite(value) && value! >= 30 && value! <= 260);
  if (sessionHeartRate) return true;
  return records.some((record) => Number.isFinite(record.heart_rate) && record.heart_rate! >= 30 && record.heart_rate! <= 260);
}

function hasUsefulCadence(records: ParsedRecord[], session: ParsedSession): boolean {
  const sessionCadence = [session.avg_cadence, session.max_cadence]
    .some((value) => Number.isFinite(value) && value! > 0 && value! <= 250);
  if (sessionCadence) return true;
  return records.some((record) => Number.isFinite(record.cadence) && record.cadence! > 0 && record.cadence! <= 250);
}

function buildMetrics(
  rideId: string,
  session: ParsedSession,
  usefulPower: boolean,
  usefulHeartRate: boolean,
  usefulCadence: boolean,
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
  const movingTimeForAverage = session.total_moving_time ?? session.total_timer_time;
  const distanceForAverage = session.total_distance;
  const calculatedAverageSpeed = Number.isFinite(distanceForAverage) && Number.isFinite(movingTimeForAverage) && movingTimeForAverage! > 0
    ? distanceForAverage! / movingTimeForAverage!
    : undefined;
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
    elevationLossM: recorded(session.total_descent, "m", "descent", "total_descent"),
    // Product average speed is distance divided by riding time, excluding
    // stopped time. FIT's recorded avg_speed may use elapsed time instead.
    avgSpeedMps: calculatedAverageSpeed !== undefined
      ? metric(
        calculatedAverageSpeed,
        "m/s",
        `${rideId}:fit:session:avg-speed-moving-time`,
        "calculated",
        "high",
        "distance-over-moving-time-v0.1",
        {
          sourceField: "session.total_distance/session.total_moving_time",
          sourceUnit: "m/s",
          ...(recordedAt ? { recordedAt } : {}),
        },
      )
      : recorded(
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
    avgHeartRateBpm: recorded(usefulHeartRate ? session.avg_heart_rate : undefined, "bpm", "avg-heart-rate", "avg_heart_rate"),
    maxHeartRateBpm: recorded(usefulHeartRate ? session.max_heart_rate : undefined, "bpm", "max-heart-rate", "max_heart_rate"),
    avgPowerW: recorded(usefulPower ? session.avg_power : undefined, "W", "avg-power", "avg_power"),
    maxPowerW: recorded(usefulPower ? session.max_power : undefined, "W", "max-power", "max_power"),
    normalizedPowerW: recorded(
      usefulPower ? session.normalized_power : undefined,
      "W",
      "normalized-power",
      "normalized_power",
    ),
    avgCadenceRpm: recorded(usefulCadence ? session.avg_cadence : undefined, "rpm", "avg-cadence", "avg_cadence"),
    maxCadenceRpm: recorded(usefulCadence ? session.max_cadence : undefined, "rpm", "max-cadence", "max_cadence"),
    activityEnergyKcal: recorded(session.total_calories, "kcal", "total-calories", "total_calories"),
  } satisfies RideMetrics);
}

function finite(value: number | undefined, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function validFitCoordinate(record: ParsedRecord): { latitude: number; longitude: number } | undefined {
  const latitude = finite(record.position_lat, -90, 90);
  const longitude = finite(record.position_long, -180, 180);
  // FIT devices commonly emit (0,0) as a GPS-unavailable placeholder.
  if (latitude === undefined || longitude === undefined || (latitude === 0 && longitude === 0)) return undefined;
  return { latitude, longitude };
}

function seriesQuality(quality: RideActivity["sensorQuality"][keyof RideActivity["sensorQuality"]]): "valid" | "degraded" {
  if (!quality || quality.sampleCount === 0) return "degraded";
  return quality.coverage >= 0.8 && quality.invalidSampleCount / quality.sampleCount <= 0.02 ? "valid" : "degraded";
}

function buildFitSeries(
  records: ParsedRecord[],
  rideId: string,
  usefulPower: boolean,
  usefulCadence: boolean,
  startTime: string | undefined,
  quality: RideActivity["sensorQuality"],
) {
  const timestamps = records.map((record) => Date.parse(record.timestamp));
  const firstTime = timestamps.find((value) => Number.isFinite(value));
  const points: RideSeriesInputPoint[] = records.map((record, index) => {
    const timestamp = timestamps[index];
    const coordinate = validFitCoordinate(record);
    return {
      ...(firstTime !== undefined && timestamp !== undefined && Number.isFinite(timestamp)
        ? { elapsedTimeS: Math.max(0, (timestamp - firstTime) / 1_000) }
        : {}),
      ...(finite(record.distance, 0) !== undefined ? { distanceM: finite(record.distance, 0) } : {}),
      ...(coordinate ? { latitude: coordinate.latitude, longitude: coordinate.longitude } : {}),
      ...(finite(record.enhanced_altitude ?? record.altitude, -500, 10_000) !== undefined
        ? { elevationM: finite(record.enhanced_altitude ?? record.altitude, -500, 10_000) }
        : {}),
      ...(finite(record.enhanced_speed ?? record.speed, 0, 60) !== undefined
        ? { speedMps: finite(record.enhanced_speed ?? record.speed, 0, 60) }
        : {}),
      ...(finite(record.heart_rate, 30, 260) !== undefined ? { heartRateBpm: finite(record.heart_rate, 30, 260) } : {}),
      ...(usefulPower && finite(record.power, 0, 3_000) !== undefined ? { powerW: finite(record.power, 0, 3_000) } : {}),
      ...(usefulCadence && finite(record.cadence, 0, 250) !== undefined ? { cadenceRpm: finite(record.cadence, 0, 250) } : {}),
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
  usefulHeartRate: boolean,
  usefulCadence: boolean,
): RideActivity["sensorQuality"] {
  return compactObject({
    gps: sensorQuality(
      records,
      (record) => validFitCoordinate(record) ? 1 : undefined,
      (value) => value === 1,
    ),
    heart_rate: usefulHeartRate
      ? sensorQuality(records, (record) => record.heart_rate, (value) => value >= 30 && value <= 260)
      : undefined,
    power: usefulPower
      ? sensorQuality(records, (record) => record.power, (value) => value >= 0 && value <= 3_000)
      : undefined,
    cadence: usefulCadence
      ? sensorQuality(records, (record) => record.cadence, (value) => value >= 0 && value <= 250)
      : undefined,
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
  const usefulHeartRate = hasUsefulHeartRate(records, session);
  const usefulCadence = hasUsefulCadence(records, session);
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
  const hasHeartRateFields = records.some((record) => record.heart_rate !== undefined) || session.avg_heart_rate !== undefined || session.max_heart_rate !== undefined;
  if (hasHeartRateFields && !usefulHeartRate) {
    sourceIssues.push({
      code: "FIT_ALL_ZERO_HEART_RATE_IGNORED",
      severity: "warning",
      message: "FIT心率字段仅包含占位值，已按无有效心率处理",
    });
  }
  const hasCadenceFields = records.some((record) => record.cadence !== undefined) || session.avg_cadence !== undefined || session.max_cadence !== undefined;
  if (hasCadenceFields && !usefulCadence) {
    sourceIssues.push({
      code: "FIT_ALL_ZERO_CADENCE_IGNORED",
      severity: "warning",
      message: "FIT踏频字段全程为0，按无有效踏频数据处理",
    });
  }

  const indoor = session.sub_sport === "indoor_cycling" || session.sub_sport === "spin";
  const startTime = normalizeIso(session.start_time);
  const sensorQuality = buildSensorQuality(records, usefulPower, usefulHeartRate, usefulCadence);
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
    metrics: buildMetrics(input.rideId, session, usefulPower, usefulHeartRate, usefulCadence, startTime),
    sensorQuality,
    sourceIssues,
  };
  return { activity, series: buildFitSeries(records, input.rideId, usefulPower, usefulCadence, startTime, sensorQuality) };
}

export async function parseFitActivity(input: ParseFitInput): Promise<RideActivity> {
  return (await parseFitRide(input)).activity;
}
