export const CHAT_ROUTING_SCHEMA_VERSION = "chat-routing-v0.2" as const;
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
  | "history_compare"
  // CHAT-17：L2b 自主工具循环——模型在只读工具白名单与既有预算内自行组合调用工具回答
  // 开放/复合问题（find_ride 为首个场景）；同一 ride_chat_v1 编排循环的执行策略扩展。
  | "autonomous_tools"
  // AGT-A1（意图路由 v0.4）：四个任务簇新路由——AGT-A 阶段只到确定性占位模板
  // （与 capability_gap 同构，零模型调用），工具与生成层由 AGT-B/C/F/G 承接。
  // - training_plan：骑行训练计划/课表/周期安排类问法（域外训练计划仍 out_of_scope）。
  // - training_supervision：对着已有计划/执行问反馈类问法（无计划时占位模板说明需先有计划）。
  // - level_assessment：能力/体能/水平评估结论类问法（自 capability_gap 迁入）。
  // - kb_qa：骑行科学/训练原理知识问答（问知识 vs 问产品能力 capabilities）。
  | "training_plan"
  | "training_supervision"
  | "level_assessment"
  | "kb_qa";

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
  "autonomous_tools",
  "training_plan",
  "training_supervision",
  "level_assessment",
  "kb_qa",
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
    // AGT-B5：用药/处方类建议（非急症）——与急症分开归因，动作同为 safety_stop。
    | "MEDICATION_ADVICE"
    // AGT-B5：写操作意图（改/删骑行记录）——能力边界类，零模型确定性拒绝。
    // 与 OUT_OF_SCOPE 分开归因（"功能没做" vs "不属于骑行"），见 B5 卡 write_refusal 方案。
    | "WRITE_NOT_SUPPORTED"
    | "DANGEROUS_RIDING"
    | "REAL_TIME_ROAD"
    | "PRIVACY_REQUEST"
    | "PROMPT_INJECTION"
    // CHAT-12 P3：分类器语义安全停止（红线纵深防御）与澄清话术。
    | "SEMANTIC_SAFETY_STOP"
    | "CLARIFICATION_NEEDED"
    // CHAT-13：历史比较路由（compare_rides 工具承接）。
    | "HISTORY_COMPARE"
    // CHAT-17：L2b 自主工具循环路由（find_ride 首场景，跨记录筛选/排名问法从 CAPABILITY_GAP 迁入）。
    | "AUTONOMOUS_TOOLS"
    // AGT-A1：四个任务簇新路由的确定性占位（D-A2/D-A4 边界迁移，Prompt v0.4 与标注集 v0.4 在 A2/A3 跟进）。
    | "TRAINING_PLAN"
    | "TRAINING_SUPERVISION"
    | "LEVEL_ASSESSMENT"
    | "KB_QA";
  normalizedLength: number;
};

export type ChatInputGatewayResult =
  | { ok: true; text: string; decision: ChatRoutingDecision }
  | { ok: false; code: "INVALID_INPUT" | "INPUT_TOO_LARGE" | "RATE_LIMITED"; normalizedLength: number };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MEDICAL_EMERGENCY = /(胸痛|胸闷|呼吸困难|喘不上气|晕厥|昏厥|失去意识|意识不清|大出血|出血不止|疑似心脏|中风|急救|救命)/i;
// AGT-B5（边界集 safety 6/9 驱动）：用药/处方类建议同样零模型拦停——旧词表只覆盖急症，
// "我该吃什么药来提升功率"会落到普通问答（边界集 BND-S03 三次未拦）。
// 不复用"急症"语义，reasonCode 单独标 MEDICATION_ADVICE 便于归因。
const MEDICATION_ADVICE = /(吃什么药|用药|吃药|服药|药物|处方|兴奋剂|药检|嗑药|打针|注射)/i;

