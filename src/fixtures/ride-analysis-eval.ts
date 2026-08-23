import { buildHistoricalComparisonSnapshot, type HistoricalComparisonSnapshot, type HistoricalRide } from "../domain/historical-comparison.ts";
import { buildRideSeries } from "../domain/ride-series.ts";
import { createUserProfile, emptyUserProfile, type UserProfile } from "../domain/user-profile.ts";
import type { RideRecord, RideSeriesPoint } from "../domain/ride-schema.ts";
import { getRideFixture } from "./rides.ts";

export type RideAnalysisEvalCaseId =
  | "RA-AUTO-005"
  | "RA-AUTO-007"
  | "RA-AUTO-009"
  | "RA-AUTO-010"
  | "RA-AUTO-012"
  | "RA-AUTO-013"
  | "RA-AUTO-015";

export interface RideAnalysisEvalFixture {
  caseId: RideAnalysisEvalCaseId;
  fixtureId: string;
  record: RideRecord;
  contextOptions: {
    profile?: UserProfile;
    profileFieldKeys?: Array<"age" | "heightCm" | "weightKg" | "maxHeartRate" | "ftp">;
    historicalComparison?: HistoricalComparisonSnapshot;
  };
  expectedDimensionKeys: string[];
  expectedHistoryAvailable: boolean;
}

function cloneRecord(fixtureId: string, rideId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  const record: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  record.activity.rideId = rideId;
  record.series.rideId = rideId;
  return record;
}

function setMetricRecordedAt(record: RideRecord, startTime: string): void {
  record.activity.startTime = startTime;
  for (const metric of Object.values(record.activity.metrics)) if (metric) metric.recordedAt = startTime;
}

function historyRide(record: RideRecord, historyId: string, routeKey: string, startTime: string): HistoricalRide {
  const value: RideRecord = structuredClone(record);
  value.activity.rideId = historyId;
  value.series.rideId = historyId;
  setMetricRecordedAt(value, startTime);
  return {
    metadata: { historyId, routeKey, deviceKey: "eval-device-a", sceneKey: "outdoor" },
    record: value,
  };
}

function historySnapshot(
  anchor: RideRecord,
  previous: HistoricalRide[],
  routeScope: "all" | "same_route" = "same_route",
): HistoricalComparisonSnapshot {
  const anchorRide = historyRide(anchor, anchor.activity.rideId, "route-a", "2026-08-20T08:00:00Z");
  anchor.activity.startTime = "2026-08-20T08:00:00Z";
  for (const metric of Object.values(anchor.activity.metrics)) if (metric) metric.recordedAt = anchor.activity.startTime;
  return buildHistoricalComparisonSnapshot(anchorRide, [anchorRide, ...previous], {
    metricKeys: ["avgSpeedMps", "avgHeartRateBpm", "avgPowerW"],
    routeScope,
    deviceScope: "same",
    sceneScope: "same",
  });
}

function sensorOnlyRecord(
  sourceFixtureId: "l2-built-in-sample" | "l3-built-in-sample",
  rideId: string,
  sensor: "heart_rate" | "power",
): RideRecord {
  const record = cloneRecord(sourceFixtureId, rideId);
  record.activity.sport = "indoor_cycling";
  record.activity.source = { kind: "sample", parserVersion: "eval-t001-v0.1", formatVersion: "normalized-0.2" };
  const keepMetricKeys = sensor === "heart_rate"
    ? new Set(["movingTimeS", "avgHeartRateBpm", "maxHeartRateBpm"])
    : new Set(["movingTimeS", "avgPowerW", "normalizedPowerW"]);
  record.activity.metrics = Object.fromEntries(Object.entries(record.activity.metrics).filter(([key]) => keepMetricKeys.has(key))) as RideRecord["activity"]["metrics"];
  record.activity.sensorQuality = sensor === "heart_rate"
    ? { heart_rate: { coverage: 0.98, sampleCount: 4_680, invalidSampleCount: 3 } }
    : { power: { coverage: 0.99, sampleCount: 6_190, invalidSampleCount: 2 } };
  const points = record.series.points.map((point): Omit<RideSeriesPoint, "sequence" | "route"> => ({
    ...(point.elapsedTimeS !== undefined ? { elapsedTimeS: point.elapsedTimeS } : {}),
    ...(sensor === "heart_rate" && point.heartRateBpm !== undefined ? { heartRateBpm: point.heartRateBpm } : {}),
    ...(sensor === "power" && point.powerW !== undefined ? { powerW: point.powerW } : {}),
  }));
  record.series = buildRideSeries({
    rideId,
    sourceKind: "sample",
    parserVersion: "eval-t001-v0.1",
    startTime: record.activity.startTime,
    points,
  });
  return record;
}

