import { ChatProviderError, type ChatProviderErrorCode } from "./chat-agent.ts";
import { buildChatClassifierUserPrompt, CHAT_CLASSIFIER_SYSTEM_PROMPT } from "./chat-classifier-prompt.ts";
import { classifyChatInputL0, makeChatDecision, type ChatRoute, type ChatRoutingDecision } from "./chat-routing.ts";

// L1 LLM 语义分类器（CHAT-12 P2 引入；AGT-A1 起按 D-A5 单一启用语义运行）。
// 合同冻结项：
// - 输出只有 {schemaVersion, intent, needsClarification}，不使用模型自报数字置信度（快速模型校准不可信）；
// - `unclear` 是显式合法输出（触发澄清话术一等路径），不是错误；
// - 输入仅当前问题文本（不含摘要槽位、不含任何私有数据）；
// - **D-A5（2026-10-23 用户拍板）**：取消 shadow/active 双模式——`CHAT_CLASSIFIER_ENABLED=true`
//   即分类器接管主路由（唯一启用语义）；未配置/关闭 = 规则基线（开发与未升级环境兜底）。
// - **D-A2（2026-10-23 用户拍板）**：启用态分类器失败/超时/限流不再降级 P1 业务正则硬猜——
//   统一"模型暂不可用"终局降级（诚实失败优于错误猜测：L0 与红线恒可用，其余明示不可用）；
//   原 CHAT-12"任何时刻不劣于纯规则基线"承诺随之修订。
export const CHAT_CLASSIFIER_SCHEMA_VERSION = "chat-classifier-v0.2" as const;
export const CHAT_CLASSIFIER_INPUT_CONTRACT_VERSION = "ride-chat-classifier-input-v0.1" as const;
export const SILICONFLOW_CLASSIFIER_PROVIDER_VERSION = "siliconflow-classifier-provider-v0.1" as const;
export const DEFAULT_SILICONFLOW_CLASSIFIER_MODEL_ID = "deepseek-ai/DeepSeek-V4-Flash" as const;

