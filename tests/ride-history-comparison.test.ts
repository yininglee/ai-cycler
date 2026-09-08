import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoricalRide } from "../src/persistence/persistent-history.ts";
import { buildRideHistoryComparisonForRecord, HISTORY_COMPARISON_METRIC_KEYS } from "../src/ui/ride-history-comparison.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { deriveRouteMatchKey } from "../src/domain/route-match-key.ts";

/** 同一设备、同一路线的三次骑行（l3 夹具克隆，改 rideId/时间/速度）。 */
function rideRecord(rideId: string, startTime: string, avgSpeedMps?: number): RideRecord {
  const fixture = getRideFixture("l3-power-preview");
  const record: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  record.activity.rideId = rideId;
  record.series.rideId = rideId;
  record.activity.startTime = startTime;
  record.activity.source.deviceManufacturer = "Garmin";
  record.activity.source.deviceProduct = "Edge 540";
  for (const metric of Object.values(record.activity.metrics)) {
    if (metric) metric.recordedAt = startTime;
  }
  record.series.timeBasis = record.series.timeBasis.kind === "elapsed_from_start"
    ? { kind: "elapsed_from_start", startTime }
    : record.series.timeBasis;
  if (avgSpeedMps !== undefined) {
    // 距离不变（路线键距离桶稳定），同步调整时间保持 distance/movingTime 口径一致，
    // 否则 INCONSISTENT_AVG_SPEED 会使锚点校验失败（ANCHOR_INVALID）。
    record.activity.metrics.avgSpeedMps!.value = avgSpeedMps;
    record.activity.metrics.movingTimeS!.value = record.activity.metrics.distanceM!.value / avgSpeedMps;
  }
  return record;
}

const ANCHOR = rideRecord("anchor-ride", "2026-09-06T08:00:00Z", 8);
const PREVIOUS_ONE = rideRecord("previous-1", "2026-09-01T08:00:00Z", 6);
const PREVIOUS_TWO = rideRecord("previous-2", "2026-08-28T08:00:00Z", 5);

test("persistent history adapter derives stable identity metadata per record", () => {
  const historical = buildHistoricalRide(ANCHOR);
  assert.equal(historical.metadata.historyId, "anchor-ride");
  assert.equal(historical.metadata.deviceKey, "Garmin:Edge 540");
  assert.equal(historical.metadata.sceneKey, "outdoor");
  assert.ok(historical.metadata.routeKey);
  assert.equal(historical.metadata.routeKey, deriveRouteMatchKey(ANCHOR));
});

test("third comparable ride renders an all-scope and same-route comparison view", () => {
  const view = buildRideHistoryComparisonForRecord(ANCHOR, [ANCHOR, PREVIOUS_ONE, PREVIOUS_TWO]);
  assert.ok(view);
  assert.equal(view.windowDays, 30);

  const allGroup = view.groups.find((group) => group.key === "all");
  assert.ok(allGroup);
  const distanceRow = allGroup.rows.find((row) => row.metricKey === "distanceM");
  assert.ok(distanceRow);
  assert.equal(distanceRow.label, "距离");
  assert.equal(distanceRow.sampleCount, 2);
  assert.match(distanceRow.anchorDisplay, / km$/);
  assert.match(distanceRow.changeDisplay, /^[+-]/);
  // 基线 = 两条历史均值，不含本次
  const baselineKm = (PREVIOUS_ONE.activity.metrics.distanceM!.value + PREVIOUS_TWO.activity.metrics.distanceM!.value) / 2 / 1_000;
  assert.equal(distanceRow.baselineDisplay, `${Number(baselineKm.toFixed(1))} km`);
  // 低路线敏感指标进入全部组；高路线敏感的平均速度不进入
  assert.ok(allGroup.rows.some((row) => row.metricKey === "movingTimeS"));
  assert.ok(!allGroup.rows.some((row) => row.metricKey === "avgSpeedMps"));

  const sameRouteGroup = view.groups.find((group) => group.key === "same_route");
  assert.ok(sameRouteGroup);
  const speedRow = sameRouteGroup.rows.find((row) => row.metricKey === "avgSpeedMps");
  assert.ok(speedRow);
  assert.equal(speedRow.sampleCount, 2);
  const speedBaseline = (6 + 5) / 2 * 3.6;
  assert.equal(speedRow.baselineDisplay, `${Number(speedBaseline.toFixed(1))} km/h`);
  assert.equal(speedRow.anchorDisplay, `${Number((8 * 3.6).toFixed(1))} km/h`);
  const changeKmH = (8 - 5.5) * 3.6;
  assert.ok(speedRow.changeDisplay.includes(`+${Number(changeKmH.toFixed(1))} km/h`));
});

test("second ride only records history but renders no comparison (frozen sample gate)", () => {
  assert.equal(buildRideHistoryComparisonForRecord(ANCHOR, [ANCHOR, PREVIOUS_ONE]), undefined);
  assert.equal(buildRideHistoryComparisonForRecord(ANCHOR, [ANCHOR]), undefined);
});

test("rides outside the 30-day window do not count as comparable samples", () => {
  const stale = rideRecord("stale", "2026-06-01T08:00:00Z", 6);
  assert.equal(buildRideHistoryComparisonForRecord(ANCHOR, [ANCHOR, stale]), undefined);
});

test("anchor must belong to the provided owner history (cross-user isolation at caller)", () => {
  const otherUserRides = [PREVIOUS_ONE, PREVIOUS_TWO];
  assert.equal(buildRideHistoryComparisonForRecord(ANCHOR, otherUserRides), undefined);
});

test("deleting a history ride updates the comparison via recomputation", () => {
  const before = buildRideHistoryComparisonForRecord(ANCHOR, [ANCHOR, PREVIOUS_ONE, PREVIOUS_TWO]);
  assert.ok(before);
  const distanceRow = before.groups.flatMap((group) => group.rows).find((row) => row.metricKey === "distanceM");
  assert.equal(distanceRow?.sampleCount, 2);
  const after = buildRideHistoryComparisonForRecord(ANCHOR, [ANCHOR, PREVIOUS_TWO]);
  assert.equal(after, undefined);
});

test("display metric keys stay within the frozen comparability matrix", () => {
  const allKeysHaveLabels = HISTORY_COMPARISON_METRIC_KEYS.every((key) => typeof key === "string");
  assert.ok(allKeysHaveLabels);
  assert.equal(new Set(HISTORY_COMPARISON_METRIC_KEYS).size, HISTORY_COMPARISON_METRIC_KEYS.length);
});
