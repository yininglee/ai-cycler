"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { RouteLoadingBody, type LoadingKey } from "./route-loading";

// 加载层是**客户端乐观**的：点击瞬间就铺上，不等服务端。
// 它挂在根布局上（常驻实例），因此跨路由切换不会被卸载重建。
type Pending = { key: LoadingKey; from: string } | null;

let pending: Pending = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function getSnapshot(): Pending { return pending; }
function getServerSnapshot(): Pending { return null; }
function emit(): void { listeners.forEach((listener) => listener()); }

// 记下点击时所在的路径：一旦 pathname 变了就说明已经到达目标页，加载层立即停渲染。
export function beginRouteTransition(key: LoadingKey, from: string): void {
  pending = { key, from };
  emit();
}

export function endRouteTransition(): void {
  if (!pending) return;
  pending = null;
  emit();
}

// 兜底：导航被中断时不要一直挂着。
const TRANSITION_FALLBACK_MS = 8000;

export function RouteTransitionOverlay() {
  const pathname = usePathname();
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // from !== pathname 即「已到达」，本次渲染直接不输出加载层（不靠 effect 收，避免多画一帧）。
  const shown = current && current.from === pathname ? current.key : null;

  useEffect(() => {
    if (current && current.from !== pathname) endRouteTransition();
  }, [current, pathname]);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => endRouteTransition(), TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;
  return <div className="route-loading-overlay">
    <div className="app-viewport">
      <main className="page-content"><RouteLoadingBody active={shown} /></main>
    </div>
  </div>;
}
