import type { AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ChatRoutingDecision } from "./chat-routing.ts";
import { chatToolSpecs, toolClaimIds, type ChatToolResult } from "./chat-tools.ts";
import { chatNumbersSupported, chatNumberTokens } from "./chat-numeric-evidence.ts";

// v0.3 adds a typed contextual clarification; answers still require evidence.
// v0.1/v0.2 remain accepted as answers, including their original exact key sets.
//
// AGT-H0（2026-10-27）口径澄清——本文件只校模型输出协议：
// 需求文档里的"输出合同 v0.3（choices / artifact / quickActions）"指的是**响应层**合同
// （服务端 → 前端），这三个字段由编排层从工具结果同源生成、模型不经手，因此不进入
// 模型输出 JSON，也不该在这里校验。响应层合同与 schema 见 `chat-interaction.ts`
// （`ride-chat-interaction-v0.3`）。把两者混为一谈会让模型有机会伪造记录列表。
export const CHAT_OUTPUT_SCHEMA_VERSION = "ride-chat-output-v0.3" as const;
export const CHAT_OUTPUT_PREVIOUS_SCHEMA_VERSION = "ride-chat-output-v0.2" as const;
export const CHAT_OUTPUT_LEGACY_SCHEMA_VERSION = "ride-chat-output-v0.1" as const;
export const CHAT_OUTPUT_MAX_REPLY_CHARS = 600;
export const CHAT_OUTPUT_MAX_REPLY_BYTES = 2 * 1_024;
export const CHAT_OUTPUT_MAX_CLAIM_IDS = 12;
export const CHAT_OUTPUT_MAX_KNOWLEDGE_IDS = 6;

// CHAT-13：history_compare 加入输出路由空间（compare_rides 场景分化）。
// CHAT-17 P3/P4：autonomous_tools 加入输出路由空间（L2b 循环最终回答）。
// AGT-B0：kb_qa / level_assessment 加入——两者在 B4 从占位模板升级为工具循环，
// 输出校验必须先能识别它们的 route，否则模型一返回就被 OUTPUT_ROUTE_MISMATCH 拒。
export type ChatOutputRoute =
  | "social"
  | "current_ride"
  | "capabilities"
  | "history_compare"
  | "autonomous_tools"
  | "kb_qa"
  | "level_assessment";

export type ChatOutputValidationCode =
  | "OUTPUT_INVALID_JSON"
  | "OUTPUT_SCHEMA_INVALID"
  | "OUTPUT_ROUTE_MISMATCH"
  | "OUTPUT_TOOL_CONTEXT_MISSING"
  | "OUTPUT_CLAIM_INVALID"
  | "OUTPUT_CAPABILITY_INVALID"
  | "OUTPUT_NUMERIC_UNSUPPORTED"
  // AGT-B0：知识引用不合法（引用了本轮工具结果之外的条目，或本轮根本没有知识证据）。
  | "OUTPUT_KNOWLEDGE_INVALID"
  | "OUTPUT_SAFETY_VIOLATION"
  | "OUTPUT_PRIVACY_VIOLATION"
  | "OUTPUT_INJECTION_VIOLATION"
  | "OUTPUT_TOO_LONG";

export type ChatOutput = {
  schemaVersion: typeof CHAT_OUTPUT_SCHEMA_VERSION | typeof CHAT_OUTPUT_PREVIOUS_SCHEMA_VERSION | typeof CHAT_OUTPUT_LEGACY_SCHEMA_VERSION;
  responseKind: "answer" | "clarification";
  route: ChatOutputRoute;
  reply: string;
  claimIds: string[];
  capabilityKeys: AtomicCapabilityKey[];
  knowledgeIds: string[];
};

