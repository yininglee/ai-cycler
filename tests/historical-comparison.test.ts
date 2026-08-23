import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COMPARISON_WINDOW_DAYS,
  FixtureHistoryQueryService,
  buildHistoricalComparisonSnapshot,
  validateHistoricalComparisonSnapshot,
  type HistoricalRide,
} from "../src/domain/historical-comparison.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function ride(fixtureId: string, historyId: string, startTime: string, routeKey = "route-a"): HistoricalRide {
  const fixture = getRideFixture(fixtureId);
  const record: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  record.activity.rideId = historyId;
  record.series.rideId = historyId;
  record.activity.startTime = startTime;
  for (const metric of Object.values(record.activity.metrics)) {
    if (metric) metric.recordedAt = startTime;
  }
  record.series.timeBasis = record.series.timeBasis.kind === "elapsed_from_start"
    ? { kind: "elapsed_from_start", startTime }
    : record.series.timeBasis;
  return { metadata: { historyId, routeKey, deviceKey: "device-a", sceneKey: "outdoor" }, record };
}

test("history snapshot computes a fixed-window baseline and claim-backed change", () => {
  const anchor = ride("l3-built-in-sample", "anchor", "2026-08-20T08:00:00Z");
  const previous = ride("l3-built-in-sample", "previous-1", "2026-08-15T08:00:00Z");
  previous.record.activity.metrics.avgSpeedMps!.value = 6;
  const previousTwo = ride("l3-built-in-sample", "previous-2", "2026-08-10T08:00:00Z");
  previousTwo.record.activity.metrics.avgSpeedMps!.value = 5;
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [anchor, previous, previousTwo], {
    metricKeys: ["avgSpeedMps"],
    windowDays: 30,
    routeScope: "same_route",
    timeZone: "Asia/Shanghai",
  });
  const metric = snapshot.metrics[0]!;
  assert.equal(snapshot.schemaVersion, "0.1");
  assert.equal(snapshot.range.windowDays, 30);
  assert.equal(snapshot.candidateHistoryIds.length, 2);
  assert.equal(metric.comparability.status, "comparable");
  assert.equal(metric.baseline?.sampleCount, 2);
  assert.ok(metric.relativeChange);
  assert.equal(metric.claimIds.length, 1);
  assert.equal(snapshot.sameRoute.comparability.status, "comparable");
  assert.equal(validateHistoricalComparisonSnapshot(snapshot).valid, true);
});

test("first ride and insufficient history stay silent-compatible without trend claims", () => {
  const anchor = ride("l2-built-in-sample", "anchor", "2026-08-20T08:00:00Z");
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [], { metricKeys: ["avgHeartRateBpm"] });
  const metric = snapshot.metrics[0]!;
  assert.equal(snapshot.comparability.status, "not_comparable");
  assert.deepEqual(metric.claimIds, []);
  assert.ok(metric.comparability.reasonCodes.includes("METRIC_MISSING"));
  assert.equal(snapshot.sameRoute.comparability.status, "not_comparable");
  assert.equal(validateHistoricalComparisonSnapshot(snapshot).valid, true);
});

test("same-route comparison requires a trusted route key and does not use relative SVG shape as identity", () => {
  const anchor = ride("l1-built-in-sample", "anchor", "2026-08-20T08:00:00Z", "route-a");
  const otherRouteOne = ride("l1-built-in-sample", "other-1", "2026-08-18T08:00:00Z", "route-b");
  const otherRouteTwo = ride("l1-built-in-sample", "other-2", "2026-08-16T08:00:00Z", "route-b");
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [otherRouteOne, otherRouteTwo], {
    metricKeys: ["distanceM"],
    routeScope: "same_route",
  });
  assert.equal(snapshot.metrics[0]?.comparability.status, "not_comparable");
  assert.ok(snapshot.metrics[0]?.comparability.reasonCodes.includes("ROUTE_NOT_MATCHED"));
  assert.equal(snapshot.sameRoute.comparability.reasonCodes.includes("ROUTE_NOT_MATCHED"), true);

  const noRoute = ride("l1-built-in-sample", "no-route", "2026-08-20T08:00:00Z", "");
  const noRouteSnapshot = buildHistoricalComparisonSnapshot(noRoute, [otherRouteOne, otherRouteTwo], { metricKeys: ["distanceM"] });
  assert.ok(noRouteSnapshot.sameRoute.comparability.reasonCodes.includes("ROUTE_KEY_MISSING"));
});

