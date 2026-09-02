import type { AnalysisContextClaim, RideAnalysisContext } from "../domain/ride-analysis-context.ts";
import type { RideInterpretationPlan } from "./ride-interpretation-plan.ts";
import {
  RIDE_INTERPRETATION_V04_CANDIDATE_VERSION,
  type CandidateClaim,
  type CandidateInterpretationUnit,
  type CandidateLimitation,
  type CandidateVisualRef,
  type InterpretationDimensionId,
} from "./ride-interpretation-v04-candidate.ts";

export const RIDE_INTERPRETATION_INPUT_V04_CANDIDATE_VERSION = "ride-interpretation-input-v0.4-candidate" as const;

export interface RideInterpretationInputV04Candidate {
  contractVersion: typeof RIDE_INTERPRETATION_INPUT_V04_CANDIDATE_VERSION;
  sourceCandidateVersion: typeof RIDE_INTERPRETATION_V04_CANDIDATE_VERSION;
  planVersion: RideInterpretationPlan["planVersion"];
  rideId: string;
  mode: "default" | "expanded";
  allowedClaims: AnalysisContextClaim[];
  candidateClaims: CandidateClaim[];
  overallAssessment: CandidateInterpretationUnit;
  dimensionInterpretations: Array<Required<CandidateInterpretationUnit>>;
  visualRegistry: CandidateVisualRef[];
  limitations: CandidateLimitation[];
  safetyFlags: string[];
  privacyFlags: string[];
}

