import assert from "node:assert/strict";
import test from "node:test";

import { buildRideFeatureSnapshot, getRideFeature, validateRideFeatureSnapshot } from "../src/domain/ride-features.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function record(fixtureId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  return { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
}

test("feature snapshot computes deterministic multi-dimensional facts with claims", () => {
  const snapshot = buildRideFeatureSnapshot(record("l3-built-in-sample"));
  assert.equal(validateRideFeatureSnapshot(snapshot).valid, true);
  assert.equal(snapshot.schemaVersion, "0.1");
  assert.equal(snapshot.rulesVersion, "ride-feature-rules-v0.1");
  assert.ok(snapshot.features.length >= 17);
  for (const feature of snapshot.features) {
    assert.match(feature.claimId, /^claim:ride-l3-built-in-sample:feature:/);
    assert.ok(feature.evidenceIds.length > 0);
    assert.ok(Number.isFinite(feature.value));
    assert.ok(feature.formulaVersion.length > 0);
  }
  assert.ok(getRideFeature(snapshot, "speedCoefficientOfVariation"));
  assert.ok(getRideFeature(snapshot, "powerFirstLastDeltaW"));
  assert.ok(getRideFeature(snapshot, "normalizedPowerRatio"));
  assert.ok(getRideFeature(snapshot, "cadenceSeriesMeanRpm"));
  assert.ok(getRideFeature(snapshot, "elevationRangeM"));
});

test("untimed GPX keeps elevation features but does not fabricate speed features", () => {
  const snapshot = buildRideFeatureSnapshot(record("gpx-no-timestamps"));
  assert.equal(validateRideFeatureSnapshot(snapshot).valid, true);
  assert.ok(getRideFeature(snapshot, "elevationPositiveGainM"));
  assert.ok(getRideFeature(snapshot, "elevationRangeM"));
  assert.equal(getRideFeature(snapshot, "speedSeriesMeanMps"), undefined);
  assert.equal(snapshot.unavailable.find((item) => item.key === "speedSeriesMeanMps")?.reason, "CAPABILITY_UNAVAILABLE");
});

test("cadence features remain independent when an untimed record carries reliable cadence", () => {
  const ride = record("gpx-no-timestamps");
  ride.activity.metrics.avgCadenceRpm = {
    value: 82,
    unit: "rpm",
    provenance: "recorded",
    confidence: "high",
    evidenceId: "EV-UNTIMED-CADENCE-FEATURE-001",
    sourceField: "gpx.extensions.cadence",
    sourceUnit: "rpm",
    qualityStatus: "valid",
  };
  ride.activity.sensorQuality.cadence = { coverage: 0.95, sampleCount: ride.series.points.length, invalidSampleCount: 0 };
  for (const point of ride.series.points) point.cadenceRpm = 82;
  ride.series.availableSeries.push("cadence");
  ride.series.seriesMetadata.cadence = { sourceField: "gpx.extensions.cadence", unit: "rpm", qualityStatus: "valid", sampleCount: ride.series.points.length };
  const snapshot = buildRideFeatureSnapshot(ride);
  assert.equal(validateRideFeatureSnapshot(snapshot).valid, true);
  assert.ok(getRideFeature(snapshot, "cadenceSeriesMeanRpm"));
  assert.equal(getRideFeature(snapshot, "speedSeriesMeanMps"), undefined);
});

test("invalid records never produce features and report a deterministic reason", () => {
  const snapshot = buildRideFeatureSnapshot(record("fit-truncated-file"));
  assert.equal(validateRideFeatureSnapshot(snapshot).valid, true);
  assert.equal(snapshot.features.length, 0);
  assert.equal(snapshot.unavailable.length, 20);
  assert.ok(snapshot.unavailable.every((item) => item.reason === "RECORD_INVALID"));
});

test("short series may expose statistics but withhold first-last segment deltas", () => {
  const ride = record("l3-built-in-sample");
  ride.series.points = ride.series.points.slice(0, 6);
  ride.series.seriesMetadata = Object.fromEntries(
    Object.entries(ride.series.seriesMetadata).map(([key, metadata]) => [key, metadata ? { ...metadata, sampleCount: Math.min(metadata.sampleCount, 6) } : metadata]),
  );
  const snapshot = buildRideFeatureSnapshot(ride);
  assert.equal(validateRideFeatureSnapshot(snapshot).valid, true);
  assert.ok(getRideFeature(snapshot, "speedSeriesMeanMps"));
  assert.equal(getRideFeature(snapshot, "speedFirstLastDeltaMps"), undefined);
  assert.equal(snapshot.unavailable.find((item) => item.key === "speedFirstLastDeltaMps")?.reason, "INSUFFICIENT_SAMPLES");
});

test("feature validation rejects a changed claim or duplicate key", () => {
  const snapshot = buildRideFeatureSnapshot(record("l1-built-in-sample"));
  snapshot.features[0]!.claimId = "claim:tampered";
  snapshot.features.push(structuredClone(snapshot.features[0]!));
  const validation = validateRideFeatureSnapshot(snapshot);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "INVALID_FEATURE_CLAIM"));
  assert.ok(validation.issues.some((issue) => issue.code === "DUPLICATE_FEATURE_KEY"));
});
