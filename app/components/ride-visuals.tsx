"use client";

import { useState } from "react";

import type {
  RideRouteDisplay,
  RideSeriesChartDisplay,
  RideVisualDisplay,
} from "../../src/ui/ride-series-view-model";
import type { RideCruiseSegmentDisplay } from "../../src/ui/ride-view-model";
import type { HeartRateZoneDistribution, ZoneDistribution } from "../../src/domain/ride-zones";

export function RideRouteHero({ route }: { route: RideRouteDisplay }) {
  return (
    <section className="route-card summary-route-hero" aria-label="本次骑行轨迹">
      <div className="route-canvas summary-route-canvas">
        <svg className="ride-route-svg" viewBox="0 0 320 220" role="img" aria-label="本次骑行的相对路线形状">
          <title>本次骑行轨迹</title>
          <defs>
            <linearGradient id="route-stroke" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#8ea7e8" />
              <stop offset="0.56" stopColor="#d38cb3" />
              <stop offset="1" stopColor="#c8f36a" />
            </linearGradient>
          </defs>
          <path className="route-grid-line" d="M 18 55 H 302 M 18 110 H 302 M 18 165 H 302" />
          <path className="route-path-shadow" d={route.path} />
          <path className="route-path" d={route.path} />
          <circle className="route-start" cx={route.start.x} cy={route.start.y} r="6" />
          <circle className="route-end" cx={route.end.x} cy={route.end.y} r="7" />
          <circle className="route-end-core" cx={route.end.x} cy={route.end.y} r="3" />
        </svg>
        <div className="route-legend" aria-hidden="true"><span><i className="start-dot" />起点</span><span><i className="end-dot" />终点</span></div>
      </div>
    </section>
  );
}

export function SeriesChartSvg({
  chart,
  eventClimbMarkers = [],
  selectedEventClimbId,
  zoneDistribution,
}: {
  chart: RideSeriesChartDisplay;
  eventClimbMarkers?: Array<{
    id: string;
    categoryLabel: string;
    startPosition: number;
    endPosition: number;
  }>;
  selectedEventClimbId?: string;
  zoneDistribution?: ZoneDistribution;
}) {
  const gradientId = `chart-gradient-${chart.key}`;
  const hasEventClimbMarkers = eventClimbMarkers.length > 0;
  const plotOffsetY = hasEventClimbMarkers ? 30 : 0;
  const eventClimbLabels = eventClimbMarkers
    .map((climb) => {
      const start = 12 + climb.startPosition * 296;
      const end = 12 + climb.endPosition * 296;
      const labelWidth = climb.categoryLabel === "HC级" ? 24 : 20;
      return {
        ...climb,
        end: Math.max(start + 2, end),
        labelWidth,
        start,
        x: Math.max(12, Math.min(308 - labelWidth, (start + end - labelWidth) / 2)),
      };
    })
    .sort((left, right) => left.x - right.x);
  const laneEnds = [-Infinity, -Infinity, -Infinity];
  const labelledEventClimbs = eventClimbLabels.map((climb) => {
    let lane = laneEnds.findIndex((laneEnd) => climb.x >= laneEnd + 3);
    if (lane === -1) lane = laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = climb.x + climb.labelWidth;
    return { ...climb, lane };
  });
  const zoneKeyForValue = (value: number): string | undefined => {
    if (!zoneDistribution) return undefined;
    if (zoneDistribution.sensor === "cadence") {
      if (value === 0) return "zero";
      if (value < 60) return "low";
      if (value < 75) return "steady";
      if (value < 90) return "endurance";
      if (value < 105) return "high";
      return "very-high";
    }
    const baseline = (zoneDistribution as HeartRateZoneDistribution).baseline?.maxHeartRateBpm;
    if (!baseline) return undefined;
    if (value < baseline * 0.5) return "below-z1";
    if (value < baseline * 0.6) return "z1";
    if (value < baseline * 0.7) return "z2";
    if (value < baseline * 0.8) return "z3";
    if (value < baseline * 0.9) return "z4";
    if (value <= baseline) return "z5";
    return "above-baseline";
  };
  const colouredLineSegments = chart.points && zoneDistribution
    ? chart.points.slice(1).map((point, index) => {
      const previous = chart.points![index]!;
      return { key: zoneKeyForValue(previous.value), path: `M ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} L ${point.x.toFixed(2)} ${point.y.toFixed(2)}` };
    }).filter((segment): segment is { key: string; path: string } => Boolean(segment.key))
    : [];
  return (
    <svg className="ride-chart-svg" height={hasEventClimbMarkers ? 150 : 120} preserveAspectRatio="xMidYMid meet" viewBox={`0 0 320 ${hasEventClimbMarkers ? 150 : 120}`} role="img" aria-label={`${chart.label}曲线，范围${chart.minLabel}到${chart.maxLabel}`}>
      <title>{`${chart.label}曲线`}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform={`translate(0 ${plotOffsetY})`}>
        {chart.cruiseHighlights.map((highlight, index) => <rect
          className={highlight.isLong ? "chart-cruise-highlight chart-cruise-highlight-long" : "chart-cruise-highlight"}
          height="104"
          key={`${highlight.x}-${index}`}
          rx="4"
          width={highlight.width}
          x={highlight.x}
          y="8"
        />)}
        <path className="chart-grid-line" d="M 12 34 H 308 M 12 62 H 308 M 12 90 H 308" />
        {labelledEventClimbs.map((climb) => <rect
          className={`chart-event-climb-range grade-${climb.categoryLabel.slice(0, -1).toLowerCase()}${climb.id === selectedEventClimbId ? " active" : ""}`}
          height="104"
          key={climb.id}
          width={climb.end - climb.start}
          x={climb.start}
          y="8"
        />)}
        <path className="chart-area" d={chart.areaPath} fill={`url(#${gradientId})`} />
        {colouredLineSegments.length > 0
          ? colouredLineSegments.map((segment, index) => <path className={`chart-line chart-zone-line zone-${segment.key}`} d={segment.path} key={`${segment.key}-${index}`} />)
          : <path className="chart-line" d={chart.path} />}
      </g>
      {labelledEventClimbs.map((climb) => <g className={`chart-event-climb-tag grade-${climb.categoryLabel.slice(0, -1).toLowerCase()}${climb.id === selectedEventClimbId ? " active" : ""}`} key={`${climb.id}-tag`} transform={`translate(${climb.x} ${4 + climb.lane * 13})`}>
        <rect height="10" rx="2.5" width={climb.labelWidth} />
        <text textAnchor="middle" x={climb.labelWidth / 2} y="8">{climb.categoryLabel}</text>
      </g>)}
    </svg>
  );
}

