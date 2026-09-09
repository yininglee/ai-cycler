import {
  ChatProviderError,
  type ChatProvider,
  type ChatProviderConfig,
  type ChatProviderInvocation,
} from "./chat-agent.ts";

export const COZE_CHAT_WORKFLOW_ADAPTER_VERSION = "coze-chat-workflow-adapter-v0.1" as const;
export const COZE_CHAT_INPUT_CONTRACT_VERSION = "ride-chat-workflow-input-v0.1" as const;
export const COZE_CHAT_INPUT_VARIABLES = [
  "chat_request",
  "repair_instruction",
  "previous_output",
] as const;

export type CozeChatWorkflowConfig = ChatProviderConfig & {
  workflowName: string;
  workflowId: string;
  workflowVersion: string;
};

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractChatOutput(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string") {
    const parsed = parseJsonString(value.trim());
    return parsed === value.trim() ? value.trim() || undefined : extractChatOutput(parsed, depth + 1);
  }
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion === "ride-chat-output-v0.1" && typeof value.reply === "string") {
    return JSON.stringify(value);
  }
  for (const key of ["chat_output", "chatOutput", "output", "text", "data"]) {
    if (value[key] !== undefined) {
      const output = extractChatOutput(value[key], depth + 1);
      if (output) return output;
    }
  }
  return undefined;
}

export function readCozeChatWorkflowConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CozeChatWorkflowConfig | undefined {
  if (environment.CHAT_MODEL_ENABLED !== "true") return undefined;
  const apiUrl = environment.COZE_CHAT_API_URL?.trim();
  const workflowName = environment.COZE_CHAT_WORKFLOW_NAME?.trim();
  const workflowId = environment.COZE_CHAT_WORKFLOW_ID?.trim();
  const workflowVersion = environment.COZE_CHAT_WORKFLOW_VERSION?.trim();
  const apiToken = environment.COZE_CHAT_API_TOKEN?.trim();
  if (!apiUrl || !workflowName || !workflowId || !workflowVersion || !apiToken) return undefined;

  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("COZE_CHAT_API_URL must use HTTPS unless it targets localhost");
  }
  return {
    apiUrl: parsedUrl.toString(),
    workflowName,
    workflowId,
    workflowVersion,
    apiToken,
    modelId: environment.COZE_CHAT_MODEL_ID?.trim() || "unrecorded",
    timeoutMs: positiveInteger(environment.COZE_CHAT_TIMEOUT_MS, 8_000, 25_000),
    maxResponseBytes: positiveInteger(environment.COZE_CHAT_MAX_RESPONSE_BYTES, 64 * 1_024, 262_144),
  };
}

export class CozeChatWorkflowClient implements ChatProvider {
  private readonly config: CozeChatWorkflowConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CozeChatWorkflowConfig, fetchImpl: typeof fetch = fetch) {
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
          workflow_id: this.config.workflowId,
          workflow_version: this.config.workflowVersion,
          is_async: false,
          parameters: {
            chat_request: JSON.stringify({
              agent: "ride_chat_v1",
              agentVersion: input.agentVersion,
              model: this.config.modelId,
              route: input.route,
              text: input.text,
              ...(input.toolContext ? { toolContext: input.toolContext } : {}),
              // CHAT-14 P1：会话白名单摘要进入 chat_request（变量合同不变，仅 Prompt v0.1.5 增使用规则）。
              ...(input.sessionSummaries?.length ? { sessionSummaries: input.sessionSummaries } : {}),
            }),
            repair_instruction: input.repairInstruction ?? "",
            previous_output: input.previousOutput ?? "",
          },
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

      let envelopeValue: unknown;
      try {
        envelopeValue = JSON.parse(responseText);
      } catch {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response was not JSON");
      }
      if (!isRecord(envelopeValue)) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Provider response envelope was invalid");
      }
      if (typeof envelopeValue.code === "number" && envelopeValue.code !== 0) {
        throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Provider rejected request");
      }
      const rawText = extractChatOutput(envelopeValue.data ?? envelopeValue);
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
