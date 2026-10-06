// S6-03: deterministic chart binding for the V2 interpretation view
// (user decision 2026-10-06). Charts are bound by dimension through fixed
// rules — the model never declares chart references, so a fabricated or
// missing visual reference can never degrade an output. A chart renders only
// when the page actually built it from the same RideRecord.

import type { AnalysisDimensionId } from "../domain/ride-analysis-evidence-v2.ts";
import type { RideChartKey, RideSeriesChartDisplay, RideVisualDisplay } from "../ui/ride-series-view-model.ts";

export const RIDE_V2_CHART_BINDING_RULES_VERSION = "ride-v2-chart-binding-v1.0" as const;

// Dimensions without a natural single-sensor chart (relative-to-past, long-term
// load & recovery) intentionally map to no chart.
export const RIDE_V2_DIMENSION_CHART_KEYS: Readonly<Partial<Record<AnalysisDimensionId, RideChartKey>>> = {
  pacingExecution: "speed",
  climbPerformance: "elevation",
  heartRateLoad: "heart_rate",
  powerOutput: "power",
  intensityAndTrainingLoad: "power",
  cadenceStrategy: "cadence",
  crossSensorCoordination: "heart_rate",
};

export function bindRideV2DimensionChartsV2(
  visuals: Pick<RideVisualDisplay, "charts">,
  dimensionIds: readonly string[],
): Record<string, RideSeriesChartDisplay> {
  const chartByKey = new Map(visuals.charts.map((chart) => [chart.key, chart]));
  const bound: Record<string, RideSeriesChartDisplay> = {};
  for (const dimensionId of dimensionIds) {
    const chartKey = RIDE_V2_DIMENSION_CHART_KEYS[dimensionId as AnalysisDimensionId];
    const chart = chartKey ? chartByKey.get(chartKey) : undefined;
    if (chart) bound[dimensionId] = chart;
  }
  return bound;
}
