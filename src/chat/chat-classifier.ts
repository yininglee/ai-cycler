import { ChatProviderError, type ChatProviderErrorCode } from "./chat-agent.ts";
import { classifyChatInputL0, makeChatDecision, type ChatRoute, type ChatRoutingDecision } from "./chat-routing.ts";

// CHAT-12 P2（CHAT-ADR-08 / 架构设计 v0.4 第 4.2.1 节）：L1 LLM 语义分类器——影子模式合同。
// 设计冻结项：
// - 输出只有 {schemaVersion, intent, needsClarification}，不使用模型自报数字置信度（快速模型校准不可信）；
// - `unclear` 是显式合法输出（P3 触发澄清话术一等路径），不是错误；
// - 输入仅当前问题文本（v0.1 不含摘要槽位、不含任何私有数据）；
// - 影子模式只记录分类结果，不影响路由——分类器失败/超时/限流一律按 P1 确定性规则继续，
//   混合架构任何时刻不劣于纯规则基线。
export const CHAT_CLASSIFIER_SCHEMA_VERSION = "chat-classifier-v0.1" as const;
export const CHAT_CLASSIFIER_INPUT_CONTRACT_VERSION = "ride-chat-classifier-input-v0.1" as const;
export const COZE_CHAT_CLASSIFIER_INPUT_VARIABLES = ["classify_request"] as const;

export const CHAT_CLASSIFIER_INTENTS = [
  // 红线类（L0 规则层在 P3 仍先拦截；分类器标注用于纵深防御验证）
  "safety_stop",
  "privacy_boundary",
  "injection_stop",
  // 生产八类意图（P3 分类器接管后的主路由标签空间）
  "ride_summary",
  "aggregate",
  "history_compare",
  "capability_gap",
  "capabilities",
  "open_chat",
  "out_of_scope",
  "unclear",
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

export type CozeChatClassifierConfig = {
  apiUrl: string;
  workflowName: string;
  workflowId: string;
  workflowVersion: string;
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

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isValidClassifierResult(value: unknown): value is ChatClassifierResult {
  return isRecord(value)
    && value.schemaVersion === CHAT_CLASSIFIER_SCHEMA_VERSION
    && typeof value.intent === "string"
    && classifierIntents.has(value.intent)
    && typeof value.needsClarification === "boolean"
    // 合同冻结：needsClarification 当且仅当 unclear——澄清话术一等路径由该耦合触发。
    && value.needsClarification === (value.intent === "unclear");
}

function extractClassifierOutput(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = parseJsonString(trimmed);
    return parsed === trimmed ? trimmed : extractClassifierOutput(parsed, depth + 1);
  }
  if (!isRecord(value)) return undefined;
  if (isValidClassifierResult(value)) return JSON.stringify(value);
  for (const key of ["classifier_output", "classifierOutput", "output", "text", "data"]) {
    if (value[key] !== undefined) {
      const output = extractClassifierOutput(value[key], depth + 1);
      if (output) return output;
    }
  }
  return undefined;
}

export function parseClassifierResult(rawText: string): ChatClassifierResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier output was not JSON");
  }
  if (!isValidClassifierResult(parsed)) {
    throw new ChatProviderError("MODEL_INVALID_RESPONSE", "Classifier output did not match chat-classifier-v0.1");
  }
  return parsed;
}

// 影子模式开关独立于 CHAT_MODEL_ENABLED：分类器可在对话模型未配置时单独验证。
// URL/Token/模型默认复用 COZE_CHAT_*（同一扣子账号），可用 COZE_CHAT_CLASSIFIER_* 覆盖；
// 绝不读取骑后解读的 COZE_*（不含 _CHAT_）配置。
export function readCozeChatClassifierConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CozeChatClassifierConfig | undefined {
  if (environment.CHAT_CLASSIFIER_ENABLED !== "true") return undefined;
  const workflowId = environment.COZE_CHAT_CLASSIFIER_WORKFLOW_ID?.trim();
  const workflowVersion = environment.COZE_CHAT_CLASSIFIER_WORKFLOW_VERSION?.trim();
  if (!workflowId || !workflowVersion) return undefined;
  const apiUrl = environment.COZE_CHAT_CLASSIFIER_API_URL?.trim() || environment.COZE_CHAT_API_URL?.trim();
  const apiToken = environment.COZE_CHAT_CLASSIFIER_API_TOKEN?.trim() || environment.COZE_CHAT_API_TOKEN?.trim();
  if (!apiUrl || !apiToken) return undefined;

  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("COZE_CHAT_CLASSIFIER_API_URL must use HTTPS unless it targets localhost");
  }
  return {
    apiUrl: parsedUrl.toString(),
    workflowName: environment.COZE_CHAT_CLASSIFIER_WORKFLOW_NAME?.trim() || "ride_chat_classifier_v1",
    workflowId,
    workflowVersion,
    apiToken,
    modelId: environment.COZE_CHAT_CLASSIFIER_MODEL_ID?.trim() || environment.COZE_CHAT_MODEL_ID?.trim() || "unrecorded",
    timeoutMs: positiveInteger(environment.COZE_CHAT_CLASSIFIER_TIMEOUT_MS, 5_000, 25_000),
    maxResponseBytes: positiveInteger(environment.COZE_CHAT_CLASSIFIER_MAX_RESPONSE_BYTES, 16 * 1_024, 262_144),
  };
}

