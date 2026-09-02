import assert from "node:assert/strict";
import test from "node:test";

import { projectRideAnalysisContextForModel } from "../src/ai/ride-analysis-context-projection.ts";
import { buildRideAdvancedClaimSnapshot } from "../src/domain/ride-advanced-claims.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-08-31T06:00:00.000Z";

function record(fixtureId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  return { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
}

function claimKeys(snapshot: ReturnType<typeof buildRideAdvancedClaimSnapshot>): string[] {
  return snapshot.claims.map((item) => item.key);
}

function rebuildSeries(ride: RideRecord): RideRecord {
  ride.series = buildRideSeries({
    rideId: ride.activity.rideId,
    sourceKind: ride.activity.source.kind,
    parserVersion: ride.activity.source.parserVersion,
    ...(ride.activity.startTime ? { startTime: ride.activity.startTime } : {}),
    points: ride.series.points,
  });
  return ride;
}

function withFullSensorSeries(ride: RideRecord): RideRecord {
  ride.series.points = ride.series.points.map((point, index) => ({
    ...point,
    heartRateBpm: 148 + (index % 12),
    cadenceRpm: 82 + (index % 8),
  }));
  return rebuildSeries(ride);
}

test("advanced claim projection is bounded and does not expose raw ride data", () => {
  const ride = withFullSensorSeries(record("l3-power-preview"));
  ride.activity.source.fileName = "private-ride.fit";
  const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const snapshot = buildRideAdvancedClaimSnapshot(ride, profile);
  const context = buildRideAnalysisContext(ride, { profile });
  const projected = projectRideAnalysisContextForModel(context);
  const serialized = JSON.stringify(projected);

  assert.ok(snapshot.claims.some((item) => item.key === "power.normalizedW"));
  assert.ok(snapshot.claims.some((item) => item.key === "heartRate.baseline"));
  assert.ok(snapshot.claims.every((item) => item.kind === "advanced" && item.claimId.includes(":advanced:")));
  assert.ok(snapshot.claims.filter((item) => item.key.startsWith("cruise.representative.")).length <= 3);
  assert.ok(snapshot.claims.filter((item) => item.key.startsWith("climb.representative.")).length <= 3);
  assert.equal(serialized.includes("private-ride.fit"), false);
  assert.equal(serialized.includes("latitude"), false);
  assert.equal(serialized.includes("longitude"), false);
  assert.equal("recordedMetrics" in projected, false);
  assert.equal("featureSnapshot" in projected, false);
});

test("heart-rate claims retain whether the maximum is user-provided or system-estimated", () => {
  const ride = withFullSensorSeries(record("l3-power-preview"));
  const userProfile = createUserProfile({ age: 35, maxHeartRateBpm: 188 }, NOW);
  const estimatedProfile = createUserProfile({ age: 35 }, NOW);
  const userSnapshot = buildRideAdvancedClaimSnapshot(ride, userProfile);
  const estimatedSnapshot = buildRideAdvancedClaimSnapshot(ride, estimatedProfile);

  assert.match(userSnapshot.claims.find((item) => item.key === "heartRate.baseline")?.text ?? "", /用户填写/);
  assert.match(estimatedSnapshot.claims.find((item) => item.key === "heartRate.baseline")?.text ?? "", /按年龄公式估算/);
  assert.ok(estimatedSnapshot.limitations.includes("advanced.heartRate:baseline_system_estimated"));
  assert.equal(userSnapshot.limitations.includes("advanced.heartRate:baseline_system_estimated"), false);
});

test("all-zero cadence placeholders do not create cadence claims", () => {
  const ride = withFullSensorSeries(record("l3-power-preview"));
  ride.activity.metrics.avgCadenceRpm = undefined;
  ride.activity.metrics.maxCadenceRpm = undefined;
  ride.series.points = ride.series.points.map((point) => ({ ...point, cadenceRpm: 0 }));
  const snapshot = buildRideAdvancedClaimSnapshot(rebuildSeries(ride));

  assert.equal(claimKeys(snapshot).some((key) => key.startsWith("cadence.")), false);
  assert.ok(snapshot.limitations.some((item) => item.startsWith("advanced.cadence:")));
});

test("power claims follow quality and user-baseline gates", () => {
  const fullRide = record("l3-power-preview");
  const fullProfile = createUserProfile({ weightKg: 70, ftpWatts: 240 }, NOW);
  const full = buildRideAdvancedClaimSnapshot(fullRide, fullProfile);
  const noFtpOrWeight = buildRideAdvancedClaimSnapshot(fullRide, createUserProfile({}, NOW));

  assert.ok(claimKeys(full).includes("power.normalizedW"));
  assert.ok(claimKeys(full).includes("power.intensityFactor"));
  assert.ok(claimKeys(full).includes("power.trainingStressScore"));
  assert.ok(claimKeys(full).includes("power.averageWkg"));
  assert.equal(claimKeys(noFtpOrWeight).includes("power.intensityFactor"), false);
  assert.equal(claimKeys(noFtpOrWeight).includes("power.trainingStressScore"), false);
  assert.equal(claimKeys(noFtpOrWeight).some((key) => key.includes("Wkg")), false);
  assert.equal(claimKeys(noFtpOrWeight).some((key) => key.startsWith("power.zone.")), false);
  assert.ok(noFtpOrWeight.limitations.includes("advanced.power:ftp_missing"));
  assert.ok(noFtpOrWeight.limitations.includes("advanced.power:weight_missing"));

  const unavailableRide = record("l3-power-preview");
  unavailableRide.activity.metrics.avgPowerW = undefined;
  unavailableRide.activity.metrics.maxPowerW = undefined;
  unavailableRide.activity.metrics.normalizedPowerW = undefined;
  unavailableRide.activity.sensorQuality.power = undefined;
  unavailableRide.series.points = unavailableRide.series.points.map(({ powerW: _powerW, ...point }) => point);
  const unavailable = buildRideAdvancedClaimSnapshot(rebuildSeries(unavailableRide), fullProfile);
  assert.equal(claimKeys(unavailable).some((key) => key.startsWith("power.")), false);
  assert.ok(unavailable.limitations.some((item) => item.startsWith("advanced.power:")));
});
