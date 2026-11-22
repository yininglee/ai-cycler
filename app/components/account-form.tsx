"use client";

import { useState, type FormEvent } from "react";
import { notifyAccountChange } from "./account-scope";
import { accountFormHref } from "../../src/auth/account-form";

export function AccountForm({ email, returnTo, registering, initialError }: { email?: string; returnTo: string; registering: boolean; initialError?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const title = registering ? "注册账号" : "登录";
  const action = email ? "logout" : registering ? "register" : "login";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: form.get("email"), password: form.get("password") }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error);
      }
      notifyAccountChange();
      window.location.replace(email ? "/account" : returnTo);
    } catch (cause) {
      setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "请求失败，请稍后重试。");
      setBusy(false);
    }
  }

  return <form className="profile-card account-card" method="post" action="/api/account" onSubmit={submit}>
    <input type="hidden" name="action" value={action} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <div className="profile-card-heading"><h2>{email ? "当前账号" : title}</h2></div>
    {email ? <p className="account-email">{email}</p> : <>
      <fieldset className="profile-fields account-fields" disabled={busy}>
        <label><span>邮箱</span><div className="input-with-unit"><input name="email" type="email" autoComplete="username" maxLength={254} required /></div></label>
        <label><span>密码</span><div className="input-with-unit"><input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} maxLength={512} required /></div></label>
        {registering && <p className="field-note">至少 12 个字符。注册后可在其他设备登录。</p>}
      </fieldset>
    </>}
    {error && <p className="form-message error-message" role="alert">{error}</p>}
    <div className="ux-actions">
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "正在处理…" : email ? "退出登录" : title}</button>
      {!email && <a className="secondary-button" href={accountFormHref(returnTo, !registering)}>{registering ? "已有账号，去登录" : "创建新账号"}</a>}
    </div>
  </form>;
}
