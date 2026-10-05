import {
  RIDE_EVIDENCE_RULES_VERSION,
  RIDE_EVIDENCE_SCHEMA_VERSION,
  validateRideAnalysisEvidenceV2,
  type RideAnalysisEvidenceV2,
  type V2AnalysisClaim,
  type V2KnowledgeEvidence,
} from "./ride-analysis-evidence-v2.ts";

// S4-01 (L7 target role per V2 business rules 14.2): assemble the complete evidence
// packets, limitations, prohibited conclusions, and applicable knowledge into a
// versioned model input. L7 keeps every qualified claim in each packet, excludes
// forbidden inputs, and blocks the model call with a traceable failure code instead
// of silently trimming claims when authorization, privacy, or budget gates fail.

export const RIDE_MODEL_INPUT_SCHEMA_VERSION = "ride-model-input-v2.0.0" as const;
export const RIDE_MODEL_INPUT_RULES_VERSION = "ride-model-input-v2.0" as const;
export const DEFAULT_RIDE_MODEL_INPUT_MAX_CHARACTERS = 160_000 as const;

const requiredPrivacyFlags = [
  "raw_track_excluded",
  "precise_coordinates_excluded",
  "source_filename_excluded",
  "untrusted_free_text_excluded",
] as const;

const forbiddenInputKeys = new Set([
  "filename", "latitude", "longitude", "coordinates", "rawtrack", "points", "accesstoken",
]);

export interface RideModelInputKnowledgeV2 {
  knowledgeId: string;
  citation: string;
  conditions: string[];
  conclusionStrength?: "high" | "moderate" | "limited";
  limitations?: string[];
  safetyBoundaries?: string[];
  forbiddenFactKeys?: string[];
  knowledgeBaseVersion?: string;
  retrievedAt?: string;
}

export interface RideModelInputQuestionV2 {
  dimensionId: string;
  question: string;
  eligibility: "available" | "partial";
  qualityStatus: "valid" | "soft";
  claims: V2AnalysisClaim[];
  limitations: string[];
  supports: string[];
  prohibits: string[];
  knowledge: RideModelInputKnowledgeV2[];
  recommendationAnchorClaimIds: string[];
}

export interface RideModelInputStatsV2 {
  totalCharacters: number;
  maxInputCharacters: number;
  questionCount: number;
  claimCount: number;
  knowledgeCount: number;
}

export interface RideModelInputV2 {
  schemaVersion: typeof RIDE_MODEL_INPUT_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_MODEL_INPUT_RULES_VERSION;
  evidenceRulesVersion: typeof RIDE_EVIDENCE_RULES_VERSION;
  evidenceSchemaVersion: typeof RIDE_EVIDENCE_SCHEMA_VERSION;
  rideId: string;
  analysisRunId: string;
  userScope: string;
  privacyFlags: string[];
  questions: RideModelInputQuestionV2[];
  inputStats: RideModelInputStatsV2;
}

export type RideModelInputFailureCode =
  | "OPTIONS_INVALID"
  | "RUN_SCOPE_MISMATCH"
  | "EVIDENCE_CONTEXT_INVALID"
  | "PACKET_CLAIM_UNRESOLVED"
  | "PACKET_KNOWLEDGE_UNRESOLVED"
  | "INPUT_CLAIM_COVERAGE_MISMATCH"
  | "PRIVATE_FIELD_PRESENT"
  | "INPUT_BUDGET_EXCEEDED"
  | "NO_DELIVERABLE_QUESTIONS";

export interface RideModelInputBlockedV2 {
  status: "blocked";
  failureCode: RideModelInputFailureCode;
  reason: string;
  // Present for INPUT_BUDGET_EXCEEDED: every analysis question that could not be
  // delivered within the budget, with its assembled size. No claim is trimmed.
  undeliverableDimensions?: { dimensionId: string; characters: number }[];
}

export type RideModelInputResultV2 =
  | { status: "ready"; input: RideModelInputV2 }
  | RideModelInputBlockedV2;

export interface BuildRideModelInputV2Options {
  analysisRunId: string;
  userScope: string;
  maxInputCharacters?: number;
}

function blocked(failureCode: RideModelInputFailureCode, reason: string): RideModelInputBlockedV2 {
  return { status: "blocked", failureCode, reason };
}

function copyClaim(claim: V2AnalysisClaim): V2AnalysisClaim {
  return {
    ...claim,
    sourceRefs: claim.sourceRefs.map((ref) => ({ ...ref, evidenceIds: [...ref.evidenceIds] })),
    evidenceIds: [...claim.evidenceIds],
    supports: [...claim.supports],
    prohibits: [...claim.prohibits],
  };
}

function copyKnowledge(item: V2KnowledgeEvidence): RideModelInputKnowledgeV2 {
  return {
    knowledgeId: item.knowledgeId,
    citation: item.citation,
    conditions: [...item.conditions],
    ...(item.conclusionStrength !== undefined ? { conclusionStrength: item.conclusionStrength } : {}),
    ...(item.limitations ? { limitations: [...item.limitations] } : {}),
    ...(item.safetyBoundaries ? { safetyBoundaries: [...item.safetyBoundaries] } : {}),
    ...(item.forbiddenFactKeys ? { forbiddenFactKeys: [...item.forbiddenFactKeys] } : {}),
    ...(item.knowledgeBaseVersion ? { knowledgeBaseVersion: item.knowledgeBaseVersion } : {}),
    ...(item.retrievedAt ? { retrievedAt: item.retrievedAt } : {}),
  };
}

function findPrivateField(value: unknown, path: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = findPrivateField(value[index], `${path}.${index}`);
      if (hit) return hit;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenInputKeys.has(key.toLowerCase())) return `${path}.${key}`;
    const hit = findPrivateField(item, `${path}.${key}`);
    if (hit) return hit;
  }
  return undefined;
}

