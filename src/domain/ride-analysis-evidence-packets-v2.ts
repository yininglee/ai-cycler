import {
  analysisDimensionIds,
  RIDE_EVIDENCE_RULES_VERSION,
  RIDE_EVIDENCE_SCHEMA_VERSION,
  validateRideAnalysisEvidenceV2,
  type AnalysisDimensionId,
  type EvidenceCapabilityKey,
  type EvidenceClaimGroup,
  type RideAnalysisEvidenceV2,
  type V2AnalysisClaim,
  type V2EvidenceCapability,
  type V2EvidenceCoverage,
  type V2EvidencePacket,
} from "./ride-analysis-evidence-v2.ts";
import {
  validateRideCapabilityClaimsV2,
  type RideCapabilityClaimSnapshotV2,
} from "./ride-capability-claims-v2.ts";

// S2-03 (PD-AI-16): v2.3 — packets that carry aggregated fixed-window relation
// claims now disclose the aggregation and the underlying window count.
// S2-05 (user decision 2026-10-06, option B): v2.6 — crossSensorCoordination
// carries fixed-window relation aggregates only; segment-level relation claims
// are removed and segment context no longer enters this packet.
export const RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION = "ride-evidence-packet-builder-v2.6" as const;

export interface BuildRideAnalysisEvidencePacketsV2Options {
  analysisRunId: string;
  userScope: string;
}

interface PacketDefinition {
  dimensionId: AnalysisDimensionId;
  question: string;
  required: EvidenceCapabilityKey[];
  optional: EvidenceCapabilityKey[];
  supports: string[];
  keyPrefixes: string[];
  prohibits: string[];
}

