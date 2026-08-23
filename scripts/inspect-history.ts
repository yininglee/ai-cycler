import { FixtureHistoryQueryService, validateHistoricalComparisonSnapshot, type HistoricalRide } from "../src/domain/historical-comparison.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function fixtureRide(historyId: string, startTime: string, routeKey: string): HistoricalRide {
  const fixture = getRideFixture("l3-built-in-sample");
  const record: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  record.activity.rideId = historyId;
  record.activity.startTime = startTime;
  record.series.rideId = historyId;
  record.series.timeBasis = { kind: "elapsed_from_start", startTime };
  for (const metric of Object.values(record.activity.metrics)) if (metric) metric.recordedAt = startTime;
  return { metadata: { historyId, routeKey, deviceKey: "fixture-device", sceneKey: "outdoor" }, record };
}

const rides = [
  fixtureRide("fixture-anchor", "2026-08-20T08:00:00Z", "route-a"),
  fixtureRide("fixture-prior-1", "2026-08-15T08:00:00Z", "route-a"),
  fixtureRide("fixture-prior-2", "2026-08-10T08:00:00Z", "route-a"),
  fixtureRide("fixture-other-route", "2026-08-12T08:00:00Z", "route-b"),
];

const service = new FixtureHistoryQueryService(rides);
const result = service.compare({
  anchorRideId: "fixture-anchor",
  metricKeys: ["avgSpeedMps", "avgPowerW", "normalizedPowerW"],
  windowDays: 30,
  routeScope: "same_route",
  timeZone: "Asia/Shanghai",
});

console.log(JSON.stringify({
  error: result.error,
  snapshot: result.snapshot,
  validation: validateHistoricalComparisonSnapshot(result.snapshot),
}, null, 2));
