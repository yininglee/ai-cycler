import assert from "node:assert/strict";
import test from "node:test";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import type { RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import type { RideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import type { RideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideTemporalWindowsV2 } from "../src/domain/ride-temporal-windows-v2.ts";
import { buildRideTimingSummary } from "../src/domain/ride-timing.ts";

const START = "2026-08-28T06:00:00.000Z";

function record(rows: Array<{ seconds: number; speed: number; power?: number; heartRate?: number; cadence?: number }>,
  options: { trustedStopS?: number; timed?: boolean } = {}): RideRecord {
  const points: Omit<RideSeriesPoint, "sequence">[] = [{ distanceM: 0, ...(options.timed === false ? {} : { elapsedTimeS: 0 }) }];
  let seconds = 0;
  let distance = 0;
  for (const row of rows) {
    seconds += row.seconds;
    distance += row.seconds * row.speed;
    points.push({ distanceM: distance, ...(options.timed === false ? {} : { elapsedTimeS: seconds }),
      speedMps: row.speed, ...(row.power === undefined ? {} : { powerW: row.power }),
      ...(row.heartRate === undefined ? {} : { heartRateBpm: row.heartRate }),
      ...(row.cadence === undefined ? {} : { cadenceRpm: row.cadence }) });
  }
  const fit = options.trustedStopS !== undefined;
  const source = { kind: fit ? "fit" as const : "sample" as const, parserVersion: "windows-fixture-v1" };
  const metric = (value: number, sourceField: string) => ({ value, unit: "s" as const,
    provenance: "recorded" as const, confidence: "high" as const, evidenceId: sourceField,
    sourceField, sourceUnit: "s", qualityStatus: "valid" as const, recordedAt: START });
  return {
    activity: { schemaVersion: "0.2", rideId: "window-example", sport: "cycling", source, startTime: START,
      metrics: fit ? { elapsedTimeS: metric(seconds, "session.total_elapsed_time"),
        movingTimeS: metric(seconds - options.trustedStopS!, "session.total_moving_time") } : {},
      sensorQuality: { gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        heart_rate: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        cadence: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 } }, sourceIssues: [] },
    series: buildRideSeries({ rideId: "window-example", sourceKind: source.kind, parserVersion: source.parserVersion,
      ...(options.timed === false ? {} : { startTime: START }), points }),
  };
}

function climbs(...bounds: Array<[number, number]>): RideEventClimbSummary {
  return { rulesVersion: "ride-event-climb-rules-v0.2", isAvailable: true, unavailableReasons: [],
    climbs: bounds.map(([startDistanceM, endDistanceM], index) => ({
      id: `climb-${index}`, rulesVersion: "ride-event-climb-rules-v0.2",
      elevationRulesVersion: "test", routeShapeRulesVersion: "test", category: "4" as const,
      startDistanceM, endDistanceM, distanceM: endDistanceM - startDistanceM,
      netElevationGainM: 50, averageGrade: 0.05, difficultyScore: 10, unavailableReasons: [],
    })) };
}

test("exact 10/20/30-second power peaks use contiguous interval weight", () => {
  const ride = record([
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5, power: 100 })),
    ...Array.from({ length: 3 }, () => ({ seconds: 10, speed: 5, power: 300 })),
    ...Array.from({ length: 3 }, () => ({ seconds: 10, speed: 5, power: 100 })),
  ]);
  const result = buildRideTemporalWindowsV2(ride);
  assert.deepEqual(result.powerPeaks.map((peak) => peak.meanPowerW), [300, 300, 300]);
  assert.deepEqual(result.powerPeaks.map((peak) => [peak.startElapsedTimeS, peak.endElapsedTimeS]),
    [[60, 70], [60, 80], [60, 90]]);
  assert.ok(result.powerPeaks.every((peak) => peak.rulesVersion === result.rulesVersion && peak.evidenceIds.length === 1));
});

test("power peaks cannot bridge a recording gap, missing power, or a confirmed stop", () => {
  const gap = record([{ seconds: 10, speed: 5, power: 250 }, { seconds: 90, speed: 5, power: 300 },
    { seconds: 10, speed: 5, power: 250 }]);
  assert.deepEqual(buildRideTemporalWindowsV2(gap).powerPeaks.map((peak) => peak.meanPowerW), [250, undefined, undefined]);

  const missing = record(Array.from({ length: 8 }, (_, index) =>
    ({ seconds: 10, speed: 5, power: index === 3 ? undefined : index > 3 ? 250 : 200 })));
  assert.equal(buildRideTemporalWindowsV2(missing).powerPeaks.find((peak) => peak.durationS === 30)?.startElapsedTimeS, 40);

  const stopped = record([
    ...Array.from({ length: 2 }, () => ({ seconds: 10, speed: 5, power: 200 })),
    ...Array.from({ length: 2 }, () => ({ seconds: 10, speed: 0, power: 400 })),
    ...Array.from({ length: 2 }, () => ({ seconds: 10, speed: 5, power: 200 })),
  ]);
  assert.equal(buildRideTemporalWindowsV2(stopped).powerPeaks.find((peak) => peak.durationS === 30)?.unavailableReason,
    "INSUFFICIENT_CONTINUOUS_DATA");
});

