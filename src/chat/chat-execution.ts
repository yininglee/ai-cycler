import { classifyChatInputL0, type ChatRoutingDecision } from "./chat-routing.ts";

export const CHAT_EXECUTION_CONTRACT_VERSION = "chat-execution-v0.1" as const;
export type ChatExecutionRoute = "stop" | "deterministic" | "agent_loop";

/** Legacy route is a context/compatibility hint, never a choice of data executor. */
export function chatExecutionRoute(text: string, decision: ChatRoutingDecision): ChatExecutionRoute {
  if (decision.risk !== "none" || decision.action === "safety_stop") return "stop";
  const l0 = classifyChatInputL0(text);
  if (l0?.risk !== undefined && l0.risk !== "none") return "stop";
  // Business labels are context hints. In particular, "unclear" must reach the
  // contextual Agent rather than becoming an unrelated fixed ride question.
  if (l0 || decision.action === "reject" || decision.route === "out_of_scope") return "deterministic";
  return "agent_loop";
}
