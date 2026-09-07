import { notFound } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { BikeIcon } from "../../components/icons";
import { RideDetailTabs } from "../../components/ride-detail-tabs";
import { RideRouteHero, RideSeriesCharts } from "../../components/ride-visuals";
import { RideSensorAnalysisGroups } from "../../components/ride-zone-distributions";
import { RidePowerDataSection } from "../../components/ride-power";
import { RideAiAnalysis } from "../../components/ride-ai-analysis";
import { getRideRecord } from "../../../src/imports/demo-ride-store";
import { isDemoRideId } from "../../../src/ui/ride-view-model";
import { getNextSessionUserId } from "../../../src/auth/next-session.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import RideDeleteButton from "../../components/ride-delete-button";
import { buildRidePageViewModelFromRecord } from "../../../src/ui/ride-view-model";

export default async function RideDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const isFixture = isDemoRideId(id);
  const userId = isFixture ? null : await getNextSessionUserId();
  const record = isFixture ? getRideRecord(id) : userId ? await getApplicationRepository().getRide(userId, id) : null;
  if (!record) notFound();
  const view = buildRidePageViewModelFromRecord(record);
  const { snapshot } = view.analysis;
  const rejected = snapshot.analysisMode === "rejected";
  const activeTab = query.tab === "analysis" || query.tab === "data" ? query.tab : "summary";

  return (
    <AppShell active="rides">
      <RideDetailTabs
        rideId={id}
        analysisPanel={<section className="analysis-tab" aria-label="骑行分析">
          {rejected ? <section className="rejected-card"><span className="error-mark">!</span><h2>记录未通过校验</h2><p>损坏或矛盾记录不展示图表，请检查原始文件后重新导入。</p></section> : <>
            <RideSeriesCharts charts={view.visuals.charts} cruiseSegments={view.timing.cruiseSegments} routeShape={view.visuals.routeShape} />
            <RideSensorAnalysisGroups record={record} charts={view.visuals.charts} />
            <RideAiAnalysis rideId={id} title={view.rideMeta.titleLabel} dateLabel={view.rideMeta.dateLabel} />
          </>}
        </section>}
        dataPanel={<section className="data-tab" aria-label="骑行详细数据">
          {rejected ? <section className="rejected-card"><span className="error-mark">!</span><h2>记录未通过校验</h2><p>损坏或矛盾记录不展示数字，请检查原始文件后重新导入。</p></section> : <>
            {view.detailSections.filter((section) => section.key !== "power" && section.key !== "training-load").map((section) => <section className="data-section" key={section.key}>
              <header><div><h2>{section.title}</h2></div></header>
              <div className="metric-list">
                {section.metrics.map((metric) => <article className="metric-row" key={metric.claimId}>
                  <div><p>{metric.label}</p><span>{metric.sourceLabel}</span></div>
                  <strong>{metric.value}</strong>
                </article>)}
              </div>
            </section>)}
            <RidePowerDataSection record={record} />
          </>}
        </section>}
        initialTab={activeTab}
        rejected={rejected}
        summaryPanel={<section className="summary-tab" aria-label="骑行摘要">
        {!rejected && <>
          {view.visuals.route && <RideRouteHero route={view.visuals.route} />}
          <div className="summary-sheet">
            <span className="summary-sheet-handle" aria-hidden="true" />
            <section className="summary-record-heading" aria-label="骑行记录信息">
              <span className="summary-record-icon"><BikeIcon /></span>
              <div>{view.rideMeta.dateLabel && <p>{view.rideMeta.dateLabel}</p>}<h1>{view.rideMeta.titleLabel}</h1></div>
              {!isFixture && <RideDeleteButton rideId={id} />}
            </section>
            <section className="summary-metrics" aria-label="核心骑行事实">
              {view.factCards.map((fact) => <article className="summary-metric" key={fact.claimId}><p>{fact.label}</p><strong>{fact.value}</strong></article>)}
            </section>
            <RideAiAnalysis rideId={id} title={view.rideMeta.titleLabel} dateLabel={view.rideMeta.dateLabel} />
          </div>
        </>}

        {rejected && <section className="rejected-card"><span className="error-mark">!</span><h2>没有展示冲突数字</h2><p>系统宁可少说，也不会从损坏或矛盾的数据中挑一个看起来合理的答案。</p></section>}
        </section>}
      />
    </AppShell>
  );
}
