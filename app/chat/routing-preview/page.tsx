import Link from "next/link";

import { Brand } from "../../components/app-shell";
import { ChatRoutingPreview } from "../../components/chat-routing-preview";
import { inspectChatInput } from "../../../src/chat/chat-routing.ts";

const defaultText = "本次骑行平均功率是多少？";

export default async function ChatRoutingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ text?: string | string[] }>;
}) {
  const query = await searchParams;
  const queryText = query.text;
  const text = typeof queryText === "string" ? queryText : defaultText;
  const result = typeof queryText === "string" ? inspectChatInput(queryText) : null;

  return <main className="chat-tools-preview">
    <header className="topbar"><Brand /><Link className="step-pill" href="/chat">返回对话</Link></header>
    <section className="page-intro compact">
      <p className="kicker">LOCAL DEMO · CHAT-03</p>
      <h1>输入路由检查</h1>
      <p className="lead">在工具或模型之前检查输入边界。结果仅展示固定路由决定，不读取骑行数据、不调用工具或模型。</p>
    </section>
    <ChatRoutingPreview text={text} result={result} />
  </main>;
}
