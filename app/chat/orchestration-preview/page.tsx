import Link from "next/link";
import { headers } from "next/headers";

import { Brand } from "../../components/app-shell";
import { ChatOrchestrationPreview } from "../../components/chat-orchestration-preview";
import { getRequestSession } from "../../../src/auth/session.ts";
import { ChatProviderError, runChatAgent, type ChatProvider, type ChatProviderInvocation } from "../../../src/chat/chat-agent.ts";
import { createChatToolRunner } from "../../../src/chat/chat-tool-orchestration.ts";
import { inspectChatInput } from "../../../src/chat/chat-routing.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";

const defaultText = "你好";

class PreviewChatProvider implements ChatProvider {
  private calls = 0;

  constructor(private readonly mode: "preview" | "repair" | "repair-fail" | "rate-limited") {}

  async run(input: ChatProviderInvocation) {
    this.calls += 1;
    if (this.mode === "rate-limited") throw new ChatProviderError("MODEL_RATE_LIMITED", "preview");
    if (this.mode === "repair" && this.calls === 1) return { rawText: "这不是符合合同的模型输出" };
    if (this.mode === "repair-fail") return { rawText: "这不是符合合同的模型输出" };
    return { rawText: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: input.route, reply: "你好，我可以陪你查看当前已开放的骑行数据范围。", claimIds: [], capabilityKeys: [] }) };
  }
}

export default async function ChatOrchestrationPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ text?: string | string[]; provider?: string | string[] }>;
}) {
  const query = await searchParams;
  const queryText = query.text;
  const text = typeof queryText === "string" ? queryText : defaultText;
  const providerQuery = typeof query.provider === "string" ? query.provider : "";
  const providerMode = providerQuery === "repair" || providerQuery === "repair-fail" || providerQuery === "rate-limited" ? providerQuery : providerQuery === "preview" ? "preview" : "";
  const providerPreview = providerMode !== "";
  const gatewayResult = typeof queryText === "string" ? inspectChatInput(queryText) : null;
  const requestHeaders = await headers();
  const session = getRequestSession(new Request("http://localhost", { headers: { Cookie: requestHeaders.get("cookie") ?? "" } }));
  const result = gatewayResult?.ok
    ? await runChatAgent({
      text: gatewayResult.text,
      decision: gatewayResult.decision,
      provider: providerPreview ? new PreviewChatProvider(providerMode as "preview" | "repair" | "repair-fail" | "rate-limited") : undefined,
      toolRunner: session ? createChatToolRunner(getApplicationRepository(), session.userId) : undefined,
      requestId: "preview-request",
    })
    : null;

  return <main className="chat-tools-preview">
    <header className="topbar"><Brand /><Link className="step-pill" href="/chat">返回对话</Link></header>
    <section className="page-intro compact">
      <p className="kicker">LOCAL DEMO · CHAT-08</p>
      <h1>编排检查</h1>
      <p className="lead">检查路由到模板、受限工具上下文或 Provider 的固定顺序。首轮输出不合规时最多只修复一次；修复失败、超时或限流统一切换为确定性模板。当前骑行问题只会查询当前本地会话的最新私有记录。</p>
    </section>
    <ChatOrchestrationPreview text={text} providerMode={providerMode} gatewayResult={gatewayResult} result={result} />
  </main>;
}
