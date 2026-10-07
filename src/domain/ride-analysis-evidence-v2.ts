export const RIDE_EVIDENCE_SCHEMA_VERSION = "2.0.0" as const;
// v2.1.0 (2026-10-07, PD-AI-30): dimension packets now admit segment sensor
// observations by sensor ownership (cruise/terrain heart-rate, terrain
// power/cadence/speed) in addition to the key-prefix routing — completes the
// segment×sensor observation matrix so model intuition ("a heart-rate claim
// belongs in the heart-rate dimension") matches the packet boundaries.
export const RIDE_EVIDENCE_RULES_VERSION = "ride-evidence-rules-v2.1.0" as const;

export const analysisDimensionIds = [
  "pacingExecution", "climbPerformance", "heartRateLoad", "powerOutput",
  "intensityAndTrainingLoad", "cadenceStrategy", "crossSensorCoordination", "historicalPerformance",
  "longTermLoadRecovery",
] as const;
export type AnalysisDimensionId = (typeof analysisDimensionIds)[number];

export const evidenceCapabilityKeys = [
  "route", "distance", "timing", "stops", "cruise", "speed", "speedStability",
  "elevation", "terrain", "climbing", "heartRate", "maxHeartRateBaseline",
  "heartRateZones", "heartRateDrift", "power", "powerStability", "powerPeaks",
  "normalizedPower", "verifiedFtp", "powerZones", "intensity", "trainingLoad",
  "cadence", "cadenceZones", "crossSensorAlignment", "sensorContinuity",
  "userProfile", "historyComparison", "longTermLoad", "recoverySignals",
  "sameRouteComparison", "trend", "knowledgeEvidence",
] as const;
export type EvidenceCapabilityKey = (typeof evidenceCapabilityKeys)[number];

export type EvidenceSourceKind = "activity" | "series" | "profile" | "history" | "summary" | "knowledge";
export type EvidenceQuality = "valid" | "soft" | "unavailable";
export type EvidenceClaimGroup = "recorded" | "calculated" | "estimated" | "history" | "relation" | "limitation";

export interface EvidenceSource {
  sourceId: string;
  kind: EvidenceSourceKind;
  version: string;
  status: "available" | "missing" | "unavailable";
  authorized: boolean;
  evidenceIds: string[];
  rideId?: string;
  coverage?: string;
  missingReason?: string;
}

export interface EvidenceSourceRef {
  sourceId: string;
  version: string;
  evidenceIds: string[];
}

export interface V2AnalysisClaim {
  claimId: string;
  rideId: string;
  kind: "metric" | "feature" | "advanced" | "history" | "relation" | "limitation";
  key: string;
  value?: number;
  unit?: string;
  text?: string;
  confidence: "high" | "medium" | "low";
  provenance: "recorded" | "calculated" | "estimated";
  qualityStatus: "valid" | "soft";
  sourceRefs: EvidenceSourceRef[];
  evidenceIds: string[];
  formulaVersion?: string;
  displayValue?: string;
  displayUnit?: string;
  supports: string[];
  prohibits: string[];
  // S2-03 (PD-AI-16, user decision 2026-10-06): present only on aggregated
  // fixed-window relation claims; records how many underlying windows the
  // claim summarizes so packets, model input stats, and evaluation runs can
  // distinguish aggregated evidence from per-window evidence.
  aggregatedFromCount?: number;
}

export interface V2EvidenceCapability {
  key: EvidenceCapabilityKey;
  status: "available" | "partial" | "unavailable";
  qualityStatus: EvidenceQuality;
  dependencyKeys: EvidenceCapabilityKey[];
  sourceIds: string[];
  evidenceIds: string[];
  rulesVersion: string;
  supports: string[];
  prohibits: string[];
  unavailableReason?: string;
}

