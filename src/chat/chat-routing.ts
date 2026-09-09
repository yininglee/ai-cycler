export const CHAT_ROUTING_SCHEMA_VERSION = "chat-routing-v0.1" as const;
export const CHAT_INPUT_MAX_CHARS = 1_200;
export const CHAT_INPUT_MAX_BYTES = 4 * 1_024;
export const CHAT_RATE_LIMIT_MAX_REQUESTS = 20;
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;

export type ChatRoute =
  | "social"
  | "current_ride"
  | "capabilities"
  | "aggregate"
  | "capability_gap"
  | "out_of_scope"
  | "safety_stop"
  | "privacy_boundary"
  | "injection_stop"
  // CHAT-12 P3：unclear 意图触发澄清话术（一等路径，零模型调用）。
  | "clarification"
  // CHAT-13：历史比较——compare_rides 只读工具 + 30 天窗口历史基线（HistoricalComparisonSnapshot v0.1）。
  | "history_compare";

// CHAT-14 P1：会话摘要网关合同（架构设计 v0.4 4.2.2 节）——白名单槽位仅含本轮问题、
// 路由枚举与可选骑乘锚点日期；不含 assistant 回复、数值或 Claim 引用（历史轮数字不得
// 成为事实来源）。数量上限与 chat-session 槽位上限一致（≤6 条，仅当前活跃对话）。
export const CHAT_SESSION_SUMMARY_LIMIT = 6;
export const CHAT_SESSION_SUMMARY_QUESTION_MAX_CHARS = 120;
// 摘要随请求传递的字节预算（6 条 × ≤120 字问题 + 路由/锚点开销），与正文限额分开计。
export const CHAT_SUMMARIES_MAX_BYTES = 3 * 1_024;

export type ChatSessionSummary = {
  kind: "session_turn";
  question: string;
  route: ChatRoute;
  rideAnchor?: string;
};

const CHAT_ROUTE_VALUES: readonly ChatRoute[] = [
  "social",
  "current_ride",
  "capabilities",
  "aggregate",
  "capability_gap",
  "out_of_scope",
  "safety_stop",
  "privacy_boundary",
  "injection_stop",
  "clarification",
  "history_compare",
];

const CHAT_ROUTE_SET = new Set<string>(CHAT_ROUTE_VALUES);
const RIDE_ANCHOR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// CHAT-14 P1：前端摘要槽位记录该轮 route 前的枚举校验（localStorage 往返防脏数据）。
export function isChatRoute(value: unknown): value is ChatRoute {
  return typeof value === "string" && CHAT_ROUTE_SET.has(value);
}

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return false;
  const composed = new Date(Date.UTC(year, month - 1, day));
  return composed.getUTCFullYear() === year && composed.getUTCMonth() === month - 1 && composed.getUTCDate() === day;
}

// CHAT-14 P1：摘要网关校验——数量 ≤6、question 非空 ≤120 字且无控制字符、route 枚举合法、
// rideAnchor 为真实日历日期（YYYY-MM-DD）、不得携带白名单外字段；任一违规整体静默丢弃
// （请求照常、行为退回无上下文基线，事件记 summariesDropped），不拒绝请求。
export function sanitizeChatSummaries(value: unknown): { summaries: ChatSessionSummary[]; dropped: boolean } {
  // 字段缺省 = 无上下文基线（正常）；显式携带但非数组（含 null）= 结构非法，整体丢弃记事件。
  if (value === undefined) return { summaries: [], dropped: false };
  if (!Array.isArray(value)) return { summaries: [], dropped: true };
  if (value.length === 0) return { summaries: [], dropped: false };
  if (value.length > CHAT_SESSION_SUMMARY_LIMIT) return { summaries: [], dropped: true };
  const summaries: ChatSessionSummary[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return { summaries: [], dropped: true };
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => key !== "kind" && key !== "question" && key !== "route" && key !== "rideAnchor")) {
      return { summaries: [], dropped: true };
    }
    if (record.kind !== "session_turn") return { summaries: [], dropped: true };
    if (typeof record.question !== "string" || !record.question || record.question.length > CHAT_SESSION_SUMMARY_QUESTION_MAX_CHARS) {
      return { summaries: [], dropped: true };
    }
    if (CONTROL_CHARACTERS.test(record.question)) return { summaries: [], dropped: true };
    if (typeof record.route !== "string" || !CHAT_ROUTE_SET.has(record.route)) return { summaries: [], dropped: true };
    if (record.rideAnchor !== undefined) {
      if (typeof record.rideAnchor !== "string" || !RIDE_ANCHOR_PATTERN.test(record.rideAnchor) || !isRealCalendarDate(record.rideAnchor)) {
        return { summaries: [], dropped: true };
      }
    }
    summaries.push({
      kind: "session_turn",
      question: record.question,
      route: record.route as ChatRoute,
      ...(record.rideAnchor !== undefined ? { rideAnchor: record.rideAnchor } : {}),
    });
  }
  return { summaries, dropped: false };
}

