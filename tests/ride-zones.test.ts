import assert from "node:assert/strict";
import test from "node:test";

import type { Metric, RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import { buildCadenceZoneDistribution, buildHeartRateZoneDistribution } from "../src/domain/ride-zones.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";

const START_TIME = "2026-08-29T06:00:00.000Z";

function metric(value: number, unit: Metric["unit"], sourceField: string): Metric {
  return {
    value,
    unit,
    provenance: "recorded",
    confidence: "high",
    evidenceId: `evidence:${sourceField}`,
    sourceField,
    sourceUnit: unit,
    qualityStatus: "valid",
    recordedAt: START_TIME,
  };
}

function record(points: RideSeriesPoint[], options: { cadenceQuality?: number; heartRateQuality?: number; movingTimeS?: number } = {}): RideRecord {
  const durationS = options.movingTimeS ?? points.at(-1)?.elapsedTimeS ?? 0;
  const series = buildRideSeries({
    rideId: "ride-zones-test",
    sourceKind: "fit",
    parserVersion: "ride-zones-test-v0.1",
    startTime: START_TIME,
    points,
  });
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "ride-zones-test",
      sport: "cycling",
      source: { kind: "fit", fileName: "zones.fit", parserVersion: "ride-zones-test-v0.1" },
      startTime: START_TIME,
      metrics: {
        distanceM: metric(1_000, "m", "session.total_distance"),
        elapsedTimeS: metric(durationS, "s", "session.total_elapsed_time"),
        movingTimeS: metric(durationS, "s", "session.total_moving_time"),
      },
      sensorQuality: {
        gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        heart_rate: { coverage: options.heartRateQuality ?? 1, sampleCount: points.length, invalidSampleCount: 0 },
        cadence: { coverage: options.cadenceQuality ?? 1, sampleCount: points.length, invalidSampleCount: 0 },
      },
      sourceIssues: [],
    },
    series,
  };
}

function profile(maxHeartRateBpm = 200) {
  return createUserProfile({ age: 30, maxHeartRateBpm }, START_TIME);
}

test("heart-rate zones use the configured baseline boundaries and keep values outside it separate", () => {
  const result = buildHeartRateZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, heartRateBpm: 99 },
    { sequence: 1, elapsedTimeS: 1, speedMps: 5, heartRateBpm: 100 },
    { sequence: 2, elapsedTimeS: 2, speedMps: 5, heartRateBpm: 120 },
    { sequence: 3, elapsedTimeS: 3, speedMps: 5, heartRateBpm: 140 },
    { sequence: 4, elapsedTimeS: 4, speedMps: 5, heartRateBpm: 160 },
    { sequence: 5, elapsedTimeS: 5, speedMps: 5, heartRateBpm: 180 },
    { sequence: 6, elapsedTimeS: 6, speedMps: 5, heartRateBpm: 200 },
    { sequence: 7, elapsedTimeS: 7, speedMps: 5, heartRateBpm: 201 },
    { sequence: 8, elapsedTimeS: 8, speedMps: 5, heartRateBpm: 201 },
  ]), profile());

  assert.equal(result.unavailableReason, undefined);
  assert.deepEqual(result.bins.map((bin) => bin.durationS), [1, 1, 1, 1, 1, 2, 1]);
  assert.deepEqual(result.bins.map((bin) => bin.label), [
    "低于 100 bpm",
    "Z1 · 100–119 bpm",
    "Z2 · 120–139 bpm",
    "Z3 · 140–159 bpm",
    "Z4 · 160–179 bpm",
    "Z5 · 180–200 bpm",
    "超出 200 bpm",
  ]);
  assert.equal(result.baseline?.source, "user_provided");
});

test("estimated maximum heart rate is explicitly retained as the baseline source", () => {
  const result = buildHeartRateZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, heartRateBpm: 110 },
    { sequence: 1, elapsedTimeS: 10, speedMps: 5, heartRateBpm: 110 },
  ]), createUserProfile({ age: 40 }, START_TIME));

  assert.equal(result.baseline?.maxHeartRateBpm, 180);
  assert.equal(result.baseline?.source, "system_estimated");
});

