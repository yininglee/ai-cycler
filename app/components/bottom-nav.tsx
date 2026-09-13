"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { BikeIcon, SparkIcon } from "./icons";
import { beginRouteTransition } from "./route-transition";
import type { NavKey } from "./route-loading";

const TABS: Record<NavKey, { href: string; label: string }> = {
  today: { href: "/", label: "今日" },
  rides: { href: "/import", label: "骑行" },
  partner: { href: "/chat", label: "伙伴" },
};

// 乐观高亮的兜底时长：极端情况下（导航被中断）避免 tab 一直亮着。
const PENDING_HIGHLIGHT_FALLBACK_MS = 8000;

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

export function BottomNav({ active = "today" }: { active?: NavKey }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<NavKey | null>(null);
  const prefetched = useRef(new Set<string>());

  // 路由真正切换后才撤销乐观高亮。
  useEffect(() => {
    setPendingKey(null);
  }, [pathname]);

  useEffect(() => {
    if (!pendingKey) return;
    const timer = window.setTimeout(() => setPendingKey(null), PENDING_HIGHLIGHT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [pendingKey]);

  // 悬停 / 触摸即预热目标路由，让首次点击（含 dev 首次编译）更快。
  function warmUp(href: string): void {
    if (prefetched.current.has(href)) return;
    prefetched.current.add(href);
    router.prefetch(href);
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>, href: string, key: NavKey): void {
    if (isModifiedClick(event)) return;
    // 同一路径（含仅 query 变化）不铺加载层，避免闪一下。
    if (href === pathname) {
      setPendingKey(null);
      return;
    }
    setPendingKey(key);
    // 加载层由根布局的常驻实例渲染，这里只负责"发起"。
    beginRouteTransition(key, pathname);
  }

  const shownKey = pendingKey ?? active;

  function tab(key: NavKey): ReactNode {
    const { href, label } = TABS[key];
    return (
      <Link
        className={shownKey === key ? "active" : ""}
        href={href}
        aria-current={shownKey === key ? "page" : undefined}
        onClick={(event) => handleClick(event, href, key)}
        onPointerEnter={() => warmUp(href)}
        onTouchStart={() => warmUp(href)}
        onFocus={() => warmUp(href)}
      >
        {key === "today" ? <span className="nav-dot" /> : key === "rides" ? <BikeIcon /> : <SparkIcon />}
        {label}
      </Link>
    );
  }

  return <nav className="bottom-nav" aria-label="主导航">
    {tab("today")}
    {tab("rides")}
    <span className="nav-main" aria-hidden="true"><SparkIcon /></span>
    {tab("partner")}
  </nav>;
}
