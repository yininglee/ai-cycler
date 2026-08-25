import assert from "node:assert/strict";
import test from "node:test";

import {
  B0_TEMPLATE_VERSION,
  generateB0RideAnalysis,
  validateB0RideAnalysis,
} from "../src/domain/ride-summary.ts";
import { getRideAnalysisEvalFixture } from "../src/fixtures/ride-analysis-eval.ts";
import { getRideFixture, rideFixtures } from "../src/fixtures/rides.ts";

test("B0 returns a valid output contract for every accepted fixture state", () => {
  for (const fixture of rideFixtures) {
    const result = generateB0RideAnalysis(fixture.activity);
    const validation = validateB0RideAnalysis(result);
    assert.equal(result.templateVersion, B0_TEMPLATE_VERSION);
    assert.equal(validation.valid, true, `${fixture.fixtureId}: ${validation.issues.join(", ")}`);
  }
});

test("B0 validation treats summary richness as a quality score instead of a minimum length gate", () => {
  const result = generateB0RideAnalysis(getRideFixture("l1-built-in-sample").activity);
  result.output.summary = "骑行记录已完成。";

  assert.equal(validateB0RideAnalysis(result).valid, true);

  result.output.summary = "";
  assert.ok(validateB0RideAnalysis(result).issues.includes("INVALID_SUMMARY_LENGTH"));

  result.output.summary = "摘要".repeat(61);
  assert.ok(validateB0RideAnalysis(result).issues.includes("INVALID_SUMMARY_LENGTH"));
});