export type ChatRisk =
  | "none"
  | "medical_emergency"
  | "dangerous_riding"
  | "real_time_road"
  | "privacy_request"
  | "prompt_injection"
  // CHAT-12 P3：分类器语义判定的安全停止（L0 正则未覆盖的语义红线，纵深防御）。
  | "semantic_safety";

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
    | "AGGREGATE"
    | "CAPABILITY_GAP"
    | "OUT_OF_SCOPE"
    | "MEDICAL_EMERGENCY"
    | "DANGEROUS_RIDING"
    | "REAL_TIME_ROAD"
    | "PRIVACY_REQUEST"
    | "PROMPT_INJECTION"
    // CHAT-12 P3：分类器语义安全停止（红线纵深防御）与澄清话术。
    | "SEMANTIC_SAFETY_STOP"
    | "CLARIFICATION_NEEDED"
    // CHAT-13：历史比较路由（compare_rides 工具承接）。
    | "HISTORY_COMPARE";
  normalizedLength: number;
};

export type ChatInputGatewayResult =
  | { ok: true; text: string; decision: ChatRoutingDecision }
  | { ok: false; code: "INVALID_INPUT" | "INPUT_TOO_LARGE" | "RATE_LIMITED"; normalizedLength: number };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MEDICAL_EMERGENCY = /(胸痛|胸闷|呼吸困难|喘不上气|晕厥|昏厥|失去意识|意识不清|大出血|出血不止|疑似心脏|中风|急救|救命)/i;
