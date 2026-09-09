import type { AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ChatRoutingDecision } from "./chat-routing.ts";
import type { ChatToolResult, CompareRidesToolResult } from "./chat-tools.ts";

export const CHAT_OUTPUT_SCHEMA_VERSION = "ride-chat-output-v0.1" as const;
export const CHAT_OUTPUT_MAX_REPLY_CHARS = 600;
export const CHAT_OUTPUT_MAX_REPLY_BYTES = 2 * 1_024;

// CHAT-13：history_compare 加入输出路由空间（compare_rides 场景分化）。
export type ChatOutputRoute = "social" | "current_ride" | "capabilities" | "history_compare";
export type ChatOutputValidationCode =
  | "OUTPUT_INVALID_JSON"
  | "OUTPUT_SCHEMA_INVALID"
  | "OUTPUT_ROUTE_MISMATCH"
  | "OUTPUT_TOOL_CONTEXT_MISSING"
  | "OUTPUT_CLAIM_INVALID"
  | "OUTPUT_CAPABILITY_INVALID"
  | "OUTPUT_NUMERIC_UNSUPPORTED"
  | "OUTPUT_SAFETY_VIOLATION"
  | "OUTPUT_PRIVACY_VIOLATION"
  | "OUTPUT_INJECTION_VIOLATION"
  | "OUTPUT_TOO_LONG";

export type ChatOutput = {
  schemaVersion: typeof CHAT_OUTPUT_SCHEMA_VERSION;
  route: ChatOutputRoute;
  reply: string;
  claimIds: string[];
  capabilityKeys: AtomicCapabilityKey[];
};

export type ChatOutputValidationPublic = {
  status: "accepted" | "rejected";
  code?: ChatOutputValidationCode;
  referencedClaimCount: number;
  referencedCapabilityCount: number;
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
};

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SAFETY_TERMS = /(诊断|处方|加量训练|实时路况|现在路况|导航指引)/i;
const PRIVACY_TERMS = /(精确位置|准确位置|经纬度|坐标|住址|家庭住址|原始轨迹|owner_?id|ride_?id|其他用户|他人的记录)/i;
const INJECTION_TERMS = /(系统提示词|system prompt|developer message|api[ _-]?key|访问令牌|密钥|token|忽略.*指令|ignore.*instruction|越狱|jailbreak)/i;
const CLAIM_ID = /^claim:[A-Za-z0-9:_-]{1,240}$/;
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

function outputRoute(decision: ChatRoutingDecision): ChatOutputRoute | undefined {
  return decision.route === "social" || decision.route === "current_ride" || decision.route === "capabilities" || decision.route === "history_compare" ? decision.route : undefined;
}

function reject(code: ChatOutputValidationCode, claimCount = 0, capabilityCount = 0): ChatOutputValidationResult {
  return { ok: false, code, publicResult: { status: "rejected", code, referencedClaimCount: claimCount, referencedCapabilityCount: capabilityCount } };
}

function parseOutput(rawOutput: string): ChatOutput | ChatOutputValidationCode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return "OUTPUT_INVALID_JSON";
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["schemaVersion", "route", "reply", "claimIds", "capabilityKeys"])) return "OUTPUT_SCHEMA_INVALID";
  if (parsed.schemaVersion !== CHAT_OUTPUT_SCHEMA_VERSION || (parsed.route !== "social" && parsed.route !== "current_ride" && parsed.route !== "capabilities" && parsed.route !== "history_compare")) return "OUTPUT_SCHEMA_INVALID";
  if (typeof parsed.reply !== "string" || !parsed.reply.trim() || CONTROL_CHARACTERS.test(parsed.reply)) return "OUTPUT_SCHEMA_INVALID";
  // CHAT-15（真实链路采样发现）：总结型问题（“数据怎么样”）的工具上下文含 9 个 claims，
  // 模型全量引用是自然行为——claimIds 上限从 6 提高到 12（输出合同未冻结该数字，
  // prompt 与扣子侧均未提及；capabilityKeys 上限 8 与 capabilityScope 全量一致，不变）。
  if (!uniqueStrings(parsed.claimIds, 12, (item) => CLAIM_ID.test(item))) return "OUTPUT_SCHEMA_INVALID";
  if (!uniqueStrings(parsed.capabilityKeys, 8, (item) => /^[A-Za-z][A-Za-z0-9]*$/.test(item))) return "OUTPUT_SCHEMA_INVALID";
  return { schemaVersion: parsed.schemaVersion, route: parsed.route, reply: parsed.reply.trim(), claimIds: parsed.claimIds, capabilityKeys: parsed.capabilityKeys as AtomicCapabilityKey[] };
}

