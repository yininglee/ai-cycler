import assert from "node:assert/strict";
import test from "node:test";

import { buildHistoricalRide } from "../src/persistence/persistent-history.ts";
import { buildHistoricalComparisonSnapshot } from "../src/domain/historical-comparison.ts";
import { buildRideAnalysisEvidencePacketsV2, getRideAnalysisEvidencePacketV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { buildRideProfileHistoryV2, validateRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

const START = "2026-10-05T06:00:00.000Z";

function ride(rideId: string, startTime: string, speed: number): RideRecord {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  record.activity.rideId = rideId;
  record.series.rideId = rideId;
  record.activity.startTime = startTime;
  record.activity.source.deviceManufacturer = "Garmin";
  record.activity.source.deviceProduct = "Edge 540";
  record.activity.metrics.avgSpeedMps!.value = speed;
  record.activity.metrics.movingTimeS!.value = record.activity.metrics.distanceM!.value / speed;
  record.series.timeBasis = record.series.timeBasis.kind === "elapsed_from_start"
    ? { kind: "elapsed_from_start", startTime }
    : record.series.timeBasis;
  return record;
}

function profile() {
  return createUserProfile({ age: 35, weightKg: 70, ftpWatts: 240 }, START);
}

test("S3-01 keeps Profile versioned and closes history, long-term, and recovery without input", () => {
  const snapshot = buildRideProfileHistoryV2(ride("current", START, 8), { profile: profile() });
  assert.equal(snapshot.profile.status, "available");
  assert.deepEqual(snapshot.profile.authorizedFields, ["age", "weightKg", "maxHeartRate", "ftp"]);
  assert.equal(snapshot.history.status, "missing");
  assert.equal(snapshot.longTermLoad.status, "unavailable");
  assert.equal(snapshot.longTermLoad.reason, "HISTORY_NOT_AVAILABLE");
  assert.equal(snapshot.recoverySignals.reason, "HISTORY_NOT_AVAILABLE");
  assert.ok(snapshot.limitations.includes("history.comparison:HISTORY_NOT_PROVIDED"));
  assert.equal(validateRideProfileHistoryV2(snapshot).length, 0);
});

test("S3-01 automatically converts a comparable history snapshot into history Claims", () => {
  const current = ride("current", START, 8);
  const previousOne = ride("previous-1", "2026-10-01T06:00:00.000Z", 6);
  const previousTwo = ride("previous-2", "2026-09-28T06:00:00.000Z", 5);
  const comparison = buildHistoricalComparisonSnapshot(buildHistoricalRide(current), [
    buildHistoricalRide(current), buildHistoricalRide(previousOne), buildHistoricalRide(previousTwo),
  ], { metricKeys: ["distanceM", "avgSpeedMps"] });
  const snapshot = buildRideProfileHistoryV2(current, { profile: profile(), historicalComparison: comparison });
  assert.equal(snapshot.history.status, "available");
  assert.ok(snapshot.history.comparableMetricKeys.some((key) => key.includes("avgSpeedMps")));
  assert.ok(snapshot.capabilityClaims.claims.some((claim) => claim.kind === "history" && claim.key.startsWith("history.all.")));
  assert.equal(snapshot.capabilityClaims.capabilities.find((item) => item.key === "historyComparison")?.status, "available");
  assert.equal(snapshot.longTermLoad.reason, "HISTORY_WINDOW_NOT_IMPLEMENTED");
  assert.equal(snapshot.recoverySignals.reason, "HISTORY_WINDOW_NOT_IMPLEMENTED");
  assert.equal(validateRideProfileHistoryV2(snapshot).length, 0);

  const context = buildRideAnalysisEvidencePacketsV2(snapshot.capabilityClaims, { analysisRunId: "run-s3-01", userScope: "user-s3-01" });
  const packet = getRideAnalysisEvidencePacketV2(context, "historicalPerformance");
  assert.ok(packet);
  assert.ok(packet.claimIds.some((claimId) => claimId.includes("history.all")));
  assert.ok(packet.limitations.some((limitation) => limitation.includes("longTermLoad:HISTORY_WINDOW_NOT_IMPLEMENTED")));
  assert.equal(context.allowedClaims.filter((claim) => claim.kind === "history").length, snapshot.history.comparableMetricKeys.length);
});

test("S3-01 does not infer a trend when the historical window lacks enough samples", () => {
  const current = ride("current", START, 8);
  const onlyPrevious = ride("previous-1", "2026-10-01T06:00:00.000Z", 6);
  const comparison = buildHistoricalComparisonSnapshot(buildHistoricalRide(current), [
    buildHistoricalRide(current), buildHistoricalRide(onlyPrevious),
  ], { metricKeys: ["avgSpeedMps"] });
  const snapshot = buildRideProfileHistoryV2(current, { historicalComparison: comparison });
  assert.equal(snapshot.history.status, "unavailable");
  assert.equal(snapshot.history.reason, "NO_COMPARABLE_HISTORY");
  assert.equal(snapshot.capabilityClaims.claims.some((claim) => claim.kind === "history"), false);
  assert.equal(snapshot.capabilityClaims.capabilities.find((item) => item.key === "historyComparison")?.status, "unavailable");
  assert.ok(snapshot.limitations.includes("history.longTermLoad:HISTORY_NOT_AVAILABLE"));
  assert.equal(validateRideProfileHistoryV2(snapshot).length, 0);
});

test("S3-01 rejects history snapshots from another ride", () => {
  const current = ride("current", START, 8);
  const comparison = buildHistoricalComparisonSnapshot(buildHistoricalRide(ride("other", START, 8)), [], { metricKeys: ["distanceM"] });
  assert.throws(() => buildRideProfileHistoryV2(current, { historicalComparison: comparison }), /does not match the ride/);
});