test("cadence zones include zero and apply the agreed boundaries", () => {
  const result = buildCadenceZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, cadenceRpm: 0 },
    { sequence: 1, elapsedTimeS: 1, speedMps: 5, cadenceRpm: 1 },
    { sequence: 2, elapsedTimeS: 2, speedMps: 5, cadenceRpm: 60 },
    { sequence: 3, elapsedTimeS: 3, speedMps: 5, cadenceRpm: 75 },
    { sequence: 4, elapsedTimeS: 4, speedMps: 5, cadenceRpm: 90 },
    { sequence: 5, elapsedTimeS: 5, speedMps: 5, cadenceRpm: 105 },
    { sequence: 6, elapsedTimeS: 6, speedMps: 5, cadenceRpm: 105 },
  ]));

  assert.deepEqual(result.bins.map((bin) => bin.durationS), [1, 1, 1, 1, 1, 1]);
});

test("an all-zero cadence sequence is treated as an unavailable placeholder", () => {
  const result = buildCadenceZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, cadenceRpm: 0 },
    { sequence: 1, elapsedTimeS: 10, speedMps: 5, cadenceRpm: 0 },
  ]));

  assert.equal(result.unavailableReason, "zero_placeholder");
  assert.equal(result.validDurationS, 0);
});

test("intervals are time weighted, gaps are not fabricated, and missing samples lower coverage", () => {
  const result = buildHeartRateZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, heartRateBpm: 130 },
    { sequence: 1, elapsedTimeS: 4, speedMps: 5, heartRateBpm: undefined },
    { sequence: 2, elapsedTimeS: 8, speedMps: 5, heartRateBpm: 130 },
    { sequence: 3, elapsedTimeS: 28, speedMps: 5, heartRateBpm: 130 },
    { sequence: 4, elapsedTimeS: 32, speedMps: 5, heartRateBpm: 130 },
  ]), profile(),);

  assert.equal(result.validDurationS, 8);
  assert.equal(result.missingDurationS, 4);
  assert.equal(result.coverage, 0.25);
  assert.equal(result.unavailableReason, "insufficient_coverage");
});

test("coverage is bounded at 100% when interval totals exceed reported moving time", () => {
  const result = buildCadenceZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, cadenceRpm: 80 },
    { sequence: 1, elapsedTimeS: 2, speedMps: 5, cadenceRpm: 80 },
    { sequence: 2, elapsedTimeS: 4, speedMps: 5, cadenceRpm: 80 },
  ], { movingTimeS: 3 }));
  assert.equal(result.coverage, 1);
});

test("stopped intervals are separated and do not enter any zone", () => {
  const result = buildCadenceZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, cadenceRpm: 80 },
    { sequence: 1, elapsedTimeS: 10, speedMps: 0, cadenceRpm: 80 },
    { sequence: 2, elapsedTimeS: 20, speedMps: 0, cadenceRpm: 80 },
    { sequence: 3, elapsedTimeS: 30, speedMps: 0, cadenceRpm: 80 },
    { sequence: 4, elapsedTimeS: 40, speedMps: 0, cadenceRpm: 80 },
    { sequence: 5, elapsedTimeS: 50, speedMps: 5, cadenceRpm: 80 },
    { sequence: 6, elapsedTimeS: 60, speedMps: 5, cadenceRpm: 80 },
  ], { movingTimeS: 20 }));

  assert.equal(result.stoppedDurationS, 40);
  assert.equal(result.validDurationS, 20);
  assert.equal(result.bins.find((bin) => bin.key === "endurance")?.durationS, 20);
});

test("coverage below 70%, failed sensor quality, and missing baseline hide distributions", () => {
  const incomplete = buildCadenceZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, cadenceRpm: 80 },
    { sequence: 1, elapsedTimeS: 6, speedMps: 5, cadenceRpm: undefined },
    { sequence: 2, elapsedTimeS: 10, speedMps: 5, cadenceRpm: 80 },
  ]));
  const lowQuality = buildCadenceZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, cadenceRpm: 80 },
    { sequence: 1, elapsedTimeS: 10, speedMps: 5, cadenceRpm: 80 },
  ], { cadenceQuality: 0.5 }));
  const noBaseline = buildHeartRateZoneDistribution(record([
    { sequence: 0, elapsedTimeS: 0, speedMps: 5, heartRateBpm: 120 },
    { sequence: 1, elapsedTimeS: 10, speedMps: 5, heartRateBpm: 120 },
  ]));

  assert.equal(incomplete.unavailableReason, "insufficient_coverage");
  assert.equal(lowQuality.unavailableReason, "sensor_quality_failed");
  assert.equal(noBaseline.unavailableReason, "missing_heart_rate_baseline");
});