// PD-AI-30 (user decision 2026-10-07): segment sensor observations follow the
// sensor's dimension (mirroring the climb precedent — heartRateLoad already
// carried climb_heart_rate_observation). Cruise/terrain heart-rate, terrain
// power/cadence and terrain speed observations previously reached only
// pacing/power via the segment.cruise. key prefix — an implementation accident,
// not a design choice: the model's intuition "a heart-rate claim belongs in the
// heart-rate dimension" kept tripping CLAIM_NOT_IN_DIMENSION. The tags below
// complete the segment×sensor observation matrix; emitted packet.supports stay
// derived from the actual claims in the packet (no unbacked-tag risk on rides
// without the corresponding segments).
const PACKET_DEFINITIONS: readonly PacketDefinition[] = [
  {
    dimensionId: "pacingExecution",
    question: "How did pacing execution, stops, and within-ride stages behave?",
    required: ["distance", "timing", "speed", "sensorContinuity"],
    optional: ["route", "stops", "cruise", "speedStability", "terrain"],
    supports: ["ride_distance", "current_ride_timing", "stop_observation", "cruise_segment", "terrain_segment", "speed_level", "speed_stability", "speed_stage_comparison"],
    keyPrefixes: ["timing.", "stops.", "speed.", "segment.cruise.", "segment.terrain.", "cruise.", "pacing."],
    prohibits: ["training_plan_completion", "intent", "race_strategy_success", "causation"],
  },
  {
    dimensionId: "climbPerformance",
    question: "What do the qualified climb and terrain segments show?",
    required: ["elevation", "climbing", "timing"],
    optional: ["power", "heartRate", "speedStability", "crossSensorAlignment"],
    supports: ["ride_distance", "current_ride_timing", "elevation_context", "terrain_segment", "climb_segment", "climb_fact", "climb_power_observation", "climb_heart_rate_observation", "climb_speed_observation", "climb_cadence_observation", "terrain_power_observation", "terrain_heart_rate_observation", "terrain_speed_observation", "terrain_cadence_observation", "relative_power_output"],
    keyPrefixes: ["elevation.", "timing.", "segment.terrain.", "segment.climb.", "climb."],
    prohibits: ["ability_change", "technical_diagnosis", "causation"],
  },
  {
    dimensionId: "heartRateLoad",
    question: "What does the heart-rate level, distribution, and within-ride change show?",
    required: ["heartRate"],
    optional: ["maxHeartRateBaseline", "heartRateZones", "heartRateDrift", "crossSensorAlignment", "timing"],
    supports: ["heart_rate_level", "heart_rate_stability", "heart_rate_stage_comparison", "heart_rate_zone_baseline", "heart_rate_zone_distribution", "heart_rate_drift", "climb_segment", "climb_heart_rate_observation", "current_ride_timing", "same_window_observation", "cruise_segment", "cruise_heart_rate_observation", "terrain_segment", "terrain_heart_rate_observation"],
    keyPrefixes: ["heart_rate.", "heartRate.", "profile.maxHeartRate"],
    prohibits: ["medical_diagnosis", "recovery_complete", "causation"],
  },
  {
    dimensionId: "powerOutput",
    question: "What do power level, stability, peaks, and qualified segments show?",
    required: ["power", "sensorContinuity"],
    optional: ["powerStability", "powerPeaks", "normalizedPower", "cruise", "crossSensorAlignment"],
    supports: ["power_level", "power_stability", "power_stage_comparison", "short_duration_power_peak", "normalized_power_output", "power_variability", "cruise_power_observation", "climb_segment", "climb_power_observation", "current_ride_timing", "same_window_observation", "terrain_segment", "terrain_power_observation"],
    keyPrefixes: ["power.", "segment.cruise."],
    prohibits: ["ability_change", "causation", "bridge_recording_gap"],
  },
  {
    dimensionId: "intensityAndTrainingLoad",
    question: "What intensity and single-ride training-load facts are supported?",
    required: ["power", "normalizedPower", "verifiedFtp", "timing"],
    optional: ["powerZones", "intensity", "trainingLoad", "userProfile"],
    supports: ["power_level", "normalized_power_output", "ftp_dependent_calculation", "power_zone_distribution", "ride_intensity_factor", "single_ride_training_load", "current_ride_timing", "relative_power_output", "activity_energy"],
    keyPrefixes: ["power.", "profile.verifiedFtp"],
    prohibits: ["recovery", "injury_risk", "training_effect", "ftp_estimate_as_confirmed"],
  },
  {
    dimensionId: "cadenceStrategy",
    question: "What does cadence level, distribution, and sensor alignment show?",
    required: ["cadence", "timing"],
    optional: ["cadenceZones", "crossSensorAlignment", "power", "speed"],
    supports: ["cadence_level", "cadence_stability", "cadence_stage_comparison", "cadence_zone_distribution", "cruise_segment", "cruise_cadence_observation", "climb_segment", "climb_cadence_observation", "same_window_observation", "terrain_segment", "terrain_cadence_observation"],
    keyPrefixes: ["cadence."],
    prohibits: ["efficiency_without_pairing", "riding_posture_diagnosis", "causation"],
  },
  {
    dimensionId: "crossSensorCoordination",
    question: "What same-window relationships are observed across sensors?",
    required: ["crossSensorAlignment"],
    optional: ["power", "heartRate", "speed", "cadence", "timing"],
    // S2-05 (user decision 2026-10-06, option B): this packet carries the
    // fixed-window relation aggregates (PD-AI-16) only — segment-level relation
    // evidence no longer exists and segment context stays in its own dimensions.
    supports: ["same_window_observation", "aerobic_efficiency"],
    keyPrefixes: ["relation.fixed."],
    prohibits: ["causation", "response_order", "trend"],
  },
  {
    dimensionId: "historicalPerformance",
    question: "How does this ride compare with qualified personal history?",
    required: ["historyComparison"],
    optional: ["sameRouteComparison", "trainingLoad"],
    supports: ["historical_comparison", "same_route_comparison"],
    keyPrefixes: ["history.all.", "history.same_route.", "sameRoute."],
    prohibits: ["ability_change_without_comparable_history", "recovery_complete", "overtraining", "causation"],
  },
  // PMC-01 (user decision 2026-10-06): long-term load and recovery statistics
  // get their own packet. Its admission gates are the PMC window doors
  // (confirmed FTP, >= 42-day window, >= 10 load days) — it never depends on
  // having a comparable single ride, and the relative-past packet above never
  // swallows PMC claims.
  {
    dimensionId: "longTermLoadRecovery",
    question: "What do the long-term load (CTL/ATL) and the load-balance signal (TSB) show?",
    required: ["longTermLoad", "recoverySignals"],
    optional: [],
    supports: ["long_term_load", "recovery_signal"],
    keyPrefixes: ["history.pmc.", "longTerm.", "recovery."],
    prohibits: ["causation", "overtraining", "medical_diagnosis", "injury_prediction", "ability_change_without_comparable_history"],
  },
];

