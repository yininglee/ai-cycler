import { buildRideTimingSummary, type RideTimingSummary } from "../domain/ride-timing.ts";
import { buildRideElevationSummary, type RideElevationSummary } from "../domain/ride-elevation.ts";
import { buildRideRouteShapeSummary, type RideRouteShapeSummary } from "../domain/ride-route-shape.ts";
import { buildRideEventClimbSummary } from "../domain/ride-event-climbs.ts";
import { getRideFixture } from "../fixtures/rides.ts";
import type { DataSourceKind, Metric, MetricKey, RideRecord, SensorKind } from "../domain/ride-schema.ts";
import { validateRideRecord } from "../domain/ride-series.ts";
import { buildRideVisualDisplay, type RideVisualDisplay } from "./ride-series-view-model.ts";
import { platformInfo } from "../ux/platform-catalog.ts";

export const RIDE_DETAIL_UI_VERSION = "ride-detail-ui-v0.3" as const;

export const DEMO_RIDE_IDS = [
  "l1-built-in-sample",
  "l2-built-in-sample",
  "l3-built-in-sample",
  "l3-power-preview",
  "gpx-no-timestamps",
  "fit-truncated-file",
] as const;

export type DemoRideId = typeof DEMO_RIDE_IDS[number];

const METRIC_LABELS: Record<MetricKey, string> = {
  distanceM: "距离",
  elapsedTimeS: "总时间",
  movingTimeS: "骑行时间",
  elevationGainM: "累计爬升",
  elevationLossM: "累计下降",
  avgSpeedMps: "平均速度",
  maxSpeedMps: "最高速度",
  avgHeartRateBpm: "平均心率",
  maxHeartRateBpm: "最高心率",
  avgPowerW: "平均功率",
  maxPowerW: "最大功率",
  normalizedPowerW: "标准化功率",
  avgCadenceRpm: "平均踏频",
  maxCadenceRpm: "最大踏频",
  activityEnergyKcal: "运动消耗",
};

const SUMMARY_METRICS: MetricKey[] = [
  "distanceM",
  "movingTimeS",
  "avgSpeedMps",
  "elevationGainM",
  "activityEnergyKcal",
];

const DETAIL_GROUPS: Array<{
  key: string;
  title: string;
  description: string;
  metricKeys: MetricKey[];
}> = [
  {
    key: "speed",
    title: "速度",
    description: "本次骑行的聚合速度数据",
    metricKeys: ["avgSpeedMps", "maxSpeedMps"],
  },
  {
    key: "distance",
    title: "里程",
    description: "本次骑行可靠记录的里程",
    metricKeys: ["distanceM"],
  },
  {
    key: "timing",
    title: "计时",
    description: "按文件时间信息展示，缺少可信时间时隐藏",
    metricKeys: ["movingTimeS", "elapsedTimeS"],
  },
  {
    key: "cruise",
    title: "巡航",
    description: "满足稳定骑行规则的区段汇总",
    metricKeys: [],
  },
  {
    key: "heart-rate",
    title: "心率",
    description: "仅在心率记录达到可靠性要求时展示",
    metricKeys: ["avgHeartRateBpm", "maxHeartRateBpm"],
  },
  {
    key: "power",
    title: "功率",
    description: "仅在功率记录达到可靠性要求时展示",
    metricKeys: ["avgPowerW", "maxPowerW"],
  },
  {
    key: "training-load",
    title: "训练强度",
    description: "只展示满足当前算法与质量前提的指标",
    metricKeys: [],
  },
  {
    key: "cadence",
    title: "踏频",
    description: "仅在文件包含可靠踏频记录时展示",
    metricKeys: ["avgCadenceRpm", "maxCadenceRpm"],
  },
  {
    key: "elevation",
    title: "海拔",
    description: "按设备记录或海拔序列规则计算",
    metricKeys: [],
  },
  {
    key: "other",
    title: "其他",
    description: "可追溯的设备记录或合规计算结果",
    metricKeys: ["activityEnergyKcal"],
  },
];

const SENSOR_LABELS: Record<SensorKind, string> = {
  gps: "轨迹",
  heart_rate: "心率",
  power: "功率",
  cadence: "踏频",
};

