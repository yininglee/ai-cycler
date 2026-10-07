import assert from "node:assert/strict";
import test from "node:test";

import type { DataSourceKind, Metric, RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import { buildRideSeries, validateRideRecord } from "../src/domain/ride-series.ts";
import { buildRideTimingSummary } from "../src/domain/ride-timing.ts";
import { buildRidePageViewModelFromRecord } from "../src/ui/ride-view-model.ts";

const START_TIME = "2026-08-28T06:00:00.000Z";

function recordedMetric(value: number, unit: Metric["unit"], sourceField: string): Metric {
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

function calculatedMetric(value: number, unit: Metric["unit"], sourceField: string): Metric {
  return {
    ...recordedMetric(value, unit, sourceField),
    provenance: "calculated",
    formulaVersion: "timing-test-v0.1",
  };
}

function pointsFromIntervals(
  intervals: Array<{ durationS: number; speedMps: number; grade?: number; elevation?: boolean }>,
): RideSeriesPoint[] {
  const points: RideSeriesPoint[] = [{ sequence: 0, elapsedTimeS: 0, distanceM: 0, elevationM: 20 }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  let elevationM = 20;
  for (const interval of intervals) {
    elapsedTimeS += interval.durationS;
    const distanceDeltaM = interval.speedMps * interval.durationS;
    distanceM += distanceDeltaM;
    elevationM += distanceDeltaM * (interval.grade ?? 0);
    points.push({
      sequence: points.length,
      elapsedTimeS,
      distanceM,
      ...(interval.elevation === false ? {} : { elevationM }),
      speedMps: interval.speedMps,
    });
  }
  if (intervals.some((interval) => interval.elevation === false)) {
    return points.map(({ elevationM: _elevationM, ...point }) => point);
  }
  return points;
}

function repeatedIntervals(count: number, speedMps: number, options: { grade?: number; elevation?: boolean } = {}) {
  return Array.from({ length: count }, () => ({ durationS: 1, speedMps, ...options }));
}

// A recording gap whose distance delta is set explicitly (not speed × time),
// so every point carries the same high instantaneous speed while the gap itself
// drifts only a few metres — the real device shape behind upload-f95e988a,
// where the 378s gap moved +7.0m yet its edge points read 7.5 m/s.
function pointsWithEdgeSpeedGap(options: {
  leadSeconds: number;
  trailSeconds: number;
  gapDurationS: number;
  gapDistanceDeltaM: number;
  speedMps: number;
}): RideSeriesPoint[] {
  const points: RideSeriesPoint[] = [{ sequence: 0, elapsedTimeS: 0, distanceM: 0, elevationM: 20 }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  let sequence = 1;
  const push = (durationS: number, distanceDeltaM: number) => {
    elapsedTimeS += durationS;
    distanceM += distanceDeltaM;
    points.push({ sequence: sequence++, elapsedTimeS, distanceM, elevationM: 20, speedMps: options.speedMps });
  };
  for (let i = 0; i < options.leadSeconds; i += 1) push(1, options.speedMps);
  push(options.gapDurationS, options.gapDistanceDeltaM);
  for (let i = 0; i < options.trailSeconds; i += 1) push(1, options.speedMps);
  return points;
}

function rideRecord(
  points: RideSeriesPoint[],
  options: {
    sourceKind?: DataSourceKind;
    elapsedTimeS?: number;
    movingTimeS?: number;
    trustedDeviceTiming?: boolean;
  } = {},
): RideRecord {
  const sourceKind = options.sourceKind ?? "gpx";
  const distanceM = points.at(-1)?.distanceM ?? 0;
  const elapsedTimeS = options.elapsedTimeS ?? points.at(-1)?.elapsedTimeS;
  const movingTimeS = options.movingTimeS ?? elapsedTimeS;
  const trusted = options.trustedDeviceTiming ?? false;
  const parserVersion = "timing-test-parser-v0.1";
  const metrics = {
    distanceM: recordedMetric(distanceM, "m", sourceKind === "fit" ? "session.total_distance" : "gpx.track.distance"),
    ...(elapsedTimeS !== undefined ? {
      elapsedTimeS: trusted
        ? recordedMetric(elapsedTimeS, "s", "session.total_elapsed_time")
        : calculatedMetric(elapsedTimeS, "s", "gpx.timestamp_span"),
    } : {}),
    ...(movingTimeS !== undefined ? {
      movingTimeS: trusted
        ? recordedMetric(movingTimeS, "s", "session.total_moving_time")
        : calculatedMetric(movingTimeS, "s", "gpx.moving_segments"),
      avgSpeedMps: calculatedMetric(distanceM / movingTimeS, "m/s", "distance/moving_time"),
    } : {}),
  };
  const series = buildRideSeries({
    rideId: "ride-timing-test",
    sourceKind,
    parserVersion,
    startTime: START_TIME,
    points,
  });
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "ride-timing-test",
      sport: "cycling",
      source: {
        kind: sourceKind,
        parserVersion,
        ...(sourceKind === "fit" ? { fileName: "timing-test.fit" } : sourceKind === "gpx" ? { fileName: "timing-test.gpx" } : {}),
      },
      startTime: START_TIME,
      metrics,
      sensorQuality: { gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 } },
      sourceIssues: [],
    },
    series,
  };
}

test("trusted FIT aggregate timing wins without fabricating stop positions", () => {
  const record = rideRecord(pointsFromIntervals(repeatedIntervals(120, 5)), {
    sourceKind: "fit",
    elapsedTimeS: 1_000,
    movingTimeS: 900,
    trustedDeviceTiming: true,
  });
  const timing = buildRideTimingSummary(record);

  assert.equal(timing.source, "device_recorded");
  assert.equal(timing.stoppedTimeS, 100);
  assert.deepEqual(timing.stops, []);
  assert.equal(timing.elapsedAverageSpeedMps, (record.activity.metrics.distanceM?.value ?? 0) / 1_000);
  assert.equal(timing.movingAverageSpeedMps, (record.activity.metrics.distanceM?.value ?? 0) / 900);
});

test("trusted FIT timing recognizes a stationary long recording gap as a stop", () => {
  const points = pointsFromIntervals([
    ...repeatedIntervals(10, 5),
    { durationS: 65, speedMps: 0 },
    ...repeatedIntervals(10, 5),
  ]);
  const recordWithPause = rideRecord(points, {
    sourceKind: "fit",
    elapsedTimeS: 85,
    movingTimeS: 20,
    trustedDeviceTiming: true,
  });
  const timing = buildRideTimingSummary(recordWithPause);

  assert.equal(timing.source, "device_recorded");
  assert.equal(timing.stoppedTimeS, 65);
  assert.deepEqual(timing.stops.map((stop) => stop.durationS), [65]);
});

test("trusted FIT timing does not classify a moving long gap as a stop", () => {
  const points = pointsFromIntervals([
    ...repeatedIntervals(10, 5),
    { durationS: 65, speedMps: 5 },
    ...repeatedIntervals(10, 5),
  ]);
  const recordWithGap = rideRecord(points, {
    sourceKind: "fit",
    elapsedTimeS: 85,
    movingTimeS: 85,
    trustedDeviceTiming: true,
  });
  const timing = buildRideTimingSummary(recordWithGap);

  assert.deepEqual(timing.stops, []);
});

test("a stationary recording gap stays a stop even when its edge points read high speed", () => {
  // gap drifts only 3.3m (GPS noise) but the edge points carry 5 m/s — the old
  // edge-speed rule wrongly rejected this, orphaning the whole device stop time
  // into UNLOCATED_STOP_TIME (upload-f95e988a).
  const points = pointsWithEdgeSpeedGap({
    leadSeconds: 10, trailSeconds: 10, gapDurationS: 65, gapDistanceDeltaM: 3.3, speedMps: 5,
  });
  const record = rideRecord(points, {
    sourceKind: "fit",
    elapsedTimeS: 85,
    movingTimeS: 20,
    trustedDeviceTiming: true,
  });
  const timing = buildRideTimingSummary(record);

  assert.equal(timing.source, "device_recorded");
  assert.equal(timing.stoppedTimeS, 65);
  assert.deepEqual(timing.stops.map((stop) => stop.durationS), [65]);
});

test("a genuinely moving recording gap is not fabricated into a stop", () => {
  // gap actually advanced 325m (rider kept moving), so even though the device
  // reports 65s of stop time, the gap must NOT be placed as a stop.
  const points = pointsWithEdgeSpeedGap({
    leadSeconds: 10, trailSeconds: 10, gapDurationS: 65, gapDistanceDeltaM: 325, speedMps: 5,
  });
  const record = rideRecord(points, {
    sourceKind: "fit",
    elapsedTimeS: 85,
    movingTimeS: 20,
    trustedDeviceTiming: true,
  });
  const timing = buildRideTimingSummary(record);

  assert.equal(timing.stoppedTimeS, 65);
  assert.deepEqual(timing.stops, []);
});

test("short stops remain visible but do not enter stopped-time total", () => {
  const points = pointsFromIntervals([
    ...repeatedIntervals(10, 5),
    ...repeatedIntervals(20, 0),
    ...repeatedIntervals(10, 5),
  ]);
  const timing = buildRideTimingSummary(rideRecord(points));

  assert.equal(timing.source, "rule_inferred");
  assert.equal(timing.stoppedTimeS, 0);
  assert.equal(timing.stops.length, 1);
  assert.equal(timing.stops[0]?.kind, "short_stop");
  assert.equal(timing.stops[0]?.durationS, 20);
});

test("confirmed stops count from candidate start and require five seconds of resumed movement", () => {
  const points = pointsFromIntervals([
    ...repeatedIntervals(5, 5),
    ...repeatedIntervals(35, 0),
    ...repeatedIntervals(3, 5),
    ...repeatedIntervals(5, 0),
    ...repeatedIntervals(5, 5),
  ]);
  const timing = buildRideTimingSummary(rideRecord(points));

  assert.equal(timing.stops.length, 1);
  assert.equal(timing.stops[0]?.kind, "stop");
  assert.equal(timing.stops[0]?.startElapsedTimeS, 5);
  assert.equal(timing.stops[0]?.durationS, 43);
  assert.equal(timing.stoppedTimeS, 43);
});

test("sampling gaps over ten seconds split stop inference and are excluded from inferred moving time", () => {
  const points = pointsFromIntervals([
    ...repeatedIntervals(10, 0),
    { durationS: 20, speedMps: 0 },
    ...repeatedIntervals(10, 0),
  ]);
  const timing = buildRideTimingSummary(rideRecord(points));

  assert.equal(timing.stoppedTimeS, 0);
  assert.deepEqual(timing.stops.map((stop) => stop.durationS), [10, 10]);
  assert.equal(timing.movingTimeS, 20);
  assert.equal(timing.elapsedTimeS, 40);
});

test("two-to-four-minute steady segments are retained and five-minute segments are long cruises", () => {
  const regular = buildRideTimingSummary(rideRecord(pointsFromIntervals(repeatedIntervals(180, 6))));
  const long = buildRideTimingSummary(rideRecord(pointsFromIntervals(repeatedIntervals(330, 6))));

  assert.equal(regular.cruiseSegments.length, 1);
  assert.ok((regular.cruiseSegments[0]?.durationS ?? 0) >= 120);
  assert.equal(regular.cruiseSegments[0]?.isLong, false);
  assert.equal(long.cruiseSegments.length, 1);
  assert.ok((long.cruiseSegments[0]?.durationS ?? 0) >= 300);
  assert.equal(long.cruiseSegments[0]?.isLong, true);
});

test("cruise rejects steep, variable, elevation-free, and gap-bridged sequences", () => {
  const steep = buildRideTimingSummary(rideRecord(pointsFromIntervals(repeatedIntervals(180, 6, { grade: 0.02 }))));
  const variable = buildRideTimingSummary(rideRecord(pointsFromIntervals(
    Array.from({ length: 180 }, (_, index) => ({ durationS: 1, speedMps: index % 2 === 0 ? 5 : 7 })),
  )));
  const noElevation = buildRideTimingSummary(rideRecord(pointsFromIntervals(repeatedIntervals(180, 6, { elevation: false }))));
  const withGap = buildRideTimingSummary(rideRecord(pointsFromIntervals([
    ...repeatedIntervals(70, 6),
    { durationS: 20, speedMps: 6 },
    ...repeatedIntervals(70, 6),
  ])));

  assert.equal(steep.cruiseSegments.length, 0);
  assert.equal(variable.cruiseSegments.length, 0);
  assert.equal(noElevation.cruiseSegments.length, 0);
  assert.equal(withGap.cruiseSegments.length, 0);
});

test("untimed records report timing as unavailable", () => {
  const record = rideRecord([{ sequence: 0, distanceM: 0 }, { sequence: 1, distanceM: 100 }], {
    elapsedTimeS: undefined,
    movingTimeS: undefined,
  });
  record.series.timeBasis = { kind: "none" };
  const timing = buildRideTimingSummary(record);

  assert.equal(timing.source, "unavailable");
  assert.equal(timing.elapsedTimeS, undefined);
  assert.deepEqual(timing.cruiseSegments, []);
});

test("view model exposes timing metrics, cruise locations, and speed-chart highlights without AI claims", () => {
  const record = rideRecord(pointsFromIntervals(repeatedIntervals(180, 6)));
  const validation = validateRideRecord(record);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  const view = buildRidePageViewModelFromRecord(record);
  const speedSection = view.detailSections.find((section) => section.key === "speed");
  const timingSection = view.detailSections.find((section) => section.key === "timing");
  const cruiseSection = view.detailSections.find((section) => section.key === "cruise");
  const speedChart = view.visuals.charts.find((chart) => chart.key === "speed");

  assert.deepEqual(speedSection?.metrics.map((metric) => metric.label), [
    "总均速",
    "移动均速",
  ]);
  assert.deepEqual(timingSection?.metrics.map((metric) => metric.label), [
    "总时间",
    "骑行时间",
    "停歇",
  ]);
  assert.deepEqual(cruiseSection?.metrics.map((metric) => metric.label), [
    "巡航时长",
    "巡航距离",
    "巡航均速",
  ]);
  assert.ok([speedSection, timingSection, cruiseSection]
    .flatMap((section) => section?.metrics ?? [])
    .every((metric) => metric.claimId.startsWith("display:")));
  assert.equal(timingSection?.metrics.find((metric) => metric.label === "停歇")?.value, "0秒");
  assert.ok(!speedSection?.metrics.some((metric) => metric.label === "平均速度"));
  assert.equal(view.timing.cruiseSegments.length, 1);
  assert.match(view.timing.cruiseSegments[0]?.timeRangeLabel ?? "", /^\d{2}:\d{2}–\d{2}:\d{2}$/);
  assert.equal(speedChart?.cruiseHighlights.length, 1);
});
