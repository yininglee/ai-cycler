import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalysisEligibility,
  validateAnalysisEligibility,
} from "../src/domain/analysis-eligibility.ts";
import {
  buildRideAnalysisContext,
} from "../src/domain/ride-analysis-context.ts";
import { buildHistoricalComparisonSnapshot, type HistoricalRide } from "../src/domain/historical-comparison.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function record(fixtureId: string, rideId = fixtureId): RideRecord {
  const fixture = getRideFixture(fixtureId);
  const value: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  value.activity.rideId = rideId;
  value.series.rideId = rideId;
  return value;
}

function historyRide(fixtureId: string, historyId: string, startTime: string): HistoricalRide {
  const value = record(fixtureId, historyId);
  value.activity.startTime = startTime;
  for (const metric of Object.values(value.activity.metrics)) if (metric) metric.recordedAt = startTime;
  return { metadata: { historyId, routeKey: "route-a", deviceKey: "device-a", sceneKey: "outdoor" }, record: value };
}

test("only current summary claims without deterministic features do not call the model", () => {
  const ride = record("l1-built-in-sample");
  const base = buildRideAnalysisContext(ride);
  const context = buildRideAnalysisContext(ride, {
    featureSnapshot: {
      ...base.featureSnapshot,
      features: [],
    },
  });
  context.allowedClaims = context.allowedClaims.filter(
    (claim) => claim.kind !== "feature" && claim.kind !== "advanced",
  );
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "not_eligible");
  assert.equal(eligibility.eligible, false);
  assert.deepEqual(eligibility.reasonCodes, ["NO_INSIGHT_SOURCE"]);
  assert.deepEqual(eligibility.allowedDimensionKeys, []);
  assert.equal(validateAnalysisEligibility(eligibility).valid, true);
});

test("feature availability opens only the dimensions backed by actual deterministic features", () => {
  const context = buildRideAnalysisContext(record("l3-built-in-sample"));
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "eligible");
  assert.deepEqual(eligibility.insightSources, ["feature", "advanced"]);
  assert.deepEqual(eligibility.allowedDimensionKeys, ["pace", "heartRate", "power", "cadence", "climbing"]);
  assert.equal(eligibility.allowedDimensionKeys.includes("history"), false);
  assert.equal(eligibility.allowedDimensionKeys.includes("endurance"), false);
  assert.ok(eligibility.requiredClaimIds.every((claimId) => claimId.includes(":feature:") || claimId.includes(":advanced:")));
});

test("a comparable historical snapshot adds history without opening unimplemented trend", () => {
  const anchor = historyRide("l3-built-in-sample", "anchor", "2026-08-20T08:00:00Z");
  const previousOne = historyRide("l3-built-in-sample", "previous-1", "2026-08-18T08:00:00Z");
  const previousTwo = historyRide("l3-built-in-sample", "previous-2", "2026-08-16T08:00:00Z");
  const history = buildHistoricalComparisonSnapshot(anchor, [anchor, previousOne, previousTwo], {
    metricKeys: ["avgPowerW"],
    routeScope: "same_route",
  });
  const context = buildRideAnalysisContext(anchor.record, { historicalComparison: history });
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "eligible");
  assert.deepEqual(eligibility.insightSources, ["feature", "history", "advanced"]);
  assert.equal(eligibility.allowedDimensionKeys.includes("history"), true);
  assert.equal(eligibility.allowedDimensionKeys.includes("trend" as never), false);
  assert.ok(eligibility.reasonCodes.includes("HISTORY_COMPARISON_AVAILABLE"));
  assert.ok(eligibility.requiredClaimIds.some((claimId) => claimId.includes(":history:")));
});

test("an empty or non-comparable history snapshot does not unlock history dimension", () => {
  const anchor = historyRide("l1-built-in-sample", "anchor", "2026-08-20T08:00:00Z");
  const history = buildHistoricalComparisonSnapshot(anchor, [], { metricKeys: ["avgSpeedMps"] });
  const context = buildRideAnalysisContext(anchor.record, { historicalComparison: history });
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "eligible");
  assert.equal(eligibility.allowedDimensionKeys.includes("history"), false);
  assert.equal(eligibility.reasonCodes.includes("HISTORY_COMPARISON_AVAILABLE"), false);
});

test("short activities remain eligible when reliable feature evidence exists", () => {
  const ride = record("l3-built-in-sample");
  ride.activity.metrics.distanceM!.value = 2_500;
  ride.activity.metrics.movingTimeS!.value = 480;
  ride.activity.metrics.avgSpeedMps!.value = 2_500 / 480;
  ride.series.points = ride.series.points.slice(0, 8);
  ride.series.seriesMetadata = Object.fromEntries(
    Object.entries(ride.series.seriesMetadata).map(([key, metadata]) => [key, metadata ? { ...metadata, sampleCount: 8 } : metadata]),
  );
  const context = buildRideAnalysisContext(ride);
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "eligible");
  assert.ok(eligibility.allowedDimensionKeys.length > 0);
});

test("invalid records are blocked before any model insight is considered", () => {
  const context = buildRideAnalysisContext(record("fit-truncated-file"));
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "blocked");
  assert.deepEqual(eligibility.reasonCodes, ["RECORD_REJECTED"]);
  assert.equal(eligibility.fallback, "b0");
});

test("an invalid context contract is blocked before capability inspection", () => {
  const context = buildRideAnalysisContext(record("l3-built-in-sample"));
  const legacy = { ...context, dataLevel: "L3" } as typeof context & { dataLevel: string };
  const eligibility = buildAnalysisEligibility(legacy);

  assert.equal(eligibility.status, "blocked");
  assert.deepEqual(eligibility.reasonCodes, ["CONTEXT_INVALID"]);
  assert.equal(eligibility.fallback, "b0");
});

test("critical safety flags block generation and select the fixed safety fallback", () => {
  const context = buildRideAnalysisContext(record("l3-built-in-sample"), { safetyFlags: ["critical_safety"] });
  const eligibility = buildAnalysisEligibility(context);

  assert.equal(eligibility.status, "blocked");
  assert.equal(eligibility.reasonCodes.includes("SAFETY_BLOCK"), true);
  assert.equal(eligibility.fallback, "safety_stop");
});
