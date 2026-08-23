import type { Metric, MetricKey, RideActivity, RideFixture } from "../domain/ride-schema.ts";
import { buildRideSeries, type RideSeriesInputPoint } from "../domain/ride-series.ts";

function metric(
  value: number,
  unit: Metric["unit"],
  evidenceId: string,
  provenance: Metric["provenance"] = "recorded",
  confidence: Metric["confidence"] = "high",
  formulaVersion?: string,
): Metric {
  return {
    value,
    unit,
    evidenceId,
    provenance,
    confidence,
    sourceField: evidenceId,
    sourceUnit: unit,
    qualityStatus: confidence === "low" ? "degraded" : "valid",
    ...(formulaVersion ? { formulaVersion } : {}),
  };
}

function calculated(
  value: number,
  unit: Metric["unit"],
  evidenceId: string,
  formulaVersion: string,
): Metric {
  return metric(value, unit, evidenceId, "calculated", "high", formulaVersion);
}

function activity(
  partial: Omit<RideActivity, "schemaVersion" | "sourceIssues"> & Pick<Partial<RideActivity>, "sourceIssues">,
): RideActivity {
  const metrics = Object.fromEntries(Object.entries(partial.metrics).map(([key, value]) => [
    key,
    value && partial.startTime && !value.recordedAt ? { ...value, recordedAt: partial.startTime } : value,
  ])) as RideActivity["metrics"];
  return {
    schemaVersion: "0.2",
    sourceIssues: [],
    ...partial,
    metrics,
  };
}

