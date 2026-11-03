import { AppShell, Brand } from "../components/app-shell";
import { RideSyncLauncher } from "../components/ride-sync";
import ProfileEditor from "../components/profile-editor";

export default function ProfilePage() {
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
      <ProfileEditor />
      <section className="ux-card"><h2>运动平台连接</h2><p>关联佳明、行者、顽鹿或 IGPSPORT，也可导入本地文件。</p><RideSyncLauncher label="管理运动平台与导入" /></section>
    </AppShell>
  );
}
