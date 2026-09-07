import type { ChatRoutingDecision } from "./chat-routing.ts";
import {
  ChatToolOrchestrationError,
  type ChatToolContext,
  type ChatToolRunner,
  type ChatToolTrace,
} from "./chat-tool-orchestration.ts";
import { validateChatOutput, type ChatOutputValidationPublic } from "./chat-output-validation.ts";
import type { ChatOutputRoute } from "./chat-output-validation.ts";
import type { CapabilityToolItem, RideContextToolResult } from "./chat-tools.ts";
import { CozeChatWorkflowClient, readCozeChatWorkflowConfig } from "./coze-chat-workflow.ts";

export const CHAT_AGENT_SCHEMA_VERSION = "ride-chat-agent-v0.1" as const;
export const CHAT_PROVIDER_ADAPTER_VERSION = "chat-http-provider-v0.1" as const;
export const CHAT_PROVIDER_TIMEOUT_MS = 8_000;
export const CHAT_PROVIDER_MAX_RESPONSE_BYTES = 64 * 1_024;

export type ChatProviderErrorCode =
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_TIMEOUT"
  | "MODEL_RATE_LIMITED"
  | "MODEL_TEMPORARY_UNAVAILABLE"
  | "MODEL_INVALID_RESPONSE";

export class ChatProviderError extends Error {
  readonly code: Exclude<ChatProviderErrorCode, "MODEL_NOT_CONFIGURED">;

  constructor(code: Exclude<ChatProviderErrorCode, "MODEL_NOT_CONFIGURED">, message: string) {
    super(message);
    this.name = "ChatProviderError";
    this.code = code;
  }
}

export type ChatProviderInvocation = {
  requestId: string;
  agentVersion: typeof CHAT_AGENT_SCHEMA_VERSION;
  route: ChatOutputRoute;
  text: string;
  toolContext?: ChatProviderToolContext;
  repairInstruction?: string;
  previousOutput?: string;
};

export type ChatProviderToolContext =
  | { tool: "get_ride_context"; dimensions: string[]; claims: RideContextToolResult["claims"]; limitations: string[] }
  | { tool: "get_capabilities"; capabilities: CapabilityToolItem[] };

type ChatProviderToolProjection = {
  context: ChatProviderToolContext;
  claimReferences?: Readonly<Record<string, string>>;
};

export type ChatProvider = {
  run(input: ChatProviderInvocation): Promise<{ rawText: string }>;
};

export type ChatProviderConfig = {
  apiUrl: string;
  apiToken: string;
  modelId: string;
  timeoutMs: number;
  maxResponseBytes: number;
};

export type ChatAgentExecution = "template" | "awaiting_tools" | "tool_context_pending_validation" | "validated" | "repaired" | "validation_rejected";

export type ChatAgentResult = {
  schemaVersion: typeof CHAT_AGENT_SCHEMA_VERSION;
  decision: ChatRoutingDecision;
  execution: ChatAgentExecution;
  modelInvoked: boolean;
  reply: string;
  fallbackCode?: ChatProviderErrorCode | "TOOLS_PENDING" | "TOOLS_NO_CURRENT_RIDE" | "TOOLS_TIMEOUT" | "TOOLS_UNAVAILABLE" | "REPAIR_FAILED";
  providerRawOutput?: string;
  toolContext?: ChatToolContext;
  toolTrace?: ChatToolTrace;
  outputValidation?: ChatOutputValidationPublic;
  repairAttempts?: 0 | 1;
};

export type ChatAgentPublicResult = Omit<ChatAgentResult, "providerRawOutput" | "toolContext">;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerOutput(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.output === "string" && value.output.trim()) return value.output;
  if (typeof value.text === "string" && value.text.trim()) return value.text;
  return undefined;
}

