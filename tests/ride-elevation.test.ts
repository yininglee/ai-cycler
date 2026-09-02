import assert from "node:assert/strict";
import test from "node:test";

import type { DataSourceKind, Metric, RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import { buildRideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { buildRideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import { buildRidePageViewModelFromRecord } from "../src/ui/ride-view-model.ts";

const START_TIME = "2026-08-29T06:00:00.000Z";

function metric(value: number, sourceField: string, provenance: Metric["provenance"] = "calculated"): Metric {
  return {
    value,
    unit: "m",
    provenance,
    confidence: "high",
    evidenceId: `evidence:${sourceField}`,
    sourceField,
    sourceUnit: "m",
    qualityStatus: "valid",
    recordedAt: START_TIME,
    ...(provenance === "calculated" ? { formulaVersion: "test-v0.1" } : {}),
  };
}

function record(
  points: Array<{ distanceM?: number; elevationM?: number; elapsedTimeS?: number }>,
  options: { sourceKind?: DataSourceKind; gain?: Metric; loss?: Metric } = {},
): RideRecord {
  const sourceKind = options.sourceKind ?? "gpx";
  const parserVersion = "elevation-test-parser-v0.1";
  const seriesPoints: RideSeriesPoint[] = points.map((point, sequence) => ({ sequence, ...point }));
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "ride-elevation-test",
      sport: "cycling",
      source: {
        kind: sourceKind,
        parserVersion,
        ...(sourceKind === "fit" ? { fileName: "elevation-test.fit" } : sourceKind === "gpx" ? { fileName: "elevation-test.gpx" } : {}),
      },
      startTime: START_TIME,
      metrics: {
        distanceM: metric(points.at(-1)?.distanceM ?? 0, "track.distance"),
        ...(options.gain ? { elevationGainM: options.gain } : {}),
        ...(options.loss ? { elevationLossM: options.loss } : {}),
      },
      sensorQuality: { gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 } },
      sourceIssues: [],
    },
    series: buildRideSeries({
      rideId: "ride-elevation-test",
      sourceKind,
      parserVersion,
      startTime: START_TIME,
      points: seriesPoints,
    }),
  };
}

test("trusted FIT ascent and descent aggregates take precedence while retaining calibration", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 108 },
    { distanceM: 60, elevationM: 102 },
  ], {
    sourceKind: "fit",
    gain: metric(42, "session.total_ascent", "recorded"),
    loss: metric(17, "session.total_descent", "recorded"),
  }));

  assert.equal(result.gainM, 42);
  assert.equal(result.lossM, 17);
  assert.equal(result.gainSource, "device_recorded");
  assert.equal(result.lossSource, "device_recorded");
  assert.equal(result.gainCalibration?.needsReview, true);
});

test("GPX recomputes ascent and descent symmetrically after smoothing", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 20, elevationM: 104 },
    { distanceM: 40, elevationM: 108 },
    { distanceM: 60, elevationM: 104 },
    { distanceM: 80, elevationM: 100 },
  ]));

  assert.equal(result.gainM, 8);
  assert.equal(result.lossM, 8);
  assert.equal(result.gainSource, "rule_calculated");
  assert.equal(result.lossSource, "rule_calculated");
});

test("30m centered median smoothing removes an isolated elevation spike", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 10, elevationM: 100 },
    { distanceM: 20, elevationM: 180 },
    { distanceM: 30, elevationM: 100 },
    { distanceM: 40, elevationM: 100 },
  ]));

  assert.deepEqual(result.smoothedPoints.map((point) => point.elevationM), [100, 100, 100, 100, 100]);
  assert.equal(result.maxM, 100);
  assert.equal(result.gainM, 0);
});

test("3m hysteresis ignores micro-oscillation but retains sustained direction changes", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 20, elevationM: 101 },
    { distanceM: 40, elevationM: 99 },
    { distanceM: 60, elevationM: 102 },
    { distanceM: 80, elevationM: 106 },
    { distanceM: 100, elevationM: 100 },
  ]));

  assert.equal(result.gainM, 6);
  assert.equal(result.lossM, 6);
});

