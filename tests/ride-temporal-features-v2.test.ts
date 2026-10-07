import assert from "node:assert/strict";
import test from "node:test";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import { buildRideTemporalFeaturesV2 } from "../src/domain/ride-temporal-features-v2.ts";
import type { RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";

const START_TIME = "2026-08-28T06:00:00.000Z";

function record(points: Omit<RideSeriesPoint, "sequence">[], options: { trustedStopS?: number; timeBasis?: boolean } = {}): RideRecord {
  const series = buildRideSeries({ rideId: "temporal-example", sourceKind: options.trustedStopS === undefined ? "sample" : "fit",
    parserVersion: "temporal-fixture-v1", ...(options.timeBasis === false ? {} : { startTime: START_TIME }), points });
  const span = points.at(-1)?.elapsedTimeS ?? 0;
  return {
    activity: { schemaVersion: "0.2", rideId: "temporal-example", sport: "cycling",
      source: { kind: options.trustedStopS === undefined ? "sample" : "fit", parserVersion: "temporal-fixture-v1" },
      startTime: START_TIME, metrics: options.trustedStopS === undefined ? {} : {
        elapsedTimeS: { value: span, unit: "s", provenance: "recorded", confidence: "high", evidenceId: "elapsed",
          sourceField: "session.total_elapsed_time", sourceUnit: "s", qualityStatus: "valid", recordedAt: START_TIME },
        movingTimeS: { value: span - options.trustedStopS, unit: "s", provenance: "recorded", confidence: "high", evidenceId: "moving",
          sourceField: "session.total_moving_time", sourceUnit: "s", qualityStatus: "valid", recordedAt: START_TIME },
      },
      sensorQuality: {
        gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
      }, sourceIssues: [] },
    series,
  };
}

function intervals(items: Array<{ seconds: number; speed: number; power?: number }>): Omit<RideSeriesPoint, "sequence">[] {
  const points: Omit<RideSeriesPoint, "sequence">[] = [{ elapsedTimeS: 0, distanceM: 0 }];
  let time = 0;
  let distance = 0;
  for (const item of items) {
    time += item.seconds;
    distance += item.speed * item.seconds;
    points.push({ elapsedTimeS: time, distanceM: distance, speedMps: item.speed, ...(item.power === undefined ? {} : { powerW: item.power }) });
  }
  return points;
}

function speedFeature(recordValue: RideRecord) {
  return buildRideTemporalFeaturesV2(recordValue).series.find((item) => item.seriesKey === "speed")!;
}

test("uneven sampling is weighted by actual time, including stages and distribution", () => {
  const points = intervals([
    ...Array.from({ length: 9 }, () => ({ seconds: 10, speed: 5 })),
    ...Array.from({ length: 10 }, () => ({ seconds: 1, speed: 9 })),
  ]);
  const snapshot = buildRideTemporalFeaturesV2(record(points));
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.equal(speed.statistics?.mean, 5.4); // Sample-count mean would be about 7.1.
  assert.equal(speed.statistics?.median, 5);
  assert.equal(speed.statistics?.p90, 5);
  assert.equal(speed.stages[0]?.start, 0);
  assert.equal(speed.stages[2]?.end, 100);
  assert.equal(speed.stageComparison.eligible, true);
  assert.ok(speed.stageComparison.lastMinusFirst! > 0);
  assert.equal(speed.stability.eligible, true);
  assert.equal(speed.validIntervalCount, 19);
});

test("short stop is kept as an event but excluded from moving speed and each stage", () => {
  const snapshot = buildRideTemporalFeaturesV2(record(intervals([
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 })),
    ...Array.from({ length: 2 }, () => ({ seconds: 10, speed: 0 })),
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 })),
  ])));
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.deepEqual(snapshot.stops.map((item) => [item.kind, item.durationS]), [["short_stop", 20]]);
  assert.equal(speed.statistics?.mean, 5);
  assert.equal(speed.eligibleWeight, 120);
  assert.equal(speed.coverage, 1);
  assert.equal(speed.stability.eligible, true);
});

