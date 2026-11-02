"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CalendarRide } from "../../src/ui/ride-calendar";
import { calendarDuration } from "../../src/ui/ride-calendar";
import { InterpretationSheet } from "./interpretation-sheet";
import { RideCardStack } from "./ride-card-stack";
import { rememberStoredRideInspection } from "../../src/chat/chat-import";

type RideSummary = CalendarRide & { title: string; heartRate: boolean; power: boolean };
export function RideRecordCards({ ids, fromChat = false, onInspect, conversationId }: { ids: string[]; fromChat?: boolean; onInspect?: (id: string) => void; conversationId?: string }) {
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<RideSummary | null>(null);
  useEffect(() => { if (loaded || error) window.dispatchEvent(new Event("cycler-rides-ready")); }, [loaded, error]);
  const fingerprint = JSON.stringify(ids);
  useEffect(() => {
    let active = true;
    setLoaded(false); setError("");
    const query = new URLSearchParams();
    (JSON.parse(fingerprint) as string[]).forEach(id => query.append("id", id));
    fetch(`/api/rides/summary?${query}`).then(async r => { if (!r.ok) throw Error(); return r.json(); }).then(data => { if (active) { setRides(data.rides); setLoaded(true); } }).catch(() => { if (active) setError("记录暂时无法读取，请重试。"); });
    return () => { active = false; };
  }, [fingerprint, attempt]);
  const dateLabel = (ride: RideSummary) => ride.startTime ? new Date(ride.startTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "日期未记录";
  function inspect(id: string) { if (onInspect) onInspect(id); else if (fromChat) rememberStoredRideInspection(id, conversationId); }
  return <div className="sync-records">
    {error ? <p role="alert">{error}<button onClick={() => setAttempt(n => n + 1)}>重试读取</button></p> : !loaded ? <p role="status">正在读取骑行…</p> : !rides.length ? <p>记录已不可用或不在当前演示视图中，请重新选择。</p> : <>
      <RideCardStack cards={rides.map(ride => ({ id: ride.id, content: <article className="sync-record">
        <small>{dateLabel(ride)} · {ride.source}</small><h3>{ride.title}</h3>
        <p>{ride.distanceM === null ? "距离未记录" : `${(ride.distanceM / 1000).toFixed(1)} km`} · {ride.durationS === null ? "时长未记录" : calendarDuration(ride.durationS)}</p>
        <p className="ux-meta">{ride.heartRate ? "有心率" : "无心率"} · {ride.power ? "有功率" : "无功率"}{!ride.heartRate || !ride.power ? "；缺失维度不作强度或能力判断。" : ""}</p>
        <div className="ux-actions"><button className="primary-button" onClick={() => { inspect(ride.id); setSelected(ride); }}>查看深度解读</button><Link onClick={() => inspect(ride.id)} href={`/rides/${encodeURIComponent(ride.id)}${fromChat ? `?${new URLSearchParams({ from: "chat", ...(conversationId ? { conversation: conversationId } : {}) })}` : ""}`}>查看骑行详情</Link></div>
      </article> }))} />
    </>}
    {selected && <InterpretationSheet rideId={selected.id} title={selected.title} dateLabel={dateLabel(selected)} onClose={() => setSelected(null)} />}
  </div>;
}
