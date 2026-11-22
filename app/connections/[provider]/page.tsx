import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { PlatformConnection } from "../../components/ride-sync";
import { chatReturnPath, isConversationId } from "../../../src/chat/chat-import";
import { isPlatformId, platformInfo } from "../../../src/ux/platform-catalog.ts";

export default async function ConnectionPage({ params, searchParams }: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ from?: string; conversation?: string; oauth?: string }>;
}) {
  const { provider } = await params;
  if (!isPlatformId(provider)) notFound();
  const { from, conversation, oauth } = await searchParams;
  const conversationId = isConversationId(conversation) ? conversation : undefined;
  const returnPath = from === "chat" ? chatReturnPath(conversationId) : from === "profile" ? "/profile" : "/import";
  const returnLabel = from === "chat" ? "返回原对话" : from === "profile" ? "返回我的" : "返回骑行记录";
  return <AppShell active={from === "chat" ? "partner" : from === "profile" ? "profile" : "rides"} showNav={false}>
    <header className="connection-header"><Link href={returnPath} className="import-back">‹ {returnLabel}</Link><h1>{platformInfo(provider).name}骑行导入</h1></header>
    <PlatformConnection key={provider} provider={provider} from={from} conversationId={conversationId} oauth={oauth} />
  </AppShell>;
}
