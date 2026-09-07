import Link from "next/link";
import type { ReactNode } from "react";

import { BikeIcon, SparkIcon } from "./icons";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="返回首页">
      <span className="brand-mark"><BikeIcon /></span>
      <span>骑行伙伴</span>
    </Link>
  );
}

export function AppShell({ children, active = "today" }: { children: ReactNode; active?: "today" | "rides" | "partner" }) {
  return (
    <div className="app-viewport">
      <main className="page-content">{children}</main>
      <nav className="bottom-nav" aria-label="主导航">
        <Link className={active === "today" ? "active" : ""} href="/"><span className="nav-dot" />今日</Link>
        <Link className={active === "rides" ? "active" : ""} href="/import"><BikeIcon />骑行</Link>
        <span className="nav-main" aria-hidden="true"><SparkIcon /></span>
        <Link className={active === "partner" ? "active" : ""} href="/chat"><SparkIcon />伙伴</Link>
      </nav>
    </div>
  );
}
