"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { planToday, planWeekCount } from "../../src/domain/training-plan";
import type { TrainingPlanView } from "../../src/training/plan-view";
import type { WriteConfirmationRequest } from "../../src/chat/chat-write-confirmation";
import { chatReturnPath } from "../../src/chat/chat-import";
import { planDiscussionKey } from "../../src/training/plan-discussion";
import { notifyPlanUpdated, planDetailHref, planErrorText, planRequest } from "./training-plan";
import styles from "./training-plan.module.css";
import { BottomSheet } from "./profile-sheet";
import { TrainingExecutionButton, TrainingExecutionCard } from "./training-execution";

export function TrainingPlanDetail({ planId, requestedVersion, conversationId, date }: { planId: string; requestedVersion?: number; conversationId?: string; date?: string }) {
  const [data, setData] = useState<TrainingPlanView>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [week, setWeek] = useState(1), [loaded, setLoaded] = useState(false), [message, setMessage] = useState("");
  const receipt = useRef<WriteConfirmationRequest | null>(null);
  const deletionReceipt = useRef<WriteConfirmationRequest | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false), [deleted, setDeleted] = useState(false);
  async function load() {
    setError("");
    try {
      const result = await planRequest(undefined, `?${new URLSearchParams({ planId, ...(requestedVersion ? { version: String(requestedVersion) } : {}) })}`);
      if (!result.viewPlan) throw new Error("暂未找到这个计划，请返回对话继续准备。");
      setData(result); setLoaded(true);
      const target = date ?? planToday();
      const targetWeek = result.viewPlan.days.find(day => day.date === target)?.week ?? 1;
      setWeek(targetWeek);
    } catch (e) { setData(undefined); setLoaded(false); setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, [planId, requestedVersion]);
  useEffect(() => { const refresh = () => { void load(); }; window.addEventListener("cycler-plan-updated", refresh); return () => window.removeEventListener("cycler-plan-updated", refresh); }, [planId, requestedVersion]);
  const plan = data?.viewPlan, today = planToday();
  const current = plan?.version === data?.draftVersion;
  const active = plan?.version === data?.activeVersion;
  const latest = data?.draft?.version ?? data?.active?.version;
  const replaced = plan ? data?.replacedAt?.[String(plan.version)] : undefined;
  function discuss(targetDate?: string) {
    if (plan && conversationId) try { sessionStorage.setItem(planDiscussionKey(conversationId), JSON.stringify({ planId, version: plan.version, ...(targetDate ? { date: targetDate } : {}) })); } catch {}
  }
  useEffect(() => {
    if (date && plan?.days.find(day => day.date === date)?.week === week) document.getElementById(`day-${date}`)?.scrollIntoView({ block: "center" });
  }, [date, plan, week]);
  async function activate() {
    if (!plan || busy || !current) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (!receipt.current) {
        const response = await fetch("/api/training-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "issue", planId, version: plan.version, activeVersion: data!.activeVersion, idempotencyKey: crypto.randomUUID() }) });
        const result = await response.json(); if (!response.ok) throw new Error(planErrorText(result.error));
        const { token, action, targetId, version, idempotencyKey } = result.grant;
        receipt.current = { confirmed: true, token, action, targetId, version, idempotencyKey };
      }
      const response = await fetch("/api/training-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", request: receipt.current }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) receipt.current = null;
        throw new Error(planErrorText(result.error));
      }
      setMessage("计划已确认启用，可返回对话查看本周安排。"); notifyPlanUpdated(); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function discard() {
    if (!plan || busy) return;
    setBusy(true); setError("");
    try { await planRequest({ action: "discard", version: plan.version }); setMessage("已放弃待确认草案，原生效计划保持不变。"); notifyPlanUpdated(); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!plan || busy) return;
    setBusy(true); setError("");
    try {
      if (!deletionReceipt.current) {
        const response = await fetch("/api/training-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "issue_delete", planId, version: plan.version, idempotencyKey: crypto.randomUUID() }) });
        const result = await response.json(); if (!response.ok) throw new Error(planErrorText(result.error));
        const { token, action, targetId, version, idempotencyKey } = result.grant;
        deletionReceipt.current = { confirmed: true, token, action, targetId, version, idempotencyKey };
      }
      const response = await fetch("/api/training-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", request: deletionReceipt.current }) });
      const result = await response.json();
      if (!response.ok) { if (response.status < 500) deletionReceipt.current = null; throw new Error(planErrorText(result.error)); }
      setDeleted(true); setDeleteOpen(false); notifyPlanUpdated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (deleted) return <div className={styles.detail}><section className={styles.card}><h1>计划已删除</h1><p>原始骑行与历史执行记录已保留。</p><Link href={chatReturnPath(conversationId)}>返回原对话</Link></section></div>;
  return <div className={styles.detail}>
    <header><Link href={chatReturnPath(conversationId)}>‹ 返回原对话</Link><span>训练计划</span></header>
    {!loaded && error && date && requestedVersion && <TrainingExecutionCard reference={{ planId, version: requestedVersion, date }} conversationId={conversationId} />}
    {!loaded ? <section className={styles.card}>{error ? <p role="alert">{error}<button onClick={() => void load()}>重试读取</button></p> : <p role="status">正在读取计划…</p>}</section> : plan && <>
      <section className={styles.card}>
        <small>{active ? "已生效" : current ? "待确认草案" : replaced ? "已被替换 · 保留历史" : "历史草案"} · 版本 {plan.version}</small>
        <h1>{plan.intake.goal}</h1><p>{plan.intake.startDate} — {plan.intake.endDate} · 共 {planWeekCount(plan.intake)} 周</p>
        {date && !plan.days.some(day => day.date === date) && <p role="status">{date} 不在本计划日期范围内；下方展示计划首周，可切换查看。</p>}
        {!current && !active && latest && latest !== plan.version && <Link href={planDetailHref(planId, latest, conversationId)}>此版本已更新，查看当前版本</Link>}
        <p>{plan.proposal.rationale}</p>
        <p className={styles.note}>依据：{plan.basis.source === "self_report" ? "含本人核对的自述基础" : "已导入的近期记录"}。{plan.intake.powerMeter && plan.basis.ftpWatts ? "功率目标使用已确认的 FTP。" : "未使用功率目标，按主观用力与交谈提示完成。"}安排采用当前保守规则，不作能力保证；不适时停止训练。</p>
        {data?.profileChanged && <p role="status">资料或目标已变化，请先重新核对计划信息，当前草案不能直接启用。</p>}
      </section>
      <nav className={styles.weekNavigation} aria-label="切换计划周次"><button disabled={week <= 1} onClick={() => setWeek(w => w - 1)}>上一周</button><label>第<select aria-label="计划周次" value={week} onChange={e => setWeek(Number(e.target.value))}>{Array.from({ length: planWeekCount(plan.intake) }, (_, i) => <option value={i + 1} key={i}>{i + 1}</option>)}</select>周</label><button disabled={week >= planWeekCount(plan.intake)} onClick={() => setWeek(w => w + 1)}>下一周</button><button onClick={() => setWeek(plan.days.find(day => day.date === today)?.week ?? 1)}>回到本周</button></nav>
      <p className={styles.note}>第 {week} 周：{plan.days.filter(day => day.week === week && day.minutes > 0).length} 次训练 · {plan.days.filter(day => day.week === week).reduce((sum, day) => sum + day.minutes, 0)} 分钟</p>
      <div className={styles.days}>{plan.days.filter(day => day.week === week).map(day => {
        const completed = data?.workoutRecords?.[`${plan.version}:${day.date}`];
        const linked = data?.executionRecords?.[`${plan.version}:${day.date}`];
        const replacedFuture = !!replaced && day.date >= replaced.slice(0, 10);
        const status = linked ? "已关联骑行 · 查看评估" : !active && !replaced ? "待确认" : completed ? "已完成" : replacedFuture ? "已替换" : !day.minutes ? "休息日" : day.date < today ? "尚未记录完成情况" : day.date === today ? "待完成" : "未开始";
        return <article className={`${styles.day} ${day.date === (date ?? today) ? styles.highlight : ""}`} id={`day-${day.date}`} key={day.date}>
          <div><h2>{day.date} {day.title}</h2><small>{status}</small></div>
          {day.minutes > 0 && <><p>{day.minutes} 分钟 · {day.purpose}</p><ol>{day.steps.map((step, index) => <li key={index}><strong>{step.label} · {step.minutes} 分钟</strong><p>{step.effort}{step.powerWatts && !data?.profileChanged ? ` · ${step.powerWatts[0]}–${step.powerWatts[1]} W` : ""}</p></li>)}</ol></>}
          <Link href={chatReturnPath(conversationId)} onClick={() => discuss(day.date)}>解释／调整这天</Link>
          {(active || replaced) && day.date <= today && <TrainingExecutionButton reference={{ planId, version: plan.version, date: day.date }} conversationId={conversationId} />}
        </article>;
      })}</div>
      <section className={styles.card}>
        {current && data?.active && <p role="note">启用后立即替换旧计划从今天起的安排，即使新计划尚未开始。已完成和历史执行记录保留。</p>}
        {current && <div className={styles.actions}><button className="primary-button" disabled={busy || data?.profileChanged} onClick={() => void activate()}>{busy ? "正在处理…" : "确认并启用计划"}</button><button disabled={busy} onClick={() => void discard()}>放弃草案</button></div>}
        <p>{active ? "已启用；如需修改，返回对话提出调整，新草案需再次确认。" : "只有明确点击启用，训练安排才会生效。"}</p>
        <Link href={chatReturnPath(conversationId)} onClick={() => discuss(date)}>返回对话解释／修改计划</Link>
        <button disabled={busy} onClick={() => { deletionReceipt.current = null; setDeleteOpen(true); }}>删除计划</button>
        {message && <p role="status">{message}</p>}{error && <p role="alert">{error}<button onClick={() => void load()}>重新读取当前版本</button></p>}
      </section>
    </>}
    <BottomSheet open={deleteOpen} title="确认删除计划" onClose={() => { if (!busy) setDeleteOpen(false); }}><div className={styles.form}><p>删除「{plan?.intake.goal}」第 {plan?.version} 版？{active ? "删除后停止展示该生效计划的安排。" : "仅删除所选版本。"} 原始骑行记录和历史执行、评估保留。</p><button className="primary-button" disabled={busy} onClick={() => void remove()}>{busy ? "正在删除…" : `确认删除第 ${plan?.version} 版`}</button><button disabled={busy} onClick={() => setDeleteOpen(false)}>取消</button>{error && <p role="alert">{error}</p>}</div></BottomSheet>
  </div>;
}