test("L1, L2, and L3 expose only claims allowed by their data capability", () => {
  const l1 = generateB0RideAnalysis(getRideFixture("l1-built-in-sample").activity);
  const l2 = generateB0RideAnalysis(getRideFixture("l2-built-in-sample").activity);
  const l3 = generateB0RideAnalysis(getRideFixture("l3-built-in-sample").activity);

  assert.equal(l1.snapshot.dataLevel, "L1");
  assert.ok(!l1.snapshot.allowedClaims.some((claim) => claim.metricKey.includes("HeartRate") || claim.metricKey.includes("Power")));
  assert.ok(l2.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgHeartRateBpm"));
  assert.ok(!l2.snapshot.allowedClaims.some((claim) => claim.metricKey.includes("Power")));
  assert.ok(l3.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgPowerW"));
});

test("unreliable heart-rate and power metrics never enter allowed claims", () => {
  const heartRateDropout = generateB0RideAnalysis(getRideFixture("fit-heart-rate-dropout").activity);
  const powerDropout = generateB0RideAnalysis(getRideFixture("fit-power-dropout-with-heart-rate").activity);

  assert.equal(heartRateDropout.snapshot.dataLevel, "L1");
  assert.ok(!heartRateDropout.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgHeartRateBpm"));
  assert.equal(powerDropout.snapshot.dataLevel, "L2");
  assert.ok(!powerDropout.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgPowerW"));
});

test("sensor-only indoor B0 keeps reliable heart-rate and power facts", () => {
  const heartRate = generateB0RideAnalysis(getRideAnalysisEvalFixture("RA-AUTO-010").record.activity);
  const power = generateB0RideAnalysis(getRideAnalysisEvalFixture("RA-AUTO-015").record.activity);

  assert.equal(heartRate.snapshot.analysisMode, "basic");
  assert.ok(heartRate.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgHeartRateBpm"));
  assert.ok(heartRate.output.highlights.some((highlight) => highlight.claimIds.some((id) => id.endsWith(":avgHeartRateBpm"))));
  assert.equal(heartRate.output.summary.includes("数据缺失、损坏或字段矛盾"), false);

  assert.equal(power.snapshot.analysisMode, "basic");
  assert.ok(power.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgPowerW"));
  assert.ok(power.output.highlights.some((highlight) => highlight.claimIds.some((id) => id.endsWith(":avgPowerW"))));
  assert.equal(power.output.summary.includes("数据缺失、损坏或字段矛盾"), false);
});

test("GPX without timestamps stays basic and never invents time or speed claims", () => {
  const result = generateB0RideAnalysis(getRideFixture("gpx-no-timestamps").activity);
  const metricKeys = result.snapshot.allowedClaims.map((claim) => claim.metricKey);

  assert.equal(result.snapshot.analysisMode, "basic");
  assert.ok(!metricKeys.includes("movingTimeS"));
  assert.ok(!metricKeys.includes("elapsedTimeS"));
  assert.ok(!metricKeys.includes("avgSpeedMps"));
  assert.ok(result.output.limitations.some((item) => item.includes("时间戳")));
});

test("rejected records use the fixed fallback without exposing conflicting metrics", () => {
  for (const fixtureId of ["fit-truncated-file", "inconsistent-fit-summary"]) {
    const result = generateB0RideAnalysis(getRideFixture(fixtureId).activity);
    assert.equal(result.snapshot.analysisMode, "rejected");
    assert.deepEqual(result.snapshot.allowedClaims, []);
    assert.deepEqual(result.output.highlights, []);
    assert.deepEqual(result.output.nextAction.basisClaimIds, []);
    assert.ok(result.output.shareCopy.every((copy) => copy.includes("无法") || copy.includes("重新") || copy.includes("不可用")));
  }
});

test("limitations are deduplicated after issue and capability normalization", () => {
  const noTimestamps = generateB0RideAnalysis(getRideFixture("gpx-no-timestamps").activity);
  assert.equal(new Set(noTimestamps.output.limitations).size, noTimestamps.output.limitations.length);
  assert.equal(noTimestamps.output.limitations.filter((item) => item.includes("时间戳")).length, 1);

  const gpsSpike = generateB0RideAnalysis(getRideFixture("l1-gps-spike").activity);
  assert.equal(new Set(gpsSpike.output.limitations).size, gpsSpike.output.limitations.length);
  assert.deepEqual(
    gpsSpike.output.limitations.filter((item) => item.includes("GPS孤立跳点")),
    ["检测到GPS孤立跳点，已在计算距离和速度前过滤"],
  );
});

test("every displayed highlight is an exact, evidence-backed allowed claim", () => {
  for (const fixture of rideFixtures) {
    const result = generateB0RideAnalysis(fixture.activity);
    const claims = new Map(result.snapshot.allowedClaims.map((claim) => [claim.claimId, claim]));
    for (const highlight of result.output.highlights) {
      assert.equal(highlight.claimIds.length, 1);
      const claim = claims.get(highlight.claimIds[0]!);
      assert.ok(claim);
      assert.equal(highlight.text, claim.text);
      assert.ok(claim.evidenceId);
    }
  }
});

test("calculated values preserve formula versions and user-facing unit conversion", () => {
  const result = generateB0RideAnalysis(getRideFixture("l1-built-in-sample").activity);
  const distance = result.snapshot.allowedClaims.find((claim) => claim.metricKey === "distanceM");
  const speed = result.snapshot.allowedClaims.find((claim) => claim.metricKey === "avgSpeedMps");

  assert.equal(distance?.displayValue, "25 km");
  assert.equal(speed?.displayValue, "25 km/h");
  assert.equal(speed?.formulaVersion, "avg-speed-v0.1");
});

test("the model-facing snapshot excludes source filename, start time, and raw coordinates", () => {
  const result = generateB0RideAnalysis(getRideFixture("l2-fit-heart-rate").activity, "demo-user");
  const serialized = JSON.stringify(result.snapshot);

  assert.equal(result.snapshot.userScope, "demo-user");
  assert.ok(!serialized.includes("garmin-heart-rate.fit"));
  assert.ok(!serialized.includes("2026-08-11"));
  assert.ok(!serialized.includes("position_lat"));
  assert.ok(result.snapshot.privacyFlags.includes("precise_coordinates_excluded"));
});
