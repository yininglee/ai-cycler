import { Brand } from "./brand";

export type NavKey = "today" | "rides" | "partner" | "profile";
// 加载文案的粒度比底部导航更细：骑行详情与「骑行」同属一个 tab，但等待语义不同。
export type LoadingKey = NavKey | "ride-detail";

const ROUTE_LOADING_LABELS: Record<LoadingKey, { title: string; hint: string }> = {
  profile: { title: "正在打开我的", hint: "读取已确认的资料与主要目标。" },
  today: { title: "正在打开今日", hint: "汇总最近一次骑行与本周进度。" },
  rides: { title: "正在打开骑行记录", hint: "基础事实会优先出现，不需要等待 AI。" },
  partner: { title: "正在打开骑行伙伴", hint: "正在读取你的骑行摘要，稍等一下。" },
  "ride-detail": { title: "正在打开骑行详情", hint: "基础事实会优先出现，不需要等待 AI。" },
};

// 目标页面的骨架内容（不含底部导航与 <main> 外壳）：
// 既用于各路由的 loading.tsx，也用于点击后立即铺上的加载层。
export function RouteLoadingBody({ active }: { active: LoadingKey }) {
  const label = ROUTE_LOADING_LABELS[active];
  return <>
    <header className="topbar"><Brand /></header>
    <div className="state-card" role="status" aria-live="polite">
      <span className="spinner" />
      <h2>{label.title}</h2>
      <p>{label.hint}</p>
    </div>
  </>;
}
