import test from "node:test";
import assert from "node:assert/strict";
import {
  RIDE_METRIC_SPEC_VERSION,
  rideDerivedMetricSpecsV21,
  validateRideMetricSpecsV21,
} from "../src/domain/ride-derived-metric-spec-v21.ts";
import { analysisDimensionIds } from "../src/domain/ride-analysis-evidence-v2.ts";

const singleRideDimensionIds = analysisDimensionIds.slice(0, 7);

test("V21 metric specs pass the contract validator with zero issues", () => {
  assert.deepEqual(validateRideMetricSpecsV21(rideDerivedMetricSpecsV21), []);
});

test("V21 metric specs have unique ids and cover all 7 single-ride dimensions", () => {
  const ids = rideDerivedMetricSpecsV21.map((spec) => spec.metricId);
  assert.equal(new Set(ids).size, ids.length);
  const covered = new Set(rideDerivedMetricSpecsV21.map((spec) => spec.dimensionId));
  assert.deepEqual([...covered].sort(), [...singleRideDimensionIds].sort());
});

test("V21 metric specs cover every dimension with at least 4 metrics", () => {
  for (const dimension of singleRideDimensionIds) {
    const count = rideDerivedMetricSpecsV21.filter((spec) => spec.dimensionId === dimension).length;
    assert.ok(count >= 4, `${dimension} has only ${count} metrics`);
  }
});

test("V21 metric coverage matrix matches the knowledge base key-metric count per dimension", () => {
  const expected: Record<string, number> = {
    pacingExecution: 5,
    climbPerformance: 5,
    heartRateLoad: 6, // 平均/最大心率拆 2 条
    powerOutput: 6,
    intensityAndTrainingLoad: 4,
    cadenceStrategy: 5,
    crossSensorCoordination: 6,
  };
  const actual: Record<string, number> = {};
  for (const spec of rideDerivedMetricSpecsV21) {
    actual[spec.dimensionId] = (actual[spec.dimensionId] ?? 0) + 1;
  }
  assert.deepEqual(actual, expected);
  assert.equal(rideDerivedMetricSpecsV21.length, 37);
});

test("V21 computed metrics always declare formula and dependencies", () => {
  for (const spec of rideDerivedMetricSpecsV21) {
    if (spec.source === "computed") {
      assert.ok(spec.formula && spec.formula.trim(), `${spec.metricId} missing formula`);
      assert.ok(spec.dependencies && spec.dependencies.length > 0, `${spec.metricId} missing dependencies`);
    }
  }
});

test("V21 every metric declares supports and prohibits (conclusion guardrails)", () => {
  for (const spec of rideDerivedMetricSpecsV21) {
    assert.ok(spec.supports.length > 0, `${spec.metricId} missing supports`);
    assert.ok(spec.prohibits.length > 0, `${spec.metricId} missing prohibits`);
  }
});

test("V21 shared metrics (VI/EF) are referenced, not re-specified, in secondary dimensions", () => {
  const vi = rideDerivedMetricSpecsV21.find((spec) => spec.metricId === "power.vi");
  assert.ok(vi?.dependencies?.includes("pacing.variabilityIndex"));
  const ef = rideDerivedMetricSpecsV21.find((spec) => spec.metricId === "crossSensor.efficiencyFactor");
  assert.ok(ef?.dependencies?.includes("heartRate.efficiencyFactor"));
});

test("V21 metric spec version is frozen", () => {
  assert.match(RIDE_METRIC_SPEC_VERSION, /^ride-metric-spec-v2\.1\.0$/);
});
