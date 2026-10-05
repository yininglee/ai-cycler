// S6-01 (V2 business rules 14.4 / PRD FR-12): versioned output contract for the
// ride analysis model. The structure mirrors PRD section 5.1: label, overall
// assessment, optional highlights, qualified dimensions, optional history
// comparison, optional suggestions, and mandatory limitation backfill. Every
// checkable assertion binds a conclusion type plus the claim IDs — and, when
// knowledge is used, the knowledge IDs — it relies on. Structured citations are
// the input to the independent validator (ride-output-validator-v2.ts), never a
// proof of passing on their own.

export const RIDE_OUTPUT_SCHEMA_VERSION = "ride-output-v2.0.0" as const;

export type RideOutputConclusionType =
  | "fact"
  | "historyComparison"
  | "knowledgeReference"
  | "suggestion";

export const rideOutputConclusionTypes = [
  "fact",
  "historyComparison",
  "knowledgeReference",
  "suggestion",
] as const satisfies readonly RideOutputConclusionType[];

// One checkable assertion. "fact" conclusions must cite ride/history claims;
// "knowledgeReference" conclusions must cite knowledge IDs and may never act as
// personal ride facts; "historyComparison" requires comparable-history claims;
// "suggestion" requires a factual anchor claim (see the validator).
export interface RideOutputAssertionV2 {
  text: string;
  conclusionType: RideOutputConclusionType;
  claimIds: string[];
  knowledgeIds?: string[];
}

export interface RideOutputDimensionV2 {
  dimensionId: string;
  assertions: RideOutputAssertionV2[];
}

export interface RideOutputSuggestionV2 extends RideOutputAssertionV2 {
  riskNote?: string;
}

export interface RideModelOutputV2 {
  schemaVersion: string;
  label: RideOutputAssertionV2;
  overallAssessment: RideOutputAssertionV2;
  highlights?: RideOutputAssertionV2[];
  dimensions: RideOutputDimensionV2[];
  historyComparison?: RideOutputAssertionV2;
  suggestions?: RideOutputSuggestionV2[];
  limitations: string[];
}
