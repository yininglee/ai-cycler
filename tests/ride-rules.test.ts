import assert from "node:assert/strict";
import test from "node:test";

import { isRideSensorUsable, rideRuleThresholds, validateRideActivity } from "../src/domain/ride-rules.ts";
import type { RideActivity } from "../src/domain/ride-schema.ts";
import { getRideFixture, rideFixtures } from "../src/fixtures/rides.ts";

test("all fixtures match their expected activity validation and issue codes", () => {
  for (const fixture of rideFixtures) {
    const validation = validateRideActivity(fixture.activity);
    const issueCodes = new Set(validation.issues.map((item) => item.code));

    assert.equal(validation.valid, fixture.expected.valid, fixture.fixtureId);
    for (const code of fixture.expected.requiredIssueCodes) {
      assert.ok(issueCodes.has(code), `${fixture.fixtureId} should contain ${code}`);
    }
  }
});

test("reliable fields remain independent; an absent sensor does not invalidate other ride facts", () => {
  const ride = getRideFixture("l1-gpx-normal").activity;
  const validation = validateRideActivity(ride);

  assert.equal(validation.valid, true);
  assert.ok(ride.metrics.distanceM);
  assert.equal(ride.metrics.avgHeartRateBpm, undefined);
  assert.equal(ride.metrics.avgPowerW, undefined);
});

test("sensor usability is decided by that sensor's coverage and invalid-sample ratio", () => {
  const ride = getRideFixture("fit-power-dropout-with-heart-rate").activity;
  assert.equal(isRideSensorUsable(ride, "heart_rate"), true);
  assert.equal(isRideSensorUsable(ride, "power"), false);
  assert.equal(rideRuleThresholds.minimumSensorCoverage, 0.8);
  assert.equal(rideRuleThresholds.maximumInvalidSampleRatio, 0.02);
});

test("FIT average speed may use elapsed time when moving time has a different timer basis", () => {
  const activity: RideActivity = structuredClone(getRideFixture("short-fit-ride").activity);
  activity.metrics.distanceM = { ...activity.metrics.distanceM!, value: 31_056.1, evidenceId: "EV-TIMER-BASIS-001" };
  activity.metrics.movingTimeS = { ...activity.metrics.movingTimeS!, value: 3_719, evidenceId: "EV-TIMER-BASIS-002" };
  activity.metrics.elapsedTimeS = {
    ...activity.metrics.movingTimeS,
    value: 3_959,
    evidenceId: "EV-TIMER-BASIS-003",
    sourceField: "session.total_elapsed_time",
  };
  activity.metrics.avgSpeedMps = { ...activity.metrics.avgSpeedMps!, value: 7.9, evidenceId: "EV-TIMER-BASIS-004" };

  const validation = validateRideActivity(activity);
  assert.equal(validation.valid, true);
  assert.ok(!validation.issues.some((item) => item.code === "INCONSISTENT_AVG_SPEED"));
});

test("GPX without timestamps stays valid with an explicit timing limitation", () => {
  const activity = getRideFixture("gpx-no-timestamps").activity;
  const validation = validateRideActivity(activity);

  assert.equal(validation.valid, true);
  assert.equal(activity.metrics.movingTimeS, undefined);
  assert.equal(activity.metrics.avgSpeedMps, undefined);
  assert.ok(validation.issues.some((item) => item.code === "MISSING_TIMESTAMPS"));
});

test("GPX without timestamps rejects fabricated speed or duration", () => {
  const source = getRideFixture("gpx-no-timestamps").activity;
  const broken: RideActivity = structuredClone(source);
  broken.metrics.movingTimeS = {
    value: 4_000,
    unit: "s",
    provenance: "estimated",
    confidence: "low",
    evidenceId: "EV-FABRICATED-001",
    sourceField: "fabricated.duration",
    sourceUnit: "s",
    qualityStatus: "degraded",
    recordedAt: source.startTime,
  };
  broken.metrics.avgSpeedMps = {
    value: 7.125,
    unit: "m/s",
    provenance: "calculated",
    confidence: "low",
    evidenceId: "EV-FABRICATED-002",
    sourceField: "fabricated.speed",
    sourceUnit: "m/s",
    qualityStatus: "degraded",
    recordedAt: source.startTime,
    formulaVersion: "avg-speed-v0.1",
  };

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "UNTRUSTED_GPX_TIMING"));
});

test("a filtered GPS spike stays traceable without creating speed", () => {
  const fixture = getRideFixture("l1-gps-spike");
  const validation = validateRideActivity(fixture.activity);

  assert.equal(validation.valid, true);
  assert.ok(validation.issues.some((item) => item.code === "GPX_GPS_SPIKE_FILTERED"));
  assert.equal(fixture.activity.metrics.avgSpeedMps, undefined);
});

test("FIT developer fields are ignored without losing standard fields", () => {
  const fixture = getRideFixture("fit-unknown-developer-field");
  const validation = validateRideActivity(fixture.activity);

  assert.equal(validation.valid, true);
  assert.ok(fixture.activity.metrics.distanceM);
  assert.ok(validation.issues.some((item) => item.code === "FIT_DEVELOPER_FIELD_IGNORED"));
});

test("truncated FIT records fail validation", () => {
  const validation = validateRideActivity(getRideFixture("fit-truncated-file").activity);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "FIT_TRUNCATED_FILE"));
});

test("FIT and GPX fixtures normalize to the same schema version and activity keys", () => {
  const fit = getRideFixture("l2-fit-heart-rate").activity;
  const gpx = getRideFixture("l1-gpx-normal").activity;
  assert.equal(fit.schemaVersion, "0.2");
  assert.equal(gpx.schemaVersion, "0.2");
  assert.deepEqual(Object.keys(fit).sort(), Object.keys(gpx).sort());
});

test("short valid rides remain valid and keep their traceable facts", () => {
  const activity = getRideFixture("short-fit-ride").activity;
  const validation = validateRideActivity(activity);
  assert.equal(validation.valid, true);
  assert.ok(activity.metrics.distanceM);
  assert.ok(activity.metrics.movingTimeS);
});

test("calculated metrics require a formula version", () => {
  const broken: RideActivity = structuredClone(getRideFixture("l1-gpx-normal").activity);
  delete broken.metrics.avgSpeedMps?.formulaVersion;

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "MISSING_FORMULA_VERSION"));
});

test("duplicate evidence IDs are rejected", () => {
  const broken: RideActivity = structuredClone(getRideFixture("l2-fit-heart-rate").activity);
  broken.metrics.maxHeartRateBpm!.evidenceId = broken.metrics.avgHeartRateBpm!.evidenceId;

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "DUPLICATE_EVIDENCE_ID"));
});

test("FIT and GPX extensions must match their declared source", () => {
  const broken: RideActivity = structuredClone(getRideFixture("l3-fit-power").activity);
  broken.source.fileName = "power-meter.gpx";

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "SOURCE_EXTENSION_MISMATCH"));
});

test("sensor coverage outside zero-to-one is rejected", () => {
  const broken: RideActivity = structuredClone(getRideFixture("l2-fit-heart-rate").activity);
  broken.sensorQuality.heart_rate!.coverage = 1.2;

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "INVALID_SENSOR_COVERAGE"));
});

test("a small invalid-sample ratio does not make a sensor unusable", () => {
  const adjusted: RideActivity = structuredClone(getRideFixture("l2-fit-heart-rate").activity);
  adjusted.sensorQuality.heart_rate = { coverage: 0.95, sampleCount: 1_000, invalidSampleCount: 10 };

  assert.equal(isRideSensorUsable(adjusted, "heart_rate"), true);
});
