// AGT-A0（D-A6）：对话主模型 provider——Coze workflow（ride_chat_v1）退役，改为硅基流动
// OpenAI 兼容 chat completions 直连。Prompt（v0.1.6）从代码库 chat-workflow-prompt.ts 随请求发送，
// 行为合同不变：输入 `ride-chat-workflow-input-v0.1`（chat_request / repair_instruction /
// previous_output），输出 `ride-chat-output-v0.2`（autonomous_tools 中间态 `ride-chat-tool-call-v0.1`）。
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
    // 2026-10-24 回归修复：默认 8s → 15s。硅基流动 DeepSeek-V3.2 实测单次耗时 4.5 / 5.3 / 7.4s，
    // 9.2s 的调用在 8s 阈值下被判 MODEL_TIMEOUT → 用户侧表现为"同一问题连问三次才成功"。
    // AGT-B4：默认 15s → 20s——kb_qa / level_assessment 升级为 L2b 真链路后变成
    // "先检索知识再生成回答"两轮，单轮生成长度明显变长（实测「为什么我的功率上不去」
    // 这类开放式原理问题会顶到 15s 上限：15s 下 MODEL_TIMEOUT，25s 下 validated）。
    // AGT-B5（2026-10-25 用户拍板，D-B5 变更）：20s → **25s（即上限值）**——编排第三轮
    // 11 次 MODEL_TIMEOUT、p50 16.1s；整轮预算同步 45s → 60s（见 chat-tool-orchestration）。
    // 注意：超时执行有 Promise.race 双保险（run 内 raceTimeout），不依赖 abort 语义。
    // AGT-B5（2026-10-26 实测修正）：单次超时上限 25s → 40s。证据：评测内成功调用的
    // headers p50 9.0s / p90 22.1s / max 24.9s——25s 紧贴分布尾部，一批"正常但偏慢"的
    // 调用被判超时（16 次失败全是 25.00s 到点，无一次 TCP 超时），又被误读成"网络问题"。
    // 默认值仍 25s（不改线上行为）；评测/本地用 env 设 35s。
    timeoutMs: positiveInteger(environment.SILICONFLOW_CHAT_TIMEOUT_MS, 25_000, 40_000),
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
      ...(input.toolCallError ? { toolCallError: input.toolCallError } : {}),
      ...(input.evidenceRequest ? { evidenceRequest: input.evidenceRequest } : {}),
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

    // AGT-B5（227s 预算失效修复）：**双保险超时**。AbortController 单靠不住——实测（编排
    // 第三轮 ORCH-08 r1）单次 provider 调用跑了 ~207 秒仍"成功"返回，abort 信号在某种
    // 连接状态下（连接池等待 / 代理半开连接等 edge case）没有中断 fetch 或 body 读取；
    // 本地复现实验（挂起 headers / 慢速滴流 body）又证明常规场景 abort 是生效的——即
    // 失效是**概率性的**。所以不再赌 abort 语义：**Promise.race 到点必然抛 MODEL_TIMEOUT**，
    // abort 仅作为"尽快释放连接"的辅助（race 拒绝后底层连接由 abort 收尾）。
    const timeoutMs = this.config.timeoutMs;
    const raceTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new ChatProviderError("MODEL_TIMEOUT", `Provider ${label} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
        promise.then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    const callStartedAt = Date.now();
    let headersMs: number | undefined;
    let bodyMs: number | undefined;
    let failurePhase: "headers" | "body" | undefined;
    let errorCode: string | undefined;
    try {
      const response = await raceTimeout(this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": input.requestId,
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      }), "fetch(headers)");
      headersMs = Date.now() - callStartedAt;
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.config.maxResponseBytes) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response exceeded limit");
      }
      // body 读取同样要 race——慢速滴流的响应体可以无限挂起
      const bodyStartedAt = Date.now();
      const responseText = await raceTimeout(response.text(), "body(read)");
      bodyMs = Date.now() - bodyStartedAt;
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
      // 失败阶段判定：raceTimeout 的 message 里带 label（fetch(headers) / body(read)），
      // 这样"超时"就能区分是网络/排队慢还是生成慢——归因的关键。
      if (error instanceof ChatProviderError) {
        errorCode = error.code;
        failurePhase = error.message.includes("fetch(headers)") ? "headers" : error.message.includes("body(read)") ? "body" : undefined;
        throw error;
      }
      if (controller.signal.aborted) {
        errorCode = "MODEL_TIMEOUT";
        failurePhase = headersMs === undefined ? "headers" : "body";
        throw new ChatProviderError("MODEL_TIMEOUT", "Provider request timed out");
      }
      errorCode = "MODEL_TEMPORARY_UNAVAILABLE";
      throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Provider request failed");
    } finally {
      clearTimeout(abortTimer);
      this.config.onTiming?.({
        ok: errorCode === undefined,
        ...(headersMs !== undefined ? { headersMs } : {}),
        ...(bodyMs !== undefined ? { bodyMs } : {}),
        totalMs: Date.now() - callStartedAt,
        ...(failurePhase ? { failurePhase } : {}),
        ...(errorCode ? { errorCode } : {}),
      });
    }
  }
}
