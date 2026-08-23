import { AppShell, Brand } from "../components/app-shell";
import ProfileEditor from "../components/profile-editor";

export default function ProfilePage() {
  return (
    <AppShell>
      <header className="topbar">
        <Brand />
        <span className="step-pill">个人资料</span>
      </header>
      <section className="page-intro profile-intro">
        <p className="kicker">你的基线</p>
        <h1>让每次解读，<br />更像你的骑行。</h1>
        <p className="lead">只填写你愿意提供的资料。它们先保存在当前浏览器，用于建立可追溯的个人基线。</p>
      </section>
      <ProfileEditor />
    </AppShell>
  );
}