const requiredPrivacyFlags = [
  "raw_track_excluded",
  "precise_coordinates_excluded",
  "source_filename_excluded",
  "untrusted_free_text_excluded",
] as const;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function claimGroup(claim: V2AnalysisClaim): EvidenceClaimGroup {
  if (claim.kind === "history" || claim.kind === "relation" || claim.kind === "limitation") return claim.kind;
  return claim.provenance;
}

function capability(snapshot: RideCapabilityClaimSnapshotV2, key: EvidenceCapabilityKey): V2EvidenceCapability {
  const value = snapshot.capabilities.find((item) => item.key === key);
  if (!value) throw new Error(`Capability is missing from S2-01 snapshot: ${key}`);
  return value;
}

function claimMatches(claim: V2AnalysisClaim, definition: PacketDefinition): boolean {
  return claim.supports.some((support) => definition.supports.includes(support))
    || definition.keyPrefixes.some((prefix) => claim.key.startsWith(prefix));
}

function coverage(
  snapshot: RideCapabilityClaimSnapshotV2,
  keys: EvidenceCapabilityKey[],
  required: boolean,
): V2EvidenceCoverage[] {
  return keys.map((key) => {
    const value = capability(snapshot, key);
    if (value.status !== "unavailable") return { capabilityKey: key, status: "fulfilled" };
    return {
      capabilityKey: key,
      status: required ? "missing" : "missing",
      reason: value.unavailableReason ?? "CAPABILITY_UNAVAILABLE",
    };
  });
}

function packetClaims(snapshot: RideCapabilityClaimSnapshotV2, definition: PacketDefinition): V2AnalysisClaim[] {
  return snapshot.claims.filter((claim) => claimMatches(claim, definition));
}

function claimGroups(claims: V2AnalysisClaim[]): Record<EvidenceClaimGroup, string[]> {
  const groups: Record<EvidenceClaimGroup, string[]> = {
    recorded: [], calculated: [], estimated: [], history: [], relation: [], limitation: [],
  };
  for (const claim of claims) groups[claimGroup(claim)].push(claim.claimId);
  return groups;
}

