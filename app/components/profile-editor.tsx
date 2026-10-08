"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  createUserProfile,
  demoBaselineProfile,
  parseProfileInput,
  ProfileValidationError,
  updateUserProfile,
  type ProfileField,
  type UserProfile,
} from "../../src/domain/user-profile";
import type { ConsentRecord } from "../../src/persistence/application-repository";

type FormValues = Record<ProfileField, string>;

const emptyValues: FormValues = { age: "", heightCm: "", weightKg: "", maxHeartRateBpm: "", ftpWatts: "" };

function valuesFromProfile(profile: UserProfile): FormValues {
  return {
    age: profile.age ? String(profile.age.value) : "",
    heightCm: profile.heightCm ? String(profile.heightCm.value) : "",
    weightKg: profile.weightKg ? String(profile.weightKg.value) : "",
    maxHeartRateBpm: profile.maxHeartRate ? String(profile.maxHeartRate.valueBpm) : "",
    ftpWatts: profile.ftp ? String(profile.ftp.valueWatts) : "",
  };
}

/**
 * 演示下首屏即呈现“已填写”，不必等接口返回，也不会出现空表单闪烁。
 * 时间戳固定，SSR 与客户端一致，不会触发 hydration 不匹配。
 */
const demoInitialProfile = demoBaselineProfile();
const demoInitialValues = valuesFromProfile(demoInitialProfile);

