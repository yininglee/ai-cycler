// S5-02: isolated V2 server-side model provider for SiliconFlow's OpenAI-compatible
// chat completion API. This module is NOT wired into the production ride-analysis
// route; integration happens in S6-03. Keys are read from server environment
// variables only, never logged, and every call (success or failure) produces a
// traceable call record per V2 PRD FR-11.

export const RIDE_MODEL_PROVIDER_RULES_VERSION = "ride-model-provider-v2.1.0" as const;
export const RIDE_MODEL_PROVIDER_ID = "siliconflow" as const;
export const DEFAULT_RIDE_MODEL_V2_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash" as const;

export type ServerEnvironmentV2 = Record<string, string | undefined>;

export type RideModelErrorV2Code =
  | "AI_TIMEOUT"
  | "PROVIDER_REQUEST_TOO_LARGE"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_MISSING_CONTENT";

export interface RideModelProviderConfigV2 {
  apiUrl: string;
  apiToken: string;
  modelId: string;
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}

export interface RideModelInvocationV2 {
  analysisRunId: string;
  requestId: string;
  /** Fully assembled, versioned prompt text (system + user content). Prompt building is S6-01. */
  promptText: string;
  promptVersion: string;
  /** Request OpenAI-compatible JSON mode (response_format json_object). */
  jsonMode?: boolean;
  maxOutputTokens?: number;
  /** Maximum wall time for this invocation; capped by config timeoutMs. */
  timeoutMs?: number;
}

export interface RideModelUsageV2 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RideModelCallRecordV2 {
  provider: typeof RIDE_MODEL_PROVIDER_ID;
  rulesVersion: typeof RIDE_MODEL_PROVIDER_RULES_VERSION;
  model: string;
  analysisRunId: string;
  requestId: string;
  promptVersion: string;
  providerRequestId?: string;
  httpStatus?: number;
  latencyMs: number;
  usage?: RideModelUsageV2;
  errorCode?: RideModelErrorV2Code;
}

export interface RideModelProviderResultV2 {
  rawText: string;
  callRecord: RideModelCallRecordV2;
}

export class RideModelErrorV2 extends Error {
  readonly code: RideModelErrorV2Code;
  readonly callRecord: RideModelCallRecordV2;
  readonly httpStatus?: number;

  constructor(code: RideModelErrorV2Code, message: string, callRecord: RideModelCallRecordV2, httpStatus?: number) {
    super(message);
    this.name = "RideModelErrorV2";
    this.code = code;
    this.callRecord = callRecord;
    this.httpStatus = httpStatus;
  }
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

// Returns undefined when the API token is absent so callers can keep the existing
// "AI_NOT_CONFIGURED" b0 fallback contract without any provider call.
export function readRideModelProviderConfigV2(
  environment: ServerEnvironmentV2 = process.env,
): RideModelProviderConfigV2 | undefined {
  const apiToken = environment.SILICONFLOW_API_TOKEN?.trim();
  if (!apiToken) return undefined;

  const apiUrl = environment.SILICONFLOW_API_URL?.trim() || "https://api.siliconflow.cn/v1/chat/completions";
  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("SILICONFLOW_API_URL must use HTTPS unless it targets localhost");
  }

