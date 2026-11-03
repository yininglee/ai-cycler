import { hasExplicitChatRideReference, lastChatRideChoice } from "./chat-context.ts";
import { lastSummarizedAnchor } from "./chat-ride-anchor.ts";
import { activeChatCapabilities, isActiveChatTool } from "./chat-capability-registry.ts";
import { isRecentOverviewQuestion } from "./chat-routing.ts";
import {
  CHAT_COMPARISON_WINDOW_DAYS,
  CHAT_FIND_RIDE_MAX_WINDOW_DAYS,
  CHAT_KNOWLEDGE_KEYWORD_MAX_CHARS,
  CHAT_KNOWLEDGE_MAX_ENTRIES,
  CHAT_KNOWLEDGE_MAX_KEYWORDS,
  CHAT_RIDE_HISTORY_DEFAULT_WINDOW_DAYS,
  CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS,
  CHAT_ROUTE_OVERVIEW_DEFAULT_SEGMENTS,
  CHAT_ROUTE_OVERVIEW_MAX_SEGMENTS,
  CHAT_TRAINING_LOAD_WINDOW_DAYS,
  ChatToolError,
  chatComparisonMetricKeys,
  chatKnowledgeDimensionIds,
  chatToolSpecs,
  executeChatTool,
  healthProfileFields,
  isRideReferencePending,
  parseChatToolInvocation,
  rideContextDimensions,
  type ChatComparisonMetricKey,
  type ChatToolExecutionResult,
  type ChatToolInvocation,
  type ChatToolName,
  type ChatToolResult,
  type RideContextDimension,
} from "./chat-tools.ts";
import type { ChatRoutingDecision, ChatSessionSummary } from "./chat-routing.ts";
import { resolveRideAnchor, rideAnchorDate, rideAnchorDateLabel, type RideAnchorOverride } from "./chat-ride-anchor.ts";
import type { ChatRideCandidate, ChatRideRefReason } from "./chat-ride-ref.ts";
import { chatRideCandidates, parseChatRideRef } from "./chat-ride-ref.ts";
import { atomicCapabilityKeys, type AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";

export const CHAT_TOOL_ORCHESTRATION_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES = 6;

// CHAT-17 P3：L2b 自主工具循环预算；AGT-B3（D-B5 拍板 2026-10-24）重标定并**拆分**：
//   累计工具调用 5   —— 一次循环最多 5 次工具调用（原 3，装不下"检索+明细+比较"）
//   单轮上限 4       —— 同时充当**并发上限**（先全量校验再并行，见 §5.1）
//   provider 调用 6  —— 首轮 + 最多 5 次数据轮/修复轮
//   整轮 45s→60s    —— 2026-10-25 用户拍板（D-B5 变更）：单次超时提到 25s 后，25s×2 轮
//                     = 50s > 45s 会截断第二轮；60s = 2 次满额调用 + 执行余量。
//                     依据：编排第三轮 11 次 MODEL_TIMEOUT、p50 16.1s。
export const CHAT_TOOL_LOOP_MAX_TOOL_CALLS = 5;
export const CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND = 4;
export const CHAT_TOOL_LOOP_MAX_PROVIDER_CALLS = 6;
// AGT-B5（2026-10-26）：60s → 90s——单次超时提到 35s 后，复合问法需要 2~3 次调用，
  // 60s 会先卡住循环预算（这也是"工具调了但整轮超时"的来源之一）。
  export const CHAT_TOOL_LOOP_TIMEOUT_MS = 90_000;

// CHAT-17 P3：L2b 工具调用协议——模型在循环中输出的工具请求 Schema
// （最终回答仍用 ride-chat-output-v0.2；两者由编排层区分解析）。
export const CHAT_TOOL_CALL_SCHEMA_VERSION = "ride-chat-tool-call-v0.1" as const;
export const CHAT_TOOL_CATALOG_SCHEMA_VERSION = "ride-chat-tool-catalog-v0.1" as const;

export type ChatToolOrchestrationErrorCode =
  | "TOOLS_NO_CURRENT_RIDE"
  | "TOOLS_TIMEOUT"
  | "TOOLS_UNAVAILABLE"
  // CHAT-14 P2（G-RIDE-DEIXIS）：指涉无锚点时的确定性确认话术（零模型调用），
  // message 携带完整话术（含最新记录日期）。
  | "TOOLS_ANCHOR_CLARIFY";

export class ChatToolOrchestrationError extends Error {
  readonly code: ChatToolOrchestrationErrorCode;
  readonly candidates?: ChatRideCandidate[];

  constructor(code: ChatToolOrchestrationErrorCode, message?: string, candidates?: ChatRideCandidate[]) {
    super(message ?? code);
    this.name = "ChatToolOrchestrationError";
    this.code = code;
    this.candidates = candidates;
  }
}

export type ChatToolTrace = {
  tool: ChatToolName;
  status: "completed";
  dimensions?: RideContextDimension[];
  capabilityScope?: AtomicCapabilityKey[];
  comparisonMetrics?: ChatComparisonMetricKey[];
  summarySlots: number;
};

// CHAT-17 P3：L2b 循环轨迹——steps 记录每次模型请求的工具调用（含被拒绝项），
// status 为循环整体结局（completed=模型给出最终回答；budget_exhausted=预算耗尽；
// no_match/invalid_tool_call=确定性降级；failed=工具执行失败）。审计事件读取
// 该轨迹（脱敏：仅工具名/状态/错误码/耗时，不含输入输出内容）。
export type ChatToolLoopStep = {
  tool: string;
  // AGT-H1：`reference_pending` = 工具要求先指定哪一条记录（不是失败，也不是空结果）。
  status: "completed" | "rejected" | "failed" | "reference_pending";
  errorCode?: string;
  durationMs: number;
};

export type ChatToolLoopTrace = {
  kind: "autonomous_tools";
  status: "completed" | "budget_exhausted" | "no_match" | "invalid_tool_call" | "failed" | "reference_pending";
  steps: ChatToolLoopStep[];
  toolCalls: number;
  providerCalls: number;
  summarySlots: number;
  toolArgumentRepairAttempts?: number;
  evidenceRecoveryAttempts?: number;
  planProposalRepairAttempts?: number;
  // AGT-B0：被输出校验拒绝的轮次与原因码。旧实现只在修复失败时落 fallbackCode=REPAIR_FAILED，
  // 真实原因（哪条规则在拦）藏在 outputValidation.code 里且不聚合，导致"误拦率"无法量化。
  // 有了这条，才能回答"是数字太白话、还是措辞规则误伤"。
  validationRejections?: ReadonlyArray<{ providerCall: number; code: string }>;
};

// CHAT-17 P3：L2b 工具目录投影（chat_request.toolCatalog）——声明只读工具白名单、
// 各工具输入合同与默认锚点记录。目录为静态白名单 + 本轮锚点，不含任何用户数据。
export type ChatProviderToolCatalog = {
  schemaVersion: typeof CHAT_TOOL_CATALOG_SCHEMA_VERSION;
  anchorRideId: string;
  today?: string;
  timeZone?: "Asia/Shanghai";
  tools: ReadonlyArray<{
    tool: ChatToolName;
    // AGT-B5：每个工具带一句"用途 + 边界"。实测（ORCH-08「最近一次骑行的路线爬坡多吗」）
    // 模型只看到参数说明、看不到工具边界，会把"这一次的路线"读成"跨记录里爬升最大的那次"
    // 而去调 find_ride。用途边界比参数说明更能防选错工具。
    purpose: string;
    input: Record<string, unknown>;
  }>;
};

// Compatibility names only: all active data intents see the same registry.
export type ChatToolCatalogRoute = "autonomous_tools" | "kb_qa" | "level_assessment" | "none";
const activeTools = activeChatCapabilities().map(capability => capability.tool);
export const CHAT_TOOL_CATALOG_SCOPE: Record<ChatToolCatalogRoute, readonly ChatToolName[]> = {
  autonomous_tools: activeTools, kb_qa: activeTools, level_assessment: activeTools, none: [],
};

// 每个工具的模型侧输入说明（catalog 下发内容）。与 parseChatToolInvocation 的严格键集对应：
// 说明里写了"可选"的字段，由 normalizeLoopCall 补缺省值。
const CHAT_TOOL_CATALOG_INPUTS: Record<ChatToolName, Record<string, unknown>> = {
  get_training_plan_context: { version: "可选，指定本人计划历史／当前版本整数；省略读取当前草案／生效摘要。", date: "可选YYYY-MM-DD，读取所选版本该天的真实训练步骤；不存在的日期day=null，不推测日程。" },
  prepare_training_plan: {
    expectedVersion: "必填整数，取自 get_training_plan_context.state.intakeVersion；修改前先读取，不能猜版本。",
    patch: '待核对信息的部分对象。允许 goal(目标文本)、startDate/endDate(YYYY-MM-DD或null)、periodReason(周期依据)、availability:[{weekday:1至7周一至周日,minutes:15至240}]、weeklyMinutes/longestRideMinutes(分钟或null)、selfReportedBasis(用户原话基础)、powerMeter(boolean或null)、avoidDates:[YYYY-MM-DD]、healthConcern(true或null)、notes。只补用户表达和已有资料，不猜时间与基础。healthConcern=false仅用户在信息卡确认，AI不能声明无不适。没有确定周期就留null并追问；也可提出有依据、待用户核对的周期。',
  },
  propose_training_plan: {
    intakeVersion: "必填整数，当前已由用户按钮确认的 state.intakeVersion，必须等于 confirmedIntakeVersion。",
    baseVersion: "必填整数，当前 state.version；每次修改都先读取，不猜版本。",
    proposal: '必填 {rationale:中文制定依据,blocks:[{fromWeek:1,toWeek:N,sessions:[{weekday:1,kind:"endurance",minutes:30}]}]}。kind仅recovery/endurance/tempo/threshold。最多16阶段，每阶段最多6个不同weekday，阶段覆盖state.intake整个周期且不重叠；周数按开始日期所在周一计算，实际按可用日期展开。必须遵守state.constraints、availability、avoidDates；先读上下文，未确认信息不能生成。若规则拒绝，可在原预算内修正后再提出。所有结果仍是待确认草案，不能启用。',
  },
  prepare_ride_import: {},
  get_user_context: {},
  show_onboarding: {},
  prepare_goal_editor: { draft: '必填；用户尚未说明要改成什么时用 null，打开时重读当前内容。用户已明确新的目标方向时，必须传新草稿 {title,detail}，不得仍填 null 或沿用旧目标。title 为 保持规律骑行/提升耐力／完成长距离/提升 FTP/提升爬坡表现/备赛/自定义 之一，detail≤400字（自定义及备赛非空）。只准备界面，不保存。' },
  prepare_profile_proposal: { input: '必填对象；仅用户明确给出的 age/heightCm/weightKg/maxHeartRateBpm/ftpWatts 数值或明确不知道的 null；单位、多值或意图不明先追问。只准备提案，不保存。' },
  get_ride_context: {
    rideRef: "可选；缺省用本轮锚点记录。显式指定某一次时传对象，**三选一**：{\"date\":\"2026-08-20\"}（绝对日期）｜{\"ordinal\":-1}（-1=最近一次，-2=倒数第二次）｜{\"rideId\":\"…\"}（必须是本轮工具结果返回过的 rideId）",
    dims: `字符串数组（可多选）：${rideContextDimensions.join("/")}。例如平均功率用 ["power"]，平均心率用 ["heart_rate"]，距离／速度／时长用 ["summary"]；不能填写 avgPowerW 等指标名。`,
  },
  get_capabilities: {
    rideId: "可选；缺省用锚点记录，指定时必须来自本轮工具结果返回的 rideId",
    // AGT-B5（ORCH-09 三连 INVALID_TOOL_CALL 驱动）：上限原为 8，而合法能力有 18 个——
    // "最近一次骑行有哪些数据可以看"的正确答案就是**全部**，模型传 18 个反被判非法。
    // 放宽到全部（结果约 3~4KB，远低于 32KB 预算），并在说明里写明可一次传全部。
    caps: `字符串数组（可多选，**最多 ${atomicCapabilityKeys.length} 个即全部**；问"有哪些数据可看"就全传）：${atomicCapabilityKeys.join("/")}`,
  },
  compare_rides: {
    rideId: "可选；缺省用锚点记录，指定时必须来自本轮工具结果返回的 rideId",
    metrics: `字符串数组（可多选）：${chatComparisonMetricKeys.join("/")}`,
    windowDays: "可选；缺省 30（可比性口径，不放大）",
  },
  find_ride: {
    rideId: "可选；null 或未选记录时为全局检索（窗口以本人最新记录为界），显式指定时必须来自本轮工具结果返回的 rideId",
    // AGT-B5（第四个类型陷阱）：metric 是**单选字符串**——枚举候选不要再以 JSON 数组展示，
    // 模型会照抄格式传 ["distanceM"]（实测 ORCH-03/11/13/17 的 INVALID_TOOL_CALL 全来源）。
    metric: `单选字符串（只填一个，**不是数组**）：${chatComparisonMetricKeys.join("/")}`,
    mode: "单选字符串（只填一个，不是数组）：max/min/threshold",
    threshold: "threshold 模式必填（数字，严格大于）",
    metrics: `字符串数组（可多选，与 metric 不同——这是输出附加字段）：${chatComparisonMetricKeys.join("/")}；可选，缺省同 metric`,
    windowDays: `可选；1-${CHAT_FIND_RIDE_MAX_WINDOW_DAYS}，缺省 30`,
  },
  get_health_profile: {
    // 全局工具：无 rideId
    fields: `字符串数组（可多选）：${healthProfileFields.join("/")}`,
  },
  get_training_load: {
    anchorDate: "可选；YYYY-MM-DD 或 today（缺省），不得晚于今天",
    windowDays: `可选；固定 ${CHAT_TRAINING_LOAD_WINDOW_DAYS}（PMC 最小可信窗口）`,
  },
  search_knowledge_base: {
    dimensionIds: `字符串数组（可多选）：${chatKnowledgeDimensionIds.join("/")}`,
    // AGT-B4：实测（C1/C5）模型把 keywords 填成字符串 "训练区间 为什么" → 类型不合法被拒。
    // 说明必须同时讲清**类型（字符串数组）+ 与 dimensionIds 的"至少给一个"约束**。
    keywords: `字符串数组，如 ["负分割","配速"]（不是单个字符串）；可选但与 dimensionIds 至少要给一个（两者都空会被判为非法调用）；≤${CHAT_KNOWLEDGE_MAX_KEYWORDS} 个，每个 ≤${CHAT_KNOWLEDGE_KEYWORD_MAX_CHARS} 字`,
    maxEntries: `可选；1-${CHAT_KNOWLEDGE_MAX_ENTRIES}，缺省 ${CHAT_KNOWLEDGE_MAX_ENTRIES}`,
  },
  get_ride_history: {
    rideId: "可选；缺省用锚点记录；要跨记录统计时传 null（不锚定）",
    windowDays: `可选；1-${CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS}，缺省 ${CHAT_RIDE_HISTORY_DEFAULT_WINDOW_DAYS}`,
    dateRange: '与 windowDays 二选一；明确起止日期时用 {"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}，含首尾、最多365天，不限于距今365天内；此时 rideId 必须为 null，不得同时传 windowDays。不要把明确日期改成相对天数。',
    metrics: `字符串数组（可多选）：${chatComparisonMetricKeys.join("/")}`,
  },
  get_route_overview: {
    rideRef: "必填（同上三选一）；常来自 find_ride 命中结果，或用 {\"date\":\"YYYY-MM-DD\"} 指定某一天",
    segments: `可选；1-${CHAT_ROUTE_OVERVIEW_MAX_SEGMENTS}，缺省 ${CHAT_ROUTE_OVERVIEW_DEFAULT_SEGMENTS}（返回最长的 N 段爬坡）`,
  },
};

/** Compatibility adapter: every data label maps to the same active catalog. */
export function chatToolCatalogRouteOf(route: string): ChatToolCatalogRoute {
  return ["current_ride", "capabilities", "history_compare", "autonomous_tools", "kb_qa", "level_assessment"].includes(route) ? "autonomous_tools" : "none";
}

// 每个工具的用途与边界（catalog 下发给模型）。写"用来做什么 + 不要用它做什么"，
// 因为实测的选错工具都发生在边界上：单次指标 vs 单次路线 vs 跨记录检索 vs 跨记录统计。
export const CHAT_TOOL_CATALOG_PURPOSE: Record<ChatToolName, string> = {
  get_training_plan_context: "读取本人计划信息、已保存目标和资料、近期记录／自述基础、规则限制、当前草案与生效计划。制定或修改计划前先用它，不需要骑行锚点，不启用计划。",
  prepare_training_plan: "准备／补充同一份待确认计划信息及原信息卡。与聊天补缺共同维护，保存可恢复的草稿信息；不生成正式日程、不启用。信息要由用户在卡片明确核对后才能生成草案。",
  propose_training_plan: "对已由用户确认的信息生成或修改真实日程草案；AI只选择周阶段、合法类型与时长，服务端扩展步骤并经过领域规则硬门。规则失败保留原信息与原草案，可修正。草案生成不等于生效，启用只能由详情页明确按钮完成。",
  prepare_ride_import: "提供同步／导入骑行入口，用户自行选择真实 FIT/GPX 上传或明确模拟的平台。只准备入口，不代表已连接账户、已导入或已生成解读；不需要骑行锚点。",
  get_user_context: "读取本人已保存资料、来源与当前主要目标。理解目标指代和资料变更前用它核实状态；不能将历史对话当成已保存事实。无骑行记录也可用。",
  show_onboarding: "用户希望了解如何开始或补充信息时，提供资料、骑行导入和目标三个现有入口。只准备引导，不写入。",
  prepare_goal_editor: "用户希望设置或修改目标时，准备现有目标编辑抽屉。仅查看可先用 get_user_context 回答；概念问题走知识检索，歧义先结合上下文追问。draft=null 保留现有目标，不把管理命令写作目标草稿。",
  prepare_profile_proposal: "用户主动补充或更正个人资料时，生成待核对卡片；已有值由服务端读取。不能用它回答资料概念问题，不能猜单位或猜未知指标。",
  get_ride_context: "查**某一次**骑行的指标明细（功率/心率/踏频/速度/距离…）。问“这次/那次多少”用它；问“这一次**算不算**/是否符合某个特征”（算不算负分割、有没有心率漂移）也用它——对单次骑行做判断要先拿到它的指标。",
  get_capabilities: "查**数据可用性与质量**（有没有功率、心率、路线），不返回具体数值。问“能看哪些数据”用它。",
  compare_rides: "把某一次骑行与**之前窗口的基线**比较（方向 + 差值 + 样本数）。问“比平时怎么样”用它。",
  // AGT-B5（2026-10-26 回退）：曾把「最近一次/这次/那次」的反向映射写进 purpose，本意是治
  // ORCH-01/08 的误用，实测**净亏**：ORCH-01/08 各 +1（2/3→3/3），但 ORCH-11 从 1/3 → 0/3
  // （模型连「最远的是哪一次」这种真需要跨记录检索的问法也不调 find_ride 了），
  // ORCH-09 三连 INVALID_TOOL_CALL。**在 catalog 里加"不要用"的限定，会连带压制正确的用法。**
  find_ride: "在窗口内**检索/排名某一条**骑行（哪次最远、哪次平均心率超过 X）。**只做跨记录检索，不要用它查某一次的具体指标或路线形状。**",
  get_health_profile: "查用户**身体基线**（体重 / 最大心率 / FTP）。做评估、解释强度区间、算负荷前先用它取基准。",
  get_training_load: "查**训练负荷**（CTL 长期 / ATL 急性 / TSB 平衡）。问“练得多不多 / 最近状态如何”用它。",
  search_knowledge_base: "查**训练科学知识**（训练原理、区间、配速、负荷模型）。问“为什么 / 是什么原理”用它；回答必须引用返回的 knowledgeId。",
  get_ride_history: "**跨记录窗口统计**（次数 / 总里程 / 总时长 / 总爬升 + 逐条摘要）。问“最近三个月骑了多少”用它。",
  get_route_overview: "查**某一次骑行的路线形状**（爬坡/平路/下坡里程占比、最长连续爬坡段）。问“那次/这次路线爬坡多吗”用它，**不要用 find_ride**。",
};

export function buildChatToolCatalog(anchorRideId: string, route: ChatToolCatalogRoute = "autonomous_tools"): ChatProviderToolCatalog {
  return {
    schemaVersion: CHAT_TOOL_CATALOG_SCHEMA_VERSION,
    anchorRideId,
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    timeZone: "Asia/Shanghai",
    tools: (route === "none" ? [] : activeChatCapabilities()).map(({ tool }) => ({ tool, purpose: CHAT_TOOL_CATALOG_PURPOSE[tool], input: CHAT_TOOL_CATALOG_INPUTS[tool] })),
  };
}

// CHAT-17 P3：模型工具调用请求解析——{schemaVersion: ride-chat-tool-call-v0.1, calls: [{tool, input}]}。
// 只做结构校验（协议层）；工具白名单、参数合法性与锚点归属在 executeLoopCalls 内校验
// （需要锚点与允许记录集合）。非该 Schema 的输出返回 undefined，由编排层按最终回答处理。
export type ChatToolLoopCallRequest = { tool: string; input: unknown };

export function parseChatToolCallRequest(rawText: string): { calls: ChatToolLoopCallRequest[] } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return undefined;
  }
  if (!isPlainRecord(parsed) || Object.keys(parsed).length !== 2 || parsed.schemaVersion !== CHAT_TOOL_CALL_SCHEMA_VERSION || !Array.isArray(parsed.calls)) return undefined;
  if (parsed.calls.length < 1 || parsed.calls.length > CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND) return undefined;
  const calls: ChatToolLoopCallRequest[] = [];
  for (const call of parsed.calls) {
    if (!isPlainRecord(call) || Object.keys(call).length !== 2 || typeof call.tool !== "string" || !call.tool || !isPlainRecord(call.input)) return undefined;
    calls.push({ tool: call.tool, input: call.input });
  }
  return { calls };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type ChatToolContext = {
  schemaVersion: "ride-chat-tool-context-v0.1";
  question: string;
  decision: ChatRoutingDecision;
  // CHAT-14 P1：本次会话白名单摘要（经网关校验），仅供表达层指代消解投影。
  sessionSummaries: ChatSessionSummary[];
  toolResult: ChatToolResult;
};

