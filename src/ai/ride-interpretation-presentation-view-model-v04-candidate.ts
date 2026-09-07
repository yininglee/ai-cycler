import type { RideRecord } from "../domain/ride-schema.ts";
import { buildRidePageViewModelFromRecord } from "../ui/ride-view-model.ts";
import type { RideChartKey, RideSeriesChartDisplay, RideVisualDisplay } from "../ui/ride-series-view-model.ts";
import type {
  CandidateVisualRef,
  InterpretationDimensionId,
} from "./ride-interpretation-v04-candidate.ts";
import type {
  RideInterpretationPresentationV04Candidate,
  RideInterpretationRenderedBlock,
} from "./ride-interpretation-presentation-v04-candidate.ts";

/** L6 plan summary the view model needs to surface to the front-end so it can
 *  decide whether an "view all interpretations" affordance is meaningful and
 *  render the catalog in priority order. */
export interface RideInterpretationPlanSummary {
  mode: "default" | "expanded";
  /** Full catalog-eligible dimension ids in priority order (the L6 ranked
   *  list, before the default-mode top-3 cap). Empty when the plan rejected
   *  everything. */
  eligibleDimensionIds: InterpretationDimensionId[];
}

export const RIDE_INTERPRETATION_PRESENTATION_VM_V04_CANDIDATE_VERSION = "ride-interpretation-presentation-vm-v0.4-candidate" as const;

export interface RideInterpretationVisualBinding {
  visualId: string;
  sourceClaimIds: string[];
  availability: CandidateVisualRef["availability"];
  ruleVersion: string;
  chartKey?: RideChartKey;
  chart?: RideSeriesChartDisplay;
}

export interface RideInterpretationRenderedBlockViewModel extends RideInterpretationRenderedBlock {
  visuals: RideInterpretationVisualBinding[];
}

export interface RideInterpretationPresentationViewModelV04Candidate {
  viewModelVersion: typeof RIDE_INTERPRETATION_PRESENTATION_VM_V04_CANDIDATE_VERSION;
  validationStatus: "accepted" | "rejected";
  errorCodes: string[];
  visuals: RideVisualDisplay;
  renderedBlocks: RideInterpretationRenderedBlockViewModel[];
  unresolvedVisualIds: string[];
  sourcePresentationVersion: string;
  /** L6 plan mode that produced this response. Front-end uses this to choose
   *  between "show top 3 + expand affordance" (default) and "show all in
   *  catalog order + collapse affordance" (expanded). */
  mode: "default" | "expanded";
  /** Full eligible dimension list in priority order, surfaced so the front-end
   *  can know how many dimensions *could* appear in expanded mode even when
   *  default mode only narrated a subset. Empty when no dimensions eligible. */
  eligibleDimensionIds: InterpretationDimensionId[];
}

const VISUAL_CHART_KEYS: Record<string, RideChartKey> = {
  "visual:series:speed": "speed",
  "visual:series:elevation": "elevation",
  "visual:series:heart_rate": "heart_rate",
  "visual:series:power": "power",
  "visual:series:cadence": "cadence",
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function rejected(
  presentation: RideInterpretationPresentationV04Candidate,
  visuals: RideVisualDisplay,
  errorCodes: string[],
  unresolvedVisualIds: string[],
  planSummary: RideInterpretationPlanSummary,
): RideInterpretationPresentationViewModelV04Candidate {
  return {
    viewModelVersion: RIDE_INTERPRETATION_PRESENTATION_VM_V04_CANDIDATE_VERSION,
    validationStatus: "rejected",
    errorCodes: unique(errorCodes),
    visuals,
    renderedBlocks: [],
    unresolvedVisualIds: unique(unresolvedVisualIds),
    sourcePresentationVersion: presentation.presentationVersion,
    mode: planSummary.mode,
    eligibleDimensionIds: [...planSummary.eligibleDimensionIds],
  };
}

export function buildRideInterpretationPresentationViewModelV04Candidate(
  record: RideRecord,
  presentation: RideInterpretationPresentationV04Candidate,
  planSummary: RideInterpretationPlanSummary = { mode: "default", eligibleDimensionIds: [] },
): RideInterpretationPresentationViewModelV04Candidate {
  const pageView = buildRidePageViewModelFromRecord(record);
  const visuals = pageView.visuals;
  if (presentation.validationStatus !== "accepted") {
    return rejected(presentation, visuals, ["SOURCE_PRESENTATION_REJECTED", ...presentation.errorCodes], [], planSummary);
  }

  const chartMap = new Map(visuals.charts.map((chart) => [chart.key, chart]));
  const visualMap = new Map(presentation.resolvedVisuals.map((visual) => [visual.visualId, visual]));
  const unresolvedVisualIds: string[] = [];
  const bindings = new Map<string, RideInterpretationVisualBinding>();
  for (const visualId of presentation.traceRefs.visualRefIds) {
    const visual = visualMap.get(visualId);
    const chartKey = VISUAL_CHART_KEYS[visualId];
    const chart = chartKey ? chartMap.get(chartKey) : undefined;
    if (!visual || !chart) {
      unresolvedVisualIds.push(visualId);
      continue;
    }
    bindings.set(visualId, {
      visualId,
      sourceClaimIds: [...visual.sourceClaimIds],
      availability: visual.availability,
      ruleVersion: visual.ruleVersion,
      chartKey,
      chart,
    });
  }
  if (unresolvedVisualIds.length > 0) {
    return rejected(presentation, visuals, ["DETERMINISTIC_VISUAL_NOT_FOUND"], unresolvedVisualIds, planSummary);
  }

  const renderedBlocks = presentation.renderedBlocks.map((block) => ({
    ...block,
    visuals: block.visualRefIds.map((visualId) => bindings.get(visualId)).filter((binding): binding is RideInterpretationVisualBinding => Boolean(binding)),
  }));
  return {
    viewModelVersion: RIDE_INTERPRETATION_PRESENTATION_VM_V04_CANDIDATE_VERSION,
    validationStatus: "accepted",
    errorCodes: [],
    visuals: { ...visuals },
    renderedBlocks,
    unresolvedVisualIds: [],
    sourcePresentationVersion: presentation.presentationVersion,
    mode: planSummary.mode,
    eligibleDimensionIds: [...planSummary.eligibleDimensionIds],
  };
}
