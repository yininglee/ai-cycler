import assert from "node:assert/strict";
import test from "node:test";

import {
  ATOMIC_CAPABILITY_RULES_VERSION,
  ATOMIC_CAPABILITY_SCHEMA_VERSION,
  atomicCapabilityKeys,
  buildAtomicCapabilityProfile,
  getAtomicCapability,
} from "../src/domain/atomic-capabilities.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function record(fixtureId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  return { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
}

test("atomic profile freezes keys and never exposes an L1/L2/L3 business level", () => {
  const profile = buildAtomicCapabilityProfile(record("l3-built-in-sample"));
  assert.equal(profile.schemaVersion, ATOMIC_CAPABILITY_SCHEMA_VERSION);
  assert.equal(profile.rulesVersion, ATOMIC_CAPABILITY_RULES_VERSION);
  assert.deepEqual(profile.capabilities.map((item) => item.key), atomicCapabilityKeys);
  assert.equal("dataLevel" in profile, false);
});

test("untimed GPX keeps route, distance, elevation, and independent profile facts but not timing or speed", () => {
  const user = createUserProfile({ age: 35, ftpWatts: 240 }, "2026-08-20T08:00:00.000Z");
  const profile = buildAtomicCapabilityProfile(record("gpx-no-timestamps"), user);
  assert.equal(getAtomicCapability(profile, "route").available, true);
  assert.equal(getAtomicCapability(profile, "distance").available, true);
  assert.equal(getAtomicCapability(profile, "elevation").available, true);
  assert.equal(getAtomicCapability(profile, "timing").available, false);
  assert.equal(getAtomicCapability(profile, "speed").available, false);
  assert.equal(getAtomicCapability(profile, "speed").unavailableReason, "DEPENDENCY_UNAVAILABLE");
  assert.equal(getAtomicCapability(profile, "userProfile").available, true);
  assert.equal(getAtomicCapability(profile, "maxHeartRateBaseline").available, true);
  assert.equal(getAtomicCapability(profile, "verifiedFtp").available, true);
});

test("cadence is available whenever reliable cadence data exists, even without timestamps", () => {
  const untimedWithCadence = record("gpx-no-timestamps");
  untimedWithCadence.activity.metrics.avgCadenceRpm = {
    value: 82,
    unit: "rpm",
    provenance: "recorded",
    confidence: "high",
    evidenceId: "EV-UNTIMED-CADENCE-001",
    sourceField: "gpx.extensions.cadence",
    sourceUnit: "rpm",
    qualityStatus: "valid",
  };
  untimedWithCadence.activity.sensorQuality.cadence = {
    coverage: 0.95,
    sampleCount: untimedWithCadence.series.points.length,
    invalidSampleCount: 0,
  };
  for (const point of untimedWithCadence.series.points) point.cadenceRpm = 82;
  untimedWithCadence.series.availableSeries.push("cadence");
  untimedWithCadence.series.seriesMetadata.cadence = {
    sourceField: "gpx.extensions.cadence",
    unit: "rpm",
    qualityStatus: "valid",
    sampleCount: untimedWithCadence.series.points.length,
  };

  const profile = buildAtomicCapabilityProfile(untimedWithCadence);
  assert.equal(getAtomicCapability(profile, "cadence").available, true);
  assert.equal(getAtomicCapability(profile, "timing").available, false);
  assert.equal(getAtomicCapability(profile, "speed").available, false);
});

test("heart rate and an estimated maximum do not unlock zones before a versioned zone rule exists", () => {
  const user = createUserProfile({ age: 35 }, "2026-08-20T08:00:00.000Z");
  const profile = buildAtomicCapabilityProfile(record("l2-fit-heart-rate"), user);
  assert.equal(getAtomicCapability(profile, "heartRate").available, true);
  assert.equal(getAtomicCapability(profile, "maxHeartRateBaseline").available, true);
  assert.equal(getAtomicCapability(profile, "maxHeartRateBaseline").qualityStatus, "estimated");
  assert.equal(getAtomicCapability(profile, "maxHeartRateBaseline").provenance?.formulaVersion, "max-heart-rate-220-age-v1");
  assert.equal(getAtomicCapability(profile, "heartRateZones").available, false);
  assert.equal(getAtomicCapability(profile, "heartRateZones").unavailableReason, "RULE_NOT_IMPLEMENTED");
});

