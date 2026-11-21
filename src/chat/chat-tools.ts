import { executeExecutionTool, isExecutionToolResult, parseExecutionTool, executionNumericFacts, type ExecutionToolInvocation, type ExecutionToolName, type ExecutionToolResult } from "./chat-execution-tools.ts";
import {
  atomicCapabilityKeys,
  buildAtomicCapabilityProfile,
  getAtomicCapability,
  type AtomicCapabilityKey,
  type CapabilityQuality,
  type CapabilitySource,
  type CapabilityUnavailableReason,
} from "../domain/atomic-capabilities.ts";
import {
  buildHistoricalComparisonSnapshot,
  type ComparisonConclusion,
  type ComparabilityStatus,
  type ComparisonReasonCode,
  type HistoricalMetricComparison,
} from "../domain/historical-comparison.ts";
import { buildRideAnalysisContext, type AnalysisContextClaim } from "../domain/ride-analysis-context.ts";
import type { AnalysisDimensionId } from "../domain/ride-analysis-evidence-v2.ts";
import { buildRidePmcLoadV2, type RidePmcDailyLoadInput } from "../domain/ride-pmc-load-v2.ts";
import { buildRideElevationSummary } from "../domain/ride-elevation.ts";
import { buildRideRouteShapeSummary } from "../domain/ride-route-shape.ts";
import { trainingKnowledgeBase } from "../domain/training-knowledge-base.ts";
import { rideKnowledgeBaseV21 } from "../domain/ride-knowledge-base-v21.ts";
import { computeRideTss } from "../domain/ride-training-stress.ts";
import type { MetricKey, RideRecord } from "../domain/ride-schema.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { buildHistoricalRide, buildHistoricalRides } from "../persistence/persistent-history.ts";
import type { ChatNumericFact } from "./chat-numeric-evidence.ts";
import { executePlanTool, isPlanToolResult, parsePlanTool, planNumericFacts, type PlanToolInvocation, type PlanToolName, type PlanToolResult } from "./chat-plan-tools.ts";
import { historyRangeDays, parseChatHistoryDateRange, type ChatHistoryDateRange } from "./chat-history-range.ts";
import type { ChatAgentInteraction } from "./chat-interaction.ts";
import { readImportPlatforms } from "../sync/onelap-access.ts";
import { MAX_UPLOAD_BYTES } from "../parsers/parser-utils.ts";
import { executeChatUserTool, parseChatUserToolInvocation, type ChatUserToolInvocation, type ChatUserToolResult } from "./chat-user-capabilities.ts";
import {
  parseChatRideRef,
  resolveChatRideRef,
  type ChatRideCandidate,
  type ChatRideRef,
  type ChatRideRefReason,
} from "./chat-ride-ref.ts";

// AGT-B0：合同升 v0.2——新增 5 个只读工具、锚点两类（required/optional/none）、
// 证据形态声明（claims/knowledge/capabilities/none）与统一的数值证据契约。
// 工具结果结构未变（仍为脱敏 Claims 投影），版本号变更表达的是"合同集合"
// 从 4 工具扩到 9 工具，不是既有 4 个工具的字段语义变更。
//
// AGT-H1（SD-4）：记录类工具的锚点入参从 `rideId` 升级为 **`rideRef {date|ordinal|rideId}`**。
//   `rideId` 作为迁移期糖继续接受（模型会把上一轮工具结果里的 rideId 原样回传），退役归 AGT-R。
//   "未指明指哪次"不再由工具**默认取最新**——返回 `need_reference` + 候选（`RideReferencePendingToolResult`），
//   要不要默认取最新由编排层显式写 `{ordinal:-1}` 决定（可观测、可被 H2 换成"问用户"）。
export const CHAT_TOOL_SCHEMA_VERSION = "chat-tools-v0.2" as const;
export const CHAT_TOOL_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_MAX_INPUT_BYTES = 4 * 1_024;
export const CHAT_TOOL_MAX_RESULT_BYTES = 32 * 1_024;

export const rideContextDimensions = ["summary", "heart_rate", "power", "cadence", "elevation"] as const;
export type RideContextDimension = typeof rideContextDimensions[number];

// CHAT-13：compare_rides 只读工具的比较指标白名单与窗口口径。
// 窗口冻结为 30 天（MVP-REPEAT-01 持久历史口径）；更长窗口属 BX-TREND，不在本工具范围。
export const chatComparisonMetricKeys = ["distanceM", "avgSpeedMps", "avgPowerW", "avgHeartRateBpm", "avgCadenceRpm", "elevationGainM"] as const;
export type ChatComparisonMetricKey = (typeof chatComparisonMetricKeys)[number];
export const CHAT_COMPARISON_WINDOW_DAYS = 30 as const;

// CHAT-17 P1：find_ride 只读检索工具（CHAT-16 取消后并入作 L2b 首个场景）——
// 在本人记录范围内按指标枚举（比较指标白名单口径）做跨记录筛选/排名：
// 极值模式（max/min：最远/最快/最高/最短…）、阈值模式（threshold：平均心率>N 等，
// 严格大于）与窗口上限（1..30 天，编排层默认 30）。窗口以锚点记录出发时间为界
// （与 compare_rides 同口径），与比较不同：锚点本身也是候选。阈值模式命中可能多条，
// 按出发时间倒序返回并设返回条数上限；极值模式至多一条（同值取最近一次）。
export const chatFindRideModes = ["max", "min", "threshold"] as const;
export type ChatFindRideMode = (typeof chatFindRideModes)[number];
// AGT-B2（D-B1/P7 解冻）：检索宽度上限提到 365 天，**缺省仍 30 天**——
// 缺省不放大保证"哪次最远"这类问法在未明示窗口时仍按近 30 天可比范围回答，
// 只有用户/模型显式要更长窗口时才扩大（口径变更，M3 集须升版开新 Run）。
export const CHAT_FIND_RIDE_MAX_WINDOW_DAYS = 365;
export const CHAT_FIND_RIDE_MAX_MATCHES = 5 as const;

// AGT-B0：工具全集 4 → 9。前 4 个为现役（G1~G6 既有行为不变），后 5 个在 B0 只落
// 合同（输入校验 + 结果类型 + 证据声明），数据投影由 B1（全局三件）与 B2（记录两件）实现；
// 未实装前 executeChatTool 抛 TEMPORARY_UNAVAILABLE，且 catalog 不下发（模型无法调用）。
export type ChatToolName =
  | ExecutionToolName
  | PlanToolName
  | "prepare_ride_import"
  | ChatUserToolInvocation["tool"]
  | "get_ride_context"
  | "get_capabilities"
  | "compare_rides"
  | "find_ride"
  | "get_health_profile"
  | "get_training_load"
  | "search_knowledge_base"
  | "get_ride_history"
  | "get_route_overview";

// AGT-B0（G3 修复）：锚点两类——required（必须绑定一条骑行记录，缺省用本轮锚点）、
// optional（可绑定亦可全局，如跨记录窗口统计）、none（纯全局，如健康档案/知识库）。
// 旧实现给所有调用注入 rideId 并强制有记录，导致"没有骑行记录的用户问自己的 FTP"
// 连工具循环都进不去。
export type ChatToolAnchorMode = "required" | "optional" | "none";
// AGT-H1（SD-4）：`required` 的语义改写为"**必须有一条明确的引用**"——由 `rideRef` 承载
// （`{date}` / `{ordinal}` / `{rideId}`；`rideId` 裸参是迁移期糖）。旧语义"缺省即取锚点记录"
// 已下沉到编排层：要不要默认取最新，由编排层显式写 `{ordinal:-1}` 决定。

// AGT-B0（G1/G2 修复）：工具结果携带哪种可引用证据。输出校验与"全空短路"都按
// 声明判定，不再按工具名硬编码（旧 hasUsableLoopClaims 对未知工具一律 false）。
export type ChatToolEvidenceKind = "claims" | "knowledge" | "capabilities" | "none";
export type ChatToolErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "TIMEOUT" | "TEMPORARY_UNAVAILABLE";

// AGT-H1：rideRef 在 **parse 层可缺省**——"没给指涉"要在执行层变成 `need_reference` + 候选，
// 而不是被解析器判成非法调用（那会让"你想分析哪一次"这条路走不通）。
type RideContextInput = { rideRef?: ChatRideRef; dims: RideContextDimension[] };
type CapabilitiesInput = { rideId: string; caps: AtomicCapabilityKey[] };
type CompareRidesInput = { rideId: string; metrics: ChatComparisonMetricKey[]; windowDays: number };
type FindRideInputBase = { rideId: string | null; metric: ChatComparisonMetricKey; metrics: ChatComparisonMetricKey[]; windowDays: number };
export type FindRideInput = FindRideInputBase & ({ mode: "max" | "min" } | { mode: "threshold"; threshold: number });
// AGT-B0：5 个新工具的输入合同（细规划 §3.2）。一律"完整键集"——可选字段也必须在
// 调用时出现，缺省值由 normalizeLoopCall 在进入 parse 前补齐（与 compare_rides 既有模式一致），
// 这样 parseChatToolInvocation 仍是纯精确键集校验，不引入第二套省略语义。
export const healthProfileFields = ["weightKg", "maxHeartRate", "ftp"] as const;
export type HealthProfileField = (typeof healthProfileFields)[number];

// V2.1 KB 只覆盖 V2 九维度中的前 7 个（historicalPerformance / longTermLoadRecovery 无条目），
// 检索枚举按 KB 实际覆盖收窄——否则模型会请求一个永远无命中的维度。
export const chatKnowledgeDimensionIds = [
  "pacingExecution",
  "climbPerformance",
  "heartRateLoad",
  "powerOutput",
  "intensityAndTrainingLoad",
  "cadenceStrategy",
  "crossSensorCoordination",
] as const;
export type ChatKnowledgeDimensionId = (typeof chatKnowledgeDimensionIds)[number];

export const CHAT_KNOWLEDGE_MAX_ENTRIES = 3 as const;
export const CHAT_KNOWLEDGE_MAX_KEYWORDS = 5 as const;
export const CHAT_KNOWLEDGE_KEYWORD_MAX_CHARS = 32 as const;
// PMC 的最小可信窗口就是 42 天（RIDE_PMC_MIN_WINDOW_DAYS），不接受更短的自定义窗口。
export const CHAT_TRAINING_LOAD_WINDOW_DAYS = 42 as const;
export const CHAT_RIDE_HISTORY_DEFAULT_WINDOW_DAYS = 90 as const;
export const CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS = 365 as const;
// 逐条精简行的行数上限：365 天窗口可能命中上百条，全量逐条会顶到 32KB 结果上限。
// 统计（次数/里程/时长/爬升）仍按窗口全量算，只截断"逐条明细"，并在 limitations 里明示。
export const CHAT_RIDE_HISTORY_MAX_ROWS = 20 as const;
export const CHAT_ROUTE_OVERVIEW_DEFAULT_SEGMENTS = 3 as const;
export const CHAT_ROUTE_OVERVIEW_MAX_SEGMENTS = 5 as const;

