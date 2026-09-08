import assert from "node:assert/strict";
import test from "node:test";

import { deriveRouteMatchKey } from "../src/domain/route-match-key.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

const CELL = 0.125;
/** 网格中心附近的三格折线路线（保证噪声不跨格）。 */
const SHAPE_POINTS: Array<{ x: number; y: number }> = [
  { x: 0.0625, y: 0.0625 },
  { x: 0.0625, y: 0.3125 },
  { x: 0.0625, y: 0.5625 },
  { x: 0.1875, y: 0.6875 },
  { x: 0.4375, y: 0.6875 },
  { x: 0.6875, y: 0.6875 },
  { x: 0.6875, y: 0.4375 },
  { x: 0.6875, y: 0.1875 },
  { x: 0.4375, y: 0.0625 },
];

function buildRecord(options: {
  rideId?: string;
  points?: Array<{ x: number; y: number }>;
  distanceM?: number;
  sport?: "cycling" | "indoor_cycling";
}): RideRecord {
  const { rideId = "route-key-ride", points = SHAPE_POINTS, distanceM = 25_000, sport = "cycling" } = options;
  return {
    activity: {
      schemaVersion: "0.2",
      rideId,
      sport,
      source: { kind: "fit", parserVersion: "test" },
      startTime: "2026-09-01T08:00:00Z",
      metrics: {
        distanceM: {
          value: distanceM,
          unit: "m",
          provenance: "recorded",
          confidence: "high",
          evidenceId: `${rideId}:distance`,
          sourceField: "distance",
          sourceUnit: "m",
          qualityStatus: "valid",
        },
      },
      sensorQuality: {},
      sourceIssues: [],
    },
    series: {
      schemaVersion: "0.1",
      rideId,
      source: { kind: "fit", parserVersion: "test" },
      coordinateSpace: "relative_normalized",
      privacy: { ruleVersion: "relative-route-v0.1", preciseCoordinatesExcluded: true },
      availableSeries: ["route"],
      seriesMetadata: {},
      timeBasis: { kind: "elapsed_from_start", startTime: "2026-09-01T08:00:00Z" },
      points: points.map((point, index) => ({ sequence: index, route: point })),
    },
  };
}

test("same route and distance derive a stable route key", () => {
  const first = deriveRouteMatchKey(buildRecord({ rideId: "a" }));
  const second = deriveRouteMatchKey(buildRecord({ rideId: "b" }));
  assert.ok(first);
  assert.equal(first, second);
  assert.match(first!, /^route-match-key-v0\.1:8:/);
});

test("gps noise within a grid cell keeps the same route key", () => {
  const noisy = SHAPE_POINTS.map((point) => ({
    x: point.x + (point.x < 0.5 ? 0.01 : -0.01),
    y: point.y + (point.y < 0.5 ? 0.01 : -0.01),
  }));
  assert.equal(
    deriveRouteMatchKey(buildRecord({ points: noisy })),
    deriveRouteMatchKey(buildRecord({})),
  );
});

test("a loop recorded from a different start point keeps the same route key", () => {
  const loop = [...SHAPE_POINTS, SHAPE_POINTS[0]!];
  const shifted = [...loop.slice(4), ...loop.slice(0, 4)];
  assert.equal(
    deriveRouteMatchKey(buildRecord({ points: shifted })),
    deriveRouteMatchKey(buildRecord({ points: loop })),
  );
});

test("different distance buckets and shapes produce different route keys", () => {
  const base = deriveRouteMatchKey(buildRecord({}));
  const longerDistance = deriveRouteMatchKey(buildRecord({ distanceM: 45_000 }));
  const differentShape = deriveRouteMatchKey(buildRecord({
    points: SHAPE_POINTS.map((point) => ({ x: 1 - point.x, y: point.y })),
  }));
  assert.notEqual(base, longerDistance);
  assert.notEqual(base, differentShape);
});

test("routes without enough points or valid distance have no route key", () => {
  assert.equal(deriveRouteMatchKey(buildRecord({ points: SHAPE_POINTS.slice(0, 7) })), undefined);
  assert.equal(deriveRouteMatchKey(buildRecord({ points: SHAPE_POINTS.map(() => ({ x: 0.0625, y: 0.0625 })) })), undefined);
  const invalid = buildRecord({});
  invalid.activity.metrics.distanceM!.qualityStatus = "degraded";
  assert.equal(deriveRouteMatchKey(invalid), undefined);
  const noDistance = buildRecord({});
  delete noDistance.activity.metrics.distanceM;
  assert.equal(deriveRouteMatchKey(noDistance), undefined);
});