export interface RideMetricDisplay {
  claimId: string;
  label: string;
  value: string;
  evidenceId: string;
  sourceLabel: string;
}

export interface RideDetailSection {
  key: string;
  title: string;
  description: string;
  metrics: RideMetricDisplay[];
}

export interface RideCruiseSegmentDisplay {
  id: string;
  label: string;
  timeRangeLabel: string;
  durationLabel: string;
  distanceLabel?: string;
  averageSpeedLabel: string;
  variabilityLabel: string;
}

export interface RideTimingDisplay {
  sourceLabel: string;
  cruiseSegments: RideCruiseSegmentDisplay[];
}

export interface RidePageViewModel {
  uiVersion: typeof RIDE_DETAIL_UI_VERSION;
  id: string;
  fixtureDescription: string;
  rejected: boolean;
  factCards: RideMetricDisplay[];
  detailSections: RideDetailSection[];
  rideMeta: {
    dateLabel?: string;
    titleLabel: string;
    sourceLabel: string;
    summaryLabel: string;
  };
  visuals: RideVisualDisplay;
  timing: RideTimingDisplay;
  dataQuality: {
    sourceLabel: string;
    note: string;
    sensors: Array<{
      key: SensorKind;
      label: string;
      coverageLabel: string;
      sampleLabel: string;
    }>;
    issueCodes: string[];
  };
}

export function isDemoRideId(value: string): value is DemoRideId {
  return (DEMO_RIDE_IDS as readonly string[]).includes(value);
}

function metricSourceLabel(metric: Metric, sourceKind: DataSourceKind): string {
  if (sourceKind === "platform_summary") return metric.provenance === "calculated" ? "按平台起止时间计算" : "平台摘要";
  if (metric.provenance === "calculated") return `规则计算 · ${metric.formulaVersion}`;
  if (metric.provenance === "estimated") return "估算 · 仅供参考";
  return sourceKind === "sample" ? "内置样例" : "设备记录";
}

