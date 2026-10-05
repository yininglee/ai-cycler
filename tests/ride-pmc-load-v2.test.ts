import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_PMC_RECOVERY_TSB_THRESHOLD,
  buildRidePmcLoadV2,
  validateRidePmcLoadV2,
  type RidePmcDailyLoadInput,
  type RidePmcLoadSnapshotV2,
} from "../src/domain/ride-pmc-load-v2.ts";
import { buildRideProfileHistoryV2, validateRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { buildHistoricalRide } from "../src/persistence/persistent-history.ts";
import { buildHistoricalComparisonSnapshot } from "../src/domain/historical-comparison.ts";
import { buildRideAnalysisEvidencePacketsV2, getRideAnalysisEvidencePacketV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

const ANCHOR_DATE = "2026-10-05";
const START = "2026-10-05T06:00:00.000Z";

// Spread load days evenly across a window that starts well before the anchor.
function dailyLoads(loadDayCount: number, windowDays: number, tss = 100): RidePmcDailyLoadInput[] {
  const loads: RidePmcDailyLoadInput[] = [];
  for (let index = 0; index < loadDayCount; index += 1) {
    const offsetDays = Math.round((index * (windowDays - 1)) / Math.max(loadDayCount - 1, 1));
    const date = new Date(Date.parse(`${ANCHOR_DATE}T00:00:00Z`) - offsetDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    loads.push({ historyId: `history-${index}`, date, tss });
  }
  return loads;
}

test("PMC-01 computes CTL/ATL/TSB over a full window and emits three history claims", () => {
  const snapshot = buildRidePmcLoadV2({
    rideId: "ride-1",
    anchorDate: ANCHOR_DATE,
    ftpConfirmed: true,
    dailyLoads: dailyLoads(12, 45),
  });
  assert.equal(snapshot.status, "available");
  assert.ok(snapshot.ctl !== undefined && snapshot.atl !== undefined && snapshot.tsb !== undefined);
  assert.ok(Math.abs(snapshot.tsb - (snapshot.ctl - snapshot.atl)) <= 0.15);
  assert.equal(snapshot.windowDays, 45);
  assert.equal(snapshot.loadDays, 12);
  assert.deepEqual(
    snapshot.claims.map((claim) => claim.key),
    ["history.pmc.ctl", "history.pmc.atl", "history.pmc.tsb"],
  );
  const tsbClaim = snapshot.claims.find((claim) => claim.key === "history.pmc.tsb");
  assert.ok(tsbClaim?.supports.includes("recovery_signal"));
  assert.ok(tsbClaim?.prohibits.includes("causation"));
  assert.equal(validateRidePmcLoadV2(snapshot).length, 0);
});

test("PMC-01 merges multiple rides on the same day into one load day", () => {
  const loads = dailyLoads(11, 45);
  loads.push({ historyId: "history-extra", date: ANCHOR_DATE, tss: 150 });
  const snapshot = buildRidePmcLoadV2({
    rideId: "ride-1",
    anchorDate: ANCHOR_DATE,
    ftpConfirmed: true,
    dailyLoads: loads,
  });
  assert.equal(snapshot.status, "available");
  // The last dailyLoads day is the anchor itself; adding another ride on the
  // same day must not increase the load-day count (still 11 distinct days).
  assert.equal(snapshot.loadDays, 11);
});

test("PMC-01 closes the gates without a confirmed FTP or without TSS history", () => {
  const ftpGate = buildRidePmcLoadV2({ rideId: "ride-1", anchorDate: ANCHOR_DATE, ftpConfirmed: false, dailyLoads: dailyLoads(12, 45) });
  assert.equal(ftpGate.status, "unavailable");
  assert.equal(ftpGate.reason, "FTP_NOT_CONFIRMED");
  assert.ok(ftpGate.limitations.includes("history.pmcLoad:FTP_NOT_CONFIRMED"));

  const emptyGate = buildRidePmcLoadV2({ rideId: "ride-1", anchorDate: ANCHOR_DATE, ftpConfirmed: true, dailyLoads: [] });
  assert.equal(emptyGate.reason, "NO_TSS_HISTORY");
});

test("PMC-01 rejects windows shorter than 42 days or with fewer than 10 load days", () => {
  const shortWindow = buildRidePmcLoadV2({ rideId: "ride-1", anchorDate: ANCHOR_DATE, ftpConfirmed: true, dailyLoads: dailyLoads(12, 30) });
  assert.equal(shortWindow.reason, "INSUFFICIENT_WINDOW");

  const fewLoadDays = buildRidePmcLoadV2({ rideId: "ride-1", anchorDate: ANCHOR_DATE, ftpConfirmed: true, dailyLoads: dailyLoads(5, 45) });
  assert.equal(fewLoadDays.reason, "INSUFFICIENT_LOAD_DAYS");
  assert.equal(fewLoadDays.claims.length, 0);
});

test("PMC-01 validator catches inconsistent snapshots", () => {
  const snapshot = buildRidePmcLoadV2({ rideId: "ride-1", anchorDate: ANCHOR_DATE, ftpConfirmed: true, dailyLoads: dailyLoads(12, 45) });
  const broken = { ...snapshot, claims: snapshot.claims.filter((claim) => claim.key !== "history.pmc.tsb") };
  const issues = validateRidePmcLoadV2(broken);
  assert.ok(issues.some((issue) => issue.code === "PMC_CLAIM_MISSING"));

  const versionBroken = { ...snapshot, rulesVersion: "ride-pmc-load-v2.9" } as unknown as RidePmcLoadSnapshotV2;
  assert.ok(validateRidePmcLoadV2(versionBroken).some((issue) => issue.code === "VERSION_MISMATCH"));
});

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

test("PMC-01 opens the S3-01 long-term gates and routes PMC claims into the dedicated long-term load packet", () => {
  const current = ride("current", START, 8);
  const previousOne = ride("previous-1", "2026-10-01T06:00:00.000Z", 6);
  const previousTwo = ride("previous-2", "2026-09-28T06:00:00.000Z", 5);
  const comparison = buildHistoricalComparisonSnapshot(buildHistoricalRide(current), [
    buildHistoricalRide(current), buildHistoricalRide(previousOne), buildHistoricalRide(previousTwo),
  ], { metricKeys: ["distanceM", "avgSpeedMps"] });
  const pmcLoad = buildRidePmcLoadV2({ rideId: "current", anchorDate: ANCHOR_DATE, ftpConfirmed: true, dailyLoads: dailyLoads(12, 45) });
  assert.equal(pmcLoad.status, "available");

  const snapshot = buildRideProfileHistoryV2(current, {
    profile: createUserProfile({ age: 35, weightKg: 70, ftpWatts: 240 }, START),
    historicalComparison: comparison,
    pmcLoad,
  });
  assert.equal(snapshot.longTermLoad.status, "available");
  assert.equal(snapshot.recoverySignals.status, "available");
  assert.ok(!snapshot.limitations.some((limitation) => limitation.includes("longTermLoad:")));
  assert.ok(snapshot.capabilityClaims.claims.some((claim) => claim.key === "history.pmc.tsb"));
  assert.equal(snapshot.capabilityClaims.capabilities.find((item) => item.key === "longTermLoad")?.status, "available");
  assert.equal(validateRideProfileHistoryV2(snapshot).length, 0);

  const context = buildRideAnalysisEvidencePacketsV2(snapshot.capabilityClaims, { analysisRunId: "run-pmc-01", userScope: "user-pmc-01" });
  const packet = getRideAnalysisEvidencePacketV2(context, "longTermLoadRecovery");
  assert.ok(packet);
  assert.ok(packet.claimIds.some((claimId) => claimId.includes("history.pmc.tsb")));
  // The relative-past packet keeps comparison claims only; PMC claims stay out.
  const relativePast = getRideAnalysisEvidencePacketV2(context, "historicalPerformance");
  assert.ok(relativePast);
  assert.ok(relativePast.claimIds.some((claimId) => claimId.includes("history.all")));
  assert.ok(!relativePast.claimIds.some((claimId) => claimId.includes("history.pmc.")));
});

test("PMC-01 opens the dedicated packet even without comparable single-ride history", () => {
  const current = ride("current", START, 8);
  const pmcLoad = buildRidePmcLoadV2({ rideId: "current", anchorDate: ANCHOR_DATE, ftpConfirmed: true, dailyLoads: dailyLoads(12, 45) });
  const snapshot = buildRideProfileHistoryV2(current, {
    profile: createUserProfile({ age: 35, weightKg: 70, ftpWatts: 240 }, START),
    pmcLoad,
  });
  assert.equal(validateRideProfileHistoryV2(snapshot).length, 0);

  const context = buildRideAnalysisEvidencePacketsV2(snapshot.capabilityClaims, { analysisRunId: "run-pmc-02", userScope: "user-pmc-02" });
  assert.equal(getRideAnalysisEvidencePacketV2(context, "historicalPerformance"), undefined);
  const packet = getRideAnalysisEvidencePacketV2(context, "longTermLoadRecovery");
  assert.ok(packet);
  assert.equal(packet.eligibility, "available");
  assert.ok(packet.claimIds.some((claimId) => claimId.includes("history.pmc.tsb")));
});

test("PMC-01 keeps the S3-01 gates closed by default (no PMC snapshot passed)", () => {
  const current = ride("current", START, 8);
  const snapshot = buildRideProfileHistoryV2(current, {});
  assert.equal(snapshot.longTermLoad.status, "unavailable");
  assert.equal(snapshot.recoverySignals.status, "unavailable");
  assert.ok(snapshot.limitations.includes("history.longTermLoad:HISTORY_NOT_AVAILABLE"));
  assert.equal(validateRideProfileHistoryV2(snapshot).length, 0);
});

test(`PMC-01 validator threshold is TSB >= +${RIDE_PMC_RECOVERY_TSB_THRESHOLD}`, () => {
  assert.equal(RIDE_PMC_RECOVERY_TSB_THRESHOLD, 5);
});