const activityFixtures: Omit<RideFixture, "series">[] = [
  {
    fixtureId: "l1-built-in-sample",
    description: "Demo 内置 L1 轨迹样例",
    activity: activity({
      rideId: "ride-l1-built-in-sample",
      sport: "cycling",
      startTime: "2026-08-09T07:30:00+08:00",
      source: { kind: "sample", parserVersion: "fixture-0.2", formatVersion: "normalized-0.2" },
      metrics: {
        distanceM: metric(25_000, "m", "EV-SL1-001"),
        movingTimeS: metric(3_600, "s", "EV-SL1-002"),
        elevationGainM: metric(260, "m", "EV-SL1-003"),
        avgSpeedMps: calculated(25_000 / 3_600, "m/s", "EV-SL1-004", "avg-speed-v0.1"),
      },
      sensorQuality: { gps: { coverage: 0.99, sampleCount: 3_500, invalidSampleCount: 2 } },
    }),
    expected: { valid: true, dataLevel: "L1", analysisMode: "full", requiredIssueCodes: [] },
  },
  {
    fixtureId: "l2-built-in-sample",
    description: "Demo 内置 L2 心率样例",
    activity: activity({
      rideId: "ride-l2-built-in-sample",
      sport: "cycling",
      startTime: "2026-08-09T18:30:00+08:00",
      source: { kind: "sample", parserVersion: "fixture-0.2", formatVersion: "normalized-0.2" },
      metrics: {
        distanceM: metric(35_000, "m", "EV-SL2-001"),
        movingTimeS: metric(4_800, "s", "EV-SL2-002"),
        elevationGainM: metric(410, "m", "EV-SL2-003"),
        avgSpeedMps: calculated(35_000 / 4_800, "m/s", "EV-SL2-004", "avg-speed-v0.1"),
        avgHeartRateBpm: metric(145, "bpm", "EV-SL2-005"),
        maxHeartRateBpm: metric(176, "bpm", "EV-SL2-006"),
        avgCadenceRpm: metric(84, "rpm", "EV-SL2-007"),
      },
      sensorQuality: {
        gps: { coverage: 0.99, sampleCount: 4_700, invalidSampleCount: 2 },
        heart_rate: { coverage: 0.98, sampleCount: 4_680, invalidSampleCount: 3 },
        cadence: { coverage: 0.96, sampleCount: 4_600, invalidSampleCount: 4 },
      },
    }),
    expected: { valid: true, dataLevel: "L2", analysisMode: "full", requiredIssueCodes: [] },
  },
  {
    fixtureId: "l3-built-in-sample",
    description: "Demo 内置 L3 功率样例",
    activity: activity({
      rideId: "ride-l3-built-in-sample",
      sport: "cycling",
      startTime: "2026-08-10T18:00:00+08:00",
      source: { kind: "sample", parserVersion: "fixture-0.2", formatVersion: "normalized-0.2" },
      metrics: {
        distanceM: metric(45_000, "m", "EV-SL3-001"),
        movingTimeS: metric(6_300, "s", "EV-SL3-002"),
        elevationGainM: metric(600, "m", "EV-SL3-003"),
        avgSpeedMps: calculated(45_000 / 6_300, "m/s", "EV-SL3-004", "avg-speed-v0.1"),
        maxSpeedMps: metric(13.2, "m/s", "EV-SL3-010"),
        avgHeartRateBpm: metric(150, "bpm", "EV-SL3-005"),
        maxHeartRateBpm: metric(178, "bpm", "EV-SL3-011"),
        avgPowerW: metric(198, "W", "EV-SL3-006"),
        maxPowerW: metric(720, "W", "EV-SL3-012"),
        normalizedPowerW: calculated(211, "W", "EV-SL3-007", "np-v0.1"),
        avgCadenceRpm: metric(87, "rpm", "EV-SL3-008"),
        maxCadenceRpm: metric(112, "rpm", "EV-SL3-013"),
        activityEnergyKcal: metric(860, "kcal", "EV-SL3-014"),
      },
      sensorQuality: {
        gps: { coverage: 0.99, sampleCount: 6_200, invalidSampleCount: 2 },
        heart_rate: { coverage: 0.98, sampleCount: 6_180, invalidSampleCount: 3 },
        power: { coverage: 0.99, sampleCount: 6_190, invalidSampleCount: 2 },
        cadence: { coverage: 0.98, sampleCount: 6_150, invalidSampleCount: 3 },
      },
    }),
    expected: { valid: true, dataLevel: "L3", analysisMode: "full", requiredIssueCodes: [] },
  },
  {
    fixtureId: "l1-gpx-normal",
    description: "仅 GPS 的正常 GPX 骑行",
    activity: activity({
      rideId: "ride-l1-gpx-normal",
      sport: "cycling",
      startTime: "2026-08-10T07:30:00+08:00",
      source: { kind: "gpx", fileName: "morning-ride.gpx", parserVersion: "fixture-0.2", formatVersion: "1.1" },
      metrics: {
        distanceM: metric(35_200, "m", "EV-L1-001"),
        movingTimeS: metric(4_920, "s", "EV-L1-002"),
        elevationGainM: calculated(386, "m", "EV-L1-003", "elevation-gain-v0.1"),
        avgSpeedMps: calculated(35_200 / 4_920, "m/s", "EV-L1-004", "avg-speed-v0.1"),
        maxSpeedMps: metric(13.2, "m/s", "EV-L1-005"),
      },
      sensorQuality: { gps: { coverage: 0.99, sampleCount: 4_800, invalidSampleCount: 2 } },
    }),
    expected: { valid: true, dataLevel: "L1", analysisMode: "full", requiredIssueCodes: [] },
  },
  {
    fixtureId: "l2-fit-heart-rate",
    description: "含可靠心率的 FIT 骑行",
    activity: activity({
      rideId: "ride-l2-fit-heart-rate",
      sport: "cycling",
      startTime: "2026-08-11T06:45:00+08:00",
      source: {
        kind: "fit",
        fileName: "garmin-heart-rate.fit",
        parserVersion: "fixture-0.2",
        formatVersion: "2.0",
        deviceManufacturer: "garmin",
        deviceProduct: "edge",
      },
      metrics: {
        distanceM: metric(42_000, "m", "EV-L2-001"),
        movingTimeS: metric(6_000, "s", "EV-L2-002"),
        elevationGainM: metric(520, "m", "EV-L2-003"),
        avgSpeedMps: calculated(7, "m/s", "EV-L2-004", "avg-speed-v0.1"),
        maxSpeedMps: metric(14.8, "m/s", "EV-L2-005"),
        avgHeartRateBpm: metric(146, "bpm", "EV-L2-006"),
        maxHeartRateBpm: metric(178, "bpm", "EV-L2-007"),
        avgCadenceRpm: metric(84, "rpm", "EV-L2-008"),
      },
      sensorQuality: {
        gps: { coverage: 0.99, sampleCount: 5_900, invalidSampleCount: 2 },
        heart_rate: { coverage: 0.98, sampleCount: 5_880, invalidSampleCount: 3 },
        cadence: { coverage: 0.95, sampleCount: 5_700, invalidSampleCount: 4 },
      },
    }),
    expected: { valid: true, dataLevel: "L2", analysisMode: "full", requiredIssueCodes: [] },
  },
  {
    fixtureId: "l3-fit-power",
    description: "含可靠功率和心率的 FIT 骑行",
    activity: activity({
      rideId: "ride-l3-fit-power",
      sport: "cycling",
      startTime: "2026-08-12T18:30:00+08:00",
      source: {
        kind: "fit",
        fileName: "power-meter.fit",
        parserVersion: "fixture-0.2",
        formatVersion: "2.0",
        deviceManufacturer: "wahoo",
        deviceProduct: "elemnt",
      },
      metrics: {
        distanceM: metric(50_000, "m", "EV-L3-001"),
        movingTimeS: metric(7_200, "s", "EV-L3-002"),
        elevationGainM: metric(680, "m", "EV-L3-003"),
        avgSpeedMps: calculated(50_000 / 7_200, "m/s", "EV-L3-004", "avg-speed-v0.1"),
        maxSpeedMps: metric(16.1, "m/s", "EV-L3-005"),
        avgHeartRateBpm: metric(151, "bpm", "EV-L3-006"),
        maxHeartRateBpm: metric(182, "bpm", "EV-L3-007"),
        avgPowerW: metric(205, "W", "EV-L3-008"),
        normalizedPowerW: calculated(218, "W", "EV-L3-009", "np-v0.1"),
        avgCadenceRpm: metric(87, "rpm", "EV-L3-010"),
      },
      sensorQuality: {
        gps: { coverage: 0.99, sampleCount: 7_100, invalidSampleCount: 2 },
        heart_rate: { coverage: 0.99, sampleCount: 7_080, invalidSampleCount: 3 },
        power: { coverage: 0.99, sampleCount: 7_090, invalidSampleCount: 2 },
        cadence: { coverage: 0.98, sampleCount: 7_000, invalidSampleCount: 5 },
      },
    }),
    expected: { valid: true, dataLevel: "L3", analysisMode: "full", requiredIssueCodes: [] },
  },
  {
    fixtureId: "gpx-no-timestamps",
    description: "没有时间戳的 GPX，只能做基础路线事实",
    activity: activity({
      rideId: "ride-gpx-no-timestamps",
      sport: "cycling",
      source: { kind: "gpx", fileName: "route-only.gpx", parserVersion: "fixture-0.2", formatVersion: "1.1" },
      metrics: {
        distanceM: calculated(28_500, "m", "EV-GPX-001", "haversine-v0.1"),
        elevationGainM: calculated(310, "m", "EV-GPX-002", "elevation-gain-v0.1"),
      },
      sensorQuality: { gps: { coverage: 0.93, sampleCount: 2_400, invalidSampleCount: 8 } },
    }),
    expected: { valid: true, dataLevel: "L1", analysisMode: "basic", requiredIssueCodes: ["MISSING_TIMESTAMPS"] },
  },
  {
    fixtureId: "l1-gps-spike",
    description: "GPX孤立跳点已在指标计算前过滤",
    activity: activity({
      rideId: "ride-l1-gps-spike",
      sport: "cycling",
      startTime: "2026-08-18T00:00:00Z",
      source: { kind: "gpx", fileName: "gps-spike.gpx", parserVersion: "gpx-parser-v0.3", formatVersion: "1.1" },
      metrics: {
        distanceM: calculated(15, "m", "EV-GPS-SPIKE-001", "haversine-v0.1"),
        elapsedTimeS: calculated(120, "s", "EV-GPS-SPIKE-002", "timestamp-span-v0.1"),
        elevationGainM: calculated(0, "m", "EV-GPS-SPIKE-003", "positive-elevation-delta-v0.1"),
      },
      sensorQuality: { gps: { coverage: 2 / 3, sampleCount: 3, invalidSampleCount: 1 } },
      sourceIssues: [{
        code: "GPX_GPS_SPIKE_FILTERED",
        severity: "warning",
        message: "已按gpx-gps-quality-v0.1过滤1个GPS孤立跳点",
      }],
    }),
    expected: {
      valid: true,
      dataLevel: "L1",
      analysisMode: "basic",
      requiredIssueCodes: ["GPX_GPS_SPIKE_FILTERED"],
    },
  },
  {
    fixtureId: "fit-heart-rate-dropout",
    description: "FIT 心率覆盖不足，降级为 L1",
    activity: activity({
      rideId: "ride-fit-heart-rate-dropout",
      sport: "cycling",
      startTime: "2026-08-13T07:00:00+08:00",
      source: { kind: "fit", fileName: "heart-rate-dropout.fit", parserVersion: "fixture-0.2", formatVersion: "2.0" },
      metrics: {
        distanceM: metric(30_000, "m", "EV-HRD-001"),
        movingTimeS: metric(4_500, "s", "EV-HRD-002"),
        avgSpeedMps: calculated(30_000 / 4_500, "m/s", "EV-HRD-003", "avg-speed-v0.1"),
        avgHeartRateBpm: metric(143, "bpm", "EV-HRD-004", "recorded", "low"),
      },
      sensorQuality: {
        gps: { coverage: 0.98, sampleCount: 4_400, invalidSampleCount: 4 },
        heart_rate: { coverage: 0.42, sampleCount: 1_900, invalidSampleCount: 120 },
      },
    }),
    expected: { valid: true, dataLevel: "L1", analysisMode: "full", requiredIssueCodes: ["HEART_RATE_NOT_USABLE"] },
  },
  {
    fixtureId: "fit-power-dropout-with-heart-rate",
    description: "FIT 功率掉线但心率可靠，降级为 L2",
    activity: activity({
      rideId: "ride-fit-power-dropout",
      sport: "cycling",
      startTime: "2026-08-13T18:00:00+08:00",
      source: { kind: "fit", fileName: "power-dropout.fit", parserVersion: "fixture-0.2", formatVersion: "2.0" },
      metrics: {
        distanceM: metric(38_000, "m", "EV-PWD-001"),
        movingTimeS: metric(5_400, "s", "EV-PWD-002"),
        avgSpeedMps: calculated(38_000 / 5_400, "m/s", "EV-PWD-003", "avg-speed-v0.1"),
        avgHeartRateBpm: metric(149, "bpm", "EV-PWD-004"),
        avgPowerW: metric(190, "W", "EV-PWD-005", "recorded", "low"),
      },
      sensorQuality: {
        gps: { coverage: 0.98, sampleCount: 5_300, invalidSampleCount: 5 },
        heart_rate: { coverage: 0.97, sampleCount: 5_200, invalidSampleCount: 6 },
        power: { coverage: 0.63, sampleCount: 3_400, invalidSampleCount: 180 },
      },
    }),
    expected: { valid: true, dataLevel: "L2", analysisMode: "full", requiredIssueCodes: ["POWER_NOT_USABLE"] },
  },
  {
    fixtureId: "fit-unknown-developer-field",
    description: "FIT 含未知开发字段，但标准心率字段仍可安全使用",
    activity: activity({
      rideId: "ride-fit-unknown-developer-field",
      sport: "cycling",
      startTime: "2026-08-13T19:00:00+08:00",
      source: {
        kind: "fit",
        fileName: "developer-fields.fit",
        parserVersion: "fixture-0.2",
        formatVersion: "2.0",
        deviceManufacturer: "unknown",
      },
      metrics: {
        distanceM: metric(32_000, "m", "EV-DEV-001"),
        movingTimeS: metric(4_800, "s", "EV-DEV-002"),
        avgSpeedMps: calculated(32_000 / 4_800, "m/s", "EV-DEV-003", "avg-speed-v0.1"),
        avgHeartRateBpm: metric(144, "bpm", "EV-DEV-004"),
      },
      sensorQuality: {
        gps: { coverage: 0.98, sampleCount: 4_700, invalidSampleCount: 3 },
        heart_rate: { coverage: 0.96, sampleCount: 4_600, invalidSampleCount: 5 },
      },
      sourceIssues: [
        {
          code: "FIT_DEVELOPER_FIELD_IGNORED",
          severity: "warning",
          message: "存在未识别的 FIT 开发字段，已忽略且不参与分析",
        },
      ],
    }),
    expected: { valid: true, dataLevel: "L2", analysisMode: "full", requiredIssueCodes: ["FIT_DEVELOPER_FIELD_IGNORED"] },
  },
  {
    fixtureId: "fit-truncated-file",
    description: "FIT 文件截断，解析层错误进入统一拒绝状态",
    activity: activity({
      rideId: "ride-fit-truncated",
      sport: "cycling",
      source: { kind: "fit", fileName: "truncated.fit", parserVersion: "fixture-0.2", formatVersion: "2.0" },
      metrics: {},
      sensorQuality: {},
      sourceIssues: [
        {
          code: "FIT_TRUNCATED_FILE",
          severity: "error",
          message: "FIT 文件长度与文件头声明不一致",
        },
      ],
    }),
    expected: { valid: false, dataLevel: "L1", analysisMode: "rejected", requiredIssueCodes: ["FIT_TRUNCATED_FILE"] },
  },
  {
    fixtureId: "short-fit-ride",
    description: "短于 3km 和 10 分钟的 FIT，只展示基础事实",
    activity: activity({
      rideId: "ride-short-fit",
      sport: "cycling",
      startTime: "2026-08-14T08:00:00+08:00",
      source: { kind: "fit", fileName: "short.fit", parserVersion: "fixture-0.2", formatVersion: "2.0" },
      metrics: {
        distanceM: metric(2_900, "m", "EV-SHORT-001"),
        movingTimeS: metric(599, "s", "EV-SHORT-002"),
        avgSpeedMps: calculated(2_900 / 599, "m/s", "EV-SHORT-003", "avg-speed-v0.1"),
      },
      sensorQuality: { gps: { coverage: 0.96, sampleCount: 570, invalidSampleCount: 1 } },
    }),
    expected: { valid: true, dataLevel: "L1", analysisMode: "basic", requiredIssueCodes: [] },
  },
  {
    fixtureId: "inconsistent-fit-summary",
    description: "FIT 汇总均速与距离/时间矛盾，拒绝深度分析",
    activity: activity({
      rideId: "ride-inconsistent-fit",
      sport: "cycling",
      startTime: "2026-08-14T09:00:00+08:00",
      source: { kind: "fit", fileName: "inconsistent.fit", parserVersion: "fixture-0.2", formatVersion: "2.0" },
      metrics: {
        distanceM: metric(30_000, "m", "EV-CONFLICT-001"),
        movingTimeS: metric(3_600, "s", "EV-CONFLICT-002"),
        avgSpeedMps: metric(5, "m/s", "EV-CONFLICT-003"),
      },
      sensorQuality: { gps: { coverage: 0.99, sampleCount: 3_500, invalidSampleCount: 2 } },
    }),
    expected: { valid: false, dataLevel: "L1", analysisMode: "rejected", requiredIssueCodes: ["INCONSISTENT_AVG_SPEED"] },
  },
];