// CHAT-12 P1（用户冻结的共现安全定义，2026-09-08）：
// - “骑行中/骑车中”仅第一人称/当前时间词紧邻才视为骑行中使用（G-SAFETY-FP：历史查询“最近的骑行中…”放行）；
// - “看手机/分心”不再作为独立触发词——“正在骑车”+“看手机”共现才拦截，而骑行状态本身已独立拦截，
//   因此裸“看手机”（历史叙述或知识提问，如“上次骑完看手机记录数据”）不再误拦截。
const DANGEROUS_RIDING = /(正在骑|边骑边|一边骑|(?:我|现在)在?骑[行车]中|刹车失灵|刹车坏|爆胎|摔倒了|摔车|无法停车)/i;
const REAL_TIME_ROAD = /(实时路况|现在路况|当前路况|封路|交通管制|红绿灯|导航|哪里安全|天气预报|现在下雨|实时天气)/i;
const PRIVACY_REQUEST = /(别人的|他人的|其他用户|另一个用户|他人数据|别人的骑行|精确位置|准确位置|家庭住址|住址|user_?id|owner_?id|账号信息)/i;
const PROMPT_INJECTION = /(忽略(之前|上面|所有)?指令|忘记(之前|上面)?指令|系统提示词|system prompt|developer message|开发者消息|显示.*提示词|泄露.*密钥|api[ _-]?key|访问令牌|token|越狱|jailbreak|不要遵守安全)/i;
const SOCIAL = /^(你好|嗨|哈喽|您好|谢谢|感谢|早上好|晚上好|在吗)[!！。,.，?？\s]*$/i;
// CHAT-12 P1：长期能力与跨次比较/筛选问题属“域内但能力不足”（水平评估 M4、历史比较 CHAT-13），
// 不进入本次骑行工具，按确定性模板回应；须置于 CAPABILITIES 之前。
// CHAT-13 拆分：比较问法（比上次/进步/趋势等）迁入 HISTORY_COMPARE，由 compare_rides 工具承接；
// 本正则仅保留跨次筛选/历史清单类问题（哪次/历史骑行/多次骑行）。
const CAPABILITY_GAP = /(哪次|哪一次|哪些次|那次|那一次|历史骑行|骑行历史|多次骑行|几次骑行)/i;
// CHAT-13：水平评估类问题（能力水平/体能变化）的比较主体是“水平/能力”——
// 属 M4 水平评估（冻结：不做水平结论/排名），即使伴随比较词也先于历史比较路由，
// 保证“我的能力水平…有进步吗？”仍走能力缺口模板（固定集 CHAT-REG-07 合同）。
// M3 收口（固定集 v0.5）：“骑行水平”从本正则移除——“骑行水平和上个月相比有提升吗？”含
// 显式比较指涉（和/与 + 上个月），按分类器标注集口径（CLS-BLIND-09）迁入 HISTORY_COMPARE，
// 由 compare_rides 工具给出真实数据对比（CHAT-REG-08 期望迁移，2026-09-10 用户批准）。
const CAPABILITY_LEVEL_GAP = /(能力水平|体能水平|水平怎么样|水平如何|体能变化)/i;
// CHAT-13：历史比较意图——“比上次/最近 30 天/有进步吗”类跨次比较问题，由 compare_rides
// 只读工具 + 30 天窗口历史基线（复用 MVP-REPEAT-01 持久历史与 HistoricalComparisonSnapshot v0.1）承接。
// 口径（与 G-IDENTITY/G-SAFETY-FP 一致的共现原则）：
// - 比较词与既往时间指涉共现（比/和/与/跟 + [我/你]? + 上次/上周/上个月/之前…）——“上次骑了多远”
//   等单次指涉不含比较词，仍走 CURRENT_RIDE；“我和朋友上次…”因“朋友”隔断不误入；
// - 既往指涉后置比较词（“上次比这次快吗”）同样命中；
// - 显式比较动词（相比/对比）与纵向变化词（进步/退步/变强/变弱/变快/变慢）、“趋势”直接命中；
// - “能力/体能水平”主语先被 CAPABILITY_LEVEL_GAP 接管，不落入本路由；“骑行水平”伴随显式
//   比较指涉（和上个月相比）时落入本路由（M3 收口迁移，见 CAPABILITY_LEVEL_GAP 注释）。
const HISTORY_COMPARE = /((比|和|与|跟)(我|你)?(上(一)?次|上周|上个月|上月|之前|以前)|(上(一)?次|前一次|上回)[^。？?！!]{0,4}(比|相比)|(相比|对比)|(有没有|是不是|感觉)?(进步|退步|变强|变弱|变快|变慢)|趋势)/i;
const CAPABILITIES = /(能力|可分析|能分析|可以分析|支持哪些|有哪些数据|可以分析什么|数据范围|能做什么)/i;
// CHAT-12 P1（G-AGGREGATE）：移除“骑行/骑了/时间”宽词（会吞掉聚合与历史查询意图），
// 只保留单次指涉与指标词；聚合问题由 AGGREGATE 路由先行接管。
const CURRENT_RIDE = /(这次|本次|当前|最近一次|上次|里程|距离|速度|心率|功率|踏频|爬升|海拔|耗时)/i;
// CHAT-12 P1：高置信聚合问题（总量/本周/最近日期）服务端确定性回答，零模型调用；
// 单次指涉词（本次/这次…）优先于聚合词，避免“这次一共骑了多远”被误判为总量问题。
const SINGLE_RIDE_REFERENCE = /(本次|这次|当前|刚才|最新一条)/;
// CHAT-12 P1（G-IDENTITY）：“当次/单次/最近一次是哪一次”是骑行身份问题——询问当前对话基于哪条记录，
// 确定性回答最近一次记录日期即可；不应落入“跨骑行的长期分析”能力缺口模板。
// 锚定句尾（“是哪(一)次(骑行)？”），跨次筛选问题（“哪次心率超过了120？”）不匹配。
export const RIDE_IDENTITY = /(?:是(?:哪一次|哪次)(?:骑行)?|(?:哪一次|哪次)骑行)\s*[？?]?\s*$/;
const AGGREGATE_TOTAL = /(累计|一共|总里程|总共|总计)/;
const AGGREGATE_WEEK = /(本周|这周|这一周)/;
const AGGREGATE_LATEST = /(最近一次|上次|上一次|最近一条)/;
const AGGREGATE_TIME = /(什么时候|何时|哪天|几号|日期|时间)/;

function compact(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ");
}

export function makeChatDecision(
  route: ChatRoute,
  risk: ChatRisk,
  reasonCode: ChatRoutingDecision["reasonCode"],
  normalizedLength: number,
): ChatRoutingDecision {
  const safety = route === "safety_stop" || route === "privacy_boundary" || route === "injection_stop";
  const deterministicOnly = safety || route === "out_of_scope" || route === "aggregate" || route === "capability_gap" || route === "clarification";
  return {
    schemaVersion: CHAT_ROUTING_SCHEMA_VERSION,
    route,
    risk,
    allowModel: !deterministicOnly,
    // CHAT-13：history_compare 与 current_ride/capabilities 同属“先工具、后模型”场景；
    // 不可比时由编排层短路为 D1 确定性降级（不生成进步/退步结论）。
    action: safety ? "safety_stop" : route === "current_ride" || route === "capabilities" || route === "history_compare" ? "tool_then_model" : "deterministic_reply",
    reasonCode,
    normalizedLength,
  };
}

