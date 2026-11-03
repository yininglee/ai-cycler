"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PLATFORMS, platformInfo, type PlatformId } from "../../src/ux/platform-catalog";
import { CHAT_IMPORT_QUEUE_KEY, parseImportReceipts } from "../../src/chat/chat-import";
import { readStoredChatSession } from "../../src/chat/chat-session";
import type { PlatformAction, PlatformState, SyncResult } from "../../src/ux/platform";
import { BottomSheet } from "./profile-sheet";
import { RideFileUpload } from "./ride-file-upload";

export function PlatformConnection({ provider, fromChat = false, conversationId }: { provider: PlatformId; fromChat?: boolean; conversationId?: string }) {
  const info = platformInfo(provider);
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformState | null>(null);
  const [step, setStep] = useState<"idle" | "authorize" | "range">("idle");
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [scenario, setScenario] = useState("normal");
  async function load() {
    setError("");
    try { const r = await fetch(`/api/platform?provider=${provider}`); if (!r.ok) throw Error(); const data = await r.json(); setPlatform(data.platform); setRange(data.platform?.range ?? 30); setReady(true); }
    catch { setError("平台状态暂时无法读取，请重试。"); }
  }
  useEffect(() => { void load(); }, [provider]);
  async function act(action: PlatformAction) {
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await fetch("/api/platform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, range, scenario, provider }) });
      const data = await r.json(); if (!r.ok) throw Error(data.error);
      setPlatform(data.platform); setStep("idle");
      if (data.result) {
        setResult(data.result);
        const v = data.result as SyncResult;
        if (fromChat) {
          try {
            const origin = conversationId ?? sessionStorage.getItem("cycler-import-conversation") ?? readStoredChatSession()?.activeConversationId;
            if (!origin) throw new Error("missing origin conversation");
            const pending = parseImportReceipts(JSON.parse(sessionStorage.getItem(CHAT_IMPORT_QUEUE_KEY) ?? "[]"), origin);
            pending.push({ receiptId: crypto.randomUUID(), ids: v.rideIds, text: `${info.name}模拟同步完成：新增 ${v.added} 条、重复 ${v.duplicate} 条、失败 ${v.failed} 条。`, conversationId: origin });
            sessionStorage.setItem(CHAT_IMPORT_QUEUE_KEY, JSON.stringify(pending));
          } catch { /* The page still displays the completed sync if browser storage is unavailable. */ }
        }
      }
      router.refresh();
    } catch (e) { setError((e as Error).message || "同步失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="ride-sync">
    <section className="ux-card" aria-label={`${info.name}模拟关联`}>
      <div className="connection-identity"><PlatformMark provider={provider} /><div><h2>{info.name}</h2><p className="ux-meta">平台关联 · 模拟接入</p></div></div>
      <p>仅演示授权与同步，不会连接真实账户。同步样例会参与当前原型的统计和分析。</p>
      {!ready ? error ? <button onClick={() => void load()}>重试读取平台状态</button> : <p role="status">正在读取平台状态…</p> : <>
        {step === "idle" && (!platform || platform.status === "expired") && <><p>{platform ? "授权已失效，请重新授权；已有骑行保留。" : "尚未连接运动平台"}</p><button className="primary-button" disabled={busy} onClick={() => setStep("authorize")}>关联{info.name}（模拟）</button></>}
        {step === "authorize" && <div className="sync-step"><h3>模拟授权说明</h3><p>{info.name}将提供骑行时间、距离与可用传感器数据。本步骤不收集平台密码。</p><div className="ux-actions"><button className="primary-button" onClick={() => setStep("range")}>同意并模拟授权</button><button onClick={() => setStep("idle")}>取消授权</button></div></div>}
        {step === "range" && <div className="sync-step"><label>首次同步历史范围<select value={range} onChange={e => setRange(Number(e.target.value) as 7 | 30 | 90)}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label><p>连接后点击同步读取此范围；之后只新增尚未同步的记录。</p><div className="ux-actions"><button className="primary-button" disabled={busy} onClick={() => void act("connect")}>完成模拟连接</button><button disabled={busy} onClick={() => setStep("idle")}>取消</button></div></div>}
        {step === "idle" && platform?.status === "connected" && <><p>已模拟连接 · 历史范围 {platform.range} 天</p><p className="ux-meta">{platform.lastSyncAt ? `上次模拟同步：${new Date(platform.lastSyncAt).toLocaleString("zh-CN")}` : "尚未同步记录"}</p><div className="ux-actions"><button className="primary-button" disabled={busy} onClick={() => void act("sync")}>{busy ? "正在模拟同步…" : "模拟同步新增记录"}</button>{platform.failedIds.length > 0 && <button disabled={busy} onClick={() => void act("retry")}>重试失败记录（{platform.failedIds.length}）</button>}</div></>}
        {platform && <button className="clear-profile" disabled={busy} onClick={() => void act("disconnect")}>断开模拟连接（保留记录）</button>}
      </>}
      {busy && <p role="status">正在处理模拟平台请求，请稍候…</p>}
      {error && <p role="alert">{error}{!ready ? "" : " 输入和连接信息已保留，可重试当前操作。"}</p>}
      {result && <div role="status"><p>模拟同步完成：新增 {result.added} 条 · 重复 {result.duplicate} 条 · 失败 {result.failed} 条</p>{!result.added && !result.failed && <p>没有新增记录。</p>}</div>}
      {result && result.rideIds.length > 0 && <div className="ux-actions"><Link href="/import">查看骑行记录</Link></div>}
      <details className="sync-demo-settings"><summary>模拟状态演示</summary><label>下次同步结果<select value={scenario} onChange={e => setScenario(e.target.value)}><option value="normal">正常／失败重试恢复</option><option value="partial">部分记录失败</option><option value="network">连接中断</option></select></label><div className="ux-actions"><button disabled={busy || !platform} onClick={() => void act("expire")}>模拟授权失效</button><button disabled={busy || platform?.status !== "connected"} onClick={() => void act("add-sample")}>模拟平台新增一条记录</button></div><p>新增样例后再次同步可检查增量；重复同步不会增加记录。</p></details>
    </section>

  </div>;
}
function PlatformMark({ provider }: { provider: PlatformId }) {
  const info = platformInfo(provider);
  return <span className={`platform-mark platform-mark-${provider}`} aria-hidden="true">{info.mark}</span>;
}

export function RideSync({ onComplete, conversationId }: { onComplete?: (ids: string[], text: string, conversationId?: string) => void; conversationId?: string }) {
  const pathname = usePathname();
  const [view, setView] = useState<"sources" | "file">("sources");
  const from = conversationId || pathname === "/chat" ? "chat" : pathname === "/profile" ? "profile" : "import";
  if (view === "file") return <div className="ride-sync">
    <button className="import-back" onClick={() => setView("sources")}>‹ 返回导入方式</button>
    <RideFileUpload onImported={onComplete ? (id, duplicate) => onComplete([id], duplicate ? "这个文件已导入，已找到原记录，没有重复创建。" : "文件上传成功，已真实导入 1 条骑行记录。", conversationId) : undefined} />
  </div>;
  return <div className="import-sources">
    <section className="import-source-group" aria-label="关联应用">
      <header><h3>关联应用</h3><p>同步运动数据</p></header>
      <div className="platform-list">{PLATFORMS.map(info => <Link className="import-source-row" key={info.id} href={`/connections/${info.id}?${new URLSearchParams({ from, ...(conversationId ? { conversation: conversationId } : {}) })}`} onClick={() => {
        if (from === "chat") {
          const id = conversationId ?? readStoredChatSession()?.activeConversationId;
          try { if (id) sessionStorage.setItem("cycler-import-conversation", id); } catch {}
        }
      }}><PlatformMark provider={info.id} /><span className="import-source-copy"><strong>{info.name}</strong></span><span className="import-source-arrow" aria-hidden="true">›</span></Link>)}</div>
      <p className="import-source-note">平台关联与同步为模拟演示</p>
    </section>
    <section className="import-source-group" aria-label="本地文件导入">
      <button className="import-source-row import-file-row" onClick={() => setView("file")}>
        <span className="platform-mark platform-mark-file" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></svg></span>
        <span className="import-source-copy"><strong>本地文件导入</strong><small>支持 FIT / GPX 文件，最大 50 MB</small></span><span className="import-source-arrow" aria-hidden="true">›</span>
      </button>
    </section>
  </div>;
}

export function RideSyncLauncher({ label = "同步／导入骑行", onComplete, conversationId }: { label?: string; onComplete?: (ids: string[], text: string, conversationId?: string) => void; conversationId?: string }) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<string>();
  return <><button type="button" onClick={() => { setOrigin(conversationId ?? readStoredChatSession()?.activeConversationId); setOpen(true); }}>{label}</button><BottomSheet open={open} title="同步／导入骑行记录" onClose={() => setOpen(false)}><RideSync conversationId={origin} onComplete={onComplete ? (ids, text, sourceId) => { onComplete(ids, text, sourceId); setOpen(false); } : undefined} /></BottomSheet></>;
}
