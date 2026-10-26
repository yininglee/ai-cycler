import Link from "next/link";

import { AppShell, Brand } from "../components/app-shell";
import styles from "./pmc.module.css";

export default function PmcPage() {
  return (
    <AppShell active="rides">
      <header className="topbar">
        <Brand />
        <Link className="step-pill" href="/import">骑行记录</Link>
      </header>
      <section className="page-intro compact">
        <p className="kicker">PMC</p>
        <h1>表现状态管理</h1>
        <p className="lead">查看训练负荷与恢复状态的变化。</p>
      </section>
      <section className={styles.placeholder} aria-labelledby="pmc-placeholder-title">
        <span className={styles.moduleTag}>PMC DEMO</span>
        <h2 id="pmc-placeholder-title">趋势视图正在准备</h2>
        <p>后续将在这里呈现表现状态变化。目前没有可展示的 PMC 数据。</p>
      </section>
    </AppShell>
  );
}