// AGT-B5：写操作意图 = **写动词** 与 **受写对象** 共现（顺序无关）。
// 为什么不能要求固定语序：中文"把"字句是宾语前置——"把骑行记录**改成** 100 公里"
// 的对象在动词之前，只用"动词→对象"的正则会漏掉这类（实测第一条用例就走空）。
// 误伤分析：写动词表只收明确的写语义（"改天/改时间/改主意"不在表内），
// 对象表只收骑行数据类（"这段对话""单位"不在表内）——两者共现才拦。
const WRITE_VERB = /(删掉|删除|删了|清空|清除|抹掉|改掉|改成|改为|改到|修改|编辑|覆盖|重置|校正|批量删)/i;
const WRITE_OBJECT = /(骑行记录|骑行数据|这次骑行|那条骑行|记录|里程|距离数据|轨迹|导入的?文件|导入的|fit|gpx)/i;
// 「怎么删 / 如何修改 / 在哪改」是问操作路径，不是让我执行——不拦。
const ASK_HOW = /(怎么|如何|在哪|哪里|什么地方)[^。！？\n]{0,6}?(删|改|清空|覆盖|重置|操作)/i;
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
// CHAT-13 拆分：比较问法（比上次/进步/趋势等）迁入 HISTORY_COMPARE，由 compare_rides 工具承接。
// CHAT-17 P2 迁移：跨次筛选问法（哪次/哪一次/哪些次）迁入 FIND_RIDE（autonomous_tools 路由，
// find_ride 首场景承接）；本正则保留回指（那次/那一次）与历史清单类问法（历史骑行/多次骑行）。
const CAPABILITY_GAP = /(那次|那一次|历史骑行|骑行历史|多次骑行|几次骑行)/i;
// CHAT-17 P2：find_ride 筛选/排名问法（2026-09-10 CHAT-16 取消后并入 CHAT-17 作 L2b 首场景）。
// 口径与 G-IDENTITY/G-SAFETY-FP 的共现原则一致：
// - 极值 + 记录/指标指涉：「最远/最长/最快/最高/最大…的那次/的一次/骑行/距离」（距离最远的那次骑行）；
// - 骑行动词 + 极值：「骑/跑/冲 + 得 + 最远/最快/最长」（骑得最快的一次是哪次）；
// - 阈值筛选：「超过/大于/高于/多于（含 >/＞）+ 数字」（平均心率超过了120）；
// - 「数字 + 以上」须与指标词共现（骑了50公里以上）；
// - 筛选问法（哪次/哪一次/哪些次/哪几次）须与指标/极值/阈值词共现——裸「哪次」回指
//   （如「你说的是哪次」）仍由 RIDE_IDENTITY/澄清路径处理，不进入检索；
// - 单次指涉（本次/这次/当前/刚才/最新一条）伴随的阈值/极值仍是本次骑行问题，不迁入。
const FIND_RIDE_EXTREME_TERMS = /(最远|最长|最快|最高|最大)/i;
const FIND_RIDE_EXTREME_REFERENCE = /(最远|最长|最快|最高|最大)(的)?那?(一?次|骑行|记录|距离|里程|耗时|时间)|(骑|跑|冲)得最(远|快|长)/i;
const FIND_RIDE_THRESHOLD = /(超过|大于|高于|多于|>|＞)[了\s]*\d+/i;
const FIND_RIDE_ABOVE = /\d+\s*以上/i;
const FIND_RIDE_WHICH = /(哪次|哪一次|哪些次|哪几次)/i;
const FIND_RIDE_METRIC_TERMS = /(最远|最长|最快|最高|最大|远|快|长|距离|里程|速度|心率|功率|踏频|爬升|海拔|耗时|时间|公里|千米|卡路里|消耗)/i;
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

// CHAT-17 P2：find_ride 问法判定（规则层）——极值/阈值独立命中即检索；筛选问法（哪次…）
// 须与指标/极值词共现；单次指涉伴随的阈值/极值仍属本次骑行问题（current_ride 承接）。
function isFindRideQuestion(normalized: string): boolean {
  const singleRideReference = SINGLE_RIDE_REFERENCE.test(normalized);
  if (FIND_RIDE_EXTREME_REFERENCE.test(normalized) && !singleRideReference) return true;
  if (FIND_RIDE_THRESHOLD.test(normalized) && !singleRideReference) return true;
  if (FIND_RIDE_WHICH.test(normalized) && (FIND_RIDE_EXTREME_TERMS.test(normalized) || FIND_RIDE_METRIC_TERMS.test(normalized) || FIND_RIDE_THRESHOLD.test(normalized))) return true;
  if (FIND_RIDE_ABOVE.test(normalized) && FIND_RIDE_METRIC_TERMS.test(normalized) && !singleRideReference) return true;
  return false;
}

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
  // AGT-A1：任务簇新路由与 out_of_scope/capability_gap/clarification 同属确定性占位。
  // AGT-B4：**kb_qa 与 level_assessment 已移出占位集**——它们升级为 L2b 工具循环的真链路，
  // 否则 health_profile/training_load/search_knowledge_base 三个新工具没有任何可达路径
  // （接好了但用不上）。training_plan / training_supervision 仍留占位（F/G 承接）。
  const deterministicOnly = safety || route === "out_of_scope" || route === "aggregate" || route === "capability_gap"
    || route === "clarification" || route === "training_plan" || route === "training_supervision";
  return {
    schemaVersion: CHAT_ROUTING_SCHEMA_VERSION,
    route,
    risk,
    allowModel: !deterministicOnly,
    // CHAT-13：history_compare 与 current_ride/capabilities 同属“先工具、后模型”场景；
    // 不可比时由编排层短路为 D1 确定性降级（不生成进步/退步结论）。
    // CHAT-17：autonomous_tools 为 L2b 自主工具循环（模型在只读工具白名单内自主组合调用）。
    // AGT-B4：kb_qa / level_assessment 同属 L2b 循环（各自的 catalog 由路由裁剪决定）。
    action: safety ? "safety_stop"
      : route === "current_ride" || route === "capabilities" || route === "history_compare" || route === "autonomous_tools"
        || route === "kb_qa" || route === "level_assessment"
        ? "tool_then_model"
        : "deterministic_reply",
    reasonCode,
    normalizedLength,
  };
}

