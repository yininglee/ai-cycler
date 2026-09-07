import { AppShell, Brand } from "../components/app-shell";
import { ChatHome } from "../components/chat-home";
import { getNextSessionUserId } from "../../src/auth/next-session.ts";
import { buildChatHomeSnapshot } from "../../src/chat/chat-home.ts";
import { getApplicationRepository } from "../../src/persistence/application-repository.ts";

export default async function ChatPage() {
  const userId = await getNextSessionUserId();
  const rides = userId ? await getApplicationRepository().listRides(userId) : [];
  const snapshot = buildChatHomeSnapshot(rides.map(({ record }) => record));

  return <AppShell active="partner">
    <header className="topbar"><Brand /><span className="step-pill">Demo</span></header>
    <ChatHome snapshot={snapshot} />
  </AppShell>;
}