type HealthProfileInput = { fields: HealthProfileField[] };
type TrainingLoadInput = { anchorDate: string; windowDays: number };
type SearchKnowledgeBaseInput = { dimensionIds: ChatKnowledgeDimensionId[]; keywords: string[]; maxEntries: number };
// rideId 为 null 表示"不锚定某一次骑行"，按窗口跨记录统计（D-B3：可选锚点）。
type RideHistoryInput = { rideId: string | null; metrics: ChatComparisonMetricKey[] } & (
  { windowDays: number; dateRange?: never } | { dateRange: ChatHistoryDateRange; windowDays?: never }
);
type RouteOverviewInput = { rideRef?: ChatRideRef; segments: number };

export type ChatToolInvocation =
  | ExecutionToolInvocation
  | PlanToolInvocation
  | { tool: "prepare_ride_import"; input: Record<string, never> }
  | ChatUserToolInvocation
  | { tool: "get_ride_context"; input: RideContextInput }
  | { tool: "get_capabilities"; input: CapabilitiesInput }
  | { tool: "compare_rides"; input: CompareRidesInput }
  | { tool: "find_ride"; input: FindRideInput }
  | { tool: "get_health_profile"; input: HealthProfileInput }
  | { tool: "get_training_load"; input: TrainingLoadInput }
  | { tool: "search_knowledge_base"; input: SearchKnowledgeBaseInput }
  | { tool: "get_ride_history"; input: RideHistoryInput }
  | { tool: "get_route_overview"; input: RouteOverviewInput };

type ChatToolClaim = Pick<AnalysisContextClaim, "claimId" | "kind" | "key" | "value" | "unit" | "confidence" | "formulaVersion" | "displayValue" | "displayUnit">;

export type RideContextToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_ride_context";
  rideId: string;
  // CHAT-15：本次骑行日期标签（Asia/Shanghai，与详情页 formatRideTitle 同口径，补年份）。
  // 投影提供与校验允许成对：模型可表述“8月17日这次骑行”，日期数字进入 current_ride 白名单。
  rideDateLabel?: string;
  dimensions: RideContextDimension[];
  claims: ChatToolClaim[];
  limitations: string[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

export type CapabilityToolItem = {
  key: AtomicCapabilityKey;
  available: boolean;
  sources: CapabilitySource[];
  qualityStatus: CapabilityQuality;
  dependencyKeys: AtomicCapabilityKey[];
  unavailableReason?: CapabilityUnavailableReason;
};

export type CapabilitiesToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_capabilities";
  rideId: string;
  capabilities: CapabilityToolItem[];
  // AGT-B5（ORCH-21「最近一次记录里有功率数据吗」3/3 NO_MATCH 驱动）：**能力可用性必须可引用**。
  // 旧实现 evidenceKind="capabilities" + hasUsableEvidence=false——模型能看到 available=[true/false]，
  // 却没有可引用的 Claim，于是 L2b 里"empty_claims"零模型降级：**这个工具一旦被调用就注定答不出**。
  // 现在每个能力一条 Claim（value=1/0，displayValue=可用/不可用），让"有没有功率数据"成为
  // 可溯源事实，而不是靠模型空口断言。
  claims: Array<{ claimId: string; kind: "metric"; key: string; value: number; unit: string; confidence: "high"; displayValue: string }>;
};

// CHAT-13：compare_rides 结果——锚点（当前记录）与 30 天窗口历史基线的比较投影。
// claimId 仅在可比时存在（领域层冻结：不可比指标不产生趋势 claim），
// 输出校验只允许模型引用可比 claim；change/relativeChangePercent 为显示空间内的舍入值，
// 模型回复中的数字必须能溯源到这些值（输出校验数字白名单）。
export type ComparisonClaimValue = { value: number; unit: string; displayValue: string };

export type CompareRidesClaim = {
  claimId?: string;
  metricKey: ChatComparisonMetricKey;
  scope: "all" | "same_route";
  status: ComparabilityStatus;
  reasonCodes: ComparisonReasonCode[];
  anchor?: ComparisonClaimValue;
  baseline?: ComparisonClaimValue & { sampleCount: number };
  change?: number;
  relativeChangePercent?: number;
};

export type CompareRidesToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "compare_rides";
  rideId: string;
  windowDays: number;
  anchorStartTime?: string;
  sampleCount: number;
  comparability: {
    status: ComparabilityStatus;
    reasonCodes: ComparisonReasonCode[];
    sampleCount: number;
    minimumSampleCount: number;
    allowedConclusion: ComparisonConclusion;
  };
  claims: CompareRidesClaim[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

// CHAT-17 P1：find_ride 结果——本人记录窗口内的跨记录筛选/排名投影。
// claimId 为 claim:find:<rideId>:<metricKey>；displayValue 与 compare_rides 共用
// 同一显示空间（COMPARISON_METRIC_FORMAT），模型引用与输出校验数字白名单同口径。
// no_match 时 matches 为空、reasonCodes 解释确定性原因（编排层零模型降级话术依据）。
export type FindRideClaim = {
  claimId: string;
  metricKey: ChatComparisonMetricKey;
  value: number;
  unit: string;
  displayValue: string;
};

export type FindRideMatch = {
  rideId: string;
  rideDateLabel?: string;
  claims: FindRideClaim[];
};

export type FindRideReasonCode = "ANCHOR_TIME_MISSING" | "METRIC_MISSING" | "THRESHOLD_NO_MATCH";

export type FindRideToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "find_ride";
  rideId: string;
  windowDays: number;
  metric: ChatComparisonMetricKey;
  mode: ChatFindRideMode;
  threshold?: number;
  status: "matched" | "no_match";
  reasonCodes: FindRideReasonCode[];
  candidateCount: number;
  matchedCount: number;
  matches: FindRideMatch[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

// ---- AGT-B0：5 个新工具的结果合同（B0 只定合同与证据，数据投影由 B1/B2 实现）----

// get_health_profile：按 P4 拍板只投影 maxHR / FTP / 体重三项 + provenance；
// 身份信息与非运动健康字段不进投影（隐私声明里显式写出，便于审计）。
export type HealthProfileFactItem = {
  // 事实也需要可引用标识——输出合同的 claimIds 只认这个前缀体系，
  // 没有 claimId 的"事实"无法通过溯源校验（会给模型留下"能说但不能引"的坑）。
  claimId: string;
  key: HealthProfileField;
  value: number;
  unit: "kg" | "bpm" | "W";
  provenance: "user_provided" | "system_estimated";
  updatedAt: string;
};

export type HealthProfileToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_health_profile";
  facts: HealthProfileFactItem[];
  limitations: string[];
  privacy: ["identity_fields_excluded", "non_sport_health_fields_excluded"];
};

// search_knowledge_base：条目 ID 是唯一引用单元（输出合同的 knowledgeIds 只认它），
// excerpt 裁到 600 字以内控 token（KB 单条 explanation 约 3KB）。
export type KnowledgeBaseItem = {
  knowledgeId: string;
  // 条目维度用领域枚举（9 维）；检索入参只开放 KB 已覆盖的 7 维（chatKnowledgeDimensionIds）——
  // 两者不同是刻意的：KB 未来扩到 9 维时，条目类型不用再改一次。
  dimensionId: AnalysisDimensionId;
  topic: string;
  title: string;
  conclusionStrength: "high" | "moderate" | "limited";
  limitations: string[];
  excerpt: string;
  sources?: readonly { label: string; url: string }[];
};

export type KnowledgeSearchToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "search_knowledge_base";
  status: "matched" | "no_match";
  dimensionIds: ChatKnowledgeDimensionId[];
  keywords: string[];
  // 未命中时回传可用维度清单，让模型能改问而不是编造条目。
  availableDimensionIds: ChatKnowledgeDimensionId[];
  items: KnowledgeBaseItem[];
  privacy: ["public_knowledge_only"];
};

// get_training_load：CTL/ATL/TSB 由 ride-pmc-load-v2 计算，工具只投影；
// 四类 unavailable 原因必须原样回传（模型不得自行估算 TSS/CTL）。
export type TrainingLoadUnavailableReason =
  | "FTP_NOT_CONFIRMED"
  | "NO_TSS_HISTORY"
  | "INSUFFICIENT_WINDOW"
  | "INSUFFICIENT_LOAD_DAYS"
  | "INVALID_INPUT";

export type TrainingLoadToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_training_load";
  status: "available" | "unavailable";
  reason?: TrainingLoadUnavailableReason;
  anchorDate: string;
  windowDays: number;
  loadDays: number;
  // AGT-B5（第 15 个缺陷，ORCH-05/16 驱动）：**被跳过的记录数必须可引用**。
  // 这些数字原本只以 `rides_without_tss:<reason>:<count>` 的字符串形式进 limitations，
  // 模型读得到文字、写出来却不在数字白名单 → 说"有 4 次因缺功率未计入"就被判越权。
  // 结构化后既进 numericFacts，也让前端/日志能直接读。
  ridesWithoutTss: Array<{ reason: string; count: number }>;
  ctl?: number;
  atl?: number;
  tsb?: number;
  claims: ChatToolClaim[];
  limitations: string[];
  privacy: ["none"];
};

// get_ride_history：跨记录窗口聚合（缺省 90 天、上限 365）。汇总数字进 claims，
// 逐条记录只给日期标签与指标（复用 find_ride 的显示空间）。
export type RideHistoryRow = {
  rideId: string;
  rideDateLabel?: string;
  claims: FindRideClaim[];
};

export type RideHistoryToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_ride_history";
  windowDays: number;
  windowStartDate?: string;
  windowEndDate?: string;
  anchorStartTime?: string;
  status: "matched" | "no_match";
  reasonCodes: ("NO_RIDES_IN_WINDOW" | "METRIC_MISSING")[];
  rideCount: number;
  claims: ChatToolClaim[];
  rows: RideHistoryRow[];
  // AGT-B2：逐条行被截断时的说明（`rows_truncated:20/57`）——统计仍按窗口全量算。
  limitations: string[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

// get_route_overview：只给里程区间与坡度概要，精坐标仍排除（沿用既有隐私口径）。
// AGT-B2：除"最长连续爬坡段"外增加 `climbs[]`——`segments` 入参控制返回几段（1..5），
// `longestClimb` 恒为第一段（保持 B0 定义的最小形状可用）。
export type RouteOverviewToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_route_overview";
  rideId: string;
  isAvailable: boolean;
  climbDistanceM?: number;
  flatDistanceM?: number;
  descentDistanceM?: number;
  longestClimb?: { startDistanceM: number; endDistanceM: number; distanceM: number };
  climbs: Array<{ startDistanceM: number; endDistanceM: number; distanceM: number }>;
  claims: ChatToolClaim[];
  limitations: string[];
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"];
};