test("same 30-second windows require actual paired coverage, not two independent sensor totals", () => {
  const shared = record(Array.from({ length: 9 }, (_, index) => ({ seconds: 10, speed: 5,
    power: index < 3 ? 200 : undefined, heartRate: index < 3 ? 140 : undefined })));
  const yes = buildRideTemporalWindowsV2(shared);
  const joint = yes.jointWindows.find((window) => window.seriesKeys.join("-") === "power-heart_rate");
  assert.equal(joint?.sharedTimeS, 30);
  assert.equal(joint?.commonCoverage, 1);
  assert.deepEqual(joint?.means, { power: 200, heart_rate: 140 });
  assert.equal(joint?.expressionBoundary, "same_window_observation_only");

  const disjoint = record(Array.from({ length: 9 }, (_, index) => ({ seconds: 10, speed: 5,
    power: index < 3 ? 200 : undefined, heartRate: index >= 3 && index < 6 ? 140 : undefined })));
  const no = buildRideTemporalWindowsV2(disjoint);
  assert.equal(no.jointWindows.some((window) => window.seriesKeys.join("-") === "power-heart_rate"), false);
  assert.equal(no.pairAvailability.find((pair) => pair.seriesKeys.join("-") === "power-heart_rate")?.reason, "NO_COMMON_WINDOW");
});

test("pair gates require twenty shared seconds, two intervals, and 70 percent joint coverage", () => {
  const sparse = record(Array.from({ length: 9 }, (_, index) => ({ seconds: 10, speed: 5,
    power: index < 3 ? 200 : undefined, heartRate: index === 0 ? 140 : undefined })));
  assert.equal(buildRideTemporalWindowsV2(sparse).jointWindows.some((window) => window.seriesKeys.join("-") === "power-heart_rate"), false);
  const eligible = record(Array.from({ length: 9 }, (_, index) => ({ seconds: 10, speed: 5,
    power: index < 3 ? 200 : undefined, heartRate: index < 2 ? 140 : undefined })));
  assert.equal(buildRideTemporalWindowsV2(eligible).jointWindows.some((window) => window.seriesKeys.join("-") === "power-heart_rate"), false);
  const complete = record(Array.from({ length: 9 }, (_, index) => ({ seconds: 10, speed: 5,
    power: index < 3 ? 200 : undefined, heartRate: index < 3 ? 140 : undefined })));
  assert.equal(buildRideTemporalWindowsV2(complete).jointWindows.find((window) => window.seriesKeys.join("-") === "power-heart_rate")?.sharedIntervalCount, 3);

  const boundary = record([{ seconds: 7, speed: 5, power: 200, heartRate: 140 },
    { seconds: 7, speed: 5, power: 200, heartRate: 140 },
    { seconds: 7, speed: 5, power: 200, heartRate: 140 },
    { seconds: 9, speed: 5, power: 200 },
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5 }))]);
  assert.equal(buildRideTemporalWindowsV2(boundary).jointWindows.find((window) =>
    window.seriesKeys.join("-") === "power-heart_rate")?.commonCoverage, 0.7);
});

test("all climbs, cruises and terrain runs remain separate; means and pairs use each segment's bounds", () => {
  const ride = record(Array.from({ length: 36 }, () => ({ seconds: 10, speed: 5, power: 180, heartRate: 135 })));
  const timing = buildRideTimingSummary(ride);
  timing.cruiseSegments = [
    { startElapsedTimeS: 0, endElapsedTimeS: 120, durationS: 120, averageSpeedMps: 5,
      speedCoefficientOfVariation: 0, isLong: false },
    { startElapsedTimeS: 150, endElapsedTimeS: 300, durationS: 150, averageSpeedMps: 5,
      speedCoefficientOfVariation: 0, isLong: false },
  ];
  const terrain = { type: "flat" as const, startDistanceM: 0, endDistanceM: 300, distanceM: 300 };
  const routeShape: RideRouteShapeSummary = {
    rulesVersion: "ride-route-shape-rules-v0.2", isAvailable: true,
    gradeSegments: [], displayGradeSegments: [], trendSegments: [terrain], segments: [terrain],
    movingDistanceM: 1800, classifiedDistanceM: 300, climbDistanceM: 0, flatDistanceM: 300,
    descentDistanceM: 0, trendClimbDistanceM: 0, trendFlatDistanceM: 300,
    trendDescentDistanceM: 0, trendClassifiedDistanceM: 300, coverageRatio: 1, needsCoverageNotice: false,
  };
  const result = buildRideTemporalWindowsV2(ride, {
    climbs: climbs([100, 300], [350, 550], [600, 800], [850, 1050]), timing, routeShape,
  });
  const segmentClimbs = result.segments.filter((segment) => segment.kind === "climb");
  assert.equal(segmentClimbs.length, 4);
  assert.deepEqual(segmentClimbs.map((segment) => [segment.startElapsedTimeS, segment.endElapsedTimeS]),
    [[20, 60], [70, 110], [120, 160], [170, 210]]);
  assert.ok(segmentClimbs.every((segment) => segment.sensorMeans.power?.mean === 180
    && segment.jointWindows.some((joint) => joint.seriesKeys.join("-") === "power-heart_rate")));
  assert.equal(result.segments.filter((segment) => segment.kind === "cruise").length, 2);
  assert.equal(result.segments.filter((segment) => segment.kind === "terrain").length, 1);
  assert.equal(result.segments.find((segment) => segment.kind === "terrain")?.sensorMeans.power?.mean, 180);
});