function toolClaimIds(toolResult: ChatToolResult | undefined): Set<string> {
  return toolResult?.tool === "get_ride_context" ? new Set(toolResult.claims.map((claim) => claim.claimId)) : new Set();
}

function toolCapabilityKeys(toolResult: ChatToolResult | undefined): Set<AtomicCapabilityKey> {
  return toolResult?.tool === "get_capabilities" ? new Set(toolResult.capabilities.map((capability) => capability.key)) : new Set();
}

function numericValues(toolResult: ChatToolResult | undefined): Set<number> {
  if (toolResult?.tool !== "get_ride_context") return new Set();
  const values = new Set(toolResult.claims.flatMap((claim) => [claim.value, Number(claim.displayValue)]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  // CHAT-15（第二轮采样发现）：时间类 displayValue 是中文格式（如“1 小时 6 分钟”），
  // Number() 整体解析为 NaN 不进白名单——模型逐字复制 displayValue 是 Prompt 要求的
  // 正确行为，其中数字（1、6）必须成对收编；否则照抄也会被拒（提供与允许成对原则）。
  for (const claim of toolResult.claims) {
    for (const literal of claim.displayValue?.match(/\d+(?:\.\d+)?/g) ?? []) {
      const parsed = Number(literal);
      if (Number.isFinite(parsed)) values.add(parsed);
    }
  }
  // CHAT-15：本次骑行日期标签数字加入白名单——投影提供 rideDateLabel（如“2026年8月17日”），
  // 模型表述“8月17日这次骑行”可溯源；其他日期仍属编造，照常拦截。
  for (const literal of toolResult.rideDateLabel?.match(/\d+/g) ?? []) {
    const parsed = Number(literal);
    if (Number.isFinite(parsed)) values.add(parsed);
  }
  return values;
}

function numbersAreSupported(reply: string, toolResult: ChatToolResult | undefined, userText?: string): boolean {
  const values = numericValues(toolResult);
  // 用户输入数字白名单（CHAT-12 P3）：用户给定值（如阈值“120”）不是幻觉。
  for (const literal of userText?.match(NUMBERS) ?? []) {
    const parsed = Number(literal);
    if (Number.isFinite(parsed)) values.add(parsed);
  }
  const literals = reply.match(NUMBERS) ?? [];
  return literals.every((literal) => values.has(Number(literal)));
}

// CHAT-13：历史比较数字白名单——锚点/基线（原始值与显示值）、显示空间变化量（含绝对值）、
// 相对变化百分比（含绝对值）、样本数与窗口天数。回复中的每个数字都必须溯源到这些值或用户原句。
// CHAT-15：锚点日期数字加入场景白名单——投影向模型提供 anchorStartTime，模型表述
// “8月19日这次骑行”不是幻觉，只须可溯源到该日期本身（年/月/日，从 ISO 字符串提取）。
function comparisonNumericValues(toolResult: CompareRidesToolResult): Set<number> {
  const values = new Set<number>([
    toolResult.windowDays,
    toolResult.sampleCount,
    toolResult.comparability.sampleCount,
    toolResult.comparability.minimumSampleCount,
  ]);
  for (const literal of (toolResult.anchorStartTime?.split("T")[0] ?? "").match(/\d+/g) ?? []) {
    const parsed = Number(literal);
    if (Number.isFinite(parsed)) values.add(parsed);
  }
  for (const claim of toolResult.claims) {
    if (claim.anchor) {
      values.add(claim.anchor.value);
      values.add(Number(claim.anchor.displayValue));
      // CHAT-15（第二轮采样发现）：中文时间 displayValue（“1 小时 6 分钟”）的数字成对收编。
      for (const literal of claim.anchor.displayValue.match(/\d+(?:\.\d+)?/g) ?? []) {
        const parsed = Number(literal);
        if (Number.isFinite(parsed)) values.add(parsed);
      }
    }
    if (claim.baseline) {
      values.add(claim.baseline.value);
      values.add(Number(claim.baseline.displayValue));
      values.add(claim.baseline.sampleCount);
      for (const literal of claim.baseline.displayValue.match(/\d+(?:\.\d+)?/g) ?? []) {
        const parsed = Number(literal);
        if (Number.isFinite(parsed)) values.add(parsed);
      }
    }
    if (claim.change !== undefined) {
      values.add(claim.change);
      values.add(Math.abs(claim.change));
    }
    if (claim.relativeChangePercent !== undefined) {
      values.add(claim.relativeChangePercent);
      values.add(Math.abs(claim.relativeChangePercent));
    }
  }
  return values;
}

function comparisonNumbersAreSupported(reply: string, toolResult: CompareRidesToolResult, userText?: string): boolean {
  const values = comparisonNumericValues(toolResult);
  for (const literal of userText?.match(NUMBERS) ?? []) {
    const parsed = Number(literal);
    if (Number.isFinite(parsed)) values.add(parsed);
  }
  const literals = reply.match(NUMBERS) ?? [];
  return literals.every((literal) => values.has(Number(literal)));
}

export function validateChatOutput(rawOutput: string, context: ChatOutputValidationContext): ChatOutputValidationResult {
  const output = parseOutput(rawOutput);
  if (typeof output === "string") return reject(output);
  const expectedRoute = outputRoute(context.decision);
  if (!expectedRoute || output.route !== expectedRoute) return reject("OUTPUT_ROUTE_MISMATCH", output.claimIds.length, output.capabilityKeys.length);
  if (output.reply.length > CHAT_OUTPUT_MAX_REPLY_CHARS || Buffer.byteLength(output.reply, "utf8") > CHAT_OUTPUT_MAX_REPLY_BYTES) return reject("OUTPUT_TOO_LONG", output.claimIds.length, output.capabilityKeys.length);
  if (INJECTION_TERMS.test(output.reply)) return reject("OUTPUT_INJECTION_VIOLATION", output.claimIds.length, output.capabilityKeys.length);
  if (PRIVACY_TERMS.test(output.reply)) return reject("OUTPUT_PRIVACY_VIOLATION", output.claimIds.length, output.capabilityKeys.length);
  if (SAFETY_TERMS.test(output.reply)) return reject("OUTPUT_SAFETY_VIOLATION", output.claimIds.length, output.capabilityKeys.length);

  if (output.route === "social") {
    if (output.claimIds.length || output.capabilityKeys.length || !numbersAreSupported(output.reply, undefined, context.userText)) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
  }
  if (output.route === "current_ride") {
    if (context.toolResult?.tool !== "get_ride_context") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedClaims = toolClaimIds(context.toolResult);
    const citedClaims = context.claimReferences
      ? output.claimIds.map((claimId) => context.claimReferences?.[claimId])
      : output.claimIds;
    if (!output.claimIds.length || output.capabilityKeys.length || citedClaims.some((claimId) => !claimId || !allowedClaims.has(claimId))) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!numbersAreSupported(output.reply, context.toolResult, context.userText)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  if (output.route === "capabilities") {
    if (context.toolResult?.tool !== "get_capabilities") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedCapabilities = toolCapabilityKeys(context.toolResult);
    if (output.claimIds.length || !output.capabilityKeys.length || output.capabilityKeys.some((key) => !allowedCapabilities.has(key))) return reject("OUTPUT_CAPABILITY_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!numbersAreSupported(output.reply, undefined, context.userText)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  // CHAT-13：历史比较场景——只能引用可比 claim（不可比指标无 claimId，禁止引用），
  // 不携带能力键；数字必须溯源到比较 Claims 的显示值/变化量/样本数或用户原句。
  if (output.route === "history_compare") {
    if (context.toolResult?.tool !== "compare_rides") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedClaims = new Set(context.toolResult.claims.flatMap((claim) => (claim.claimId ? [claim.claimId] : [])));
    const citedClaims = context.claimReferences
      ? output.claimIds.map((claimId) => context.claimReferences?.[claimId])
      : output.claimIds;
    if (!output.claimIds.length || output.capabilityKeys.length || citedClaims.some((claimId) => !claimId || !allowedClaims.has(claimId))) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!comparisonNumbersAreSupported(output.reply, context.toolResult, context.userText)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  return { ok: true, output, publicResult: { status: "accepted", referencedClaimCount: output.claimIds.length, referencedCapabilityCount: output.capabilityKeys.length } };
}