function serialize(input: RideModelInputV2): string {
  let length = 0;
  // totalCharacters digits can change the serialized length; settle to a fixed point.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    length = JSON.stringify(input).length;
    if (input.inputStats.totalCharacters === length) break;
    input.inputStats.totalCharacters = length;
  }
  return JSON.stringify(input);
}

export function buildRideModelInputV2(
  context: RideAnalysisEvidenceV2,
  options: BuildRideModelInputV2Options,
): RideModelInputResultV2 {
  const maxInputCharacters = options.maxInputCharacters ?? DEFAULT_RIDE_MODEL_INPUT_MAX_CHARACTERS;
  if (!options.analysisRunId.trim() || !options.userScope.trim()
    || !Number.isInteger(maxInputCharacters) || maxInputCharacters <= 0) {
    return blocked("OPTIONS_INVALID", "L7 requires analysisRunId, userScope, and a positive integer maxInputCharacters");
  }
  if (options.analysisRunId !== context.analysisRunId || options.userScope !== context.userScope) {
    return blocked("RUN_SCOPE_MISMATCH", "L7 input assembly must bind the same analysisRunId and userScope as the evidence context");
  }
  const missingPrivacyFlags = requiredPrivacyFlags.filter((flag) => !context.privacyFlags.includes(flag));
  if (missingPrivacyFlags.length) {
    return blocked("EVIDENCE_CONTEXT_INVALID", `privacy flags missing: ${missingPrivacyFlags.join(",")}`);
  }

  const issues = validateRideAnalysisEvidenceV2(context);
  if (issues.length) {
    return blocked("EVIDENCE_CONTEXT_INVALID", `evidence context failed contract validation: ${issues.map((issue) => issue.code).join(",")}`);
  }
  if (!context.evidencePackets.length) {
    return blocked("NO_DELIVERABLE_QUESTIONS", "no analysis question has a qualified evidence packet; the model call is blocked");
  }

  const claimMap = new Map(context.allowedClaims.map((claim) => [claim.claimId, claim]));
  const knowledgeMap = new Map(context.knowledgeEvidence.map((item) => [item.knowledgeId, item]));
  const questions: RideModelInputQuestionV2[] = [];
  for (const packet of context.evidencePackets) {
    const unresolvedClaims = packet.claimIds.filter((id) => !claimMap.has(id));
    if (unresolvedClaims.length) {
      return blocked("PACKET_CLAIM_UNRESOLVED", `${packet.dimensionId}: ${unresolvedClaims.join(",")}`);
    }
    const claims = packet.claimIds.map((id) => copyClaim(claimMap.get(id)!));
    const claimIds = claims.map((claim) => claim.claimId);
    if (JSON.stringify(claimIds) !== JSON.stringify(packet.claimIds)) {
      return blocked("INPUT_CLAIM_COVERAGE_MISMATCH", `${packet.dimensionId}: assembled claims do not cover the packet exactly`);
    }
    const unresolvedKnowledge = packet.knowledgeIds.filter((id) => !knowledgeMap.has(id));
    if (unresolvedKnowledge.length) {
      return blocked("PACKET_KNOWLEDGE_UNRESOLVED", `${packet.dimensionId}: ${unresolvedKnowledge.join(",")}`);
    }
    questions.push({
      dimensionId: packet.dimensionId,
      question: packet.question,
      eligibility: packet.eligibility,
      qualityStatus: packet.qualityStatus,
      claims,
      limitations: [...packet.limitations],
      supports: [...packet.supports],
      prohibits: [...packet.prohibits],
      knowledge: packet.knowledgeIds.map((id) => copyKnowledge(knowledgeMap.get(id)!)),
      recommendationAnchorClaimIds: [...packet.recommendationAnchorClaimIds],
    });
  }

  const input: RideModelInputV2 = {
    schemaVersion: RIDE_MODEL_INPUT_SCHEMA_VERSION,
    rulesVersion: RIDE_MODEL_INPUT_RULES_VERSION,
    evidenceRulesVersion: context.rulesVersion,
    evidenceSchemaVersion: context.schemaVersion,
    rideId: context.rideId,
    analysisRunId: context.analysisRunId,
    userScope: context.userScope,
    privacyFlags: [...context.privacyFlags],
    questions,
    inputStats: {
      totalCharacters: 0,
      maxInputCharacters,
      questionCount: questions.length,
      claimCount: questions.reduce((total, question) => total + question.claims.length, 0),
      knowledgeCount: questions.reduce((total, question) => total + question.knowledge.length, 0),
    },
  };

  const privateField = findPrivateField(input, "input");
  if (privateField) {
    return blocked("PRIVATE_FIELD_PRESENT", `forbidden input detected at ${privateField}; the model call is blocked`);
  }

  const totalCharacters = serialize(input).length;
  if (totalCharacters > maxInputCharacters) {
    return {
      status: "blocked",
      failureCode: "INPUT_BUDGET_EXCEEDED",
      reason: `assembled input needs ${totalCharacters} characters but the budget is ${maxInputCharacters}; questions are reported as undeliverable and no claim is trimmed`,
      undeliverableDimensions: questions
        .map((question) => ({ dimensionId: question.dimensionId, characters: JSON.stringify(question).length }))
        .sort((a, b) => b.characters - a.characters),
    };
  }
  return { status: "ready", input };
}

export function getRideModelInputQuestionV2(
  input: RideModelInputV2,
  dimensionId: string,
): RideModelInputQuestionV2 | undefined {
  return input.questions.find((question) => question.dimensionId === dimensionId);
}