export function readChatProviderConfig(environment: Readonly<Record<string, string | undefined>> = process.env): ChatProviderConfig | undefined {
  if (environment.CHAT_MODEL_ENABLED !== "true") return undefined;
  const apiUrl = environment.CHAT_PROVIDER_URL?.trim();
  const apiToken = environment.CHAT_PROVIDER_API_TOKEN?.trim();
  if (!apiUrl || !apiToken) return undefined;
  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("CHAT_PROVIDER_URL must use HTTPS unless it targets localhost");
  }
  return {
    apiUrl: parsedUrl.toString(),
    apiToken,
    modelId: environment.CHAT_PROVIDER_MODEL_ID?.trim() || "unrecorded",
    timeoutMs: positiveInteger(environment.CHAT_PROVIDER_TIMEOUT_MS, CHAT_PROVIDER_TIMEOUT_MS, 25_000),
    maxResponseBytes: positiveInteger(environment.CHAT_PROVIDER_MAX_RESPONSE_BYTES, CHAT_PROVIDER_MAX_RESPONSE_BYTES, 262_144),
  };
}

export class HttpChatProvider implements ChatProvider {
  private readonly config: ChatProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ChatProviderConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async run(input: ChatProviderInvocation): Promise<{ rawText: string }> {
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
        body: JSON.stringify({
          agent: "ride_chat_v1",
          agentVersion: input.agentVersion,
          model: this.config.modelId,
          route: input.route,
          text: input.text,
          ...(input.toolContext ? { toolContext: input.toolContext } : {}),
          ...(input.repairInstruction ? { repairInstruction: input.repairInstruction } : {}),
          ...(input.previousOutput ? { previousOutput: input.previousOutput } : {}),
        }),
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response was not JSON");
      }
      const rawText = providerOutput(parsed);
      if (!rawText) throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response did not contain output");
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

export function createChatProvider(environment: Readonly<Record<string, string | undefined>> = process.env): ChatProvider | undefined {
  const providerKind = environment.CHAT_PROVIDER_KIND?.trim()
    || (environment.COZE_CHAT_WORKFLOW_ID?.trim() ? "coze_workflow" : "http");
  if (providerKind === "coze_workflow") {
    const config = readCozeChatWorkflowConfig(environment);
    return config ? new CozeChatWorkflowClient(config) : undefined;
  }
  if (providerKind !== "http") return undefined;
  const config = readChatProviderConfig(environment);
  return config ? new HttpChatProvider(config) : undefined;
}

function templateReply(decision: ChatRoutingDecision): string {
  switch (decision.reasonCode) {
    case "MEDICAL_EMERGENCY": return "请立即停止骑行并寻求身边协助；如症状持续或加重，请尽快联系当地急救服务。";
    case "DANGEROUS_RIDING": return "请先在安全位置停车，再处理这个问题。骑行中不要查看或操作手机。";
    case "REAL_TIME_ROAD": return "我不能提供实时道路或天气判断。请以现场交通标志、官方信息和安全情况为准。";
    case "PRIVACY_REQUEST": return "我只能协助查看当前会话中你自己的骑行信息，不能展示他人的记录或精确位置。";
    case "PROMPT_INJECTION": return "我不能提供内部提示、密钥或绕过安全边界的信息。";
    case "OUT_OF_SCOPE": return "当前骑行伙伴只支持本次骑行和已开放能力范围内的问题，训练计划尚未开放。";
    default: return "当前请求需要先取得已授权的只读工具结果；在结果受控进入上下文前，我不会猜测骑行数据。";
  }
}

function fallback(decision: ChatRoutingDecision, code: ChatProviderErrorCode): ChatAgentResult {
  return {
    schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
    decision,
    execution: "template",
    modelInvoked: false,
    reply: code === "MODEL_NOT_CONFIGURED"
      ? "对话模型尚未配置；当前仅提供受控边界回复。"
      : "对话服务暂时不可用；我不会使用未经验证的结果回答。",
    fallbackCode: code,
  };
}

function toolFallback(decision: ChatRoutingDecision, code: ChatAgentResult["fallbackCode"]): ChatAgentResult {
  return {
    schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
    decision,
    execution: "template",
    modelInvoked: false,
    reply: code === "TOOLS_NO_CURRENT_RIDE"
      ? "还没有可供查看的当前骑行记录。导入一条自己的骑行记录后再试。"
      : "当前骑行数据暂时不可用；我不会使用未经授权或不完整的数据回答。",
    ...(code ? { fallbackCode: code } : {}),
  };
}

function repairInstruction(code: string | undefined): string {
  return `仅修复上一轮输出的结构或违规内容后重新输出；错误码=${code ?? "OUTPUT_SCHEMA_INVALID"}。严格只输出 ride-chat-output-v0.1 JSON，不要解释修复过程，不新增未提供的事实、数字、Claim 或能力。`;
}

function projectToolContextForProvider(context: ChatToolContext): ChatProviderToolProjection {
  const { toolResult } = context;
  if (toolResult.tool === "get_ride_context") {
    const claimReferences = Object.fromEntries(toolResult.claims.map((claim, index) => [`claim:context:${index + 1}`, claim.claimId]));
    return {
      context: {
        tool: toolResult.tool,
        dimensions: [...toolResult.dimensions],
        claims: toolResult.claims.map((claim, index) => ({ ...claim, claimId: `claim:context:${index + 1}` })),
        limitations: [...toolResult.limitations],
      },
      claimReferences,
    };
  }
  return {
    context: {
      tool: toolResult.tool,
      capabilities: toolResult.capabilities.map((capability) => ({ ...capability, sources: [...capability.sources], dependencyKeys: [...capability.dependencyKeys] })),
    },
  };
}

function validatedProviderResult(input: {
  rawOutput: string;
  decision: ChatRoutingDecision;
  toolContext?: ChatToolContext;
  toolTrace?: ChatToolTrace;
  claimReferences?: Readonly<Record<string, string>>;
  repairAttempts?: 0 | 1;
  execution?: "validated" | "repaired";
}): ChatAgentResult {
  const validation = validateChatOutput(input.rawOutput, {
    decision: input.decision,
    toolResult: input.toolContext?.toolResult,
    claimReferences: input.claimReferences,
  });
  if (!validation.ok) {
    return {
      schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
      decision: input.decision,
      execution: "validation_rejected",
      modelInvoked: true,
      reply: "对话模型输出未通过当前安全校验，暂不展示。",
      ...(input.toolTrace ? { toolTrace: input.toolTrace } : {}),
      outputValidation: validation.publicResult,
      ...(input.repairAttempts !== undefined ? { repairAttempts: input.repairAttempts } : {}),
    };
  }
  return {
    schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
    decision: input.decision,
    execution: input.execution ?? "validated",
    modelInvoked: true,
    reply: validation.output.reply,
    ...(input.toolTrace ? { toolTrace: input.toolTrace } : {}),
    outputValidation: validation.publicResult,
    ...(input.repairAttempts !== undefined ? { repairAttempts: input.repairAttempts } : {}),
  };
}

async function runProviderWithRepair(input: {
  provider: ChatProvider;
  invocation: ChatProviderInvocation;
  decision: ChatRoutingDecision;
  toolContext?: ChatToolContext;
  toolTrace?: ChatToolTrace;
  claimReferences?: Readonly<Record<string, string>>;
}): Promise<ChatAgentResult> {
  const first = await input.provider.run(input.invocation);
  const firstValidation = validateChatOutput(first.rawText, {
    decision: input.decision,
    toolResult: input.toolContext?.toolResult,
    claimReferences: input.claimReferences,
  });
  if (firstValidation.ok) {
    return validatedProviderResult({
      rawOutput: first.rawText,
      decision: input.decision,
      toolContext: input.toolContext,
      toolTrace: input.toolTrace,
      claimReferences: input.claimReferences,
      repairAttempts: 0,
    });
  }

  let repaired: { rawText: string };
  try {
    repaired = await input.provider.run({
      ...input.invocation,
      repairInstruction: repairInstruction(firstValidation.publicResult.code),
      previousOutput: first.rawText,
    });
  } catch (error) {
    if (error instanceof ChatProviderError) {
      return {
        schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
        decision: input.decision,
        execution: "template",
        modelInvoked: true,
        reply: "对话服务暂时不可用；我不会使用未经验证的结果回答。",
        fallbackCode: error.code,
        repairAttempts: 1,
        ...(input.toolTrace ? { toolTrace: input.toolTrace } : {}),
        outputValidation: firstValidation.publicResult,
      };
    }
    return {
      schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
      decision: input.decision,
      execution: "template",
      modelInvoked: true,
      reply: "对话服务暂时不可用；我不会使用未经验证的结果回答。",
      fallbackCode: "MODEL_TEMPORARY_UNAVAILABLE",
      repairAttempts: 1,
      ...(input.toolTrace ? { toolTrace: input.toolTrace } : {}),
      outputValidation: firstValidation.publicResult,
    };
  }
  const repairedResult = validatedProviderResult({
    rawOutput: repaired.rawText,
    decision: input.decision,
    toolContext: input.toolContext,
    toolTrace: input.toolTrace,
    claimReferences: input.claimReferences,
    repairAttempts: 1,
    execution: "repaired",
  });
  if (repairedResult.outputValidation?.status === "accepted") return repairedResult;
  return {
    schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
    decision: input.decision,
    execution: "template",
    modelInvoked: true,
    reply: "对话模型输出未通过当前安全校验；已切换为受控回复。",
    fallbackCode: "REPAIR_FAILED",
    repairAttempts: 1,
    ...(input.toolTrace ? { toolTrace: input.toolTrace } : {}),
    outputValidation: repairedResult.outputValidation,
  };
}

export async function runChatAgent(input: {
  text: string;
  decision: ChatRoutingDecision;
  provider?: ChatProvider;
  toolRunner?: ChatToolRunner;
  requestId?: string;
}): Promise<ChatAgentResult> {
  const { decision } = input;
  if (decision.action === "safety_stop" || decision.action === "reject" || decision.route === "out_of_scope") {
    return { schemaVersion: CHAT_AGENT_SCHEMA_VERSION, decision, execution: "template", modelInvoked: false, reply: templateReply(decision) };
  }
  if (decision.action === "tool_then_model") {
    if (decision.route !== "current_ride" && decision.route !== "capabilities") return toolFallback(decision, "TOOLS_UNAVAILABLE");
    if (input.toolRunner) {
      try {
        const toolRun = await input.toolRunner.run({ text: input.text, decision });
        if (!input.provider) {
          return {
            schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
            decision,
            execution: "tool_context_pending_validation",
            modelInvoked: false,
            reply: "已取得受控的只读工具上下文，等待后续输出校验后才能展示。",
            toolContext: toolRun.context,
            toolTrace: toolRun.trace,
          };
        }
        const toolProjection = projectToolContextForProvider(toolRun.context);
        const providerResult = await runProviderWithRepair({
          provider: input.provider,
          decision,
          toolContext: toolRun.context,
          toolTrace: toolRun.trace,
          claimReferences: toolProjection.claimReferences,
          invocation: {
            requestId: input.requestId ?? crypto.randomUUID(),
            agentVersion: CHAT_AGENT_SCHEMA_VERSION,
            route: decision.route,
            text: input.text,
            toolContext: toolProjection.context,
          },
        });
        return providerResult;
      } catch (error) {
        if (error instanceof ChatProviderError) return fallback(decision, error.code);
        const code = error instanceof ChatToolOrchestrationError ? error.code : "TOOLS_UNAVAILABLE";
        return toolFallback(decision, code);
      }
    }
    return {
      schemaVersion: CHAT_AGENT_SCHEMA_VERSION,
      decision,
      execution: "awaiting_tools",
      modelInvoked: false,
      reply: templateReply(decision),
      fallbackCode: "TOOLS_PENDING",
    };
  }
  if (!input.provider) return fallback(decision, "MODEL_NOT_CONFIGURED");
  try {
    return await runProviderWithRepair({
      provider: input.provider,
      decision,
      invocation: {
        requestId: input.requestId ?? crypto.randomUUID(),
        agentVersion: CHAT_AGENT_SCHEMA_VERSION,
        route: "social",
        text: input.text,
      },
    });
  } catch (error) {
    const code = error instanceof ChatProviderError ? error.code : "MODEL_TEMPORARY_UNAVAILABLE";
    return fallback(decision, code);
  }
}

export function publicChatAgentResult(result: ChatAgentResult): ChatAgentPublicResult {
  const { providerRawOutput: _providerRawOutput, toolContext: _toolContext, ...publicResult } = result;
  return publicResult;
}
