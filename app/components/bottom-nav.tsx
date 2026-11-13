"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

import { BikeIcon, SparkIcon } from "./icons";
import { LinkProgress } from "./pending-link";
import type { NavKey } from "./route-loading";

const TABS: Record<NavKey, { href: string; label: string }> = {
  today: { href: "/chat", label: "伙伴" },
  profile: { href: "/profile", label: "我的" },
  rides: { href: "/import", label: "骑行" },
  partner: { href: "/chat", label: "伙伴" },
};

export function BottomNav({ active = "partner" }: { active?: NavKey }) {
  const router = useRouter();
  const prefetched = useRef(new Set<string>());

  // 悬停 / 触摸即预热目标路由，让首次点击（含 dev 首次编译）更快。
  function warmUp(href: string): void {
    if (prefetched.current.has(href)) return;
    prefetched.current.add(href);
    router.prefetch(href);
  }

  function tab(key: NavKey): ReactNode {
    const { href, label } = TABS[key];
    return (
      <Link
        className={active === key ? "active" : ""}
        href={href}
        aria-current={active === key ? "page" : undefined}
        onPointerEnter={() => warmUp(href)}
        onTouchStart={() => warmUp(href)}
        onFocus={() => warmUp(href)}
      >
        {key === "profile" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg> : key === "rides" ? <BikeIcon /> : <SparkIcon />}
        {label}
        {active !== key && <LinkProgress label={`正在打开${label}`} />}
      </Link>
    );
  }

  return <nav className="bottom-nav" aria-label="主导航">
    {tab("partner")}
    {tab("rides")}
    {tab("profile")}
  </nav>;
}