function highHeartRateRecord(): RideRecord {
  const record = cloneRecord("l2-built-in-sample", "ride-eval-high-hr-no-baseline");
  record.activity.metrics.avgHeartRateBpm!.value = 178;
  record.activity.metrics.maxHeartRateBpm!.value = 198;
  record.series.points = record.series.points.map((point) => ({
    ...point,
    ...(point.heartRateBpm !== undefined ? { heartRateBpm: point.heartRateBpm + 32 } : {}),
  }));
  return record;
}

export function getRideAnalysisEvalFixture(caseId: RideAnalysisEvalCaseId): RideAnalysisEvalFixture {
  switch (caseId) {
    case "RA-AUTO-005": {
      const record = cloneRecord("l1-gpx-normal", "ride-eval-different-route");
      const previous = historyRide(record, "ride-eval-other-route", "route-b", "2026-08-18T08:00:00Z");
      return { caseId, fixtureId: "eval-different-route-history", record, contextOptions: { historicalComparison: historySnapshot(record, [previous]) }, expectedDimensionKeys: ["pace", "climbing"], expectedHistoryAvailable: false };
    }
    case "RA-AUTO-007": {
      const record = cloneRecord("l2-built-in-sample", "ride-eval-estimated-max-hr");
      const profile = createUserProfile({ age: 35 }, "2026-08-20T08:00:00.000Z");
      return { caseId, fixtureId: "eval-estimated-max-hr", record, contextOptions: { profile, profileFieldKeys: ["maxHeartRate"] }, expectedDimensionKeys: ["pace", "heartRate", "cadence", "climbing"], expectedHistoryAvailable: false };
    }
    case "RA-AUTO-009": {
      const record = highHeartRateRecord();
      return { caseId, fixtureId: "eval-high-hr-no-baseline", record, contextOptions: { profile: emptyUserProfile("2026-08-20T08:00:00.000Z") }, expectedDimensionKeys: ["pace", "heartRate", "cadence", "climbing"], expectedHistoryAvailable: false };
    }
    case "RA-AUTO-010": {
      const record = sensorOnlyRecord("l2-built-in-sample", "ride-eval-indoor-hr-only", "heart_rate");
      return { caseId, fixtureId: "eval-indoor-hr-only", record, contextOptions: {}, expectedDimensionKeys: ["heartRate"], expectedHistoryAvailable: false };
    }
    case "RA-AUTO-012": {
      const record = cloneRecord("l3-built-in-sample", "ride-eval-insufficient-ftp");
      return { caseId, fixtureId: "eval-insufficient-ftp", record, contextOptions: { profile: emptyUserProfile("2026-08-20T08:00:00.000Z"), profileFieldKeys: ["ftp"] }, expectedDimensionKeys: ["pace", "heartRate", "power", "cadence", "climbing"], expectedHistoryAvailable: false };
    }
    case "RA-AUTO-013": {
      const record = cloneRecord("l3-built-in-sample", "ride-eval-history-short");
      const previous = historyRide(record, "ride-eval-history-short-previous", "route-a", "2026-08-18T08:00:00Z");
      return { caseId, fixtureId: "eval-history-short", record, contextOptions: { historicalComparison: historySnapshot(record, [previous]) }, expectedDimensionKeys: ["pace", "heartRate", "power", "cadence", "climbing"], expectedHistoryAvailable: false };
    }
    case "RA-AUTO-015": {
      const record = sensorOnlyRecord("l3-built-in-sample", "ride-eval-indoor-power-only", "power");
      return { caseId, fixtureId: "eval-indoor-power-only", record, contextOptions: {}, expectedDimensionKeys: ["power"], expectedHistoryAvailable: false };
    }
  }
}

export const rideAnalysisEvalCaseIds: RideAnalysisEvalCaseId[] = [
  "RA-AUTO-005", "RA-AUTO-007", "RA-AUTO-009", "RA-AUTO-010", "RA-AUTO-012", "RA-AUTO-013", "RA-AUTO-015",
];