function buildFixtureSeries(activity: RideActivity) {
  const distance = activity.metrics.distanceM?.value;
  if (distance === undefined || distance <= 0) {
    return buildRideSeries({
      rideId: activity.rideId,
      sourceKind: activity.source.kind,
      parserVersion: activity.source.parserVersion,
      points: [],
    });
  }

  const duration = activity.metrics.movingTimeS?.value ?? activity.metrics.elapsedTimeS?.value;
  const hasTiming = !(activity.source.kind === "gpx" && !activity.startTime) && duration !== undefined;
  const points: RideSeriesInputPoint[] = Array.from({ length: 13 }, (_, index) => index / 12).map((ratio) => ({
    latitude: 31.2 + ratio * 0.02 + Math.sin(ratio * Math.PI * 2) * 0.004,
    longitude: 121.4 + ratio * 0.02 + Math.sin(ratio * Math.PI * 3) * 0.007,
    distanceM: distance * ratio,
    ...(hasTiming ? { elapsedTimeS: duration * ratio } : {}),
    ...(hasTiming && activity.metrics.avgSpeedMps ? {
      speedMps: activity.metrics.avgSpeedMps.value * (1 + 0.16 * Math.sin(ratio * Math.PI * 4) + 0.06 * Math.cos(ratio * Math.PI * 7)),
    } : {}),
    ...(activity.metrics.elevationGainM ? {
      elevationM: 30 + activity.metrics.elevationGainM.value * (0.16 * ratio + 0.07 * Math.sin(ratio * Math.PI * 2) + 0.04 * Math.sin(ratio * Math.PI * 5)),
    } : {}),
    ...(activity.metrics.avgHeartRateBpm ? {
      heartRateBpm: activity.metrics.avgHeartRateBpm.value + 9 * Math.sin(ratio * Math.PI * 1.4) - 5 * Math.cos(ratio * Math.PI * 4),
    } : {}),
    ...(activity.metrics.avgPowerW ? {
      powerW: activity.metrics.avgPowerW.value * (0.84 + 0.23 * Math.sin(ratio * Math.PI * 5) + 0.08 * Math.cos(ratio * Math.PI * 2)),
    } : {}),
    ...(activity.metrics.avgCadenceRpm ? {
      cadenceRpm: activity.metrics.avgCadenceRpm.value + 7 * Math.sin(ratio * Math.PI * 4) - 3 * Math.cos(ratio * Math.PI * 7),
    } : {}),
  }));
  return buildRideSeries({
    rideId: activity.rideId,
    sourceKind: activity.source.kind,
    parserVersion: activity.source.parserVersion,
    ...(activity.startTime ? { startTime: activity.startTime } : {}),
    points,
  });
}

export const rideFixtures: RideFixture[] = activityFixtures.map((fixture) => ({
  ...fixture,
  series: buildFixtureSeries(fixture.activity),
}));

export function getRideFixture(fixtureId: string): RideFixture {
  const fixture = rideFixtures.find((item) => item.fixtureId === fixtureId);
  if (!fixture) throw new Error(`Unknown ride fixture: ${fixtureId}`);
  return fixture;
}

export const fixtureMetricKeys: MetricKey[] = [
  "distanceM",
  "elapsedTimeS",
  "movingTimeS",
  "elevationGainM",
  "avgSpeedMps",
  "maxSpeedMps",
  "avgHeartRateBpm",
  "maxHeartRateBpm",
  "avgPowerW",
  "maxPowerW",
  "normalizedPowerW",
  "avgCadenceRpm",
  "maxCadenceRpm",
  "activityEnergyKcal",
];
