"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  createUserProfile,
  deserializeUserProfile,
  parseProfileInput,
  ProfileValidationError,
  serializeUserProfile,
  updateUserProfile,
  type ProfileField,
  type UserProfile,
} from "../../src/domain/user-profile";

const STORAGE_KEY = "ai-cycling-buddy:user-profile:v0.1";
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

function formatTime(value?: string): string {
  if (!value) return "尚未设置";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ProfileEditor() {
  const [profile, setProfile] = useState<UserProfile>(() => createUserProfile());
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = deserializeUserProfile(window.localStorage.getItem(STORAGE_KEY) ?? "");
    const next = saved ?? createUserProfile();
    setProfile(next);
    setValues(valuesFromProfile(next));
    setHydrated(true);
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
      window.localStorage.setItem(STORAGE_KEY, serializeUserProfile(next));
      setProfile(next);
      setValues(valuesFromProfile(next));
      setMessage("已保存。下次打开仍会保留这份资料。");
    } catch (cause) {
      setError(cause instanceof ProfileValidationError ? cause.message : "保存失败，请检查输入");
    }
  }

  function clearAll() {
    const next = createUserProfile();
    window.localStorage.removeItem(STORAGE_KEY);
    setProfile(next);
    setValues(emptyValues);
    setMessage("已清除当前浏览器中的个人资料。");
    setError("");
  }

  return (
    <div className="profile-layout">
      <form className="profile-card" onSubmit={save}>
        <div className="profile-card-heading">
          <div><p className="kicker">基本资料</p><h2>先建立你的个人基线</h2></div>
          <span className="local-badge">仅本机</span>
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
        <button className="clear-profile" type="button" onClick={clearAll}>清除本机资料</button>
        <p className="privacy-note profile-privacy">Demo 阶段资料只保存在此浏览器的 localStorage，不会自动发送给模型。</p>
      </section>
    </div>
  );
}

function ProfileFact({ label, value, detail, time }: { label: string; value: string; detail: string; time?: string }) {
  return <article className="profile-fact"><div><span>{label}</span><strong>{value}</strong></div><p>{detail}</p><small>{formatTime(time)}</small></article>;
}
