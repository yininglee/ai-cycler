import { AppShell } from "../components/app-shell";
import { ChatHome } from "../components/chat-home";
import { getNextSessionUserId } from "../../src/auth/next-session.ts";
import { buildChatHomeSnapshot } from "../../src/chat/chat-home.ts";
import { getRideRepository } from "../../src/persistence/demo-ride-repository.ts";

export default async function ChatPage() {
  const userId = await getNextSessionUserId();
  // DEMO-IMPORTED-RIDES：演示记录参与累计/本周摘要，使「我一共骑了多少」等聚合问题
  // 在新访客身上也能得到真实回答（无会话时 ownerId 传空，只命中演示记录）。
  const rides = await (await getRideRepository()).listRides(userId ?? "");
  const snapshot = buildChatHomeSnapshot(rides.map(({ record }) => record));

  return <AppShell active="partner" pageClassName="chat-page-content">
    <ChatHome snapshot={snapshot} />
  </AppShell>;
}
