import type {
  RideRouteDisplay,
  RideSeriesChartDisplay,
} from "../../src/ui/ride-series-view-model";

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

function RideSeriesChart({ chart }: { chart: RideSeriesChartDisplay }) {
  const gradientId = `chart-gradient-${chart.key}`;
  return (
    <article className={`series-chart-card chart-${chart.key}`}>
      <header>
        <div><p>{chart.label}</p><span>{chart.axisLabel}</span></div>
        <strong>{chart.minLabel} – {chart.maxLabel}</strong>
      </header>
      <svg className="ride-chart-svg" viewBox="0 0 320 120" role="img" aria-label={`${chart.label}曲线，范围${chart.minLabel}到${chart.maxLabel}`}>
        <title>{`${chart.label}曲线`}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-grid-line" d="M 12 34 H 308 M 12 62 H 308 M 12 90 H 308" />
        <path className="chart-area" d={chart.areaPath} fill={`url(#${gradientId})`} />
        <path className="chart-line" d={chart.path} />
      </svg>
    </article>
  );
}

export function RideSeriesCharts({ charts }: { charts: RideSeriesChartDisplay[] }) {
  if (charts.length === 0) return null;
  return (
    <section className="series-section" aria-labelledby="series-title">
      <header className="section-heading series-heading">
        <div><p className="kicker">骑行曲线</p><h2 id="series-title">沿途变化</h2></div>
        <span>{charts.length} 项</span>
      </header>
      <div className="series-chart-grid">
        {charts.map((chart) => <RideSeriesChart chart={chart} key={chart.key} />)}
      </div>
    </section>
  );
}
