import assert from "node:assert/strict";
import test from "node:test";

import type { Metric, RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import { buildRidePowerSummary } from "../src/domain/ride-power.ts";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const START_TIME = "2026-08-30T06:00:00.000Z";

function metric(value: number, unit: Metric["unit"], sourceField: string): Metric {
  return { value, unit, provenance: "recorded", confidence: "high", evidenceId: `evidence:${sourceField}`, sourceField, sourceUnit: unit, qualityStatus: "valid", recordedAt: START_TIME };
}

function record(points: RideSeriesPoint[], movingTimeS = points.at(-1)?.elapsedTimeS ?? 0): RideRecord {
  const series = buildRideSeries({ rideId: "ride-power-test", sourceKind: "fit", parserVersion: "ride-power-test-v0.1", startTime: START_TIME, points });
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "ride-power-test",
      sport: "cycling",
      source: { kind: "fit", fileName: "power.fit", parserVersion: "ride-power-test-v0.1" },
      startTime: START_TIME,
      metrics: {
        distanceM: metric(10_000, "m", "session.total_distance"),
        elapsedTimeS: metric(movingTimeS, "s", "session.total_elapsed_time"),
        movingTimeS: metric(movingTimeS, "s", "session.total_moving_time"),
      },
      sensorQuality: { power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 } },
      sourceIssues: [],
    },
    series,
  };
}

function constantPoints(endS: number, powerW = 100, omitted = new Set<number>()): RideSeriesPoint[] {
  return Array.from({ length: endS + 1 }, (_, elapsedTimeS) => ({ sequence: elapsedTimeS, elapsedTimeS, speedMps: 5, powerW: omitted.has(elapsedTimeS) ? undefined : powerW }));
}

const profile = createUserProfile({ weightKg: 50, ftpWatts: 200 }, START_TIME);

test("hard claim calculates NP, IF, TSS and W/kg from the agreed formulas", () => {
  const result = buildRidePowerSummary(record(constantPoints(100, 100)), profile);

  assert.equal(result.qualityLevel, "hard");
  assert.equal(result.coverage, 1);
  assert.equal(result.normalizedPowerW && Math.round(result.normalizedPowerW), 100);
  assert.equal(result.intensityFactor && Number(result.intensityFactor.toFixed(2)), .5);
  assert.equal(result.trainingStressScore && Number(result.trainingStressScore.toFixed(2)), .69);
  assert.equal(result.averagePowerToWeight && Number(result.averagePowerToWeight.toFixed(2)), 2);
  assert.equal(result.normalizedPowerToWeight && Number(result.normalizedPowerToWeight.toFixed(2)), 2);
});

test("calculates this-ride peak average power for continuous 10/20/30 second windows", () => {
  const points = constantPoints(60, 100).map((point) => {
    const elapsed = point.elapsedTimeS ?? 0;
    return { ...point, powerW: elapsed < 10 ? 300 : elapsed < 30 ? 200 : 100 };
  });
  const result = buildRidePowerSummary(record(points), profile);

  assert.deepEqual(result.peakPowers?.map((peak) => Math.round(peak.averagePowerW)), [300, 250, 233]);
  assert.deepEqual(result.peakPowers?.map((peak) => [peak.startElapsedTimeS, peak.endElapsedTimeS]), [[0, 10], [0, 20], [0, 30]]);
  assert.equal(result.peakPowers?.[0]?.powerToWeight, 6);

  const withoutWeight = buildRidePowerSummary(record(points), createUserProfile({}, START_TIME));
  assert.ok(withoutWeight.peakPowers);
  assert.ok(withoutWeight.peakPowers!.every((peak) => peak.powerToWeight === undefined));
});

test("peak windows cannot cross a stopped or unexplained interval and hide when a duration is unavailable", () => {
  const points = constantPoints(60, 100).filter((point) => point.elapsedTimeS! < 20 || point.elapsedTimeS! > 40).map((point) => point.elapsedTimeS === 19 ? { ...point, powerW: undefined } : point);
  const result = buildRidePowerSummary(record(points, 60), profile);
  assert.equal(result.peakPowers, undefined);
});

test("peak values keep the required descending duration order", () => {
  const result = buildRidePowerSummary(record(constantPoints(60, 100)), profile);
  assert.ok(result.peakPowers);
  assert.ok(result.peakPowers![0]!.averagePowerW >= result.peakPowers![1]!.averagePowerW);
  assert.ok(result.peakPowers![1]!.averagePowerW >= result.peakPowers![2]!.averagePowerW);
});

test("0 W coasting remains valid power rather than a missing sample", () => {
  const result = buildRidePowerSummary(record(constantPoints(100, 100).map((point, index) => index < 10 ? { ...point, powerW: 0 } : point)), profile);

  assert.equal(result.qualityLevel, "hard");
  assert.equal(result.coverage, 1);
  assert.equal(result.averagePowerW && Math.round(result.averagePowerW), 90);
});

test("coverage boundaries distinguish hard, soft and unavailable power claims", () => {
  assert.equal(buildRidePowerSummary(record(constantPoints(90), 100), profile).qualityLevel, "hard");
  assert.equal(buildRidePowerSummary(record(constantPoints(80), 100), profile).qualityLevel, "soft");
  assert.equal(buildRidePowerSummary(record(constantPoints(79), 100), profile).qualityLevel, "unavailable");
  assert.deepEqual(buildRidePowerSummary(record(constantPoints(79), 100), profile).unavailableReasons, ["insufficient_coverage"]);
});

