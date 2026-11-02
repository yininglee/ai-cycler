import { chatToolSpecs, type ChatToolName, type ChatToolSpec } from "./chat-tools.ts";

export const CHAT_CAPABILITY_REGISTRY_VERSION = "chat-capability-registry-v0.1" as const;
export type ChatCapabilityCategory = "tools" | "knowledge" | "query" | "workflow";
export type ChatCapabilityRegistration = {
  tool: ChatToolName;
  category: ChatCapabilityCategory;
  implemented: boolean;
  enabled: boolean;
  effect: "read";
  spec: ChatToolSpec;
};

// Only implemented capabilities belong here. Plan/assessment workflow placeholders
// are deliberately absent; missing sensor data is reported by the tool result.
const categories: Record<ChatToolName, ChatCapabilityCategory> = {
  get_ride_context: "tools", get_capabilities: "tools", compare_rides: "query",
  find_ride: "query", get_health_profile: "tools", get_training_load: "tools",
  search_knowledge_base: "knowledge", get_ride_history: "query", get_route_overview: "tools",
};

export function activeChatCapabilities(): readonly ChatCapabilityRegistration[] {
  return (Object.keys(categories) as ChatToolName[]).map(tool => ({
    tool, category: categories[tool], implemented: true, enabled: true,
    effect: "read" as const, spec: chatToolSpecs[tool],
  })).filter(capability => capability.implemented && capability.enabled);
}

export function isActiveChatTool(tool: string): tool is ChatToolName {
  return activeChatCapabilities().some(capability => capability.tool === tool);
}
