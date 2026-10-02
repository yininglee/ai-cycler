import Link from "next/link";

import { AppShell, Brand } from "./components/app-shell";
import { ArrowIcon } from "./components/icons";
import { PendingLink } from "./components/pending-link";

export default function HomePage() {
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
        <PendingLink className="light-button" href="/import" transitionKey="rides">分析一次骑行 <ArrowIcon /></PendingLink>
      </section>

      <p className="privacy-note">当前页面只使用内置样例，不上传真实轨迹或调用模型。</p>
    </AppShell>
  );
}