export interface RideInterpretationInputV04CandidateValidationResult {
  valid: boolean;
  issues: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hasDuplicates(values: string[]): boolean {
  return unique(values).length !== values.length;
}

function unitCandidateIds(unit: CandidateInterpretationUnit): string[] {
  return unique([
    ...unit.factClaimIds,
    ...unit.performanceClaimIds,
    ...unit.capabilityEvidenceClaimIds,
    ...unit.meaningClaimIds,
  ]);
}

function candidateIdsForInput(
  overallAssessment: CandidateInterpretationUnit,
  dimensions: CandidateInterpretationUnit[],
  limitations: CandidateLimitation[],
): string[] {
  return unique([
    ...unitCandidateIds(overallAssessment),
    ...dimensions.flatMap(unitCandidateIds),
    ...limitations.flatMap((limitation) => limitation.claimIds),
  ]);
}

function copyClaim(claim: AnalysisContextClaim): AnalysisContextClaim {
  return { ...claim, evidenceIds: [...claim.evidenceIds] };
}

export function projectRideInterpretationInputV04Candidate(
  context: RideAnalysisContext,
  plan: RideInterpretationPlan,
): RideInterpretationInputV04Candidate | undefined {
  const candidate = plan.candidate;
  if (!candidate) return undefined;
  if (candidate.dimensionAvailability.history_change !== "hidden" || candidate.eligibleDimensionIds.includes("history_change")) {
    throw new Error("Persistent history cannot enter the non-historical interpretation input");
  }

  const dimensions = candidate.dimensionInterpretations.map((unit) => {
    if (!unit.dimensionId) throw new Error("Interpretation input requires a dimension identifier");
    return { ...unit, dimensionId: unit.dimensionId };
  });
  const candidateIds = candidateIdsForInput(candidate.overallAssessment, dimensions, candidate.limitations);
  const candidateById = new Map(candidate.claims.map((claim) => [claim.claimId, claim]));
  const candidateClaims = candidateIds.map((claimId) => {
    const claim = candidateById.get(claimId);
    if (!claim) throw new Error(`Interpretation input references unknown candidate claim: ${claimId}`);
    return { ...claim, sourceClaimIds: [...claim.sourceClaimIds] };
  });

  const visualIds = unique([
    ...candidate.overallAssessment.visualRefIds,
    ...dimensions.flatMap((unit) => unit.visualRefIds),
  ]);
  const visualRegistry = visualIds.map((visualId) => {
    const visual = candidate.visualRegistry.find((entry) => entry.visualId === visualId);
    if (!visual) throw new Error(`Interpretation input references unregistered visual: ${visualId}`);
    return { ...visual, sourceClaimIds: [...visual.sourceClaimIds] };
  });

  const sourceClaimIds = new Set([
    ...candidateClaims.flatMap((claim) => claim.sourceClaimIds),
    ...visualRegistry.flatMap((visual) => visual.sourceClaimIds),
  ]);
  const allowedClaims = context.allowedClaims
    .filter((claim) => sourceClaimIds.has(claim.claimId))
    .map(copyClaim);

  const input: RideInterpretationInputV04Candidate = {
    contractVersion: RIDE_INTERPRETATION_INPUT_V04_CANDIDATE_VERSION,
    sourceCandidateVersion: candidate.contractVersion,
    planVersion: plan.planVersion,
    rideId: context.rideId,
    mode: candidate.mode,
    allowedClaims,
    candidateClaims,
    overallAssessment: {
      factClaimIds: [...candidate.overallAssessment.factClaimIds],
      performanceClaimIds: [...candidate.overallAssessment.performanceClaimIds],
      capabilityEvidenceClaimIds: [...candidate.overallAssessment.capabilityEvidenceClaimIds],
      meaningClaimIds: [...candidate.overallAssessment.meaningClaimIds],
      visualRefIds: [...candidate.overallAssessment.visualRefIds],
    },
    dimensionInterpretations: dimensions.map((unit) => ({
      ...unit,
      factClaimIds: [...unit.factClaimIds],
      performanceClaimIds: [...unit.performanceClaimIds],
      capabilityEvidenceClaimIds: [...unit.capabilityEvidenceClaimIds],
      meaningClaimIds: [...unit.meaningClaimIds],
      visualRefIds: [...unit.visualRefIds],
    })),
    visualRegistry,
    limitations: candidate.limitations.map((limitation) => ({ ...limitation, claimIds: [...limitation.claimIds] })),
    safetyFlags: [...context.safetyFlags],
    privacyFlags: [...context.privacyFlags],
  };
  const validation = validateRideInterpretationInputV04Candidate(input);
  if (!validation.valid) throw new Error(`Ride interpretation input is invalid: ${validation.issues.join(",")}`);
  return input;
}

export function validateRideInterpretationInputV04Candidate(
  input: RideInterpretationInputV04Candidate,
): RideInterpretationInputV04CandidateValidationResult {
  const issues: string[] = [];
  if (input.contractVersion !== RIDE_INTERPRETATION_INPUT_V04_CANDIDATE_VERSION) issues.push("INVALID_INPUT_CONTRACT_VERSION");
  if (input.sourceCandidateVersion !== RIDE_INTERPRETATION_V04_CANDIDATE_VERSION) issues.push("INVALID_SOURCE_CANDIDATE_VERSION");
  if (hasDuplicates(input.allowedClaims.map((claim) => claim.claimId))) issues.push("DUPLICATE_ALLOWED_CLAIM");
  if (hasDuplicates(input.candidateClaims.map((claim) => claim.claimId))) issues.push("DUPLICATE_CANDIDATE_CLAIM");
  if (input.dimensionInterpretations.some((unit) => unit.dimensionId === "history_change")) issues.push("HISTORY_DIMENSION_NOT_ALLOWED");
  if (input.candidateClaims.some((claim) => claim.dimensionId === "history_change" || claim.claimType === "history")) issues.push("HISTORY_CLAIM_NOT_ALLOWED");
  if (input.mode === "default" && input.dimensionInterpretations.length > 3) issues.push("DEFAULT_DIMENSION_BUDGET_EXCEEDED");

  const allowedClaimIds = new Set(input.allowedClaims.map((claim) => claim.claimId));
  const candidateClaims = new Map(input.candidateClaims.map((claim) => [claim.claimId, claim]));
  const visualRegistry = new Map(input.visualRegistry.map((visual) => [visual.visualId, visual]));
  const selectedCandidateIds = candidateIdsForInput(input.overallAssessment, input.dimensionInterpretations, input.limitations);
  if (selectedCandidateIds.some((claimId) => !candidateClaims.has(claimId))) issues.push("SELECTED_CANDIDATE_CLAIM_MISSING");
  if (input.candidateClaims.some((claim) => !selectedCandidateIds.includes(claim.claimId))) issues.push("UNSELECTED_CANDIDATE_CLAIM_EXPOSED");

  const referencedSourceIds = new Set([
    ...input.candidateClaims.flatMap((claim) => claim.sourceClaimIds),
    ...input.visualRegistry.flatMap((visual) => visual.sourceClaimIds),
  ]);
  if (input.allowedClaims.some((claim) => !referencedSourceIds.has(claim.claimId))) issues.push("UNSELECTED_SOURCE_CLAIM_EXPOSED");
  if ([...referencedSourceIds].some((claimId) => !allowedClaimIds.has(claimId))) issues.push("REFERENCED_SOURCE_CLAIM_MISSING");
  if (input.candidateClaims.some((claim) => claim.sourceClaimIds.some((claimId) => !allowedClaimIds.has(claimId)))) issues.push("CANDIDATE_SOURCE_NOT_ALLOWED");

  const selectedVisualIds = new Set([
    ...input.overallAssessment.visualRefIds,
    ...input.dimensionInterpretations.flatMap((unit) => unit.visualRefIds),
  ]);
  if ([...selectedVisualIds].some((visualId) => !visualRegistry.has(visualId))) issues.push("SELECTED_VISUAL_MISSING");
  if (input.visualRegistry.some((visual) => !selectedVisualIds.has(visual.visualId))) issues.push("UNSELECTED_VISUAL_EXPOSED");
  if (input.visualRegistry.some((visual) => visual.sourceClaimIds.some((claimId) => !allowedClaimIds.has(claimId)))) issues.push("VISUAL_SOURCE_NOT_ALLOWED");
  if (hasDuplicates(input.visualRegistry.map((visual) => visual.visualId))) issues.push("DUPLICATE_VISUAL");

  const plannedDimensionIds = new Set(input.dimensionInterpretations.map((unit) => unit.dimensionId));
  for (const limitation of input.limitations) {
    if (!plannedDimensionIds.has(limitation.dimensionId)) issues.push("LIMITATION_FOR_UNPLANNED_DIMENSION");
    if (limitation.claimIds.some((claimId) => candidateClaims.get(claimId)?.claimType !== "limitation")) issues.push("INVALID_LIMITATION_CLAIM");
  }

  return { valid: issues.length === 0, issues: unique(issues) };
}
