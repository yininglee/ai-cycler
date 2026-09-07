import {
  atomicCapabilityKeys,
  buildAtomicCapabilityProfile,
  getAtomicCapability,
  type AtomicCapabilityKey,
  type CapabilityQuality,
  type CapabilitySource,
  type CapabilityUnavailableReason,
} from "../domain/atomic-capabilities.ts";
import { buildRideAnalysisContext, type AnalysisContextClaim } from "../domain/ride-analysis-context.ts";
import type { MetricKey } from "../domain/ride-schema.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";

export const CHAT_TOOL_SCHEMA_VERSION = "chat-tools-v0.1" as const;
export const CHAT_TOOL_TIMEOUT_MS = 2_000;
export const CHAT_TOOL_MAX_INPUT_BYTES = 4 * 1_024;
export const CHAT_TOOL_MAX_RESULT_BYTES = 32 * 1_024;

export const rideContextDimensions = ["summary", "heart_rate", "power", "cadence", "elevation"] as const;
export type RideContextDimension = typeof rideContextDimensions[number];

export type ChatToolName = "get_ride_context" | "get_capabilities";
export type ChatToolErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "TIMEOUT" | "TEMPORARY_UNAVAILABLE";

type RideContextInput = { rideId: string; dims: RideContextDimension[] };
type CapabilitiesInput = { rideId: string; caps: AtomicCapabilityKey[] };
export type ChatToolInvocation =
  | { tool: "get_ride_context"; input: RideContextInput }
  | { tool: "get_capabilities"; input: CapabilitiesInput };

type ChatToolClaim = Pick<AnalysisContextClaim, "claimId" | "kind" | "key" | "value" | "unit" | "confidence" | "formulaVersion" | "displayValue" | "displayUnit">;

export type RideContextToolResult = {
  schemaVersion: typeof CHAT_TOOL_SCHEMA_VERSION;
  tool: "get_ride_context";
  rideId: string;
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
};

export type ChatToolResult = RideContextToolResult | CapabilitiesToolResult;

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

function uniqueEnumValues<T extends string>(value: unknown, allowed: readonly T[], maximum: number): value is T[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maximum
    && value.every((item): item is T => typeof item === "string" && allowed.includes(item as T))
    && new Set(value).size === value.length;
}

export function parseChatToolInvocation(value: unknown): ChatToolInvocation {
  if (!isPlainObject(value) || !hasExactKeys(value, ["tool", "input"]) || !isPlainObject(value.input)) throw new ChatToolError("INVALID_INPUT");
  if (value.tool === "get_ride_context") {
    if (!hasExactKeys(value.input, ["rideId", "dims"]) || !validRideId(value.input.rideId) || !uniqueEnumValues(value.input.dims, rideContextDimensions, rideContextDimensions.length)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, dims: value.input.dims } };
  }
  if (value.tool === "get_capabilities") {
    if (!hasExactKeys(value.input, ["rideId", "caps"]) || !validRideId(value.input.rideId) || !uniqueEnumValues(value.input.caps, atomicCapabilityKeys, 8)) {
      throw new ChatToolError("INVALID_INPUT");
    }
    return { tool: value.tool, input: { rideId: value.input.rideId, caps: value.input.caps } };
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

async function ownedRide(repository: ApplicationRepository, ownerId: string, rideId: string) {
  const record = await repository.getRide(ownerId, rideId);
  if (!record) throw new ChatToolError("NOT_FOUND");
  return record;
}

async function executeChatToolWithinBoundary(repository: ApplicationRepository, ownerId: string, invocation: ChatToolInvocation): Promise<ChatToolResult> {
  try {
    const record = await ownedRide(repository, ownerId, invocation.input.rideId);
    const profile = await repository.getProfile(ownerId);

    if (invocation.tool === "get_capabilities") {
      const capabilityProfile = buildAtomicCapabilityProfile(record, profile ?? undefined);
      const requested = new Set(invocation.input.caps);
      return enforceResultSize({
        schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
        tool: invocation.tool,
        rideId: record.activity.rideId,
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

    const context = buildRideAnalysisContext(record, { profile: profile ?? undefined, userScope: "chat-tool" });
    const metricKeys = new Set(invocation.input.dims.flatMap((dimension) => DIMENSION_METRICS[dimension]));
    const featureDimensions = new Set(invocation.input.dims.flatMap((dimension) => DIMENSION_FEATURES[dimension]));
    const capabilityKeys = new Set(invocation.input.dims.flatMap((dimension) => DIMENSION_CAPABILITIES[dimension]));
    const claims = context.allowedClaims.filter((claim) =>
      (claim.kind === "metric" && metricKeys.has(claim.key as MetricKey))
      || (claim.kind === "feature" && context.featureSnapshot.features.some((feature) => feature.claimId === claim.claimId && featureDimensions.has(feature.dimension))),
    );
    const limitations = context.capabilities
      .filter((capability) => capabilityKeys.has(capability.key) && !capability.available)
      .map((capability) => `${capability.key}:${capability.unavailableReason ?? "CAPABILITY_UNAVAILABLE"}`);

    return enforceResultSize({
      schemaVersion: CHAT_TOOL_SCHEMA_VERSION,
      tool: invocation.tool,
      rideId: record.activity.rideId,
      dimensions: [...invocation.input.dims],
      claims: claims.map(publicClaim),
      limitations: [...new Set(limitations)],
      privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
    });
  } catch (error) {
    if (error instanceof ChatToolError) throw error;
    throw new ChatToolError("TEMPORARY_UNAVAILABLE");
  }
}

export function executeChatTool(repository: ApplicationRepository, ownerId: string, invocation: ChatToolInvocation): Promise<ChatToolResult> {
  return withinToolTimeout(executeChatToolWithinBoundary(repository, ownerId, invocation));
}