export type ChatToolResult =
  | ExecutionToolResult
  | PlanToolResult
  | RideImportToolResult
  | ChatUserToolResult
  | RideContextToolResult
  | CapabilitiesToolResult
  | CompareRidesToolResult
  | FindRideToolResult
  | HealthProfileToolResult
  | TrainingLoadToolResult
  | KnowledgeSearchToolResult
  | RideHistoryToolResult
  | RouteOverviewToolResult;

export type RideImportToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "prepare_ride_import";
  mode: "real_file_simulated_platform" | "real_file_live_onelap";
  platforms: Awaited<ReturnType<typeof readImportPlatforms>>;
  fileFormats: string[];
  maxFileSizeMB: number;
  claims: ChatToolClaim[];
  interaction: ChatAgentInteraction;
};

// AGT-H1：「记录选择未定」不是一个错误，而是一个**确定的回答**——"我需要你先选一条"。
// 它区别于三类既有结果：没有 Claims（无从校验数字）、不是降级降级码（不是服务失败）、
// 也不是空结果（`no_match` 表示"查了但没有"）。候选随结果返回，H2 直接投成 choices。
export type RideReferencePendingToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_ride_context" | "get_route_overview";
  status: "ambiguous" | "need_reference" | "not_found";
  reason: ChatRideRefReason;
  candidates: ChatRideCandidate[];
  limitations: string[];
};

/** 执行层返回：正常结果，或"请先指定哪一条记录"。 */
export type ChatToolExecutionResult = ChatToolResult | RideReferencePendingToolResult;

// 判别式：`candidates` 只在 pending 结果里出现（其余结果即便有 status 字段也不带候选）。
export function isRideReferencePending(result: ChatToolExecutionResult): result is RideReferencePendingToolResult {
  return (result.tool === "get_ride_context" || result.tool === "get_route_overview") && "candidates" in result;
}

export class ChatToolError extends Error {
  readonly code: ChatToolErrorCode;

  constructor(code: ChatToolErrorCode) {
    super(code);
    this.code = code;
  }
}

const DIMENSION_METRICS: Record<RideContextDimension, MetricKey[]> = {
  summary: ["distanceM", "elapsedTimeS", "movingTimeS", "avgSpeedMps", "maxSpeedMps"],
  heart_rate: ["avgHeartRateBpm", "maxHeartRateBpm"],
  power: ["avgPowerW", "maxPowerW", "normalizedPowerW"],
  cadence: ["avgCadenceRpm", "maxCadenceRpm"],
  elevation: ["elevationGainM"],
};

const DIMENSION_FEATURES: Record<RideContextDimension, string[]> = {
  summary: ["speed"],
  heart_rate: ["heartRate"],
  power: ["power"],
  cadence: ["cadence"],
  elevation: ["elevation"],
};

const DIMENSION_CAPABILITIES: Record<RideContextDimension, AtomicCapabilityKey[]> = {
  summary: ["distance", "timing", "speed"],
  heart_rate: ["heartRate"],
  power: ["power", "normalizedPower"],
  cadence: ["cadence"],
  elevation: ["elevation"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validRideId(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 128;
}

// AGT-H1：记录类工具的锚点入参——`rideRef`（新合同）与 `rideId`（迁移期糖）**必须恰好给一个**。
// 两者都给时无法判断"日期与 id 不一致该听谁的"，一律判非法，不猜。
type ToolRideReferenceParse =
  | { ok: true; rideRef?: ChatRideRef }
  | { ok: false };

function parseToolRideReference(input: Record<string, unknown>): ToolRideReferenceParse {
  const hasRef = input.rideRef !== undefined;
  const hasLegacy = input.rideId !== undefined;
  // 两者同给无法判断听谁的 → 非法。都不给是合法的"未指明"（执行层返回 need_reference）。
  if (hasRef && hasLegacy) return { ok: false };
  if (hasRef) {
    const ref = parseChatRideRef(input.rideRef);
    return ref ? { ok: true, rideRef: ref } : { ok: false };
  }
  if (hasLegacy) {
    return validRideId(input.rideId) ? { ok: true, rideRef: { rideId: input.rideId } } : { ok: false };
  }
  return { ok: true };
}

// 键集校验的变体：required 必现，其余键必须落在 allowed 内（用于"二选一"的锚点入参）。
function hasKeysWithin(value: Record<string, unknown>, required: string, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.includes(required) && keys.every((key) => allowed.includes(key));
}

function uniqueEnumValues<T extends string>(value: unknown, allowed: readonly T[], maximum: number): value is T[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximum
    && value.every((item): item is T => typeof item === "string" && allowed.includes(item as T))
    && new Set(value).size === value.length;
}

function validWindowDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365;
}

// CHAT-17 P1：find_ride 输入校验——窗口上限冻结 30 天（与比较口径一致）；
// threshold 仅在 threshold 模式下允许出现（hasExactKeys 按模式区分键集）且必须为有限数。
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function validFindRideWindowDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CHAT_FIND_RIDE_MAX_WINDOW_DAYS;
}

function validThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---- AGT-B0：新工具输入校验辅助 ----

// 可选锚点：null 表示"不锚定某一次骑行"（跨记录窗口统计），否则必须是合法 rideId。
function validNullableRideId(value: unknown): value is string | null {
  return value === null || validRideId(value);
}

// 训练负荷锚定日：只能是 "today"（由 normalize 缺省注入）或真实日历日。
function validAnchorDate(value: unknown): value is string {
  return value === "today"
    || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));
}

function validKeywords(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= CHAT_KNOWLEDGE_MAX_KEYWORDS
    && value.every((item): item is string =>
      typeof item === "string" && item.length > 0 && item.length <= CHAT_KNOWLEDGE_KEYWORD_MAX_CHARS && item.trim() === item)
    && new Set(value).size === value.length;
}

// 维度检索与关键词检索至少给一个，否则等于"无检索条件"——不让这种调用进执行层。
function validKnowledgeDimensionIds(value: unknown): value is ChatKnowledgeDimensionId[] {
  return Array.isArray(value)
    && value.length <= chatKnowledgeDimensionIds.length
    && value.every((item): item is ChatKnowledgeDimensionId => typeof item === "string" && chatKnowledgeDimensionIds.includes(item as ChatKnowledgeDimensionId))
    && new Set(value).size === value.length;
}

function validMaxEntries(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CHAT_KNOWLEDGE_MAX_ENTRIES;
}

function validRideHistoryWindowDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS;
}

function validTrainingLoadWindowDays(value: unknown): value is number {
  return value === CHAT_TRAINING_LOAD_WINDOW_DAYS;
}

function validSegments(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CHAT_ROUTE_OVERVIEW_MAX_SEGMENTS;
}

export function parseChatToolInvocation(value: unknown): ChatToolInvocation {
  if (!isPlainObject(value) || !hasExactKeys(value, ["tool", "input"]) || !isPlainObject(value.input)) throw new ChatToolError("INVALID_INPUT");
  const executionCall = parseExecutionTool(value.tool, value.input);
  if (executionCall) return executionCall;
  const userCall = parseChatUserToolInvocation(value.tool, value.input);
  if (userCall) return userCall;
  try { const planCall = parsePlanTool(value.tool, value.input); if (planCall) return planCall; } catch { throw new ChatToolError("INVALID_INPUT"); }
  if (value.tool === "prepare_ride_import" && hasExactKeys(value.input, [])) return { tool: value.tool, input: {} };
  if (value.tool === "get_ride_context") {
    const input = value.input;
    const reference = parseToolRideReference(input);
    if (
      !reference.ok
      || !hasKeysWithin(input, "dims", ["rideRef", "rideId", "dims"])
      || !uniqueEnumValues(input.dims, rideContextDimensions, rideContextDimensions.length)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { ...(reference.rideRef ? { rideRef: reference.rideRef } : {}), dims: input.dims } };
  }
  if (value.tool === "get_capabilities") {
    if (!hasExactKeys(value.input, ["rideId", "caps"]) || !validRideId(value.input.rideId) || !uniqueEnumValues(value.input.caps, atomicCapabilityKeys, atomicCapabilityKeys.length)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, caps: value.input.caps } };
  }
  if (value.tool === "compare_rides") {
    if (
      !hasExactKeys(value.input, ["rideId", "metrics", "windowDays"])
      || !validRideId(value.input.rideId)
      || !uniqueEnumValues(value.input.metrics, chatComparisonMetricKeys, chatComparisonMetricKeys.length)
      || !validWindowDays(value.input.windowDays)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, metrics: value.input.metrics, windowDays: value.input.windowDays } };
  }
  if (value.tool === "find_ride") {
    const mode = value.input.mode;
    const expectedKeys = mode === "threshold"
      ? ["rideId", "metric", "mode", "threshold", "metrics", "windowDays"]
      : ["rideId", "metric", "mode", "metrics", "windowDays"];
    if (
      !hasExactKeys(value.input, expectedKeys)
      || !validNullableRideId(value.input.rideId)
      || !enumValue(value.input.metric, chatComparisonMetricKeys)
      || !enumValue(mode, chatFindRideModes)
      || !uniqueEnumValues(value.input.metrics, chatComparisonMetricKeys, chatComparisonMetricKeys.length)
      || !validFindRideWindowDays(value.input.windowDays)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    if (mode === "threshold") {
      if (!validThreshold(value.input.threshold)) throw new ChatToolError("INVALID_INPUT");
      return { tool: value.tool, input: { rideId: value.input.rideId, metric: value.input.metric, mode, threshold: value.input.threshold, metrics: value.input.metrics, windowDays: value.input.windowDays } };
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, metric: value.input.metric, mode, metrics: value.input.metrics, windowDays: value.input.windowDays } };
  }
  // ---- AGT-B0：5 个新工具的输入分支（纯合同，执行由 B1/B2 填）----
  if (value.tool === "get_health_profile") {
    if (!hasExactKeys(value.input, ["fields"]) || !uniqueEnumValues(value.input.fields, healthProfileFields, healthProfileFields.length)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { fields: value.input.fields } };
  }
  if (value.tool === "get_training_load") {
    if (
      !hasExactKeys(value.input, ["anchorDate", "windowDays"])
      || !validAnchorDate(value.input.anchorDate)
      || !validTrainingLoadWindowDays(value.input.windowDays)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { anchorDate: value.input.anchorDate, windowDays: value.input.windowDays } };
  }
  if (value.tool === "search_knowledge_base") {
    if (
      !hasExactKeys(value.input, ["dimensionIds", "keywords", "maxEntries"])
      || !validKnowledgeDimensionIds(value.input.dimensionIds)
      || !validKeywords(value.input.keywords)
      || !validMaxEntries(value.input.maxEntries)
      // 维度与关键词都空 = 无检索条件，直接视为非法调用（不让空查询进执行层）。
      || (value.input.dimensionIds.length === 0 && value.input.keywords.length === 0)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return {
      tool: value.tool,
      input: { dimensionIds: value.input.dimensionIds, keywords: value.input.keywords, maxEntries: value.input.maxEntries },
    };
  }
  if (value.tool === "get_ride_history") {
    if (hasExactKeys(value.input, ["rideId", "dateRange", "metrics"])) {
      const dateRange = parseChatHistoryDateRange(value.input.dateRange);
      if (value.input.rideId !== null || !dateRange || !uniqueEnumValues(value.input.metrics, chatComparisonMetricKeys, chatComparisonMetricKeys.length)) throw new ChatToolError("INVALID_INPUT");
      return { tool: value.tool, input: { rideId: null, dateRange, metrics: value.input.metrics } };
    }
    if (
      !hasExactKeys(value.input, ["rideId", "windowDays", "metrics"])
      || !validNullableRideId(value.input.rideId)
      || !validRideHistoryWindowDays(value.input.windowDays)
      || !uniqueEnumValues(value.input.metrics, chatComparisonMetricKeys, chatComparisonMetricKeys.length)
    ) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, windowDays: value.input.windowDays, metrics: value.input.metrics } };
  }
  if (value.tool === "get_route_overview") {
    const input = value.input;
    const reference = parseToolRideReference(input);
    if (!reference.ok || !hasKeysWithin(input, "segments", ["rideRef", "rideId", "segments"]) || !validSegments(input.segments)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { ...(reference.rideRef ? { rideRef: reference.rideRef } : {}), segments: input.segments } };
  }
  throw new ChatToolError("INVALID_INPUT");
}

