export const RIDE_INTERPRETATION_V04_CANDIDATE_VERSION = "ride-interpretation-v0.4-candidate" as const;

export const INTERPRETATION_DIMENSION_IDS = [
  "route_pacing",
  "terrain_climb",
  "heart_rate",
  "power_output",
  "cadence",
  "pacing_stability",
  "history_change",
] as const;

export const RELATION_TYPES = [
  "co_movement",
  "contrast",
  "tradeoff",
  "segment_pattern",
  "history_change",
] as const;

export type InterpretationDimensionId = typeof INTERPRETATION_DIMENSION_IDS[number];
export type RelationType = typeof RELATION_TYPES[number];
export type CandidateClaimType = "fact" | "performance" | "capability_evidence" | "relation" | "history" | "limitation";
export type CandidateAvailability = "available" | "partial" | "hidden";
export type CandidateVisualType = "trend" | "zone_distribution" | "power_peak" | "relation_trend";

export interface CandidateRelationMetadata {
  relationType: RelationType;
  leftSourceClaimIds: string[];
  rightSourceClaimIds: string[];
  qualityPass: boolean;
  minimumWindowPass: boolean;
  directionConsistent: boolean;
}

export interface CandidateHistoryMetadata {
  comparable: boolean;
  sampleCount: number;
}

export interface CandidateClaim {
  claimId: string;
  dimensionId: InterpretationDimensionId;
  claimType: CandidateClaimType;
  sourceClaimIds: string[];
  availability: Exclude<CandidateAvailability, "hidden">;
  relation?: CandidateRelationMetadata;
  history?: CandidateHistoryMetadata;
}

export interface CandidateVisualRef {
  visualId: string;
  type: CandidateVisualType;
  sourceClaimIds: string[];
  availability: Exclude<CandidateAvailability, "hidden">;
  ruleVersion: string;
}

export interface CandidateInterpretationUnit {
  dimensionId?: InterpretationDimensionId;
  factClaimIds: string[];
  performanceClaimIds: string[];
  capabilityEvidenceClaimIds: string[];
  meaningClaimIds: string[];
  visualRefIds: string[];
}

export interface CandidateLimitation {
  dimensionId: InterpretationDimensionId;
  claimIds: string[];
}

export interface RideInterpretationV04Candidate {
  contractVersion: typeof RIDE_INTERPRETATION_V04_CANDIDATE_VERSION;
  mode: "default" | "expanded";
  eligibleDimensionIds: InterpretationDimensionId[];
  dimensionAvailability: Record<InterpretationDimensionId, CandidateAvailability>;
  sourceClaimIds: string[];
  claims: CandidateClaim[];
  visualRegistry: CandidateVisualRef[];
  overallAssessment: CandidateInterpretationUnit;
  dimensionInterpretations: CandidateInterpretationUnit[];
  limitations: CandidateLimitation[];
}

export interface RideInterpretationV04CandidateValidationResult {
  valid: boolean;
  issues: string[];
}

const DIMENSION_SET = new Set<string>(INTERPRETATION_DIMENSION_IDS);
const RELATION_SET = new Set<string>(RELATION_TYPES);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hasDuplicates(values: string[]): boolean {
  return unique(values).length !== values.length;
}

function selectedClaimIds(unit: CandidateInterpretationUnit): string[] {
  return [
    ...unit.factClaimIds,
    ...unit.performanceClaimIds,
    ...unit.capabilityEvidenceClaimIds,
  ];
}

function sourceIdsForClaims(claimIds: string[], claims: Map<string, CandidateClaim>): Set<string> {
  return new Set(claimIds.flatMap((claimId) => claims.get(claimId)?.sourceClaimIds ?? []));
}

function validateIds(
  ids: string[],
  allowed: Set<string>,
  issues: string[],
  code: string,
): void {
  if (ids.length === 0) issues.push(`${code}_MISSING`);
  if (hasDuplicates(ids)) issues.push(`${code}_DUPLICATE`);
  if (ids.some((id) => !allowed.has(id))) issues.push(`${code}_UNKNOWN`);
}

