import { ChatProviderError, type ChatProviderErrorCode } from "./chat-agent.ts";
import { buildChatClassifierUserPrompt, CHAT_CLASSIFIER_SYSTEM_PROMPT } from "./chat-classifier-prompt.ts";
import { classifyChatInputL0, makeChatDecision, type ChatRoute, type ChatRoutingDecision } from "./chat-routing.ts";

// Boundary classification precedes the contextual Agent. Configured classifier
// failures remain explicit; L0 deterministic checks retain precedence.
export const CHAT_CLASSIFIER_SCHEMA_VERSION = "chat-classifier-v0.3" as const;
export const CHAT_CLASSIFIER_INPUT_CONTRACT_VERSION = "ride-chat-classifier-input-v0.1" as const;
export const SILICONFLOW_CLASSIFIER_PROVIDER_VERSION = "siliconflow-classifier-provider-v0.1" as const;
export const DEFAULT_SILICONFLOW_CLASSIFIER_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash" as const;

export const CHAT_CLASSIFIER_INTENTS = [
  "safety_stop", "privacy_boundary", "injection_stop", "out_of_scope", "allow",
] as const;

export type ChatClassifierIntent = (typeof CHAT_CLASSIFIER_INTENTS)[number];

export type ChatClassifierResult = {
  schemaVersion: typeof CHAT_CLASSIFIER_SCHEMA_VERSION;
  intent: ChatClassifierIntent;
  needsClarification: boolean;
};

export type ChatClassifierClient = {
  classify(input: { requestId: string; text: string }): Promise<ChatClassifierResult>;
};

// SiliconFlow receives the code-hosted boundary prompt on every request.

export type SiliconFlowClassifierConfig = {
  apiUrl: string;
  apiToken: string;
  modelId: string;
  timeoutMs: number;
  maxResponseBytes: number;
};

const classifierIntents = new Set<string>(CHAT_CLASSIFIER_INTENTS);

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidClassifierResult(value: unknown): value is ChatClassifierResult {
  return isRecord(value)
    && value.schemaVersion === CHAT_CLASSIFIER_SCHEMA_VERSION
    && typeof value.intent === "string"
    && classifierIntents.has(value.intent)
    && value.needsClarification === false
    && Object.keys(value).sort().join() === "intent,needsClarification,schemaVersion";
}

export function parseClassifierResult(rawText: string): ChatClassifierResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier output was not JSON");
  }
  if (!isValidClassifierResult(parsed)) {
    throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier output did not match chat-classifier-v0.3");
  }
  return parsed;
}

// CHAT_CLASSIFIER_ENABLED 总开关语义沿用；凭据与骑后解读链路共用 SILICONFLOW_API_TOKEN，
// 但本模块只读取自己的命名空间（SILICONFLOW_CLASSIFIER_* / SILICONFLOW_API_URL），互不越界。
// Returns undefined when not configured so callers keep the existing not_configured fallback.
export function readSiliconFlowClassifierConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SiliconFlowClassifierConfig | undefined {
  if (environment.CHAT_CLASSIFIER_ENABLED !== "true") return undefined;
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
    modelId: environment.SILICONFLOW_CLASSIFIER_MODEL_ID?.trim() || DEFAULT_SILICONFLOW_CLASSIFIER_MODEL_ID,
    // 2026-10-24：默认 8s → 12s。实测分类耗时 0.78–4.2s（v0.4 prompt 4127 字符），
    // 4.2s 已占满 8s 的一半；分类器失败是**终局降级**（直接回"模型暂不可用"，无规则兜底，
    // 见 D-A2），代价高于主对话重试，故留更宽余量。
    timeoutMs: positiveInteger(environment.SILICONFLOW_CLASSIFIER_TIMEOUT_MS, 12_000, 25_000),
    maxResponseBytes: positiveInteger(environment.SILICONFLOW_CLASSIFIER_MAX_RESPONSE_BYTES, 16 * 1_024, 262_144),
  };
}