// CHAT-14 P2：本轮解析出的骑乘锚点——记录日期（YYYY-MM-DD）+ 展示标签 + 解析来源。
// date 在记录无有效出发时间时缺省（锚点无法以日期存储，后续轮次不继承）。
export type ResolvedRideAnchor = {
  date?: string;
  dateLabel?: string;
  source: "override" | "explicit_date" | "explicit_ordinal" | "inherited" | "default_latest";
};

export type ChatToolRunResult = {
  context: ChatToolContext;
  trace: ChatToolTrace;
  resolvedAnchor?: ResolvedRideAnchor;
};

export type ChatToolRunner = {
  run(input: { text: string; decision: ChatRoutingDecision; summaries?: ChatSessionSummary[]; anchor?: RideAnchorOverride }): Promise<ChatToolRunResult>;
};

// CHAT-17 P3：L2b 循环 runner 合同——startLoop 解析锚点（owner 校验后的 rideId 由
// 编排层注入工具调用，模型与客户端不能指定记录：模型提供的 rideId 仅允许为本轮
// 工具结果返回的记录或锚点记录）；executeLoopCalls 校验并执行模型请求的调用
// （白名单/参数/锚点归属 + 单工具 2 秒/32 KB 既有预算），返回逐调用回执。
export type ChatToolLoopStartResult =
  | { ok: true; anchorRideId: string; resolvedAnchor: ResolvedRideAnchor }
  | { ok: false; code: "TOOLS_NO_CURRENT_RIDE" | "TOOLS_ANCHOR_CLARIFY" | "TOOLS_TIMEOUT" | "TOOLS_UNAVAILABLE"; reply?: string; candidates?: ChatRideCandidate[] };