function compactNumber(value: number, fractionDigits = 1): string {
  return Number(value.toFixed(fractionDigits)).toString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

function formatClockOffset(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatMetricValue(metricKey: MetricKey, metric: Metric): string {
  if (metricKey === "distanceM") return `${compactNumber(metric.value / 1_000)} km`;
  if (metricKey === "elapsedTimeS" || metricKey === "movingTimeS") return formatDuration(metric.value);
  if (metricKey === "avgSpeedMps" || metricKey === "maxSpeedMps") return `${compactNumber(metric.value * 3.6)} km/h`;
  if (metricKey === "elevationGainM" || metricKey === "elevationLossM") return `${Math.round(metric.value)} m`;
  if (metricKey === "avgHeartRateBpm" || metricKey === "maxHeartRateBpm") return `${Math.round(metric.value)} bpm`;
  if (metricKey === "avgPowerW" || metricKey === "maxPowerW" || metricKey === "normalizedPowerW") return `${Math.round(metric.value)} W`;
  if (metricKey === "avgCadenceRpm" || metricKey === "maxCadenceRpm") return `${Math.round(metric.value)} rpm`;
  return `${Math.round(metric.value)} kcal`;
}

function toMetricDisplay(metricKey: MetricKey, metric: Metric, rideId: string, sourceKind: DataSourceKind): RideMetricDisplay {
  return {
    claimId: `claim:${rideId}:${metricKey}`,
    label: METRIC_LABELS[metricKey],
    value: formatMetricValue(metricKey, metric),
    evidenceId: metric.evidenceId,
    sourceLabel: metricSourceLabel(metric, sourceKind),
  };
}

function timingSourceLabel(timing: RideTimingSummary): string {
  if (timing.source === "device_recorded") return "设备聚合计时";
  if (timing.source === "rule_inferred") return `规则计算 · ${timing.rulesVersion}`;
  return "当前记录不可计算";
}

function timingMetric(
  rideId: string,
  key: string,
  label: string,
  value: string,
  sourceLabel: string,
  rulesVersion: string,
): RideMetricDisplay {
  return {
    claimId: `display:${rideId}:timing:${key}`,
    label,
    value,
    evidenceId: `${rideId}:timing:${rulesVersion}:${key}`,
    sourceLabel,
  };
}

function elevationSourceLabel(source: RideElevationSummary["gainSource"], rulesVersion: string): string {
  if (source === "device_recorded") return "设备记录";
  if (source === "sample_recorded") return "内置样例";
  return `规则计算 · ${rulesVersion}`;
}

function elevationMetric(
  rideId: string,
  key: string,
  label: string,
  valueM: number | undefined,
  source: RideElevationSummary["gainSource"],
  rulesVersion: string,
): RideMetricDisplay[] {
  if (valueM === undefined) return [];
  return [{
    claimId: `display:${rideId}:elevation:${key}`,
    label,
    value: `${Math.round(valueM)} m`,
    evidenceId: `${rideId}:elevation:${rulesVersion}:${key}`,
    sourceLabel: elevationSourceLabel(source, rulesVersion),
  }];
}

function buildElevationMetrics(rideId: string, elevation: RideElevationSummary): RideMetricDisplay[] {
  return [
    ...elevationMetric(rideId, "gain", "累计爬升", elevation.gainM, elevation.gainSource, elevation.rulesVersion),
    ...elevationMetric(rideId, "loss", "累计下降", elevation.lossM, elevation.lossSource, elevation.rulesVersion),
    ...elevationMetric(rideId, "max", "最高海拔", elevation.maxM, "rule_calculated", elevation.rulesVersion),
    ...elevationMetric(rideId, "min", "最低海拔", elevation.minM, "rule_calculated", elevation.rulesVersion),
    ...elevationMetric(rideId, "range", "海拔范围", elevation.rangeM, "rule_calculated", elevation.rulesVersion),
  ];
}

function buildRouteShapeMetrics(rideId: string, routeShape: RideRouteShapeSummary | undefined): RideMetricDisplay[] {
  if (!routeShape?.isAvailable) return [];
  const sourceLabel = `规则计算 · ${routeShape.rulesVersion}`;
  return [
    {
      claimId: `display:${rideId}:route-shape:flat-distance`,
      label: "平路里程",
      value: `${compactNumber(routeShape.trendFlatDistanceM / 1_000)} km`,
      evidenceId: `${rideId}:route-shape:${routeShape.rulesVersion}:flat-distance`,
      sourceLabel,
    },
    {
      claimId: `display:${rideId}:route-shape:climb-distance`,
      label: "爬坡里程",
      value: `${compactNumber(routeShape.trendClimbDistanceM / 1_000)} km`,
      evidenceId: `${rideId}:route-shape:${routeShape.rulesVersion}:climb-distance`,
      sourceLabel,
    },
  ];
}

function buildTimingMetrics(
  rideId: string,
  timing: RideTimingSummary,
  group: "speed" | "timing" | "cruise",
): RideMetricDisplay[] {
  if (timing.source === "unavailable") return [];
  const aggregateSource = timingSourceLabel(timing);
  const recordedSource = timing.source === "device_recorded" ? "设备记录" : aggregateSource;
  const stoppedSource = timing.source === "device_recorded" ? "设备计时差值" : aggregateSource;
  const ruleSource = `规则计算 · ${timing.rulesVersion}`;
  const metrics: RideMetricDisplay[] = [];
  if (group === "timing") {
    if (timing.elapsedTimeS !== undefined) metrics.push(timingMetric(rideId, "elapsed", "总时间", formatDuration(timing.elapsedTimeS), recordedSource, timing.rulesVersion));
    if (timing.movingTimeS !== undefined) metrics.push(timingMetric(rideId, "moving", "骑行时间", formatDuration(timing.movingTimeS), recordedSource, timing.rulesVersion));
    if (timing.stoppedTimeS !== undefined) metrics.push(timingMetric(rideId, "stopped", "停歇", formatDuration(timing.stoppedTimeS), stoppedSource, timing.rulesVersion));
  }
  if (group === "speed") {
    if (timing.elapsedAverageSpeedMps !== undefined) metrics.push(timingMetric(rideId, "elapsed-average-speed", "总均速", `${compactNumber(timing.elapsedAverageSpeedMps * 3.6)} km/h`, ruleSource, timing.rulesVersion));
    if (timing.movingAverageSpeedMps !== undefined) metrics.push(timingMetric(rideId, "moving-average-speed", "移动均速", `${compactNumber(timing.movingAverageSpeedMps * 3.6)} km/h`, ruleSource, timing.rulesVersion));
  }

  if (group === "cruise" && timing.cruiseSegments.length > 0) {
    const cruiseDurationS = timing.cruiseSegments.reduce((sum, segment) => sum + segment.durationS, 0);
    const cruiseDistanceM = timing.cruiseSegments.every((segment) => segment.distanceM !== undefined)
      ? timing.cruiseSegments.reduce((sum, segment) => sum + (segment.distanceM ?? 0), 0)
      : undefined;
    const weightedSpeed = timing.cruiseSegments.reduce((sum, segment) => sum + segment.averageSpeedMps * segment.durationS, 0) / cruiseDurationS;
    metrics.push(timingMetric(rideId, "cruise-duration", "巡航时长", formatDuration(cruiseDurationS), ruleSource, timing.rulesVersion));
    if (cruiseDistanceM !== undefined) metrics.push(timingMetric(rideId, "cruise-distance", "巡航距离", `${compactNumber(cruiseDistanceM / 1_000)} km`, ruleSource, timing.rulesVersion));
    metrics.push(timingMetric(rideId, "cruise-average-speed", "巡航均速", `${compactNumber(weightedSpeed * 3.6)} km/h`, ruleSource, timing.rulesVersion));
  }
  return metrics;
}

function buildTimingDisplay(timing: RideTimingSummary): RideTimingDisplay {
  return {
    sourceLabel: timingSourceLabel(timing),
    cruiseSegments: timing.cruiseSegments.map((segment, index) => ({
      id: `cruise-${index + 1}-${Math.round(segment.startElapsedTimeS)}`,
      label: segment.isLong ? `长巡航 ${index + 1}` : `巡航 ${index + 1}`,
      timeRangeLabel: `${formatClockOffset(segment.startElapsedTimeS)}–${formatClockOffset(segment.endElapsedTimeS)}`,
      durationLabel: formatDuration(segment.durationS),
      ...(segment.distanceM !== undefined ? { distanceLabel: `${compactNumber(segment.distanceM / 1_000)} km` } : {}),
      averageSpeedLabel: `${compactNumber(segment.averageSpeedMps * 3.6)} km/h`,
      variabilityLabel: `速度波动 ${compactNumber(segment.speedCoefficientOfVariation * 100)}%`,
    })),
  };
}

function sourceKindLabel(sourceKind: DataSourceKind): string {
  if (sourceKind === "sample") return "内置演示样例";
  if (sourceKind === "platform_summary") return "骑行摘要";
  return sourceKind === "fit" ? "FIT 设备文件" : "GPX 轨迹文件";
}

function formatRideDate(startTime: string | undefined): string | undefined {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(startTime));
}

export function formatRideTitle(startTime: string | undefined): string {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return "骑行记录";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(startTime));
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? `${month}月${day}日骑行` : "骑行记录";
}