export type ChatOutputValidationPublic = {
  status: "accepted" | "rejected";
  code?: ChatOutputValidationCode;
  referencedClaimCount: number;
  referencedCapabilityCount: number;
  // AGT-B5（B0 审查登记的缺口，细规划列在 B5 "顺手补"）：B6 的 KB 引用统计需要它，
  // 否则评测侧只能从原始输出重算。与 claim/capability 计数同构。
  referencedKnowledgeCount: number;
};

export type ChatOutputValidationResult =
  | { ok: true; output: ChatOutput; publicResult: ChatOutputValidationPublic }
  | { ok: false; code: ChatOutputValidationCode; publicResult: ChatOutputValidationPublic };

export type ChatOutputValidationContext = {
  decision: ChatRoutingDecision;
  toolResult?: ChatToolResult;
  claimReferences?: Readonly<Record<string, string>>;
  // CHAT-12 P3（校验场景分化）：用户输入中的数字（阈值“120”等用户给定值）加入白名单——
  // 模型复述用户给定值不是幻觉，只须可溯源到 Claims 或用户原句。
  userText?: string;
  // CHAT-17 P3/P4：L2b 循环——本轮全部已完成工具调用结果（动态溯源白名单数据源）；
  // autonomous_tools 路由的 claimIds/数字必须溯源到这些结果的 Claims 并集。
  loopToolResults?: readonly ChatToolResult[];
  // AGT-B0：本轮可被引用的知识条目 ID 并集（来自 search_knowledge_base 结果）。
  // 引用必须落在这个集合内——本轮没检索过知识库，就不能出现 knowledgeIds。
  knowledgeIds?: readonly string[];
};

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SAFETY_TERMS = /(诊断|处方|加量训练|实时路况|现在路况|导航指引)/i;
const PRIVACY_TERMS = /(精确位置|准确位置|经纬度|坐标|住址|家庭住址|原始轨迹|owner_?id|ride_?id|其他用户|他人的记录)/i;
const INJECTION_TERMS = /(系统提示词|system prompt|developer message|api[ _-]?key|访问令牌|密钥|token|忽略.*指令|ignore.*instruction|越狱|jailbreak)/i;
// AGT-B0（G6 修复）：三组词表原先是"词面命中即拒"，把**安全声明**也拦了——
// 实测 "我不是医生，不能做诊断" → SAFETY_VIOLATION、"不会访问其他用户的数据" →
// PRIVACY_VIOLATION、"不会提供 api key" → INJECTION_VIOLATION。而 AGT-C 要加的
// "非医疗诊断声明"话术正好是这种句式，等于规划里的安全话术无法上屏。
//
// 改法：逐个命中位置看**前 14 字窗口**里有没有否定/声明线索；有则视为"声明/拒绝"豁免。
// 红线：豁免只覆盖否定与声明短语，危险断言（"你患有…""建议服用…"）照拦；
// 不做整句豁免（否则"虽然不能诊断，但你应该加量"会被整句放过——这是已知局限，
// 靠 Prompt 约束 + AGT-C 离线语义判官兜，不在规则层解决）。
const NEGATION_CUES = /(不能|不会|不可以|不做|不提供|不给|无法|拒绝|不涉及|不读取|不访问|不包含|没有|不负责|不属于|不是|不建议|不宜|避免|无须|无需|仅|只)/;
const NEGATION_WINDOW_CHARS = 14;
const CLAIM_ID = /^claim:[A-Za-z0-9:_-]{1,240}$/;
// knowledgeId 来自领域 KB（如 kb-v21-pacingExecution）——维度 ID 是 camelCase，
// 因此必须允许大写字母，不能用纯小写 slug 正则。
const KNOWLEDGE_ID = /^kb-[A-Za-z0-9][A-Za-z0-9-]{0,80}$/;
const NUMBERS = /\d+(?:\.\d+)?/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function uniqueStrings(value: unknown, maximum: number, predicate: (item: string) => boolean): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item): item is string => typeof item === "string" && predicate(item))
    && new Set(value).size === value.length;
}

