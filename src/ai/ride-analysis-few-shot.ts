import libraryJson from "../../prompts/ride-analysis-few-shot-v0.1.json" with { type: "json" };

import type { AnalysisDimensionKey, AnalysisEligibility } from "../domain/analysis-eligibility.ts";
import type { RideAnalysisContext } from "../domain/ride-analysis-context.ts";

export const RIDE_ANALYSIS_FEW_SHOT_VERSION = "ride-analysis-few-shot-v0.1" as const;
export const RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION = "few-shot-router-v0.1" as const;
export type FewShotMode = "disabled" | "enabled";

export type FewShotScenario =
  | "route_time_elevation"
  | "heart_rate_only"
  | "power_only"
  | "heart_rate_and_power"
  | "cadence_without_heart_rate"
  | "first_or_no_history"
  | "history_comparable"
  | "history_not_comparable"
  | "missing_or_anomalous_data"
  | "schema_repair_or_safety";

export interface RideAnalysisFewShotExample {
  exampleId: string;
  scenario: FewShotScenario;
  capabilityKeys: string[];
  allowedDimensions: AnalysisDimensionKey[];
  inputFacts: Array<{ claimId: string; meaning: string }>;
  expectedOutput: Record<string, unknown>;
  forbiddenConclusions: string[];
  qualityStatus: "draft_needs_review" | "approved_for_experiment";
}

export interface RideAnalysisFewShotLibrary {
  libraryVersion: typeof RIDE_ANALYSIS_FEW_SHOT_VERSION;
  dataPolicy: "synthetic_only";
  examples: RideAnalysisFewShotExample[];
}

export interface FewShotSelection {
  mode: FewShotMode;
  reason: "baseline_no_few_shot" | "not_eligible" | "no_approved_examples" | "selected";
  libraryVersion: typeof RIDE_ANALYSIS_FEW_SHOT_VERSION;
  routerVersion: typeof RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION;
  exampleIds: string[];
  examples: RideAnalysisFewShotExample[];
}

export function disabledRideAnalysisFewShots(
  reason: FewShotSelection["reason"] = "baseline_no_few_shot",
): FewShotSelection {
  return {
    mode: "disabled",
    reason,
    libraryVersion: RIDE_ANALYSIS_FEW_SHOT_VERSION,
    routerVersion: RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION,
    exampleIds: [],
    examples: [],
  };
}

const SCENARIOS = new Set<FewShotScenario>([
  "route_time_elevation",
  "heart_rate_only",
  "power_only",
  "heart_rate_and_power",
  "cadence_without_heart_rate",
  "first_or_no_history",
  "history_comparable",
  "history_not_comparable",
  "missing_or_anomalous_data",
  "schema_repair_or_safety",
]);
const OUTPUT_KEYS = new Set([
  "schemaVersion",
  "headline",
  "overallAssessment",
  "dimensions",
  "notableEvents",
  "nextAction",
  "limitations",
  "safetyLevel",
  "shareCopy",
]);

export const rideAnalysisFewShotLibrary = libraryJson as RideAnalysisFewShotLibrary;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasCompleteOutputShape(value: Record<string, unknown>): boolean {
  return value.schemaVersion === "ride-analysis-output-v0.3"
    && Object.keys(value).length === OUTPUT_KEYS.size
    && Object.keys(value).every((key) => OUTPUT_KEYS.has(key))
    && typeof value.headline === "string"
    && record(value.overallAssessment) !== undefined
    && Array.isArray(value.dimensions)
    && Array.isArray(value.notableEvents)
    && (value.nextAction === null || record(value.nextAction) !== undefined)
    && Array.isArray(value.limitations)
    && ["normal", "caution", "stop"].includes(String(value.safetyLevel))
    && Array.isArray(value.shareCopy)
    && value.shareCopy.length === 3;
}

function exampleFor(scenario: FewShotScenario): RideAnalysisFewShotExample | undefined {
  return rideAnalysisFewShotLibrary.examples.find((example) => (
    example.scenario === scenario && example.qualityStatus === "approved_for_experiment"
  ));
}

function hasDimension(eligibility: AnalysisEligibility, key: AnalysisDimensionKey): boolean {
  return eligibility.allowedDimensionKeys.includes(key);
}

function primaryScenario(eligibility: AnalysisEligibility): FewShotScenario {
  const heartRate = hasDimension(eligibility, "heartRate");
  const power = hasDimension(eligibility, "power");
  const cadence = hasDimension(eligibility, "cadence");
  if (heartRate && power) return "heart_rate_and_power";
  if (power) return "power_only";
  if (cadence && !heartRate) return "cadence_without_heart_rate";
  if (heartRate) return "heart_rate_only";
  return "route_time_elevation";
}

function historyScenario(context: RideAnalysisContext, eligibility: AnalysisEligibility): FewShotScenario {
  if (hasDimension(eligibility, "history")) return "history_comparable";
  return context.historicalComparison ? "history_not_comparable" : "first_or_no_history";
}

export function validateRideAnalysisFewShotLibrary(
  library: RideAnalysisFewShotLibrary = rideAnalysisFewShotLibrary,
): string[] {
  const issues: string[] = [];
  if (library.libraryVersion !== RIDE_ANALYSIS_FEW_SHOT_VERSION) issues.push("INVALID_LIBRARY_VERSION");
  if (library.dataPolicy !== "synthetic_only") issues.push("INVALID_DATA_POLICY");
  const ids = library.examples.map((example) => example.exampleId);
  if (new Set(ids).size !== ids.length) issues.push("DUPLICATE_EXAMPLE_ID");
  for (const scenario of SCENARIOS) {
    if (!library.examples.some((example) => example.scenario === scenario)) issues.push(`MISSING_SCENARIO:${scenario}`);
  }
  for (const example of library.examples) {
    if (!SCENARIOS.has(example.scenario)) issues.push(`UNKNOWN_SCENARIO:${example.scenario}`);
    if (!example.exampleId.trim()) issues.push("EMPTY_EXAMPLE_ID");
    if (!["draft_needs_review", "approved_for_experiment"].includes(example.qualityStatus)) issues.push(`INVALID_QUALITY_STATUS:${example.exampleId}`);
    if (example.inputFacts.length === 0) issues.push(`EMPTY_INPUT_FACTS:${example.exampleId}`);
    if (!hasCompleteOutputShape(example.expectedOutput)) issues.push(`INVALID_EXPECTED_OUTPUT:${example.exampleId}`);
  }
  return issues;
}

export function selectRideAnalysisFewShots(
  context: RideAnalysisContext,
  eligibility: AnalysisEligibility,
  phase: "generate" | "repair" = "generate",
): FewShotSelection {
  if (!eligibility.eligible) {
    return disabledRideAnalysisFewShots("not_eligible");
  }
  const scenarios = [primaryScenario(eligibility), historyScenario(context, eligibility)];
  if (phase === "repair") scenarios.push("schema_repair_or_safety");
  const examples = [...new Set(scenarios)].flatMap((scenario) => exampleFor(scenario) ?? []).slice(0, 3);
  if (examples.length === 0) return disabledRideAnalysisFewShots("no_approved_examples");
  return {
    mode: "enabled",
    reason: "selected",
    libraryVersion: RIDE_ANALYSIS_FEW_SHOT_VERSION,
    routerVersion: RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION,
    exampleIds: examples.map((example) => example.exampleId),
    examples,
  };
}