export interface V2KnowledgeEvidence {
  knowledgeId: string;
  sourceRef: EvidenceSourceRef;
  citation: string;
  // PMC-01 follow-up (user decision 2026-10-06): the self-written explanation
  // travels with the citation contract into the model input so the model can
  // only transcribe this text (never invent knowledge content), and the output
  // validator can whitelist numbers that genuinely come from it.
  explanation: string;
  applicableDimensions: AnalysisDimensionId[];
  conditions: string[];
  // S3-02 additions, recorded per V2 business rules 11.2: retrieval time, knowledge-base
  // version, conclusion strength, known limitations, safety boundaries, and the ride-fact
  // keys this knowledge must never replace or fabricate.
  retrievedAt?: string;
  knowledgeBaseVersion?: string;
  conclusionStrength?: "high" | "moderate" | "limited";
  limitations?: string[];
  safetyBoundaries?: string[];
  forbiddenFactKeys?: string[];
}

export interface V2EvidenceCoverage {
  capabilityKey: EvidenceCapabilityKey;
  status: "fulfilled" | "missing";
  reason?: string;
}

export interface V2EvidencePacket {
  packetVersion: typeof RIDE_EVIDENCE_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_EVIDENCE_RULES_VERSION;
  rideId: string;
  dimensionId: AnalysisDimensionId;
  question: string;
  eligibility: "available" | "partial";
  requiredEvidence: V2EvidenceCoverage[];
  optionalEvidence: V2EvidenceCoverage[];
  claimIds: string[];
  claimGroups: Record<EvidenceClaimGroup, string[]>;
  qualityStatus: "valid" | "soft";
  limitations: string[];
  supports: string[];
  prohibits: string[];
  knowledgeIds: string[];
  recommendationAnchorClaimIds: string[];
}

export interface RideAnalysisEvidenceV2 {
  schemaVersion: typeof RIDE_EVIDENCE_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_EVIDENCE_RULES_VERSION;
  rideId: string;
  analysisRunId: string;
  userScope: string;
  sourceInventory: EvidenceSource[];
  capabilities: V2EvidenceCapability[];
  allowedClaims: V2AnalysisClaim[];
  knowledgeEvidence: V2KnowledgeEvidence[];
  evidencePackets: V2EvidencePacket[];
  privacyFlags: string[];
}

export interface EvidenceContractIssue {
  code: string;
  path: string;
}

const requiredPrivacyFlags = [
  "raw_track_excluded", "precise_coordinates_excluded",
  "source_filename_excluded", "untrusted_free_text_excluded",
];
const forbiddenInputKeys = new Set([
  "filename", "latitude", "longitude", "coordinates", "rawtrack", "points", "accesstoken",
]);

function claimGroup(claim: V2AnalysisClaim): EvidenceClaimGroup {
  if (claim.kind === "history" || claim.kind === "relation" || claim.kind === "limitation") return claim.kind;
  return claim.provenance;
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => seen.has(id) || !seen.add(id));
}

