import {
  CHAT_COMPARISON_WINDOW_DAYS,
  ChatToolError,
  chatComparisonMetricKeys,
  executeChatTool,
  parseChatToolInvocation,
  rideContextDimensions,
  type ChatComparisonMetricKey,
  type ChatToolInvocation,
  type ChatToolName,
  type ChatToolResult,
  type RideContextDimension,
} from "./chat-tools.ts";
import type { ChatRoutingDecision, ChatSessionSummary } from "./chat-routing.ts";
import { resolveRideAnchor, rideAnchorDateLabel, type RideAnchorOverride } from "./chat-ride-anchor.ts";
import { atomicCapabilityKeys, type AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";

export const CHAT_TOOL_ORCHESTRATION_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES = 6;

// CHAT-17 P3：L2b 自主工具循环预算（架构设计 v0.4 4.2.1 L2b 行——既有预算维度不变，显式化）：
// 每轮工具调用数上限、单工具 2 秒/32 KB（chat-tools 既有合同）、整轮总时限、一次受限修复
// （chat-agent 既有合同，不计入循环模型调用预算）。模型每轮可并行请求多次调用，编排层
// 串行执行并按已完成调用数扣减工具预算；被拒绝调用（白名单外/参数非法/越权锚点）不消耗
// 工具预算，但直接终止循环进入确定性降级。
export const CHAT_TOOL_LOOP_MAX_TOOL_CALLS = 3;
export const CHAT_TOOL_LOOP_MAX_PROVIDER_CALLS = 5;
export const CHAT_TOOL_LOOP_TIMEOUT_MS = 30_000;

// CHAT-17 P3：L2b 工具调用协议——模型在循环中输出的工具请求 Schema
// （最终回答仍用 ride-chat-output-v0.1；两者由编排层区分解析）。
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

  constructor(code: ChatToolOrchestrationErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ChatToolOrchestrationError";
    this.code = code;
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
  status: "completed" | "rejected" | "failed";
  errorCode?: string;
  durationMs: number;
};

export type ChatToolLoopTrace = {
  kind: "autonomous_tools";
  status: "completed" | "budget_exhausted" | "no_match" | "invalid_tool_call" | "failed";
  steps: ChatToolLoopStep[];
  toolCalls: number;
  providerCalls: number;
  summarySlots: number;
};

// CHAT-17 P3：L2b 工具目录投影（chat_request.toolCatalog）——声明只读工具白名单、
// 各工具输入合同与默认锚点记录。目录为静态白名单 + 本轮锚点，不含任何用户数据。
export type ChatProviderToolCatalog = {
  schemaVersion: typeof CHAT_TOOL_CATALOG_SCHEMA_VERSION;
  anchorRideId: string;
  tools: ReadonlyArray<{
    tool: ChatToolName;
    input: Record<string, unknown>;
  }>;
};

export function buildChatToolCatalog(anchorRideId: string): ChatProviderToolCatalog {
  return {
    schemaVersion: CHAT_TOOL_CATALOG_SCHEMA_VERSION,
    anchorRideId,
    tools: [
      {
        tool: "find_ride",
        input: {
          rideId: "可选；缺省用锚点记录（目录 anchorRideId），指定时必须来自本轮工具结果返回的 rideId",
          metric: [...chatComparisonMetricKeys],
          mode: ["max", "min", "threshold"],
          threshold: "threshold 模式必填（数字，严格大于）",
          metrics: "可选；命中记录额外返回的指标，缺省同 metric",
          windowDays: "可选；1-30，缺省 30",
        },
      },
      {
        tool: "get_ride_context",
        input: {
          rideId: "可选；缺省用锚点记录，指定时必须来自本轮工具结果返回的 rideId",
          dims: [...rideContextDimensions],
        },
      },
      {
        tool: "compare_rides",
        input: {
          rideId: "可选；缺省用锚点记录，指定时必须来自本轮工具结果返回的 rideId",
          metrics: [...chatComparisonMetricKeys],
          windowDays: "可选；缺省 30",
        },
      },
      {
        tool: "get_capabilities",
        input: {
          rideId: "可选；缺省用锚点记录，指定时必须来自本轮工具结果返回的 rideId",
          caps: [...atomicCapabilityKeys],
        },
      },
    ],
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
  if (parsed.calls.length < 1 || parsed.calls.length > CHAT_TOOL_LOOP_MAX_TOOL_CALLS) return undefined;
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
  | { ok: false; code: "TOOLS_NO_CURRENT_RIDE" | "TOOLS_ANCHOR_CLARIFY" | "TOOLS_TIMEOUT" | "TOOLS_UNAVAILABLE"; reply?: string };

export type ChatToolLoopCallReceipt =
  | { tool: ChatToolName; status: "completed"; durationMs: number; result: ChatToolResult }
  | { tool: string; status: "rejected"; errorCode: "INVALID_TOOL_CALL" | "RIDE_NOT_ALLOWED"; durationMs: number }
  | { tool: ChatToolName; status: "failed"; errorCode: "TOOLS_NO_CURRENT_RIDE" | "TOOLS_TIMEOUT" | "TOOLS_UNAVAILABLE"; durationMs: number };

export type ChatToolLoopRunner = {
  startLoop(input: { text: string; decision: ChatRoutingDecision; summaries?: ChatSessionSummary[]; anchor?: RideAnchorOverride }): Promise<ChatToolLoopStartResult>;
  executeLoopCalls(input: { calls: readonly ChatToolLoopCallRequest[]; anchorRideId: string; allowedRideIds: readonly string[] }): Promise<readonly ChatToolLoopCallReceipt[]>;
};

// 模型调用输入的编排层补全：锚点注入（缺省）、场景化默认值（dims/caps/metrics/windowDays）、
// 随后走 parseChatToolInvocation 的既有严格校验（白名单枚举/上限/精确键集）。
function normalizeLoopCall(call: ChatToolLoopCallRequest, anchorRideId: string, allowedRideIds: readonly string[]): ChatToolInvocation | "INVALID_TOOL_CALL" | "RIDE_NOT_ALLOWED" {
  if (typeof call.tool !== "string" || !isPlainRecord(call.input)) return "INVALID_TOOL_CALL";
  const raw: Record<string, unknown> = { ...call.input };
  if (raw.rideId === undefined) {
    raw.rideId = anchorRideId;
  } else if (typeof raw.rideId !== "string" || !allowedRideIds.includes(raw.rideId)) {
    return "RIDE_NOT_ALLOWED";
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
  return {
    async startLoop({ text, decision, summaries = [], anchor }): Promise<ChatToolLoopStartResult> {
      if (decision.route !== "autonomous_tools") return { ok: false, code: "TOOLS_UNAVAILABLE" };
      try {
        return await withinOrchestrationTimeout((async () => {
          const entries = await repository.listRides(ownerId);
          if (entries.length === 0) throw new ChatToolOrchestrationError("TOOLS_NO_CURRENT_RIDE");
          const resolution = resolveRideAnchor({ text, route: decision.route, summaries, entries, override: anchor });
          if (resolution.status === "clarify") throw new ChatToolOrchestrationError("TOOLS_ANCHOR_CLARIFY", resolution.reply);
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
            ? { ok: false, code: error.code, reply: error.message }
            : { ok: false, code: error.code };
        }
        return { ok: false, code: mapToolError(error).code };
      }
    },

    async executeLoopCalls({ calls, anchorRideId, allowedRideIds }): Promise<readonly ChatToolLoopCallReceipt[]> {
      const receipts: ChatToolLoopCallReceipt[] = [];
      for (const call of calls) {
        const startedAt = Date.now();
        const invocation = normalizeLoopCall(call, anchorRideId, allowedRideIds);
        if (typeof invocation === "string") {
          receipts.push({ tool: typeof call.tool === "string" ? call.tool : "unknown", status: "rejected", errorCode: invocation, durationMs: Date.now() - startedAt });
          break;
        }
        try {
          const result = await executeChatTool(repository, ownerId, invocation);
          receipts.push({ tool: invocation.tool, status: "completed", durationMs: Date.now() - startedAt, result });
        } catch (error) {
          const code = error instanceof ChatToolError && error.code === "NOT_FOUND"
            ? "TOOLS_NO_CURRENT_RIDE"
            : error instanceof ChatToolError && error.code === "TIMEOUT"
              ? "TOOLS_TIMEOUT"
              : "TOOLS_UNAVAILABLE";
          receipts.push({ tool: invocation.tool, status: "failed", errorCode: code, durationMs: Date.now() - startedAt });
          break;
        }
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
          if (resolution.status === "clarify") throw new ChatToolOrchestrationError("TOOLS_ANCHOR_CLARIFY", resolution.reply);
          const currentRide = resolution.record;
          const resolvedAnchor: ResolvedRideAnchor = {
            ...(resolution.date ? { date: resolution.date, dateLabel: rideAnchorDateLabel(resolution.date) } : {}),
            source: resolution.source,
          };

          if (decision.route === "current_ride") {
            const dimensions = currentRideDimensions(text.toLowerCase());
            const toolResult = await executeChatTool(repository, ownerId, {
              tool: "get_ride_context",
              input: { rideId: currentRide.activity.rideId, dims: dimensions },
            });
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
            const toolResult = await executeChatTool(repository, ownerId, {
              tool: "compare_rides",
              input: { rideId: currentRide.activity.rideId, metrics, windowDays: CHAT_COMPARISON_WINDOW_DAYS },
            });
            return {
              context: { schemaVersion: "ride-chat-tool-context-v0.1", question: text, decision, sessionSummaries: summaries, toolResult },
              trace: { tool: "compare_rides", status: "completed", comparisonMetrics: metrics, summarySlots: summaries.length },
              resolvedAnchor,
            };
          }

          const scope = capabilityScope(text.toLowerCase());
          const toolResult = await executeChatTool(repository, ownerId, {
            tool: "get_capabilities",
            input: { rideId: currentRide.activity.rideId, caps: scope },
          });
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