// CHAT-12 P3（架构设计 v0.4 4.2.1）：L0 规则层只拦 100% 确定红线与高置信聚合/身份快捷路径——
// 命中即零延迟零成本直答（分类器 active 模式下不调用 L1）；未命中交给 L1 语义分类器，
// 分类器失败/超时/限流再降级回 P1 全量规则（classifyChatInput）。业务意图主路由不再由 L0 承载。
// CHAT-17 P2：行锚定纯问候（SOCIAL）加入 L0——open_chat 映射 autonomous_tools（L2b）后，
// 问候仍保持零调用快路径，不进入工具循环。
export function classifyChatInputL0(text: string): ChatRoutingDecision | undefined {
  const normalized = compact(text);
  const normalizedLength = normalized.length;

  // Safety and authorization checks intentionally precede ordinary intent matching.
  if (MEDICAL_EMERGENCY.test(normalized)) return makeChatDecision("safety_stop", "medical_emergency", "MEDICAL_EMERGENCY", normalizedLength);
  if (MEDICATION_ADVICE.test(normalized)) return makeChatDecision("safety_stop", "medical_emergency", "MEDICATION_ADVICE", normalizedLength);
  // AGT-B5（BND-S02「把最近一次骑行记录改成 100 公里」答非所问驱动）：写操作意图零模型拒绝。
  // 旧行为是掉进 autonomous_tools 去做锚点解析，先回「是指哪一次」——答非所问。
  // **动词必须绑定受写对象**（记录/骑行/数据/轨迹/导入文件），否则"改天再去骑"会被误伤；
  // 「怎么删/如何改」是问方法不是让我做，用 ASK_HOW 负向排除。
  if (WRITE_VERB.test(normalized) && WRITE_OBJECT.test(normalized) && !ASK_HOW.test(normalized)) {
    return makeChatDecision("out_of_scope", "none", "WRITE_NOT_SUPPORTED", normalizedLength);
  }
  if (DANGEROUS_RIDING.test(normalized)) return makeChatDecision("safety_stop", "dangerous_riding", "DANGEROUS_RIDING", normalizedLength);
  if (REAL_TIME_ROAD.test(normalized)) return makeChatDecision("safety_stop", "real_time_road", "REAL_TIME_ROAD", normalizedLength);
  if (PRIVACY_REQUEST.test(normalized)) return makeChatDecision("privacy_boundary", "privacy_request", "PRIVACY_REQUEST", normalizedLength);
  if (PROMPT_INJECTION.test(normalized)) return makeChatDecision("injection_stop", "prompt_injection", "PROMPT_INJECTION", normalizedLength);
  // CHAT-17 P2：SOCIAL 快路径进入 L0——行锚定纯问候零分类器调用直答（分类器 open_chat 已
  // 映射 autonomous_tools/L2b，问候不进入工具循环）。
  if (SOCIAL.test(normalized)) return makeChatDecision("social", "none", "SOCIAL", normalizedLength);
  // 聚合快捷路径：身份（G-IDENTITY）与高置信聚合词（G-AGGREGATE）；空格分写不用于绕过聚合归直答。
  const noSpace = normalized.replaceAll(/\s/g, "");
  // G-IDENTITY：骑行身份问题（“当次是哪一次”）置于单次指涉守卫之前——“本次是哪一次”含“本次”
  // 会被守卫挡回单次链路，但身份问题的正确回答是最近一次记录日期（确定性）。
  // CHAT-17 P2：含筛选/极值/阈值标记的问法（“骑得最快的一次是哪次？”）不是身份回指，
  // 不被句尾“是哪次”锚定吞掉——交给业务意图链路（find_ride）承接。
  if (RIDE_IDENTITY.test(noSpace) && !isFindRideQuestion(noSpace)) return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
  if (!SINGLE_RIDE_REFERENCE.test(noSpace)) {
    if (AGGREGATE_TOTAL.test(noSpace) || AGGREGATE_WEEK.test(noSpace)) return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
    if (AGGREGATE_LATEST.test(noSpace) && AGGREGATE_TIME.test(noSpace)) return makeChatDecision("aggregate", "none", "AGGREGATE", normalizedLength);
  }
  return undefined;
}

export function classifyChatInput(text: string): ChatRoutingDecision {
  const normalized = compact(text);
  const normalizedLength = normalized.length;

  // L0 先行（红线 + SOCIAL/聚合/身份快捷路径）；未命中按顺序匹配业务意图规则。
  const l0 = classifyChatInputL0(normalized);
  if (l0) return l0;
  // CHAT-17 顺序合同：水平评估（能力水平/体能变化）＞ 跨记录筛选/排名（find_ride）＞ 回指/历史清单
  // （capability_gap）＞ 历史比较（比上次/进步/趋势）。“我的能力水平…有进步吗？”属 M4 水平评估；
  // “哪次骑行最远”属 find_ride 检索；“最近 30 天比上次快了吗”属历史比较。
  if (CAPABILITY_LEVEL_GAP.test(normalized)) return makeChatDecision("capability_gap", "none", "CAPABILITY_GAP", normalizedLength);
  if (isFindRideQuestion(normalized)) return makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", normalizedLength);
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