function CruiseContent({ chart, cruiseSegments }: { chart: RideSeriesChartDisplay; cruiseSegments: RideCruiseSegmentDisplay[] }) {
  return <>
    {chart.cruiseHighlights.length > 0 && <footer className="chart-cruise-legend">
        <span><i />巡航</span>
        {chart.cruiseHighlights.some((highlight) => highlight.isLong) && <span><i className="long" />长巡航</span>}
      </footer>}
    {chart.key === "speed" && cruiseSegments.length > 0 && <section className="chart-cruise-segments" aria-label="速度曲线对应的巡航区段">
        <header><strong>巡航区段</strong><span>{cruiseSegments.length} 段</span></header>
        {cruiseSegments.map((segment) => <article className="chart-cruise-segment" key={segment.id}>
          <div><strong>{segment.label}</strong><span>{segment.timeRangeLabel} · {segment.durationLabel}</span></div>
          <div><strong>{segment.averageSpeedLabel}</strong><span>{[segment.distanceLabel, segment.variabilityLabel].filter(Boolean).join(" · ")}</span></div>
        </article>)}
      </section>}
  </>;
}

export function RideSeriesChart({ chart, cruiseSegments }: { chart: RideSeriesChartDisplay; cruiseSegments: RideCruiseSegmentDisplay[] }) {
  return (
    <article className={`series-chart-card chart-${chart.key}`}>
      <header>
        <div><p>{chart.label}</p><span>{chart.axisLabel}</span></div>
        <strong>{chart.minLabel} – {chart.maxLabel}</strong>
      </header>
      <SeriesChartSvg chart={chart} />
      <CruiseContent chart={chart} cruiseSegments={cruiseSegments} />
    </article>
  );
}

function distanceLabel(distanceM: number): string {
  return `${Number((distanceM / 1_000).toFixed(1))} km`;
}

function RouteShapeBar({ routeShape }: { routeShape: NonNullable<RideVisualDisplay["routeShape"]> }) {
  const segments = [
    { key: "climb", label: "上坡", distanceM: routeShape.climbDistanceM },
    { key: "flat", label: "平路", distanceM: routeShape.flatDistanceM },
    { key: "descent", label: "下坡", distanceM: routeShape.descentDistanceM },
  ];
  return <section className="route-shape-summary" aria-label="路线形态里程">
    <div className="route-shape-bar" aria-hidden="true">
      {segments.map((segment) => <span className={`route-shape-fill route-shape-${segment.key}`} key={segment.key} style={{ flexGrow: segment.distanceM }} />)}
    </div>
    <div className="route-shape-metrics">
      {segments.map((segment) => <div key={segment.key}>
        <span>{segment.label}</span>
        <strong>{distanceLabel(segment.distanceM)}</strong>
        <small>{Math.round(segment.distanceM / routeShape.classifiedDistanceM * 100)}%</small>
      </div>)}
    </div>
    {routeShape.needsCoverageNotice && <p className="route-shape-coverage">已分析 {distanceLabel(routeShape.classifiedDistanceM)} / {distanceLabel(routeShape.movingDistanceM)}</p>}
  </section>;
}

