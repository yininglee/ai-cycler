import Link from "next/link";

import { AppShell, Brand } from "./components/app-shell";
import { ArrowIcon, SparkIcon } from "./components/icons";
import { buildRidePageViewModel } from "../src/ui/ride-view-model";

export default function HomePage() {
  const recent = buildRidePageViewModel("l2-built-in-sample");

  return (
    <AppShell>
      <header className="topbar"><Brand /><Link className="eyebrow" href="/profile">个人资料</Link></header>
      <section className="welcome-block">
        <p className="kicker">晚上好</p>
        <h1>骑完之后，<br />终于看懂。</h1>
        <p className="lead">导入一条骑行记录，先看可信事实，再决定 AI 是否真的有帮助。</p>
      </section>

      <section className="hero-card">
        <span className="hero-orbit" aria-hidden="true" />
        <div className="hero-copy">
          <p>一次骑行 · 一次清晰复盘</p>
          <h2>让数据说人话，<br />也知道哪里不能说。</h2>
        </div>
        <Link className="light-button" href="/import">分析一次骑行 <ArrowIcon /></Link>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="kicker">继续体验</p><h2>最近一条样例</h2></div><Link href="/import">查看全部</Link></div>
        <Link className="recent-card" href="/rides/l2-built-in-sample">
          <div className="recent-icon"><SparkIcon /></div>
          <div><span className="status-chip">骑行记录</span><h3>{recent.analysis.output.headline}</h3><p>{recent.factCards.slice(0, 3).map((fact) => fact.value).join(" · ")}</p></div>
          <ArrowIcon className="arrow" />
        </Link>
      </section>

      <p className="privacy-note">当前页面只使用内置样例，不上传真实轨迹或调用模型。</p>
    </AppShell>
  );
}