export class SiliconFlowClassifierClient implements ChatClassifierClient {
  private readonly config: SiliconFlowClassifierConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SiliconFlowClassifierConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async classify(input: { requestId: string; text: string }): Promise<ChatClassifierResult> {
    const classifyRequest = JSON.stringify({
      agent: "ride_chat_v1",
      classifierVersion: CHAT_CLASSIFIER_SCHEMA_VERSION,
      text: input.text,
    });
    const body = JSON.stringify({
      model: this.config.modelId,
      messages: [
        { role: "system", content: CHAT_CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: buildChatClassifierUserPrompt(classifyRequest) },
      ],
      temperature: 0.3,
      enable_thinking: false,
      response_format: { type: "json_object" },
      max_tokens: 256,
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
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier response exceeded limit");
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > this.config.maxResponseBytes) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier response exceeded limit");
      }
      if (response.status === 429) throw new ChatProviderError("MODEL_RATE_LIMITED", "Classifier rate limited request");
      if (!response.ok) throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Classifier request failed");

      let envelopeValue: unknown;
      try {
        envelopeValue = JSON.parse(responseText);
      } catch {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier response was not JSON");
      }
      if (!isRecord(envelopeValue)) {
        throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier response envelope was invalid");
      }
      const choices = Array.isArray(envelopeValue.choices) ? envelopeValue.choices : undefined;
      const first = choices !== undefined && isRecord(choices[0]) ? choices[0] : undefined;
      const message = isRecord(first?.message) ? first!.message : undefined;
      const rawText = typeof message?.content === "string" && message.content.trim() ? message.content : undefined;
      if (!rawText) throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier response did not contain classifier output");
      return parseClassifierResult(rawText);
    } catch (error) {
      if (error instanceof ChatProviderError) throw error;
      if (controller.signal.aborted) throw new ChatProviderError("MODEL_TIMEOUT", "Classifier request timed out");
      throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Classifier request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createChatClassifier(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ChatClassifierClient | undefined {
  const config = readSiliconFlowClassifierConfig(environment);
  return config ? new SiliconFlowClassifierClient(config) : undefined;
}

// 分类器执行结果：ok 携带分类标签；error 携带稳定错误码（含配置错误）。
export type ChatClassifierErrorCode = Exclude<ChatProviderErrorCode, "MODEL_NOT_CONFIGURED"> | "CLASSIFIER_CONFIG_INVALID";

export type ChatClassifierOutcome =
  | { status: "ok"; intent: ChatClassifierIntent; needsClarification: boolean; durationMs: number }
  | { status: "error"; code: ChatClassifierErrorCode; durationMs: number };

async function runClassifierOutcome(input: {
  client: ChatClassifierClient;
  requestId: string;
  text: string;
}): Promise<ChatClassifierOutcome> {
  const startedAt = Date.now();
  const durationMs = () => Math.max(0, Math.min(60_000, Math.round(Date.now() - startedAt)));
  try {
    const result = await input.client.classify({ requestId: input.requestId, text: input.text });
    return { status: "ok", intent: result.intent, needsClarification: result.needsClarification, durationMs: durationMs() };
  } catch (error) {
    const code = error instanceof ChatProviderError ? error.code : "MODEL_TEMPORARY_UNAVAILABLE";
    return { status: "error", code, durationMs: durationMs() };
  }
}

// 意图 → 规则层期望路由（事件遥测对照用；classifierAgrees 统计启用后仍可观测分歧）。
// null 表示规则层无对应（不构成分歧判定）。
const INTENT_ROUTE_EXPECTATIONS: Readonly<Record<ChatClassifierIntent, readonly ChatRoute[]>> = {
  safety_stop: ["safety_stop"],
  privacy_boundary: ["privacy_boundary"],
  injection_stop: ["injection_stop"],
  out_of_scope: ["out_of_scope"],
  allow: ["autonomous_tools"],
};

export function classifierAgreesWithRule(intent: ChatClassifierIntent, route: ChatRoute): boolean | null {
  const expected = INTENT_ROUTE_EXPECTATIONS[intent];
  if (!expected) return null;
  return expected.includes(route);
}

// 分类器结果事件属性（仅脱敏标签与状态，不含用户原文）——分类器已配置时附加。
export function classifierOutcomeAttributes(outcome: ChatClassifierOutcome, route: ChatRoute): Record<string, string> {
  const agrees = outcome.status === "ok" ? classifierAgreesWithRule(outcome.intent, route) : null;
  return {
    classifierStatus: outcome.status === "ok" ? "ok" : outcome.code,
    ...(outcome.status === "ok"
      ? {
        classifierIntent: outcome.intent,
        classifierNeedsClarification: String(outcome.needsClarification),
        classifierAgrees: agrees === null ? "n/a" : String(agrees),
      }
      : {}),
    classifierDurationMs: String(outcome.durationMs),
  };
}

export function intentToRoutingDecision(intent: ChatClassifierIntent, normalizedLength: number): ChatRoutingDecision {
  switch (intent) {
    case "safety_stop":
      return makeChatDecision("safety_stop", "semantic_safety", "SEMANTIC_SAFETY_STOP", normalizedLength);
    case "privacy_boundary":
      return makeChatDecision("privacy_boundary", "privacy_request", "PRIVACY_REQUEST", normalizedLength);
    case "injection_stop":
      return makeChatDecision("injection_stop", "prompt_injection", "PROMPT_INJECTION", normalizedLength);
    case "out_of_scope":
      return makeChatDecision("out_of_scope", "none", "OUT_OF_SCOPE", normalizedLength);
    case "allow":
      return makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", normalizedLength);
  }
}

// L0 deterministic paths run first. Otherwise the optional boundary classifier
// stops explicit boundaries or admits the request to the contextual Agent.
// Configured classifier failures remain terminal and observable.
export type ChatRoutingResolution = {
  decision?: ChatRoutingDecision;
  routedBy: "rules" | "rules_l0" | "classifier" | "classifier_unavailable";
  configStatus?: "not_configured";
  outcome?: ChatClassifierOutcome;
};

export async function resolveChatRouting(input: {
  text: string;
  ruleDecision: ChatRoutingDecision;
  classifier?: ChatClassifierClient;
  requestId: string;
}): Promise<ChatRoutingResolution> {
  const tag = `[chat-trace] [${input.requestId}]`;
  console.log(`${tag} routing start | text="${input.text}" | rule.route=${input.ruleDecision.route} rule.reason=${input.ruleDecision.reasonCode}`);
  const l0 = classifyChatInputL0(input.text);
  if (l0) return { decision: l0, routedBy: "rules_l0" };
  if (!input.classifier) {
    return { decision: intentToRoutingDecision("allow", input.ruleDecision.normalizedLength), routedBy: "rules", configStatus: "not_configured" };
  }
  console.log(`${tag} L0 miss → invoking L1 classifier...`);
  const outcome = await runClassifierOutcome({ client: input.classifier, requestId: input.requestId, text: input.text });
  if (outcome.status === "ok") {
    const decision = intentToRoutingDecision(outcome.intent, input.ruleDecision.normalizedLength);
    const agrees = classifierAgreesWithRule(outcome.intent, decision.route);
    console.log(`${tag} L1 classifier OK | intent=${outcome.intent} needsClarification=${outcome.needsClarification} duration=${outcome.durationMs}ms → route=${decision.route} reason=${decision.reasonCode} ruleAgrees=${agrees}`);
    return { decision, routedBy: "classifier", outcome };
  }
  // D-A2：诚实失败优于错误猜测——分类器不可用时终局降级（无规则硬猜 fallback）。
  console.log(`${tag} L1 classifier FAILED | code=${outcome.code} duration=${outcome.durationMs}ms → unavailable degradation (no rule fallback)`);
  return { routedBy: "classifier_unavailable", outcome };
}

// 路由事件属性——routedBy 标记本次路由由谁决定；L0 快路径记 classifierStatus=skipped_l0，
// 未配置记 not_configured；分类器结果遥测（classifierIntent/classifierAgrees）随 outcome 附加。
export function routingEventAttributes(input: {
  routedBy: "rules" | "rules_l0" | "classifier" | "classifier_unavailable";
  route: ChatRoute;
  outcome?: ChatClassifierOutcome;
  configStatus?: "not_configured" | "CLASSIFIER_CONFIG_INVALID";
}): Record<string, string> {
  const base: Record<string, string> = { routedBy: input.routedBy };
  if (input.configStatus) return { ...base, classifierStatus: input.configStatus };
  if (input.routedBy === "rules_l0") return { ...base, classifierStatus: "skipped_l0" };
  return input.outcome ? { ...base, ...classifierOutcomeAttributes(input.outcome, input.route) } : base;
}

/** Same boundary contract for both entry points. */
export const resolveChatExecutionRouting = resolveChatRouting;
