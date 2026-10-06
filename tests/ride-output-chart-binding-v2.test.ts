import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_V2_CHART_BINDING_RULES_VERSION,
  RIDE_V2_DIMENSION_CHART_KEYS,
  bindRideV2DimensionChartsV2,
} from "../src/ai/ride-output-chart-binding-v2.ts";
import type { RideChartKey, RideSeriesChartDisplay, RideVisualDisplay } from "../src/ui/ride-series-view-model.ts";

function makeChart(key: RideChartKey): RideSeriesChartDisplay {
  return {
    key,
    label: `chart ${key}`,
    unit: "u",
    path: `M0,0`,
    areaPath: `M0,0`,
    minLabel: "0",
    maxLabel: "1",
    axisLabel: "axis",
    sampleCount: 10,
    qualityLabel: "good",
    sourceLabel: "record",
    cruiseHighlights: [],
  };
}

function visualsWith(keys: RideChartKey[]): Pick<RideVisualDisplay, "charts"> {
  return { charts: keys.map(makeChart) };
}

test("S6-03 deterministic chart binding maps each mapped dimension to its fixed sensor chart", () => {
  const allMappedDimensions = Object.keys(RIDE_V2_DIMENSION_CHART_KEYS);
  const allChartKeys = [...new Set(Object.values(RIDE_V2_DIMENSION_CHART_KEYS))] as RideChartKey[];
  const visuals = visualsWith(allChartKeys);

  const bound = bindRideV2DimensionChartsV2(visuals, allMappedDimensions);

  assert.equal(Object.keys(bound).length, allMappedDimensions.length);
  for (const dimensionId of allMappedDimensions) {
    const expectedKey = RIDE_V2_DIMENSION_CHART_KEYS[dimensionId as keyof typeof RIDE_V2_DIMENSION_CHART_KEYS];
    assert.equal(bound[dimensionId]?.key, expectedKey, `dimension ${dimensionId}`);
  }
  // Two power-oriented dimensions share the same power chart object.
  assert.equal(bound.powerOutput, bound.intensityAndTrainingLoad);
  assert.equal(bound.powerOutput?.key, "power");
  assert.equal(bound.heartRateLoad?.key, "heart_rate");
});

test("S6-03 skips a dimension when the page did not build its chart", () => {
  const bound = bindRideV2DimensionChartsV2(visualsWith(["speed", "heart_rate"]), ["powerOutput", "heartRateLoad", "pacingExecution"]);
  // power chart missing -> powerOutput unbound; the others bind normally.
  assert.equal(bound.powerOutput, undefined);
  assert.equal(bound.heartRateLoad?.key, "heart_rate");
  assert.equal(bound.pacingExecution?.key, "speed");
});

test("S6-03 never binds charts for dimensions without a natural single-sensor chart", () => {
  const allChartKeys = [...new Set(Object.values(RIDE_V2_DIMENSION_CHART_KEYS))] as RideChartKey[];
  const bound = bindRideV2DimensionChartsV2(
    visualsWith(allChartKeys),
    ["historicalPerformance", "longTermLoadRecovery", "unknownDimension"],
  );
  assert.deepEqual(bound, {});
});

test("S6-03 chart binding rules are versioned", () => {
  assert.equal(typeof RIDE_V2_CHART_BINDING_RULES_VERSION, "string");
  assert.ok(RIDE_V2_CHART_BINDING_RULES_VERSION.length > 0);
});
