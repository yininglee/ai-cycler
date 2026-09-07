import Link from "next/link";

import { Brand } from "../../components/app-shell";
import { ChatValidationPreview } from "../../components/chat-validation-preview";

export default function ChatValidationPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string | string[] }>;
}) {
  return <main className="chat-tools-preview">
    <header className="topbar"><Brand /><Link className="step-pill" href="/chat">返回对话</Link></header>
    <section className="page-intro compact">
      <p className="kicker">LOCAL DEMO · CHAT-07</p>
      <h1>输出校验检查</h1>
      <p className="lead">固定样例只在服务端进行 Schema、Claim、数字、能力、路由、安全、注入、隐私和长度检查。页面不读取真实骑行记录、不调用工具或模型，也不展示原始输出。</p>
    </section>
    <ChatValidationPreview searchParams={searchParams} />
  </main>;
}
