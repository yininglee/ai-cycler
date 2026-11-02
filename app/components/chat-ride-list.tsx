"use client";
import Link from "next/link";
import { useState } from "react";
import { InterpretationSheet } from "./interpretation-sheet";
import { RideCardStack } from "./ride-card-stack";
import type { ChatArtifact, ChatChoice, ChatChoiceRef, ChatQuickAction, ChatRideListItem } from "../../src/chat/chat-interaction";

export function ChatRideList({ artifact, choices, quickActions, pending, onChoose, onInspect, conversationId }: {
  artifact?: ChatArtifact; choices?: ChatChoice[]; quickActions?: ChatQuickAction[]; pending: boolean; onChoose: (choice: ChatChoiceRef) => void; onInspect?: (id: string) => void; conversationId?: string;
}) {
  const [selected, setSelected] = useState<ChatRideListItem | null>(null);
  const list = artifact?.kind === "ride_list" ? artifact.payload : null;
  const items: ChatRideListItem[] = list?.items ?? (choices?.filter(c => c.kind === "ride").map(c => ({ rideId: c.id, dateLabel: c.label })) ?? quickActions?.map(a => ({ rideId: a.rideId, dateLabel: a.dateLabel })) ?? []);
  if (!items.length) return null;
  return <div className="chat-ride-results" aria-label="本轮查询的骑行记录">
    <RideCardStack cards={items.map(item => ({ id: item.rideId, content: <article className="chat-ride-result">
      <small>{item.dateLabel}</small><h3>{item.title ?? "骑行记录"}</h3>
      <p>{item.distanceKm === undefined ? "距离未记录" : `${Number(item.distanceKm.toFixed(1))} km`}{item.durationLabel ? ` · ${item.durationLabel}` : ""}</p>
      {(item.hasHeartRate !== undefined || item.hasPower !== undefined) && <p className="chat-ride-sensors">{item.hasHeartRate ? "有心率" : "无心率"} · {item.hasPower ? "有功率" : "无功率"}</p>}
      <div className="chat-ride-result-actions"><button onClick={() => { onInspect?.(item.rideId); setSelected(item); }}>查看深度解读</button><button disabled={pending} onClick={() => onChoose({ kind: "ride", id: item.rideId })}>{choices?.some(c => c.id === item.rideId) ? "选择这次骑行" : "聊聊这次"}</button><Link onClick={() => onInspect?.(item.rideId)} href={`/rides/${encodeURIComponent(item.rideId)}?${new URLSearchParams({ from: "chat", ...(conversationId ? { conversation: conversationId } : {}) })}`}>详情</Link></div>
    </article> }))} />
    {list?.truncated && <p className="chat-ride-sensors">本轮共查询到 {list.totalCount} 条，卡片展示最近 {list.items.length} 条。<Link href="/import">查看全部骑行</Link></p>}
    {selected && <InterpretationSheet rideId={selected.rideId} title={selected.title ?? "骑行记录"} dateLabel={selected.dateLabel} onClose={() => setSelected(null)} />}
  </div>;
}