/**
 * 词表命中判定：逐次命中检查其前 14 字是否处于否定/声明语境。
 * 返回 true 表示存在**未被否定**的命中（应当拒绝）。
 */
function hasUnnegatedHit(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(global)) {
    const start = match.index ?? 0;
    const window = text.slice(Math.max(0, start - NEGATION_WINDOW_CHARS), start);
    if (!NEGATION_CUES.test(window)) return true;
  }
  return false;
}

const CHAT_OUTPUT_ROUTE_VALUES: readonly ChatOutputRoute[] = [
  "social",
  "current_ride",
  "capabilities",
  "history_compare",
  "autonomous_tools",
  "kb_qa",
  "level_assessment",
];
const CHAT_OUTPUT_ROUTE_SET = new Set<string>(CHAT_OUTPUT_ROUTE_VALUES);

function outputRoute(decision: ChatRoutingDecision): ChatOutputRoute | undefined {
  return CHAT_OUTPUT_ROUTE_SET.has(decision.route) ? (decision.route as ChatOutputRoute) : undefined;
}

function reject(code: ChatOutputValidationCode, claimCount = 0, capabilityCount = 0, knowledgeCount = 0): ChatOutputValidationResult {
  return { ok: false, code, publicResult: { status: "rejected", code, referencedClaimCount: claimCount, referencedCapabilityCount: capabilityCount, referencedKnowledgeCount: knowledgeCount } };
}

// Parse v0.1 (5 keys), v0.2 (6 keys), and v0.3 (7 keys including responseKind).
// 保留 v0.1 是刻意的向后兼容：既有 4 工具链路与全部历史测试输出无需改动即可继续通过，
// 版本升级只对"要用知识证据"的调用生效。
function parseOutput(rawOutput: string): ChatOutput | ChatOutputValidationCode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return "OUTPUT_INVALID_JSON";
  }
  if (!isRecord(parsed)) return "OUTPUT_SCHEMA_INVALID";
  const isLegacy = parsed.schemaVersion === CHAT_OUTPUT_LEGACY_SCHEMA_VERSION;
  const isCurrent = parsed.schemaVersion === CHAT_OUTPUT_SCHEMA_VERSION;
  const isPrevious = parsed.schemaVersion === CHAT_OUTPUT_PREVIOUS_SCHEMA_VERSION;
  if (!isLegacy && !isCurrent && !isPrevious) return "OUTPUT_SCHEMA_INVALID";
  const expectedKeys = isLegacy
    ? ["schemaVersion", "route", "reply", "claimIds", "capabilityKeys"]
    : ["schemaVersion", "route", "reply", "claimIds", "capabilityKeys", "knowledgeIds", ...(isCurrent ? ["responseKind"] : [])];
  if (!hasExactKeys(parsed, expectedKeys)) return "OUTPUT_SCHEMA_INVALID";
  if (isCurrent && parsed.responseKind !== "answer" && parsed.responseKind !== "clarification") return "OUTPUT_SCHEMA_INVALID";
  if (typeof parsed.route !== "string" || !CHAT_OUTPUT_ROUTE_SET.has(parsed.route)) return "OUTPUT_SCHEMA_INVALID";
  if (typeof parsed.reply !== "string" || !parsed.reply.trim() || CONTROL_CHARACTERS.test(parsed.reply)) return "OUTPUT_SCHEMA_INVALID";
  // CHAT-15（真实链路采样发现）：总结型问题（“数据怎么样”）的工具上下文含 9 个 claims，
  // 模型全量引用是自然行为——claimIds 上限从 6 提高到 12（输出合同未冻结该数字，
  // prompt 与扣子侧均未提及；capabilityKeys 上限 8 与 capabilityScope 全量一致，不变）。
  if (!uniqueStrings(parsed.claimIds, CHAT_OUTPUT_MAX_CLAIM_IDS, (item) => CLAIM_ID.test(item))) return "OUTPUT_SCHEMA_INVALID";
  if (!uniqueStrings(parsed.capabilityKeys, 8, (item) => /^[A-Za-z][A-Za-z0-9]*$/.test(item))) return "OUTPUT_SCHEMA_INVALID";
  const knowledgeIds = !isLegacy
    ? parsed.knowledgeIds
    : [];
  if (!uniqueStrings(knowledgeIds, CHAT_OUTPUT_MAX_KNOWLEDGE_IDS, (item) => KNOWLEDGE_ID.test(item))) return "OUTPUT_SCHEMA_INVALID";
  return {
    schemaVersion: isCurrent ? CHAT_OUTPUT_SCHEMA_VERSION : isPrevious ? CHAT_OUTPUT_PREVIOUS_SCHEMA_VERSION : CHAT_OUTPUT_LEGACY_SCHEMA_VERSION,
    responseKind: isCurrent && parsed.responseKind === "clarification" ? "clarification" : "answer",
    route: parsed.route as ChatOutputRoute,
    reply: parsed.reply.trim(),
    claimIds: parsed.claimIds,
    capabilityKeys: parsed.capabilityKeys as AtomicCapabilityKey[],
    knowledgeIds,
  };
}

