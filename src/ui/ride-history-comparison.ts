import {
  buildHistoricalComparisonSnapshot,
  type ComparisonMetricKey,
  type HistoricalComparisonSnapshot,
  type HistoricalMetricComparison,
  type HistoricalRide,
} from "../domain/historical-comparison.ts";
import type { RideRecord } from "../domain/ride-schema.ts";
import { buildHistoricalRides } from "../persistence/persistent-history.ts";

/**
 * MVP-REPEAT-01 历史比较展示视图：把 HistoricalComparisonSnapshot 投影为
 * 详情页"与本人历史对比"区块的确定性展示模型。遵循冻结合同：
 * 只展示 comparable 指标（含当前值、基线、样本数与变化），不可比时整体
 * 隐藏，不出现进步/退步等能力评价措辞。
 */

export const HISTORY_COMPARISON_METRIC_KEYS: ComparisonMetricKey[] = [
  "distanceM",
  "movingTimeS",
  "avgSpeedMps",
  "avgHeartRateBpm",
  "avgPowerW",
  "normalizedPowerW",
  "avgCadenceRpm",
  "elevationGainM",
];

export const HISTORY_COMPARISON_WINDOW_DAYS = 30;

const METRIC_LABELS: Partial<Record<ComparisonMetricKey, string>> = {
  distanceM: "距离",
  movingTimeS: "骑行时间",
  avgSpeedMps: "平均速度",
  avgHeartRateBpm: "平均心率",
  avgPowerW: "平均功率",
  normalizedPowerW: "标准化功率",
  avgCadenceRpm: "平均踏频",
  elevationGainM: "累计爬升",
};

function compactNumber(value: number, fractionDigits = 1): string {
  return Number(value.toFixed(fractionDigits)).toString();
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} 分钟`;
  return remainder === 0 ? `${hours} 小时` : `${hours} 小时 ${remainder} 分钟`;
}

function formatMetricValue(metricKey: ComparisonMetricKey, value: number): string {
  if (metricKey === "distanceM") return `${compactNumber(value / 1_000)} km`;
  if (metricKey === "movingTimeS") return formatDuration(value);
  if (metricKey === "avgSpeedMps") return `${compactNumber(value * 3.6)} km/h`;
  if (metricKey === "avgHeartRateBpm") return `${Math.round(value)} bpm`;
  if (metricKey === "avgPowerW" || metricKey === "normalizedPowerW") return `${Math.round(value)} W`;
  if (metricKey === "avgCadenceRpm") return `${Math.round(value)} rpm`;
  if (metricKey === "elevationGainM") return `${Math.round(value)} m`;
  return compactNumber(value);
}

function formatChange(metricKey: ComparisonMetricKey, absoluteChange: number, relativeChange: number): string {
  const sign = absoluteChange >= 0 ? "+" : "-";
  const magnitude = Math.abs(absoluteChange);
  const percent = Math.abs(relativeChange * 100);
  return `${sign}${formatMetricValue(metricKey, magnitude)}（${sign}${compactNumber(percent)}%）`;
}

export interface HistoryComparisonRow {
  metricKey: ComparisonMetricKey;
  label: string;
  anchorDisplay: string;
  baselineDisplay: string;
  sampleCount: number;
  changeDisplay: string;
}

export interface HistoryComparisonGroup {
  key: "all" | "same_route";
  title: string;
  caption: string;
  rows: HistoryComparisonRow[];
}

export interface RideHistoryComparisonView {
  windowDays: number;
  note: string;
  groups: HistoryComparisonGroup[];
}

function buildRows(metrics: HistoricalMetricComparison[]): HistoryComparisonRow[] {
  const comparable = metrics.filter((metric) =>
    metric.comparability.status === "comparable"
    && metric.anchor !== undefined
    && metric.baseline !== undefined
    && metric.absoluteChange !== undefined
    && metric.relativeChange !== undefined);
  return HISTORY_COMPARISON_METRIC_KEYS
    .map((metricKey) => comparable.find((metric) => metric.metricKey === metricKey))
    .filter((metric): metric is HistoricalMetricComparison => metric !== undefined)
    .map((metric) => ({
      metricKey: metric.metricKey,
      label: METRIC_LABELS[metric.metricKey] ?? metric.metricKey,
      anchorDisplay: formatMetricValue(metric.metricKey, metric.anchor!.value),
      baselineDisplay: formatMetricValue(metric.metricKey, metric.baseline!.value),
      sampleCount: metric.baseline!.sampleCount,
      changeDisplay: formatChange(metric.metricKey, metric.absoluteChange!, metric.relativeChange!),
    }));
}

/** 快照 → 展示视图；无可比指标时返回 undefined（页面整体隐藏区块）。 */
export function buildRideHistoryComparisonView(snapshot: HistoricalComparisonSnapshot): RideHistoryComparisonView | undefined {
  const groups: HistoryComparisonGroup[] = [];
  const allRows = buildRows(snapshot.metrics);
  if (allRows.length > 0) {
    groups.push({
      key: "all",
      title: "近 30 天骑行",
      caption: "与窗口内同运动、同口径记录比较",
      rows: allRows,
    });
  }
  const sameRouteRows = buildRows(snapshot.sameRoute.metrics);
  if (sameRouteRows.length > 0) {
    groups.push({
      key: "same_route",
      title: "同路线",
      caption: "仅与路线签名相同的记录比较",
      rows: sameRouteRows,
    });
  }
  if (groups.length === 0) return undefined;
  return {
    windowDays: snapshot.range.windowDays,
    note: "基线为窗口内可比记录的均值（不含本次）；右侧为本次相对基线的变化。",
    groups,
  };
}

/**
 * 详情页入口：锚点记录 + 同 owner 全部持久记录 → 历史比较展示视图。
 * 返回 undefined 表示不可展示（历史为空、锚点无效或样本不足）。
 */
export function buildRideHistoryComparisonForRecord(anchor: RideRecord, historyRecords: RideRecord[]): RideHistoryComparisonView | undefined {
  if (historyRecords.length <= 1) return undefined;
  const history = buildHistoricalRides(historyRecords);
  const anchorRide = history.find((ride) => ride.record.activity.rideId === anchor.activity.rideId);
  if (!anchorRide) return undefined;
  const snapshot = buildHistoricalComparisonSnapshot(anchorRide, history, {
    metricKeys: HISTORY_COMPARISON_METRIC_KEYS,
    windowDays: HISTORY_COMPARISON_WINDOW_DAYS,
  });
  return buildRideHistoryComparisonView(snapshot);
}
