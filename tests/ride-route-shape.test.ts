import assert from "node:assert/strict";
import test from "node:test";

import { RIDE_ELEVATION_RULES_VERSION, type RideElevationPoint, type RideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRidePageViewModel } from "../src/ui/ride-view-model.ts";

function summary(segments: RideElevationPoint[][]): RideElevationSummary {
  const smoothedPoints = segments.flat();
  return {
    rulesVersion: RIDE_ELEVATION_RULES_VERSION,
    gainSource: "rule_calculated",
    lossSource: "rule_calculated",
    smoothedSegments: segments,
    smoothedPoints,
  };
}

function segmentFromGrades(
  grades: number[],
  options: { startDistanceM?: number; startElevationM?: number; distanceStepM?: number; moving?: boolean } = {},
): RideElevationPoint[] {
  const distanceStepM = options.distanceStepM ?? 25;
  let distanceM = options.startDistanceM ?? 0;
  let elevationM = options.startElevationM ?? 100;
  const points: RideElevationPoint[] = [{ distanceM, elevationM, ...(options.moving === false ? {} : { speedMps: 5 }) }];
  for (const grade of grades) {
    distanceM += distanceStepM;
    elevationM += distanceStepM * grade;
    points.push({ distanceM, elevationM, ...(options.moving === false ? {} : { speedMps: 5 }) });
  }
  return points;
}

test("calculates 100m centered grades with a 60m end-window minimum", () => {
  const route = buildRideRouteShapeSummary(summary([segmentFromGrades(Array(16).fill(0.04))]));

  assert.equal(route.isAvailable, true);
  assert.ok(route.gradeSegments[0]!.every((point) => Math.abs(point.grade - 0.04) < 0.0001));
  assert.equal(route.gradeSegments[0]![0]!.distanceM, 25);
  assert.equal(route.climbDistanceM, 400);
});

test("uses an independent 250m centered grade window for the chart display", () => {
  const route = buildRideRouteShapeSummary(summary([
    segmentFromGrades([...Array(4).fill(0.1), ...Array(12).fill(0)]),
  ]));
  const classificationGrade = route.gradeSegments.flat().find((point) => point.distanceM === 100)?.grade;
  const displayGrade = route.displayGradeSegments.flat().find((point) => point.distanceM === 100)?.grade;

  assert.ok(classificationGrade !== undefined);
  assert.ok(displayGrade !== undefined);
  assert.ok(Math.abs(classificationGrade - 0.05) < 0.0001);
  assert.ok(Math.abs(displayGrade - (10 / 225)) < 0.0001);
  assert.notEqual(classificationGrade, displayGrade);
});

test("enters at 3%, retains a climb through the 2% hysteresis band, then exits below 2%", () => {
  const grades = [
    ...Array(12).fill(0.035),
    ...Array(12).fill(0.025),
    ...Array(12).fill(0.015),
  ];
  const route = buildRideRouteShapeSummary(summary([segmentFromGrades(grades)]));

  assert.equal(route.isAvailable, true);
  assert.ok(route.climbDistanceM > 0);
  assert.ok(route.flatDistanceM > 0);
  assert.equal(route.descentDistanceM, 0);
});

test("long-trend terrain keeps a short platform inside one climb while local segments remain granular", () => {
  const route = buildRideRouteShapeSummary(summary([
    segmentFromGrades([
      ...Array(20).fill(0.04),
      ...Array(4).fill(0),
      ...Array(20).fill(0.04),
    ]),
  ]));

  assert.ok(route.segments.some((segment) => segment.type === "climb"));
  const trendClimbs = route.trendSegments.filter((segment) => segment.type === "climb");
  assert.equal(trendClimbs.length, 1);
  assert.ok(trendClimbs[0]!.distanceM > 900);
  assert.equal(route.trendClimbDistanceM, trendClimbs[0]!.distanceM);
});

