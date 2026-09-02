import type { AnalysisContextClaim } from "../domain/ride-analysis-context.ts";
import type { CandidateClaim, CandidateInterpretationUnit, CandidateLimitation } from "./ride-interpretation-v04-candidate.ts";
import {
  RIDE_INTERPRETATION_INPUT_V04_CANDIDATE_VERSION,
  validateRideInterpretationInputV04Candidate,
  type RideInterpretationInputV04Candidate,
} from "./ride-interpretation-input-v04-candidate.ts";

export const RIDE_INTERPRETATION_OUTPUT_V04_CANDIDATE_VERSION = "ride-interpretation-output-v0.4.1-candidate" as const;

export interface RideInterpretationOutputTextUnit {
  text: string;
  claimIds: string[];
  visualRefIds: string[];
}

export interface RideInterpretationOutputDimension extends RideInterpretationOutputTextUnit {
  dimensionId: NonNullable<CandidateInterpretationUnit["dimensionId"]>;
}

export interface RideInterpretationOutputHighlight extends RideInterpretationOutputTextUnit {}

export interface RideInterpretationOutputNextAction {
  kind: "grounded" | "general";
  text: string;
  basisClaimIds: string[];
}

export interface RideInterpretationOutputV04Candidate {
  schemaVersion: typeof RIDE_INTERPRETATION_OUTPUT_V04_CANDIDATE_VERSION;
  oneLineLabel: {
    text: string;
    claimIds: string[];
  };
  overallAssessment: RideInterpretationOutputTextUnit;
  dimensions: RideInterpretationOutputDimension[];
  highlights: RideInterpretationOutputHighlight[];
  limitations: CandidateLimitation[];
  nextAction: RideInterpretationOutputNextAction | null;
}

export interface RideInterpretationOutputV04CandidateValidationResult {
  valid: boolean;
  issues: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hasDuplicates(values: string[]): boolean {
  return unique(values).length !== values.length;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function validateText(value: string, issues: string[], code: string): void {
  if (typeof value !== "string" || value.trim().length === 0) issues.push(code);
}

const NUMBER_PATTERN = /[-+]?\d+(?:\.\d+)?/g;
const DATA_COMPLETENESS_PATTERNS = [/数据(?:记录)?完整/, /记录完整(?:清晰)?/, /数据记录(?:完成|已完成)/];
const LONG_TERM_CAPABILITY_PATTERNS = [
  /(?:长期|稳定)?(?:骑行)?(?:能力|水平)(?:已|很|较|明显|持续)?(?:建立|提升|进步|退步|很强|较强|很弱|较弱)/,
  /(?:能力|水平)(?:很|较|明显)?(?:强|弱|高|低|优秀)/,
  /(?:你|您的)(?:具备|拥有).{0,8}(?:能力|水平)/,
  /(?:优秀|较强|较弱|专业级|初级|中级|高级)(?:骑手|水平|能力)/,
  /(?:总分|排名|百分位)/,
];
const UNAUTHORIZED_HISTORY_PATTERNS = [/(?:历史|过往|以往|上次|此前)\s*(?:骑行|记录|数据|表现)?/, /(?:相较|相比)\s*(?:自己|过去|上次|此前)?/];
const UNSUPPORTED_CAUSALITY_PATTERNS = [/(?:因为|由于).{0,24}(?:导致|造成|所以)/, /(?:导致|造成).{0,24}(?:疲劳|体能|表现|能力)/];
const ACTION_LANGUAGE_PATTERNS = [/(?:建议|应当|应该|下次|训练计划|恢复\d*天|可以尝试)/];

function hasPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function numberTokens(value: string): string[] {
  return [...value.matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]).toString());
}

function addNumericVariants(target: Set<string>, value: number, rounded = false): void {
  if (!Number.isFinite(value)) return;
  target.add(value.toString());
  if (!rounded) return;
  for (const digits of [0, 1, 2]) target.add(Number(value.toFixed(digits)).toString());
}