export function buildRidePageViewModelFromRecord(
  record: RideRecord,
  fixtureDescription?: string,
): RidePageViewModel {
  const { activity, series } = record;
  const { source } = activity;
  const kindLabel = sourceKindLabel(source.kind);
  const sourceLabel = source.platformId ? `${platformInfo(source.platformId).name} · ${kindLabel}` : kindLabel;
  const dateLabel = formatRideDate(activity.startTime);
  const validation = validateRideRecord(record);
  const recordIsValid = validation.valid;
  const timing = recordIsValid ? buildRideTimingSummary(record) : undefined;
  const elevation = recordIsValid ? buildRideElevationSummary(record) : undefined;
  const routeShape = elevation ? buildRideRouteShapeSummary(elevation) : undefined;
  const eventClimbs = elevation && routeShape ? buildRideEventClimbSummary(elevation, routeShape, record) : undefined;
  const summaryMetrics: MetricKey[] = source.kind === "platform_summary" ? ["distanceM", "elapsedTimeS"] : SUMMARY_METRICS;
  const factCards = summaryMetrics.flatMap((metricKey) => {
    const metric = recordIsValid ? activity.metrics[metricKey] : undefined;
    return metric ? [toMetricDisplay(metricKey, metric, activity.rideId, source.kind)] : [];
  });
  const detailSections = DETAIL_GROUPS.flatMap((group) => {
    const metricKeys = group.key === "speed" && timing?.source !== "unavailable"
      ? group.metricKeys.filter((metricKey) => metricKey !== "avgSpeedMps")
      : group.metricKeys;
    const metrics = metricKeys.flatMap((metricKey) => {
      const metric = recordIsValid ? activity.metrics[metricKey] : undefined;
      return metric ? [toMetricDisplay(metricKey, metric, activity.rideId, source.kind)] : [];
    });
    const timingMetrics = timing && (group.key === "speed" || group.key === "timing" || group.key === "cruise")
      ? buildTimingMetrics(activity.rideId, timing, group.key)
      : [];
    const elevationMetrics = group.key === "elevation" && elevation
      ? buildElevationMetrics(activity.rideId, elevation)
      : [];
    const routeShapeMetrics = group.key === "distance"
      ? buildRouteShapeMetrics(activity.rideId, routeShape)
      : [];
    const displayedMetrics = group.key === "speed" && timingMetrics.length > 0
      ? [...timingMetrics, ...metrics]
      : timingMetrics.length > 0 ? timingMetrics : elevationMetrics.length > 0 ? elevationMetrics : [...metrics, ...routeShapeMetrics];
    return displayedMetrics.length > 0 ? [{ ...group, metrics: displayedMetrics }] : [];
  });
  const sensors = (Object.entries(activity.sensorQuality) as Array<[
    SensorKind,
    NonNullable<typeof activity.sensorQuality[SensorKind]>,
  ]>).map(([key, quality]) => ({
    key,
    label: SENSOR_LABELS[key],
    coverageLabel: `覆盖 ${Math.round(quality.coverage * 100)}%`,
    sampleLabel: `${quality.sampleCount.toLocaleString("zh-CN")} 个样本 · ${quality.invalidSampleCount} 个无效`,
  }));
  return {
    uiVersion: RIDE_DETAIL_UI_VERSION,
    id: activity.rideId,
    fixtureDescription: fixtureDescription ?? (source.kind === "platform_summary" ? "已同步的骑行摘要" : "已导入的 FIT/GPX 骑行记录"),
    rejected: !recordIsValid,
    factCards,
    detailSections,
    rideMeta: {
      ...(dateLabel ? { dateLabel } : {}),
      titleLabel: formatRideTitle(activity.startTime),
      sourceLabel,
      summaryLabel: [dateLabel, sourceLabel].filter(Boolean).join(" · "),
    },
    visuals: recordIsValid ? buildRideVisualDisplay({ activity, series }, sourceLabel, timing?.cruiseSegments ?? [], elevation, routeShape, eventClimbs) : { charts: [] },
    timing: timing ? buildTimingDisplay(timing) : { sourceLabel: "当前记录不可计算", cruiseSegments: [] },
    dataQuality: {
      sourceLabel,
      note: source.kind === "platform_summary" ? "当前记录只有骑行摘要。轨迹和传感器指标可从原始骑行文件获取。"
        : source.kind === "sample"
        ? "当前为内置演示样例，质量参数仅用于验证界面与规则，不代表真实设备兼容结果。"
        : "只展示通过当前质量规则的数据；缺失或不可靠的项目不会用 0 代替。",
      sensors,
      issueCodes: validation.issues.map((item) => item.code),
    },
  };
}

export function buildRidePageViewModel(id: DemoRideId): RidePageViewModel {
  const fixture = getRideFixture(id);
  return {
    ...buildRidePageViewModelFromRecord(
    { activity: fixture.activity, series: fixture.series },
    fixture.description,
    ),
    id,
  };
}