function EventClimbList({
  climbs,
  selectedClimbId,
  onSelect,
}: {
  climbs: NonNullable<RideVisualDisplay["routeShape"]>["eventClimbs"];
  selectedClimbId?: string;
  onSelect: (id: string) => void;
}) {
  if (climbs.length === 0) return null;
  return <details className="event-climb-list">
    <summary><span>赛事爬坡分级</span><strong>{climbs.length} 段</strong></summary>
    <p>按环法 ASO 口径计算</p>
    <div className="event-climb-rows">
      {climbs.map((climb) => <button
        aria-pressed={selectedClimbId === climb.id}
        className={selectedClimbId === climb.id ? "event-climb-row active" : "event-climb-row"}
        key={climb.id}
        onClick={() => onSelect(climb.id)}
        type="button"
      >
        <span className={`event-climb-grade grade-${climb.categoryLabel.slice(0, -1).toLowerCase()}`}>{climb.categoryLabel}</span>
        <span className="event-climb-main"><strong>{climb.distanceLabel} · +{climb.netElevationGainLabel}</strong><small>平均坡度 {climb.averageGradeLabel}</small></span>
        <span className="event-climb-meta">
          {climb.durationLabel && <small>{climb.durationLabel}</small>}
          {climb.movingAverageSpeedLabel && <small>移动 {climb.movingAverageSpeedLabel}</small>}
          {climb.averageHeartRateLabel && <small>心率 {climb.averageHeartRateLabel}</small>}
          {climb.averagePowerLabel && <small>功率 {climb.averagePowerLabel}</small>}
          {climb.powerQualityLabel && <small className="event-climb-quality">{climb.powerQualityLabel}</small>}
        </span>
      </button>)}
    </div>
  </details>;
}

function RideElevationShapeChart({
  elevationChart,
  routeShape,
}: {
  elevationChart: RideSeriesChartDisplay;
  routeShape: NonNullable<RideVisualDisplay["routeShape"]>;
}) {
  const [mode, setMode] = useState<"elevation" | "grade">("elevation");
  const [selectedClimbId, setSelectedClimbId] = useState<string>();
  const chart = mode === "elevation" ? elevationChart : routeShape.gradeChart;
  return <article className={`series-chart-card chart-${chart.key}`}>
    <header>
      <div><p>{chart.label}</p><span>{chart.axisLabel}</span></div>
      <div className="chart-heading-actions">
        <strong>{chart.minLabel} – {chart.maxLabel}</strong>
        <div aria-label="海拔或坡度曲线" className="chart-mode-toggle" role="group">
          <button aria-pressed={mode === "elevation"} className={mode === "elevation" ? "active" : ""} onClick={() => setMode("elevation")} type="button">海拔</button>
          <button aria-pressed={mode === "grade"} className={mode === "grade" ? "active" : ""} onClick={() => setMode("grade")} type="button">坡度</button>
        </div>
      </div>
    </header>
    <SeriesChartSvg
      chart={chart}
      eventClimbMarkers={routeShape.eventClimbs}
      selectedEventClimbId={selectedClimbId}
    />
    <RouteShapeBar routeShape={routeShape} />
    <EventClimbList
      climbs={routeShape.eventClimbs}
      onSelect={(id) => setSelectedClimbId((current) => current === id ? undefined : id)}
      selectedClimbId={selectedClimbId}
    />
  </article>;
}

export function RideSeriesCharts({
  charts,
  cruiseSegments = [],
  routeShape,
}: {
  charts: RideSeriesChartDisplay[];
  cruiseSegments?: RideCruiseSegmentDisplay[];
  routeShape?: RideVisualDisplay["routeShape"];
}) {
  if (charts.length === 0) return null;
  const routeCharts = charts.filter((chart) => chart.key === "speed" || chart.key === "elevation");
  if (routeCharts.length === 0 && !routeShape) return null;
  return (
    <section className="series-section" aria-labelledby="series-title">
      <header className="section-heading series-heading">
        <div><h2 id="series-title">沿途变化</h2></div>
        <span>{routeCharts.length + (routeShape ? 1 : 0)} 项</span>
      </header>
      <div className="series-chart-grid">
        {routeCharts.map((chart) => chart.key === "elevation" && routeShape
          ? <RideElevationShapeChart elevationChart={chart} key={chart.key} routeShape={routeShape} />
          : <RideSeriesChart chart={chart} cruiseSegments={cruiseSegments} key={chart.key} />)}
      </div>
    </section>
  );
}