function formatTime(value?: string): string {
  if (!value) return "尚未设置";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ProfileEditor() {
  const [profile, setProfile] = useState<UserProfile>(demoInitialProfile);
  const [values, setValues] = useState<FormValues>(demoInitialValues);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<ConsentRecord | null>(null);

  useEffect(() => {
    fetch("/api/profile", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((saved: UserProfile | null) => {
      const next = saved ?? demoInitialProfile;
      setProfile(next); setValues(valuesFromProfile(next)); setHydrated(true);
    }).catch(() => { setHydrated(true); setError("资料暂时无法读取"); });
  }, []);

  useEffect(() => {
    fetch("/api/consent", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((value: ConsentRecord | null) => {
      setConsent(value);
    }).catch(() => undefined);
  }, []);

  const estimatedNote = useMemo(() => {
    if (!profile.maxHeartRate) return "填写年龄后会生成估算值";
    if (profile.maxHeartRate.source === "system_estimated") return `按 220 − 年龄估算 · 更新于 ${formatTime(profile.maxHeartRate.updatedAt)}`;
    return `你已手动填写 · 更新于 ${formatTime(profile.maxHeartRate.updatedAt)}`;
  }, [profile.maxHeartRate]);

  function updateField(field: ProfileField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setMessage("");
    setError("");
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const next = updateUserProfile(profile, parseProfileInput(values), new Date());
      fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parseProfileInput(values)) }).then(async (response) => {
        if (!response.ok) throw new Error("save");
        const saved = await response.json() as UserProfile;
        setProfile(saved); setValues(valuesFromProfile(saved)); setMessage("已保存。下次打开仍会保留这份资料。");
      }).catch(() => setError("保存失败，请稍后重试"));
    } catch (cause) {
      setError(cause instanceof ProfileValidationError ? cause.message : "保存失败，请检查输入");
    }
  }

  function clearAll() {
    fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ age: null, heightCm: null, weightKg: null, maxHeartRateBpm: null, ftpWatts: null }) }).then(async (response) => {
      if (!response.ok) throw new Error("clear");
      const next = await response.json() as UserProfile;
      setProfile(next); setValues(emptyValues); setMessage("已清除当前会话中的个人资料。"); setError("");
    }).catch(() => setError("清除失败，请稍后重试"));
  }

  async function deleteAccount() {
    if (!window.confirm("删除账户、骑行记录、个人资料及 AI 解读？此操作不可撤销。")) return;
    const response = await fetch("/api/account", { method: "DELETE" });
    if (!response.ok) { setError("账户删除失败，请稍后重试"); return; }
    const next = createUserProfile(); setProfile(next); setValues(emptyValues); setConsent(null); setMessage("账户数据已删除。");
  }

  async function acceptConsent() {
    const response = await fetch("/api/consent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: true }) });
    if (!response.ok) { setError("同意记录保存失败，请稍后重试"); return; }
    setConsent(await response.json() as ConsentRecord);
    setError("");
    setMessage("已记录当前隐私说明版本的确认。");
  }

  return (
    <div className="profile-layout">
      <form className="profile-card" onSubmit={save}>
        <div className="profile-card-heading">
          <div><p className="kicker">基本资料</p><h2>先建立你的个人基线</h2></div>
          <span className="local-badge">开发会话</span>
        </div>
        <p className="profile-card-copy">年龄用于估算默认最大心率；身高和体重会为后续运动消耗等确定性计算提供输入。模型不会从聊天中猜测这些值。</p>
        <div className="profile-fields">
          <label><span>年龄</span><div className="input-with-unit"><input inputMode="numeric" type="number" min="10" max="120" value={values.age} onChange={(event) => updateField("age", event.target.value)} placeholder="例如 32" /><em>岁</em></div></label>
          <label><span>身高</span><div className="input-with-unit"><input inputMode="decimal" type="number" min="100" max="250" step="0.1" value={values.heightCm} onChange={(event) => updateField("heightCm", event.target.value)} placeholder="例如 175" /><em>cm</em></div></label>
          <label><span>体重</span><div className="input-with-unit"><input inputMode="decimal" type="number" min="25" max="300" step="0.1" value={values.weightKg} onChange={(event) => updateField("weightKg", event.target.value)} placeholder="例如 68" /><em>kg</em></div></label>
          <label><span>最大心率</span><div className="input-with-unit"><input inputMode="numeric" type="number" min="80" max="240" value={values.maxHeartRateBpm} onChange={(event) => updateField("maxHeartRateBpm", event.target.value)} placeholder="留空使用估算" /><em>bpm</em></div></label>
          <p className="field-note heart-rate-note">{estimatedNote}</p>
          <label><span>FTP <small>可选</small></span><div className="input-with-unit"><input inputMode="numeric" type="number" min="50" max="1500" value={values.ftpWatts} onChange={(event) => updateField("ftpWatts", event.target.value)} placeholder="例如 220" /><em>W</em></div></label>
          <p className="field-note ftp-note">仅记录你主动确认的 FTP，不会自动估算，也不等同于实测。</p>
        </div>
        {error && <p className="form-message error-message" role="alert">{error}</p>}
        {message && <p className="form-message success-message" role="status">{message}</p>}
        <button className="primary-button" type="submit" disabled={!hydrated}>保存资料</button>
      </form>

      <section className="profile-facts" aria-labelledby="profile-facts-heading">
        <div className="profile-facts-heading"><div><p className="kicker">已记录事实</p><h2 id="profile-facts-heading">来源与更新时间</h2></div><span>可追溯</span></div>
        <div className="fact-list">
          <ProfileFact label="最大心率" value={profile.maxHeartRate ? `${profile.maxHeartRate.valueBpm} bpm` : "未设置"} detail={profile.maxHeartRate ? (profile.maxHeartRate.source === "system_estimated" ? "系统估算 · 220 − 年龄" : "用户填写 · 已确认") : "填写年龄后自动生成"} time={profile.maxHeartRate?.updatedAt} />
          <ProfileFact label="FTP" value={profile.ftp ? `${profile.ftp.valueWatts} W` : "未设置"} detail={profile.ftp ? "用户填写 · 已确认" : "不会自动估算"} time={profile.ftp?.updatedAt} />
          <ProfileFact label="身体数据" value={profile.heightCm || profile.weightKg ? `${profile.heightCm?.value ?? "—"} cm · ${profile.weightKg?.value ?? "—"} kg` : "未设置"} detail="仅用于后续确定性指标" time={profile.heightCm?.updatedAt ?? profile.weightKg?.updatedAt} />
        </div>
        <button className="clear-profile" type="button" onClick={clearAll}>清除当前资料</button>
        <div className="consent-status">
          <div><span>隐私说明确认</span><p>{consent ? `已确认 · ${formatTime(consent.acceptedAt)}` : "尚未确认"}</p></div>
          {!consent && <button className="clear-profile" type="button" onClick={acceptConsent}>确认隐私说明</button>}
        </div>
        <button className="clear-profile" type="button" onClick={deleteAccount}>删除账户数据</button>
        <p className="privacy-note profile-privacy">当前为本地开发会话，资料保存在服务端开发适配器；生产 OIDC 尚未接入。</p>
      </section>
    </div>
  );
}

function ProfileFact({ label, value, detail, time }: { label: string; value: string; detail: string; time?: string }) {
  return <article className="profile-fact"><div><span>{label}</span><strong>{value}</strong></div><p>{detail}</p><small>{formatTime(time)}</small></article>;
}