export type ChatToolLoopCallReceipt =
  | { tool: ChatToolName; status: "completed"; durationMs: number; result: ChatToolResult }
  | { tool: string; status: "rejected"; errorCode: "INVALID_TOOL_CALL" | "RIDE_NOT_ALLOWED"; durationMs: number }
  | { tool: ChatToolName; status: "failed"; errorCode: "TOOLS_NO_CURRENT_RIDE" | "TOOLS_TIMEOUT" | "TOOLS_UNAVAILABLE"; durationMs: number }
  // AGT-H1：记录选择未定（同日多条 / 没这条 / 没给指涉）——不是失败，也不是"查了但没有"。
  // 循环遇到它立即以候选话术确定性收口（零模型），H2 再把候选提升为响应 choices。
  | {
    tool: ChatToolName;
    status: "reference_pending";
    durationMs: number;
    pendingStatus: "ambiguous" | "need_reference" | "not_found";
    reason: ChatRideRefReason;
    candidates: ChatRideCandidate[];
  };

export type ChatToolLoopRunner = {
  startLoop(input: { text: string; decision: ChatRoutingDecision; summaries?: ChatSessionSummary[]; anchor?: RideAnchorOverride; deferReference?: boolean }): Promise<ChatToolLoopStartResult>;
  executeLoopCalls(input: { calls: readonly ChatToolLoopCallRequest[]; anchorRideId: string; allowedRideIds: readonly string[] }): Promise<readonly ChatToolLoopCallReceipt[]>;
};

