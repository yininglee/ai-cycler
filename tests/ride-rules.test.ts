import assert from "node:assert/strict";
import test from "node:test";

import { buildRideCapability, rideRuleThresholds, validateRideActivity } from "../src/domain/ride-rules.ts";
import type { RideActivity } from "../src/domain/ride-schema.ts";
import { getRideFixture, rideFixtures } from "../src/fixtures/rides.ts";
import { getRideAnalysisEvalFixture } from "../src/fixtures/ride-analysis-eval.ts";

test("all fixtures match their expected validation and capability", () => {
  for (const fixture of rideFixtures) {
    const validation = validateRideActivity(fixture.activity);
    const capability = buildRideCapability(fixture.activity);
    const issueCodes = new Set(validation.issues.map((item) => item.code));

    assert.equal(validation.valid, fixture.expected.valid, fixture.fixtureId);
    assert.equal(capability.dataLevel, fixture.expected.dataLevel, fixture.fixtureId);
    assert.equal(capability.analysisMode, fixture.expected.analysisMode, fixture.fixtureId);
    for (const code of fixture.expected.requiredIssueCodes) {
      assert.ok(issueCodes.has(code), `${fixture.fixtureId} should contain ${code}`);
    }
  }
});

test("built-in samples cover L1, L2, and L3", () => {
  const sampleLevels = rideFixtures
    .filter((fixture) => fixture.activity.source.kind === "sample")
    .map((fixture) => buildRideCapability(fixture.activity).dataLevel)
    .sort();
  assert.deepEqual(sampleLevels, ["L1", "L2", "L3"]);
});

test("L1 never exposes heart-rate or power topics", () => {
  const capability = buildRideCapability(getRideFixture("l1-gpx-normal").activity);
  assert.equal(capability.dataLevel, "L1");
  assert.ok(capability.forbiddenTopics.includes("心率区间"));
  assert.ok(capability.forbiddenTopics.includes("功率"));
  assert.ok(capability.forbiddenTopics.includes("FTP"));
});

test("legacy L2 grouping no longer grants heart-rate zones without profile and rule gates", () => {
  const capability = buildRideCapability(getRideFixture("l2-fit-heart-rate").activity);
  assert.equal(capability.dataLevel, "L2");
  assert.ok(!capability.allowedTopics.includes("心率区间"));
  assert.ok(capability.forbiddenTopics.includes("心率区间"));
  assert.ok(capability.forbiddenTopics.includes("功率"));
});

test("reliable FIT power data produces L3", () => {
  const capability = buildRideCapability(getRideFixture("l3-fit-power").activity);
  assert.equal(capability.dataLevel, "L3");
  assert.ok(capability.allowedTopics.includes("功率"));
});

test("power dropout downgrades to reliable heart-rate capability", () => {
  const capability = buildRideCapability(getRideFixture("fit-power-dropout-with-heart-rate").activity);
  assert.equal(capability.dataLevel, "L2");
  assert.ok(capability.limitations.some((item) => item.includes("功率覆盖不足")));
});

test("sensor-only indoor records keep their available capability without route distance", () => {
  const heartRate = buildRideCapability(getRideAnalysisEvalFixture("RA-AUTO-010").record.activity);
  const power = buildRideCapability(getRideAnalysisEvalFixture("RA-AUTO-015").record.activity);

  assert.equal(heartRate.analysisMode, "basic");
  assert.equal(heartRate.dataLevel, "L2");
  assert.equal(power.analysisMode, "basic");
  assert.equal(power.dataLevel, "L3");
});

test("GPX without timestamps never fabricates duration or speed", () => {
  const fixture = getRideFixture("gpx-no-timestamps");
  const capability = buildRideCapability(fixture.activity);
  assert.equal(fixture.activity.metrics.movingTimeS, undefined);
  assert.equal(fixture.activity.metrics.avgSpeedMps, undefined);
  assert.equal(capability.analysisMode, "basic");
  assert.ok(!capability.allowedTopics.includes("速度"));
  assert.ok(!capability.allowedTopics.includes("时长"));
  assert.ok(capability.limitations.some((item) => item.includes("不能计算速度或时长")));
});

test("GPX without timestamps rejects upstream fabricated speed", () => {
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
  const capability = buildRideCapability(broken);
  assert.equal(validation.valid, false);
  assert.equal(capability.analysisMode, "rejected");
  assert.ok(validation.issues.some((item) => item.code === "UNTRUSTED_GPX_TIMING"));
});

