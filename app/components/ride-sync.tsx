"use client";

import { useAccountStorage } from "./account-scope";
import { createClientRequestId } from "../../src/ui/client-request-id";
import { StatusBadge } from "./status-badge";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isImportPlatform, PLATFORMS, platformInfo, type PlatformId } from "../../src/ux/platform-catalog";
import { CHAT_IMPORT_QUEUE_KEY, parseImportReceipts } from "../../src/chat/chat-import";
import { readStoredChatSession } from "../../src/chat/chat-session";
import type { PlatformAction, PlatformState, SyncResult } from "../../src/ux/platform";
import type { XingzheSetupIssue } from "../../src/sync/xingzhe-client";
import { BottomSheet } from "./profile-sheet";
import { RideFileUpload } from "./ride-file-upload";

type ConnectionStatus = PlatformState & { lastAttemptAt?: string; retryAt?: number; error?: string; result?: SyncResult };

const authorizationMessages: Record<string, string> = {
  denied: "行者授权已取消。",
  invalid: "授权请求已失效，请重新连接行者。",
  invalid_client: "行者拒绝了应用凭据，请核对开发者后台的应用 ID 和应用密钥。",
  invalid_code: "行者拒绝了本次授权码，请重新点击「连接行者」完成授权。",
  redirect_mismatch: "行者拒绝了回调地址，请核对行者后台和 Cycler 的回调地址。",
  token_rejected: "行者拒绝了令牌交换，请重新授权；如仍失败，请核对行者应用配置。",
  token_failed: "Cycler 未能取得行者授权令牌，请重新连接。",
  profile_rejected: "行者已签发令牌，但拒绝读取账号信息。请核对应用的读取权限。",
  profile_failed: "Cycler 已取得授权令牌，但暂时无法读取行者账号信息。",
  rate_limited: "行者限制了请求频率，请稍后重新连接。",
  save_failed: "已完成行者授权，但保存 Cycler 连接失败，请重试。",
  failed: "Cycler 暂时无法处理行者授权，请重试。",
};

const xingzheUnavailableMessages: Record<XingzheSetupIssue, string> = {
  disabled: "当前服务尚未启用行者授权同步。启用后可连接行者账号，再点击「立即同步」。",
  incomplete: "当前服务的行者开放平台配置尚未填写完整。",
  invalid_callback: "当前服务的行者授权回调地址配置有误。",
};

