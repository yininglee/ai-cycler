import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
  buildRideAnalysisContext,
  validateRideAnalysisContext,
} from "../src/domain/ride-analysis-context.ts";
import { buildHistoricalComparisonSnapshot, type HistoricalRide } from "../src/domain/historical-comparison.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function record(fixtureId: string, rideId = fixtureId): RideRecord {
  const fixture = getRideFixture(fixtureId);
  const value: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  value.activity.rideId = rideId;
  value.series.rideId = rideId;
  return value;
}

function historyRide(fixtureId: string, historyId: string, startTime: string, routeKey = "route-a"): HistoricalRide {
  const value = record(fixtureId, historyId);
  value.activity.startTime = startTime;
  for (const metric of Object.values(value.activity.metrics)) if (metric) metric.recordedAt = startTime;
  return { metadata: { historyId, routeKey, deviceKey: "device-a", sceneKey: "outdoor" }, record: value };
}

test("context v0.2 assembles facts, features, capabilities and explicit profile fields without dataLevel", () => {
  const ride = record("l3-built-in-sample");
  const profile = createUserProfile({ age: 35, weightKg: 70, ftpWatts: 240 }, "2026-08-20T08:00:00.000Z");
  const context = buildRideAnalysisContext(ride, {
    profile,
    profileFieldKeys: ["age", "maxHeartRate", "ftp"],
  });

  assert.equal(context.schemaVersion, RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION);
  assert.equal(context.contextType, "ride_analysis");
  assert.equal("dataLevel" in context, false);
  assert.equal(JSON.stringify(context).includes("dataLevel"), false);
  assert.ok(context.recordedMetrics.avgPowerW);
  assert.ok(context.derivedMetrics.normalizedPowerW);
  assert.ok(context.featureSnapshot.features.length > 0);
  assert.deepEqual(Object.keys(context.profileFacts).sort(), ["age", "ftp", "maxHeartRate"]);
  assert.equal(context.profileFacts.weightKg, undefined);
  assert.ok(context.allowedClaims.some((claim) => claim.kind === "feature"));
  const distance = context.allowedClaims.find((claim) => claim.key === "distanceM");
  const speed = context.allowedClaims.find((claim) => claim.key === "avgSpeedMps");
  const speedDelta = context.allowedClaims.find((claim) => claim.key === "speedFirstLastDeltaMps");
  assert.equal(distance?.value, 45_000);
  assert.equal(distance?.displayValue, "45");
  assert.equal(distance?.displayUnit, "km");
  assert.equal(speed?.displayValue, "25.7");
  assert.equal(speed?.displayUnit, "km/h");
  assert.equal(speedDelta?.displayValue, "-4.62");
  assert.equal(speedDelta?.displayUnit, "km/h");
  for (const key of ["speedCoefficientOfVariation", "powerCoefficientOfVariation", "cadenceCoefficientOfVariation"]) {
    const coefficient = context.allowedClaims.find((claim) => claim.key === key);
    assert.ok(coefficient && coefficient.value !== undefined);
    assert.equal(coefficient?.unit, "ratio");
    assert.equal(coefficient?.displayUnit, "ratio");
    assert.equal(coefficient.displayValue, Number(coefficient.value.toFixed(2)).toString());
  }
  assert.equal(context.allowedClaims.find((claim) => claim.key === "speedStdDevMps")?.unit, "m/s");
  assert.equal(context.allowedClaims.find((claim) => claim.key === "powerStdDevW")?.unit, "W");
  assert.equal(context.allowedClaims.find((claim) => claim.key === "cadenceStdDevRpm")?.unit, "rpm");
  assert.equal(validateRideAnalysisContext(context).valid, true);
});

test("history snapshot is included as facts and enables history capabilities without enabling long-term trend", () => {
  const anchor = historyRide("l3-built-in-sample", "anchor-context", "2026-08-20T08:00:00Z");
  const previousOne = historyRide("l3-built-in-sample", "previous-context-1", "2026-08-18T08:00:00Z");
  const previousTwo = historyRide("l3-built-in-sample", "previous-context-2", "2026-08-16T08:00:00Z");
  const history = buildHistoricalComparisonSnapshot(anchor, [anchor, previousOne, previousTwo], {
    metricKeys: ["avgPowerW"],
    routeScope: "same_route",
  });
  const context = buildRideAnalysisContext(anchor.record, { historicalComparison: history });
  const historyCapability = context.capabilities.find((capability) => capability.key === "historyComparison")!;
  const sameRouteCapability = context.capabilities.find((capability) => capability.key === "sameRouteComparison")!;
  const trendCapability = context.capabilities.find((capability) => capability.key === "trend")!;

  assert.equal(context.historicalComparison?.anchorRideId, "anchor-context");
  assert.equal(historyCapability.available, true);
  assert.equal(sameRouteCapability.available, true);
  assert.equal(trendCapability.available, false);
  assert.ok(context.allowedClaims.some((claim) => claim.kind === "history"));
  assert.equal(validateRideAnalysisContext(context).valid, true);
});

test("context does not leak raw series points, source filename or unrequested profile facts", () => {
  const ride = record("l1-built-in-sample");
  ride.activity.source.fileName = "private-ride.fit";
  const profile = createUserProfile({ age: 40, heightCm: 180, weightKg: 75 }, "2026-08-20T08:00:00.000Z");
  const context = buildRideAnalysisContext(ride, { profile });
  const serialized = JSON.stringify(context);

  assert.equal(serialized.includes("private-ride.fit"), false);
  assert.equal(serialized.includes('"points"'), false);
  assert.deepEqual(context.profileFacts, {});
  assert.ok(context.privacyFlags.includes("raw_track_excluded"));
  assert.ok(context.privacyFlags.includes("source_filename_excluded"));
});

test("context rejects mismatched feature or historical snapshots", () => {
  const ride = record("l1-built-in-sample", "ride-a");
  const other = record("l1-built-in-sample", "ride-b");
  const featureSnapshot = buildRideAnalysisContext(other).featureSnapshot;
  assert.throws(() => buildRideAnalysisContext(ride, { featureSnapshot }), /featureSnapshot/);

  const history = buildHistoricalComparisonSnapshot(
    historyRide("l1-built-in-sample", "other-anchor", "2026-08-20T08:00:00Z"),
    [],
    { metricKeys: ["distanceM"] },
  );
  assert.throws(() => buildRideAnalysisContext(ride, { historicalComparison: history }), /historicalComparison/);
});

test("validator rejects a legacy dataLevel field in a context payload", () => {
  const context = buildRideAnalysisContext(record("l1-built-in-sample"));
  const legacy = { ...context, dataLevel: "L1" } as typeof context & { dataLevel: string };
  const result = validateRideAnalysisContext(legacy);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "LEGACY_DATA_LEVEL_PRESENT"));
});
