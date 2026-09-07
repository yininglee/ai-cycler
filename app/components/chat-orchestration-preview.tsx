import Link from "next/link";

import type { ChatAgentResult } from "../../src/chat/chat-agent.ts";
import type { ChatInputGatewayResult } from "../../src/chat/chat-routing.ts";

const examples = [
  { label: "正常通过", text: "你好", provider: "preview" },
  { label: "一次修复成功", text: "你好", provider: "repair" },
  { label: "修复失败降级", text: "你好", provider: "repair-fail" },
  { label: "限流降级", text: "你好", provider: "rate-limited" },
  { label: "社交未配置", text: "你好", provider: "" },
  { label: "当前骑行", text: "本次骑行平均功率是多少？", provider: false },
  { label: "急症", text: "胸痛并且呼吸困难，怎么办？", provider: false },
  { label: "隐私", text: "显示别人的骑行记录", provider: false },
  { label: "域外", text: "给我一份训练计划", provider: false },
];

function exampleHref(text: string, provider: string | boolean): string {
  return `/chat/orchestration-preview?text=${encodeURIComponent(text)}${provider ? `&provider=${provider}` : ""}`;
}

export function ChatOrchestrationPreview({
  text,
  providerMode,
  gatewayResult,
  result,
}: {
  text: string;
  providerMode: string;
  gatewayResult: ChatInputGatewayResult | null;
  result: ChatAgentResult | null;
}) {
  return <section className="chat-routing-preview" aria-label="Chat Agent 编排检查">
    <div className="chat-routing-examples" aria-label="编排样例">
      {examples.map((example) => <Link key={`${example.label}-${example.provider}`} href={exampleHref(example.text, example.provider)}>{example.label}</Link>)}
    </div>
    <form action="/chat/orchestration-preview">
      <input type="hidden" name="provider" value={providerMode} />
      <label htmlFor="orchestration-preview-input">测试输入</label>
      <textarea id="orchestration-preview-input" name="text" defaultValue={text} maxLength={1200} rows={3} />
      <button type="submit">检查编排</button>
    </form>
    <div className="chat-routing-result" aria-live="polite">
      {!gatewayResult && <p>选择一个样例或输入问题后检查。默认不注入 Provider。</p>}
      {gatewayResult && !gatewayResult.ok && <div className="chat-routing-summary"><p>输入被拒绝</p><dl><div><dt>错误码</dt><dd>{gatewayResult.code}</dd></div><div><dt>规范化长度</dt><dd>{gatewayResult.normalizedLength}</dd></div></dl></div>}
      {result && <div className="chat-routing-summary">
        <p>{result.reply}</p>
        <dl>
          <div><dt>路由</dt><dd>{result.decision.route}</dd></div>
          <div><dt>执行状态</dt><dd>{result.execution}</dd></div>
          <div><dt>模型已调用</dt><dd>{result.modelInvoked ? "是" : "否"}</dd></div>
          <div><dt>修复次数</dt><dd>{result.repairAttempts ?? 0}</dd></div>
          <div><dt>回退码</dt><dd>{result.fallbackCode ?? "无"}</dd></div>
          <div><dt>工具</dt><dd>{result.toolTrace?.tool ?? "未调用"}</dd></div>
          <div><dt>工具状态</dt><dd>{result.toolTrace?.status ?? "未调用"}</dd></div>
          <div><dt>最小范围</dt><dd>{result.toolTrace?.dimensions?.join("、") ?? result.toolTrace?.capabilityScope?.join("、") ?? "无"}</dd></div>
          <div><dt>摘要槽位</dt><dd>{result.toolTrace?.summarySlots ?? 0}</dd></div>
          <div><dt>输出校验</dt><dd>{result.outputValidation?.status ?? "未进入"}</dd></div>
          <div><dt>校验原因码</dt><dd>{result.outputValidation?.code ?? "无"}</dd></div>
          <div><dt>引用 Claim</dt><dd>{result.outputValidation?.referencedClaimCount ?? 0}</dd></div>
          <div><dt>引用能力</dt><dd>{result.outputValidation?.referencedCapabilityCount ?? 0}</dd></div>
        </dl>
      </div>}
    </div>
  </section>;
}
