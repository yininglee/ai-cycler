import { createUserProfile, type ProfileInput } from "../domain/user-profile.ts";
import { type UserGoalDraft } from "../domain/user-goal.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { sanitizeChatInteractionPayload, type ChatAgentInteraction } from "./chat-interaction.ts";

export type ChatUserToolInvocation =
  | { tool: "get_user_context" | "show_onboarding"; input: Record<string, never> }
  | { tool: "prepare_profile_proposal"; input: { input: ProfileInput } };

type UserClaim = { claimId: string; kind: "metric"; key: string; value: number; unit: string; confidence: "high"; displayValue?: string };
export type ChatUserToolResult = {
  schemaVersion: "chat-tools-v0.2";
  tool: ChatUserToolInvocation["tool"];
  profile: ProfileInput;
  profileSources: Partial<Record<keyof ProfileInput, "user_provided" | "system_estimated">>;
  goal: UserGoalDraft | null;
  claims: UserClaim[];
  /** Read-only preparation. No token, owner identifier or write permission. */
  interaction?: ChatAgentInteraction;
  saved: false;
  clarificationNeeded?: "PROFILE_UNITS_OR_VALUE";
};

/** Parameter evidence validation after AI selected the capability. This never
 * routes a message or extracts a proposal; unsupported quantities go back to AI. */
function hasExplicitProfileQuantities(input: ProfileInput, source: string): boolean {
  const units: Record<keyof ProfileInput, Array<[string, number]>> = {
    age: [["岁", 1]], heightCm: [["cm|厘米", 1], ["m|米", 100]],
    weightKg: [["kg|公斤|千克", 1], ["斤", 0.5]],
    maxHeartRateBpm: [["bpm|次(?:每分钟|每分|/分钟|/分)?", 1]], ftpWatts: [["W|瓦", 1]],
  };
  return Object.entries(input).every(([key, value]) => value === null || units[key as keyof ProfileInput].some(([unit, factor]) =>
    [...source.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${unit})(?![a-zA-Z])`, "gi"))].some(match => Math.abs(Number(match[1]) * factor - value!) < 0.000001)));
}

export function isProfileProposalInput(value: unknown): value is ProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).length || !Object.keys(input).every(key => ["age", "heightCm", "weightKg", "maxHeartRateBpm", "ftpWatts"].includes(key))
    || !Object.values(input).every(v => v === null || (typeof v === "number" && Number.isFinite(v)))) return false;
  try { createUserProfile(input); return true; } catch { return false; }
}

export function parseChatUserToolInvocation(tool: unknown, input: Record<string, unknown>): ChatUserToolInvocation | undefined {
  const keys = Object.keys(input);
  if (tool === "get_user_context" || tool === "show_onboarding") return keys.length === 0 ? { tool, input: {} } : undefined;
  if (tool === "prepare_profile_proposal" && keys.length === 1 && keys[0] === "input" && isProfileProposalInput(input.input)) return { tool, input: { input: input.input } };
  return undefined;
}

export async function executeChatUserTool(repository: ApplicationRepository, ownerId: string, call: ChatUserToolInvocation, source = ""): Promise<ChatUserToolResult> {
  const stored = await repository.getProfile(ownerId);
  const fields = {
    age: stored?.age?.value, heightCm: stored?.heightCm?.value, weightKg: stored?.weightKg?.value,
    maxHeartRateBpm: stored?.maxHeartRate?.valueBpm, ftpWatts: stored?.ftp?.valueWatts,
  };
  const profile = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as ProfileInput;
  const profileSources = Object.fromEntries([
    ["age", stored?.age?.source], ["heightCm", stored?.heightCm?.source], ["weightKg", stored?.weightKg?.source],
    ["maxHeartRateBpm", stored?.maxHeartRate?.source], ["ftpWatts", stored?.ftp?.source],
  ].filter(([, source]) => source !== undefined)) as ChatUserToolResult["profileSources"];
  // Legacy global goals are retained in storage but are no longer active profile facts.
  const goal = null;
  const claims: UserClaim[] = [
    { claimId: "claim:user:context_available", kind: "metric", key: "user_context_available", value: 1, unit: "count", confidence: "high" },
    ...Object.entries(profile).map(([key, value]) => ({ claimId: `claim:user:${key}`, kind: "metric" as const, key, value: value as number, unit: key === "weightKg" ? "kg" : key === "heightCm" ? "cm" : key === "age" ? "year" : key === "ftpWatts" ? "W" : "bpm", confidence: "high" as const })),
  ];
  const clarificationNeeded = call.tool === "prepare_profile_proposal" && !hasExplicitProfileQuantities(call.input.input, source);
  const artifact = call.tool === "prepare_profile_proposal" && !clarificationNeeded ? { kind: "profile_proposal", payload: { input: call.input.input, previous: profile } }
      : call.tool === "show_onboarding" ? { kind: "onboarding", payload: { goalDraft: "" } } : undefined;
  const { droppedFields: _, ...interaction } = sanitizeChatInteractionPayload({ artifact });
  return { schemaVersion: "chat-tools-v0.2", tool: call.tool, profile, profileSources, goal, claims, ...(artifact ? { interaction } : {}), ...(clarificationNeeded ? { clarificationNeeded: "PROFILE_UNITS_OR_VALUE" as const } : {}), saved: false };
}