// CHAT-12 P3（架构设计 v0.4 4.2.1）：L0 规则层只拦 100% 确定红线与高置信聚合/身份快捷路径——
// 命中即零延迟零成本直答（分类器 active 模式下不调用 L1）；未命中交给 L1 语义分类器，
// 分类器失败/超时/限流再降级回 P1 全量规则（classifyChatInput）。业务意图主路由不再由 L0 承载。
export function classifyChatInputL0(text: string): ChatRoutingDecision | undefined {
  const normalized = compact(text);
  const normalizedLength = normalized.length;

  // Safety and authorization checks intentionally precede ordinary intent matching.
  if (MEDICAL_EMERGENCY.test(normalized)) return makeChatDecision("safety_stop", "medical_emergency", "MEDICAL_EMERGENCY", normalizedLength);
  if (DANGEROUS_RIDING.test(normalized)) return makeChatDecision("safety_stop", "dangerous_riding", "DANGEROUS_RIDING", normalizedLength);
  if (REAL_TIME_ROAD.test(normalized)) return makeChatDecision("safety_stop", "real_time_road", "REAL_TIME_ROAD", normalizedLength);
  if (PRIVACY_REQUEST.test(normalized)) return makeChatDecision("privacy_boundary", "privacy_request", "PRIVACY_REQUEST", normalizedLength);
  if (PROMPT_INJECTION.test(normalized)) return makeChatDecision("injection_stop", "prompt_injection", "PROMPT_INJECTION", normalizedLength);
  // 聚合快捷路径：身份（G-IDENTITY）与高置信聚合词（G-AGGREGATE）；空格分写不用于绕过聚合归直答。
  const noSpace = normalized.replaceAll(/\s/g, "");
  // G-IDENTITY：骑行身份问题（“当次是哪一次”）置于单次指涉守卫之前——“本次是哪一次”含“本次”
  // 会被守卫挡回单次链路，但身份问题的正确回答是最近一次记录日期（确定性）。
  if (RIDE_IDENTITY.test(noSpace)) return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
  if (!SINGLE_RIDE_REFERENCE.test(noSpace)) {
    if (AGGREGATE_TOTAL.test(noSpace) || AGGREGATE_WEEK.test(noSpace)) return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
    if (AGGREGATE_LATEST.test(noSpace) && AGGREGATE_TIME.test(noSpace)) return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
  }
  return undefined;
}

export function classifyChatInput(text: string): ChatRoutingDecision {
  const normalized = compact(text);
  const normalizedLength = normalized.length;

  // L0 先行（红线 + 高置信聚合/身份快捷路径）；SOCIAL 为行锚定纯问候，与 L0 匹配域无交集。
  const l0 = classifyChatInputL0(normalized);
  if (l0) return l0;
  if (SOCIAL.test(normalized)) return makeChatDecision("social", "none", "SOCIAL", normalizedLength);
  // CHAT-13 顺序合同：水平评估（能力水平/体能变化）＞ 跨次筛选（哪次/历史骑行）＞ 历史比较（比上次/进步/趋势）。
  // “我的能力水平…有进步吗？”属 M4 水平评估；“最近 30 天比上次快了吗”属历史比较。
  if (CAPABILITY_LEVEL_GAP.test(normalized)) return makeChatDecision("capability_gap", "none", "CAPABILITY_GAP", normalizedLength);
  if (CAPABILITY_GAP.test(normalized)) return makeChatDecision("capability_gap", "none", "CAPABILITY_GAP", normalizedLength);
  if (HISTORY_COMPARE.test(normalized)) return makeChatDecision("history_compare", "none", "HISTORY_COMPARE", normalizedLength);
  if (CAPABILITIES.test(normalized)) return makeChatDecision("capabilities", "none", "CAPABILITIES", normalizedLength);
  if (CURRENT_RIDE.test(normalized)) return makeChatDecision("current_ride", "none", "CURRENT_RIDE", normalizedLength);
  return makeChatDecision("out_of_scope", "none", "OUT_OF_SCOPE", normalizedLength);
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
