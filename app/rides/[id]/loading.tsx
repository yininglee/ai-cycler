import { AppShell } from "../../components/app-shell";
import { RideDetailLoadingNavigation } from "../../components/ride-detail-tabs";
import { RouteProgress } from "../../components/route-loading";

export default function RideDetailLoading() {
  return <AppShell showNav={false}>
    <div className="ride-detail-page ride-detail-summary-page ride-detail-loading" data-route-loading="ride-detail">
      <RideDetailLoadingNavigation />
      <div className="summary-tab">
        <RouteProgress label="正在读取骑行详情" />
        <div className="ride-detail-route-placeholder" aria-hidden="true" />
        <div className="summary-sheet" aria-hidden="true">
          <span className="summary-sheet-handle" />
          <div className="summary-record-heading"><div><span className="route-skeleton-line" /><span className="route-skeleton-line route-skeleton-line-wide" /></div></div>
          <div className="summary-metrics">
            {["距离", "时长", "均速", "爬升"].map(label => <div key={label}><span className="route-skeleton-line" /><span className="route-skeleton-line route-skeleton-line-wide" /></div>)}
          </div>
        </div>
      </div>
    </div>
  </AppShell>;
}