// 模型调用输入的编排层补全：锚点注入（缺省）、场景化默认值（dims/caps/metrics/windowDays）、
// 随后走 parseChatToolInvocation 的既有严格校验（白名单枚举/上限/精确键集）。
// 模型调用输入的编排层补全：锚点注入（按工具的 anchorMode）、场景化默认值
// （dims/caps/metrics/windowDays/fields/segments…）、随后走 parseChatToolInvocation
// 的既有严格校验（白名单枚举/上限/精确键集）。
//
// AGT-B0（G3）：锚点注入不再是"给所有调用塞 rideId"，而是按 spec.anchorMode：
//   required —— 缺省注入本轮锚点；显式指定时必须在本轮允许集合内
//   optional —— 同上，但允许 null（表示跨记录/不锚定某一次）
//   none     —— 全局工具，**不得携带 rideId**（携带即视为非法调用，避免歧义）
function normalizeLoopCall(call: ChatToolLoopCallRequest, anchorRideId: string, allowedRideIds: readonly string[], recentOverview = false): ChatToolInvocation | "INVALID_TOOL_CALL" | "RIDE_NOT_ALLOWED" {
  if (typeof call.tool !== "string" || !isPlainRecord(call.input)) return "INVALID_TOOL_CALL";
  const toolName = call.tool as ChatToolName;
  const spec = chatToolSpecs[toolName];
  // 未注册工具（含 B0 只落合同、catalog 未下发的 5 个新工具）直接判非法。
  if (!isActiveChatTool(call.tool) || !spec) return "INVALID_TOOL_CALL";
  const raw: Record<string, unknown> = { ...call.input };
  // AGT-H1：两个记录类工具的锚点注入改为 `rideRef`——**显式表达**"用这一条"，
  // 而不是让工具内部默默当"最新一次"处理。锚点为空（无记录）时**不注入**，
  // 让工具返回 need_reference + 候选，由上层决定怎么问。
  const anchorRefTools = call.tool === "get_ride_context" || call.tool === "get_route_overview";
  if (spec.anchorMode === "none") {
    if (raw.rideId !== undefined) return "INVALID_TOOL_CALL";
    if (raw.rideRef !== undefined) return "INVALID_TOOL_CALL";
  } else if (raw.rideRef === undefined && raw.rideId === undefined) {
    if (anchorRefTools) {
      if (anchorRideId) raw.rideRef = { rideId: anchorRideId };
    } else {
      raw.rideId = anchorRideId || (spec.anchorMode === "optional" ? null : "");
    }
  } else if (raw.rideId !== undefined && raw.rideId !== null && (typeof raw.rideId !== "string" || !allowedRideIds.includes(raw.rideId))) {
    // 迁移期糖：模型回传的 rideId 必须是本轮工具结果返回过的记录（防越权/防编造）。
    return "RIDE_NOT_ALLOWED";
  }
  if (raw.rideRef !== undefined) {
    const ref = parseChatRideRef(raw.rideRef);
    if (!ref) return "INVALID_TOOL_CALL";
    // `{date}` / `{ordinal}` 由服务端在本人记录里查，不存在越权读；`{rideId}` 与裸 rideId 同口径。
    if ("rideId" in ref && !allowedRideIds.includes(ref.rideId)) return "RIDE_NOT_ALLOWED";
  }
  if (call.tool === "get_ride_context" && raw.dims === undefined) raw.dims = ["summary"];
  if (call.tool === "get_capabilities" && raw.caps === undefined) raw.caps = ["route", "distance", "timing", "speed", "elevation", "heartRate", "power", "cadence"];
  // compare_rides 缺省 metrics 取全量白名单——与单工具编排“未提及指标取全量”同口径，
  // 让快照可比性（而非编排层猜测）决定可回答的指标。
  if (call.tool === "compare_rides") {
    if (raw.metrics === undefined) raw.metrics = [...chatComparisonMetricKeys];
    if (raw.windowDays === undefined) raw.windowDays = CHAT_COMPARISON_WINDOW_DAYS;
  }
  if (call.tool === "find_ride") {
    if (raw.windowDays === undefined) raw.windowDays = CHAT_COMPARISON_WINDOW_DAYS;
    if (raw.metrics === undefined && typeof raw.metric === "string") raw.metrics = [raw.metric];
  }
  // ---- AGT-B0：新工具的场景化默认值 ----
  if (call.tool === "get_health_profile" && raw.fields === undefined) raw.fields = [...healthProfileFields];
  if (call.tool === "get_training_load") {
    if (raw.anchorDate === undefined) raw.anchorDate = "today";
    if (raw.windowDays === undefined) raw.windowDays = CHAT_TRAINING_LOAD_WINDOW_DAYS;
  }
  if (call.tool === "search_knowledge_base") {
    if (raw.dimensionIds === undefined) raw.dimensionIds = [];
    if (raw.keywords === undefined) raw.keywords = [];
    if (raw.maxEntries === undefined) raw.maxEntries = CHAT_KNOWLEDGE_MAX_ENTRIES;
  }
  if (call.tool === "get_ride_history") {
    if (raw.dateRange !== undefined && call.input.rideId === undefined) raw.rideId = null;
    if (raw.rideId === undefined) raw.rideId = anchorRideId;
    if (recentOverview && call.input.rideId === undefined) raw.rideId = null;
    if (raw.windowDays === undefined && raw.dateRange === undefined) raw.windowDays = recentOverview ? 30 : CHAT_RIDE_HISTORY_DEFAULT_WINDOW_DAYS;
    if (raw.metrics === undefined) raw.metrics = [...chatComparisonMetricKeys];
  }
  if (call.tool === "get_route_overview" && raw.segments === undefined) {
    raw.segments = CHAT_ROUTE_OVERVIEW_DEFAULT_SEGMENTS;
  }
  // AGT-B5（首轮 Run 暴露的真缺陷）：**越界窗口钳制到上限，而不是判非法**。
  // 实测：模型把"三年前"算成 windowDays=1095 传进来 → 超 365 → INVALID_TOOL_CALL →
  // 整轮失败，用户拿到"这个查询请求不在允许范围内"。catalog 里写"1-365"没用，模型
  // 是据此自己算的。正确行为是钳到上限让工具照常返回"最近 365 天"的数据，模型据
  // 结果里的 windowDays 字段如实说明范围（比整轮失败好得多）。
  // 非整数/非正数仍交给 parseChatToolInvocation 判非法——那是真·非法输入，不该猜。
  if (typeof raw.windowDays === "number" && Number.isInteger(raw.windowDays) && raw.windowDays > 0) {
    const ceiling = call.tool === "get_ride_history"
      ? CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS
      : call.tool === "get_training_load"
        ? CHAT_TRAINING_LOAD_WINDOW_DAYS
        : CHAT_FIND_RIDE_MAX_WINDOW_DAYS; // find_ride / compare_rides 共用该上限
    if (raw.windowDays > ceiling) {
      console.log(`[chat-trace] [loop] windowDays clamped | tool=${call.tool} requested=${raw.windowDays} → ${ceiling}`);
      raw.windowDays = ceiling;
    }
  }
  try {
    return parseChatToolInvocation({ tool: call.tool, input: raw });
  } catch {
    return "INVALID_TOOL_CALL";
  }
}

function hasTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function currentRideDimensions(text: string): RideContextDimension[] {
  if (hasTerm(text, ["功率", "瓦", "w"])) return ["power"];
  if (hasTerm(text, ["心率", "心跳", "bpm"])) return ["heart_rate"];
  if (hasTerm(text, ["踏频", "转速", "rpm"])) return ["cadence"];
  if (hasTerm(text, ["爬升", "海拔", "高度"])) return ["elevation"];
  return ["summary"];
}

function capabilityScope(text: string): AtomicCapabilityKey[] {
  if (hasTerm(text, ["功率", "瓦", "w"])) return ["power", "normalizedPower"];
  if (hasTerm(text, ["心率", "心跳", "bpm"])) return ["heartRate", "maxHeartRateBaseline", "heartRateZones"];
  if (hasTerm(text, ["踏频", "转速", "rpm"])) return ["cadence"];
  if (hasTerm(text, ["爬升", "海拔", "高度"])) return ["elevation"];
  if (hasTerm(text, ["距离", "里程", "时间", "耗时", "速度"])) return ["distance", "timing", "speed"];
  return ["distance", "timing", "speed", "elevation", "heartRate", "power", "cadence", "route"];
}

// CHAT-13：比较问法 → compare_rides 指标白名单子集；未提及具体指标时取全量白名单，
// 让快照可比性（而非编排层猜测）决定哪些指标可回答。
function comparisonMetrics(text: string): ChatComparisonMetricKey[] {
  if (hasTerm(text, ["功率", "瓦"])) return ["avgPowerW"];
  if (hasTerm(text, ["心率", "心跳"])) return ["avgHeartRateBpm"];
  if (hasTerm(text, ["踏频", "转速"])) return ["avgCadenceRpm"];
  if (hasTerm(text, ["爬升", "海拔"])) return ["elevationGainM"];
  if (hasTerm(text, ["速度", "快", "慢"])) return ["avgSpeedMps"];
  if (hasTerm(text, ["距离", "里程", "远"])) return ["distanceM"];
  return [...chatComparisonMetricKeys];
}

