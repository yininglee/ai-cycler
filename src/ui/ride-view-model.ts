import { generateB0RideAnalysis, type B0RideAnalysis } from "../domain/ride-summary.ts";
import { getRideFixture } from "../fixtures/rides.ts";
import type { DataSourceKind, Metric, MetricKey, RideRecord, SensorKind } from "../domain/ride-schema.ts";
import { validateRideRecord } from "../domain/ride-series.ts";
import { buildRideVisualDisplay, type RideVisualDisplay } from "./ride-series-view-model.ts";

export const RIDE_DETAIL_UI_VERSION = "ride-detail-ui-v0.2" as const;

export const DEMO_RIDE_IDS = [
  "l1-built-in-sample",
  "l2-built-in-sample",
  "l3-built-in-sample",
  "gpx-no-timestamps",
  "fit-truncated-file",
] as const;

export type DemoRideId = typeof DEMO_RIDE_IDS[number];

const METRIC_LABELS: Record<MetricKey, string> = {
  distanceM: "距离",
  elapsedTimeS: "总时间",
  movingTimeS: "骑行时间",
  elevationGainM: "累计爬升",
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
    metricKeys: ["normalizedPowerW"],
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
    description: "本次骑行可靠记录的累计爬升",
    metricKeys: ["elevationGainM"],
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

export interface RidePageViewModel {
  uiVersion: typeof RIDE_DETAIL_UI_VERSION;
  id: string;
  fixtureDescription: string;
  analysis: B0RideAnalysis;
  factCards: RideMetricDisplay[];
  detailSections: RideDetailSection[];
  rideMeta: {
    dateLabel?: string;
    titleLabel: string;
    sourceLabel: string;
    summaryLabel: string;
  };
  visuals: RideVisualDisplay;
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
  if (metric.provenance === "calculated") return `规则计算 · ${metric.formulaVersion}`;
  if (metric.provenance === "estimated") return "估算 · 仅供参考";
  return sourceKind === "sample" ? "内置样例" : "设备记录";
}

function compactNumber(value: number, fractionDigits = 1): string {
  return Number(value.toFixed(fractionDigits)).toString();
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分钟`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分钟`;
}

function formatMetricValue(metricKey: MetricKey, metric: Metric): string {
  if (metricKey === "distanceM") return `${compactNumber(metric.value / 1_000)} km`;
  if (metricKey === "elapsedTimeS" || metricKey === "movingTimeS") return formatDuration(metric.value);
  if (metricKey === "avgSpeedMps" || metricKey === "maxSpeedMps") return `${compactNumber(metric.value * 3.6)} km/h`;
  if (metricKey === "elevationGainM") return `${Math.round(metric.value)} m`;
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

function sourceKindLabel(sourceKind: DataSourceKind): string {
  if (sourceKind === "sample") return "内置演示样例";
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

function formatRideTitle(startTime: string | undefined): string {
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
  fixtureDescription = "已导入的 FIT/GPX 骑行记录",
): RidePageViewModel {
  const { activity, series } = record;
  const analysis = generateB0RideAnalysis(activity);
  const { source } = activity;
  const sourceLabel = sourceKindLabel(source.kind);
  const dateLabel = formatRideDate(activity.startTime);
  const recordIsValid = validateRideRecord(record).valid;
  const factCards = SUMMARY_METRICS.flatMap((metricKey) => {
    const metric = recordIsValid ? activity.metrics[metricKey] : undefined;
    return metric ? [toMetricDisplay(metricKey, metric, activity.rideId, source.kind)] : [];
  });
  const detailSections = DETAIL_GROUPS.flatMap((group) => {
    const metrics = group.metricKeys.flatMap((metricKey) => {
      const metric = recordIsValid ? activity.metrics[metricKey] : undefined;
      return metric ? [toMetricDisplay(metricKey, metric, activity.rideId, source.kind)] : [];
    });
    return metrics.length > 0 ? [{ ...group, metrics }] : [];
  });
  const sensors = (Object.entries(analysis.snapshot.quality.sensors) as Array<[
    SensorKind,
    NonNullable<typeof analysis.snapshot.quality.sensors[SensorKind]>,
  ]>).map(([key, quality]) => ({
    key,
    label: SENSOR_LABELS[key],
    coverageLabel: `覆盖 ${Math.round(quality.coverage * 100)}%`,
    sampleLabel: `${quality.sampleCount.toLocaleString("zh-CN")} 个样本 · ${quality.invalidSampleCount} 个无效`,
  }));
  return {
    uiVersion: RIDE_DETAIL_UI_VERSION,
    id: activity.rideId,
    fixtureDescription,
    analysis,
    factCards,
    detailSections,
    rideMeta: {
      ...(dateLabel ? { dateLabel } : {}),
      titleLabel: formatRideTitle(activity.startTime),
      sourceLabel,
      summaryLabel: [dateLabel, sourceLabel].filter(Boolean).join(" · "),
    },
    visuals: recordIsValid ? buildRideVisualDisplay({ activity, series }, sourceLabel) : { charts: [] },
    dataQuality: {
      sourceLabel,
      note: source.kind === "sample"
        ? "当前为内置演示样例，质量参数仅用于验证界面与规则，不代表真实设备兼容结果。"
        : "只展示通过当前质量规则的数据；缺失或不可靠的项目不会用 0 代替。",
      sensors,
      issueCodes: analysis.snapshot.quality.issueCodes,
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