async function withinToolTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ChatToolError("TIMEOUT")), CHAT_TOOL_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function enforceResultSize<T extends ChatToolResult>(result: T): T {
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > CHAT_TOOL_MAX_RESULT_BYTES) throw new ChatToolError("TEMPORARY_UNAVAILABLE");
  return result;
}

function publicClaim(claim: AnalysisContextClaim): ChatToolClaim {
  return {
    claimId: claim.claimId,
    kind: claim.kind,
    key: claim.key,
    confidence: claim.confidence,
    ...(claim.value !== undefined ? { value: claim.value } : {}),
    ...(claim.unit ? { unit: claim.unit } : {}),
    ...(claim.formulaVersion ? { formulaVersion: claim.formulaVersion } : {}),
    ...(claim.displayValue ? { displayValue: claim.displayValue } : {}),
    ...(claim.displayUnit ? { displayUnit: claim.displayUnit } : {}),
  };
}

// CHAT-13：比较指标的显示空间（单位换算 + 舍入口径）——模型引用与输出校验数字白名单
// 都基于这里的 displayValue/change/relativeChangePercent，避免原始浮点漂移进入回复。
const COMPARISON_METRIC_FORMAT: Record<ChatComparisonMetricKey, { unit: string; display: (value: number) => string; round: (value: number) => number }> = {
  distanceM: { unit: "km", display: (value) => (value / 1_000).toFixed(1), round: (value) => Math.round(value / 100) / 10 },
  avgSpeedMps: { unit: "km/h", display: (value) => (value * 3.6).toFixed(1), round: (value) => Math.round(value * 36) / 10 },
  avgPowerW: { unit: "W", display: (value) => String(Math.round(value)), round: Math.round },
  avgHeartRateBpm: { unit: "bpm", display: (value) => String(Math.round(value)), round: Math.round },
  avgCadenceRpm: { unit: "rpm", display: (value) => String(Math.round(value)), round: Math.round },
  elevationGainM: { unit: "m", display: (value) => String(Math.round(value)), round: Math.round },
};

// CHAT-17 P3：比较指标显示空间格式化（确定性降级话术用）——与 Claims displayValue 同口径，
// 编排层生成的服务端话术可用该值（服务端模板不经模型输出校验，但保持同一显示空间）。
export function formatChatMetricValue(metricKey: ChatComparisonMetricKey, value: number): string {
  return COMPARISON_METRIC_FORMAT[metricKey].display(value);
}

function comparisonClaim(metric: HistoricalMetricComparison, scope: "all" | "same_route"): CompareRidesClaim {
  const format = COMPARISON_METRIC_FORMAT[metric.metricKey as ChatComparisonMetricKey];
  const anchor = metric.anchor && format
    ? { value: metric.anchor.value, unit: format.unit, displayValue: format.display(metric.anchor.value) }
    : metric.anchor
      ? { value: metric.anchor.value, unit: metric.anchor.unit, displayValue: String(metric.anchor.value) }
      : undefined;
  const baseline = metric.baseline && format
    ? { value: metric.baseline.value, unit: format.unit, displayValue: format.display(metric.baseline.value), sampleCount: metric.baseline.sampleCount }
    : metric.baseline
      ? { value: metric.baseline.value, unit: metric.baseline.unit, displayValue: String(metric.baseline.value), sampleCount: metric.baseline.sampleCount }
      : undefined;
  // CHAT-13：change 为显示空间内的舍入值——round 的输入是原始单位差值（m、m/s、W…），
  // 由各指标的 round 口径换算舍入到显示空间（km、km/h、W…），避免显示值二次换算。
  const change = anchor && baseline
    ? format
      ? format.round(anchor.value - baseline.value)
      : Math.round((Number(anchor.displayValue) - Number(baseline.displayValue)) * 10) / 10
    : undefined;
  // CHAT-13 契约保持：**claimId 仅可比时存在**（不可比不产生可引用趋势 claim）。
  // AGT-B5 曾试过给不可比 claim 合成 id 让模型解释原因，结论是**不能这么做**：
  // ① 破坏"首骑不可比无 claimId"的既有契约（CHAT-13 D1 测试立刻失败）；
  // ② 放开后模型会把不可比答成「完全一致」并编造「相同路线」（幻觉方向）。
  // 不可比的说明改由 chat-agent 的零模型话术 comparisonNotComparableReply 承担。
  return {
    ...(metric.claimIds.length > 0 ? { claimId: metric.claimIds[0] } : {}),
    metricKey: metric.metricKey as ChatComparisonMetricKey,
    scope,
    status: metric.comparability.status,
    reasonCodes: [...metric.comparability.reasonCodes],
    ...(anchor ? { anchor } : {}),
    ...(baseline ? { baseline } : {}),
    ...(change !== undefined ? { change } : {}),
    ...(metric.relativeChange !== undefined && change !== undefined ? { relativeChangePercent: Math.round(metric.relativeChange * 1_000) / 10 } : {}),
  };
}

