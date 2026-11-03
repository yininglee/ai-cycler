"use client";
import { createClientRequestId } from "../../src/ui/client-request-id";
import { StatusBadge } from "./status-badge";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatTrainingExecutionArtifact } from "../../src/chat/chat-interaction";
import { CHAT_IMPORT_QUEUE_KEY, chatReturnPath, parseImportReceipts, rememberStoredRideInspection } from "../../src/chat/chat-import";
import type { ExecutionView } from "../../src/training/execution-view";
import type { TrainingExecutionRef } from "../../src/domain/training-execution";
import type { WriteConfirmationRequest } from "../../src/chat/chat-write-confirmation";
import { planToday } from "../../src/domain/training-plan";
import { BottomSheet } from "./profile-sheet";
import { RideCardStack } from "./ride-card-stack";
import { RideSyncLauncher } from "./ride-sync";
import { notifyPlanUpdated, planDetailHref } from "./training-plan";
import styles from "./training-plan.module.css";

async function executionRequest(body?: unknown, query = "") {
  const response = await fetch(`/api/training-execution${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(({ VERSION_CONFLICT: "关联已变化，请刷新后重新选择。", CONTENT_CHANGED: "记录内容已变化，请重新核对。", WORKOUT_NOT_LINKABLE: "这个计划日期已不能关联新记录。", RECORD_UNAVAILABLE: "这条记录已不可用，请重新选择。", RECORD_ALREADY_LINKED: "这条记录已关联其他训练，请选择另一条。" } as Record<string, string>)[data.error] ?? "暂未完成操作，可以重试。"), { status: response.status });
  return data;
}
type Props = { reference?: TrainingExecutionRef; conversationId?: string; pending?: boolean; onAsk?: (text: string) => Promise<void>; onImported?: (ids: string[], text: string, conversationId?: string) => void };

export function TrainingExecutionCard({ reference, conversationId, pending, onAsk, onImported }: Props) {
  const [view, setView] = useState<ExecutionView>(), [error, setError] = useState(""), [open, setOpen] = useState(false), [selected, setSelected] = useState<string>(), [busy, setBusy] = useState(false);
  const receipt = useRef<WriteConfirmationRequest | null>(null), requestSequence = useRef(0);
  const key = reference ? `${reference.planId}:${reference.version}:${reference.date}` : "today";
  const load = useCallback(async (offset = 0) => {
    const sequence = ++requestSequence.current;
    const query = new URLSearchParams({ ...(reference ? { planId: reference.planId, version: String(reference.version), date: reference.date } : {}), offset: String(offset) });
    try { const data = await executionRequest(undefined, `?${query}`); if (sequence === requestSequence.current) { setView(data); setError(""); } return data as ExecutionView; }
    catch (e) { if (sequence === requestSequence.current) setError((e as Error).message); }
  }, [key]);
  useEffect(() => {
    setView(undefined); setSelected(undefined); receipt.current = null; void load();
    const refresh = () => { void load(); };
    let date = planToday();
    const timer = setInterval(() => { const next = planToday(); if (next !== date) { date = next; refresh(); } }, 30_000);
    window.addEventListener("cycler-plan-updated", refresh); window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { ++requestSequence.current; clearInterval(timer); window.removeEventListener("cycler-plan-updated", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  async function feedback(data: ExecutionView, force = false) {
    if (!data.ref || !data.execution) return;
    setBusy(true); setError("");
    try {
      const facts = await executionRequest({ action: "assess", ...data.ref, expectedRevision: data.revision, force }); setView(facts); notifyPlanUpdated();
      const text = `请评估训练计划第${data.ref.version}版${data.ref.date}已确认关联的骑行，说明时长达成、执行质量的局限与建议。`;
      if (onAsk) await onAsk(text);
      else {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!response.ok) throw new Error("AI反馈暂未生成，事实对比已保留，请重试。");
        await response.json();
      }
      notifyPlanUpdated(); await load();
    } catch (e) { await load(); setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function link() {
    if (!view?.ref || !selected || busy) return;
    setBusy(true); setError("");
    try {
      if (!receipt.current) {
        const { grant } = await executionRequest({ action: "issue_link", ...view.ref, rideId: selected, expectedRevision: view.revision, idempotencyKey: createClientRequestId() });
        const { token, action, targetId, version, idempotencyKey } = grant;
        receipt.current = { confirmed: true, token, action, targetId, version, idempotencyKey };
      }
      await executionRequest({ action: "confirm", request: receipt.current }); receipt.current = null; setOpen(false); setSelected(undefined);
      const next = await load(); notifyPlanUpdated();
      if (next) await feedback(next);
    } catch (e) { if ((e as { status?: number }).status! < 500) receipt.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!view) return error ? <section className={styles.card}><p role="alert">{error}</p><button onClick={() => void load()}>重试今日安排</button></section> : null;
  // The weekly entry already covers these states; no repeated proactive messages.
  if (!reference && ["no_plan", "draft_only"].includes(view.status)) return null;
  const execution = view.execution, facts = execution?.facts;
  const state = { no_plan: "还没有已启用的计划", draft_only: "草案尚未启用", not_started: "计划尚未开始", ended: "计划已结束", rest: "今天是休息日", training: "今日训练", replaced: "已替换的训练安排", deleted: "计划已删除 · 执行历史保留" }[view.status];
  const title = view.day?.title ?? view.goal ?? "训练安排";
  const planHref = view.ref && view.status !== "deleted"
    ? planDetailHref(view.ref.planId, view.ref.version, conversationId, view.date)
    : null;
  const uploadLabel = reference ? "上传／同步本次训练" : "上传训练数据";
  const linkRideButton = view.canLink && <button disabled={busy || pending} onClick={() => {
    setSelected(undefined);
    receipt.current = null;
    setOpen(true);
    void load();
  }}>{execution ? "更换关联记录" : "关联已有骑行"}</button>;
  return <section className={`${styles.card} ${styles.executionCard}`} aria-label={reference ? "训练执行记录" : "今日计划"}>
    <div className="ui-state-row"><StatusBadge tone={view.status === "training" ? "pending" : "neutral"}>{state}</StatusBadge><span className="ui-version">{view.date}</span>{view.staleReason ? <StatusBadge tone="error">评估需更新</StatusBadge> : execution?.narrative ? <StatusBadge tone="active">已有执行评估</StatusBadge> : null}</div>
    <h3>{!reference && planHref
      ? <Link className={styles.executionPlanLink} href={planHref} aria-label={`查看计划：${title}`}>{title}</Link>
      : title}</h3>
    {view.day && <p>{view.day.minutes ? `${view.day.minutes} 分钟 · ${view.day.purpose}` : "按计划休息，不需要补做或自动增加训练。"}</p>}
    {view.status === "not_started" && <p>{view.startDate} 开始；今天没有待完成任务。</p>}
    {view.status === "ended" && <p>可查看历史，新的安排需重新制定并确认。</p>}
    {view.profileChanged && <p className={styles.note}>资料或目标已变化，当前安排需复核。</p>}
    {view.staleReason && <p role="status">{view.staleReason}</p>}
    {execution && <><p>已由本人确认关联一条骑行记录</p><Link onClick={() => rememberStoredRideInspection(execution.rideId, conversationId)} href={`/rides/${encodeURIComponent(execution.rideId)}?${new URLSearchParams({ from: "chat", ...(conversationId ? { conversation: conversationId } : {}) })}`}>查看关联骑行</Link></>}
    {facts && <dl className={styles.executionMetrics}>
      <div><dt>计划时长</dt><dd>{facts.plannedMinutes}<small> 分钟</small></dd></div>
      <div><dt>实际移动</dt><dd>{facts.movingMinutes === null ? "未记录" : facts.movingMinutes}<small>{facts.movingMinutes === null ? "" : " 分钟"}</small></dd></div>
    </dl>}
    {(facts || execution?.narrative) && <details className={styles.assessment}>
      <summary>查看评估与建议</summary>
      {facts && <><p><strong>时长达成</strong>：{facts.movingMinutes === null ? "移动时长缺失，无法核实" : `计划 ${facts.plannedMinutes} 分钟，实际移动 ${facts.movingMinutes} 分钟${facts.durationPercent === null ? "" : `，时长比例 ${facts.durationPercent}%`}`}。</p><p><strong>执行质量</strong>：{facts.intensityStatus === "reference_only" ? `平均功率 ${facts.averagePowerW} W，仅作全程参照。` : "强度目标与记录不具备直接比较条件。"}训练步骤完成情况无法核实。</p><ul className={styles.note}>{facts.limitations.map(note => <li key={note}>{note}</li>)}</ul></>}
      {execution?.narrative && <p>{execution.narrative.reply}</p>}
    </details>}
    {execution && !execution.narrative && <p role="status">{execution.feedbackError ?? (facts ? "事实对比已就绪，AI反馈尚未生成。" : "已关联，尚未完成评估。")}</p>}
    <div className={reference ? styles.executionActions : `${styles.executionActions} ${styles.todayActions}`}>
      {!reference && linkRideButton}
      {view.canLink && <RideSyncLauncher className={!execution ? "primary-button" : undefined} label={uploadLabel} conversationId={conversationId} onComplete={(ids, text, origin) => {
        if (onImported) { onImported(ids, text, origin); void load(); }
        else if (origin) {
          try {
            const receipts = parseImportReceipts(JSON.parse(sessionStorage.getItem(CHAT_IMPORT_QUEUE_KEY) ?? "[]"), origin);
            sessionStorage.setItem(CHAT_IMPORT_QUEUE_KEY, JSON.stringify([...receipts, { receiptId: createClientRequestId(), conversationId: origin, ids, text }]));
            window.location.assign(chatReturnPath(origin));
          } catch { setError("记录已导入；回执暂未保存，请返回原对话查看候选。"); void load(); }
        } else void load();
      }} />}
      {reference && planHref && <Link href={planHref}>查看计划</Link>}
      {reference && linkRideButton}
      {execution && !["deleted", "replaced"].includes(view.status) && <button disabled={busy || pending} onClick={() => void feedback(view, !!execution.narrative || !!view.staleReason)}>{busy ? "正在评估…" : execution.narrative ? "重新评估" : "生成／重试评估"}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    <BottomSheet open={open} size="large" title="关联一条骑行记录" onClose={() => { if (!busy) setOpen(false); }}><div className={styles.form}>
      <p>仅展示 {view.date}（上海时间）开始的记录。选择后再确认；同步不会自动关联。{execution ? "更换会使原评估失效。" : ""}</p>
      {!view.candidates.length && <p>当天暂无可选记录。关闭后，可点击「{uploadLabel}」。</p>}
      <RideCardStack cards={view.candidates.map(candidate => ({ id: candidate.rideId, content: <article className={styles.card}>
        <small>{new Date(candidate.startTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {candidate.source}</small><h3>{candidate.minutes === null ? "时长未知" : `${Math.round(candidate.minutes)} 分钟`}{candidate.distanceM === null ? "" : ` · ${(candidate.distanceM / 1000).toFixed(1)} km`}</h3><p>{candidate.hasPower ? "有功率" : "无功率"} · {candidate.hasHeartRate ? "有心率" : "无心率"}</p>
        <button aria-pressed={selected === candidate.rideId} disabled={busy} onClick={() => { setSelected(candidate.rideId); receipt.current = null; }}>{selected === candidate.rideId ? "已选择这条记录" : "选择这条记录"}</button>
      </article> }))} />
      <div className={styles.actions}>{view.candidateOffset > 0 && <button onClick={() => void load(view.candidateOffset - 20)}>上一批记录</button>}{view.moreCandidates && <button onClick={() => void load(view.candidateOffset + 20)}>更多当天记录</button>}</div>
      {selected && <p>已选择一条记录；确认后关联到当前计划日期，并开始评估。</p>}
      <button className="primary-button" disabled={!selected || busy} onClick={() => void link()}>{busy ? "正在处理…" : "确认关联并评估"}</button>{error && <p role="alert">{error}</p>}
    </div></BottomSheet>
  </section>;
}

export function TrainingExecutionButton(props: Props & { reference: TrainingExecutionRef }) {
  const [open, setOpen] = useState(false);
  return <><button aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起执行记录" : "查看执行／关联骑行"}</button>{open && <TrainingExecutionCard {...props} />}</>;
}

export function TrainingExecutionReply({ reference, children, onStale }: { reference: ChatTrainingExecutionArtifact["payload"]; children: ReactNode; onStale: () => void }) {
  const [current, setCurrent] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const query = new URLSearchParams({ planId: reference.planId, version: String(reference.version), date: reference.date });
        const view: ExecutionView = await executionRequest(undefined, `?${query}`);
        if (!cancelled) setCurrent(reference.revision !== undefined && reference.assessmentRevision !== undefined && reference.revision === view.revision && reference.assessmentRevision === (view.execution?.assessmentRevision ?? 0) && !view.staleReason);
      } catch { if (!cancelled) setCurrent(false); }
    };
    void refresh(); window.addEventListener("cycler-plan-updated", refresh); window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("cycler-plan-updated", refresh); window.removeEventListener("focus", refresh); };
  }, [reference.planId, reference.version, reference.date, reference.revision, reference.assessmentRevision]);
  useEffect(() => { if (current === false) onStale(); }, [current, onStale]);
  return current === null ? <p role="status">正在核对这条执行回复…</p> : current ? children : <p className={styles.note}>这条历史回复不再作为当前执行结果，请查看更新后的执行卡片或详情。</p>;
}
