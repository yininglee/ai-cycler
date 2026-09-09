import {
  CHAT_COMPARISON_WINDOW_DAYS,
  ChatToolError,
  chatComparisonMetricKeys,
  executeChatTool,
  type ChatComparisonMetricKey,
  type ChatToolName,
  type ChatToolResult,
  type RideContextDimension,
} from "./chat-tools.ts";
import type { ChatRoutingDecision, ChatSessionSummary } from "./chat-routing.ts";
import { resolveRideAnchor, rideAnchorDateLabel, type RideAnchorOverride } from "./chat-ride-anchor.ts";
import type { AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";

export const CHAT_TOOL_ORCHESTRATION_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES = 6;

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
