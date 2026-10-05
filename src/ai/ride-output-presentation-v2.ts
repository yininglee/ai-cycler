// S6-04 (V2 business rules 2.4 / 11.4): presentation adapter turning a
// validated RideModelOutputV2 into display sections for the ride AI view.
// Pure and deterministic — consumed by the offline fixture-driven preview
// page now, and by the production interpretation UI after S6-03 wiring.
// Section order mirrors the V2 user-visible contract: label, overall
// assessment, highlights, per-dimension interpretation, history comparison,
// suggestions, limitation backfill. Optional sections become null when the
// model omits them (evidence-insufficient dimensions are omitted, not filled).
//
// Knowledge references render as numbered footnotes (user decision 2026-10-06):
// the assertion text carries superscript markers and the resolved source
// entries are collected at the very bottom of the page, mirroring the
// knowledge display contract in business rules 11.4.

import type { AnalysisDimensionId } from "../domain/ride-analysis-evidence-v2.ts";
import { RIDE_EVIDENCE_RULES_VERSION } from "../domain/ride-analysis-evidence-v2.ts";
import type { RideModelOutputV2, RideOutputAssertionV2 } from "./ride-output-schema-v2.ts";

// Chinese titles for the nine analysis dimensions (V2 dimension catalog,
// ride-analysis-evidence-v2.ts). Unknown/future ids fall back to the raw id.
export const RIDE_V2_DIMENSION_TITLES: Record<AnalysisDimensionId, string> = {
  pacingExecution: "配速执行",
  climbPerformance: "爬坡表现",
  heartRateLoad: "心率负荷",
  powerOutput: "功率输出",
  intensityAndTrainingLoad: "强度与训练负荷",
  cadenceStrategy: "踏频策略",
  crossSensorCoordination: "跨传感器配合",
  historicalPerformance: "相对过去的表现",
  longTermLoadRecovery: "长期负荷与恢复",
};

export function resolveRideV2DimensionTitle(dimensionId: string): string {
  return RIDE_V2_DIMENSION_TITLES[dimensionId as AnalysisDimensionId] ?? dimensionId;
}

export interface RideOutputPresentationAssertionV2 {
  text: string;
  // Footnote numbers assigned to this assertion's knowledge references,
  // matching the entries in RideOutputPresentationV2.knowledgeFootnotes.
  knowledgeFootnoteNumbers: number[];
}

export interface RideOutputPresentationDimensionV2 {
  dimensionId: string;
  title: string;
  assertions: RideOutputPresentationAssertionV2[];
}

export interface RideOutputPresentationSuggestionV2 extends RideOutputPresentationAssertionV2 {
  riskNote?: string;
}

export interface RideV2KnowledgeFootnote {
  number: number;
  knowledgeId: string;
  // Resolved human-readable source title; falls back to the raw knowledge id.
  title: string;
}

export interface RideOutputPresentationV2 {
  schemaVersion: string;
  rulesVersion: string;
  label: { text: string };
  overallAssessment: RideOutputPresentationAssertionV2;
  highlights: RideOutputPresentationAssertionV2[] | null;
  dimensions: RideOutputPresentationDimensionV2[];
  historyComparison: RideOutputPresentationAssertionV2 | null;
  longTermLoadRecovery: RideOutputPresentationDimensionV2 | null;
  suggestions: RideOutputPresentationSuggestionV2[] | null;
  limitations: string[];
  // All knowledge references referenced across the output, numbered by first
  // appearance in reading order and rendered at the very bottom of the page.
  knowledgeFootnotes: RideV2KnowledgeFootnote[];
  // Repair trace label ("本地整理后通过" / "模型修复后通过") when the shown
  // output passed validation only after the S6-02 repair pipeline.
  repairOutcomeLabel: string | null;
}

export interface BuildRideOutputPresentationV2Options {
  // knowledgeId -> human-readable source title, used to render footnotes.
  knowledgeTitles?: Readonly<Record<string, string>>;
  repairOutcomeLabel?: string;
}

export function buildRideOutputPresentationV2(
  output: RideModelOutputV2,
  options: BuildRideOutputPresentationV2Options = {},
): RideOutputPresentationV2 {
  const knowledgeTitles = options.knowledgeTitles ?? {};
  // Footnote numbers are assigned by first appearance in display order.
  const footnoteNumbers = new Map<string, number>();
  const knowledgeFootnotes: RideV2KnowledgeFootnote[] = [];

  const toPresentationAssertion = (assertion: RideOutputAssertionV2): RideOutputPresentationAssertionV2 => {
    const knowledgeFootnoteNumbers = (assertion.knowledgeIds ?? []).map((id) => {
      const existing = footnoteNumbers.get(id);
      if (existing !== undefined) return existing;
      const number = knowledgeFootnotes.length + 1;
      footnoteNumbers.set(id, number);
      knowledgeFootnotes.push({ number, knowledgeId: id, title: knowledgeTitles[id] ?? id });
      return number;
    });
    return { text: assertion.text, knowledgeFootnoteNumbers };
  };

  // Assertions are converted in page display order so footnote numbers follow
  // first appearance as read top-to-bottom: overall assessment, highlights,
  // dimensions, history comparison, long-term load & recovery, suggestions.
  const overallAssessment = toPresentationAssertion(output.overallAssessment);
  const highlights =
    output.highlights && output.highlights.length > 0
      ? output.highlights.map(toPresentationAssertion)
      : null;

  const dimensionSections: RideOutputPresentationDimensionV2[] = [];
  let pmcDimension: RideModelOutputV2["dimensions"][number] | null = null;

  for (const dimension of output.dimensions) {
    if (dimension.dimensionId === "longTermLoadRecovery") {
      // Deferred: the PMC section renders after history comparison on the
      // page, so its assertions are converted below to keep footnote numbers
      // aligned with display order.
      pmcDimension = dimension;
    } else {
      dimensionSections.push({
        dimensionId: dimension.dimensionId,
        title: resolveRideV2DimensionTitle(dimension.dimensionId),
        assertions: dimension.assertions.map(toPresentationAssertion),
      });
    }
  }

  const historyComparison = output.historyComparison
    ? toPresentationAssertion(output.historyComparison)
    : null;
  const longTermLoadRecovery = pmcDimension
    ? {
        dimensionId: pmcDimension.dimensionId,
        title: resolveRideV2DimensionTitle(pmcDimension.dimensionId),
        assertions: pmcDimension.assertions.map(toPresentationAssertion),
      }
    : null;
  const suggestions =
    output.suggestions && output.suggestions.length > 0
      ? output.suggestions.map((item) => ({
          ...toPresentationAssertion(item),
          riskNote: item.riskNote,
        }))
      : null;

  return {
    schemaVersion: output.schemaVersion,
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    label: { text: output.label.text },
    overallAssessment,
    highlights,
    dimensions: dimensionSections,
    historyComparison,
    longTermLoadRecovery,
    suggestions,
    limitations: [...output.limitations],
    knowledgeFootnotes,
    repairOutcomeLabel: options.repairOutcomeLabel ?? null,
  };
}
