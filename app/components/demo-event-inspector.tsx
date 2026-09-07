"use client";

import { useEffect, useState } from "react";

type DemoEvent = { eventId: string; type: string; occurredAt: string; requestRef?: string; rideRef?: string; attributes?: Record<string, string> };

const EVENT_LABELS: Record<string, string> = {
  import_started: "导入开始", import_completed: "导入完成", ai_requested: "AI 请求", ai_completed: "AI 完成",
  ai_degraded: "AI 降级", b0_visible: "基础摘要可见", evidence_viewed: "证据查看", feedback_submitted: "反馈",
  chat_requested: "Chat 请求", chat_completed: "Chat 完成", chat_degraded: "Chat 降级",
  share_previewed: "分享预览", share_copied: "分享文案复制", deletion_requested: "删除请求", deletion_completed: "删除完成",
};

function time(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

export function DemoEventInspector() {
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    fetch("/api/demo-events", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ events: DemoEvent[] }> : Promise.reject(new Error("events")))
      .then((body) => { setEvents(body.events); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, []);

  return <section className="event-inspector" aria-live="polite">
    <header><div><p className="kicker">LOCAL DEMO</p><h1>最小事件</h1></div><span>{events.length} 条</span></header>
    {status === "loading" && <p className="event-empty">正在读取当前开发会话的事件。</p>}
    {status === "error" && <p className="event-empty">事件暂时无法读取。</p>}
    {status === "ready" && events.length === 0 && <p className="event-empty">尚无事件。</p>}
    {events.length > 0 && <ol className="event-list">
      {events.map((event) => <li key={event.eventId}>
        <div><strong>{EVENT_LABELS[event.type] ?? event.type}</strong><span>{time(event.occurredAt)}</span></div>
        <code>{[event.requestRef ? `request:${event.requestRef}` : null, event.rideRef ? `ride:${event.rideRef}` : null, ...Object.entries(event.attributes ?? {}).map(([key, value]) => `${key}:${value}`)].filter(Boolean).join(" · ") || "session"}</code>
      </li>)}
    </ol>}
  </section>;
}