function claimNumericVariants(claim: AnalysisContextClaim): Set<string> {
  const variants = new Set<string>();
  const sourceValues: number[] = [];
  if (claim.value !== undefined && Number.isFinite(claim.value)) sourceValues.push(claim.value);
  for (const text of [claim.text, claim.displayValue]) {
    if (!text) continue;
    for (const token of numberTokens(text)) sourceValues.push(Number(token));
  }
  for (const value of sourceValues) addNumericVariants(variants, value, true);

  // These are presentation conversions of one source Claim, not cross-Claim calculations.
  if (claim.unit === "m/s" && claim.value !== undefined) addNumericVariants(variants, claim.value * 3.6, true);
  if (claim.unit === "km/h" && claim.value !== undefined) addNumericVariants(variants, claim.value / 3.6, true);
  if (claim.key === "distanceM" && claim.unit === "m" && claim.value !== undefined) addNumericVariants(variants, claim.value / 1_000, true);
  if ((claim.key === "elapsedTimeS" || claim.key === "movingTimeS") && claim.unit === "s" && claim.value !== undefined) {
    addNumericVariants(variants, claim.value / 60, true);
    addNumericVariants(variants, claim.value / 3_600, true);
  }
  if (claim.unit === "ratio" && claim.value !== undefined && (claim.key === "normalizedPowerRatio" || claim.key.endsWith("CoefficientOfVariation"))) {
    addNumericVariants(variants, claim.value * 100, true);
    addNumericVariants(variants, (claim.value - 1) * 100, true);
    addNumericVariants(variants, (1 - claim.value) * 100, true);
  }
  // A negative delta may naturally be presented as "lower by 4.5". This is
  // still the same Claim value, not a new calculation.
  for (const number of [...variants]) {
    const parsed = Number(number);
    if (Number.isFinite(parsed) && parsed < 0) variants.add(Math.abs(parsed).toString());
  }
  return variants;
}

function sourceClaimsForCandidateIds(
  candidateIds: string[],
  candidateClaims: Map<string, CandidateClaim>,
  allowedClaims: Map<string, AnalysisContextClaim>,
): AnalysisContextClaim[] {
  return candidateIds.flatMap((candidateId) => {
    const candidate = candidateClaims.get(candidateId);
    if (!candidate) return [];
    return candidate.sourceClaimIds.flatMap((sourceClaimId) => {
      const source = allowedClaims.get(sourceClaimId);
      return source ? [source] : [];
    });
  });
}

function validateNarrativeText(
  text: string,
  claimIds: string[],
  candidateClaims: Map<string, CandidateClaim>,
  allowedClaims: Map<string, AnalysisContextClaim>,
  issues: string[],
  scope: string,
  options: { allowAction?: boolean } = {},
): void {
  validateText(text, issues, `${scope}_EMPTY`);
  const allowedNumbers = new Set<string>();
  for (const claim of sourceClaimsForCandidateIds(claimIds, candidateClaims, allowedClaims)) {
    for (const number of claimNumericVariants(claim)) allowedNumbers.add(number);
  }
  for (const token of numberTokens(text)) {
    if (!allowedNumbers.has(token)) issues.push(`${scope}_UNSUPPORTED_NUMBER`);
  }
  if (hasPattern(text, DATA_COMPLETENESS_PATTERNS)) issues.push(`${scope}_DATA_COMPLETENESS_EVALUATION`);
  if (hasPattern(text, LONG_TERM_CAPABILITY_PATTERNS)) issues.push(`${scope}_LONG_TERM_CAPABILITY_LANGUAGE`);
  if (hasPattern(text, UNAUTHORIZED_HISTORY_PATTERNS)) issues.push(`${scope}_UNAUTHORIZED_HISTORY_REFERENCE`);
  if (hasPattern(text, UNSUPPORTED_CAUSALITY_PATTERNS)) issues.push(`${scope}_UNSUPPORTED_CAUSALITY`);
  if (!options.allowAction && hasPattern(text, ACTION_LANGUAGE_PATTERNS)) issues.push(`${scope}_ACTION_LANGUAGE_NOT_ALLOWED`);
}