  return {
    apiUrl: parsedUrl.toString(),
    apiToken,
    modelId: environment.RIDE_MODEL_V2_MODEL_ID?.trim() || DEFAULT_RIDE_MODEL_V2_MODEL_ID,
    // S2-03: long rides with aggregated evidence still need >60s of generation
    // time for the full structured output, so the ceiling is 5 minutes.
    timeoutMs: positiveInteger(environment.AI_ANALYSIS_TIMEOUT_MS, 25_000, 300_000),
    maxRequestBytes: positiveInteger(environment.RIDE_MODEL_V2_MAX_REQUEST_BYTES, 262_144, 524_288),
    maxResponseBytes: positiveInteger(environment.AI_MAX_RESPONSE_BYTES, 262_144, 524_288),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function baseCallRecord(invocation: RideModelInvocationV2, modelId: string, startedAt: number): RideModelCallRecordV2 {
  return {
    provider: RIDE_MODEL_PROVIDER_ID,
    rulesVersion: RIDE_MODEL_PROVIDER_RULES_VERSION,
    model: modelId,
    analysisRunId: invocation.analysisRunId,
    requestId: invocation.requestId,
    promptVersion: invocation.promptVersion,
    latencyMs: Date.now() - startedAt,
  };
}

export class RideModelClientV2 {
  private readonly config: RideModelProviderConfigV2;
  private readonly fetchImpl: typeof fetch;

  constructor(config: RideModelProviderConfigV2, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async run(invocation: RideModelInvocationV2): Promise<RideModelProviderResultV2> {
    const startedAt = Date.now();
    const timeoutMs = Number.isInteger(invocation.timeoutMs) && invocation.timeoutMs! > 0
      ? Math.min(this.config.timeoutMs, invocation.timeoutMs!)
      : this.config.timeoutMs;

    const body = JSON.stringify({
      model: this.config.modelId,
      messages: [{ role: "user", content: invocation.promptText }],
      // Locked sampling controls (user decision 2026-10-06): low temperature for
      // deterministic structured output, thinking disabled — the validator +
      // one-shot repair pipeline relies on stable outputs, and chain-of-thought
      // latency (95-105s per call) is not worth unverified quality gains.
      // PD-AI-23 reserved experiment REJECTED (2026-10-07): with thinking
      // enabled, 4 of 8 live calls (50%) hung to the full 300s timeout at the
      // provider — unusable regardless of quality. Restored enable_thinking:
      // false; remaining mitigation options are few-shot examples or switching
      // to the GLM-5.2 fallback model.
      temperature: 0.3,
      enable_thinking: false,
      ...(invocation.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(invocation.maxOutputTokens ? { max_tokens: invocation.maxOutputTokens } : {}),
    });
    const requestBytes = Buffer.byteLength(body, "utf8");
    if (requestBytes > this.config.maxRequestBytes) {
      throw new RideModelErrorV2(
        "PROVIDER_REQUEST_TOO_LARGE",
        `Model request body exceeded limit (${requestBytes} > ${this.config.maxRequestBytes} bytes)`,
        { ...baseCallRecord(invocation, this.config.modelId, startedAt), errorCode: "PROVIDER_REQUEST_TOO_LARGE" },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": invocation.requestId,
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      const record = { ...baseCallRecord(invocation, this.config.modelId, startedAt), httpStatus: response.status };
      const providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.config.maxResponseBytes) {
        throw new RideModelErrorV2("PROVIDER_RESPONSE_TOO_LARGE", "Model response exceeded limit", { ...record, providerRequestId, errorCode: "PROVIDER_RESPONSE_TOO_LARGE" }, response.status);
      }
      const responseText = await response.text();
      const responseBytes = Buffer.byteLength(responseText, "utf8");
      if (responseBytes > this.config.maxResponseBytes) {
        throw new RideModelErrorV2("PROVIDER_RESPONSE_TOO_LARGE", "Model response exceeded limit", { ...record, providerRequestId, errorCode: "PROVIDER_RESPONSE_TOO_LARGE" }, response.status);
      }
      if (response.status === 401 || response.status === 403) {
        throw new RideModelErrorV2("PROVIDER_AUTH_ERROR", `Model API rejected credentials (HTTP ${response.status})`, { ...record, providerRequestId, errorCode: "PROVIDER_AUTH_ERROR" }, response.status);
      }
      if (response.status === 429) {
        throw new RideModelErrorV2("PROVIDER_RATE_LIMITED", "Model API rate limited the request", { ...record, providerRequestId, errorCode: "PROVIDER_RATE_LIMITED" }, response.status);
      }
      if (!response.ok) {
        throw new RideModelErrorV2("PROVIDER_HTTP_ERROR", `Model API returned HTTP ${response.status}`, { ...record, providerRequestId, errorCode: "PROVIDER_HTTP_ERROR" }, response.status);
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(responseText);
      } catch {
        throw new RideModelErrorV2("PROVIDER_INVALID_RESPONSE", "Model response was not JSON", { ...record, providerRequestId, errorCode: "PROVIDER_INVALID_RESPONSE" }, response.status);
      }
      if (!isRecord(envelope)) {
        throw new RideModelErrorV2("PROVIDER_INVALID_RESPONSE", "Model response envelope was invalid", { ...record, providerRequestId, errorCode: "PROVIDER_INVALID_RESPONSE" }, response.status);
      }
      const choices = Array.isArray(envelope.choices) ? envelope.choices : undefined;
      const first = choices !== undefined && isRecord(choices[0]) ? choices[0] : undefined;
      const message = isRecord(first?.message) ? first!.message : undefined;
      const rawText = typeof message?.content === "string" ? message.content : undefined;
      if (!rawText) {
        throw new RideModelErrorV2("PROVIDER_MISSING_CONTENT", "Model response did not contain message content", { ...record, providerRequestId, errorCode: "PROVIDER_MISSING_CONTENT" }, response.status);
      }

      const usageValue = isRecord(envelope.usage) ? envelope.usage : undefined;
      const usage = Number.isInteger(usageValue?.prompt_tokens) && Number.isInteger(usageValue?.completion_tokens) && Number.isInteger(usageValue?.total_tokens)
        ? { inputTokens: usageValue!.prompt_tokens as number, outputTokens: usageValue!.completion_tokens as number, totalTokens: usageValue!.total_tokens as number }
        : undefined;

      return {
        rawText,
        callRecord: { ...record, providerRequestId, ...(usage ? { usage } : {}) },
      };
    } catch (error) {
      if (error instanceof RideModelErrorV2) throw error;
      if (controller.signal.aborted) {
        throw new RideModelErrorV2("AI_TIMEOUT", "Model request timed out", { ...baseCallRecord(invocation, this.config.modelId, startedAt), errorCode: "AI_TIMEOUT" });
      }
      throw new RideModelErrorV2("PROVIDER_HTTP_ERROR", "Model request failed", { ...baseCallRecord(invocation, this.config.modelId, startedAt), errorCode: "PROVIDER_HTTP_ERROR" });
    } finally {
      clearTimeout(timeout);
    }
  }
}
