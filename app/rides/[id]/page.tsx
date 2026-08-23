import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { BackIcon, BikeIcon } from "../../components/icons";
import { RideRouteHero, RideSeriesCharts } from "../../components/ride-visuals";
import { buildRidePageViewModel, isDemoRideId } from "../../../src/ui/ride-view-model";

export default async function RideDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!isDemoRideId(id)) notFound();
  const view = buildRidePageViewModel(id);
  const { snapshot } = view.analysis;
  const rejected = snapshot.analysisMode === "rejected";
  const activeTab = query.tab === "analysis" || query.tab === "data" ? query.tab : "summary";
  const pageClassName = activeTab === "summary" && !rejected ? "ride-detail-page ride-detail-summary-page" : "ride-detail-page";

  return (
    <AppShell active="rides">
      <div className={pageClassName}>
        <header className="detail-nav">
          <Link className="icon-button" href="/import" aria-label="返回选择记录"><BackIcon /></Link>
          <nav className="detail-tabs" aria-label="骑行记录详情" role="tablist">
            <Link href={`/rides/${id}`} role="tab" aria-selected={activeTab === "summary"} className={activeTab === "summary" ? "active" : ""}>摘要</Link>
            <Link href={`/rides/${id}?tab=analysis`} role="tab" aria-selected={activeTab === "analysis"} className={activeTab === "analysis" ? "active" : ""}>分析</Link>
            <Link href={`/rides/${id}?tab=data`} role="tab" aria-selected={activeTab === "data"} className={activeTab === "data" ? "active" : ""}>数据</Link>
          </nav>
          <span className="nav-spacer" aria-hidden="true" />
        </header>

        {activeTab === "summary" && <section className="summary-tab" aria-label="骑行摘要">
        {!rejected && <>
          {view.visuals.route && <RideRouteHero route={view.visuals.route} />}
          <div className="summary-sheet">
            <span className="summary-sheet-handle" aria-hidden="true" />
            <section className="summary-record-heading" aria-label="骑行记录信息">
              <span className="summary-record-icon"><BikeIcon /></span>
              <div>{view.rideMeta.dateLabel && <p>{view.rideMeta.dateLabel}</p>}<h1>{view.rideMeta.titleLabel}</h1></div>
            </section>
            <section className="summary-metrics" aria-label="核心骑行事实">
              {view.factCards.map((fact) => <article className="summary-metric" key={fact.claimId}><p>{fact.label}</p><strong>{fact.value}</strong></article>)}
            </section>
          </div>
        </>}

        {rejected && <section className="rejected-card"><span className="error-mark">!</span><h2>没有展示冲突数字</h2><p>系统宁可少说，也不会从损坏或矛盾的数据中挑一个看起来合理的答案。</p></section>}
        </section>}

        {activeTab === "analysis" && <section className="analysis-tab" aria-label="骑行分析">
        {rejected ? <section className="rejected-card"><span className="error-mark">!</span><h2>记录未通过校验</h2><p>损坏或矛盾记录不展示图表，请检查原始文件后重新导入。</p></section> : <RideSeriesCharts charts={view.visuals.charts} />}
        </section>}

        {activeTab === "data" && <section className="data-tab" aria-label="骑行详细数据">
        {rejected ? <section className="rejected-card"><span className="error-mark">!</span><h2>记录未通过校验</h2><p>损坏或矛盾记录不展示数字，请检查原始文件后重新导入。</p></section> : <>
          {view.detailSections.map((section) => <section className="data-section" key={section.key}>
            <header><div><h2>{section.title}</h2></div></header>
            <div className="metric-list">
              {section.metrics.map((metric) => <article className="metric-row" key={metric.claimId}>
                <div><p>{metric.label}</p></div>
                <strong>{metric.value}</strong>
              </article>)}
            </div>
          </section>)}

        </>}
        </section>}
      </div>
    </AppShell>
  );
}