test("missing elevation, long gaps, and distance reversals split calculation instead of bridging terrain", () => {
  const missing = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 106 },
    { distanceM: 60 },
    { distanceM: 90, elevationM: 160 },
    { distanceM: 120, elevationM: 166 },
  ]));
  const gap = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 106 },
    { distanceM: 700, elevationM: 160 },
    { distanceM: 730, elevationM: 166 },
  ]));
  const reversed = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 106 },
    { distanceM: 20, elevationM: 160 },
    { distanceM: 50, elevationM: 166 },
  ]));

  assert.equal(missing.gainM, 12);
  assert.equal(gap.gainM, 12);
  assert.equal(reversed.gainM, 12);
});

test("cuts an elevation step before smoothing so grade and route shape cannot bridge it", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100, elapsedTimeS: 0 },
    { distanceM: 30, elevationM: 103, elapsedTimeS: 6 },
    { distanceM: 60, elevationM: 106, elapsedTimeS: 12 },
    { distanceM: 90, elevationM: 109, elapsedTimeS: 18 },
    { distanceM: 120, elevationM: 112, elapsedTimeS: 24 },
    { distanceM: 157, elevationM: 281, elapsedTimeS: 31 },
    { distanceM: 187, elevationM: 284, elapsedTimeS: 37 },
    { distanceM: 217, elevationM: 287, elapsedTimeS: 43 },
    { distanceM: 247, elevationM: 290, elapsedTimeS: 49 },
    { distanceM: 277, elevationM: 293, elapsedTimeS: 55 },
  ]));
  const routeShape = buildRideRouteShapeSummary(result);

  assert.deepEqual(result.smoothedSegments.map((segment) => segment.length), [5, 5]);
  assert.equal(result.smoothedSegments[0]!.at(-1)?.distanceM, 120);
  assert.equal(result.smoothedSegments[1]![0]?.distanceM, 157);
  assert.equal(routeShape.gradeSegments.length, 2);
  assert.ok(routeShape.gradeSegments.flat().every((point) => Math.abs(point.grade) < 0.2));
});

test("keeps a valid short steep section below the 80 percent step threshold", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 123 },
    { distanceM: 60, elevationM: 146 },
    { distanceM: 90, elevationM: 169 },
  ]));

  assert.deepEqual(result.smoothedSegments.map((segment) => segment.length), [4]);
});

test("isolates a cumulative elevation anomaly and its recovered corridor before smoothing", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100, elapsedTimeS: 0 },
    { distanceM: 25, elevationM: 102, elapsedTimeS: 5 },
    { distanceM: 50, elevationM: 104, elapsedTimeS: 10 },
    { distanceM: 75, elevationM: 106, elapsedTimeS: 15 },
    { distanceM: 100, elevationM: 108, elapsedTimeS: 20 },
    { distanceM: 125, elevationM: 110, elapsedTimeS: 25 },
    { distanceM: 150, elevationM: 80, elapsedTimeS: 30 },
    { distanceM: 175, elevationM: 70, elapsedTimeS: 35 },
    { distanceM: 200, elevationM: 70, elapsedTimeS: 40 },
    { distanceM: 225, elevationM: 80, elapsedTimeS: 45 },
    { distanceM: 250, elevationM: 90, elapsedTimeS: 50 },
    { distanceM: 275, elevationM: 100, elapsedTimeS: 55 },
    { distanceM: 300, elevationM: 110, elapsedTimeS: 60 },
    { distanceM: 325, elevationM: 111, elapsedTimeS: 65 },
    { distanceM: 350, elevationM: 112, elapsedTimeS: 70 },
    { distanceM: 375, elevationM: 114, elapsedTimeS: 75 },
    { distanceM: 400, elevationM: 116, elapsedTimeS: 80 },
    { distanceM: 425, elevationM: 118, elapsedTimeS: 85 },
  ]));
  const routeShape = buildRideRouteShapeSummary(result);

  assert.deepEqual(result.smoothedSegments.map((segment) => segment.length), [4, 4]);
  assert.ok(result.smoothedPoints.every((point) => point.distanceM < 100 || point.distanceM > 325));
  assert.equal(routeShape.gradeSegments.length, 2);
  assert.ok(routeShape.gradeSegments.flat().every((point) => Math.abs(point.grade) < 0.2));
});

