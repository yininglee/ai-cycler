import type { CandidateVisualRef, InterpretationDimensionId } from "./ride-interpretation-v04-candidate.ts";
import type { RideInterpretationInputV04Candidate } from "./ride-interpretation-input-v04-candidate.ts";
import {
  validateRideInterpretationOutputV04Candidate,
  type RideInterpretationOutputV04Candidate,
} from "./ride-interpretation-output-v04-candidate.ts";

export const RIDE_INTERPRETATION_PRESENTATION_V04_CANDIDATE_VERSION = "ride-interpretation-presentation-v0.4-candidate" as const;

export interface RideInterpretationRenderedBlock {
  blockId: string;
  kind: "one_line_label" | "overall_assessment" | "dimension" | "highlight" | "limitation" | "next_action";
  dimensionId?: InterpretationDimensionId;
  candidateClaimIds: string[];
  visualRefIds: string[];
}

export interface RideInterpretationPresentationTraceRefs {
  candidateClaimIds: string[];
  sourceClaimIds: string[];
  visualRefIds: string[];
}

export interface RideInterpretationPresentationV04Candidate {
  presentationVersion: typeof RIDE_INTERPRETATION_PRESENTATION_V04_CANDIDATE_VERSION;
  validationStatus: "accepted" | "rejected";
  errorCodes: string[];
  acceptedOutput: RideInterpretationOutputV04Candidate | null;
  resolvedVisuals: CandidateVisualRef[];
  renderedBlocks: RideInterpretationRenderedBlock[];
  fallbackLevel: "none" | "b0";
  traceRefs: RideInterpretationPresentationTraceRefs;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function unitCandidateClaimIds(unit: { claimIds: string[] }): string[] { return unique(unit.claimIds); }

function rejectedPresentation(errorCodes: string[]): RideInterpretationPresentationV04Candidate {
  return {
    presentationVersion: RIDE_INTERPRETATION_PRESENTATION_V04_CANDIDATE_VERSION,
    validationStatus: "rejected",
    errorCodes: unique(errorCodes),
    acceptedOutput: null,
    resolvedVisuals: [],
    renderedBlocks: [],
    fallbackLevel: "b0",
    traceRefs: { candidateClaimIds: [], sourceClaimIds: [], visualRefIds: [] },
  };
}

export function assembleRideInterpretationPresentationV04Candidate(
  output: RideInterpretationOutputV04Candidate,
  input: RideInterpretationInputV04Candidate,
): RideInterpretationPresentationV04Candidate {
  const validation = validateRideInterpretationOutputV04Candidate(output, input);
  if (!validation.valid) return rejectedPresentation(validation.issues);

  const blocks: RideInterpretationRenderedBlock[] = [
    {
      blockId: "one_line_label",
      kind: "one_line_label",
      candidateClaimIds: [...output.oneLineLabel.claimIds],
      visualRefIds: [],
    },
    {
      blockId: "overall_assessment",
      kind: "overall_assessment",
      candidateClaimIds: unitCandidateClaimIds(output.overallAssessment),
      visualRefIds: [...output.overallAssessment.visualRefIds],
    },
  ];

  // All highlights are shown in the overall assessment card. Their evidence
  // may originate from any selected dimension, but L8 requires it to be part
  // of the overall assessment evidence subset.
  for (let index = 0; index < output.highlights.length; index += 1) {
    const highlight = output.highlights[index]!;
    if (highlight.target.kind !== "overall") continue;
    blocks.push({
      blockId: `highlight:overall:${index}`,
      kind: "highlight",
      candidateClaimIds: [...highlight.claimIds],
      visualRefIds: [...highlight.visualRefIds],
    });
  }

  for (const dimension of output.dimensions) {
    blocks.push({
      blockId: `dimension:${dimension.dimensionId}`,
      kind: "dimension",
      dimensionId: dimension.dimensionId,
      candidateClaimIds: unitCandidateClaimIds(dimension),
      visualRefIds: [...dimension.visualRefIds],
    });
    for (const limitation of output.limitations.filter((item) => item.dimensionId === dimension.dimensionId)) {
      blocks.push({
        blockId: `limitation:${limitation.dimensionId}`,
        kind: "limitation",
        dimensionId: limitation.dimensionId,
        candidateClaimIds: [...limitation.claimIds],
        visualRefIds: [],
      });
    }
  }
  if (output.nextAction) {
    blocks.push({
      blockId: "next_action",
      kind: "next_action",
      candidateClaimIds: [...output.nextAction.basisClaimIds],
      visualRefIds: [],
    });
  }

  const visualIds = unique(blocks.flatMap((block) => block.visualRefIds));
  const visualRegistry = new Map(input.visualRegistry.map((visual) => [visual.visualId, visual]));
  const resolvedVisuals = visualIds.map((visualId) => visualRegistry.get(visualId)).filter((visual): visual is CandidateVisualRef => Boolean(visual));
  if (resolvedVisuals.length !== visualIds.length) return rejectedPresentation(["RESOLVED_VISUAL_MISSING"]);

  const candidateClaimIds = unique(blocks.flatMap((block) => block.candidateClaimIds));
  const candidateClaims = new Map(input.candidateClaims.map((claim) => [claim.claimId, claim]));
  const sourceClaimIds = unique(candidateClaimIds.flatMap((claimId) => candidateClaims.get(claimId)?.sourceClaimIds ?? []));

  return {
    presentationVersion: RIDE_INTERPRETATION_PRESENTATION_V04_CANDIDATE_VERSION,
    validationStatus: "accepted",
    errorCodes: [],
    acceptedOutput: structuredClone(output),
    resolvedVisuals: resolvedVisuals.map((visual) => ({ ...visual, sourceClaimIds: [...visual.sourceClaimIds] })),
    renderedBlocks: blocks.map((block) => ({
      ...block,
      candidateClaimIds: [...block.candidateClaimIds],
      visualRefIds: [...block.visualRefIds],
    })),
    fallbackLevel: "none",
    traceRefs: {
      candidateClaimIds,
      sourceClaimIds,
      visualRefIds: visualIds,
    },
  };
}
