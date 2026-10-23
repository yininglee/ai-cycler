// AGT-A0（D-A6）：对话主模型 provider——Coze workflow（ride_chat_v1）退役，改为硅基流动
// OpenAI 兼容 chat completions 直连。Prompt（v0.1.6）从代码库 chat-workflow-prompt.ts 随请求发送，
// 行为合同不变：输入 `ride-chat-workflow-input-v0.1`（chat_request / repair_instruction /
// previous_output），输出 `ride-chat-output-v0.1`（autonomous_tools 中间态 `ride-chat-tool-call-v0.1`）。
// 错误码体系沿用 ChatProviderError（chat-agent.ts）；采样参数锁定沿用骑后链路决策
// （temperature 0.3 + enable_thinking false + JSON mode）。
// 绝不读取骑后解读的 RIDE_MODEL_V2_* 配置——两条链路的 env 命名空间完全隔离。

import {
  ChatProviderError,
  type ChatProvider,
  type ChatProviderConfig,
  type ChatProviderInvocation,
} from "./chat-agent.ts";
import { buildChatWorkflowUserPrompt, CHAT_WORKFLOW_SYSTEM_PROMPT } from "./chat-workflow-prompt.ts";

export const SILICONFLOW_CHAT_PROVIDER_VERSION = "siliconflow-chat-provider-v0.1" as const;
export const DEFAULT_SILICONFLOW_CHAT_MODEL_ID = "deepseek-ai/DeepSeek-V3.2" as const;
export const DEFAULT_SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions" as const;

export type SiliconFlowChatProviderConfig = ChatProviderConfig;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

// CHAT_MODEL_ENABLED 沿用既有总开关语义；SILICONFLOW_API_TOKEN 与骑后解读链路共用同一凭据
// （readRideModelProviderConfigV2 同源），但本模块只读取自己的命名空间，互不越界。
export function readSiliconFlowChatProviderConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SiliconFlowChatProviderConfig | undefined {
  if (environment.CHAT_MODEL_ENABLED !== "true") return undefined;
  const apiToken = environment.SILICONFLOW_API_TOKEN?.trim();
  if (!apiToken) return undefined;

  const apiUrl = environment.SILICONFLOW_API_URL?.trim() || DEFAULT_SILICONFLOW_API_URL;
  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("SILICONFLOW_API_URL must use HTTPS unless it targets localhost");
  }
  return {
    apiUrl: parsedUrl.toString(),
    apiToken,
    modelId: environment.SILICONFLOW_CHAT_MODEL_ID?.trim() || DEFAULT_SILICONFLOW_CHAT_MODEL_ID,
    timeoutMs: positiveInteger(environment.SILICONFLOW_CHAT_TIMEOUT_MS, 8_000, 25_000),
    maxResponseBytes: positiveInteger(environment.SILICONFLOW_CHAT_MAX_RESPONSE_BYTES, 64 * 1_024, 262_144),
  };
}

export class SiliconFlowChatProvider implements ChatProvider {
  private readonly config: SiliconFlowChatProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SiliconFlowChatProviderConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async run(input: ChatProviderInvocation): Promise<{ rawText: string }> {
    // chat_request 与 Coze workflow 的同名变量同构（行为合同不变）：route/text/toolContext/
    // toolCatalog/toolResults/sessionSummaries 原样投影；model 仅作记录字段。
    const chatRequest = {
      agent: "ride_chat_v1",
      agentVersion: input.agentVersion,
      model: this.config.modelId,
      route: input.route,
      text: input.text,
      ...(input.toolContext ? { toolContext: input.toolContext } : {}),
      ...(input.toolCatalog ? { toolCatalog: input.toolCatalog } : {}),
      ...(input.toolResults?.length ? { toolResults: input.toolResults } : {}),
      ...(input.sessionSummaries?.length ? { sessionSummaries: input.sessionSummaries } : {}),
    };
    const body = JSON.stringify({
      model: this.config.modelId,
      messages: [
        { role: "system", content: CHAT_WORKFLOW_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildChatWorkflowUserPrompt({
            chatRequestJson: JSON.stringify(chatRequest),
            repairInstruction: input.repairInstruction,
            previousOutput: input.previousOutput,
          }),
        },
      ],
      // 采样锁定（2026-10-06 骑后链路决策的同一原则）：低温 + 关闭 thinking——
      // 输出校验 + 一次修复轮的流水线依赖稳定输出。
      temperature: 0.3,
      enable_thinking: false,
      response_format: { type: "json_object" },
      max_tokens: 4_096,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": input.requestId,
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.config.maxResponseBytes) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response exceeded limit");
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > this.config.maxResponseBytes) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response exceeded limit");
      }
      if (response.status === 429) throw new ChatProviderError("MODEL_RATE_LIMITED", "Provider rate limited request");
      if (!response.ok) throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Provider request failed");

      let envelopeValue: unknown;
      try {
        envelopeValue = JSON.parse(responseText);
      } catch {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response was not JSON");
      }
      if (typeof envelopeValue !== "object" || envelopeValue === null) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response envelope was invalid");
      }
      const envelope = envelopeValue as Record<string, unknown>;
      const choices = Array.isArray(envelope.choices) ? envelope.choices : undefined;
      const first = choices !== undefined && typeof choices[0] === "object" && choices[0] !== null ? choices[0] as Record<string, unknown> : undefined;
      const message = typeof first?.message === "object" && first.message !== null ? first.message as Record<string, unknown> : undefined;
      const rawText = typeof message?.content === "string" && message.content.trim() ? message.content : undefined;
      if (!rawText) throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response did not contain chat output");
      return { rawText };
    } catch (error) {
      if (error instanceof ChatProviderError) throw error;
      if (controller.signal.aborted) throw new ChatProviderError("MODEL_TIMEOUT", "Provider request timed out");
      throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
