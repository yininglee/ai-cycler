import {
  RIDE_EVIDENCE_RULES_VERSION,
  type EvidenceSource,
  type EvidenceSourceRef,
  type V2AnalysisClaim,
  type V2EvidenceCapability,
} from "./ride-analysis-evidence-v2.ts";
import {
  buildRideCapabilityClaimsV2,
  validateRideCapabilityClaimsV2,
  type BuildRideCapabilityClaimsV2Options,
  type RideCapabilityClaimSnapshotV2,
} from "./ride-capability-claims-v2.ts";
import {
  validateHistoricalComparisonSnapshot,
  type HistoricalComparisonSnapshot,
  type HistoricalMetricComparison,
} from "./historical-comparison.ts";
import type { RideRecord } from "./ride-schema.ts";
import type { UserProfile } from "./user-profile.ts";

export const RIDE_PROFILE_HISTORY_SCHEMA_VERSION = "2.0.0" as const;
export const RIDE_PROFILE_HISTORY_RULES_VERSION = "ride-profile-history-v2.1" as const;

type GateStatus = "available" | "unavailable";

export interface RideProfileSnapshotV2 {
  status: "available" | "missing";
  schemaVersion?: string;
  updatedAt?: string;
  authorizedFields: Array<"age" | "heightCm" | "weightKg" | "maxHeartRate" | "ftp">;
  sourceId?: string;
}

export interface HistoryGateV2 {
  status: GateStatus;
  reason?: string;
  sourceHistoryIds: string[];
  evidenceIds: string[];
  rulesVersion: string;
}

export interface RideProfileHistorySnapshotV2 {
  schemaVersion: typeof RIDE_PROFILE_HISTORY_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_PROFILE_HISTORY_RULES_VERSION;
  rideId: string;
  profile: RideProfileSnapshotV2;
  history: {
    status: "available" | "missing" | "unavailable";
    comparison?: HistoricalComparisonSnapshot;
    comparableMetricKeys: string[];
    sourceHistoryIds: string[];
    evidenceIds: string[];
    reason?: string;
  };
  longTermLoad: HistoryGateV2;
  recoverySignals: HistoryGateV2;
  capabilityClaims: RideCapabilityClaimSnapshotV2;
  limitations: string[];
}

export interface BuildRideProfileHistoryV2Options extends Omit<BuildRideCapabilityClaimsV2Options, "profile"> {
  profile?: UserProfile | null;
  historicalComparison?: HistoricalComparisonSnapshot;
}