test("moving recording gap remains a gap rather than 90 seconds of invented evidence", () => {
  const snapshot = buildRideTemporalFeaturesV2(record(intervals([
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 })),
    { seconds: 90, speed: 5 },
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 })),
  ])));
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.equal(snapshot.longestGapS, 90);
  assert.equal(snapshot.gaps.length, 1);
  assert.equal(speed.validWeight, 120);
  assert.equal(speed.eligibleWeight, 210);
  assert.equal(speed.coverage, 120 / 210);
  assert.equal(speed.stability.eligible, false);
  assert.equal(speed.stability.reason, "INSUFFICIENT_COVERAGE");
  assert.equal(speed.stageComparison.eligible, false);
  assert.equal(speed.stages[1]?.mean, undefined);
});

test("a long gap blocks stability even if overall numeric coverage would pass", () => {
  const snapshot = buildRideTemporalFeaturesV2(record(intervals([
    ...Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5 })),
    { seconds: 11, speed: 5 },
    ...Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5 })),
  ])));
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.ok(speed.coverage > 0.8);
  assert.equal(speed.stability.reason, "CONTINUITY_GAP");
});

test("a leading gap does not trip CONTINUITY_GAP when the riding body is well sampled", () => {
  // Regression (2026-10-07 STABILITY_WITHOUT_VARIANCE diagnosis, demo-08-20):
  // a 189 s gap before the first moving sample trimmed the sampled span but must
  // not wipe the coefficient-of-variation claim — CV (std/mean) does not depend
  // on temporal continuity.
  const snapshot = buildRideTemporalFeaturesV2(record(intervals([
    { seconds: 189, speed: 5 },
    ...Array.from({ length: 60 }, () => ({ seconds: 10, speed: 5 })),
  ])));
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.equal(snapshot.gaps.length, 1);
  assert.equal(snapshot.longestGapS, 189);
  assert.ok(speed.coverage > 0.7);
  assert.equal(speed.stability.eligible, true);
  assert.ok(speed.statistics?.coefficientOfVariation !== undefined);
});

test("a trailing gap does not trip CONTINUITY_GAP when the riding body is well sampled", () => {
  const snapshot = buildRideTemporalFeaturesV2(record(intervals([
    ...Array.from({ length: 60 }, () => ({ seconds: 10, speed: 5 })),
    { seconds: 189, speed: 5 },
  ])));
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.equal(snapshot.gaps.length, 1);
  assert.equal(snapshot.longestGapS, 189);
  assert.ok(speed.coverage > 0.7);
  assert.equal(speed.stability.eligible, true);
  assert.ok(speed.statistics?.coefficientOfVariation !== undefined);
});

test("a device-confirmed stationary gap is a stop, not a moving-data gap", () => {
  const ride = record(intervals([
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 })),
    { seconds: 65, speed: 0 },
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 })),
  ]), { trustedStopS: 65 });
  const snapshot = buildRideTemporalFeaturesV2(ride);
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.deepEqual(snapshot.stops.map((item) => item.durationS), [65]);
  assert.deepEqual(snapshot.gaps, []);
  assert.equal(snapshot.unlocatedStopTimeS, 0);
  assert.equal(speed.coverage, 1);
  assert.equal(speed.stability.eligible, true);
});

test("missing timestamp lowers confidence, while distance-weighted statistics remain available without a time axis", () => {
  const missing = record(intervals(Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5 }))));
  delete missing.series.points[6]!.elapsedTimeS;
  assert.equal(speedFeature(missing).statistics, undefined);
  assert.equal(speedFeature(missing).stability.reason, "AXIS_INCOMPLETE");

  const distanceOnly = record(Array.from({ length: 8 }, (_, index) => ({ distanceM: index * 20, speedMps: index < 4 ? 4 : 6 })), { timeBasis: false });
  const feature = speedFeature(distanceOnly);
  assert.equal(feature.weightUnit, "m");
  assert.ok(feature.statistics);
  assert.equal(feature.stability.reason, "TIME_AXIS_REQUIRED");
  assert.equal(feature.stageComparison.reason, "TIME_AXIS_REQUIRED");
  assert.ok(feature.stages.every((stage) => stage.mean === undefined));
});