async function withinOrchestrationTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ChatToolOrchestrationError("TOOLS_TIMEOUT")), CHAT_TOOL_ORCHESTRATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// AGT-H1：单工具链路只传具体记录（`{rideId}`），理论上不会拿到"记录选择未定"。
// 真拿到说明"先解析锚点再取数"的顺序被破坏——宁可确定性降级，也不拿错记录作答。
function expectToolResult(result: ChatToolExecutionResult): ChatToolResult {
  if (isRideReferencePending(result)) throw new ChatToolOrchestrationError("TOOLS_UNAVAILABLE");
  return result;
}

function mapToolError(error: unknown): ChatToolOrchestrationError {
  if (error instanceof ChatToolOrchestrationError) return error;
  if (error instanceof ChatToolError && error.code === "NOT_FOUND") return new ChatToolOrchestrationError("TOOLS_NO_CURRENT_RIDE");
  if (error instanceof ChatToolError && error.code === "TIMEOUT") return new ChatToolOrchestrationError("TOOLS_TIMEOUT");
  return new ChatToolOrchestrationError("TOOLS_UNAVAILABLE");
}

// CHAT-17 P3：L2b 循环 runner——startLoop 解析锚点（与 capabilities 同口径：显式日期 → 显式
// 序数 → 上下文继承 → 默认最新；开放/复合问题无指涉不澄清，检索窗口锚定最新记录）；
// executeLoopCalls 串行执行模型请求的调用，白名单外/参数非法/越权锚点的首个被拒绝调用
// 即终止（后续调用不再执行），被拒绝调用不消耗工具预算。
export function createChatToolLoopRunner(repository: ApplicationRepository, ownerId: string): ChatToolLoopRunner {
  let recentOverview = false;
  let userSource = "";
  return {
    async startLoop({ text, decision, summaries = [], anchor, deferReference = false }): Promise<ChatToolLoopStartResult> {
      userSource = [...summaries.map(summary => summary.question), text].join("\n");
      recentOverview = decision.route === "level_assessment" || isRecentOverviewQuestion(text);
      // Legacy labels only guide reference interpretation and window defaults.
      // They do not select an executor or restrict the active capability catalog.
      if (!["autonomous_tools", "kb_qa", "level_assessment", "current_ride", "capabilities", "history_compare"].includes(decision.route)) {
        return { ok: false, code: "TOOLS_UNAVAILABLE" };
      }
      try {
        return await withinOrchestrationTimeout((async () => {
          const entries = await repository.listRides(ownerId);
          // The modern Agent decides whether a question is about a ride at all.
          // Only an authorized explicit selection may become a default tool anchor.
          // Textual date/ordinal interpretation and ambiguity belong to tool calls.
          if (deferReference) {
            const choice = (anchor && "rideId" in anchor ? anchor.rideId : undefined) ?? (!hasExplicitChatRideReference(text) ? lastChatRideChoice(summaries)?.id : undefined);
            const explicit = entries.length && (anchor || hasExplicitChatRideReference(text))
              ? resolveRideAnchor({ text, route: decision.route, summaries: [], entries, override: anchor }) : undefined;
            const record = choice ? entries.find(entry => entry.record.activity.rideId === choice)?.record
              : explicit && explicit.status === "resolved" && explicit.source !== "default_latest" ? explicit.record : undefined;
            if (choice && !record && anchor) throw new ChatToolOrchestrationError("TOOLS_NO_CURRENT_RIDE");
            return { ok: true as const, anchorRideId: record?.activity.rideId ?? "", resolvedAnchor: {
              ...(record && rideAnchorDate(record.activity.startTime) ? { date: rideAnchorDate(record.activity.startTime) } : {}),
              source: record ? "override" as const : "default_latest" as const,
            } };
          }
          if (entries.length === 0) {
            // AGT-B5（边界集 no_records 3/9 抓到的真缺陷）：无骑行记录时不能一律降级——
            // 问知识库原理 / 健康档案是**全局工具**（anchorMode: "none"），本就不依赖骑行记录。
            // 只要该 route 的 catalog 里存在不依赖锚点的工具，就用**空锚点**启动循环；
            // 模型若要查"某次骑行"，注入空 rideId 后会被 parseChatToolInvocation 判非法
            // （INVALID_TOOL_CALL）——那是合理拒绝，比整轮零模型降级好得多。
            const hasAnchorFreeTool = activeChatCapabilities().some(capability => capability.spec.anchorMode === "none");
            if (!hasAnchorFreeTool) throw new ChatToolOrchestrationError("TOOLS_NO_CURRENT_RIDE");
            console.log("[chat-trace] [loop] start without anchor | no rides but catalog has anchor-free tools");
            return { ok: true as const, anchorRideId: "", resolvedAnchor: { source: "default_latest" as const } };
          }
          const resolution = resolveRideAnchor({ text, route: decision.route, summaries, entries, override: anchor });
          if (resolution.status === "clarify") throw new ChatToolOrchestrationError("TOOLS_ANCHOR_CLARIFY", resolution.reply, resolution.candidates);
          if (resolution.source === "default_latest" && !anchor && !hasExplicitChatRideReference(text) && !lastChatRideChoice(summaries) && !lastSummarizedAnchor(summaries) && /分析.*骑行|解读.*骑行|骑行.*解读/.test(text) && !recentOverview) {
            throw new ChatToolOrchestrationError("TOOLS_ANCHOR_CLARIFY", "你想分析哪一次骑行？请从记录中选择。", chatRideCandidates(entries));
          }
          return {
            ok: true as const,
            anchorRideId: resolution.record.activity.rideId,
            resolvedAnchor: {
              ...(resolution.date ? { date: resolution.date, dateLabel: rideAnchorDateLabel(resolution.date) } : {}),
              source: resolution.source,
            },
          };
        })());
      } catch (error) {
        if (error instanceof ChatToolOrchestrationError) {
          return error.code === "TOOLS_ANCHOR_CLARIFY"
            ? { ok: false, code: error.code, reply: error.message, candidates: error.candidates }
            : { ok: false, code: error.code };
        }
        return { ok: false, code: mapToolError(error).code };
      }
    },

    async executeLoopCalls({ calls, anchorRideId, allowedRideIds }): Promise<readonly ChatToolLoopCallReceipt[]> {
      // AGT-B3（§5.1）：**先全量校验再并行**。任一调用非法即整轮不执行——不在执行到
      // 一半时才发现后面那个非法，这也让"被拒即整轮终止"比旧串行实现更严格。
      const startedAt = Date.now();
      const invocations: ChatToolInvocation[] = [];
      for (const call of calls) {
        const invocation = normalizeLoopCall(call, anchorRideId, allowedRideIds, recentOverview);
        if (typeof invocation === "string") {
          return [{ tool: typeof call.tool === "string" ? call.tool : "unknown", status: "rejected", errorCode: invocation, durationMs: Date.now() - startedAt }];
        }
        invocations.push(invocation);
      }

      // 分片并发：片内并行、片间串行（片大小 = 单轮上限 = 并发上限）。
      // receipts 按**请求顺序**落位——`claim:loop:N` 编号的稳定性依赖这一点：模型引用
      // claim:loop:2:1 必须始终指向第二次请求，不能因完成先后而漂移。
      const receipts = new Array<ChatToolLoopCallReceipt>(invocations.length);
      for (let offset = 0; offset < invocations.length; offset += CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND) {
        const slice = invocations.slice(offset, offset + CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND);
        const settled = await Promise.all(slice.map(async (invocation): Promise<ChatToolLoopCallReceipt> => {
          const callStartedAt = Date.now();
          try {
            const result = await executeChatTool(repository, ownerId, invocation, userSource);
            // AGT-H1：记录选择未定 → 单独一种回执（不是失败、不是空结果），
            // 循环据此以候选话术收口，避免落进通用 no_match 话术。
            if (isRideReferencePending(result)) {
              return {
                tool: invocation.tool,
                status: "reference_pending",
                durationMs: Date.now() - callStartedAt,
                pendingStatus: result.status,
                reason: result.reason,
                candidates: result.candidates,
              };
            }
            return { tool: invocation.tool, status: "completed", durationMs: Date.now() - callStartedAt, result };
          } catch (error) {
            const code = error instanceof ChatToolError && error.code === "NOT_FOUND"
              ? "TOOLS_NO_CURRENT_RIDE"
              : error instanceof ChatToolError && error.code === "TIMEOUT"
                ? "TOOLS_TIMEOUT"
                : "TOOLS_UNAVAILABLE";
            return { tool: invocation.tool, status: "failed", errorCode: code, durationMs: Date.now() - callStartedAt };
          }
        }));
        settled.forEach((receipt, index) => {
          receipts[offset + index] = receipt;
        });
      }
      return receipts;
    },
  };
}

