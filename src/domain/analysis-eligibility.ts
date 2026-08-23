import { atomicCapabilityKeys, getAtomicCapability, type AtomicCapabilityKey } from "./atomic-capabilities.ts";
import { validateRideAnalysisContext, type RideAnalysisContext } from "./ride-analysis-context.ts";

export const ANALYSIS_ELIGIBILITY_SCHEMA_VERSION = "0.1" as const;
export const ANALYSIS_ELIGIBILITY_RULES_VERSION = "analysis-eligibility-rules-v0.1" as const;

export type AnalysisEligibilityStatus = "eligible" | "not_eligible" | "blocked";
export type AnalysisDimensionKey = "endurance" | "pace" | "climbing" | "heartRate" | "power" | "cadence" | "history";
export type AnalysisInsightSource = "feature" | "history";

export type AnalysisEligibilityReasonCode =
  | "CONTEXT_INVALID"
  | "RECORD_REJECTED"
  | "NO_ALLOWED_CLAIMS"
  | "NO_INSIGHT_SOURCE"
  | "FEATURES_AVAILABLE"
  | "HISTORY_COMPARISON_AVAILABLE"
  | "SAFETY_BLOCK";

export interface AnalysisEligibility {
  schemaVersion: typeof ANALYSIS_ELIGIBILITY_SCHEMA_VERSION;
  rulesVersion: typeof ANALYSIS_ELIGIBILITY_RULES_VERSION;
  eligible: boolean;
  status: AnalysisEligibilityStatus;
  reasonCodes: AnalysisEligibilityReasonCode[];
  insightSources: AnalysisInsightSource[];
  allowedDimensionKeys: AnalysisDimensionKey[];
  requiredClaimIds: string[];
  fallback: "b0" | "safety_stop";
}