function buildPacket(
  snapshot: RideCapabilityClaimSnapshotV2,
  definition: PacketDefinition,
): V2EvidencePacket | undefined {
  const requiredCapabilities = definition.required.map((key) => capability(snapshot, key));
  if (requiredCapabilities.some((item) => item.status === "unavailable")) return undefined;

  const claims = packetClaims(snapshot, definition);
  if (claims.length === 0) return undefined;

  const optionalCoverage = coverage(snapshot, definition.optional, false);
  const requiredCoverage = coverage(snapshot, definition.required, true);
  const qualityStatus = requiredCapabilities.some((item) => item.status === "partial")
    || claims.some((claim) => claim.qualityStatus === "soft") ? "soft" : "valid";
  const missingLimitations = [...requiredCoverage, ...optionalCoverage]
    .filter((item) => item.status === "missing")
    .map((item) => `${item.capabilityKey}:${item.reason ?? "CAPABILITY_UNAVAILABLE"}`);
  // S2-03 (PD-AI-16): a packet that carries an aggregated fixed-window
  // relation claim must disclose that the pair's relation evidence arrives
  // as an aggregate over N windows, not as per-window observation.
  const aggregationLimitations = claims
    .filter((item) => item.aggregatedFromCount !== undefined)
    .map((item) => `${item.key}:AGGREGATED_FROM_${item.aggregatedFromCount}_WINDOWS`);
  const supports = unique(claims.flatMap((claim) => claim.supports));
  const prohibits = unique([...definition.prohibits, ...claims.flatMap((claim) => claim.prohibits)]);
  const claimIds = claims.map((claim) => claim.claimId);

  return {
    packetVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    rideId: snapshot.rideId,
    dimensionId: definition.dimensionId,
    question: definition.question,
    eligibility: qualityStatus === "valid" ? "available" : "partial",
    requiredEvidence: requiredCoverage,
    optionalEvidence: optionalCoverage,
    claimIds,
    claimGroups: claimGroups(claims),
    qualityStatus,
    limitations: unique([...snapshot.limitations, ...missingLimitations, ...aggregationLimitations]),
    supports,
    prohibits,
    knowledgeIds: [],
    recommendationAnchorClaimIds: claims.filter((claim) => claim.kind !== "limitation").map((claim) => claim.claimId),
  };
}

export function buildRideAnalysisEvidencePacketsV2(
  snapshot: RideCapabilityClaimSnapshotV2,
  options: BuildRideAnalysisEvidencePacketsV2Options,
): RideAnalysisEvidenceV2 {
  const snapshotIssues = validateRideCapabilityClaimsV2(snapshot);
  if (snapshotIssues.length) throw new Error(`S2-01 snapshot is invalid: ${snapshotIssues.map((issue) => issue.code).join(",")}`);
  if (!options.analysisRunId.trim() || !options.userScope.trim()) throw new Error("S2-02 requires analysisRunId and userScope");

  const packets = PACKET_DEFINITIONS
    .map((definition) => buildPacket(snapshot, definition))
    .filter((packet): packet is V2EvidencePacket => packet !== undefined);
  const packetClaimIds = new Set(packets.flatMap((packet) => packet.claimIds));
  const allowedClaims = snapshot.claims
    .filter((claim) => packetClaimIds.has(claim.claimId))
    .map((claim) => ({
      ...claim,
      sourceRefs: claim.sourceRefs.map((ref) => ({ ...ref, evidenceIds: [...ref.evidenceIds] })),
      evidenceIds: [...claim.evidenceIds],
      supports: [...claim.supports],
      prohibits: [...claim.prohibits],
    }));
  const context: RideAnalysisEvidenceV2 = {
    schemaVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    rideId: snapshot.rideId,
    analysisRunId: options.analysisRunId,
    userScope: options.userScope,
    sourceInventory: snapshot.sourceInventory.map((source) => ({ ...source, evidenceIds: [...source.evidenceIds] })),
    capabilities: snapshot.capabilities.map((item) => ({
      ...item,
      dependencyKeys: [...item.dependencyKeys],
      sourceIds: [...item.sourceIds],
      evidenceIds: [...item.evidenceIds],
      supports: [...item.supports],
      prohibits: [...item.prohibits],
    })),
    allowedClaims,
    knowledgeEvidence: [],
    evidencePackets: packets,
    privacyFlags: [...requiredPrivacyFlags],
  };
  const issues = validateRideAnalysisEvidenceV2(context);
  if (issues.length) throw new Error(`S2-02 packet context is invalid: ${issues.map((issue) => issue.code).join(",")}`);
  return context;
}

export function getRideAnalysisEvidencePacketV2(
  context: RideAnalysisEvidenceV2,
  dimensionId: AnalysisDimensionId,
): V2EvidencePacket | undefined {
  if (!analysisDimensionIds.includes(dimensionId)) throw new Error(`Unknown analysis dimension: ${dimensionId}`);
  return context.evidencePackets.find((packet) => packet.dimensionId === dimensionId);
}
