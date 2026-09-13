"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

import { beginRouteTransition } from "./route-transition";
import type { LoadingKey } from "./route-loading";

// 列表卡片这类「进入详情页」的链接：点击瞬间铺加载层，不等服务端往返。
// 修饰键点击（新标签页打开等）不触发，避免误铺。
export function PendingLink({ href, className, transitionKey, children }: {
  href: string;
  className?: string;
  transitionKey: LoadingKey;
  children: ReactNode;
}) {
  const pathname = usePathname();

  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (href === pathname) return;
    beginRouteTransition(transitionKey, pathname);
  }

  return <Link href={href} className={className} onClick={handleClick}>{children}</Link>;
}
