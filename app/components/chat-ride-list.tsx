"use client";
import Link from "next/link";
import { useState } from "react";
import { InterpretationSheet } from "./interpretation-sheet";
import { RideCardStack } from "./ride-card-stack";
import { PendingLink } from "./pending-link";
import type { ChatArtifact, ChatChoice, ChatChoiceRef, ChatQuickAction, ChatRideListItem } from "../../src/chat/chat-interaction";

export function ChatRideList({ artifact, choices, quickActions, pending, onChoose, onInspect, conversationId }: {
  artifact?: ChatArtifact; choices?: ChatChoice[]; quickActions?: ChatQuickAction[]; pending: boolean; onChoose?: (choice: ChatChoiceRef) => void; onInspect?: (id: string) => void; conversationId?: string;
}) {
  const [selected, setSelected] = useState<ChatRideListItem | null>(null);
  const list = artifact?.kind === "ride_list" ? artifact.payload : null;
  const items: ChatRideListItem[] = list?.items ?? (choices?.filter(c => c.kind === "ride").map(c => ({ rideId: c.id, dateLabel: c.label })) ?? quickActions?.map(a => ({ rideId: a.rideId, dateLabel: a.dateLabel })) ?? []);
  if (!items.length) return null;
  return <div className="chat-ride-results" aria-label="本轮查询的骑行记录">
    <RideCardStack cards={items.map(item => {
      const title = item.title ?? "骑行记录";
      const needsChoice = !!onChoose && choices?.some(choice => choice.kind === "ride" && choice.id === item.rideId);
      const sensors = [
        item.hasHeartRate === undefined ? null : item.hasHeartRate ? "有心率" : "无心率",
        item.hasPower === undefined ? null : item.hasPower ? "有功率" : "无功率",
      ].filter(Boolean).join(" · ");
      return { id: item.rideId, content: <article className="chat-ride-result">
        <PendingLink className="chat-ride-detail-target" aria-label={`查看骑行详情，${title}，${item.dateLabel}`} onClick={() => onInspect?.(item.rideId)} href={`/rides/${encodeURIComponent(item.rideId)}?${new URLSearchParams({ from: "chat", ...(conversationId ? { conversation: conversationId } : {}) })}`}>
          <header className="chat-ride-result-meta">
            <h3>{title}</h3>
            <small>{item.dateLabel}</small>
          </header>
          {list && <dl className="chat-ride-metrics">
            <div>
              <dt>距离</dt>
              <dd>{item.distanceKm === undefined ? <span>未记录</span> : <>{Number(item.distanceKm.toFixed(1))} <span>km</span></>}</dd>
            </div>
            <div>
              <dt>时长</dt>
              <dd className="chat-ride-duration">{item.durationLabel ?? <span>未记录</span>}</dd>
            </div>
          </dl>}
          {sensors && <p className="chat-ride-sensors">{sensors}</p>}
        </PendingLink>
        <div className="chat-ride-result-actions">
          {needsChoice && <button type="button" className="chat-ride-action-primary" disabled={pending} onClick={() => onChoose?.({ kind: "ride", id: item.rideId })}>选择这次骑行</button>}
          <button type="button" className={needsChoice ? undefined : "chat-ride-action-primary"} onClick={() => { onInspect?.(item.rideId); setSelected(item); }}>查看深度解读</button>
        </div>
      </article> };
    })} />
    {list?.truncated && <p className="chat-ride-sensors">本轮共查询到 {list.totalCount} 条，卡片展示最近 {list.items.length} 条。<Link href="/import">查看全部骑行</Link></p>}
    {selected && <InterpretationSheet rideId={selected.rideId} title={selected.title ?? "骑行记录"} dateLabel={selected.dateLabel} onClose={() => setSelected(null)} />}
  </div>;
}
