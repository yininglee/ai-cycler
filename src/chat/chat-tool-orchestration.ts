import {
  ChatToolError,
  executeChatTool,
  type ChatToolName,
  type ChatToolResult,
  type RideContextDimension,
} from "./chat-tools.ts";
import type { ChatRoutingDecision } from "./chat-routing.ts";
import type { AtomicCapabilityKey } from "../domain/atomic-capabilities.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";

export const CHAT_TOOL_ORCHESTRATION_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES = 6;

export type ChatToolOrchestrationErrorCode =
  | "TOOLS_NO_CURRENT_RIDE"
  | "TOOLS_TIMEOUT"
  | "TOOLS_UNAVAILABLE";

export class ChatToolOrchestrationError extends Error {
  readonly code: ChatToolOrchestrationErrorCode;

  constructor(code: ChatToolOrchestrationErrorCode) {
    super(code);
    this.name = "ChatToolOrchestrationError";
    this.code = code;
  }
}

export type ChatToolTrace = {
  tool: ChatToolName;
  status: "completed";
  dimensions?: RideContextDimension[];
  capabilityScope?: AtomicCapabilityKey[];
  summarySlots: number;
};

export type ChatToolContext = {
  schemaVersion: "ride-chat-tool-context-v0.1";
  question: string;
  decision: ChatRoutingDecision;
  recentSummaries: [];
  toolResult: ChatToolResult;
};

export type ChatToolRunResult = {
  context: ChatToolContext;
  trace: ChatToolTrace;
};

export type ChatToolRunner = {
  run(input: { text: string; decision: ChatRoutingDecision }): Promise<ChatToolRunResult>;
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
    async run({ text, decision }): Promise<ChatToolRunResult> {
      if (decision.route !== "current_ride" && decision.route !== "capabilities") {
        throw new ChatToolOrchestrationError("TOOLS_UNAVAILABLE");
      }
      try {
        return await withinOrchestrationTimeout((async () => {
          const currentRide = (await repository.listRides(ownerId))[0]?.record;
          if (!currentRide) throw new ChatToolOrchestrationError("TOOLS_NO_CURRENT_RIDE");

          if (decision.route === "current_ride") {
            const dimensions = currentRideDimensions(text.toLowerCase());
            const toolResult = await executeChatTool(repository, ownerId, {
              tool: "get_ride_context",
              input: { rideId: currentRide.activity.rideId, dims: dimensions },
            });
            return {
              context: { schemaVersion: "ride-chat-tool-context-v0.1", question: text, decision, recentSummaries: [], toolResult },
              trace: { tool: "get_ride_context", status: "completed", dimensions, summarySlots: 0 },
            };
          }

          const scope = capabilityScope(text.toLowerCase());
          const toolResult = await executeChatTool(repository, ownerId, {
            tool: "get_capabilities",
            input: { rideId: currentRide.activity.rideId, caps: scope },
          });
          return {
            context: { schemaVersion: "ride-chat-tool-context-v0.1", question: text, decision, recentSummaries: [], toolResult },
            trace: { tool: "get_capabilities", status: "completed", capabilityScope: scope, summarySlots: 0 },
          };
        })());
      } catch (error) {
        throw mapToolError(error);
      }
    },
  };
}
