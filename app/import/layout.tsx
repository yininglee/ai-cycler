import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { BikeIcon } from "../components/icons";
import styles from "../components/ride-calendar.module.css";

export default function ImportLayout({ children }: { children: ReactNode }) {
  return <AppShell active="rides">
    <header className={styles.pageHeader}>
      <Link href="/" className={`brand ${styles.pageIdentity}`} aria-label="返回首页">
        <span className="brand-mark"><BikeIcon /></span>
        <h1 className={styles.pageTitle}>骑行记录</h1>
      </Link>
      <nav className={styles.pageActions} aria-label="快捷入口">
        <Link className="eyebrow" href="/chat?recent=1">近期表现</Link>
        <Link className="eyebrow" href="/pmc" aria-label="PMC 表现状态管理">PMC</Link>
      </nav>
    </header>
    {children}
  </AppShell>;
}