test("long-trend terrain exits after a sustained neutral section", () => {
  const route = buildRideRouteShapeSummary(summary([
    segmentFromGrades([
      ...Array(20).fill(0.02),
      ...Array(24).fill(0),
      ...Array(20).fill(0.02),
    ]),
  ]));

  assert.ok(route.trendSegments.filter((segment) => segment.type === "climb").length >= 2);
  assert.ok(route.trendFlatDistanceM > 0);
});

test("merges a sub-100m sandwich fragment only when its two neighbors have the same type", () => {
  const climbFlatClimb = buildRideRouteShapeSummary(summary([
    segmentFromGrades([...Array(12).fill(0.04), ...Array(2).fill(0), ...Array(12).fill(0.04)]),
  ]));
  const climbFlatDescent = buildRideRouteShapeSummary(summary([
    segmentFromGrades([...Array(12).fill(0.04), ...Array(2).fill(0), ...Array(12).fill(-0.04)]),
  ]));

  assert.equal(climbFlatClimb.segments.every((segment) => segment.type === "climb"), true);
  assert.ok(climbFlatDescent.segments.some((segment) => segment.type === "flat"));
  assert.ok(climbFlatDescent.segments.some((segment) => segment.type === "descent"));
});

test("does not bridge route-shape segments over a data gap and does not treat a stop as a terrain break", () => {
  const first = segmentFromGrades(Array(12).fill(0.04));
  const second = segmentFromGrades(Array(12).fill(0.04), { startDistanceM: 300, startElevationM: 140 });
  const gapped = buildRideRouteShapeSummary(summary([first, second]));
  const stopped = segmentFromGrades(Array(12).fill(0.04));
  stopped.splice(5, 0,
    { distanceM: stopped[4]!.distanceM, elevationM: stopped[4]!.elevationM, speedMps: 0 },
    { distanceM: stopped[4]!.distanceM, elevationM: stopped[4]!.elevationM, speedMps: 0 },
  );
  const withStop = buildRideRouteShapeSummary(summary([stopped]));

  assert.equal(gapped.segments.length, 2);
  assert.equal(gapped.segments.every((segment) => segment.type === "climb"), true);
  assert.equal(withStop.isAvailable, true);
  assert.equal(withStop.segments.length, 1);
  assert.equal(withStop.segments[0]!.type, "climb");
});

test("keeps short route-end fragments and distance-reversal boundaries separate", () => {
  const edgeFragment = buildRideRouteShapeSummary(summary([
    segmentFromGrades([...Array(12).fill(0.04), ...Array(2).fill(0)]),
  ]));
  const beforeReversal = segmentFromGrades(Array(12).fill(0.04));
  const afterReversal = segmentFromGrades(Array(12).fill(0.04), { startDistanceM: 200, startElevationM: 132 });
  const reversed = buildRideRouteShapeSummary(summary([beforeReversal, afterReversal]));

  assert.equal(edgeFragment.segments.at(-1)?.type, "flat");
  assert.ok(edgeFragment.segments.at(-1)!.distanceM < 100);
  assert.equal(reversed.segments.length, 2);
  assert.equal(reversed.segments.every((segment) => segment.type === "climb"), true);
});

test("hides the route-shape result when movement status cannot support 80% classified coverage", () => {
  const route = buildRideRouteShapeSummary(summary([
    segmentFromGrades(Array(12).fill(0.04), { moving: false }),
  ]));

  assert.equal(route.isAvailable, false);
  assert.deepEqual(route.segments, []);
  assert.equal(route.coverageRatio, 0);
});

test("view model places only flat and climb distance in the data-page distance group", () => {
  const view = buildRidePageViewModel("l1-built-in-sample");
  const distance = view.detailSections.find((section) => section.key === "distance");

  assert.deepEqual(distance?.metrics.map((metric) => metric.label), ["距离", "平路里程", "爬坡里程"]);
  assert.ok(view.visuals.routeShape);
  assert.equal(view.visuals.routeShape?.gradeChart.key, "grade");
});