export function PlatformConnection({ provider, from, conversationId, oauth }: { provider: PlatformId; from?: string; conversationId?: string; oauth?: string }) {
  const { scope, sessionData } = useAccountStorage();
  const info = platformInfo(provider);
  const router = useRouter();
  const [platform, setPlatform] = useState<ConnectionStatus | null>(null);
  const [live, setLive] = useState(false);
  const [fileOnly, setFileOnly] = useState(false);
  const [requiresAccount, setRequiresAccount] = useState(false);
  const [syncUnavailable, setSyncUnavailable] = useState<XingzheSetupIssue>();
  const [authorizationMessage, setAuthorizationMessage] = useState(oauth && Object.hasOwn(authorizationMessages, oauth) ? authorizationMessages[oauth] : "");
  const [step, setStep] = useState<"idle" | "authorize" | "range">("idle");
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionUrl, setConnectionUrl] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [scenario, setScenario] = useState("normal");
  async function load() {
    setError("");
    try {
      const response = await fetch(`/api/platform?provider=${provider}`);
      if (!response.ok) throw new Error("Platform request failed");
      const data = await response.json();
      setLive(data.live === true);
      setFileOnly(data.fileOnly === true);
      setRequiresAccount(data.requiresAccount === true);
      setSyncUnavailable(data.syncUnavailable);
      setPlatform(data.platform);
      setRange(data.platform?.range ?? 30);
      setReady(true);
    }
    catch { setError("平台状态暂时无法读取，请重试。"); }
  }
  useEffect(() => { void load(); }, [provider]);
  function originConversation() {
    return conversationId ?? sessionData.getItem("cycler-import-conversation") ?? readStoredChatSession(scope)?.activeConversationId;
  }
  function recordReceipt(ids: string[], text: string) {
    if (from !== "chat") return;
    try {
      const origin = originConversation();
      if (!origin) return;
      const pending = parseImportReceipts(JSON.parse(sessionData.getItem(CHAT_IMPORT_QUEUE_KEY) ?? "[]"), origin);
      pending.push({ receiptId: createClientRequestId(), ids: ids.slice(0, 10), text, conversationId: origin });
      sessionData.setItem(CHAT_IMPORT_QUEUE_KEY, JSON.stringify(pending));
    } catch { /* The import result is still shown on this page. */ }
  }
  async function act(action: PlatformAction | "reimport-deleted") {
    setBusy(true); setError(""); setConnectionUrl(null); setResult(null); setAuthorizationMessage("");
    try {
      let origin = conversationId;
      try { if (from === "chat") origin = originConversation(); } catch {}
      const r = await fetch("/api/platform", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, range, scenario, provider, from, conversationId: origin }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (typeof data.connectionUrl === "string") setConnectionUrl(data.connectionUrl);
        throw Error(data.error);
      }
      if (typeof data.authorizationUrl === "string") {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setLive(data.live === true);
      setPlatform(data.platform); setStep("idle");
      const v = (data.live && (action === "sync" || action === "reimport-deleted") ? data.platform?.result : data.result) as SyncResult | undefined;
      if (v) {
        setResult(v);
        if (!data.live || v.rideIds.length > 0) {
          recordReceipt(v.rideIds, `${info.name}${data.live ? "" : "模拟"}同步结果。新增 ${v.added} 条${v.updated ? `、补全 ${v.updated} 条` : ""}、重复 ${v.duplicate} 条、失败 ${v.failed} 条。`);
        }
      }
      router.refresh();
    } catch (e) { setError((e as Error).message || "同步失败，请重试。"); }
    finally { setBusy(false); }
  }
  const fileImport = isImportPlatform(provider) ? <RideFileUpload platform={provider}
    onImported={from === "chat" ? (id, duplicate) => recordReceipt([id], duplicate
      ? `这个${info.name}文件已导入，已找到原记录。`
      : `已导入 1 条${info.name}骑行记录。`) : undefined} /> : null;
  if (!ready) return <div className="ride-sync">
    <section className="ux-card">{error
      ? <><p role="alert">{error}</p><button onClick={() => void load()}>重试读取平台状态</button></>
      : <p role="status">正在读取平台状态…</p>}</section>
    {fileImport}
  </div>;
  if (fileOnly) return <div className="ride-sync">
    <section className="ux-card">
      <div className="connection-identity"><PlatformMark provider={provider} /><h2>{syncUnavailable ? "行者同步" : info.name}</h2></div>
      <p>{syncUnavailable ? xingzheUnavailableMessages[syncUnavailable]
        : requiresAccount ? "登录 Cycler 后可授权并同步行者骑行记录。" : "当前可通过骑行文件导入记录。"}</p>
      {requiresAccount && <Link className="primary-button" href="/account?returnTo=%2Fconnections%2Fxingzhe">登录或注册</Link>}
      {!fileImport && <Link className="secondary-button" href="/import">前往骑行记录</Link>}
    </section>
    {fileImport}
  </div>;
  if (live) {
    const latest = result ?? platform?.result;
    const connected = platform?.status === "connected";
    const retryAt = platform?.retryAt;
    const duplicateLabel = provider === "xingzhe" ? (latest?.skippedDeleted === undefined ? "已跳过" : "已在列表") : "重复";
    const showReimport = provider === "xingzhe" && connected && latest
      && (latest.skippedDeleted ?? latest.duplicate) > 0;
    return <div className="ride-sync"><section className="ux-card" aria-label={`${info.name}同步`}>
      <div className="connection-identity"><PlatformMark provider={provider} /><div><h2>{info.name}</h2><p className="ux-meta">{provider === "onelap" ? "骑行同步 · 测试接入" : "骑行记录同步"}</p></div></div>
      <p><StatusBadge tone={connected ? "active" : platform ? "error" : "neutral"}>{connected ? "已连接" : platform ? "连接需要更新" : "尚未连接"}</StatusBadge></p>
      <p>{connected ? `点击「立即同步」，导入${info.name}上的骑行记录。` : `授权连接${info.name}后，点击「立即同步」即可导入骑行记录。`}</p>
      {provider === "xingzhe" && <p className="ux-meta">优先同步行者提供的 FIT 文件，也会补全已导入的摘要。文件不可用时，只显示距离和总时间等摘要数据。</p>}
      {platform?.lastSyncAt && <p className="ux-meta">上次成功同步：{new Date(platform.lastSyncAt).toLocaleString("zh-CN")}</p>}
      {retryAt && retryAt > Date.now() && <p className="ux-meta">可重试时间：{new Date(retryAt).toLocaleString("zh-CN")}</p>}
      <div className="ux-actions">
        <button className="primary-button" disabled={busy} onClick={() => void act(connected ? "sync" : "connect")}>{connected ? "立即同步" : platform ? "重新连接" : `连接${info.name}`}</button>
        {platform && <button disabled={busy} onClick={() => void act("disconnect")}>断开连接</button>}
      </div>
      {busy && <p role="status">正在处理{info.name}同步请求…</p>}
      {(error || authorizationMessage || platform?.error) && <p role="alert">{error || authorizationMessage || platform?.error}</p>}
      {connectionUrl && <div className="ux-actions"><a className="secondary-button" href={connectionUrl}>打开配置的 Cycler 地址</a></div>}
      {latest && <div className="ui-notice" role="status">
        <p>新增 {latest.added} 条{latest.updated ? ` · 补全 ${latest.updated} 条` : ""} · {duplicateLabel} {latest.duplicate} 条 · 失败 {latest.failed} 条</p>
        {!!latest.skippedDeleted && <p>已跳过 {latest.skippedDeleted} 条在 Cycler 中删除的记录。</p>}
        {!!latest.summaryOnly && <p>{latest.summaryOnly} 条仅有摘要，未取得可用的 FIT 数据。</p>}
      </div>}
      {showReimport && <div className="ux-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void act("reimport-deleted")}>重新导入已删除记录</button>
      </div>}
      {latest && latest.rideIds.length > 0 && <div className="ux-actions"><Link className="secondary-button" href="/import">查看骑行记录<span aria-hidden="true">→</span></Link></div>}
    </section>{fileImport}</div>;
  }
  return <div className="ride-sync">
    <section className="ux-card" aria-label={`${info.name}模拟关联`}>
      <div className="connection-identity"><PlatformMark provider={provider} /><div><h2>{info.name}</h2><p className="ux-meta">平台关联 · 模拟接入</p></div></div>
      <p>仅演示授权与同步，不会连接真实账户。同步样例会参与当前原型的统计和分析。</p>
      <>
        {step === "idle" && (!platform || platform.status === "expired") && <><p><StatusBadge tone={platform ? "error" : "neutral"}>{platform ? "授权已失效" : "尚未连接运动平台"}</StatusBadge></p>{platform && <p>请重新授权；已有骑行保留。</p>}<button className="primary-button" disabled={busy} onClick={() => setStep("authorize")}>关联{info.name}（模拟）</button></>}
        {step === "authorize" && <div className="sync-step"><h3>模拟授权说明</h3><p>{info.name}将提供骑行时间、距离与可用传感器数据。本步骤不收集平台密码。</p><div className="ux-actions"><button className="primary-button" onClick={() => setStep("range")}>同意并模拟授权</button><button onClick={() => setStep("idle")}>取消授权</button></div></div>}
        {step === "range" && <div className="sync-step"><label>首次同步历史范围<select value={range} onChange={e => setRange(Number(e.target.value) as 7 | 30 | 90)}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label><p>连接后点击同步读取此范围；之后只新增尚未同步的记录。</p><div className="ux-actions"><button className="primary-button" disabled={busy} onClick={() => void act("connect")}>完成模拟连接</button><button disabled={busy} onClick={() => setStep("idle")}>取消</button></div></div>}
        {step === "idle" && platform?.status === "connected" && <><p><StatusBadge tone="active">已模拟连接</StatusBadge></p><p>历史范围 {platform.range} 天</p><p className="ux-meta">{platform.lastSyncAt ? `上次模拟同步：${new Date(platform.lastSyncAt).toLocaleString("zh-CN")}` : "尚未同步记录"}</p><div className="ux-actions"><button className="primary-button" disabled={busy} onClick={() => void act("sync")}>{busy ? "正在模拟同步…" : "模拟同步新增记录"}</button>{platform.failedIds.length > 0 && <button disabled={busy} onClick={() => void act("retry")}>重试失败记录（{platform.failedIds.length}）</button>}</div></>}
        {platform && <button className="clear-profile" disabled={busy} onClick={() => void act("disconnect")}>断开模拟连接（保留记录）</button>}
      </>
      {busy && <p role="status">正在处理模拟平台请求，请稍候…</p>}
      {error && <p role="alert">{error}{!ready ? "" : " 输入和连接信息已保留，可重试当前操作。"}</p>}
      {result && <div className="ui-notice" role="status"><StatusBadge tone={result.failed ? "error" : "active"}>{result.failed ? "部分同步失败" : "同步完成"}</StatusBadge><p>模拟同步完成：新增 {result.added} 条 · 重复 {result.duplicate} 条 · 失败 {result.failed} 条</p>{!result.added && !result.failed && <p>没有新增记录。</p>}</div>}
      {result && result.rideIds.length > 0 && <div className="ux-actions"><Link className="secondary-button" href="/import">查看骑行记录<span aria-hidden="true">→</span></Link></div>}
      <details className="sync-demo-settings"><summary>模拟状态演示</summary><label>下次同步结果<select value={scenario} onChange={e => setScenario(e.target.value)}><option value="normal">正常／失败重试恢复</option><option value="partial">部分记录失败</option><option value="network">连接中断</option></select></label><div className="ux-actions"><button disabled={busy || !platform} onClick={() => void act("expire")}>模拟授权失效</button><button disabled={busy || platform?.status !== "connected"} onClick={() => void act("add-sample")}>模拟平台新增一条记录</button></div><p>新增样例后再次同步可检查增量；重复同步不会增加记录。</p></details>
    </section>
    {fileImport}
  </div>;
}
function PlatformMark({ provider }: { provider: PlatformId }) {
  const info = platformInfo(provider);
  return <span className={`platform-mark platform-mark-${provider}`} aria-hidden="true">{info.mark}</span>;
}