export interface ProfileHistoryIssue {
  code: string;
  path: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function historySource(
  rideId: string,
  comparison: HistoricalComparisonSnapshot,
  metric: HistoricalMetricComparison,
  scope: "all" | "same_route",
): EvidenceSource | undefined {
  const candidateRideId = metric.baseline?.sourceHistoryIds[0] ?? comparison.candidateHistoryIds[0];
  const evidenceIds = unique(metric.evidenceIds);
  if (!candidateRideId || candidateRideId === rideId || evidenceIds.length === 0) return undefined;
  return {
    sourceId: `source:${rideId}:history:${scope}:${metric.metricKey}`,
    kind: "history",
    version: `${comparison.comparisonVersion}:${comparison.metricPolicyVersion}`,
    status: "available",
    authorized: true,
    evidenceIds,
    rideId: candidateRideId,
    coverage: `${metric.comparability.sampleCount}/${metric.comparability.minimumSampleCount}`,
  };
}

function historyClaim(
  rideId: string,
  comparison: HistoricalComparisonSnapshot,
  metric: HistoricalMetricComparison,
  source: EvidenceSource,
  scope: "all" | "same_route",
): V2AnalysisClaim | undefined {
  if (metric.comparability.status !== "comparable" || !metric.anchor || !metric.baseline || metric.absoluteChange === undefined) return undefined;
  const sourceRef: EvidenceSourceRef = {
    sourceId: source.sourceId,
    version: source.version,
    evidenceIds: [...source.evidenceIds],
  };
  const sign = metric.absoluteChange >= 0 ? "increase" : "decrease";
  return {
    claimId: `claim:${rideId}:v2:history.${scope}.${metric.metricKey}`,
    rideId,
    kind: "history",
    key: `history.${scope}.${metric.metricKey}`,
    value: metric.absoluteChange,
    unit: metric.anchor.unit,
    text: `${metric.metricKey} ${sign} versus a ${metric.baseline.sampleCount}-ride baseline`,
    confidence: "high",
    provenance: "calculated",
    qualityStatus: "valid",
    sourceRefs: [sourceRef],
    evidenceIds: [...source.evidenceIds],
    formulaVersion: comparison.comparisonVersion,
    supports: ["historical_comparison"],
    prohibits: ["ability_change_without_comparable_history", "recovery_complete", "overtraining", "causation"],
  };
}

function unavailableCapability(
  key: V2EvidenceCapability["key"],
  dependencyKeys: V2EvidenceCapability["dependencyKeys"],
  reason: string,
  supports: string[] = [],
  prohibits: string[] = [],
): V2EvidenceCapability {
  return {
    key,
    status: "unavailable",
    qualityStatus: "unavailable",
    dependencyKeys: [...dependencyKeys],
    sourceIds: [],
    evidenceIds: [],
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    supports,
    prohibits,
    unavailableReason: reason,
  };
}

function availableCapability(
  key: V2EvidenceCapability["key"],
  dependencyKeys: V2EvidenceCapability["dependencyKeys"],
  sourceIds: string[],
  evidenceIds: string[],
  supports: string[],
  prohibits: string[],
): V2EvidenceCapability {
  return {
    key,
    status: "available",
    qualityStatus: "valid",
    dependencyKeys: [...dependencyKeys],
    sourceIds: unique(sourceIds),
    evidenceIds: unique(evidenceIds),
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    supports,
    prohibits,
  };
}

function profileSnapshot(profile: UserProfile | null | undefined, sourceInventory: EvidenceSource[]): RideProfileSnapshotV2 {
  const source = sourceInventory.find((item) => item.kind === "profile");
  const fields = (["age", "heightCm", "weightKg", "maxHeartRate", "ftp"] as const).filter((key) => Boolean(profile?.[key]));
  if (!profile || fields.length === 0 || !source || source.status !== "available") {
    return { status: "missing", authorizedFields: [] };
  }
  return {
    status: "available",
    schemaVersion: profile.schemaVersion,
    updatedAt: profile.updatedAt,
    authorizedFields: [...fields],
    sourceId: source.sourceId,
  };
}

function historyState(
  rideId: string,
  comparison: HistoricalComparisonSnapshot | undefined,
  claims: V2AnalysisClaim[],
): RideProfileHistorySnapshotV2["history"] {
  if (!comparison) {
    return {
      status: "missing",
      comparableMetricKeys: [],
      sourceHistoryIds: [],
      evidenceIds: [],
      reason: "HISTORY_NOT_PROVIDED",
    };
  }
  const comparableClaims = claims.filter((claim) => claim.kind === "history");
  const evidenceIds = unique(comparableClaims.flatMap((claim) => claim.evidenceIds));
  const comparableMetricKeys = unique(comparableClaims.map((claim) => claim.key));
  return {
    status: comparableClaims.length > 0 ? "available" : "unavailable",
    comparison,
    comparableMetricKeys,
    sourceHistoryIds: [...comparison.candidateHistoryIds],
    evidenceIds,
    ...(comparableClaims.length > 0 ? {} : { reason: "NO_COMPARABLE_HISTORY" }),
  };
}

export function buildRideProfileHistoryV2(
  record: RideRecord,
  options: BuildRideProfileHistoryV2Options = {},
): RideProfileHistorySnapshotV2 {
  const capabilityClaims = buildRideCapabilityClaimsV2(record, {
    ...options,
    profile: options.profile,
  });
  const comparison = options.historicalComparison;
  if (comparison && comparison.anchorRideId !== record.activity.rideId) {
    throw new Error("S3-01 historical comparison does not match the ride");
  }
  if (comparison && !validateHistoricalComparisonSnapshot(comparison).valid) {
    throw new Error("S3-01 historical comparison snapshot is invalid");
  }

  const historySources: EvidenceSource[] = [];
  const historyClaims: V2AnalysisClaim[] = [];
  if (comparison) {
    for (const [scope, metrics] of [["all", comparison.metrics], ["same_route", comparison.sameRoute.metrics]] as const) {
      for (const metric of metrics) {
        const source = historySource(record.activity.rideId, comparison, metric, scope);
        const claim = source ? historyClaim(record.activity.rideId, comparison, metric, source, scope) : undefined;
        if (source && claim) {
          historySources.push(source);
          historyClaims.push(claim);
        }
      }
    }
  }

  const sourceInventory = [...capabilityClaims.sourceInventory, ...historySources];
  const claims = [...capabilityClaims.claims, ...historyClaims];
  const comparisonAvailable = historyClaims.length > 0;
  const sameRouteClaims = historyClaims.filter((claim) => claim.key.startsWith("history.same_route."));
  const capabilities = capabilityClaims.capabilities.map((capability) => {
    if (capability.key === "historyComparison") {
      return comparisonAvailable
        ? availableCapability("historyComparison", [], historySources.map((source) => source.sourceId), historyClaims.flatMap((claim) => claim.evidenceIds), ["historical_comparison"], ["ability_change_without_comparable_history", "recovery_complete", "causation"])
        : unavailableCapability("historyComparison", [], comparison ? "NO_COMPARABLE_HISTORY" : "HISTORY_NOT_PROVIDED", ["historical_comparison"], ["ability_change_without_comparable_history", "recovery_complete", "causation"]);
    }
    if (capability.key === "sameRouteComparison") {
      return sameRouteClaims.length > 0
        ? availableCapability("sameRouteComparison", ["historyComparison"], sameRouteClaims.flatMap((claim) => claim.sourceRefs.map((ref) => ref.sourceId)), sameRouteClaims.flatMap((claim) => claim.evidenceIds), ["same_route_comparison"], ["ability_change_without_comparable_history", "causation"])
        : unavailableCapability("sameRouteComparison", ["historyComparison"], comparisonAvailable ? "NO_COMPARABLE_SAME_ROUTE_HISTORY" : "HISTORY_NOT_AVAILABLE", ["same_route_comparison"], ["ability_change_without_comparable_history", "causation"]);
    }
    return capability;
  });

  const history = historyState(record.activity.rideId, comparison, historyClaims);
  const longTermReason = comparisonAvailable ? "HISTORY_WINDOW_NOT_IMPLEMENTED" : "HISTORY_NOT_AVAILABLE";
  const longTermLoad = { status: "unavailable" as const, reason: longTermReason, sourceHistoryIds: [...history.sourceHistoryIds], evidenceIds: [], rulesVersion: RIDE_PROFILE_HISTORY_RULES_VERSION };
  const recoverySignals = { status: "unavailable" as const, reason: longTermReason, sourceHistoryIds: [...history.sourceHistoryIds], evidenceIds: [], rulesVersion: RIDE_PROFILE_HISTORY_RULES_VERSION };
  const limitations = unique([
    ...capabilityClaims.limitations,
    `history.longTermLoad:${longTermReason}`,
    `history.recoverySignals:${longTermReason}`,
    ...(history.status !== "available" ? [`history.comparison:${history.reason}`] : []),
  ]);
  const snapshot: RideCapabilityClaimSnapshotV2 = {
    ...capabilityClaims,
    sourceInventory,
    capabilities,
    claims,
    limitations,
  };
  const issues = validateRideCapabilityClaimsV2(snapshot);
  if (issues.length) throw new Error(`S3-01 capability snapshot is invalid: ${issues.map((issue) => issue.code).join(",")}`);

  return {
    schemaVersion: RIDE_PROFILE_HISTORY_SCHEMA_VERSION,
    rulesVersion: RIDE_PROFILE_HISTORY_RULES_VERSION,
    rideId: record.activity.rideId,
    profile: profileSnapshot(options.profile, sourceInventory),
    history,
    longTermLoad,
    recoverySignals,
    capabilityClaims: snapshot,
    limitations,
  };
}

export function validateRideProfileHistoryV2(snapshot: RideProfileHistorySnapshotV2): ProfileHistoryIssue[] {
  const issues: ProfileHistoryIssue[] = [];
  const add = (code: string, path: string): void => {
    issues.push({ code, path });
  };
  if (snapshot.schemaVersion !== RIDE_PROFILE_HISTORY_SCHEMA_VERSION || snapshot.rulesVersion !== RIDE_PROFILE_HISTORY_RULES_VERSION) add("VERSION_MISMATCH", "version");
  if (!snapshot.rideId.trim() || snapshot.capabilityClaims.rideId !== snapshot.rideId) add("RIDE_ID_MISMATCH", "rideId");
  if (validateRideCapabilityClaimsV2(snapshot.capabilityClaims).length) add("CAPABILITY_SNAPSHOT_INVALID", "capabilityClaims");
  if (snapshot.history.comparison) {
    const validation = validateHistoricalComparisonSnapshot(snapshot.history.comparison);
    if (!validation.valid) add("HISTORY_SNAPSHOT_INVALID", "history.comparison");
    if (snapshot.history.comparison.anchorRideId !== snapshot.rideId) add("HISTORY_ANCHOR_MISMATCH", "history.comparison.anchorRideId");
  }
  if (snapshot.longTermLoad.status === "available" || snapshot.recoverySignals.status === "available") add("UNSUPPORTED_LONG_TERM_GATE", "history");
  if (snapshot.profile.status === "available" && (!snapshot.profile.schemaVersion || !snapshot.profile.updatedAt || !snapshot.profile.sourceId)) add("PROFILE_SNAPSHOT_INCOMPLETE", "profile");
  return issues;
}