test("a distance boundary within an unrecorded gap is not given invented time", () => {
  const ride = record([{ seconds: 10, speed: 5, power: 200, heartRate: 130 },
    { seconds: 90, speed: 5, power: 200, heartRate: 130 },
    ...Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5, power: 200, heartRate: 130 }))]);
  const result = buildRideTemporalWindowsV2(ride, { climbs: climbs([100, 400]) });
  assert.equal(result.segments[0]?.unavailableReason, "BOUNDARY_UNAVAILABLE");
  assert.deepEqual(result.segments[0]?.jointWindows, []);
  assert.equal(result.segments[0]?.pairAvailability.find((pair) => pair.seriesKeys.join("-") === "power-heart_rate")?.reason,
    "BOUNDARY_UNAVAILABLE");
});

test("out-of-ride segments cannot pass on partial coverage; unavailable climb sources are ignored", () => {
  const ride = record(Array.from({ length: 9 }, () => ({ seconds: 10, speed: 5, power: 200, heartRate: 140 })));
  const timing = buildRideTimingSummary(ride);
  timing.cruiseSegments = [{ startElapsedTimeS: -5, endElapsedTimeS: 25, durationS: 30,
    averageSpeedMps: 5, speedCoefficientOfVariation: 0, isLong: false }];
  const unavailableClimbs = { ...climbs([50, 150]), isAvailable: false };
  const result = buildRideTemporalWindowsV2(ride, { timing, climbs: unavailableClimbs });
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0]?.unavailableReason, "BOUNDARY_UNAVAILABLE");
  assert.deepEqual(result.segments[0]?.jointWindows, []);
  assert.equal(result.segments[0]?.pairAvailability.find((pair) => pair.seriesKeys.join("-") === "power-heart_rate")?.reason,
    "BOUNDARY_UNAVAILABLE");
});

test("a qualified segment pair counts even when no fixed thirty-second bin qualifies", () => {
  const ride = record(Array.from({ length: 9 }, (_, index) => ({ seconds: 10, speed: 5,
    power: index === 2 || index === 3 ? 200 : undefined,
    heartRate: index === 2 || index === 3 ? 140 : undefined })));
  const result = buildRideTemporalWindowsV2(ride, { climbs: climbs([100, 200]) });
  assert.equal(result.jointWindows.some((window) => window.seriesKeys.join("-") === "power-heart_rate"), false);
  assert.equal(result.segments[0]?.jointWindows.find((window) => window.seriesKeys.join("-") === "power-heart_rate")?.sharedTimeS, 20);
  assert.equal(result.pairAvailability.find((pair) => pair.seriesKeys.join("-") === "power-heart_rate")?.eligible, true);
});

test("missing time, unlocated device stop, and absent sensors fail closed independently", () => {
  const untimed = record(Array.from({ length: 6 }, () => ({ seconds: 10, speed: 5, power: 200 })), { timed: false });
  assert.equal(buildRideTemporalWindowsV2(untimed).unavailableReason, "TIME_AXIS_REQUIRED");

  const unlocated = record(Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5, power: 200 })), { trustedStopS: 30 });
  assert.equal(buildRideTemporalWindowsV2(unlocated).unavailableReason, "UNLOCATED_STOP_TIME");

  const noHeartRate = record(Array.from({ length: 9 }, () => ({ seconds: 10, speed: 5, power: 200 })));
  const result = buildRideTemporalWindowsV2(noHeartRate);
  assert.equal(result.powerPeaks[2]?.meanPowerW, 200);
  assert.equal(result.pairAvailability.find((pair) => pair.seriesKeys.join("-") === "power-heart_rate")?.reason, "SOURCE_UNAVAILABLE");
});