export function RideSync({ onComplete, conversationId }: { onComplete?: (ids: string[], text: string, conversationId?: string) => void; conversationId?: string }) {
  const { scope, sessionData } = useAccountStorage();
  const pathname = usePathname();
  const [view, setView] = useState<"sources" | "file">("sources");
  const from = conversationId || pathname === "/chat" ? "chat" : pathname === "/profile" ? "profile" : "import";
  if (view === "file") return <div className="ride-sync">
    <button className="import-back" onClick={() => setView("sources")}>‹ 返回导入方式</button>
    <RideFileUpload onImported={onComplete ? (id, duplicate) => onComplete([id], duplicate ? "这个文件已导入，已找到原记录，没有重复创建。" : "文件上传成功，已真实导入 1 条骑行记录。", conversationId) : undefined} />
  </div>;
  return <div className="import-sources">
    <section className="import-source-group" aria-label="关联应用">
      <header><h3>运动平台</h3><p>同步或导入骑行记录</p></header>
      <div className="platform-list">{PLATFORMS.filter(info => !scope || isImportPlatform(info.id)).map(info => <Link className="import-source-row" key={info.id} href={`/connections/${info.id}?${new URLSearchParams({ from, ...(conversationId ? { conversation: conversationId } : {}) })}`} onClick={() => {
        if (from === "chat") {
          const id = conversationId ?? readStoredChatSession(scope)?.activeConversationId;
          try { if (id) sessionData.setItem("cycler-import-conversation", id); } catch {}
        }
      }}><PlatformMark provider={info.id} /><span className="import-source-copy"><strong>{info.name}</strong></span><span className="import-source-arrow" aria-hidden="true">›</span></Link>)}</div>
      <p className="import-source-note">各平台的同步状态以连接页为准</p>
    </section>
    <section className="import-source-group" aria-label="本地文件导入">
      <button className="import-source-row import-file-row" onClick={() => setView("file")}>
        <span className="platform-mark platform-mark-file" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 10h18"/></svg></span>
        <span className="import-source-copy"><strong>本地文件导入</strong><small>支持 FIT / GPX 文件，最大 50 MB</small></span><span className="import-source-arrow" aria-hidden="true">›</span>
      </button>
    </section>
  </div>;
}

export function RideSyncLauncher({ label = "同步／导入骑行", className, onComplete, conversationId }: { label?: string; className?: string; onComplete?: (ids: string[], text: string, conversationId?: string) => void; conversationId?: string }) {
  const { scope } = useAccountStorage();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<string>();
  return <><button className={className} type="button" onClick={() => { setOrigin(conversationId ?? (onComplete ? readStoredChatSession(scope)?.activeConversationId : undefined)); setOpen(true); }}>{label}</button><BottomSheet open={open} title="同步／导入骑行记录" onClose={() => setOpen(false)}><RideSync conversationId={origin} onComplete={onComplete ? (ids, text, sourceId) => { onComplete(ids, text, sourceId); setOpen(false); } : undefined} /></BottomSheet></>;
}
