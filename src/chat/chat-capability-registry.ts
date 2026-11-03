import { chatToolSpecs, type ChatToolName, type ChatToolSpec } from "./chat-tools.ts";

export const CHAT_CAPABILITY_REGISTRY_VERSION = "chat-capability-registry-v0.1" as const;
export type ChatCapabilityCategory = "tools" | "knowledge" | "query" | "workflow";
export type ChatCapabilityRegistration = {
  tool: ChatToolName;
  category: ChatCapabilityCategory;
  implemented: boolean;
  enabled: boolean;
  effect: "read" | "prepare";
  spec: ChatToolSpec;
};

// Only implemented capabilities belong here. Activation stays behind explicit
// confirmation. Missing data stays explicit.
const categories: Record<ChatToolName, ChatCapabilityCategory> = {
  get_training_execution: "tools", prepare_training_record_link: "workflow", assess_training_execution: "workflow",
  get_training_plan_context: "tools", prepare_training_plan: "workflow", propose_training_plan: "workflow",
  prepare_ride_import: "workflow",
  get_user_context: "tools", show_onboarding: "workflow", prepare_profile_proposal: "workflow",
  get_ride_context: "tools", get_capabilities: "tools", compare_rides: "query",
  find_ride: "query", get_health_profile: "tools", get_training_load: "tools",
  search_knowledge_base: "knowledge", get_ride_history: "query", get_route_overview: "tools",
};

export function activeChatCapabilities(): readonly ChatCapabilityRegistration[] {
  return (Object.keys(categories) as ChatToolName[]).map(tool => ({
    tool, category: categories[tool], implemented: true, enabled: true,
    effect: tool === "prepare_training_plan" || tool === "propose_training_plan" || tool === "assess_training_execution" ? "prepare" as const : "read" as const, spec: chatToolSpecs[tool],
  })).filter(capability => capability.implemented && capability.enabled);
}

export function isActiveChatTool(tool: string): tool is ChatToolName {
  return activeChatCapabilities().some(capability => capability.tool === tool);
}