function validateNarrativeUnit(
  output: RideInterpretationOutputTextUnit,
  expectedClaimIds: string[],
  expectedVisualRefIds: string[],
  candidateClaims: Map<string, CandidateClaim>,
  allowedClaims: Map<string, AnalysisContextClaim>,
  issues: string[],
  scope: string,
): void {
  if (!sameIds(output.claimIds, expectedClaimIds)) issues.push(`${scope}_CLAIM_MISMATCH`);
  if (!sameIds(output.visualRefIds, expectedVisualRefIds)) issues.push(`${scope}_VISUAL_MISMATCH`);
  if (hasDuplicates(output.claimIds)) issues.push(`${scope}_DUPLICATE_CLAIM`);
  if (hasDuplicates(output.visualRefIds)) issues.push(`${scope}_DUPLICATE_VISUAL`);
  validateNarrativeText(output.text, output.claimIds, candidateClaims, allowedClaims, issues, scope);
}

export function validateRideInterpretationOutputV04Candidate(
  output: RideInterpretationOutputV04Candidate,
  input: RideInterpretationInputV04Candidate,
): RideInterpretationOutputV04CandidateValidationResult {
  const issues: string[] = [];
  const inputValidation = validateRideInterpretationInputV04Candidate(input);
  if (!inputValidation.valid) issues.push("INPUT_CONTRACT_INVALID");
  if (output.schemaVersion !== RIDE_INTERPRETATION_OUTPUT_V04_CANDIDATE_VERSION) issues.push("INVALID_OUTPUT_SCHEMA_VERSION");
  validateText(output.oneLineLabel.text, issues, "ONE_LINE_LABEL_EMPTY");
  const highlights = Array.isArray(output.highlights) ? output.highlights : [];
  if (!Array.isArray(output.highlights) || highlights.length > 3) issues.push("HIGHLIGHTS_BUDGET_EXCEEDED");
  if (hasDuplicates(output.oneLineLabel.claimIds)) issues.push("ONE_LINE_LABEL_DUPLICATE_CLAIM");

  const inputCandidateClaims = new Map(input.candidateClaims.map((claim) => [claim.claimId, claim]));
  const inputAllowedClaims = new Map(input.allowedClaims.map((claim) => [claim.claimId, claim]));
  if (output.oneLineLabel.claimIds.length === 0 || output.oneLineLabel.claimIds.some((claimId) => !inputCandidateClaims.has(claimId))) {
    issues.push("ONE_LINE_LABEL_CLAIM_INVALID");
  }
  if (!output.oneLineLabel.claimIds.some((claimId) => inputCandidateClaims.get(claimId)?.claimType === "performance")) {
    issues.push("ONE_LINE_LABEL_PERFORMANCE_EVIDENCE_MISSING");
  }
  validateNarrativeText(output.oneLineLabel.text, output.oneLineLabel.claimIds, inputCandidateClaims, inputAllowedClaims, issues, "ONE_LINE_LABEL");

  const overallClaimIds = unique([
    ...input.overallAssessment.factClaimIds,
    ...input.overallAssessment.performanceClaimIds,
    ...input.overallAssessment.capabilityEvidenceClaimIds,
    ...input.overallAssessment.meaningClaimIds,
  ]);
  validateNarrativeUnit(output.overallAssessment, overallClaimIds, input.overallAssessment.visualRefIds, inputCandidateClaims, inputAllowedClaims, issues, "OVERALL");
  if (output.dimensions.length !== input.dimensionInterpretations.length) issues.push("DIMENSION_COUNT_MISMATCH");
  for (let index = 0; index < output.dimensions.length; index += 1) {
    const dimension = output.dimensions[index]!;
    const expected = input.dimensionInterpretations[index];
    if (!expected || dimension.dimensionId !== expected.dimensionId) {
      issues.push("DIMENSION_PLAN_MISMATCH");
      continue;
    }
    const expectedClaimIds = unique([
      ...expected.factClaimIds,
      ...expected.performanceClaimIds,
      ...expected.capabilityEvidenceClaimIds,
      ...expected.meaningClaimIds,
    ]);
    validateNarrativeUnit(dimension, expectedClaimIds, expected.visualRefIds, inputCandidateClaims, inputAllowedClaims, issues, `DIMENSION_${dimension.dimensionId}`);
  }

  for (let index = 0; index < highlights.length; index += 1) {
    const highlight = highlights[index]!;
    if (highlight.claimIds.length === 0) issues.push(`HIGHLIGHT_${index}_CLAIM_MISSING`);
    if (highlight.claimIds.some((claimId) => !inputCandidateClaims.has(claimId))) issues.push(`HIGHLIGHT_${index}_CLAIM_INVALID`);
    if (highlight.visualRefIds.some((visualId) => !input.visualRegistry.some((visual) => visual.visualId === visualId))) issues.push(`HIGHLIGHT_${index}_VISUAL_INVALID`);
    validateNarrativeText(highlight.text, highlight.claimIds, inputCandidateClaims, inputAllowedClaims, issues, `HIGHLIGHT_${index}`);
  }
  if (output.dimensions.some((dimension) => dimension.dimensionId === "history_change")) issues.push("HISTORY_DIMENSION_NOT_ALLOWED");
  if (output.schemaVersion === RIDE_INTERPRETATION_OUTPUT_V04_CANDIDATE_VERSION && input.mode === "default" && output.dimensions.length > 3) {
    issues.push("DEFAULT_DIMENSION_BUDGET_EXCEEDED");
  }

  if (output.limitations.length !== input.limitations.length) issues.push("LIMITATION_COUNT_MISMATCH");
  for (let index = 0; index < output.limitations.length; index += 1) {
    const limitation = output.limitations[index]!;
    const expected = input.limitations[index];
    if (!expected || limitation.dimensionId !== expected.dimensionId || !sameIds(limitation.claimIds, expected.claimIds)) {
      issues.push("LIMITATION_PLAN_MISMATCH");
    }
  }

  if (output.nextAction) {
    validateText(output.nextAction.text, issues, "NEXT_ACTION_EMPTY");
    if (output.nextAction.kind === "general" && output.nextAction.basisClaimIds.length > 0) issues.push("GENERAL_ACTION_HAS_BASIS");
    if (output.nextAction.kind === "grounded") {
      if (output.nextAction.basisClaimIds.length === 0) issues.push("GROUNDED_ACTION_BASIS_MISSING");
      if (output.nextAction.basisClaimIds.some((claimId) => {
        const type = inputCandidateClaims.get(claimId)?.claimType;
        return type !== "performance" && type !== "capability_evidence";
      })) issues.push("GROUNDED_ACTION_BASIS_INVALID");
    }
    if (hasDuplicates(output.nextAction.basisClaimIds)) issues.push("NEXT_ACTION_DUPLICATE_BASIS");
  }

  return { valid: issues.length === 0, issues: unique(issues) };
}

