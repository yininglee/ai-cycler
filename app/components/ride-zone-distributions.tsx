"use client";

import { useEffect, useMemo, useState } from "react";

import type { RideRecord } from "../../src/domain/ride-schema";
import {
  buildCadenceZoneDistribution,
  buildHeartRateZoneDistribution,
  type ZoneDistribution,
} from "../../src/domain/ride-zones";
import { type UserProfile } from "../../src/domain/user-profile";
import type { RideSeriesChartDisplay } from "../../src/ui/ride-series-view-model";
import { SeriesChartSvg } from "./ride-visuals";
import { RidePowerAnalysis } from "./ride-power";


function formatDuration(seconds: number): string {
  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds < 60) return `${roundedSeconds}秒`;
  const totalMinutes = Math.round(roundedSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分钟`;
  return minutes === 0 ? `${hours}小时` : `${hours}小时${minutes}分钟`;
}

function ZoneDistributionPanel({ distribution, title }: {
  distribution: ZoneDistribution;
  title: string;
}) {
  if (distribution.unavailableReason) {
    return <section className="zone-distribution-panel zone-distribution-unavailable" aria-label={title}>
      <header><h4>{title}</h4></header>
      <p>当前记录的传感器数据覆盖不足，暂不计算区间分布。</p>
    </section>;
  }
  const isHeartRate = distribution.sensor === "heart_rate";
  return <section className="zone-distribution-panel" aria-label={title}>
    <header><h4>{title}</h4><span>{formatDuration(distribution.validDurationS)}</span></header>
    {!isHeartRate && <div aria-hidden="true" className="zone-distribution-bar">
      {distribution.bins.map((bin) => <i
        className={`zone-distribution-fill zone-${bin.key}${bin.durationS === 0 ? " is-empty" : ""}`}
        key={bin.key}
        style={{ flexGrow: bin.share }}
      />)}
    </div>}
    <ul className="zone-distribution-list">
      {distribution.bins.map((bin) => <li key={bin.key}>
        <i aria-hidden="true" className={`zone-distribution-swatch zone-${bin.key}`} />
        <strong>{bin.label}</strong>
        {isHeartRate && <span aria-hidden="true" className="zone-distribution-row-bar"><i className={`zone-distribution-row-fill zone-${bin.key}`} style={{ width: `${Math.round(bin.share * 100)}%` }} /></span>}
        {isHeartRate
          ? <><span>{formatDuration(bin.durationS)}</span><em>{Math.round(bin.share * 100)}%</em></>
          : <span className="zone-distribution-meta"><span>{formatDuration(bin.durationS)}</span><em>{Math.round(bin.share * 100)}%</em></span>}
      </li>)}
    </ul>
  </section>;
}

function SensorAnalysisCard({
  chart,
  title,
  distribution,
  distributionTitle,
  averagePowerLabel,
}: {
  chart: RideSeriesChartDisplay;
  title: string;
  distribution?: ZoneDistribution;
  distributionTitle?: string;
  averagePowerLabel?: string;
}) {
  const zoneClass = distribution?.sensor === "heart_rate" ? "zone-heart-rate" : distribution?.sensor === "cadence" ? "zone-cadence" : "";
  return <article className={`sensor-analysis-card chart-${chart.key} ${zoneClass}`} aria-label={title}>
    <header>
      <div><h3>{title}</h3><span>{chart.axisLabel}</span></div>
      <div className="sensor-analysis-stats">
        <strong>{chart.minLabel} – {chart.maxLabel}</strong>
        {averagePowerLabel && <span>平均功率 {averagePowerLabel}</span>}
      </div>
    </header>
    <SeriesChartSvg chart={chart} zoneDistribution={distribution?.sensor === "heart_rate" ? distribution : undefined} />
    {distribution && distributionTitle && <ZoneDistributionPanel distribution={distribution} title={distributionTitle} />}
  </article>;
}

export function RideSensorAnalysisGroups({ record, charts }: {
  record: RideRecord;
  charts: RideSeriesChartDisplay[];
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/profile", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((value: UserProfile | null) => { if (active) setProfile(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const distributions = useMemo(() => ({
    heartRate: buildHeartRateZoneDistribution(record, profile),
    cadence: buildCadenceZoneDistribution(record),
  }), [profile, record]);
  const chartByKey = new Map(charts.map((chart) => [chart.key, chart]));

  return <>
    {chartByKey.get("heart_rate") && <section className="analysis-group sensor-analysis-group" aria-labelledby="heart-rate-analysis-title">
      <header className="section-heading series-heading">
        <div><h2 id="heart-rate-analysis-title">心率分析</h2></div>
      </header>
      <SensorAnalysisCard chart={chartByKey.get("heart_rate")!} title="心率" distribution={distributions.heartRate} distributionTitle="心率区间" />
    </section>}

    <RidePowerAnalysis record={record} chart={chartByKey.get("power")} />

    {chartByKey.get("cadence") && <section className="analysis-group sensor-analysis-group" aria-labelledby="cadence-analysis-title">
      <header className="section-heading series-heading">
        <div><h2 id="cadence-analysis-title">踏频分析</h2></div>
      </header>
      <SensorAnalysisCard chart={chartByKey.get("cadence")!} title="踏频" distribution={distributions.cadence} distributionTitle="踏频区间" />
    </section>}
  </>;
}

// Kept as a compatibility export for callers outside the detail page.
export function RideZoneDistributions({ record, charts = [] }: { record: RideRecord; charts?: RideSeriesChartDisplay[] }) {
  return <RideSensorAnalysisGroups record={record} charts={charts} />;
}
