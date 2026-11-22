import Link from "next/link";
import { AppShell, Brand } from "../components/app-shell";
import { RideSyncLauncher } from "../components/ride-sync";
import ProfileEditor from "../components/profile-editor";
import { getNextSession } from "../../src/auth/next-session";

export default async function ProfilePage() {
  const email = (await getNextSession())?.accountEmail;
  return (
    <AppShell active="profile">
      <header className="topbar">
        <Brand />
      </header>
      <section className="page-intro profile-intro">
        <p className="kicker">你的基线</p>
        <h1>个人资料</h1>
        <p className="lead">只填写你愿意提供的信息。训练目标在制定计划时补充。</p>
      </section>
      <section className="ux-card"><h2>Cycler 账号</h2><p className="account-email">{email ?? "登录后可在其他设备查看自己的骑行记录和训练计划。"}</p>
        <Link className="secondary-button" href="/account">{email ? "管理账号" : "登录或注册"}</Link>
      </section>
      <ProfileEditor />
      <section className="ux-card"><h2>运动平台与导入</h2><p>导入顽鹿、行者的骑行记录或本地 FIT / GPX 文件。</p><RideSyncLauncher label="管理运动平台与导入" /></section>
    </AppShell>
  );
}
