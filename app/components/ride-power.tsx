"use client";

import { useEffect, useMemo, useState } from "react";

import { buildRidePowerSummary, type PowerZoneBin, type RidePowerSummary } from "../../src/domain/ride-power";
import type { RideRecord } from "../../src/domain/ride-schema";
import { deserializeUserProfile, type UserProfile } from "../../src/domain/user-profile";
import type { RideSeriesChartDisplay } from "../../src/ui/ride-series-view-model";
import { SeriesChartSvg } from "./ride-visuals";

const PROFILE_STORAGE_KEY = "ai-cycling-buddy:user-profile:v0.1";

function readProfile(): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? deserializeUserProfile(raw) : null;
  } catch {
    return null;
  }
}

function compact(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

function qualityMessage(summary: RidePowerSummary): string | undefined {
  if (summary.qualityLevel === "soft") return "功率数据部分缺失，结果仅供参考";
  if (summary.qualityLevel !== "unavailable") return undefined;
  if (summary.unavailableReasons.includes("insufficient_coverage")) return "功率覆盖不足，暂不计算功率衍生指标。";
  if (summary.unavailableReasons.includes("long_gap")) return "功率存在超过 60 秒的缺口，暂不计算功率衍生指标。";
  if (summary.unavailableReasons.includes("interpolation_limit")) return "功率插补超过骑行时间的 2%，暂不计算功率衍生指标。";
  return "当前记录无法计算功率衍生指标。";
}

function PowerZonePanel({ zones, summary }: { zones: PowerZoneBin[]; summary: RidePowerSummary }) {
  return <section className="power-zone-panel" aria-label="功率区间">
    <header><h4>功率区间</h4><span>{formatDuration(summary.validDurationS)}</span></header>
    <div aria-hidden="true" className="power-zone-bar">
      {zones.map((zone) => <i className={`power-zone-fill power-${zone.key}${zone.durationS === 0 ? " is-empty" : ""}`} key={zone.key} style={{ flexGrow: zone.share }} />)}
    </div>
    <ul className="power-zone-list">
      {zones.map((zone) => <li key={zone.key}>
        <i aria-hidden="true" className={`power-zone-swatch power-${zone.key}`} />
        <strong>{zone.label}</strong>
        <span className="power-zone-meta">
          <span>{formatDuration(zone.durationS)}</span>
          <em>{Math.round(zone.share * 100)}%</em>
        </span>
      </li>)}
    </ul>
  </section>;
}

function PowerQualityNotice({ summary }: { summary: RidePowerSummary }) {
  const message = qualityMessage(summary);
  return message ? <p className={`power-quality-notice ${summary.qualityLevel === "soft" ? "is-soft" : ""}`}>{message}</p> : null;
}

function PowerDerivedFacts({ summary }: { summary: RidePowerSummary }) {
  if (summary.qualityLevel === "unavailable" || summary.normalizedPowerW === undefined) return null;
  return <dl className="power-derived-facts" aria-label="功率衍生指标">
    <div><dt>数据质量</dt><dd>{summary.qualityLevel === "hard" ? "完整" : "部分缺失"}</dd></div>
    <div><dt>标准化功率</dt><dd>{Math.round(summary.normalizedPowerW)} W</dd></div>
    {summary.intensityFactor !== undefined && <div><dt>强度因子</dt><dd>{compact(summary.intensityFactor, 2)} IF</dd></div>}
    {summary.trainingStressScore !== undefined && <div><dt>训练压力</dt><dd>{compact(summary.trainingStressScore, 1)} TSS</dd></div>}
  </dl>;
}

function PowerPeakPanel({ summary }: { summary: RidePowerSummary }) {
  if (!summary.peakPowers) return null;
  return <section className="power-peak-panel" aria-label="本次峰值平均功率">
    <header><h4>本次峰值平均功率</h4><span>连续窗口</span></header>
    <div className="power-peak-grid">
      {summary.peakPowers.map((peak) => <div className="power-peak-item" key={peak.durationS}>
        <span>{peak.durationS} 秒</span>
        <strong>{Math.round(peak.averagePowerW)} W</strong>
        {peak.powerToWeight !== undefined && <em>{compact(peak.powerToWeight)} W/kg</em>}
      </div>)}
    </div>
  </section>;
}

export function RidePowerAnalysis({ record, chart }: { record: RideRecord; chart?: RideSeriesChartDisplay }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    setProfile(readProfile());
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_STORAGE_KEY) setProfile(readProfile());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const summary = useMemo(() => buildRidePowerSummary(record, profile), [profile, record]);
  if (!chart) return null;
  return <section className="analysis-group sensor-analysis-group" aria-labelledby="power-analysis-title">
    <header className="section-heading series-heading"><div><h2 id="power-analysis-title">功率分析</h2></div></header>
    <article className="sensor-analysis-card chart-power zone-power" aria-label="功率">
      <header>
        <div><h3>功率</h3><span>{chart.axisLabel}</span></div>
        <div className="sensor-analysis-stats"><strong>{chart.minLabel} – {chart.maxLabel}</strong>{summary.averagePowerW !== undefined && <span>平均功率 {Math.round(summary.averagePowerW)} W</span>}</div>
      </header>
      <SeriesChartSvg chart={chart} />
      <PowerDerivedFacts summary={summary} />
      <PowerQualityNotice summary={summary} />
      <PowerPeakPanel summary={summary} />
      {summary.qualityLevel !== "unavailable" && summary.zones && <PowerZonePanel zones={summary.zones} summary={summary} />}
    </article>
  </section>;
}

