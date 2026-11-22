import Link from "next/link";
import { AccountForm } from "../components/account-form";
import { AppShell } from "../components/app-shell";
import { getNextSession } from "../../src/auth/next-session";
import { accountReturnPath } from "../../src/auth/account-return-path";
import { accountFormErrorMessage } from "../../src/auth/account-form";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; mode?: string; error?: string }> }) {
  const [session, query] = await Promise.all([getNextSession(), searchParams]);
  const returnTo = accountReturnPath(query.returnTo);
  return <AppShell active="profile" showNav={Boolean(session)}>
    <header className="connection-header">
      {session && <Link href="/profile" className="import-back">‹ 返回我的</Link>}
      <h1>{session ? "Cycler 账号" : "登录后使用 Cycler"}</h1>
    </header>
    <AccountForm email={session?.accountEmail} returnTo={returnTo} registering={query.mode === "register"} initialError={accountFormErrorMessage(query.error)} />
  </AppShell>;
}