test("distance-only statistics require at least 100 meters of valid intervals", () => {
  const shortRide = record(Array.from({ length: 9 }, (_, index) => ({ distanceM: index * 10, speedMps: 5 })), { timeBasis: false });
  const shortFeature = speedFeature(shortRide);
  assert.equal(shortFeature.weightUnit, "m");
  assert.equal(shortFeature.validIntervalCount, 8);
  assert.equal(shortFeature.validWeight, 80);
  assert.equal(shortFeature.statistics, undefined);
  assert.ok(shortFeature.unavailable.includes("INSUFFICIENT_SAMPLES"));

  const qualifiedRide = record(Array.from({ length: 11 }, (_, index) => ({ distanceM: index * 10, speedMps: 5 })), { timeBasis: false });
  assert.equal(speedFeature(qualifiedRide).statistics?.mean, 5);
});

test("unlocated device stop time blocks process claims, while absent and degraded sensors stay unavailable", () => {
  const ride = record(intervals(Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5, power: 200 }))), { trustedStopS: 30 });
  const snapshot = buildRideTemporalFeaturesV2(ride);
  assert.equal(snapshot.unlocatedStopTimeS, 30);
  const powerWithUnlocatedStop = snapshot.series.find((item) => item.seriesKey === "power")!;
  assert.equal(powerWithUnlocatedStop.statistics, undefined);
  assert.ok(powerWithUnlocatedStop.stages.every((stage) => stage.mean === undefined));
  assert.equal(powerWithUnlocatedStop.stability.reason, "UNLOCATED_STOP_TIME");
  assert.ok(powerWithUnlocatedStop.unavailable.includes("UNLOCATED_STOP_TIME"));
  assert.equal(snapshot.series.find((item) => item.seriesKey === "cadence")?.stability.reason, "SERIES_MISSING");
  ride.series.seriesMetadata.power!.qualityStatus = "degraded";
  // S2-05: a degraded parser label alone no longer disqualifies a series whose
  // effective coverage is high — the ride-level unlocated-stop gate surfaces first.
  const degradedLabel = buildRideTemporalFeaturesV2(ride).series.find((item) => item.seriesKey === "power")!;
  assert.equal(degradedLabel.unavailable.includes("QUALITY_INSUFFICIENT"), false);
  // Genuinely insufficient effective coverage still fails closed.
  ride.activity.sensorQuality.power!.coverage = 0.5;
  const insufficient = buildRideTemporalFeaturesV2(ride).series.find((item) => item.seriesKey === "power")!;
  assert.equal(insufficient.statistics, undefined);
  assert.equal(insufficient.unavailable[0], "QUALITY_INSUFFICIENT");
});

test("missing sensor intervals reduce coverage independently, and all-zero power is not stability evidence", () => {
  const ride = record(intervals(Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5, power: 200 }))));
  for (let index = 7; index <= 10; index += 1) delete ride.series.points[index]!.powerW;
  ride.series.seriesMetadata.power!.sampleCount -= 4;
  const snapshot = buildRideTemporalFeaturesV2(ride);
  const power = snapshot.series.find((item) => item.seriesKey === "power")!;
  const speed = snapshot.series.find((item) => item.seriesKey === "speed")!;
  assert.equal(power.coverage, 80 / 120);
  assert.equal(power.stability.reason, "INSUFFICIENT_COVERAGE");
  assert.equal(power.stageComparison.eligible, false);
  assert.equal(speed.stability.eligible, true);

  const zeros = record(intervals(Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5, power: 0 }))));
  const zeroPower = buildRideTemporalFeaturesV2(zeros).series.find((item) => item.seriesKey === "power")!;
  assert.equal(zeroPower.statistics, undefined);
  assert.equal(zeroPower.stability.reason, "ALL_ZERO_SERIES");
});