function toolCapabilityKeys(toolResult: ChatToolResult | undefined): Set<AtomicCapabilityKey> {
  return toolResult?.tool === "get_capabilities" ? new Set(toolResult.capabilities.map((capability) => capability.key)) : new Set();
}

// AGT-B0：数字证据统一走 spec——每个工具声明自己的数字事实，等价类由
// chat-numeric-evidence 生成（舍入/单位换算/比例）。校验器不再认识任何具体工具名，
// 新工具只要在 chatToolSpecs 里声明 numericFacts 就自动进白名单。
function supportedByFacts(reply: string, toolResults: readonly ChatToolResult[], userText?: string): boolean {
  return chatNumbersSupported(
    reply,
    toolResults.flatMap((result) => chatToolSpecs[result.tool].numericFacts(result)),
    userText,
  );
}

// AGT-B0：以下四个旧的按工具名取数的函数（numericValues / numbersAreSupported /
// comparisonNumericValues / comparisonNumbersAreSupported / loopNumbersAreSupported）
// 已全部由 chatToolSpecs.numericFacts + chatNumericVariants 替代。保留此注释是为了
// 让后来者知道"数字白名单在这里消失"是重构结果，不是漏写。

// AGT-B0：比较与循环场景的数字白名单同样迁到 spec.numericFacts（见 chat-tools.ts
// 的 compare_rides / find_ride 条目），此处不再保留按工具名的实现。