function validateClaimMetadata(
  claim: CandidateClaim,
  sourceClaimIds: Set<string>,
  issues: string[],
): void {
  if (!DIMENSION_SET.has(claim.dimensionId)) issues.push("CLAIM_INVALID_DIMENSION");
  if (claim.sourceClaimIds.length === 0 || claim.sourceClaimIds.some((id) => !sourceClaimIds.has(id))) issues.push("CLAIM_INVALID_SOURCE");
  if (hasDuplicates(claim.sourceClaimIds)) issues.push("CLAIM_DUPLICATE_SOURCE");

  if (claim.claimType === "relation" || claim.claimType === "history") {
    const relation = claim.relation;
    if (!relation || !RELATION_SET.has(relation.relationType)) {
      issues.push("RELATION_METADATA_MISSING");
    } else {
      if (relation.leftSourceClaimIds.length === 0 || relation.rightSourceClaimIds.length === 0) issues.push("RELATION_MISSING_SIDE");
      const relationSources = [...relation.leftSourceClaimIds, ...relation.rightSourceClaimIds];
      if (relationSources.some((id) => !sourceClaimIds.has(id) || !claim.sourceClaimIds.includes(id))) issues.push("RELATION_SOURCE_MISMATCH");
      if (!relation.qualityPass || !relation.minimumWindowPass || !relation.directionConsistent) issues.push("RELATION_PRECONDITION_FAILED");
      if (relation.relationType === "history_change" && claim.dimensionId !== "history_change") issues.push("HISTORY_RELATION_DIMENSION_MISMATCH");
      if (relation.relationType !== "history_change" && claim.claimType === "history") issues.push("HISTORY_RELATION_TYPE_MISMATCH");
    }
  }

  if (claim.claimType === "history") {
    if (!claim.history || !claim.history.comparable || claim.history.sampleCount < 2) issues.push("HISTORY_NOT_COMPARABLE");
    if (claim.dimensionId !== "history_change") issues.push("HISTORY_DIMENSION_MISMATCH");
  }
}

function validateUnit(
  unit: CandidateInterpretationUnit,
  claims: Map<string, CandidateClaim>,
  visuals: Map<string, CandidateVisualRef>,
  issues: string[],
  scope: "OVERALL" | "DIMENSION",
): void {
  const claimIds = new Set(claims.keys());
  validateIds(unit.factClaimIds, claimIds, issues, `${scope}_FACT`);
  validateIds(unit.performanceClaimIds, claimIds, issues, `${scope}_PERFORMANCE`);
  if (hasDuplicates(selectedClaimIds(unit))) issues.push(`${scope}_CLAIM_REUSED`);
  if (unit.factClaimIds.some((id) => claims.get(id)?.claimType !== "fact")) issues.push(`${scope}_FACT_TYPE`);
  if (unit.performanceClaimIds.some((id) => {
    const type = claims.get(id)?.claimType;
    return type !== "performance" && type !== "relation" && type !== "history";
  })) issues.push(`${scope}_PERFORMANCE_TYPE`);
  if (unit.capabilityEvidenceClaimIds.some((id) => claims.get(id)?.claimType !== "capability_evidence")) issues.push(`${scope}_CAPABILITY_TYPE`);

  const permittedMeaningIds = new Set(selectedClaimIds(unit));
  if (unit.meaningClaimIds.some((id) => !permittedMeaningIds.has(id))) issues.push(`${scope}_MEANING_UNGROUNDED`);

  const performanceSources = sourceIdsForClaims(unit.performanceClaimIds, claims);
  for (const capabilityId of unit.capabilityEvidenceClaimIds) {
    const capability = claims.get(capabilityId);
    if (capability && !capability.sourceClaimIds.some((id) => performanceSources.has(id))) issues.push(`${scope}_CAPABILITY_UNGROUNDED`);
  }

  const unitSources = sourceIdsForClaims(selectedClaimIds(unit), claims);
  validateIds(unit.visualRefIds, new Set(visuals.keys()), issues, `${scope}_VISUAL`);
  for (const visualId of unit.visualRefIds) {
    const visual = visuals.get(visualId);
    if (visual && visual.sourceClaimIds.some((id) => !unitSources.has(id))) issues.push(`${scope}_VISUAL_SOURCE_MISMATCH`);
  }
}