export function createChatToolRunner(repository: ApplicationRepository, ownerId: string): ChatToolRunner {
  return {
    async run({ text, decision, summaries = [], anchor }): Promise<ChatToolRunResult> {
      if (decision.route !== "current_ride" && decision.route !== "capabilities" && decision.route !== "history_compare") {
        throw new ChatToolOrchestrationError("TOOLS_UNAVAILABLE");
      }
      try {
        return await withinOrchestrationTimeout((async () => {
          const entries = await repository.listRides(ownerId);
          if (entries.length === 0) throw new ChatToolOrchestrationError("TOOLS_NO_CURRENT_RIDE");

          // CHAT-14 P2（G-RIDE-DEIXIS）：骑乘锚点按 4.2.2 规则解析（确认轮覆写 → 显式日期 →
          // 显式序数 → 上下文继承 → 默认最新），替代此前对全部工具调用硬编码最新一条记录；
          // 指涉无锚点时抛 TOOLS_ANCHOR_CLARIFY（确定性确认话术，零模型调用）。
          const resolution = resolveRideAnchor({ text, route: decision.route, summaries, entries, override: anchor });
          if (resolution.status === "clarify") throw new ChatToolOrchestrationError("TOOLS_ANCHOR_CLARIFY", resolution.reply, resolution.candidates);
          const currentRide = resolution.record;
          const resolvedAnchor: ResolvedRideAnchor = {
            ...(resolution.date ? { date: resolution.date, dateLabel: rideAnchorDateLabel(resolution.date) } : {}),
            source: resolution.source,
          };

          if (decision.route === "current_ride") {
            const dimensions = currentRideDimensions(text.toLowerCase());
            const toolResult = await executeChatTool(repository, ownerId, {
              tool: "get_ride_context",
              input: { rideRef: { rideId: currentRide.activity.rideId }, dims: dimensions },
            });
            // AGT-H1：锚点已在上面解析为唯一记录，`{rideId}` 必然命中——走到 pending 说明
            // 归属或解析被破坏，宁可确定性追问也不拿错记录作答。
            if (isRideReferencePending(toolResult)) throw new ChatToolOrchestrationError("TOOLS_ANCHOR_CLARIFY", "这条记录的明细暂时取不到。可以换成最近一次，或直接告诉我日期。");
            return {
              context: { schemaVersion: "ride-chat-tool-context-v0.1", question: text, decision, sessionSummaries: summaries, toolResult },
              trace: { tool: "get_ride_context", status: "completed", dimensions, summarySlots: summaries.length },
              resolvedAnchor,
            };
          }

          // CHAT-13：历史比较——锚点为本轮解析的骑乘记录，窗口冻结 30 天；
          // 不可比性由工具结果原因码承载，编排层不在此拦截。
          if (decision.route === "history_compare") {
            const metrics = comparisonMetrics(text.toLowerCase());
            const toolResult = expectToolResult(await executeChatTool(repository, ownerId, {
              tool: "compare_rides",
              input: { rideId: currentRide.activity.rideId, metrics, windowDays: CHAT_COMPARISON_WINDOW_DAYS },
            }));
            return {
              context: { schemaVersion: "ride-chat-tool-context-v0.1", question: text, decision, sessionSummaries: summaries, toolResult },
              trace: { tool: "compare_rides", status: "completed", comparisonMetrics: metrics, summarySlots: summaries.length },
              resolvedAnchor,
            };
          }

          const scope = capabilityScope(text.toLowerCase());
          const toolResult = expectToolResult(await executeChatTool(repository, ownerId, {
            tool: "get_capabilities",
            input: { rideId: currentRide.activity.rideId, caps: scope },
          }));
          return {
            context: { schemaVersion: "ride-chat-tool-context-v0.1", question: text, decision, sessionSummaries: summaries, toolResult },
            trace: { tool: "get_capabilities", status: "completed", capabilityScope: scope, summarySlots: summaries.length },
            resolvedAnchor,
          };
        })());
      } catch (error) {
        throw mapToolError(error);
      }
    },
  };
}