test("does not isolate a steep section without an opposite-direction recovery", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 25, elevationM: 102 },
    { distanceM: 50, elevationM: 104 },
    { distanceM: 75, elevationM: 106 },
    { distanceM: 100, elevationM: 108 },
    { distanceM: 125, elevationM: 110 },
    { distanceM: 150, elevationM: 95 },
    { distanceM: 175, elevationM: 80 },
    { distanceM: 200, elevationM: 65 },
    { distanceM: 225, elevationM: 50 },
  ]));

  assert.deepEqual(result.smoothedSegments.map((segment) => segment.length), [10]);
});

test("cuts consecutive elevation steps without retaining an unreliable bridge", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 105 },
    { distanceM: 60, elevationM: 200 },
    { distanceM: 90, elevationM: 300 },
    { distanceM: 120, elevationM: 305 },
    { distanceM: 150, elevationM: 310 },
    { distanceM: 180, elevationM: 315 },
  ]));

  assert.deepEqual(result.smoothedSegments.map((segment) => segment.length), [2, 3]);
  assert.equal(result.smoothedSegments.some((segment) => segment.some((point) => point.distanceM === 60 || point.distanceM === 90)), false);
});

test("an elevation step does not alter trusted device ascent or descent", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 105 },
    { distanceM: 67, elevationM: 274 },
    { distanceM: 97, elevationM: 279 },
  ], {
    sourceKind: "fit",
    gain: metric(42, "session.total_ascent", "recorded"),
    loss: metric(17, "session.total_descent", "recorded"),
  }));

  assert.equal(result.gainM, 42);
  assert.equal(result.lossM, 17);
  assert.equal(result.gainSource, "device_recorded");
  assert.equal(result.lossSource, "device_recorded");
});

test("extrema remain available from the smooth sequence even when only one aggregate is device-recorded", () => {
  const result = buildRideElevationSummary(record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 110 },
    { distanceM: 60, elevationM: 105 },
  ], {
    sourceKind: "fit",
    gain: metric(16, "session.total_ascent", "recorded"),
  }));

  assert.equal(result.gainM, 16);
  assert.equal(result.lossM, 5);
  assert.equal(result.minM, 100);
  assert.equal(result.maxM, 110);
  assert.equal(result.rangeM, 10);
});

test("view model exposes only derived elevation display facts and smooth elevation chart", () => {
  const view = buildRidePageViewModelFromRecord(record([
    { distanceM: 0, elevationM: 100, elapsedTimeS: 0 },
    { distanceM: 30, elevationM: 108, elapsedTimeS: 5 },
    { distanceM: 60, elevationM: 102, elapsedTimeS: 10 },
  ]));
  const elevationSection = view.detailSections.find((section) => section.key === "elevation");
  const elevationChart = view.visuals.charts.find((chart) => chart.key === "elevation");

  assert.deepEqual(elevationSection?.metrics.map((item) => item.label), ["累计爬升", "累计下降", "最高海拔", "最低海拔", "海拔范围"]);
  assert.ok(elevationSection?.metrics.every((item) => item.claimId.startsWith("display:")));
  assert.equal(elevationChart?.axisLabel, "骑行距离");
  assert.equal(elevationChart?.sampleCount, 3);
});

test("elevation gaps remain chart breaks and new facts stay outside the AI context", () => {
  const ride = record([
    { distanceM: 0, elevationM: 100 },
    { distanceM: 30, elevationM: 106 },
    { distanceM: 700, elevationM: 160 },
    { distanceM: 730, elevationM: 166 },
  ], {
    sourceKind: "fit",
    loss: metric(8, "session.total_descent", "recorded"),
  });
  const view = buildRidePageViewModelFromRecord(ride);
  const context = buildRideAnalysisContext(ride);
  const elevationChart = view.visuals.charts.find((chart) => chart.key === "elevation");

  assert.equal((elevationChart?.path.match(/M /g) ?? []).length, 2);
  assert.equal(context.recordedMetrics.elevationLossM, undefined);
  assert.equal(context.allowedClaims.some((claim) => claim.key === "elevationLossM"), false);
});