function PowerMetricRow({ label, value, source = "规则计算" }: { label: string; value: string; source?: string }) {
  return <article className="metric-row"><div><p>{label}</p><span>{source}</span></div><strong>{value}</strong></article>;
}

export function RidePowerDataSection({ record }: { record: RideRecord }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    setProfile(readProfile());
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_STORAGE_KEY) setProfile(readProfile());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const summary = useMemo(() => buildRidePowerSummary(record, profile), [profile, record]);
  const average = record.activity.metrics.avgPowerW;
  const maximum = record.activity.metrics.maxPowerW;
  const hasRawPower = average?.qualityStatus === "valid" || maximum?.qualityStatus === "valid";
  if (!hasRawPower && summary.qualityLevel === "unavailable") return null;
  return <>
    <section className="data-section" aria-label="功率">
      <header><div><h2>功率</h2></div></header>
      <div className="metric-list">
        {average?.qualityStatus === "valid" && <PowerMetricRow label="平均功率" value={`${Math.round(average.value)} W`} source="设备记录" />}
        {maximum?.qualityStatus === "valid" && <PowerMetricRow label="最大功率" value={`${Math.round(maximum.value)} W`} source="设备记录" />}
        {summary.qualityLevel !== "unavailable" && summary.normalizedPowerW !== undefined && <PowerMetricRow label="标准化功率（NP）" value={`${Math.round(summary.normalizedPowerW)} W`} />}
        {summary.averagePowerToWeight !== undefined && <PowerMetricRow label="平均功体比" value={`${compact(summary.averagePowerToWeight)} W/kg`} />}
        {summary.normalizedPowerToWeight !== undefined && <PowerMetricRow label="NP 功体比" value={`${compact(summary.normalizedPowerToWeight)} W/kg`} />}
        {summary.peakPowers?.map((peak) => <PowerMetricRow key={peak.durationS} label={`本次峰值平均功率（${peak.durationS} 秒）`} value={`${Math.round(peak.averagePowerW)} W`} />)}
        {summary.peakPowers?.filter((peak) => peak.powerToWeight !== undefined).map((peak) => <PowerMetricRow key={`wkg-${peak.durationS}`} label={`峰值功体比（${peak.durationS} 秒）`} value={`${compact(peak.powerToWeight!)} W/kg`} />)}
      </div>
      <PowerQualityNotice summary={summary} />
    </section>
    {summary.qualityLevel !== "unavailable" && (summary.ftpW || summary.intensityFactor !== undefined || summary.trainingStressScore !== undefined) && <section className="data-section" aria-label="训练强度">
      <header><div><h2>训练强度</h2></div></header>
      <div className="metric-list">
        {summary.ftpW && <PowerMetricRow label="FTP" value={`${Math.round(summary.ftpW)} W`} source="个人资料 · 用户确认" />}
        {summary.intensityFactor !== undefined && <PowerMetricRow label="强度因子（IF）" value={compact(summary.intensityFactor, 2)} />}
        {summary.trainingStressScore !== undefined && <PowerMetricRow label="训练压力评分（TSS）" value={compact(summary.trainingStressScore, 1)} />}
      </div>
    </section>}
  </>;
}
