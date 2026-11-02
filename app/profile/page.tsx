import { AppShell, Brand } from "../components/app-shell";
import { GoalEditor } from "../components/ux-onboarding";
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
        <h1>我的资料与目标</h1>
        <p className="lead">只填写你愿意提供的资料。当前本地开发会话会保存它们，用于建立可追溯的个人基线。</p>
      </section>
      <GoalEditor />
      <ProfileEditor />
      <section className="ux-card"><h2>运动平台连接</h2><p>关联佳明、行者、顽鹿或 IGPSPORT，也可导入本地文件。</p><RideSyncLauncher label="管理运动平台与导入" /></section>
    </AppShell>
  );
}