// AGT-B0：L2b 系路由（autonomous_tools / kb_qa / level_assessment）的证据校验统一实现。
// 与旧实现的差别：不再按工具名拼 Claim 集合（有 spec 声明），并引入知识证据形态。
//
// 证据要求（细规划 §5.5 K3 澄清后的口径）：
//   ① 本次循环必须有已完成结果，否则拒（模型不得零工具给事实性回答）；
//   ② 引用的 Claim 与知识条目都必须落在本轮结果集合内（各 ID 独立溯源）；
//   ③ 语义上"至少引用一种证据"；**仅有知识证据时必须引用知识条目**
//      （知识问答不能凭空回答），两类共存时允许只引其中一类
//      （避免"检索了知识库但只用了数据"被判死）。
function validateLoopEvidence(
  output: ChatOutput,
  context: ChatOutputValidationContext,
): ChatOutputValidationCode | undefined {
  const results = context.loopToolResults ?? [];
  if (results.some(result => "saved" in result && result.clarificationNeeded) && output.responseKind !== "clarification") return "OUTPUT_SCHEMA_INVALID";
  // A typed clarification is a question, not a data answer. It requires no
  // fabricated Claim just to ask for intent/units; numeric and safety checks stay.
  if (output.responseKind === "clarification") {
    if (output.claimIds.length || output.knowledgeIds.length || output.capabilityKeys.length || !/[？?]$/.test(output.reply)) return "OUTPUT_SCHEMA_INVALID";
    return supportedByFacts(output.reply, results, context.userText) ? undefined : "OUTPUT_NUMERIC_UNSUPPORTED";
  }
  if (results.length === 0) {
    // AGT-B5（BND-S06 驱动）：autonomous_tools 下"**不需要数据的合法拒答**"没有出口。
    // 实测："把我刚才说的那句话删掉" → 模型答"我无法删除您之前说过的话……我的功能是
    // 分析和解读骑行记录"——完全正确，却因"零工具"被判 OUTPUT_TOOL_CONTEXT_MISSING，
    // 修复轮同样 → REPAIR_FAILED。
    // 放行必须**四条同时满足**，否则会给"零工具空洞回答"开口子：
    //   ① 三类证据全空 ② reply 无任何数字 ③ 措辞是能力说明/拒答 ④ 无事实断言
    // 取数类问题若答"骑得不错"这类空话，不含能力说明词 → 仍被拒。
    const capabilityRefusal = /无法|不能|不支持|不允许|只能|做不到|功能是|不在我的|无能为力/.test(output.reply);
    const noNumbers = chatNumberTokens(output.reply).length === 0;
    const noEvidence = output.claimIds.length === 0 && output.knowledgeIds.length === 0 && output.capabilityKeys.length === 0;
    if (capabilityRefusal && noNumbers && noEvidence) return undefined;
    return "OUTPUT_TOOL_CONTEXT_MISSING";
  }
  if (output.capabilityKeys.length) return "OUTPUT_CLAIM_INVALID";

  const allowedClaims = toolClaimIds(results);
  const citedClaims = context.claimReferences
    ? output.claimIds.map((claimId) => context.claimReferences?.[claimId])
    : output.claimIds;
  if (citedClaims.some((claimId) => !claimId || !allowedClaims.has(claimId))) return "OUTPUT_CLAIM_INVALID";

  const allowedKnowledge = new Set(context.knowledgeIds ?? []);
  if (output.knowledgeIds.some((id) => !allowedKnowledge.has(id))) return "OUTPUT_KNOWLEDGE_INVALID";

  const hasClaimEvidence = results.some((result) => {
    const spec = chatToolSpecs[result.tool];
    return spec.evidenceKind === "claims" && spec.hasUsableEvidence(result);
  });
  const hasKnowledgeEvidence = results.some((result) => {
    const spec = chatToolSpecs[result.tool];
    return spec.evidenceKind === "knowledge" && spec.hasUsableEvidence(result);
  });

  // 证据为空：仅有知识证据时用更精确的错误码（指向 knowledgeIds），
  // 其余情况指向 claimIds——错误码要能让修复轮知道"该补哪一侧"。
  if (!output.claimIds.length && !output.knowledgeIds.length) {
    return hasKnowledgeEvidence && !hasClaimEvidence ? "OUTPUT_KNOWLEDGE_INVALID" : "OUTPUT_CLAIM_INVALID";
  }
  if (!supportedByFacts(output.reply, results, context.userText)) return "OUTPUT_NUMERIC_UNSUPPORTED";
  return undefined;
}