const DIMENSION_BY_FEATURE_PREFIX: Array<[string, AnalysisDimensionKey]> = [
  ["speed", "pace"],
  ["heartRate", "heartRate"],
  ["power", "power"],
  ["cadence", "cadence"],
  ["elevation", "climbing"],
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function dimensionForFeature(key: string): AnalysisDimensionKey | undefined {
  return DIMENSION_BY_FEATURE_PREFIX.find(([prefix]) => key.startsWith(prefix))?.[1];
}

function historyCapabilityAvailable(context: RideAnalysisContext): boolean {
  return getAtomicCapability({
    schemaVersion: "0.1",
    rulesVersion: "atomic-capability-rules-v0.1",
    rideId: context.rideId,
    capabilities: context.capabilities,
  }, "historyComparison").available;
}

export function buildAnalysisEligibility(context: RideAnalysisContext): AnalysisEligibility {
  const contextValidation = validateRideAnalysisContext(context);
  if (!contextValidation.valid) {
    return {
      schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
      rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
      eligible: false,
      status: "blocked",
      reasonCodes: ["CONTEXT_INVALID"],
      insightSources: [],
      allowedDimensionKeys: [],
      requiredClaimIds: [],
      fallback: "b0",
    };
  }

  if (context.safetyFlags.some((flag) => flag === "stop_generation" || flag === "critical_safety")) {
    return {
      schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
      rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
      eligible: false,
      status: "blocked",
      reasonCodes: ["SAFETY_BLOCK"],
      insightSources: [],
      allowedDimensionKeys: [],
      requiredClaimIds: [],
      fallback: "safety_stop",
    };
  }

  if (context.capabilities.every((capability) => capability.unavailableReason === "RECORD_INVALID")) {
    return {
      schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
      rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
      eligible: false,
      status: "blocked",
      reasonCodes: ["RECORD_REJECTED"],
      insightSources: [],
      allowedDimensionKeys: [],
      requiredClaimIds: [],
      fallback: "b0",
    };
  }

  const metricClaims = context.allowedClaims.filter((claim) => claim.kind === "metric");
  const featureClaims = context.allowedClaims.filter((claim) => claim.kind === "feature");
  const historyClaims = context.allowedClaims.filter((claim) => claim.kind === "history");
  if (metricClaims.length === 0) {
    return {
      schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
      rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
      eligible: false,
      status: "not_eligible",
      reasonCodes: ["NO_ALLOWED_CLAIMS"],
      insightSources: [],
      allowedDimensionKeys: [],
      requiredClaimIds: [],
      fallback: "b0",
    };
  }

  const sources: AnalysisInsightSource[] = [];
  const dimensions: AnalysisDimensionKey[] = [];
  const requiredClaimIds: string[] = [];
  if (featureClaims.length > 0) {
    sources.push("feature");
    for (const feature of context.featureSnapshot.features) {
      const dimension = dimensionForFeature(feature.key);
      if (dimension) dimensions.push(dimension);
    }
    requiredClaimIds.push(...featureClaims.map((claim) => claim.claimId));
  }
  if (historyClaims.length > 0 && historyCapabilityAvailable(context)) {
    sources.push("history");
    dimensions.push("history");
    requiredClaimIds.push(...historyClaims.map((claim) => claim.claimId));
  }

  if (sources.length === 0) {
    return {
      schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
      rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
      eligible: false,
      status: "not_eligible",
      reasonCodes: ["NO_INSIGHT_SOURCE"],
      insightSources: [],
      allowedDimensionKeys: [],
      requiredClaimIds: [],
      fallback: "b0",
    };
  }

  return {
    schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
    rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
    eligible: true,
    status: "eligible",
    reasonCodes: [
      ...(featureClaims.length > 0 ? ["FEATURES_AVAILABLE" as const] : []),
      ...(historyClaims.length > 0 && historyCapabilityAvailable(context) ? ["HISTORY_COMPARISON_AVAILABLE" as const] : []),
    ],
    insightSources: unique(sources),
    allowedDimensionKeys: unique(dimensions),
    requiredClaimIds: unique(requiredClaimIds),
    fallback: "b0",
  };
}

export function validateAnalysisEligibility(value: AnalysisEligibility): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (value.schemaVersion !== ANALYSIS_ELIGIBILITY_SCHEMA_VERSION) issues.push("UNSUPPORTED_ELIGIBILITY_SCHEMA_VERSION");
  if (value.rulesVersion !== ANALYSIS_ELIGIBILITY_RULES_VERSION) issues.push("UNSUPPORTED_ELIGIBILITY_RULES_VERSION");
  if (value.eligible !== (value.status === "eligible")) issues.push("ELIGIBILITY_STATUS_MISMATCH");
  if (value.status === "blocked" && value.fallback !== "b0" && value.fallback !== "safety_stop") issues.push("INVALID_BLOCKED_FALLBACK");
  if (value.status !== "blocked" && value.fallback !== "b0") issues.push("INVALID_FALLBACK");
  if (value.allowedDimensionKeys.some((key) => !["endurance", "pace", "climbing", "heartRate", "power", "cadence", "history"].includes(key))) issues.push("UNKNOWN_DIMENSION");
  if (value.insightSources.some((source) => !["feature", "history"].includes(source))) issues.push("UNKNOWN_INSIGHT_SOURCE");
  if (value.status === "eligible" && value.insightSources.length === 0) issues.push("ELIGIBLE_WITHOUT_SOURCE");
  if (value.status !== "eligible" && value.requiredClaimIds.length > 0) issues.push("INELIGIBLE_WITH_REQUIRED_CLAIMS");
  // Keep the registry check runtime-safe without comparing a fixed-length tuple
  // to a literal that TypeScript can prove impossible at compile time.
  if ((atomicCapabilityKeys as readonly AtomicCapabilityKey[]).length === 0) issues.push("CAPABILITY_REGISTRY_EMPTY");
  return { valid: issues.length === 0, issues };
}