export class CozeChatClassifierClient implements ChatClassifierClient {
  private readonly config: CozeChatClassifierConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CozeChatClassifierConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async classify(input: { requestId: string; text: string }): Promise<ChatClassifierResult> {
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
            classify_request: JSON.stringify({
              agent: "ride_chat_v1",
              classifierVersion: CHAT_CLASSIFIER_SCHEMA_VERSION,
              text: input.text,
            }),
          },
        }),
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
      if (typeof envelopeValue.code === "number" && envelopeValue.code !== 0) {
        throw new ChatProviderError("MODEL_TEMPORARY_UNAVAILABLE", "Classifier provider rejected request");
      }
      const rawText = extractClassifierOutput(envelopeValue.data ?? envelopeValue);
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
  const config = readCozeChatClassifierConfig(environment);
  return config ? new CozeChatClassifierClient(config) : undefined;
}

// 影子执行结果：ok 携带分类标签；error 携带稳定错误码（含配置错误）。两者都不影响主链路回复。
export type ChatClassifierErrorCode = Exclude<ChatProviderErrorCode, "MODEL_NOT_CONFIGURED"> | "CLASSIFIER_CONFIG_INVALID";

export type ChatClassifierShadowOutcome =
  | { status: "ok"; intent: ChatClassifierIntent; needsClarification: boolean; durationMs: number }
  | { status: "error"; code: ChatClassifierErrorCode; durationMs: number };

