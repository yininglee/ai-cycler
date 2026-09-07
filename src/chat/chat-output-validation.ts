import type { AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ChatRoutingDecision } from "./chat-routing.ts";
import type { ChatToolResult } from "./chat-tools.ts";

export const CHAT_OUTPUT_SCHEMA_VERSION = "ride-chat-output-v0.1" as const;
export const CHAT_OUTPUT_MAX_REPLY_CHARS = 600;
export const CHAT_OUTPUT_MAX_REPLY_BYTES = 2 * 1_024;

export type ChatOutputRoute = "social" | "current_ride" | "capabilities";
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
  return decision.route === "social" || decision.route === "current_ride" || decision.route === "capabilities" ? decision.route : undefined;
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
  if (parsed.schemaVersion !== CHAT_OUTPUT_SCHEMA_VERSION || (parsed.route !== "social" && parsed.route !== "current_ride" && parsed.route !== "capabilities")) return "OUTPUT_SCHEMA_INVALID";
  if (typeof parsed.reply !== "string" || !parsed.reply.trim() || CONTROL_CHARACTERS.test(parsed.reply)) return "OUTPUT_SCHEMA_INVALID";
  if (!uniqueStrings(parsed.claimIds, 6, (item) => CLAIM_ID.test(item))) return "OUTPUT_SCHEMA_INVALID";
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
  return new Set(toolResult.claims.flatMap((claim) => [claim.value, Number(claim.displayValue)]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
}

function numbersAreSupported(reply: string, toolResult: ChatToolResult | undefined): boolean {
  const values = numericValues(toolResult);
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
    if (output.claimIds.length || output.capabilityKeys.length || !numbersAreSupported(output.reply, undefined)) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
  }
  if (output.route === "current_ride") {
    if (context.toolResult?.tool !== "get_ride_context") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedClaims = toolClaimIds(context.toolResult);
    const citedClaims = context.claimReferences
      ? output.claimIds.map((claimId) => context.claimReferences?.[claimId])
      : output.claimIds;
    if (!output.claimIds.length || output.capabilityKeys.length || citedClaims.some((claimId) => !claimId || !allowedClaims.has(claimId))) return reject("OUTPUT_CLAIM_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!numbersAreSupported(output.reply, context.toolResult)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  if (output.route === "capabilities") {
    if (context.toolResult?.tool !== "get_capabilities") return reject("OUTPUT_TOOL_CONTEXT_MISSING", output.claimIds.length, output.capabilityKeys.length);
    const allowedCapabilities = toolCapabilityKeys(context.toolResult);
    if (output.claimIds.length || !output.capabilityKeys.length || output.capabilityKeys.some((key) => !allowedCapabilities.has(key))) return reject("OUTPUT_CAPABILITY_INVALID", output.claimIds.length, output.capabilityKeys.length);
    if (!numbersAreSupported(output.reply, undefined)) return reject("OUTPUT_NUMERIC_UNSUPPORTED", output.claimIds.length, output.capabilityKeys.length);
  }
  return { ok: true, output, publicResult: { status: "accepted", referencedClaimCount: output.claimIds.length, referencedCapabilityCount: output.capabilityKeys.length } };
}