export const CHAT_CLASSIFIER_INTENTS = [
  // 红线类（L0 规则层仍先拦截；分类器标注用于纵深防御验证）
  "safety_stop",
  "privacy_boundary",
  "injection_stop",
  // 数据与能力类
  "ride_summary",
  "aggregate",
  "history_compare",
  // AGT-A1（意图路由 v0.4）：能力/水平评估自 capability_gap 迁入 level_assessment；
  // capability_gap 收窄为"域内但产品暂无法服务"（轨迹录像回放、外部健康数据接入类问法）。
  "level_assessment",
  "capability_gap",
  "capabilities",
  // AGT-A1：骑行科学/训练原理知识问答（问知识 vs 问产品能力 capabilities）。
  "kb_qa",
  // AGT-A1：训练任务簇——仅骑行训练；域外训练（马拉松/跑步）仍 out_of_scope。
  "training_plan",
  "training_supervision",
  // 对话类：companion 为 D-A4 拆分（骑行相关社交闲聊 → social 路由）；
  // open_chat 收窄为纯跨记录筛选/排名/复合问法（→ autonomous_tools / L2b 循环）。
  "companion",
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

// AGT-A0（D-A6）：分类器 LLM 调用从 Coze workflow（ride_chat_classifier_v1）退役，改为硅基流动
// OpenAI 兼容 chat completions 直连。Prompt v0.3 原样迁入 `chat-classifier-prompt.ts` 并随请求发送
// （换管道不换语义，v0.4 语义变更留给 AGT-A3）；classify_request 输入合同不变。

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
    && typeof value.needsClarification === "boolean"
    // 合同冻结：needsClarification 当且仅当 unclear——澄清话术一等路径由该耦合触发。
    && value.needsClarification === (value.intent === "unclear");
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
const INTENT_ROUTE_EXPECTATIONS: Readonly<Record<ChatClassifierIntent, readonly ChatRoute[] | null>> = {
  safety_stop: ["safety_stop"],
  privacy_boundary: ["privacy_boundary"],
  injection_stop: ["injection_stop"],
  ride_summary: ["current_ride"],
  aggregate: ["aggregate"],
  // CHAT-13：历史比较在规则层已由 HISTORY_COMPARE 正则承接为独立路由（compare_rides 工具）。
  history_compare: ["history_compare"],
  // AGT-A1：能力/水平评估独立路由（自 capability_gap 迁入）。
  level_assessment: ["level_assessment"],
  capability_gap: ["capability_gap"],
  capabilities: ["capabilities"],
  kb_qa: ["kb_qa"],
  training_plan: ["training_plan"],
  training_supervision: ["training_supervision"],
  // AGT-A1（D-A4）：companion（骑行相关闲聊）→ social 路由零模型模板。
  companion: ["social"],
  // AGT-A1（D-A4）：open_chat 收窄为纯跨记录筛选/排名/复合问法 → L2b 自主工具循环；
  // 纯问候由 companion/social 承接、域外闲聊由 out_of_scope 承接——不再与它们互认一致。
  open_chat: ["autonomous_tools"],
  out_of_scope: ["out_of_scope"],
  // unclear 无规则层对应——澄清话术是一等路径，仅记录。
  unclear: null,
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

// AGT-A1（D-A5）：意图 → 路由决定（分类器接管主路由的权威映射，16 意图全覆盖）。
// 红线意图即使 L0 正则未拦截也尊重（纵深防御）；unclear 触发澄清话术一等路径；
// companion → social（D-A4：闲聊不进 L2b 工具循环）；四个任务簇新意图 → 新路由确定性占位
// （AGT-B/C/F/G 落地后逐个升级为实能力）。
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
    // AGT-A1：能力/水平评估自 capability_gap 迁入（占位模板，AGT-C 生成层承接）。
    case "level_assessment":
      return makeChatDecision("level_assessment", "none", "LEVEL_ASSESSMENT", normalizedLength);
    case "capability_gap":
      return makeChatDecision("capability_gap", "none", "CAPABILITY_GAP", normalizedLength);
    case "capabilities":
      return makeChatDecision("capabilities", "none", "CAPABILITIES", normalizedLength);
    // AGT-A1：知识问答占位模板（KB RAG 工具 AGT-B 接入）。
    case "kb_qa":
      return makeChatDecision("kb_qa", "none", "KB_QA", normalizedLength);
    // AGT-A1：训练计划占位模板（生成 + 硬门 + 确认制 AGT-F 承接）。
    case "training_plan":
      return makeChatDecision("training_plan", "none", "TRAINING_PLAN", normalizedLength);
    // AGT-A1：训练监督占位模板（计划执行器 AGT-G 承接）。
    case "training_supervision":
      return makeChatDecision("training_supervision", "none", "TRAINING_SUPERVISION", normalizedLength);
    // AGT-A1（D-A4）：骑行相关闲聊 → social 路由（既有零模型模板，AGT-C 升级陪伴生成）。
    case "companion":
      return makeChatDecision("social", "none", "SOCIAL", normalizedLength);
    // CHAT-17 P2：纯跨记录筛选/排名/复合问法 → L2b 自主工具循环（find_ride 首场景）。
    case "open_chat":
      return makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", normalizedLength);
    case "out_of_scope":
      return makeChatDecision("out_of_scope", "none", "OUT_OF_SCOPE", normalizedLength);
    case "unclear":
      return makeChatDecision("clarification", "none", "CLARIFICATION_NEEDED", normalizedLength);
  }
}

// AGT-A1（D-A5 + D-A2）：路由编排——单一启用语义：
// - 分类器未配置/未启用 → 规则基线（ruleDecision，事件记 not_configured）；
// - L0 快路径（红线 + 高置信聚合/身份/纯问候）→ 零调用直答（rules_l0，分类器不发起）；
// - L1 分类器接管（classifier）；
// - **分类器失败/超时/限流 → unavailable（终局降级：不再走 P1 业务正则硬猜，调用方直接
//   返回"模型暂不可用"降级回复）**。L0 与红线恒可用。
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
  if (!input.classifier) {
    console.log(`${tag} classifier not configured → rules baseline (route=${input.ruleDecision.route})`);
    return { decision: input.ruleDecision, routedBy: "rules", configStatus: "not_configured" };
  }
  const l0 = classifyChatInputL0(input.text);
  if (l0) {
    console.log(`${tag} L0 fast-path hit | route=${l0.route} reason=${l0.reasonCode} | classifier NOT called`);
    return { decision: l0, routedBy: "rules_l0" };
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