test("a filtered GPS spike stays traceable and never exposes speed", () => {
  const fixture = getRideFixture("l1-gps-spike");
  const validation = validateRideActivity(fixture.activity);
  const capability = buildRideCapability(fixture.activity);

  assert.equal(validation.valid, true);
  assert.equal(capability.analysisMode, "basic");
  assert.ok(validation.issues.some((item) => item.code === "GPX_GPS_SPIKE_FILTERED"));
  assert.equal(fixture.activity.metrics.avgSpeedMps, undefined);
  assert.ok(!capability.allowedTopics.includes("速度"));
});

test("FIT developer fields are ignored without losing standard fields", () => {
  const fixture = getRideFixture("fit-unknown-developer-field");
  const validation = validateRideActivity(fixture.activity);
  const capability = buildRideCapability(fixture.activity);
  assert.equal(validation.valid, true);
  assert.equal(capability.dataLevel, "L2");
  assert.ok(validation.issues.some((item) => item.code === "FIT_DEVELOPER_FIELD_IGNORED"));
});

test("truncated FIT files enter the rejected state", () => {
  const fixture = getRideFixture("fit-truncated-file");
  const validation = validateRideActivity(fixture.activity);
  const capability = buildRideCapability(fixture.activity);
  assert.equal(validation.valid, false);
  assert.equal(capability.analysisMode, "rejected");
  assert.ok(validation.issues.some((item) => item.code === "FIT_TRUNCATED_FILE"));
});

test("FIT and GPX fixtures normalize to the same schema version", () => {
  const fit = getRideFixture("l2-fit-heart-rate").activity;
  const gpx = getRideFixture("l1-gpx-normal").activity;
  assert.equal(fit.schemaVersion, "0.2");
  assert.equal(gpx.schemaVersion, "0.2");
  assert.deepEqual(Object.keys(fit).sort(), Object.keys(gpx).sort());
});

test("short rides stay in basic analysis at both boundaries", () => {
  const capability = buildRideCapability(getRideFixture("short-fit-ride").activity);
  assert.equal(rideRuleThresholds.minimumFullDistanceM, 3_000);
  assert.equal(rideRuleThresholds.minimumFullDurationS, 600);
  assert.equal(capability.analysisMode, "basic");
  assert.ok(capability.limitations.some((item) => item.includes("不足 3 km")));
  assert.ok(capability.limitations.some((item) => item.includes("不足 10 分钟")));
});

test("calculated metrics require a formula version", () => {
  const source = getRideFixture("l1-gpx-normal").activity;
  const broken: RideActivity = structuredClone(source);
  delete broken.metrics.avgSpeedMps?.formulaVersion;

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "MISSING_FORMULA_VERSION"));
});

test("duplicate evidence IDs are rejected", () => {
  const source = getRideFixture("l2-fit-heart-rate").activity;
  const broken: RideActivity = structuredClone(source);
  broken.metrics.maxHeartRateBpm!.evidenceId = broken.metrics.avgHeartRateBpm!.evidenceId;

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "DUPLICATE_EVIDENCE_ID"));
});

test("FIT and GPX extensions must match their declared source", () => {
  const source = getRideFixture("l3-fit-power").activity;
  const broken: RideActivity = structuredClone(source);
  broken.source.fileName = "power-meter.gpx";

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "SOURCE_EXTENSION_MISMATCH"));
});

test("sensor coverage outside zero-to-one is rejected", () => {
  const source = getRideFixture("l2-fit-heart-rate").activity;
  const broken: RideActivity = structuredClone(source);
  broken.sensorQuality.heart_rate!.coverage = 1.2;

  const validation = validateRideActivity(broken);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((item) => item.code === "INVALID_SENSOR_COVERAGE"));
});

test("a small invalid-sample ratio does not discard an otherwise reliable sensor", () => {
  const source = getRideFixture("l2-fit-heart-rate").activity;
  const adjusted: RideActivity = structuredClone(source);
  adjusted.sensorQuality.heart_rate = { coverage: 0.95, sampleCount: 1_000, invalidSampleCount: 10 };

  const capability = buildRideCapability(adjusted);
  assert.equal(rideRuleThresholds.maximumInvalidSampleRatio, 0.02);
  assert.equal(capability.dataLevel, "L2");
});
