import { AppShell } from "../components/app-shell";
import { BikeIcon } from "../components/icons";
import { RouteProgress } from "../components/route-loading";

export default function ChatLoading() {
  return <AppShell active="partner" pageClassName="chat-page-content">
    <section className="chat-home" aria-label="AI 骑行伙伴">
      <header className="topbar chat-plan-header"><span className="brand chat-brand"><span className="brand-mark"><BikeIcon /></span>Cycler</span></header>
      <RouteProgress label="正在读取对话" />
    </section>
  </AppShell>;
}