function projectComparisonSnapshot(snapshot: ReturnType<typeof buildHistoricalComparisonSnapshot>): CompareRidesToolResult {
  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "compare_rides",
    rideId: snapshot.anchorRideId,
    windowDays: snapshot.range.windowDays,
    ...(snapshot.range.endTime ? { anchorStartTime: snapshot.range.endTime } : {}),
    sampleCount: snapshot.sampleCount,
    comparability: {
      status: snapshot.comparability.status,
      reasonCodes: [...snapshot.comparability.reasonCodes],
      sampleCount: snapshot.comparability.sampleCount,
      minimumSampleCount: snapshot.comparability.minimumSampleCount,
      allowedConclusion: snapshot.comparability.allowedConclusion,
    },
    claims: [
      ...snapshot.metrics.map((metric) => comparisonClaim(metric, "all")),
      ...snapshot.sameRoute.metrics.map((metric) => comparisonClaim(metric, "same_route")),
    ],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

async function ownedRide(repository: ApplicationRepository, ownerId: string, rideId: string) {
  const record = await repository.getRide(ownerId, rideId);
  if (!record) throw new ChatToolError("NOT_FOUND");
  return record;
}

// CHAT-15：骑行日期标签——与 UI formatRideTitle 同口径（Asia/Shanghai 月/日）并补年份；
// 不提供出发时刻（UTC→本地换算易误导，且非必要），无有效开始时间时不生成。
function formatRideDateLabel(startTime: string | undefined): string | undefined {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return undefined;
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(startTime));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}年${month}月${day}日` : undefined;
}

// CHAT-17 P1：find_ride 指标取值——只接受 qualityStatus=valid 的有限值（低置信/降级
// 指标不参与筛选与排名，与比较工具的有效值口径一致）。
function findRideMetricValue(record: RideRecord, metricKey: ChatComparisonMetricKey): number | undefined {
  const metric = record.activity.metrics[metricKey];
  return metric && metric.qualityStatus === "valid" && Number.isFinite(metric.value) ? metric.value : undefined;
}

function parseStartTime(startTime: string | undefined): number | undefined {
  if (!startTime) return undefined;
  const parsed = Date.parse(startTime);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findRideClaim(rideId: string, metricKey: ChatComparisonMetricKey, value: number): FindRideClaim {
  const format = COMPARISON_METRIC_FORMAT[metricKey];
  return { claimId: `claim:find:${rideId}:${metricKey}`, metricKey, value, unit: format.unit, displayValue: format.display(value) };
}

// CHAT-17 P1：find_ride 执行——窗口以锚点出发时间为界（含锚点；与 compare_rides 的
// 锚点排除口径不同），owner 隔离由 listRides 保证。极值同值取最近一次（再按 rideId
// 稳定排序）；阈值模式严格大于、按出发时间倒序、返回条数设上限（matchedCount 为
// 命中总数）。筛选指标的有效值始终进入命中记录的 claims（枚举指标缺失时不生成）。
function buildFindRideResult(anchor: RideRecord, records: RideRecord[], input: FindRideInput): FindRideToolResult {
  const base: Omit<FindRideToolResult, "status" | "reasonCodes" | "candidateCount" | "matchedCount" | "matches"> = {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "find_ride",
    rideId: anchor.activity.rideId,
    windowDays: input.windowDays,
    metric: input.metric,
    mode: input.mode,
    ...(input.mode === "threshold" ? { threshold: input.threshold } : {}),
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
  const anchorTime = parseStartTime(anchor.activity.startTime);
  if (anchorTime === undefined) {
    return { ...base, status: "no_match", reasonCodes: ["ANCHOR_TIME_MISSING"], candidateCount: 0, matchedCount: 0, matches: [] };
  }
  const windowStart = anchorTime - input.windowDays * 86_400_000;
  const candidates = records
    .map((record) => ({ record, time: parseStartTime(record.activity.startTime) }))
    .filter((entry): entry is { record: RideRecord; time: number } => entry.time !== undefined && entry.time <= anchorTime && entry.time >= windowStart);
  const valued = candidates
    .map((entry) => ({ ...entry, value: findRideMetricValue(entry.record, input.metric) }))
    .filter((entry): entry is { record: RideRecord; time: number; value: number } => entry.value !== undefined);
  if (valued.length === 0) {
    return { ...base, status: "no_match", reasonCodes: ["METRIC_MISSING"], candidateCount: candidates.length, matchedCount: 0, matches: [] };
  }
  const reportMetrics = [...new Set([input.metric, ...input.metrics])];
  const toMatch = (entry: { record: RideRecord }): FindRideMatch => {
    const dateLabel = formatRideDateLabel(entry.record.activity.startTime);
    const claims = reportMetrics
      .map((metricKey) => {
        const value = findRideMetricValue(entry.record, metricKey);
        return value === undefined ? undefined : findRideClaim(entry.record.activity.rideId, metricKey, value);
      })
      .filter((claim): claim is FindRideClaim => claim !== undefined);
    return {
      rideId: entry.record.activity.rideId,
      ...(dateLabel ? { rideDateLabel: dateLabel } : {}),
      claims,
    };
  };
  if (input.mode === "threshold") {
    const matched = valued.filter((entry) => entry.value > input.threshold);
    if (matched.length === 0) {
      return { ...base, status: "no_match", reasonCodes: ["THRESHOLD_NO_MATCH"], candidateCount: candidates.length, matchedCount: 0, matches: [] };
    }
    matched.sort((a, b) => b.time - a.time || (a.record.activity.rideId < b.record.activity.rideId ? -1 : 1));
    return { ...base, status: "matched", reasonCodes: [], candidateCount: candidates.length, matchedCount: matched.length, matches: matched.slice(0, CHAT_FIND_RIDE_MAX_MATCHES).map(toMatch) };
  }
  const extreme = valued.reduce((best, entry) => {
    const better = input.mode === "max" ? entry.value > best.value : entry.value < best.value;
    const tieBreak = entry.value === best.value && (entry.time > best.time || (entry.time === best.time && entry.record.activity.rideId < best.record.activity.rideId));
    return better || tieBreak ? entry : best;
  });
  return { ...base, status: "matched", reasonCodes: [], candidateCount: candidates.length, matchedCount: 1, matches: [toMatch(extreme)] };
}

// ---- AGT-B0：工具规格表（合同单一事实源）----
//
// 三处逻辑过去各自按工具名硬编码——`hasUsableLoopClaims`（全空短路）、
// `numericValues`/`comparisonNumericValues`/`loopNumbersAreSupported`（数字白名单）、
// `normalizeLoopCall`（锚点注入）。新工具接入时这三处都会漏改，因此收敛成一张表：
// 加工具只改这里 + parse 分支 + 执行分支，不再靠"记得改另一处"。
export type ChatToolSpec = {
  anchorMode: ChatToolAnchorMode;
  evidenceKind: ChatToolEvidenceKind;
  /** 该结果里可被引用的 Claim ID（输出合同 claimIds 的合法集合）。 */
  claimIds: (result: ChatToolResult) => string[];
  /** 该结果里可被引用的知识条目 ID（输出合同 knowledgeIds 的合法集合）。 */
  knowledgeIds: (result: ChatToolResult) => string[];
  /** 该结果里可被模型合法引用的数字（原始事实，等价类由 chat-numeric-evidence 统一生成）。 */
  numericFacts: (result: ChatToolResult) => ChatNumericFact[];
  /** 是否产出了可引用的证据——L2b "全空短路"用它判定，替代按工具名的硬编码。 */
  hasUsableEvidence: (result: ChatToolResult) => boolean;
};

const emptyFacts: ChatNumericFact[] = [];
const emptyIds: string[] = [];

const userToolSpec: ChatToolSpec = {
  anchorMode: "none", evidenceKind: "claims",
  claimIds: result => "saved" in result ? result.claims.map(claim => claim.claimId) : [],
  knowledgeIds: () => [],
  numericFacts: result => "saved" in result ? [
    ...result.claims.map(claim => ({ value: claim.value, unit: claim.unit, key: claim.key })),
    ...(result.goal ? [{ displayValue: `${result.goal.title} ${result.goal.detail}` }] : []),
    ...(result.interaction?.artifact?.kind === "goal_editor" && result.interaction.artifact.payload.draft
      ? [{ displayValue: `${result.interaction.artifact.payload.draft.title} ${result.interaction.artifact.payload.draft.detail}` }] : []),
    ...(result.interaction?.artifact?.kind === "profile_proposal" ? Object.values(result.interaction.artifact.payload.input).flatMap(value => typeof value === "number" ? [{ value }] : []) : []),
  ] : [],
  hasUsableEvidence: result => "saved" in result && result.claims.length > 0,
};

const executionToolSpec: ChatToolSpec = {
  anchorMode: "none", evidenceKind: "claims", claimIds: result => isExecutionToolResult(result) ? result.claims.map(claim => claim.claimId) : [],
  knowledgeIds: () => [], numericFacts: result => isExecutionToolResult(result) ? executionNumericFacts(result) : [], hasUsableEvidence: result => isExecutionToolResult(result),
};

const planToolSpec: ChatToolSpec = {
  anchorMode: "none", evidenceKind: "claims", claimIds: result => isPlanToolResult(result) ? result.claims.map(claim => claim.claimId) : [],
  knowledgeIds: () => [], numericFacts: result => isPlanToolResult(result) ? planNumericFacts(result) : [], hasUsableEvidence: result => isPlanToolResult(result),
};

export const chatToolSpecs: Record<ChatToolName, ChatToolSpec> = {
  get_training_execution: executionToolSpec, prepare_training_record_link: executionToolSpec, assess_training_execution: executionToolSpec,
  get_training_plan_context: planToolSpec,
  prepare_training_plan: planToolSpec,
  propose_training_plan: planToolSpec,
  prepare_ride_import: {
    anchorMode: "none", evidenceKind: "claims",
    claimIds: result => result.tool === "prepare_ride_import" ? result.claims.map(claim => claim.claimId) : [],
    knowledgeIds: () => [],
    numericFacts: result => {
      if (result.tool !== "prepare_ride_import") return [];
      const facts = [{ value: result.maxFileSizeMB, unit: "MB" }];
      for (const platform of result.platforms) {
        if (platform.mode !== "live_manual" || !platform.lastAttempt) continue;
        const { added, duplicate, failed } = platform.lastAttempt;
        facts.push(...[added, duplicate, failed].map(value => ({ value, unit: "count" })));
      }
      return facts;
    },
    hasUsableEvidence: result => result.tool === "prepare_ride_import",
  },
  get_user_context: userToolSpec,
  show_onboarding: userToolSpec,
  prepare_profile_proposal: userToolSpec,
  get_ride_context: {
    anchorMode: "required",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "get_ride_context" ? result.claims.map((claim) => claim.claimId) : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "get_ride_context"
      ? [
        ...result.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.key, displayValue: claim.displayValue })),
        // 日期标签数字（"2026年10月5日"）随投影提供，模型表述"10月5日这次"可溯源。
        ...(result.rideDateLabel ? [{ displayValue: result.rideDateLabel }] : []),
      ]
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "get_ride_context" && result.claims.length > 0,
  },
  get_capabilities: {
    anchorMode: "required",
    // AGT-B5：改 claims 形态——能力可用性成为可引用事实（见 CapabilitiesToolResult 注释）。
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "get_capabilities" ? result.claims.map((claim) => claim.claimId) : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "get_capabilities"
      ? result.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.key, displayValue: claim.displayValue }))
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "get_capabilities" && result.claims.length > 0,
  },
  compare_rides: {
    anchorMode: "required",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "compare_rides"
      ? result.claims.flatMap((claim) => (claim.claimId ? [claim.claimId] : []))
      : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "compare_rides"
      ? [
        { value: result.windowDays },
        { value: result.sampleCount },
        { value: result.comparability.sampleCount },
        ...(result.anchorStartTime ? [{ displayValue: result.anchorStartTime }] : []),
        ...result.claims.flatMap((claim) => [
          ...(claim.anchor ? [{ value: claim.anchor.value, unit: claim.anchor.unit, displayValue: claim.anchor.displayValue }] : []),
          ...(claim.baseline ? [
            { value: claim.baseline.value, unit: claim.baseline.unit, displayValue: claim.baseline.displayValue },
            { value: claim.baseline.sampleCount },
          ] : []),
          ...(claim.change !== undefined ? [{ value: claim.change, unit: claim.anchor?.unit }] : []),
          ...(claim.relativeChangePercent !== undefined ? [{ value: claim.relativeChangePercent }] : []),
        ]),
      ]
      : emptyFacts),
    // AGT-B5：**保持"必须有可比 claim"**。曾试过放宽到"有 claim 即可"，实测模型会把
    // not_comparable 答成「完全一致，没有变化」并且编造「相同路线」——不可比 ≠ 相同，
    // 那是幻觉方向的错误，比降级更糟。不可比的说明改由**零模型降级话术**承担（见 chat-agent）。
    hasUsableEvidence: (result) => result.tool === "compare_rides"
      && result.claims.some((claim) => claim.status === "comparable" && Boolean(claim.claimId)),
  },
  find_ride: {
    anchorMode: "optional",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "find_ride"
      ? result.matches.flatMap((match) => match.claims.map((claim) => claim.claimId))
      : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "find_ride"
      ? [
        { value: result.windowDays },
        { value: result.candidateCount },
        { value: result.matchedCount },
        ...(result.threshold !== undefined ? [{ value: result.threshold }] : []),
        ...result.matches.flatMap((match) => [
          ...(match.rideDateLabel ? [{ displayValue: match.rideDateLabel }] : []),
          ...match.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.metricKey, displayValue: claim.displayValue })),
        ]),
      ]
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "find_ride" && result.status === "matched" && result.matches.length > 0,
  },
  get_health_profile: {
    anchorMode: "none",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "get_health_profile" ? result.facts.map((fact) => fact.claimId) : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "get_health_profile"
      ? result.facts.map((fact) => ({ value: fact.value, unit: fact.unit, key: fact.key }))
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "get_health_profile" && result.facts.length > 0,
  },
  get_training_load: {
    anchorMode: "none",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "get_training_load"
      ? result.claims.flatMap((claim) => (claim.claimId ? [claim.claimId] : []))
      : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "get_training_load"
      ? [
        { value: result.windowDays },
        { value: result.loadDays },
        ...(result.ctl !== undefined ? [{ value: result.ctl, key: "ctl" }] : []),
        ...(result.atl !== undefined ? [{ value: result.atl, key: "atl" }] : []),
        ...(result.tsb !== undefined ? [{ value: result.tsb, key: "tsb" }] : []),
        // 每条跳过原因的计数都要可引用（"4 次因缺功率未计入"）
        ...result.ridesWithoutTss.map((item) => ({ value: item.count, key: "ridesWithoutTss" })),
        ...result.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.key, displayValue: claim.displayValue })),
      ]
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "get_training_load" && result.status === "available",
  },
  search_knowledge_base: {
    anchorMode: "none",
    evidenceKind: "knowledge",
    claimIds: () => emptyIds,
    knowledgeIds: (result) => (result.tool === "search_knowledge_base" && result.status === "matched"
      ? result.items.map((item) => item.knowledgeId)
      : emptyIds),
    numericFacts: (result) => (result.tool === "search_knowledge_base"
      // 知识正文里的数字（如"CTL 时间常数 42 天"）必须可被引用，否则模型解释原理
      // 一说数字就被判幻觉。代价是这些数字也可被误当作个人数据——靠 Prompt 约束
      // "知识数字只作原理解释"+ 离线语义判官兜（AGT-C），不在规则层解决。
      ? result.items.map((item) => ({ displayValue: item.excerpt }))
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "search_knowledge_base" && result.status === "matched" && result.items.length > 0,
  },
  get_ride_history: {
    anchorMode: "optional",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "get_ride_history"
      ? [
        ...result.claims.flatMap((claim) => (claim.claimId ? [claim.claimId] : [])),
        ...result.rows.flatMap((row) => row.claims.map((claim) => claim.claimId)),
      ]
      : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "get_ride_history"
      ? [
        { value: result.windowDays },
        { value: result.rideCount },
        { value: result.rows.length },
        ...(result.windowStartDate ? [{ displayValue: result.windowStartDate }] : []),
        ...(result.windowEndDate ? [{ displayValue: result.windowEndDate }] : []),
        ...result.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.key, displayValue: claim.displayValue })),
        // AGT-B5（第 14 个缺陷）：**逐条明细的数值也要可溯源**。原来只放了总计 claims，
        // 模型一罗列单次明细（"10月24日一次 50.0 公里"）就必然被判数字越权 →
        // ORCH-05/12/16 三连 REPAIR_FAILED。V4.1-Flash 比 V3.2 更爱列明细，所以这个洞
        // 在换模型后才暴露（V3.2 用户侧同样会踩，只是它更少主动罗列）。
        ...result.rows.flatMap((row) => row.claims.map((claim) => ({
          value: claim.value,
          unit: claim.unit,
          ...(claim.displayValue !== undefined ? { displayValue: claim.displayValue } : {}),
        }))),
        ...result.rows.flatMap((row) => [
          ...(row.rideDateLabel ? [{ displayValue: row.rideDateLabel }] : []),
          ...row.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.metricKey, displayValue: claim.displayValue })),
        ]),
      ]
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "get_ride_history" && result.status === "matched",
  },
  get_route_overview: {
    anchorMode: "required",
    evidenceKind: "claims",
    claimIds: (result) => (result.tool === "get_route_overview"
      ? result.claims.flatMap((claim) => (claim.claimId ? [claim.claimId] : []))
      : emptyIds),
    knowledgeIds: () => emptyIds,
    numericFacts: (result) => (result.tool === "get_route_overview"
      ? [
        ...(result.climbDistanceM !== undefined ? [{ value: result.climbDistanceM, unit: "m", key: "distanceM" }] : []),
        ...(result.flatDistanceM !== undefined ? [{ value: result.flatDistanceM, unit: "m", key: "distanceM" }] : []),
        ...(result.descentDistanceM !== undefined ? [{ value: result.descentDistanceM, unit: "m", key: "distanceM" }] : []),
        // 爬坡段：起止里程与段长都要可引用（"从 12 公里到 15 公里"这类表述）。
        ...result.climbs.flatMap((climb) => [
          { value: climb.distanceM, unit: "m", key: "distanceM" },
          { value: climb.startDistanceM, unit: "m", key: "distanceM" },
          { value: climb.endDistanceM, unit: "m", key: "distanceM" },
        ]),
        ...result.claims.map((claim) => ({ value: claim.value, unit: claim.unit, key: claim.key, displayValue: claim.displayValue })),
      ]
      : emptyFacts),
    hasUsableEvidence: (result) => result.tool === "get_route_overview" && result.isAvailable,
  },
};

/** 一批结果的可引用 Claim ID 并集（输出合同 claimIds 的合法集合）。 */
export function toolClaimIds(results: readonly ChatToolResult[]): Set<string> {
  const ids = new Set<string>();
  for (const result of results) for (const id of chatToolSpecs[result.tool].claimIds(result)) ids.add(id);
  return ids;
}

/** 一批结果的可引用知识条目 ID 并集（输出合同 knowledgeIds 的合法集合）。 */
export function toolKnowledgeIds(results: readonly ChatToolResult[]): Set<string> {
  const ids = new Set<string>();
  for (const result of results) for (const id of chatToolSpecs[result.tool].knowledgeIds(result)) ids.add(id);
  return ids;
}

export function chatToolAnchorMode(tool: ChatToolName): ChatToolAnchorMode {
  return chatToolSpecs[tool].anchorMode;
}

export function chatToolEvidenceKind(tool: ChatToolName): ChatToolEvidenceKind {
  return chatToolSpecs[tool].evidenceKind;
}

// ---- AGT-B1：三个全局工具的执行投影（无锚点，不依赖某一次骑行）----

const SHANGHAI_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

/** Asia/Shanghai 日历日（YYYY-MM-DD）——与 rideDateLabel 同口径，供 TSS 按日聚合。 */
function shanghaiDateKey(value: string | Date): string | undefined {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = SHANGHAI_DATE.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

/** 只接受 qualityStatus=valid 的有限值（低置信/降级指标不参与训练负荷计算）。 */
function validMetricValue(record: RideRecord, key: MetricKey): number | undefined {
  const metric = record.activity.metrics[key];
  return metric && metric.qualityStatus === "valid" && Number.isFinite(metric.value) ? metric.value : undefined;
}

async function buildHealthProfileResult(
  repository: ApplicationRepository,
  ownerId: string,
  input: { fields: HealthProfileField[] },
): Promise<HealthProfileToolResult> {
  const profile = await repository.getProfile(ownerId);
  const facts: HealthProfileFactItem[] = [];
  const limitations: string[] = [];
  for (const field of input.fields) {
    if (field === "weightKg") {
      if (profile?.weightKg) {
        facts.push({ claimId: "claim:profile:weightKg", key: field, value: profile.weightKg.value, unit: "kg", provenance: "user_provided", updatedAt: profile.weightKg.updatedAt });
      } else {
        limitations.push("weightKg:MISSING");
      }
    }
    if (field === "maxHeartRate") {
      if (profile?.maxHeartRate) {
        facts.push({
          claimId: "claim:profile:maxHeartRate",
          key: field,
          value: profile.maxHeartRate.valueBpm,
          unit: "bpm",
          // system_estimated 必须原样透出：模型不得把 220-age 估算说成用户实测值。
          provenance: profile.maxHeartRate.source === "system_estimated" ? "system_estimated" : "user_provided",
          updatedAt: profile.maxHeartRate.updatedAt,
        });
      } else {
        limitations.push("maxHeartRate:MISSING");
      }
    }
    if (field === "ftp") {
      if (profile?.ftp) {
        facts.push({ claimId: "claim:profile:ftp", key: field, value: profile.ftp.valueWatts, unit: "W", provenance: "user_provided", updatedAt: profile.ftp.updatedAt });
      } else {
        limitations.push("ftp:MISSING");
      }
    }
  }
  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "get_health_profile",
    facts,
    limitations,
    privacy: ["identity_fields_excluded", "non_sport_health_fields_excluded"],
  };
}

/** 知识条目摘要：截断到 600 字并尽量落在句末，避免把半句话喂给模型。 */
function knowledgeExcerpt(explanation: string, maxChars = 600): string {
  if (explanation.length <= maxChars) return explanation;
  const slice = explanation.slice(0, maxChars);
  const boundary = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("；"), slice.lastIndexOf("\n"));
  return (boundary > maxChars / 2 ? slice.slice(0, boundary + 1) : slice).trim();
}

function buildKnowledgeSearchResult(input: { dimensionIds: ChatKnowledgeDimensionId[]; keywords: string[]; maxEntries: number }): KnowledgeSearchToolResult {
  const keywords = input.keywords.map((keyword) => keyword.toLowerCase());
  // 用 Set<string> 做维度匹配：检索入参是 7 维、条目维度是 9 维领域枚举，
  // 直接 includes 会因联合类型窄于宽而编译不过（运行时语义完全一致）。
  const dimensionFilter = new Set<string>(input.dimensionIds);
  const entries = [...rideKnowledgeBaseV21, ...trainingKnowledgeBase];
  const ranked = entries.flatMap(entry => {
    const dimensionHit = dimensionFilter.has(entry.dimensionId);
    const tags = "keywords" in entry ? entry.keywords.map(keyword => keyword.toLowerCase()) : [];
    const haystack = `${entry.topic} ${entry.title} ${entry.explanation}`.toLowerCase();
    const keywordHits = keywords.filter(keyword => haystack.includes(keyword) || tags.some(tag => keyword.includes(tag))).length;
    if (!dimensionHit && keywordHits === 0) return [];
    const topicHit = tags.some(tag => keywords.some(keyword => keyword.includes(tag)));
    return [{ entry, dimensionHit, keywordHits, topicHit }];
  }).sort((a, b) => Number(b.topicHit) - Number(a.topicHit) || Number(b.dimensionHit) - Number(a.dimensionHit) || b.keywordHits - a.keywordHits);

  const items: KnowledgeBaseItem[] = ranked.slice(0, input.maxEntries).map(({ entry }) => ({
    knowledgeId: entry.knowledgeId,
    dimensionId: entry.dimensionId,
    topic: entry.topic,
    title: entry.title,
    conclusionStrength: entry.conclusionStrength,
    limitations: [...entry.limitations],
    excerpt: knowledgeExcerpt(entry.explanation),
    ...("sources" in entry ? { sources: entry.sources } : {}),
  }));

  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "search_knowledge_base",
    status: items.length > 0 ? "matched" : "no_match",
    dimensionIds: [...input.dimensionIds],
    keywords: [...input.keywords],
    // 未命中时回传全部可用维度，让模型能改问而不是编造条目。
    availableDimensionIds: [...chatKnowledgeDimensionIds],
    items,
    privacy: ["public_knowledge_only"],
  };
}

async function buildTrainingLoadResult(
  repository: ApplicationRepository,
  ownerId: string,
  input: { anchorDate: string; windowDays: number },
): Promise<TrainingLoadToolResult> {
  const anchorDate = input.anchorDate === "today" ? (shanghaiDateKey(new Date()) ?? input.anchorDate) : input.anchorDate;
  const profile = await repository.getProfile(ownerId);
  const ftpWatts = profile?.ftp?.valueWatts;
  // trustStatus 已是 user_confirmed 才认为 FTP 可信（PMC 对未确认 FTP 一律 unavailable）。
  const ftpConfirmed = profile?.ftp?.trustStatus === "user_confirmed";
  const records = (await repository.listRides(ownerId)).map((entry) => entry.record);

  const dailyLoads: RidePmcDailyLoadInput[] = [];
  const limitations: string[] = [];
  const unavailableByReason = new Map<string, number>();
  for (const record of records) {
    const date = shanghaiDateKey(record.activity.startTime ?? "");
    if (!date) {
      limitations.push(`ride:${record.activity.rideId}:DATE_MISSING`);
      continue;
    }
    // 晚于锚定日的记录不计入"截至该日"的负荷。
    if (date > anchorDate) continue;
    const tss = computeRideTss({
      normalizedPowerW: validMetricValue(record, "normalizedPowerW"),
      ftpWatts,
      // 只传 movingTimeS：V2.1 spec 声明 intensity.tss 依赖 timing.movingTimeS，
      // elapsed（含停歇）会把通勤骑的停歇算进负荷、系统性高估 TSS（验收修正）。
      movingTimeS: validMetricValue(record, "movingTimeS"),
    });
    if (tss.status === "available") {
      dailyLoads.push({ historyId: record.activity.rideId, date, tss: tss.tss });
    } else {
      unavailableByReason.set(tss.reason, (unavailableByReason.get(tss.reason) ?? 0) + 1);
    }
  }
  // 逐条原因聚合成一行，避免 limitations 随记录数线性膨胀。
  for (const [reason, count] of unavailableByReason) limitations.push(`rides_without_tss:${reason}:${count}`);
  const ridesWithoutTss = [...unavailableByReason.entries()].map(([reason, count]) => ({ reason: String(reason), count }));

  const snapshot = buildRidePmcLoadV2({
    // PMC 是"截至某日的全局负荷"，不绑定某次骑行；固定伪 id 让 claimId 稳定可溯。
    rideId: "training-load",
    anchorDate,
    ftpConfirmed,
    dailyLoads,
  });

  const claims: ChatToolClaim[] = snapshot.claims.map((claim) => ({
    claimId: claim.claimId,
    kind: claim.kind === "metric" || claim.kind === "feature" || claim.kind === "history" || claim.kind === "advanced" ? claim.kind : "metric",
    key: claim.key,
    ...(claim.value !== undefined ? { value: claim.value } : {}),
    ...(claim.unit ? { unit: claim.unit } : {}),
    confidence: claim.confidence,
    ...(claim.formulaVersion ? { formulaVersion: claim.formulaVersion } : {}),
    ...(claim.displayValue ? { displayValue: claim.displayValue } : {}),
    ...(claim.displayUnit ? { displayUnit: claim.displayUnit } : {}),
  }));

  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "get_training_load",
    ridesWithoutTss,
    status: snapshot.status === "available" ? "available" : "unavailable",
    ...(snapshot.reason ? { reason: snapshot.reason } : {}),
    anchorDate: snapshot.anchorDate,
    windowDays: snapshot.windowDays ?? input.windowDays,
    loadDays: snapshot.loadDays ?? dailyLoads.length,
    ...(snapshot.ctl !== undefined ? { ctl: snapshot.ctl } : {}),
    ...(snapshot.atl !== undefined ? { atl: snapshot.atl } : {}),
    ...(snapshot.tsb !== undefined ? { tsb: snapshot.tsb } : {}),
    claims,
    limitations: [...new Set([...snapshot.limitations, ...limitations])],
    privacy: ["none"],
  };
}

// ---- AGT-B2：记录窗口工具组 ----

const DAY_MS = 86_400_000;

/** Asia/Shanghai 日历日的天数序号（用于窗口边界比较，避免跨时区/夏令时误差）。 */
function dayIndex(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00+08:00`) / DAY_MS);
}