test("20 / 21 / 60 / 61 second power gaps follow the confirmed graded rule", () => {
  const withGap = (durationS: number) => {
    const points = constantPoints(4_000).filter((point) => point.elapsedTimeS! < 10 || point.elapsedTimeS! > durationS + 8);
    return buildRidePowerSummary(record(points, 4_000), profile);
  };
  const hard = withGap(20);
  const soft21 = withGap(21);
  const soft60 = withGap(60);
  const unavailable61 = withGap(61);

  assert.equal(hard.longestGapS, 20);
  assert.equal(hard.qualityLevel, "hard");
  assert.equal(soft21.longestGapS, 21);
  assert.equal(soft21.qualityLevel, "soft");
  assert.equal(soft60.longestGapS, 60);
  assert.equal(soft60.qualityLevel, "soft");
  assert.equal(unavailable61.longestGapS, 61);
  assert.equal(unavailable61.qualityLevel, "unavailable");
  assert.ok(unavailable61.unavailableReasons.includes("long_gap"));
});

test("a stationary FIT pause gap is excluded from power gap quality", () => {
  const points: RideSeriesPoint[] = [];
  for (let elapsedTimeS = 0; elapsedTimeS <= 200; elapsedTimeS += 1) {
    if (elapsedTimeS > 10 && elapsedTimeS < 71) continue;
    const paused = elapsedTimeS === 71;
    const distanceM = elapsedTimeS <= 10 ? elapsedTimeS * 5 : 50 + Math.max(0, elapsedTimeS - 71) * 5;
    points.push({
      sequence: points.length,
      elapsedTimeS,
      distanceM,
      speedMps: paused ? 0 : 5,
      powerW: paused ? undefined : 100,
    });
  }
  const pausedRecord = record(points, 200);
  pausedRecord.activity.metrics.movingTimeS = metric(139, "s", "session.total_moving_time");
  pausedRecord.activity.metrics.avgPowerW = metric(194, "W", "session.avg_power");
  const result = buildRidePowerSummary(pausedRecord, profile);

  assert.equal(result.longestGapS, 0);
  assert.equal(result.qualityLevel, "hard");
  assert.equal(result.averagePowerW, 194);
  assert.equal(result.averagePowerToWeight, 194 / 50);
});

test("a moving FIT gap remains a power quality issue", () => {
  const points = constantPoints(200).filter((point) => point.elapsedTimeS! <= 10 || point.elapsedTimeS! >= 71);
  const movingGapRecord = record(points, 200);
  movingGapRecord.activity.metrics.avgPowerW = metric(194, "W", "session.avg_power");
  const result = buildRidePowerSummary(movingGapRecord, profile);

  assert.equal(result.longestGapS, 61);
  assert.equal(result.qualityLevel, "unavailable");
  assert.equal(result.averagePowerToWeight, undefined);
});

test("interpolation is capped at two percent and never silently turns a long interruption into a claim", () => {
  const exactlyTwoPercent = constantPoints(1_000).filter((point) => point.elapsedTimeS! < 10 || point.elapsedTimeS! > 28);
  const overTwoPercent = constantPoints(1_000).filter((point) => point.elapsedTimeS! < 10 || point.elapsedTimeS! > 29);

  assert.equal(buildRidePowerSummary(record(exactlyTwoPercent, 1_000), profile).qualityLevel, "hard");
  const unavailable = buildRidePowerSummary(record(overTwoPercent, 1_000), profile);
  assert.equal(unavailable.qualityLevel, "unavailable");
  assert.ok(unavailable.unavailableReasons.includes("interpolation_limit"));
});

test("FTP gates power zones, IF and TSS while NP remains an independent quality-gated fact", () => {
  const withoutFtp = buildRidePowerSummary(record(constantPoints(100, 150)), createUserProfile({ weightKg: 50 }, START_TIME));
  const withFtp = buildRidePowerSummary(record(constantPoints(100, 150)), profile);

  assert.equal(withoutFtp.normalizedPowerW && Math.round(withoutFtp.normalizedPowerW), 150);
  assert.equal(withoutFtp.intensityFactor, undefined);
  assert.equal(withoutFtp.trainingStressScore, undefined);
  assert.equal(withoutFtp.zones, undefined);
  assert.equal(withFtp.zones?.find((zone) => zone.key === "z2")?.durationS, 100);
});

test("missing time, missing power and stopped intervals cannot manufacture power-derived values", () => {
  const noPower = record([{ sequence: 0, elapsedTimeS: 0, speedMps: 5 }, { sequence: 1, elapsedTimeS: 1, speedMps: 5 }], 1);
  const stopped = record(constantPoints(100).map((point) => ({ ...point, speedMps: 0 })), 100);

  assert.deepEqual(buildRidePowerSummary(noPower, profile).unavailableReasons, ["missing_power_series"]);
  const stoppedResult = buildRidePowerSummary(stopped, profile);
  assert.equal(stoppedResult.qualityLevel, "unavailable");
  assert.ok(stoppedResult.unavailableReasons.includes("insufficient_coverage"));
});

test("the dedicated power preview retains a second-level timeline for the full-quality state", () => {
  const result = buildRidePowerSummary({
    activity: structuredClone(getRideFixture("l3-power-preview").activity),
    series: structuredClone(getRideFixture("l3-power-preview").series),
  }, profile);

  assert.equal(result.qualityLevel, "hard");
  assert.ok(result.normalizedPowerW !== undefined);
});