export function validateChatOutput(rawOutput: string, context: ChatOutputValidationContext): ChatOutputValidationResult {
  const output = parseOutput(rawOutput);
  if (typeof output === "string") return reject(output);
  const expectedRoute = outputRoute(context.decision);
  if (!expectedRoute || output.route !== expectedRoute) return reject("OUTPUT_ROUTE_MISMATCH", output.claimIds.length, output.capabilityKeys.length);
  if (output.responseKind === "clarification" && output.route !== "autonomous_tools") return reject("OUTPUT_SCHEMA_INVALID");
  if (output.reply.length > CHAT_OUTPUT_MAX_REPLY_CHARS || Buffer.byteLength(output.reply, "utf8") > CHAT_OUTPUT_MAX_REPLY_BYTES) return reject("OUTPUT_TOO_LONG", output.claimIds.length, output.capabilityKeys.length);
  // AGT-B0（G6）：措辞检查由"词面命中即拒"改为"未否定命中即拒"——安全声明/拒绝声明
  // 豁免（"不能做诊断""不会访问其他用户的数据"），危险断言照拦（"你患有…"）。
  if (hasUnnegatedHit(output.reply, INJECTION_TERMS)) return reject("OUTPUT_INJECTION_VIOLATION", output.claimIds.length, output.capabilityKeys.length);
  if (hasUnnegatedHit(output.reply, PRIVACY_TERMS)) return reject("OUTPUT_PRIVACY_VIOLATION", output.claimIds.length, output.capabilityKeys.length);
  if (hasUnnegatedHit(output.reply, SAFETY_TERMS)) return reject("OUTPUT_SAFETY_VIOLATION", output.claimIds.length, output.capabilityKeys.length);

  if (output.route === "social") {
    if (output.claimIds.length || output.capabilityKeys.length || output.knowledgeIds.length || !chatNumbersSupported(output.reply, [], context.userText)) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
  }
  if (output.route === "current_ride") {
    if (context.toolResult?.tool !== "get_ride_context") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedClaims = toolClaimIds([context.toolResult]);
    const citedClaims = context.claimReferences
      ? output.claimIds.map((claimId) => context.claimReferences?.[claimId])
      : output.claimIds;
    if (!output.claimIds.length || output.capabilityKeys.length || citedClaims.some((claimId) => !claimId || !allowedClaims.has(claimId))) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!supportedByFacts(output.reply, [context.toolResult], context.userText)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  if (output.route === "capabilities") {
    if (context.toolResult?.tool !== "get_capabilities") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedCapabilities = toolCapabilityKeys(context.toolResult);
    if (output.claimIds.length || !output.capabilityKeys.length || output.capabilityKeys.some((key) => !allowedCapabilities.has(key))) return reject("OUTPUT_CAPABILITY_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!chatNumbersSupported(output.reply, [], context.userText)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  // CHAT-13：历史比较场景——只能引用可比 claim（不可比指标无 claimId，禁止引用），
  // 不携带能力键；数字必须溯源到比较 Claims 的显示值/变化量/样本数或用户原句。
  if (output.route === "history_compare") {
    if (context.toolResult?.tool !== "compare_rides") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedClaims = toolClaimIds([context.toolResult]);
    const citedClaims = context.claimReferences
      ? output.claimIds.map((claimId) => context.claimReferences?.[claimId])
      : output.claimIds;
    if (!output.claimIds.length || output.capabilityKeys.length || citedClaims.some((claimId) => !claimId || !allowedClaims.has(claimId))) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!supportedByFacts(output.reply, [context.toolResult], context.userText)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  // AGT-B0：L2b 系三条路由共用同一套证据校验——autonomous_tools（跨记录/复合）、
  // kb_qa（知识问答）、level_assessment（评估）。三者的差别只在 catalog 与语气（C/F），
  // 证据规则一致，因此不再各写一份（旧实现只认 autonomous_tools，另两条路由的合法
  // 输出会被 OUTPUT_ROUTE_MISMATCH 拒掉）。
  if (output.route === "autonomous_tools" || output.route === "kb_qa" || output.route === "level_assessment") {
    const code = validateLoopEvidence(output, context);
    if (code) return reject(code, output.claimIds.length, output.capabilityKeys.length);
  }
  return { ok: true, output, publicResult: { status: "accepted", referencedClaimCount: output.claimIds.length, referencedCapabilityCount: output.capabilityKeys.length, referencedKnowledgeCount: output.knowledgeIds.length } };
}
