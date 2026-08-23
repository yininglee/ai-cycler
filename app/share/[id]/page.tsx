import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { CopyButton } from "../../components/copy-button";
import { BackIcon, CheckIcon } from "../../components/icons";
import { buildRidePageViewModel, isDemoRideId } from "../../../src/ui/ride-view-model";

export default async function SharePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ template?: string }> }) {
  const { id } = await params;
  if (!isDemoRideId(id)) notFound();
  const view = buildRidePageViewModel(id);
  if (view.analysis.snapshot.analysisMode === "rejected") notFound();
  const template = (await searchParams).template === "light" ? "light" : "dark";
  const copy = view.analysis.output.shareCopy[0];

  return (
    <AppShell active="rides">
      <header className="detail-nav"><Link className="icon-button" href={`/rides/${id}`} aria-label="返回骑行详情"><BackIcon /></Link><span className="mode-pill">3 / 3 · 分享预览</span><span className="nav-spacer" /></header>
      <section className="page-intro compact"><p className="kicker">分享卡</p><h1>分享成果，隐藏位置。</h1><p className="lead">卡片只使用已验证的事实，不包含精确起终点。</p></section>

      <div className="template-tabs" aria-label="选择分享模板"><Link className={template === "dark" ? "active" : ""} href={`/share/${id}`}>深色数据卡</Link><Link className={template === "light" ? "active" : ""} href={`/share/${id}?template=light`}>浅色记录卡</Link></div>

      <section className={`share-card ${template}`}>
        <div className="share-top"><span>RIDE / NOTE</span><span className="privacy-pill"><CheckIcon />已隐藏起终点</span></div>
        <div className="route-art" aria-hidden="true"><span /><span /><span /><i /></div>
        <div className="share-copy"><p>骑行记录</p><h2>{view.analysis.output.headline}</h2><div className="share-facts">{view.factCards.slice(0, 4).map((fact) => <div key={fact.claimId}><strong>{fact.value}</strong><span>{fact.label}</span></div>)}</div></div>
        <footer>AI 骑行伙伴 · 骑行摘要</footer>
      </section>

      <section className="copy-card"><p className="kicker">可编辑文案</p><p>{copy}</p></section>
      <CopyButton text={copy} />
      <p className="privacy-note">保存为图片和系统分享将在后续独立工作项接入。</p>
    </AppShell>
  );
}
