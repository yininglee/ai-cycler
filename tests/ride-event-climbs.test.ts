import assert from "node:assert/strict";
import test from "node:test";

import { RIDE_ELEVATION_RULES_VERSION, type RideElevationPoint, type RideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import { RIDE_ROUTE_SHAPE_RULES_VERSION, type RideRouteShapeSegment, type RideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

function elevation(points: RideElevationPoint[][]): RideElevationSummary {
  return {
    rulesVersion: RIDE_ELEVATION_RULES_VERSION,
    gainSource: "rule_calculated",
    lossSource: "rule_calculated",
    smoothedSegments: points,
    smoothedPoints: points.flat(),
  };
}

function route(segments: RideRouteShapeSegment[]): RideRouteShapeSummary {
  return {
    rulesVersion: RIDE_ROUTE_SHAPE_RULES_VERSION,
    isAvailable: true,
    gradeSegments: [],
    displayGradeSegments: [],
    trendSegments: segments,
    segments,
    movingDistanceM: segments.reduce((total, segment) => total + segment.distanceM, 0),
    classifiedDistanceM: segments.reduce((total, segment) => total + segment.distanceM, 0),
    climbDistanceM: segments.filter((segment) => segment.type === "climb").reduce((total, segment) => total + segment.distanceM, 0),
    flatDistanceM: 0,
    descentDistanceM: 0,
    trendClimbDistanceM: segments.filter((segment) => segment.type === "climb").reduce((total, segment) => total + segment.distanceM, 0),
    trendFlatDistanceM: 0,
    trendDescentDistanceM: 0,
    trendClassifiedDistanceM: segments.reduce((total, segment) => total + segment.distanceM, 0),
    coverageRatio: 1,
    needsCoverageNotice: false,
  };
}

function climbSegment(distanceM: number): RideRouteShapeSegment {
  return { type: "climb", startDistanceM: 0, endDistanceM: distanceM, distanceM };
}

function pointsFor(distanceM: number, grade: number, options: { timed?: boolean; speed?: boolean } = {}): RideElevationPoint[] {
  const endElevationM = 100 + distanceM * grade;
  return [
    { distanceM: 0, elevationM: 100, ...(options.timed === false ? {} : { elapsedTimeS: 0 }), ...(options.speed === false ? {} : { speedMps: 5 }) },
    { distanceM, elevationM: endElevationM, ...(options.timed === false ? {} : { elapsedTimeS: distanceM / 5 }), ...(options.speed === false ? {} : { speedMps: 5 }) },
  ];
}

function climbForScore(score: number) {
  const distanceM = 2_000;
  const grade = Math.sqrt(score / 2) / 100;
  return buildRideEventClimbSummary(elevation([pointsFor(distanceM, grade)]), route([climbSegment(distanceM)])).climbs[0]!;
}

test("accepts only continuous climb segments longer than 1km and steeper than 1.3 percent", () => {
  const exactDistance = buildRideEventClimbSummary(elevation([pointsFor(1_000, 0.05)]), route([climbSegment(1_000)]));
  const exactGrade = buildRideEventClimbSummary(elevation([pointsFor(1_001, 0.013)]), route([climbSegment(1_001)]));
  const valid = buildRideEventClimbSummary(elevation([pointsFor(1_001, 0.0131)]), route([climbSegment(1_001)]));

  assert.deepEqual(exactDistance.climbs, []);
  assert.deepEqual(exactGrade.climbs, []);
  assert.equal(valid.climbs.length, 1);
  assert.equal(valid.climbs[0]?.category, "4");
});

test("maps the ASO score bands to the confirmed event categories", () => {
  assert.equal(climbForScore(74.9).category, "4");
  assert.equal(climbForScore(75).category, "3");
  assert.equal(climbForScore(150).category, "2");
  assert.equal(climbForScore(300).category, "1");
  assert.equal(climbForScore(600).category, "HC");
});

test("uses net smoothed elevation, retains time and moving speed separately, and does not bridge a gap", () => {
  const timed = buildRideEventClimbSummary(elevation([pointsFor(1_500, 0.05)]), route([climbSegment(1_500)])).climbs[0]!;
  const untimed = buildRideEventClimbSummary(elevation([pointsFor(1_500, 0.05, { timed: false, speed: false })]), route([climbSegment(1_500)])).climbs[0]!;
  const gapped = buildRideEventClimbSummary(elevation([
    pointsFor(800, 0.05),
    pointsFor(800, 0.05),
  ]), route([climbSegment(1_600)]));

  assert.equal(timed.netElevationGainM, 75);
  assert.equal(timed.elapsedTimeS, 300);
  assert.equal(timed.movingAverageSpeedMps, 5);
  assert.equal(untimed.elapsedTimeS, undefined);
  assert.equal(untimed.movingAverageSpeedMps, undefined);
  assert.deepEqual(untimed.unavailableReasons, ["TIME_UNAVAILABLE", "MOVING_SPEED_UNAVAILABLE"]);
  assert.deepEqual(gapped.climbs, []);
});

test("keeps all valid climbs in route order without ranking or trimming", () => {
  const first = { type: "climb" as const, startDistanceM: 0, endDistanceM: 1_500, distanceM: 1_500 };
  const second = { type: "climb" as const, startDistanceM: 2_000, endDistanceM: 3_500, distanceM: 1_500 };
  const result = buildRideEventClimbSummary(elevation([
    pointsFor(1_500, 0.04),
    pointsFor(1_500, 0.08).map((point) => ({ ...point, distanceM: point.distanceM + 2_000 })),
  ]), route([first, second]));

  assert.deepEqual(result.climbs.map((climb) => climb.startDistanceM), [0, 2_000]);
  assert.equal(result.climbs.length, 2);
});

test("does not turn a climb with insufficient net gain after a rollback into a classified climb", () => {
  const result = buildRideEventClimbSummary(
    elevation([[
      { distanceM: 0, elevationM: 100, elapsedTimeS: 0, speedMps: 5 },
      { distanceM: 1_200, elevationM: 130, elapsedTimeS: 240, speedMps: 5 },
      { distanceM: 1_500, elevationM: 119, elapsedTimeS: 300, speedMps: 5 },
    ]]),
    route([{ type: "climb", startDistanceM: 0, endDistanceM: 1_500, distanceM: 1_500 }]),
  );

  assert.deepEqual(result.climbs, []);
});

test("uses both length and grade in the ASO score", () => {
  const longGentle = buildRideEventClimbSummary(
    elevation([pointsFor(5_000, 0.02)]),
    route([climbSegment(5_000)]),
  ).climbs[0]!;
  const shortSteep = buildRideEventClimbSummary(
    elevation([pointsFor(1_500, 0.06)]),
    route([climbSegment(1_500)]),
  ).climbs[0]!;

  assert.equal(longGentle.difficultyScore, 20);
  assert.equal(longGentle.category, "4");
  assert.equal(shortSteep.difficultyScore, 54);
  assert.equal(shortSteep.category, "4");
  assert.ok(shortSteep.difficultyScore > longGentle.difficultyScore);
});

test("adds quality-gated average heart rate and power for each climb", () => {
  const points = [0, 500, 1_000, 1_500].map((distanceM, sequence) => ({
    sequence,
    elapsedTimeS: sequence * 5,
    distanceM,
    elevationM: 100 + distanceM * 0.05,
    speedMps: 5,
    heartRateBpm: 140 + sequence * 10,
    powerW: 180 + sequence * 20,
  }));
  const record: RideRecord = {
    activity: {
      schemaVersion: "0.2",
      rideId: "climb-stats",
      sport: "cycling",
      source: { kind: "sample", parserVersion: "test" },
      metrics: {},
      sensorQuality: {
        heart_rate: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
      },
      sourceIssues: [],
    },
    series: {
      schemaVersion: "0.1",
      rideId: "climb-stats",
      source: { kind: "sample", parserVersion: "test" },
      coordinateSpace: "relative_normalized",
      privacy: { ruleVersion: "relative-route-v0.1", preciseCoordinatesExcluded: true },
      availableSeries: ["distance", "elevation", "speed", "heart_rate", "power"],
      seriesMetadata: {},
      timeBasis: { kind: "none" },
      points,
    },
  };
  const result = buildRideEventClimbSummary(
    elevation([pointsFor(1_500, 0.05)]),
    route([climbSegment(1_500)]),
    record,
  );
  assert.equal(result.climbs[0]?.averageHeartRateBpm, 150);
  assert.equal(result.climbs[0]?.averagePowerW, 200);
  assert.equal(result.climbs[0]?.powerQuality, "hard");
});