test("reliable power is independent from heart rate", () => {
  const powerOnly = record("l3-fit-power");
  delete powerOnly.activity.metrics.avgHeartRateBpm;
  delete powerOnly.activity.metrics.maxHeartRateBpm;
  delete powerOnly.activity.sensorQuality.heart_rate;
  for (const point of powerOnly.series.points) delete point.heartRateBpm;
  powerOnly.series.availableSeries = powerOnly.series.availableSeries.filter((key) => key !== "heart_rate");
  delete powerOnly.series.seriesMetadata.heart_rate;

  const profile = buildAtomicCapabilityProfile(powerOnly);
  assert.equal(getAtomicCapability(profile, "power").available, true);
  assert.equal(getAtomicCapability(profile, "normalizedPower").available, true);
  assert.equal(getAtomicCapability(profile, "heartRate").available, false);
});

test("confirmed FTP is available independently but cannot unlock power zones without their rule", () => {
  const user = createUserProfile({ ftpWatts: 240 }, "2026-08-20T08:00:00.000Z");
  const profile = buildAtomicCapabilityProfile(record("l3-fit-power"), user);
  assert.equal(getAtomicCapability(profile, "verifiedFtp").available, true);
  assert.equal(getAtomicCapability(profile, "verifiedFtp").provenance?.source, "user_provided");
  assert.equal(getAtomicCapability(profile, "power").available, true);
  assert.equal(getAtomicCapability(profile, "powerZones").available, false);
  assert.equal(getAtomicCapability(profile, "powerZones").unavailableReason, "RULE_NOT_IMPLEMENTED");
  assert.equal(getAtomicCapability(profile, "trainingLoad").available, false);
  assert.equal(getAtomicCapability(profile, "trainingLoad").unavailableReason, "RULE_NOT_IMPLEMENTED");
});

test("power quality dropout does not remove independent heart-rate capability", () => {
  const profile = buildAtomicCapabilityProfile(record("fit-power-dropout-with-heart-rate"));
  assert.equal(getAtomicCapability(profile, "heartRate").available, true);
  assert.equal(getAtomicCapability(profile, "power").available, false);
  assert.equal(getAtomicCapability(profile, "power").unavailableReason, "QUALITY_INSUFFICIENT");
});

test("an empty profile grants neither user-profile baselines nor FTP", () => {
  const emptyUser = createUserProfile({}, "2026-08-20T08:00:00.000Z");
  const profile = buildAtomicCapabilityProfile(record("l2-fit-heart-rate"), emptyUser);
  assert.equal(getAtomicCapability(profile, "userProfile").available, false);
  assert.equal(getAtomicCapability(profile, "userProfile").unavailableReason, "PROFILE_EMPTY");
  assert.equal(getAtomicCapability(profile, "maxHeartRateBaseline").available, false);
  assert.equal(getAtomicCapability(profile, "verifiedFtp").available, false);
});

test("user profile is available for a basic ride whenever profile facts exist", () => {
  const user = createUserProfile({ age: 35, heightCm: 175, weightKg: 70 }, "2026-08-20T08:00:00.000Z");
  const profile = buildAtomicCapabilityProfile(record("l1-built-in-sample"), user);
  assert.equal(getAtomicCapability(profile, "userProfile").available, true);
  assert.equal(getAtomicCapability(profile, "maxHeartRateBaseline").available, true);
  assert.equal(getAtomicCapability(profile, "heartRate").available, false);
  assert.equal(getAtomicCapability(profile, "heartRateZones").available, false);
});

test("history-derived capabilities stay unavailable until the history work item exists", () => {
  const profile = buildAtomicCapabilityProfile(record("l3-built-in-sample"));
  for (const key of ["historyComparison", "sameRouteComparison", "trend"] as const) {
    assert.equal(getAtomicCapability(profile, key).available, false);
    assert.equal(getAtomicCapability(profile, key).unavailableReason, "HISTORY_NOT_AVAILABLE");
  }
});

test("a rejected record cannot grant ride analysis capabilities", () => {
  const profile = buildAtomicCapabilityProfile(record("fit-truncated-file"), createUserProfile({ age: 35, ftpWatts: 240 }, "2026-08-20T08:00:00.000Z"));
  for (const capability of profile.capabilities) {
    assert.equal(capability.available, false);
    assert.equal(capability.unavailableReason, "RECORD_INVALID");
  }
});