// This validates internally built, typed evidence. Untrusted JSON still needs parsing at the API boundary.
export function validateRideAnalysisEvidenceV2(context: RideAnalysisEvidenceV2): EvidenceContractIssue[] {
  const issues: EvidenceContractIssue[] = [];
  const add = (code: string, path: string): void => { issues.push({ code, path }); };
  if (context.schemaVersion !== RIDE_EVIDENCE_SCHEMA_VERSION || context.rulesVersion !== RIDE_EVIDENCE_RULES_VERSION) add("CONTEXT_VERSION_MISMATCH", "version");
  if (!context.rideId?.trim() || !context.analysisRunId?.trim() || !context.userScope?.trim()) add("CONTEXT_ID_MISSING", "context");
  for (const flag of requiredPrivacyFlags) if (!context.privacyFlags.includes(flag)) add("PRIVACY_FLAG_MISSING", `privacyFlags.${flag}`);

  const sources = new Map(context.sourceInventory.map((source) => [source.sourceId, source]));
  if (sources.size !== context.sourceInventory.length) add("DUPLICATE_SOURCE", "sourceInventory");
  for (const source of context.sourceInventory) {
    if (!source.sourceId.trim() || !source.version.trim()) add("SOURCE_VERSION_MISSING", `sourceInventory.${source.sourceId}`);
    if ((source.kind === "activity" || source.kind === "series" || source.kind === "summary") && source.rideId !== context.rideId) add("SOURCE_RIDE_MISMATCH", `sourceInventory.${source.sourceId}`);
    if (source.kind === "history" && (!source.rideId || source.rideId === context.rideId)) add("HISTORY_SOURCE_RIDE_INVALID", `sourceInventory.${source.sourceId}`);
    if (duplicateIds(source.evidenceIds).length) add("DUPLICATE_SOURCE_EVIDENCE", `sourceInventory.${source.sourceId}`);
    if (source.status !== "available" && !source.missingReason?.trim()) add("SOURCE_REASON_MISSING", `sourceInventory.${source.sourceId}`);
  }

  const checkRefs = (refs: EvidenceSourceRef[], evidenceIds: string[], path: string, allowKnowledge: boolean): void => {
    if (!refs.length || !evidenceIds.length || duplicateIds(evidenceIds).length) add("CLAIM_EVIDENCE_INVALID", path);
    const collected: string[] = [];
    for (const ref of refs) {
      const source = sources.get(ref.sourceId);
      if (!source || source.version !== ref.version) { add("SOURCE_REF_INVALID", path); continue; }
      if (source.status !== "available" || !source.authorized) add("SOURCE_NOT_AUTHORIZED", path);
      if (source.kind === "knowledge" && !allowKnowledge || source.kind !== "knowledge" && allowKnowledge) add("SOURCE_KIND_INVALID", path);
      if (!ref.evidenceIds.length || ref.evidenceIds.some((id) => !source.evidenceIds.includes(id))) add("EVIDENCE_REF_INVALID", path);
      collected.push(...ref.evidenceIds);
    }
    if (duplicateIds(collected).length || collected.length !== evidenceIds.length || collected.some((id) => !evidenceIds.includes(id))) add("EVIDENCE_INDEX_MISMATCH", path);
  };

  const claims = new Map(context.allowedClaims.map((claim) => [claim.claimId, claim]));
  if (claims.size !== context.allowedClaims.length) add("DUPLICATE_CLAIM", "allowedClaims");
  for (const claim of context.allowedClaims) {
    const path = `allowedClaims.${claim.claimId}`;
    if (!claim.claimId.trim() || !claim.key.trim() || claim.rideId !== context.rideId) add("CLAIM_RIDE_OR_ID_INVALID", path);
    if (claim.value !== undefined && !Number.isFinite(claim.value)) add("NON_FINITE_CLAIM_VALUE", path);
    if (claim.kind !== "limitation" && claim.value === undefined || claim.kind === "limitation" && !claim.text?.trim()) add("CLAIM_VALUE_MISSING", path);
    if (claim.qualityStatus !== "valid" && claim.qualityStatus !== "soft") add("CLAIM_QUALITY_INVALID", path);
    if (claim.provenance !== "recorded" && !claim.formulaVersion?.trim() && claim.kind !== "history") add("CLAIM_FORMULA_VERSION_MISSING", path);
    checkRefs(claim.sourceRefs, claim.evidenceIds, path, false);
    if (claim.kind === "history" && !claim.sourceRefs.some((ref) => sources.get(ref.sourceId)?.kind === "history")) add("HISTORY_EVIDENCE_MISSING", path);
  }

  const capabilities = new Map(context.capabilities.map((capability) => [capability.key, capability]));
  if (capabilities.size !== context.capabilities.length || evidenceCapabilityKeys.some((key) => !capabilities.has(key))) add("CAPABILITY_SET_INCOMPLETE", "capabilities");
  for (const capability of context.capabilities) {
    const path = `capabilities.${capability.key}`;
    if (capability.rulesVersion !== context.rulesVersion) add("CAPABILITY_VERSION_MISMATCH", path);
    if (capability.status === "unavailable" && (!capability.unavailableReason?.trim() || capability.qualityStatus !== "unavailable")) add("UNAVAILABLE_CAPABILITY_INVALID", path);
    if (capability.status === "available" && (capability.qualityStatus === "unavailable" || !capability.evidenceIds.length)) add("AVAILABLE_CAPABILITY_UNSUPPORTED", path);
    if (capability.sourceIds.some((id) => !sources.has(id) || !sources.get(id)?.authorized || sources.get(id)?.status !== "available")) add("CAPABILITY_SOURCE_INVALID", path);
    if (capability.evidenceIds.some((id) => !capability.sourceIds.some((sourceId) => sources.get(sourceId)?.evidenceIds.includes(id)))) add("CAPABILITY_EVIDENCE_INVALID", path);
  }

  const knowledge = new Map(context.knowledgeEvidence.map((item) => [item.knowledgeId, item]));
  if (knowledge.size !== context.knowledgeEvidence.length) add("DUPLICATE_KNOWLEDGE", "knowledgeEvidence");
  for (const item of context.knowledgeEvidence) {
    if (!item.citation.trim() || !item.applicableDimensions.length) add("KNOWLEDGE_SCOPE_INVALID", `knowledgeEvidence.${item.knowledgeId}`);
    checkRefs([item.sourceRef], item.sourceRef.evidenceIds, `knowledgeEvidence.${item.knowledgeId}`, true);
  }

  const indexed = new Set<string>();
  const dimensions = new Set<AnalysisDimensionId>();
  for (const packet of context.evidencePackets) {
    const path = `evidencePackets.${packet.dimensionId}`;
    if (dimensions.has(packet.dimensionId)) add("DUPLICATE_PACKET", path);
    dimensions.add(packet.dimensionId);
    if (!analysisDimensionIds.includes(packet.dimensionId) || packet.rideId !== context.rideId || !packet.question.trim()) add("PACKET_SCOPE_INVALID", path);
    if (packet.packetVersion !== context.schemaVersion || packet.rulesVersion !== context.rulesVersion) add("PACKET_VERSION_MISMATCH", path);
    if (!packet.claimIds.length || duplicateIds(packet.claimIds).length) add("PACKET_CLAIMS_INVALID", path);
    const grouped: string[] = [];
    for (const group of ["recorded", "calculated", "estimated", "history", "relation", "limitation"] as const) {
      for (const id of packet.claimGroups[group]) {
        grouped.push(id);
        if (!claims.has(id) || claimGroup(claims.get(id)!) !== group) add("CLAIM_GROUP_INVALID", path);
      }
    }
    if (duplicateIds(grouped).length || grouped.length !== packet.claimIds.length || grouped.some((id) => !packet.claimIds.includes(id))) add("PACKET_GROUP_MISMATCH", path);
    for (const id of packet.claimIds) {
      indexed.add(id);
      if (!claims.has(id)) add("PACKET_CLAIM_NOT_INDEXED", path);
    }
    const supported = new Set(packet.claimIds.flatMap((id) => claims.get(id)?.supports ?? []));
    if (packet.supports.some((conclusion) => !supported.has(conclusion))) add("PACKET_SUPPORT_UNBACKED", path);
    if (packet.recommendationAnchorClaimIds.some((id) => !packet.claimIds.includes(id) || claims.get(id)?.kind === "limitation")) add("RECOMMENDATION_ANCHOR_INVALID", path);
    if (packet.knowledgeIds.some((id) => !knowledge.has(id) || !knowledge.get(id)?.applicableDimensions.includes(packet.dimensionId))) add("PACKET_KNOWLEDGE_INVALID", path);
    if (!packet.requiredEvidence.length || packet.requiredEvidence.some((item) => item.status !== "fulfilled" || capabilities.get(item.capabilityKey)?.status === "unavailable")) add("PACKET_REQUIRED_EVIDENCE_MISSING", path);
    for (const item of [...packet.requiredEvidence, ...packet.optionalEvidence]) {
      if (!capabilities.has(item.capabilityKey) || item.status === "missing" && !item.reason?.trim()) add("PACKET_COVERAGE_INVALID", path);
    }
  }
  if (indexed.size !== claims.size || [...claims.keys()].some((id) => !indexed.has(id))) add("CLAIM_INDEX_MISMATCH", "allowedClaims");

  const inspect = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item, index) => inspect(item, `${path}.${index}`)); return; }
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenInputKeys.has(key.toLowerCase())) add("PRIVATE_FIELD_PRESENT", `${path}.${key}`);
      inspect(item, `${path}.${key}`);
    }
  };
  inspect(context, "context");
  return issues;
}