test("window and context filters exclude future, stale, different-device and different-scene records", () => {
  const anchor = ride("l3-built-in-sample", "anchor", "2026-08-20T08:00:00Z");
  const recent = ride("l3-built-in-sample", "recent", "2026-08-19T08:00:00Z");
  const stale = ride("l3-built-in-sample", "stale", "2026-07-01T08:00:00Z");
  const future = ride("l3-built-in-sample", "future", "2026-08-21T08:00:00Z");
  const differentDevice = ride("l3-built-in-sample", "device-b", "2026-08-18T08:00:00Z");
  differentDevice.metadata.deviceKey = "device-b";
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [recent, stale, future, differentDevice], {
    metricKeys: ["avgPowerW"],
    windowDays: 30,
    deviceScope: "same",
  });
  assert.deepEqual(snapshot.candidateHistoryIds, ["recent"]);
  assert.equal(snapshot.range.windowDays, DEFAULT_COMPARISON_WINDOW_DAYS);
});

test("untimed anchor cannot produce historical speed comparison", () => {
  const anchor = ride("gpx-no-timestamps", "anchor", "2026-08-20T08:00:00Z");
  anchor.record.activity.startTime = undefined;
  anchor.record.series.timeBasis = { kind: "none" };
  const previous = ride("l1-built-in-sample", "previous", "2026-08-18T08:00:00Z");
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [previous], { metricKeys: ["avgSpeedMps"] });
  assert.ok(snapshot.metrics[0]?.comparability.reasonCodes.includes("ANCHOR_TIME_MISSING"));
  assert.equal(snapshot.metrics[0]?.claimIds.length, 0);
});

test("fixture history query service returns stable not-found errors without exposing arbitrary records", () => {
  const service = new FixtureHistoryQueryService([]);
  const result = service.compare({ anchorRideId: "does-not-exist", metricKeys: ["distanceM"] });
  assert.equal(result.error, "ANCHOR_NOT_FOUND");
  assert.equal(result.snapshot.candidateHistoryIds.length, 0);
  assert.equal(validateHistoricalComparisonSnapshot(result.snapshot).valid, true);
});

test("cross-route comparisons are metric-specific: distance can change, speed requires same route, heart rate is reference-only", () => {
  const anchor = ride("l3-built-in-sample", "anchor-cross", "2026-08-20T08:00:00Z", "route-a");
  const previousOne = ride("l3-built-in-sample", "previous-cross-1", "2026-08-18T08:00:00Z", "route-b");
  const previousTwo = ride("l3-built-in-sample", "previous-cross-2", "2026-08-16T08:00:00Z", "route-c");
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [previousOne, previousTwo], {
    metricKeys: ["distanceM", "avgSpeedMps", "avgHeartRateBpm"],
    routeScope: "all",
  });
  assert.equal(snapshot.metrics.find((metric) => metric.metricKey === "distanceM")?.comparability.allowedConclusion, "change");
  assert.equal(snapshot.metrics.find((metric) => metric.metricKey === "avgSpeedMps")?.comparability.status, "not_comparable");
  assert.ok(snapshot.metrics.find((metric) => metric.metricKey === "avgSpeedMps")?.comparability.reasonCodes.includes("ROUTE_SCOPE_REQUIRED"));
  assert.equal(snapshot.metrics.find((metric) => metric.metricKey === "avgHeartRateBpm")?.comparability.allowedConclusion, "reference_change");
  assert.equal(snapshot.comparability.allowedConclusion, "change");
  assert.equal(validateHistoricalComparisonSnapshot(snapshot).valid, true);
});

