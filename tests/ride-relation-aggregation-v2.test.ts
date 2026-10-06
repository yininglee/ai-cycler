import assert from "node:assert/strict";
import test from "node:test";

import { buildRideSeries } from "../src/domain/ride-series.ts";
import type { RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import type { RideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import type { RideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideTemporalWindowsV2, type JointWindowV2 } from "../src/domain/ride-temporal-windows-v2.ts";
import { buildRideTimingSummary } from "../src/domain/ride-timing.ts";
import {
  buildRideCapabilityClaimsV2,
  selectRelationRepresentatives,
  validateRideCapabilityClaimsV2,
} from "../src/domain/ride-capability-claims-v2.ts";
import { buildRideAnalysisEvidencePacketsV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { buildRideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import { getDemoImportedRide } from "../src/fixtures/demo-imported-rides.ts";

const START = "2026-10-05T06:00:00.000Z";
const PAIRS = ["power-heart_rate", "power-speed", "power-cadence", "speed-heart_rate"];

function record(rows: number): RideRecord {
  const points: Omit<RideSeriesPoint, "sequence">[] = [{ distanceM: 0, elapsedTimeS: 0 }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  for (let index = 0; index < rows; index += 1) {
    elapsedTimeS += 10;
    distanceM += 50;
    points.push({ distanceM, elapsedTimeS, speedMps: 5, powerW: 200, heartRateBpm: 140, cadenceRpm: 85 });
  }
  const series = buildRideSeries({ rideId: "s2-03-ride", sourceKind: "sample", parserVersion: "s2-03-fixture-v1", startTime: START, points });
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "s2-03-ride",
      sport: "cycling",
      source: { kind: "sample", parserVersion: "s2-03-fixture-v1" },
      startTime: START,
      metrics: {},
      sensorQuality: {
        gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        heart_rate: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        cadence: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
      },
      sourceIssues: [],
    },
    series,
  };
}

function climbs(...bounds: Array<[number, number]>): RideEventClimbSummary {
  return { rulesVersion: "ride-event-climb-rules-v0.2", isAvailable: true, unavailableReasons: [],
    climbs: bounds.map(([startDistanceM, endDistanceM], index) => ({
      id: `climb-${index}`, rulesVersion: "ride-event-climb-rules-v0.2",
      elevationRulesVersion: "test", routeShapeRulesVersion: "test", category: "4" as const,
      startDistanceM, endDistanceM, distanceM: endDistanceM - startDistanceM,
      netElevationGainM: 50, averageGrade: 0.05, difficultyScore: 10, unavailableReasons: [],
    })) };
}

function terrainRouteShape(): RideRouteShapeSummary {
  const terrain = { type: "flat" as const, startDistanceM: 0, endDistanceM: 300, distanceM: 300 };
  return {
    rulesVersion: "ride-route-shape-rules-v0.2", isAvailable: true,
    gradeSegments: [], displayGradeSegments: [], trendSegments: [terrain], segments: [terrain],
    movingDistanceM: 1_800, classifiedDistanceM: 300, climbDistanceM: 0, flatDistanceM: 300,
    descentDistanceM: 0, trendClimbDistanceM: 0, trendFlatDistanceM: 300,
    trendDescentDistanceM: 0, trendClassifiedDistanceM: 300, coverageRatio: 1, needsCoverageNotice: false,
  };
}

function window(overrides: Partial<JointWindowV2> & { sharedTimeS: number; commonCoverage: number }): JointWindowV2 {
  return {
    seriesKeys: ["power", "speed"],
    startElapsedTimeS: 0,
    endElapsedTimeS: 30,
    eligibleTimeS: 30,
    sharedIntervalCount: 3,
    means: {},
    evidenceIds: [`evidence:s2-03-ride:series:${overrides.sharedTimeS}-${overrides.commonCoverage}`],
    rulesVersion: "ride-temporal-windows-v2.2",
    expressionBoundary: "same_window_observation_only",
    ...overrides,
  } as JointWindowV2;
}

test("fixed relation claims arrive as one aggregate plus at most three representatives per pair", () => {
  // 150 s of complete data -> five 30 s fixed windows per sensor pair.
  const snapshot = buildRideCapabilityClaimsV2(record(15));
  assert.equal(validateRideCapabilityClaimsV2(snapshot).length, 0);

  for (const pair of PAIRS) {
    const aggregate = snapshot.claims.find((claim) => claim.key === `relation.fixed.${pair}.aggregate`);
    assert.ok(aggregate, pair);
    assert.equal(aggregate.kind, "relation");
    assert.equal(aggregate.aggregatedFromCount, 5);
    assert.ok(aggregate.text?.startsWith("aggregated:"));
    assert.ok(aggregate.text?.includes("5 fixed windows"));
    assert.ok(aggregate.text?.includes("coverage mean"));
    assert.ok(aggregate.text?.includes("total shared time"));
    assert.ok(aggregate.text?.includes("thirds coverage mean"));
    assert.ok(aggregate.supports.includes("same_window_observation"));
    assert.ok(aggregate.prohibits.includes("causation") && aggregate.prohibits.includes("response_order") && aggregate.prohibits.includes("trend"));

    const representatives = snapshot.claims.filter((claim) => claim.key.startsWith(`relation.fixed.${pair}.rep.`));
    assert.equal(representatives.length, 3, pair);
    assert.ok(representatives.every((claim) => claim.aggregatedFromCount === undefined));
    assert.ok(representatives.every((claim) => claim.text?.includes("representative window")));
    // The aggregate claim cites only the representative windows' evidence, so
    // its evidence footprint stays bounded no matter how many windows exist.
    assert.ok(aggregate.evidenceIds.length <= representatives.reduce((total, claim) => total + claim.evidenceIds.length, 0));
  }

  // No per-window fixed relation claims survive outside the representative slots.
  const fixedKeys = snapshot.claims.filter((claim) => claim.key.startsWith("relation.fixed.")).map((claim) => claim.key);
  assert.equal(fixedKeys.length, PAIRS.length * 4);
});

test("representative selection follows the three principles with deterministic fall-through", () => {
  const picks = selectRelationRepresentatives([
    window({ sharedTimeS: 30, commonCoverage: 0.9 }),
    window({ sharedTimeS: 25, commonCoverage: 1.0 }),
    window({ sharedTimeS: 20, commonCoverage: 0.7 }),
    window({ sharedTimeS: 28, commonCoverage: 0.95 }),
    window({ sharedTimeS: 22, commonCoverage: 0.72 }),
  ]);
  assert.deepEqual(picks.map((pick) => pick.reason), ["longest shared time", "highest common coverage", "lowest common coverage"]);
  assert.equal(picks[0]!.window.sharedTimeS, 30);
  assert.equal(picks[1]!.window.commonCoverage, 1.0);
  assert.equal(picks[2]!.window.commonCoverage, 0.7);

  // When the longest-shared window is also the highest-coverage one, the
  // second slot falls through to the next highest coverage.
  const overlap = selectRelationRepresentatives([
    window({ sharedTimeS: 30, commonCoverage: 1.0 }),
    window({ sharedTimeS: 25, commonCoverage: 0.9 }),
    window({ sharedTimeS: 20, commonCoverage: 0.7 }),
    window({ sharedTimeS: 15, commonCoverage: 0.8 }),
  ]);
  assert.equal(overlap[0]!.window.sharedTimeS, 30);
  assert.equal(overlap[1]!.reason, "highest common coverage");
  assert.equal(overlap[1]!.window.commonCoverage, 0.9);
  assert.equal(overlap[2]!.window.commonCoverage, 0.7);
});

test("three or fewer windows are all shown as representatives", () => {
  // 90 s of complete data -> three fixed windows per pair.
  const snapshot = buildRideCapabilityClaimsV2(record(9));
  const representatives = snapshot.claims.filter((claim) => claim.key.startsWith("relation.fixed.power-speed.rep."));
  assert.equal(representatives.length, 3);
  assert.ok(representatives.every((claim) => claim.text?.includes("all 3 fixed windows shown")));
  const aggregate = snapshot.claims.find((claim) => claim.key === "relation.fixed.power-speed.aggregate");
  assert.equal(aggregate?.aggregatedFromCount, 3);
});

test("segment relation claims stay per-window and are never aggregated", () => {
  // Mirror of the S1 segment scenario: 360 s ride with four climbs, two
  // cruise segments, and one terrain run, all producing joint windows.
  const ride = record(36);
  const timing = buildRideTimingSummary(ride);
  timing.cruiseSegments = [
    { startElapsedTimeS: 0, endElapsedTimeS: 120, durationS: 120, averageSpeedMps: 5,
      speedCoefficientOfVariation: 0, isLong: false },
    { startElapsedTimeS: 150, endElapsedTimeS: 300, durationS: 150, averageSpeedMps: 5,
      speedCoefficientOfVariation: 0, isLong: false },
  ];
  const windows = buildRideTemporalWindowsV2(ride, {
    climbs: climbs([100, 300], [350, 550], [600, 800], [850, 1050]),
    timing,
    routeShape: terrainRouteShape(),
  });
  assert.ok(windows.segments.some((segment) => segment.jointWindows.length > 0));

  const snapshot = buildRideCapabilityClaimsV2(ride, { windows });
  assert.equal(validateRideCapabilityClaimsV2(snapshot).length, 0);
  const segmentRelations = snapshot.claims.filter((claim) =>
    claim.kind === "relation" && !claim.key.startsWith("relation.fixed."));
  assert.ok(segmentRelations.length > 0);
  assert.ok(segmentRelations.every((claim) => claim.aggregatedFromCount === undefined));
  assert.ok(segmentRelations.every((claim) => !claim.text?.startsWith("aggregated:")));
  assert.ok(segmentRelations.every((claim) => claim.prohibits.includes("causation")));
  // The fixed-window aggregation still applies alongside the segment claims.
  assert.ok(snapshot.claims.some((claim) => claim.key === "relation.fixed.power-heart_rate.aggregate"));
});

test("packets disclose the aggregation and the model input records window counts", () => {
  const snapshot = buildRideCapabilityClaimsV2(record(15));
  const context = buildRideAnalysisEvidencePacketsV2(snapshot, {
    analysisRunId: "run:s2-03:test",
    userScope: "user:s2-03:test",
  });
  const crossSensor = context.evidencePackets.find((packet) => packet.dimensionId === "crossSensorCoordination");
  assert.ok(crossSensor);
  for (const pair of PAIRS) {
    assert.ok(crossSensor.limitations.includes(`relation.fixed.${pair}.aggregate:AGGREGATED_FROM_5_WINDOWS`), pair);
  }
  // Packets without relation claims must not carry the aggregation disclosure.
  const pacing = context.evidencePackets.find((packet) => packet.dimensionId === "pacingExecution");
  assert.ok(pacing);
  assert.ok(!pacing.limitations.some((item) => item.includes("AGGREGATED_FROM")));

  const inputResult = buildRideModelInputV2(context, {
    analysisRunId: "run:s2-03:test",
    userScope: "user:s2-03:test",
  });
  assert.equal(inputResult.status, "ready");
  if (inputResult.status !== "ready") throw new Error("unreachable");
  assert.equal(inputResult.input.inputStats.aggregatedRelationPairCount, PAIRS.length);
  assert.equal(inputResult.input.inputStats.aggregatedRelationWindowCount, PAIRS.length * 5);
  assert.ok(inputResult.input.inputStats.totalCharacters <= 160_000);
});

test("demo-ride-2026-07-22 fits the input budget after aggregation", async () => {
  const demo = await getDemoImportedRide("demo-ride-2026-07-22");
  assert.ok(demo);
  const rideRecord = structuredClone(demo.record);
  const snapshot = buildRideCapabilityClaimsV2(rideRecord);
  assert.equal(validateRideCapabilityClaimsV2(snapshot).length, 0);

  const aggregates = snapshot.claims.filter((claim) => claim.aggregatedFromCount !== undefined);
  assert.ok(aggregates.length >= 1);
  assert.ok(aggregates.every((claim) => claim.text?.startsWith("aggregated:")));

  const context = buildRideAnalysisEvidencePacketsV2(snapshot, {
    analysisRunId: "run:s2-03:demo",
    userScope: "user:s2-03:demo",
  });
  const inputResult = buildRideModelInputV2(context, {
    analysisRunId: "run:s2-03:demo",
    userScope: "user:s2-03:demo",
  });
  assert.equal(inputResult.status, "ready");
  if (inputResult.status !== "ready") throw new Error("unreachable");
  assert.ok(inputResult.input.inputStats.aggregatedRelationWindowCount > 100,
    `expected a large aggregated window count, got ${inputResult.input.inputStats.aggregatedRelationWindowCount}`);
  assert.ok(inputResult.input.inputStats.totalCharacters <= 160_000,
    `expected the assembled input to fit the budget, got ${inputResult.input.inputStats.totalCharacters}`);
  // Cross-sensor and power dimensions must still be delivered.
  const dimensions = new Set(inputResult.input.questions.map((question) => question.dimensionId));
  assert.ok(dimensions.has("crossSensorCoordination"));
  assert.ok(dimensions.has("powerOutput"));
});