export function validateRideInterpretationV04Candidate(
  candidate: RideInterpretationV04Candidate,
): RideInterpretationV04CandidateValidationResult {
  const issues: string[] = [];
  if (candidate.contractVersion !== RIDE_INTERPRETATION_V04_CANDIDATE_VERSION) issues.push("INVALID_CONTRACT_VERSION");
  if (hasDuplicates(candidate.sourceClaimIds)) issues.push("DUPLICATE_SOURCE_CLAIM");
  if (hasDuplicates(candidate.eligibleDimensionIds) || candidate.eligibleDimensionIds.some((id) => !DIMENSION_SET.has(id))) issues.push("INVALID_ELIGIBLE_DIMENSIONS");

  const sourceClaims = new Set(candidate.sourceClaimIds);
  const claims = new Map<string, CandidateClaim>();
  for (const claim of candidate.claims) {
    if (claims.has(claim.claimId)) issues.push("DUPLICATE_CANDIDATE_CLAIM");
    claims.set(claim.claimId, claim);
    validateClaimMetadata(claim, sourceClaims, issues);
  }

  const visuals = new Map<string, CandidateVisualRef>();
  for (const visual of candidate.visualRegistry) {
    if (visuals.has(visual.visualId)) issues.push("DUPLICATE_VISUAL_ID");
    visuals.set(visual.visualId, visual);
    if (!visual.ruleVersion || visual.sourceClaimIds.length === 0 || visual.sourceClaimIds.some((id) => !sourceClaims.has(id))) issues.push("INVALID_VISUAL_REGISTRY_ENTRY");
    if (hasDuplicates(visual.sourceClaimIds)) issues.push("DUPLICATE_VISUAL_SOURCE");
  }

  for (const dimensionId of INTERPRETATION_DIMENSION_IDS) {
    const availability = candidate.dimensionAvailability[dimensionId];
    if (!availability) issues.push("DIMENSION_AVAILABILITY_MISSING");
    if (availability === "hidden" && candidate.eligibleDimensionIds.includes(dimensionId)) issues.push("HIDDEN_DIMENSION_ELIGIBLE");
  }

  if (candidate.mode === "default" && candidate.dimensionInterpretations.length > 3) issues.push("DEFAULT_DIMENSION_BUDGET_EXCEEDED");
  const plannedDimensions = candidate.dimensionInterpretations.map((unit) => unit.dimensionId);
  if (plannedDimensions.some((id): id is undefined => !id)) issues.push("DIMENSION_ID_MISSING");
  if (hasDuplicates(plannedDimensions.filter((id): id is InterpretationDimensionId => Boolean(id)))) issues.push("DUPLICATE_DIMENSION_INTERPRETATION");
  if (candidate.mode === "expanded" && plannedDimensions.join("|") !== candidate.eligibleDimensionIds.join("|")) issues.push("EXPANDED_DIMENSION_COVERAGE_MISMATCH");

  validateUnit(candidate.overallAssessment, claims, visuals, issues, "OVERALL");
  for (const unit of candidate.dimensionInterpretations) {
    if (!unit.dimensionId || !candidate.eligibleDimensionIds.includes(unit.dimensionId)) issues.push("DIMENSION_NOT_ELIGIBLE");
    if (unit.dimensionId && candidate.dimensionAvailability[unit.dimensionId] === "hidden") issues.push("HIDDEN_DIMENSION_RENDERED");
    validateUnit(unit, claims, visuals, issues, "DIMENSION");
  }

  for (const limitation of candidate.limitations) {
    const referenced = limitation.claimIds.map((id) => claims.get(id));
    if (referenced.length === 0 || referenced.some((claim) => claim?.claimType !== "limitation" || claim.dimensionId !== limitation.dimensionId)) issues.push("INVALID_LIMITATION_REFERENCE");
  }
  for (const dimensionId of INTERPRETATION_DIMENSION_IDS) {
    if (candidate.dimensionAvailability[dimensionId] !== "partial") continue;
    if (!candidate.dimensionInterpretations.some((unit) => unit.dimensionId === dimensionId)) continue;
    if (!candidate.limitations.some((limitation) => limitation.dimensionId === dimensionId)) issues.push("PARTIAL_DIMENSION_LIMITATION_MISSING");
  }

  return { valid: issues.length === 0, issues: unique(issues) };
}