export function buildRideInterpretationOutputV04CandidateFixture(
  input: RideInterpretationInputV04Candidate,
): RideInterpretationOutputV04Candidate {
  if (input.contractVersion !== RIDE_INTERPRETATION_INPUT_V04_CANDIDATE_VERSION) {
    throw new Error("Cannot build an output fixture from an unsupported input contract");
  }
  const labelClaim = input.overallAssessment.performanceClaimIds[0];
  if (!labelClaim) throw new Error("Output fixture requires overall performance evidence");
  const textUnit = (unit: CandidateInterpretationUnit) => ({
    ...unit,
    text: "本次记录提供了该维度的可靠证据；这些证据共同反映了本次骑行的表现，也让你可以从对应证据理解这次骑行。",
    claimIds: unique([
      ...unit.factClaimIds,
      ...unit.performanceClaimIds,
      ...unit.capabilityEvidenceClaimIds,
      ...unit.meaningClaimIds,
    ]),
    visualRefIds: [...unit.visualRefIds],
    ...(unit.dimensionId ? { dimensionId: unit.dimensionId } : {}),
  });
  return {
    schemaVersion: RIDE_INTERPRETATION_OUTPUT_V04_CANDIDATE_VERSION,
    oneLineLabel: { text: "本次表现的可追溯解读", claimIds: [labelClaim] },
    overallAssessment: textUnit(input.overallAssessment),
    dimensions: input.dimensionInterpretations.map((unit) => textUnit(unit) as RideInterpretationOutputDimension),
    highlights: input.overallAssessment.performanceClaimIds.slice(0, 2).map((claimId) => ({ text: "这组证据是本次骑行表现中值得回看的高光。", claimIds: [claimId], visualRefIds: [] })),
    limitations: input.limitations.map((limitation) => ({ ...limitation, claimIds: [...limitation.claimIds] })),
    nextAction: null,
  };
}
