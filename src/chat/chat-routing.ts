export const CHAT_ROUTING_SCHEMA_VERSION = "chat-routing-v0.1" as const;
export const CHAT_INPUT_MAX_CHARS = 1_200;
export const CHAT_INPUT_MAX_BYTES = 4 * 1_024;
export const CHAT_RATE_LIMIT_MAX_REQUESTS = 20;
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;

export type ChatRoute =
  | "social"
  | "current_ride"
  | "capabilities"
  | "out_of_scope"
  | "safety_stop"
  | "privacy_boundary"
  | "injection_stop";

export type ChatRisk =
  | "none"
  | "medical_emergency"
  | "dangerous_riding"
  | "real_time_road"
  | "privacy_request"
  | "prompt_injection";

export type ChatRoutingDecision = {
  schemaVersion: typeof CHAT_ROUTING_SCHEMA_VERSION;
  route: ChatRoute;
  risk: ChatRisk;
  allowModel: boolean;
  action: "deterministic_reply" | "tool_then_model" | "safety_stop" | "reject";
  reasonCode:
    | "SOCIAL"
    | "CURRENT_RIDE"
    | "CAPABILITIES"
    | "OUT_OF_SCOPE"
    | "MEDICAL_EMERGENCY"
    | "DANGEROUS_RIDING"
    | "REAL_TIME_ROAD"
    | "PRIVACY_REQUEST"
    | "PROMPT_INJECTION";
  normalizedLength: number;
};

export type ChatInputGatewayResult =
  | { ok: true; text: string; decision: ChatRoutingDecision }
  | { ok: false; code: "INVALID_INPUT" | "INPUT_TOO_LARGE" | "RATE_LIMITED"; normalizedLength: number };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MEDICAL_EMERGENCY = /(胸痛|胸闷|呼吸困难|喘不上气|晕厥|昏厥|失去意识|意识不清|大出血|出血不止|疑似心脏|中风|急救|救命)/i;
const DANGEROUS_RIDING = /(正在骑|边骑边|骑车中|骑行中|一边骑|看手机|分心|刹车失灵|刹车坏|爆胎|摔倒了|摔车|无法停车)/i;
const REAL_TIME_ROAD = /(实时路况|现在路况|当前路况|封路|交通管制|红绿灯|导航|哪里安全|天气预报|现在下雨|实时天气)/i;
const PRIVACY_REQUEST = /(别人的|他人的|其他用户|另一个用户|他人数据|别人的骑行|精确位置|准确位置|家庭住址|住址|user_?id|owner_?id|账号信息)/i;
const PROMPT_INJECTION = /(忽略(之前|上面|所有)?指令|忘记(之前|上面)?指令|系统提示词|system prompt|developer message|开发者消息|显示.*提示词|泄露.*密钥|api[ _-]?key|访问令牌|token|越狱|jailbreak|不要遵守安全)/i;
const SOCIAL = /^(你好|嗨|哈喽|您好|谢谢|感谢|早上好|晚上好|在吗)[!！。,.，?？\s]*$/i;
const CAPABILITIES = /(能力|可分析|能分析|可以分析|支持哪些|有哪些数据|可以分析什么|数据范围|能做什么)/i;
const CURRENT_RIDE = /(这次|本次|当前|最近一次|上次|骑行|骑了|里程|距离|速度|心率|功率|踏频|爬升|海拔|耗时|时间)/i;

function compact(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ");
}

function decision(
  route: ChatRoute,
  risk: ChatRisk,
  reasonCode: ChatRoutingDecision["reasonCode"],
  normalizedLength: number,
): ChatRoutingDecision {
  const safety = route === "safety_stop" || route === "privacy_boundary" || route === "injection_stop";
  return {
    schemaVersion: CHAT_ROUTING_SCHEMA_VERSION,
    route,
    risk,
    allowModel: !safety && route !== "out_of_scope",
    action: safety ? "safety_stop" : route === "current_ride" || route === "capabilities" ? "tool_then_model" : "deterministic_reply",
    reasonCode,
    normalizedLength,
  };
}

export function classifyChatInput(text: string): ChatRoutingDecision {
  const normalized = compact(text);
  const normalizedLength = normalized.length;

  // Safety and authorization checks intentionally precede ordinary intent matching.
  if (MEDICAL_EMERGENCY.test(normalized)) return decision("safety_stop", "medical_emergency", "MEDICAL_EMERGENCY", normalizedLength);
  if (DANGEROUS_RIDING.test(normalized)) return decision("safety_stop", "dangerous_riding", "DANGEROUS_RIDING", normalizedLength);
  if (REAL_TIME_ROAD.test(normalized)) return decision("safety_stop", "real_time_road", "REAL_TIME_ROAD", normalizedLength);
  if (PRIVACY_REQUEST.test(normalized)) return decision("privacy_boundary", "privacy_request", "PRIVACY_REQUEST", normalizedLength);
  if (PROMPT_INJECTION.test(normalized)) return decision("injection_stop", "prompt_injection", "PROMPT_INJECTION", normalizedLength);
  if (SOCIAL.test(normalized)) return decision("social", "none", "SOCIAL", normalizedLength);
  if (CAPABILITIES.test(normalized)) return decision("capabilities", "none", "CAPABILITIES", normalizedLength);
  if (CURRENT_RIDE.test(normalized)) return decision("current_ride", "none", "CURRENT_RIDE", normalizedLength);
  return decision("out_of_scope", "none", "OUT_OF_SCOPE", normalizedLength);
}

export function inspectChatInput(text: unknown): ChatInputGatewayResult {
  if (typeof text !== "string") return { ok: false, code: "INVALID_INPUT", normalizedLength: 0 };
  const normalized = compact(text);
  const normalizedLength = normalized.length;
  if (!normalized || CONTROL_CHARACTERS.test(normalized)) return { ok: false, code: "INVALID_INPUT", normalizedLength };
  if (normalizedLength > CHAT_INPUT_MAX_CHARS || Buffer.byteLength(normalized, "utf8") > CHAT_INPUT_MAX_BYTES) {
    return { ok: false, code: "INPUT_TOO_LARGE", normalizedLength };
  }
  return { ok: true, text: normalized, decision: classifyChatInput(normalized) };
}

export class ChatRateLimiter {
  private readonly requests = new Map<string, number[]>();

  allow(subject: string, now = Date.now()): boolean {
    const cutoff = now - CHAT_RATE_LIMIT_WINDOW_MS;
    const recent = (this.requests.get(subject) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= CHAT_RATE_LIMIT_MAX_REQUESTS) {
      this.requests.set(subject, recent);
      return false;
    }
    recent.push(now);
    this.requests.set(subject, recent);
    return true;
  }

  clear(subject?: string): void {
    if (subject) this.requests.delete(subject);
    else this.requests.clear();
  }
}

export const chatRateLimiter = new ChatRateLimiter();

export function routeChatInput(subject: string, text: unknown, now = Date.now()): ChatInputGatewayResult {
  const inspected = inspectChatInput(text);
  if (!inspected.ok) return inspected;
  if (!chatRateLimiter.allow(subject, now)) return { ok: false, code: "RATE_LIMITED", normalizedLength: inspected.decision.normalizedLength };
  return inspected;
}