export async function runChatClassifierShadow(input: {
  client: ChatClassifierClient;
  requestId: string;
  text: string;
}): Promise<ChatClassifierShadowOutcome> {
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

// 意图 → 影子对照的规则层期望路由。null 表示规则层无对应（不构成分歧判定）。
const INTENT_ROUTE_EXPECTATIONS: Readonly<Record<ChatClassifierIntent, readonly ChatRoute[] | null>> = {
  safety_stop: ["safety_stop"],
  privacy_boundary: ["privacy_boundary"],
  injection_stop: ["injection_stop"],
  ride_summary: ["current_ride"],
  aggregate: ["aggregate"],
  // CHAT-13：历史比较在规则层已由 HISTORY_COMPARE 正则承接为独立路由（compare_rides 工具）。
  history_compare: ["history_compare"],
  capability_gap: ["capability_gap"],
  capabilities: ["capabilities"],
  // CHAT-17 P2：open_chat 映射 autonomous_tools（L2b 自主工具循环，分类器 Prompt v0.3 重定边界）；
  // 纯问候（L0 SOCIAL 快路径 → social）与域外闲聊（out_of_scope）同属开放方向，均计为一致。
  open_chat: ["social", "out_of_scope", "autonomous_tools"],
  out_of_scope: ["out_of_scope"],
  // unclear 无规则层对应——澄清话术是 P3 新增的一等路径，影子阶段仅记录。
  unclear: null,
};

export function classifierAgreesWithRule(intent: ChatClassifierIntent, route: ChatRoute): boolean | null {
  const expected = INTENT_ROUTE_EXPECTATIONS[intent];
  if (!expected) return null;
  return expected.includes(route);
}

// 影子模式事件属性（仅脱敏标签与状态，不含用户原文）——仅在分类器已配置时附加。
export function shadowClassifierAttributes(outcome: ChatClassifierShadowOutcome, route: ChatRoute): Record<string, string> {
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

// CHAT-12 P3：分类器运行模式——shadow（默认，只记录不生效）与 active（接管主路由）。
// 默认值是 shadow：任何非法取值都安全降级为影子模式，混合架构任何时刻不劣于纯规则基线。
export type ChatClassifierMode = "shadow" | "active";

export function readChatClassifierMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ChatClassifierMode {
  return environment.CHAT_CLASSIFIER_MODE?.trim() === "active" ? "active" : "shadow";
}

// CHAT-12 P3：意图 → 路由决定（分类器接管主路由的权威映射）。
// 红线意图即使 L0 正则未拦截也尊重（纵深防御）；history_compare 在 CHAT-13 接入前
// 落 capability_gap（域内能力不足模板）；unclear 触发澄清话术一等路径。
export function intentToRoutingDecision(intent: ChatClassifierIntent, normalizedLength: number): ChatRoutingDecision {
  switch (intent) {
    case "safety_stop":
      return makeChatDecision("safety_stop", "semantic_safety", "SEMANTIC_SAFETY_STOP", normalizedLength);
    case "privacy_boundary":
      return makeChatDecision("privacy_boundary", "privacy_request", "PRIVACY_REQUEST", normalizedLength);
    case "injection_stop":
      return makeChatDecision("injection_stop", "prompt_injection", "PROMPT_INJECTION", normalizedLength);
    case "ride_summary":
      return makeChatDecision("current_ride", "none", "CURRENT_RIDE", normalizedLength);
    case "aggregate":
      return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
    // CHAT-13：历史比较由 compare_rides 只读工具承接（30 天窗口历史基线）。
    case "history_compare":
      return makeChatDecision("history_compare", "none", "HISTORY_COMPARE", normalizedLength);
    case "capability_gap":
      return makeChatDecision("capability_gap", "none", "CAPABILITY_GAP", normalizedLength);
    case "capabilities":
      return makeChatDecision("capabilities", "none", "CAPABILITIES", normalizedLength);
    // CHAT-17 P2：开放/复合问题映射 L2b 自主工具循环（find_ride 首场景）——模型在只读工具
    // 白名单与既有预算内自行组合调用工具；纯问候由 L0 SOCIAL 快路径承接（不经此映射）。
    case "open_chat":
      return makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", normalizedLength);
    case "out_of_scope":
      return makeChatDecision("out_of_scope", "none", "OUT_OF_SCOPE", normalizedLength);
    case "unclear":
      return makeChatDecision("clarification", "none", "CLARIFICATION_NEEDED", normalizedLength);
  }
}

// CHAT-12 P3：active 模式混合路由编排——L0 快路径（零调用直答）→ L1 分类器串行接管 →
// 失败/超时/限流降级 P1 全量规则（ruleDecision）。混合架构任何时刻不劣于纯规则基线。
export type ActiveChatRoutingResolution = {
  decision: ChatRoutingDecision;
  routedBy: "rules_l0" | "classifier" | "rules_fallback";
  configStatus?: "not_configured";
  outcome?: ChatClassifierShadowOutcome;
};

export async function resolveActiveChatRouting(input: {
  text: string;
  ruleDecision: ChatRoutingDecision;
  classifier?: ChatClassifierClient;
  requestId: string;
}): Promise<ActiveChatRoutingResolution> {
  const tag = `[chat-trace] [${input.requestId}]`;
  console.log(`${tag} L0+L1 active routing start | text="${input.text}" | rule.route=${input.ruleDecision.route} rule.reason=${input.ruleDecision.reasonCode}`);
  if (!input.classifier) {
    console.log(`${tag} classifier not configured → rules_fallback (route=${input.ruleDecision.route})`);
    return { decision: input.ruleDecision, routedBy: "rules_fallback", configStatus: "not_configured" };
  }
  const l0 = classifyChatInputL0(input.text);
  if (l0) {
    console.log(`${tag} L0 fast-path hit | route=${l0.route} reason=${l0.reasonCode} | classifier NOT called`);
    return { decision: l0, routedBy: "rules_l0" };
  }
  console.log(`${tag} L0 miss → invoking L1 classifier...`);
  const outcome = await runChatClassifierShadow({ client: input.classifier, requestId: input.requestId, text: input.text });
  if (outcome.status === "ok") {
    const decision = intentToRoutingDecision(outcome.intent, input.ruleDecision.normalizedLength);
    const agrees = classifierAgreesWithRule(outcome.intent, decision.route);
    console.log(`${tag} L1 classifier OK | intent=${outcome.intent} needsClarification=${outcome.needsClarification} duration=${outcome.durationMs}ms → route=${decision.route} reason=${decision.reasonCode} ruleAgrees=${agrees}`);
    return { decision, routedBy: "classifier", outcome };
  }
  console.log(`${tag} L1 classifier FAILED | code=${outcome.code} duration=${outcome.durationMs}ms → fallback to rule (route=${input.ruleDecision.route} reason=${input.ruleDecision.reasonCode})`);
  return { decision: input.ruleDecision, routedBy: "rules_fallback", outcome };
}

// CHAT-12 P3：路由事件属性——routedBy 标记本次路由由谁决定；active 模式附加分类器状态，
// L0 快路径记 classifierStatus=skipped_l0（未调用），未配置记 not_configured；shadow 模式沿用影子属性。
export function routingEventAttributes(input: {
  mode: ChatClassifierMode;
  routedBy: "rules" | "rules_l0" | "classifier" | "rules_fallback";
  route: ChatRoute;
  outcome?: ChatClassifierShadowOutcome;
  configStatus?: "not_configured" | "CLASSIFIER_CONFIG_INVALID";
}): Record<string, string> {
  const base: Record<string, string> = { routedBy: input.routedBy };
  if (input.mode === "active") {
    if (input.configStatus) return { ...base, classifierStatus: input.configStatus };
    if (input.routedBy === "rules_l0") return { ...base, classifierStatus: "skipped_l0" };
    return input.outcome ? { ...base, ...shadowClassifierAttributes(input.outcome, input.route) } : base;
  }
  return input.outcome ? { ...base, ...shadowClassifierAttributes(input.outcome, input.route) } : base;
}