async function buildRideHistoryResult(
  repository: ApplicationRepository,
  ownerId: string,
  input: RideHistoryInput,
): Promise<RideHistoryToolResult> {
  const records = (await repository.listRides(ownerId)).map((entry) => entry.record);
  const anchorRecord = input.rideId ? records.find((record) => record.activity.rideId === input.rideId) : undefined;
  if (input.rideId && !anchorRecord) throw new ChatToolError("NOT_FOUND");

  // 窗口终点：锚定某条时取该条的骑行日（"那次之前的 90 天"），否则取今天。
  const anchorDate = input.dateRange?.endDate ?? (anchorRecord
    ? shanghaiDateKey(anchorRecord.activity.startTime ?? "")
    : shanghaiDateKey(new Date()));
  if (!anchorDate) throw new ChatToolError("TEMPORARY_UNAVAILABLE");
  const windowDays = input.dateRange ? historyRangeDays(input.dateRange) : input.windowDays;
  const anchorDay = dayIndex(anchorDate);
  const startDay = anchorDay - windowDays + 1;

  const inWindow = records
    .map((record) => ({ record, date: shanghaiDateKey(record.activity.startTime ?? "") }))
    .filter((item): item is { record: RideRecord; date: string } => item.date !== undefined)
    .filter((item) => {
      const day = dayIndex(item.date);
      return day >= startDay && day <= anchorDay;
    })
    // 最近的在最前：模型叙述"最近 N 次"时按序取用，不必自己排序。
    .sort((a, b) => Date.parse(b.record.activity.startTime!) - Date.parse(a.record.activity.startTime!));

  const reasonCodes: RideHistoryToolResult["reasonCodes"] = [];
  if (inWindow.length === 0) reasonCodes.push("NO_RIDES_IN_WINDOW");

  // 汇总：任一记录缺该指标就记 METRIC_MISSING（汇总值只累加 valid 值，缺失按 0 计但明示）。
  const metricKeys = ["distanceM", "movingTimeS", "elevationGainM"] as const;
  const totals = new Map<MetricKey, number>();
  const limitations: string[] = [];
  for (const key of metricKeys) {
    let total = 0;
    let missing = false;
    let validCount = 0;
    for (const item of inWindow) {
      const value = validMetricValue(item.record, key);
      if (value === undefined) missing = true;
      else { total += value; validCount++; }
    }
    if (validCount) totals.set(key, total);
    if (missing && !reasonCodes.includes("METRIC_MISSING")) reasonCodes.push("METRIC_MISSING");
    if (missing) limitations.push(`${key}:部分或全部记录缺少有效数据，汇总只包含有效值，不将缺失当作零。`);
  }

  // claim.key 用领域指标键（distanceM / movingTimeS / elevationGainM），
  // 这样数值等价类会自动补上 km / 小时 的呈现换算，模型说"32 公里"不会被判幻觉。
  const claims: ChatToolClaim[] = [
    {
      claimId: "claim:history:rideCount",
      kind: "metric",
      key: "rideCount",
      value: inWindow.length,
      unit: "count",
      confidence: "high",
      displayValue: String(inWindow.length),
    },
    ...(inWindow.length > 0
      ? [
        ...(totals.has("distanceM") ? [{ claimId: "claim:history:totalDistanceM", kind: "metric" as const, key: "distanceM", value: totals.get("distanceM")!, unit: "m", confidence: "high" as const, displayValue: String(totals.get("distanceM")) }] : []),
        ...(totals.has("movingTimeS") ? [{ claimId: "claim:history:totalMovingTimeS", kind: "metric" as const, key: "movingTimeS", value: totals.get("movingTimeS")!, unit: "s", confidence: "high" as const, displayValue: String(totals.get("movingTimeS")) }] : []),
        ...(totals.has("elevationGainM") ? [{ claimId: "claim:history:totalElevationGainM", kind: "metric" as const, key: "elevationGainM", value: totals.get("elevationGainM")!, unit: "m", confidence: "high" as const, displayValue: String(totals.get("elevationGainM")) }] : []),
      ]
      : []),
  ];

  const rows: RideHistoryRow[] = inWindow.slice(0, CHAT_RIDE_HISTORY_MAX_ROWS).map((item) => ({
    rideId: item.record.activity.rideId,
    ...(formatRideDateLabel(item.record.activity.startTime) ? { rideDateLabel: formatRideDateLabel(item.record.activity.startTime) } : {}),
    claims: input.metrics
      .map((metric) => {
        const value = validMetricValue(item.record, metric as MetricKey);
        return value === undefined ? undefined : findRideClaim(item.record.activity.rideId, metric, value);
      })
      .filter((claim): claim is FindRideClaim => claim !== undefined),
  }));

  if (inWindow.length > rows.length) {
    limitations.push(`rows_truncated:${rows.length}/${inWindow.length}`);
  }

  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "get_ride_history",
    windowDays,
    windowStartDate: input.dateRange?.startDate ?? new Date(Date.parse(`${anchorDate}T00:00:00Z`) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10),
    windowEndDate: anchorDate,
    ...(anchorRecord?.activity.startTime ? { anchorStartTime: anchorRecord.activity.startTime } : {}),
    status: inWindow.length > 0 ? "matched" : "no_match",
    reasonCodes,
    rideCount: inWindow.length,
    claims,
    rows,
    limitations,
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

async function buildRouteOverviewResult(
  record: RideRecord,
  input: { segments: number },
): Promise<RouteOverviewToolResult> {
  // 两步都是现成函数：记录 → 海拔汇总 → 路线形状摘要（不重算任何爬坡判定规则）。
  const shape = buildRideRouteShapeSummary(buildRideElevationSummary(record));

  const limitations: string[] = [];
  if (!shape.isAvailable) limitations.push("route_shape:NOT_AVAILABLE");
  if (shape.needsCoverageNotice) limitations.push(`route_shape:coverage:${Math.round(shape.coverageRatio * 100)}%`);

  // 爬坡段按里程降序取前 N 段（N = segments），longestClimb 恒为第一段。
  // 里程取整到米：领域函数给的是浮点（7.142857…），投影给模型前收口，
  // 避免模型照抄一长串小数（"可行度"由等价类的舍入覆盖，不会影响"44.98 公里"这类表述）。
  const meters = (value: number): number => Math.round(value);
  const climbs = shape.isAvailable
    ? shape.segments
      .filter((segment) => segment.type === "climb")
      .sort((a, b) => b.distanceM - a.distanceM)
      .slice(0, input.segments)
      .map((segment) => ({ startDistanceM: meters(segment.startDistanceM), endDistanceM: meters(segment.endDistanceM), distanceM: meters(segment.distanceM) }))
    : [];

  const claims: ChatToolClaim[] = shape.isAvailable
    ? [
      { claimId: `claim:${record.activity.rideId}:route:climbDistanceM`, kind: "metric", key: "distanceM", value: meters(shape.climbDistanceM), unit: "m", confidence: "high", displayValue: String(meters(shape.climbDistanceM)) },
      { claimId: `claim:${record.activity.rideId}:route:flatDistanceM`, kind: "metric", key: "distanceM", value: meters(shape.flatDistanceM), unit: "m", confidence: "high", displayValue: String(meters(shape.flatDistanceM)) },
      { claimId: `claim:${record.activity.rideId}:route:descentDistanceM`, kind: "metric", key: "distanceM", value: meters(shape.descentDistanceM), unit: "m", confidence: "high", displayValue: String(meters(shape.descentDistanceM)) },
    ]
    : [];

  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "get_route_overview",
    rideId: record.activity.rideId,
    isAvailable: shape.isAvailable,
    // 不可用时**不填任何里程字段**——宁可缺失也不给 0（0 会被叙述成"全是平路"）。
    ...(shape.isAvailable
      ? {
        climbDistanceM: meters(shape.climbDistanceM),
        flatDistanceM: meters(shape.flatDistanceM),
        descentDistanceM: meters(shape.descentDistanceM),
      }
      : {}),
    ...(climbs.length > 0 ? { longestClimb: climbs[0], climbs } : { climbs: [] }),
    claims,
    limitations,
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

// AGT-H1：rideRef → 记录（或在无法唯一定位时给出候选）。
// - `{rideId}`：走既有归属校验（越权 id 由 ownedRide 报 NOT_FOUND，不降级成候选——
//   那不是"选哪条"的问题，是"这条不是你的"）；
// - `{date}` / `{ordinal}`：服务端在本人记录里查，命中多条/没有命中都返回候选，**不猜**。
async function resolveToolRideReference(
  repository: ApplicationRepository,
  ownerId: string,
  rideRef: ChatRideRef | undefined,
  tool: "get_ride_context" | "get_route_overview",
): Promise<{ record: RideRecord } | { pending: RideReferencePendingToolResult }> {
  if (rideRef && "rideId" in rideRef) {
    return { record: await ownedRide(repository, ownerId, rideRef.rideId) };
  }
  const entries = await repository.listRides(ownerId);
  const resolution = resolveChatRideRef({ ref: rideRef, entries });
  if (resolution.status === "resolved") return { record: resolution.record };
  return {
    pending: {
      schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
      tool,
      status: resolution.status,
      reason: resolution.reason,
      candidates: resolution.candidates,
      limitations: [`ride_reference:${resolution.reason}`],
    },
  };
}

// AGT-H1：get_ride_context 结果构造——从执行分支抽出，因为 rideRef 必须在**取记录之前**解析
// （解析不到要返回候选，而不是先取一条再判断）。
async function buildRideContextResult(
  repository: ApplicationRepository,
  ownerId: string,
  record: RideRecord,
  input: RideContextInput,
): Promise<RideContextToolResult> {
  const profile = await repository.getProfile(ownerId);
  const context = buildRideAnalysisContext(record, { profile: profile ?? undefined, userScope: "chat-tool" });
  const metricKeys = new Set(input.dims.flatMap((dimension) => DIMENSION_METRICS[dimension]));
  const featureDimensions = new Set(input.dims.flatMap((dimension) => DIMENSION_FEATURES[dimension]));
  const capabilityKeys = new Set(input.dims.flatMap((dimension) => DIMENSION_CAPABILITIES[dimension]));
  const claims = context.allowedClaims.filter((claim) =>
    (claim.kind === "metric" && metricKeys.has(claim.key as MetricKey))
    || (claim.kind === "feature" && context.featureSnapshot.features.some((feature) => feature.claimId === claim.claimId && featureDimensions.has(feature.dimension))),
  );
  const limitations = context.capabilities
    .filter((capability) => capabilityKeys.has(capability.key) && !capability.available)
    .map((capability) => `${capability.key}:${capability.unavailableReason ?? "CAPABILITY_UNAVAILABLE"}`);

  return {
    schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
    tool: "get_ride_context",
    rideId: record.activity.rideId,
    ...(formatRideDateLabel(record.activity.startTime) ? { rideDateLabel: formatRideDateLabel(record.activity.startTime) } : {}),
    dimensions: [...input.dims],
    claims: claims.map(publicClaim),
    limitations: [...new Set(limitations)],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

async function executeChatToolWithinBoundary(repository: ApplicationRepository, ownerId: string, invocation: ChatToolInvocation, userSource = ""): Promise<ChatToolExecutionResult> {
  try {
    if (invocation.tool === "get_training_execution" || invocation.tool === "prepare_training_record_link" || invocation.tool === "assess_training_execution") return enforceResultSize(await executeExecutionTool(repository, ownerId, invocation));
    if (invocation.tool === "get_training_plan_context" || invocation.tool === "prepare_training_plan" || invocation.tool === "propose_training_plan") return executePlanTool(repository, ownerId, invocation);
    if (invocation.tool === "prepare_ride_import") {
      const platforms = await readImportPlatforms(repository, ownerId);
      return {
        schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
        tool: invocation.tool,
        mode: platforms.some(platform => platform.mode === "live_manual") ? "real_file_live_onelap" : "real_file_simulated_platform",
        platforms,
        fileFormats: ["FIT", "GPX"],
        maxFileSizeMB: MAX_UPLOAD_BYTES / (1024 * 1024),
        claims: [{ claimId: "claim:import:available", key: "import_entry_available", kind: "metric", value: 1, unit: "count", confidence: "high" }],
        interaction: { artifact: { kind: "ride_import", payload: {} } },
      };
    }
    if (invocation.tool === "get_user_context" || invocation.tool === "show_onboarding" || invocation.tool === "prepare_profile_proposal") {
      return enforceResultSize(await executeChatUserTool(repository, ownerId, invocation, userSource));
    }
    // AGT-B1：三个全局工具（无锚点）先处理——它们不依赖某条骑行记录，若落进下面的
    // ownedRide 路径会因缺少 rideId 被误判 NOT_FOUND。
    if (invocation.tool === "get_health_profile") {
      return enforceResultSize(await buildHealthProfileResult(repository, ownerId, invocation.input));
    }
    if (invocation.tool === "search_knowledge_base") {
      return enforceResultSize(buildKnowledgeSearchResult(invocation.input));
    }
    if (invocation.tool === "get_training_load") {
      return enforceResultSize(await buildTrainingLoadResult(repository, ownerId, invocation.input));
    }
    // AGT-B2：记录窗口工具组。ride_history 的 rideId 可为 null（跨记录/不锚定），
    // route_overview 必须锚定。
    if (invocation.tool === "get_ride_history") {
      return enforceResultSize(await buildRideHistoryResult(repository, ownerId, invocation.input));
    }
    if (invocation.tool === "find_ride") {
      const records = (await repository.listRides(ownerId)).map(entry => entry.record);
      // A cross-record search needs no user-selected ride. Its legacy window is
      // anchored on the latest visible record; this does not select an analysis object.
      const record = invocation.input.rideId ? await ownedRide(repository, ownerId, invocation.input.rideId)
        : [...records].sort((a, b) => (Date.parse(b.activity.startTime ?? "") || 0) - (Date.parse(a.activity.startTime ?? "") || 0))[0];
      if (!record) throw new ChatToolError("NOT_FOUND");
      return enforceResultSize(buildFindRideResult(record, records, invocation.input));
    }
    // AGT-H1：两个记录类工具先把 rideRef 解成具体记录；解不出（同日多条/没这条/没给指涉）
    // 就返回候选，让上层去问用户——**绝不默认取最新**。
    if (invocation.tool === "get_route_overview") {
      const reference = await resolveToolRideReference(repository, ownerId, invocation.input.rideRef, "get_route_overview");
      if ("pending" in reference) return reference.pending;
      return enforceResultSize(await buildRouteOverviewResult(reference.record, invocation.input));
    }
    if (invocation.tool === "get_ride_context") {
      const reference = await resolveToolRideReference(repository, ownerId, invocation.input.rideRef, "get_ride_context");
      if ("pending" in reference) return reference.pending;
      return enforceResultSize(await buildRideContextResult(repository, ownerId, reference.record, invocation.input));
    }

    const record = await ownedRide(repository, ownerId, invocation.input.rideId);
    const profile = await repository.getProfile(ownerId);

    if (invocation.tool === "get_capabilities") {
      const capabilityProfile = buildAtomicCapabilityProfile(record, profile ?? undefined);
      const requested = new Set(invocation.input.caps);
      return enforceResultSize({
        schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
        tool: invocation.tool,
        rideId: record.activity.rideId,
        claims: invocation.input.caps
          .filter((key) => requested.has(key))
          .map((key) => getAtomicCapability(capabilityProfile, key))
          .map((capability) => ({
            claimId: `claim:caps:${capability.key}`,
            kind: "metric" as const,
            key: capability.key,
            value: capability.available ? 1 : 0,
            unit: "count",
            confidence: "high" as const,
            displayValue: capability.available ? "可用" : "不可用",
          })),
        capabilities: invocation.input.caps
          .filter((key) => requested.has(key))
          .map((key) => getAtomicCapability(capabilityProfile, key))
          .map((capability) => ({
            key: capability.key,
            available: capability.available,
            sources: [...capability.sources],
            qualityStatus: capability.qualityStatus,
            dependencyKeys: [...capability.dependencyKeys],
            ...(capability.unavailableReason ? { unavailableReason: capability.unavailableReason } : {}),
          })),
      });
    }

    // CHAT-13：compare_rides——锚点（ownedRide 已校验归属）与本人全部持久记录的
    // 30 天窗口比较（listRides 按 owner 隔离）；不可比性由快照原因码承载，不在工具层拦截。
    if (invocation.tool === "compare_rides") {
      const history = buildHistoricalRides((await repository.listRides(ownerId)).map((entry) => entry.record));
      const snapshot = buildHistoricalComparisonSnapshot(buildHistoricalRide(record), history, {
        metricKeys: invocation.input.metrics,
        windowDays: invocation.input.windowDays,
      });
      return enforceResultSize(projectComparisonSnapshot(snapshot));
    }

    // CHAT-17 P1：find_ride——锚点（ownedRide 已校验归属）确定检索窗口；
    // listRides 按 owner 隔离；no_match 由结果状态承载（编排层零模型降级），不在工具层拦截。

    // 走到这里说明两个记录类工具（get_ride_context / get_route_overview）的提前返回被改动过。
    throw new ChatToolError("INVALID_INPUT");
  } catch (error) {
    if (error instanceof ChatToolError) throw error;
    throw new ChatToolError("TEMPORARY_UNAVAILABLE");
  }
}

export function executeChatTool(repository: ApplicationRepository, ownerId: string, invocation: ChatToolInvocation, userSource = ""): Promise<ChatToolExecutionResult> {
  return withinToolTimeout(executeChatToolWithinBoundary(repository, ownerId, invocation, userSource));
}