test("device and scene policies tighten sensor comparisons even when candidate scope is any", () => {
  const anchor = ride("l3-built-in-sample", "anchor-context", "2026-08-20T08:00:00Z");
  const differentDevice = ride("l3-built-in-sample", "different-device", "2026-08-18T08:00:00Z");
  differentDevice.metadata.deviceKey = "device-b";
  const differentScene = ride("l3-built-in-sample", "different-scene", "2026-08-16T08:00:00Z");
  differentScene.metadata.sceneKey = "indoor-trainer";
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [differentDevice, differentScene], {
    metricKeys: ["avgPowerW", "distanceM"],
    routeScope: "all",
    deviceScope: "any",
    sceneScope: "any",
  });
  const power = snapshot.metrics.find((metric) => metric.metricKey === "avgPowerW")!;
  assert.equal(power.comparability.status, "not_comparable");
  assert.ok(power.comparability.reasonCodes.includes("SOURCE_SCOPE_REQUIRED") || power.comparability.reasonCodes.includes("SCENE_SCOPE_REQUIRED"));
  assert.equal(snapshot.metrics.find((metric) => metric.metricKey === "distanceM")?.comparability.status, "comparable");
});

test("sensor comparisons use compatible source classes rather than exact device identity", () => {
  const anchor = ride("l3-built-in-sample", "source-anchor", "2026-08-20T08:00:00Z", "route-a");
  anchor.metadata.metricSourceClass = { avgPowerW: "power-meter-family-a" };
  const previousOne = ride("l3-built-in-sample", "source-previous-1", "2026-08-18T08:00:00Z", "route-a");
  previousOne.metadata.deviceKey = "device-b";
  previousOne.metadata.metricSourceClass = { avgPowerW: "power-meter-family-a" };
  const previousTwo = ride("l3-built-in-sample", "source-previous-2", "2026-08-16T08:00:00Z", "route-a");
  previousTwo.metadata.deviceKey = "device-c";
  previousTwo.metadata.metricSourceClass = { avgPowerW: "power-meter-family-a" };
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [previousOne, previousTwo], {
    metricKeys: ["avgPowerW"],
    routeScope: "same_route",
    deviceScope: "any",
    sceneScope: "any",
  });
  assert.equal(snapshot.metrics[0]?.comparability.status, "comparable");
  assert.equal(snapshot.metrics[0]?.baseline?.sampleCount, 2);
});

test("activity energy compares by calculation method, not exact device", () => {
  const anchor = ride("l3-built-in-sample", "energy-anchor", "2026-08-20T08:00:00Z", "route-a");
  anchor.metadata.deviceKey = "device-a";
  anchor.metadata.metricMethodKey = { activityEnergyKcal: "device-energy-v1" };
  const previousOne = ride("l3-built-in-sample", "energy-previous-1", "2026-08-18T08:00:00Z", "route-b");
  previousOne.metadata.deviceKey = "device-b";
  previousOne.metadata.metricMethodKey = { activityEnergyKcal: "device-energy-v1" };
  const previousTwo = ride("l3-built-in-sample", "energy-previous-2", "2026-08-16T08:00:00Z", "route-c");
  previousTwo.metadata.deviceKey = "device-c";
  previousTwo.metadata.metricMethodKey = { activityEnergyKcal: "device-energy-v1" };
  const snapshot = buildHistoricalComparisonSnapshot(anchor, [previousOne, previousTwo], {
    metricKeys: ["activityEnergyKcal"],
    routeScope: "all",
    deviceScope: "any",
  });
  assert.equal(snapshot.metrics[0]?.comparability.status, "comparable");
  assert.equal(snapshot.metrics[0]?.comparability.allowedConclusion, "reference_change");
});
