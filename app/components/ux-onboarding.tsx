"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasAnyProfileFact, type UserProfile } from "../../src/domain/user-profile";
import { readProfile } from "./profile-client";
import { RideSyncLauncher } from "./ride-sync";
import { BottomSheet, ProfileSheet } from "./profile-sheet";

export async function saveUx(body: unknown): Promise<UserProfile> {
  const response = await fetch("/api/ux", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("保存失败，请重试；输入已保留。");
  return response.json();
}

const goals = ["保持规律骑行", "提升耐力／完成长距离", "提升 FTP", "提升爬坡表现", "备赛", "自定义"];
export function GoalEditor({ onSaved, draft }: { onSaved?: () => void; draft?: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [title, setTitle] = useState(goals[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { readProfile().then((p: UserProfile) => { setProfile(p); setTitle(draft ? (/FTP/i.test(draft) ? goals[2] : /耐力|长距离/.test(draft) ? goals[1] : /爬坡/.test(draft) ? goals[3] : /备赛|比赛/.test(draft) ? goals[4] : /规律/.test(draft) ? goals[0] : goals[5]) : p.ux?.goal?.title ?? goals[0]); setDetail(draft ?? p.ux?.goal?.detail ?? ""); setReady(true); }).catch(() => setMessage("目标暂时无法读取，请刷新重试。")); }, []);
  async function commit(clear = false) {
    setBusy(true); setMessage("");
    try { const p = await saveUx({ action: "goal", goal: clear ? null : { title, detail } }); setProfile(p); setMessage(clear ? "已清除目标" : "主要目标已保存，可随时修改。训练计划需另行确认。"); onSaved?.(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="ux-card" id="goal" aria-label="主要骑行目标">
    {profile?.ux?.goal && <p>已保存：{profile.ux.goal.title} · {profile.ux.goal.detail || "暂无补充"}<small className="ux-meta">用户确认 · {new Date(profile.ux.goal.updatedAt).toLocaleString("zh-CN")}</small></p>}
    <form onSubmit={e => { e.preventDefault(); if (ready && !busy) void commit(); }}>
      <label>主要目标<select value={title} onChange={e => { setTitle(e.target.value); }}>{goals.map(g => <option key={g}>{g}</option>)}</select></label>
      <label>{title === "备赛" ? "赛事名称、日期及期望" : title === "提升耐力／完成长距离" ? "期望距离、时间或其他说明" : "补充说明（可选；自定义目标请在此描述）"}<textarea value={detail} onChange={e => { setDetail(e.target.value); }} maxLength={400} required={title === "自定义" || title === "备赛"} /></label>
      <button className="primary-button" type="submit" disabled={!ready || busy}>{busy ? "保存中…" : "保存"}</button>
      {profile?.ux?.goal && <button className="clear-profile" type="button" disabled={busy} onClick={() => void commit(true)}>暂不设置目标</button>}
    </form><p role="status">{message}</p>
  </section>;
}

export function PrototypeSettings() {
  const [insightPreview, setInsightPreview] = useState("real");
  useEffect(() => { setInsightPreview(sessionStorage.getItem("cycler-insight-preview") ?? "real"); }, []);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { readProfile().then(setProfile).catch(() => setError("演示状态暂时无法读取，请刷新重试。")); }, []);
  async function action(body: unknown) {
    setBusy(true); setError("");
    try {
      await saveUx(body);
      sessionStorage.removeItem("cycler-profile-proposal");
      sessionStorage.setItem("cycler-reset-chat", "1");
      window.location.reload();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <section className="chat-prototype-settings" aria-label="原型演示设置">
    <details className="ux-demo-controls"><summary>原型演示设置 · {profile?.ux?.mode === "blank" ? "空白起点" : "合用演示数据"}</summary><p>空白起点会清空资料与目标，并隐藏此前记录；原文件仍保留，切回演示可查看。此后导入的记录正常参与分析。</p><div className="ux-actions"><button disabled={busy} onClick={() => void action({ action: "blank" })}>切换空白首次进入</button><button disabled={busy} onClick={() => void action({ action: "demo" })}>使用预置资料与记录</button></div><label>解读状态预览<select value={insightPreview} onChange={e => { setInsightPreview(e.target.value); sessionStorage.setItem("cycler-insight-preview", e.target.value); }}><option value="real">已有真实解读链路</option><option value="loading">演示：生成中</option><option value="error">演示：生成失败与重试</option><option value="b0">演示：数据不足</option></select></label><p>演示状态不请求模型；真实链路保留现有生成、缓存与重新解读能力。</p></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function Onboarding({ rideCount, onImported }: { rideCount: number; onImported?: (ids: string[], text: string) => void }) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [goalDraft, setGoalDraft] = useState("");
  const [panel, setPanel] = useState<"profile" | "goal" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() { setProfile(await readProfile()); }
  useEffect(() => { const load = () => { void refresh().catch(e => setError(e.message)); }; load(); window.addEventListener("cycler-profile-saved", load); return () => window.removeEventListener("cycler-profile-saved", load); }, []);
  useEffect(() => {
    const openGoal = (event: Event) => { setGoalDraft((event as CustomEvent<string>).detail.slice(0, 400)); setPanel("goal"); };
    window.addEventListener("cycler-goal-draft", openGoal);
    return () => window.removeEventListener("cycler-goal-draft", openGoal);
  }, []);
  async function action(body: unknown) {
    setBusy(true); setError("");
    try { setProfile(await saveUx(body)); setPanel(null); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>

    {error && <p role="alert">{error}<button onClick={() => void refresh().catch(e => setError(e.message))}>重试读取</button></p>}
    {profile && !profile.ux?.skipped && <section className="ux-card ux-welcome">
      <p className="kicker">CYCLER · 你的教练型伙伴</p><h1>{hasAnyProfileFact(profile) ? "从你的下一次骑行开始" : "你好，很高兴一起骑行"}</h1><p>我可以帮你看懂骑行、解释知识，一起明确训练方向。先认识你一点，也可以直接提问。</p>
      <div className="ux-steps"><button onClick={() => setPanel("profile")}>{hasAnyProfileFact(profile) ? "✓ 查看／补充资料" : "01 完善个人资料"}</button><RideSyncLauncher label={rideCount ? `✓ 同步／查看骑行（${rideCount}）` : "02 同步／导入骑行"} onComplete={onImported} /><button onClick={() => setPanel("goal")}>{profile.ux?.goal ? "✓ 查看／修改目标" : "03 设置骑行目标"}</button></div>
    </section>}
    {profile?.ux?.skipped && <><p className="chat-welcome-skipped">没关系，我们可以先聊聊。你可以随时补充资料、导入骑行或设置目标。</p><button className="clear-profile" disabled={busy} onClick={() => void action({ action: "skip", skipped: false })}>继续完善资料与目标</button></>}
    <ProfileSheet open={panel === "profile"} onClose={() => setPanel(current => current === "profile" ? null : current)} onSaved={() => { void refresh(); window.dispatchEvent(new Event("cycler-profile-saved")); }} />
    <BottomSheet open={panel === "goal"} title="设置骑行目标" onClose={() => setPanel(current => current === "goal" ? null : current)}>
      <GoalEditor key={goalDraft} draft={goalDraft || undefined} onSaved={() => void refresh()} />
    </BottomSheet>
  </>;
}
