"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasAnyProfileFact, type UserProfile } from "../../src/domain/user-profile";
import { readProfile, saveUx } from "./profile-client";
import { RideSyncLauncher } from "./ride-sync";
import { ProfileSheet } from "./profile-sheet";

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
    <details className="ux-demo-controls"><summary>原型演示设置 · {profile?.ux?.mode === "blank" ? "空白起点" : "合用演示数据"}</summary><p>空白起点会清空资料，并隐藏此前记录与训练计划；原文件仍保留，切回演示可查看。此后导入的记录正常参与分析。</p><div className="ux-actions"><button disabled={busy} onClick={() => void action({ action: "blank" })}>切换空白首次进入</button><button disabled={busy} onClick={() => void action({ action: "demo" })}>使用预置资料与记录</button></div><label>解读状态预览<select value={insightPreview} onChange={e => { setInsightPreview(e.target.value); sessionStorage.setItem("cycler-insight-preview", e.target.value); }}><option value="real">已有真实解读链路</option><option value="loading">演示：生成中</option><option value="error">演示：生成失败与重试</option><option value="b0">演示：数据不足</option></select></label><p>演示状态不请求模型；真实链路保留现有生成、缓存与重新解读能力。</p></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function Onboarding({ rideCount, onImported, conversationId, onStartPlan, pending = false }: { rideCount: number; onImported?: (ids: string[], text: string, conversationId?: string) => void; conversationId?: string; onStartPlan: () => void; pending?: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [panel, setPanel] = useState<"profile" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() { setProfile(await readProfile()); }
  useEffect(() => { const load = () => { void refresh().catch(e => setError(e.message)); }; load(); window.addEventListener("cycler-profile-saved", load); return () => window.removeEventListener("cycler-profile-saved", load); }, []);
  useEffect(() => {
    const openProfile = () => setPanel("profile");
    window.addEventListener("cycler-open-profile", openProfile);
    return () => window.removeEventListener("cycler-open-profile", openProfile);
  }, []);
  async function action(body: unknown) {
    setBusy(true); setError("");
    try { setProfile(await saveUx(body)); setPanel(null); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>

    {error && <p role="alert">{error}<button onClick={() => void refresh().catch(e => setError(e.message))}>重试读取</button></p>}
    {profile && !profile.ux?.skipped && <section className="ux-card ux-welcome">
      <p className="kicker">CYCLER · 你的教练型伙伴</p><h1>{hasAnyProfileFact(profile) ? "从你的下一次骑行开始" : "你好，很高兴一起骑行"}</h1><p>一起看懂骑行，安排下一次训练。可以从下面开始，也可以直接问我。</p>
      <div className="ux-steps"><button className={!hasAnyProfileFact(profile) ? "primary-button" : undefined} onClick={() => setPanel("profile")}>{hasAnyProfileFact(profile) ? "✓ 查看／补充资料" : "01 完善个人资料"}</button><RideSyncLauncher className={hasAnyProfileFact(profile) && !rideCount ? "primary-button" : undefined} label={rideCount ? `✓ 同步／查看骑行（${rideCount}）` : "02 同步／导入骑行"} onComplete={onImported} conversationId={conversationId} /><button className={hasAnyProfileFact(profile) && rideCount > 0 ? "primary-button" : undefined} disabled={pending} onClick={onStartPlan}>03 制定训练计划</button></div>
    </section>}
    {profile?.ux?.skipped && <><p className="chat-welcome-skipped">没关系，我们可以先聊聊。你可以随时补充资料、导入骑行或制定训练计划。</p><button className="clear-profile" disabled={busy} onClick={() => void action({ action: "skip", skipped: false })}>继续完善资料</button></>}
    <ProfileSheet open={panel !== null} onClose={() => setPanel(null)} onSaved={() => { void refresh(); window.dispatchEvent(new Event("cycler-profile-saved")); }} />
  </>;
}
