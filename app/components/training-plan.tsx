"use client";
import { StatusBadge } from "./status-badge";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BottomSheet } from "./profile-sheet";
import { ArrowIcon } from "./icons";
import { addPlanDays, emptyPlanIntake, planMonday, planToday, planWeekCount, type PlanIntake } from "../../src/domain/training-plan";
import { trainingPlanStatusLabel, type TrainingPlanView } from "../../src/training/plan-view";
import type { ChatTrainingPlanArtifact } from "../../src/chat/chat-interaction";
import styles from "./training-plan.module.css";

const planGoalOptions = ["保持规律骑行", "提升耐力／完成长距离", "提升速度", "提升 FTP", "提升爬坡表现", "备赛"];

export function planErrorText(code?: string): string {
  if (code === "PLAN_DELETED") return "此版本计划已删除，原始骑行和历史执行记录已保留。";
  if (code === "VERSION_CONFLICT" || code === "CONTENT_CHANGED") return "信息或草案已更新，请刷新后核对最新版本。";
  if (code === "CONFIRMATION_EXPIRED") return "确认已过期，请重新核对并点击启用。";
  if (code === "TRAINING_CONCERN") return "存在影响训练的不适，暂不生成计划；先取得适合自己的专业建议。";
  if (code === "MISSING_INTAKE") return "还有必要信息未补齐，请核对目标、日期、时间安排与基础。";
  if (code === "INVALID_PERIOD") return "请检查起止日期，周期不得超过366天，也不能已经结束。";
  if (["RULES_REJECTED", "SCHEMA_REJECTED"].includes(code ?? "")) return "资料或规则已变化，当前草案不能启用，请重新生成并核对。";
  if (code === "NOT_FOUND") return "计划已更新或不可用，请查看当前计划。";
  return "暂时未能完成操作，输入已保留，可以重试。";
}
export async function planRequest(body?: unknown, query = ""): Promise<TrainingPlanView> {
  const response = await fetch(`/api/training-plans${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(planErrorText(data.error));
  return data;
}
export const notifyPlanUpdated = () => window.dispatchEvent(new Event("cycler-plan-updated"));
export function planDetailHref(id: string, version?: number | null, conversationId?: string, date?: string) {
  const query = new URLSearchParams({ ...(version ? { version: String(version) } : {}), ...(conversationId ? { conversation: conversationId } : {}), ...(date ? { date } : {}) });
  return `/plans/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}`;
}

export function PlanIntakePanel({ onGenerate, onClose }: { onGenerate: () => Promise<void>; onClose: () => void }) {
  const [data, setData] = useState<TrainingPlanView>();
  const [intake, setIntake] = useState<PlanIntake>(emptyPlanIntake);
  const [avoid, setAvoid] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { const next = await planRequest({ action: "prepare", patch: {}, expectedVersion: null }); setData(next); setIntake(next.intake!); setAvoid(next.intake!.avoidDates.join("，")); setLoaded(true); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = <K extends keyof PlanIntake>(key: K, value: PlanIntake[K]) => setIntake(current => ({ ...current, [key]: value }));
  async function save(generate: boolean) {
    setBusy(true); setError("");
    const input = { ...intake, avoidDates: avoid.split(/[,，、\s]+/).filter(Boolean), notes: intake.notes.replaceAll(/[\r\n\t]/g, " "), periodReason: intake.periodReason.replaceAll(/[\r\n\t]/g, " "), selfReportedBasis: intake.selfReportedBasis.replaceAll(/[\r\n\t]/g, " ") };
    try {
      const next = await planRequest(generate ? { action: "confirm_intake", intake: input, expectedVersion: data!.intakeVersion, confirmed: true } : { action: "prepare", patch: input, expectedVersion: data!.intakeVersion });
      setData(next); notifyPlanUpdated();
      if (generate) { onClose(); await onGenerate(); } else setError("已保存待确认信息，可以稍后继续。");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!loaded) return <div className={styles.form}>{error ? <p role="alert">{error}<button onClick={() => void load()}>重试读取</button></p> : <p role="status">正在读取已有目标、资料和骑行基础…</p>}</div>;
  const preservedGoal = data?.intake?.goal;
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!busy) void save(true); }}>
    <p className={styles.note}>核对以下信息后生成草案，查看并确认后才会启用。也可以返回对话补充。</p>
    <fieldset className={styles.formSection}><legend>目标与安排</legend>
    <label>本次计划目标<select value={intake.goal} onChange={e => change("goal", e.target.value)} required>
      <option value="">请选择本次计划目标</option>
      {preservedGoal && !planGoalOptions.includes(preservedGoal) && <option value={preservedGoal}>{preservedGoal}</option>}
      {planGoalOptions.map(goal => <option key={goal} value={goal}>{goal}</option>)}
    </select></label>
    <p className={styles.note}>可在对话中补充期望距离、赛事等具体诉求；已有目标会完整保留。</p>
    <div className={styles.twoColumns}><label>开始日期<input type="date" value={intake.startDate ?? ""} onChange={e => change("startDate", e.target.value || null)} required /></label><label>结束日期<input type="date" value={intake.endDate ?? ""} onChange={e => change("endDate", e.target.value || null)} required /></label></div>
    {intake.periodReason && <p className={styles.note}>周期依据：{intake.periodReason}</p>}
    <fieldset className={styles.schedule}><legend>每周可训练时间</legend>
      <div className={styles.weekdays}>{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => <label key={label}>
        <input type="checkbox" aria-label={`周${label}`} checked={intake.availability.some(day => day.weekday === index + 1)} onChange={event => change("availability", event.target.checked ? [...intake.availability, { weekday: index + 1, minutes: 30 }].sort((a, b) => a.weekday - b.weekday) : intake.availability.filter(day => day.weekday !== index + 1))} />
        <span>{label}</span>
      </label>)}</div>
      {!intake.availability.length && <p className={styles.note}>选择可训练的日期，再填写各天时长。</p>}
      {intake.availability.map(entry => <div className={styles.availability} key={entry.weekday}>
        <label>周{["一", "二", "三", "四", "五", "六", "日"][entry.weekday - 1]}<span className={styles.minutesInput}><input aria-label={`周${["一", "二", "三", "四", "五", "六", "日"][entry.weekday - 1]}可训练分钟`} type="number" min={15} max={240} value={entry.minutes} onChange={e => change("availability", intake.availability.map(day => day.weekday === entry.weekday ? { ...day, minutes: Number(e.target.value) } : day))} />分钟</span></label>
      </div>)}
    </fieldset></fieldset>
    <fieldset className={styles.formSection}><legend>骑行基础</legend>
    <p className={styles.note}>{data?.basis?.rideCount ? `近期有 ${data.basis.rideCount} 条记录，记录可用基础约 ${data.basis.weeklyMinutes ?? "未知"} 分钟／周、单次最长 ${data.basis.longestRideMinutes ?? "未知"} 分钟。记录不完整时可补充自述。` : "没有近期记录也可以填写自述基础；不知道 FTP 不影响生成入门草案。"}</p>
    <div className={styles.twoColumns}><label>近期平均每周骑行（分钟）<input type="number" min={0} max={2400} placeholder={data?.basis?.weeklyMinutes === null ? "请补充" : String(data?.basis?.weeklyMinutes ?? "")} value={intake.weeklyMinutes ?? ""} onChange={e => change("weeklyMinutes", e.target.value === "" ? null : Number(e.target.value))} /></label><label>近期单次最长骑行（分钟）<input type="number" min={0} max={600} placeholder={data?.basis?.longestRideMinutes === null ? "请补充" : String(data?.basis?.longestRideMinutes ?? "")} value={intake.longestRideMinutes ?? ""} onChange={e => change("longestRideMinutes", e.target.value === "" ? null : Number(e.target.value))} /></label></div>
    <label>自述基础（可选）<textarea value={intake.selfReportedBasis} maxLength={400} onChange={e => change("selfReportedBasis", e.target.value)} /></label>
    <label>是否使用功率计<select value={intake.powerMeter === null ? "unknown" : String(intake.powerMeter)} onChange={e => change("powerMeter", e.target.value === "unknown" ? null : e.target.value === "true")}><option value="unknown">不知道／暂不使用功率目标</option><option value="false">没有</option><option value="true">有</option></select></label>
    </fieldset>
    <fieldset className={styles.formSection}><legend>训练条件</legend>
    <label>需要避开的日期（YYYY-MM-DD，以逗号分隔）<input value={avoid} onChange={e => setAvoid(e.target.value)} maxLength={1200} /></label>
    <label>当前是否有影响骑行训练的不适<select value={intake.healthConcern === null ? "unknown" : String(intake.healthConcern)} onChange={e => change("healthConcern", e.target.value === "unknown" ? null : e.target.value === "true")} required><option value="unknown">请由本人核对</option><option value="false">目前没有影响训练的不适</option><option value="true">有，需要先取得专业建议</option></select></label>
    <label>其他条件／需避开事项<textarea value={intake.notes} maxLength={400} onChange={e => change("notes", e.target.value)} /></label>
    <p className={styles.note}>无已确认 FTP 或没有功率计时使用主观用力与交谈提示，不推测 FTP 或最大心率。</p>
    </fieldset>
    {error && <p role="status">{error}</p>}
    <div className={styles.formFooter}><button className="primary-button" disabled={busy} type="submit">{busy ? "正在处理…" : "核对信息并生成草案"}</button><button disabled={busy} type="button" onClick={() => void save(false)}>保存信息，稍后继续</button></div>
  </form>;
}

export function TrainingPlanCard({ reference, conversationId, onGenerate }: { reference: ChatTrainingPlanArtifact["payload"]; conversationId: string; onGenerate: () => Promise<void> }) {
  const [data, setData] = useState<TrainingPlanView>(), [open, setOpen] = useState(false), [error, setError] = useState("");
  const load = useCallback(() => { void planRequest(undefined, `?planId=${encodeURIComponent(reference.planId)}${reference.version ? `&version=${reference.version}` : ""}`).then(next => { setData(next); setError(""); }).catch(e => { setData(undefined); setError(e.message); }); }, [reference.planId, reference.version]);
  useEffect(() => { load(); window.addEventListener("cycler-plan-updated", load); return () => window.removeEventListener("cycler-plan-updated", load); }, [load]);
  const creating = reference.view === "create";
  const intakeCard = reference.view === "intake" || creating;
  const plan = intakeCard ? null : data?.viewPlan;
  const status = plan ? data?.planStatuses?.[String(plan.version)] : undefined;
  const historical = status === "unadopted" || status === "terminated";
  if (error && !data) return <section className={styles.card}><p role="status">{error}</p><button onClick={load}>重新读取计划</button></section>;
  return <section className={styles.card} aria-label={creating ? "制定计划" : intakeCard ? "计划信息补充" : "训练计划"}>
    <StatusBadge tone={status === "active" ? "active" : historical ? "neutral" : "pending"}>{!data ? "正在读取计划…" : creating ? "新计划 · 待制定" : intakeCard ? "计划信息 · 待核对" : status ? trainingPlanStatusLabel[status] : "正在读取计划…"}</StatusBadge>
    <h3>{creating ? "制定新计划" : plan?.intake.goal || data?.intake?.goal || "补充训练计划信息"}</h3>
    {plan ? <><p>{plan.intake.startDate} — {plan.intake.endDate} · 版本 {plan.version}</p><p>{plan.days.filter(day => day.week === 1 && day.minutes).length} 次／首周 · 首周 {plan.days.filter(day => day.week === 1).reduce((sum, day) => sum + day.minutes, 0)} 分钟</p><p className={styles.note}>{plan.proposal.rationale}</p><Link className="primary-button" href={planDetailHref(reference.planId, plan.version, conversationId)}>{historical ? "查看历史计划" : "查看计划"}</Link></>
      : <>
        {creating && data?.active && <p className={styles.note}>当前计划：{data.active.intake.goal}，{data.active.intake.startDate} 至 {data.active.intake.endDate}。首周 {data.active.days.filter(day => day.week === 1 && day.minutes).length} 次训练，共 {data.active.days.filter(day => day.week === 1).reduce((sum, day) => sum + day.minutes, 0)} 分钟。</p>}
        <p className={styles.note}>{creating && data?.active ? "新计划确认并启用后会覆盖原计划；在此之前，原计划继续生效。已完成的训练和历史记录保留。" : "补充本次计划的目标、日期与训练条件。核对后生成草案，启用另行确认。"}</p>
        <button className="primary-button" disabled={!data} onClick={() => setOpen(true)}>{creating ? "制定计划" : "补充／核对计划信息"}</button>
      </>}
    {error && <p role="status">{error}<button onClick={load}>重试读取</button></p>}
    <BottomSheet open={open} size="large" title="训练计划信息" onClose={() => setOpen(false)}>{open && <PlanIntakePanel onClose={() => setOpen(false)} onGenerate={onGenerate} />}</BottomSheet>
  </section>;
}

export function useTrainingPlanView() {
  const [data, setData] = useState<TrainingPlanView>();
  const load = useCallback(() => { void planRequest().then(setData).catch(() => {}); }, []);
  useEffect(() => {
    load();
    let day = planToday();
    const timer = window.setInterval(() => { const next = planToday(); if (next !== day) { day = next; load(); } }, 30_000);
    const events = ["cycler-plan-updated", "cycler-profile-saved", "focus"];
    events.forEach(event => window.addEventListener(event, load));
    return () => { window.clearInterval(timer); events.forEach(event => window.removeEventListener(event, load)); };
  }, [load]);
  return data;
}

export function TrainingPlanBar({ conversationId, data }: { conversationId: string; data?: TrainingPlanView }) {
  const active = data?.active, draft = data?.draft, today = planToday(), monday = planMonday(today);
  const draftLink = draft && <Link className={styles.draftLink} href={planDetailHref(draft.id, draft.version, conversationId)}>查看待确认计划<ArrowIcon /></Link>;
  if (!active) return draftLink || null;
  const planStatus = active.intake.startDate! > today ? "计划尚未开始" : active.intake.endDate! < today ? "计划已结束" : null;
  return <>
    <nav className={styles.weekBar} aria-label={`本周训练计划，${monday} 至 ${addPlanDays(monday, 6)}`}>
      {["一", "二", "三", "四", "五", "六", "日"].map((label, index) => {
        const date = addPlanDays(monday, index), day = active.days.find(item => item.date === date);
        const progress = data?.weekProgress?.[date], isToday = date === today;
        const progressLabel = typeof progress === "number" ? `，已关联骑行，时长进度 ${progress === 1 ? 100 : Math.floor(progress * 100)}%` : progress === null ? "，已关联骑行，无可比时长进度" : "";
        const description = `${isToday ? "今天，" : ""}${date} 周${label}，${day?.title ?? "无安排"}${progressLabel}`;
        return <Link key={date} className={isToday ? styles.today : undefined} href={planDetailHref(active.id, active.version, conversationId, date)} aria-current={isToday ? "date" : undefined} aria-label={description} title={description}>
          <span>{label}</span>
          <svg className={styles.weekRing} viewBox="0 0 24 24" aria-hidden="true">
            <circle className={styles.ringTrack} cx="12" cy="12" r="9.5" />
            {!!day?.minutes && <circle className={styles.ringTraining} cx="12" cy="12" r="6.6" />}
            {isToday && <circle className={styles.ringToday} cx="12" cy="12" r="5.2" />}
            {typeof progress === "number" && progress > 0 && <circle className={styles.ringProgress} cx="12" cy="12" r="9.5" pathLength="100" strokeDasharray={`${progress * 100} 100`} transform="rotate(-90 12 12)" />}
          </svg>
        </Link>;
      })}
    </nav>
    {(planStatus || data?.activeProfileChanged || draft) && <div className={styles.weekMeta}>
      {planStatus && <span>{planStatus}</span>}
      {data?.activeProfileChanged && <span>资料或目标已变化，计划需复核。</span>}
      {draftLink}
    </div>}
  </>;
}
