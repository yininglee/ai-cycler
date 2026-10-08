import assert from "node:assert/strict";
import test from "node:test";

import { buildRideSeries } from "../src/domain/ride-series.ts";
import { buildRideTemporalWindowsV2 } from "../src/domain/ride-temporal-windows-v2.ts";
import { buildRideCapabilityClaimsV2 } from "../src/domain/ride-capability-claims-v2.ts";
import {
  buildRideAnalysisEvidencePacketsV2,
  getRideAnalysisEvidencePacketV2,
} from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { validateRideAnalysisEvidenceV2 } from "../src/domain/ride-analysis-evidence-v2.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import type { RideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";

const START = "2026-10-05T06:00:00.000Z";

function fullRecord(): RideRecord {
  const points: Omit<RideSeriesPoint, "sequence">[] = [{ distanceM: 0, elapsedTimeS: 0 }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  for (let index = 0; index < 36; index += 1) {
    elapsedTimeS += 10;
    distanceM += 50;
    points.push({ distanceM, elapsedTimeS, speedMps: 5, powerW: 200, heartRateBpm: 140, cadenceRpm: 85 });
  }
  const series = buildRideSeries({ rideId: "s2-02-full", sourceKind: "sample", parserVersion: "s2-02-fixture-v1", startTime: START, points });
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "s2-02-full",
      sport: "cycling",
      source: { kind: "sample", parserVersion: "s2-02-fixture-v1" },
      startTime: START,
      metrics: {},
      sensorQuality: {
        gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        heart_rate: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        cadence: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
      },
      sourceIssues: [],
    },
    series,
  };
}

function snapshot(record: RideRecord, ftpWatts = 240) {
  return buildRideCapabilityClaimsV2(record, {
    profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ...(ftpWatts ? { ftpWatts } : {}) }, START),
  });
}

function buildContext(record: RideRecord, ftpWatts = 240) {
  return buildRideAnalysisEvidencePacketsV2(snapshot(record, ftpWatts), {
    analysisRunId: "run:s2-02:test",
    userScope: "user:s2-02:test",
  });
}

function oneClimb(): RideEventClimbSummary {
  return {
    rulesVersion: "ride-event-climb-rules-v0.2",
    isAvailable: true,
    unavailableReasons: [],
    climbs: [{
      id: "s2-02-climb-1",
      rulesVersion: "ride-event-climb-rules-v0.2",
      elevationRulesVersion: "s2-02-test",
      routeShapeRulesVersion: "s2-02-test",
      category: "4",
      startDistanceM: 100,
      endDistanceM: 500,
      distanceM: 400,
      netElevationGainM: 50,
      averageGrade: 0.05,
      difficultyScore: 10,
      unavailableReasons: [],
    }],
  };
}

test("every eligible problem gets a complete packet with all same-topic claims", () => {
  const context = buildContext(fullRecord());
  assert.deepEqual(validateRideAnalysisEvidenceV2(context), []);
  assert.ok(getRideAnalysisEvidencePacketV2(context, "pacingExecution"));
  assert.ok(getRideAnalysisEvidencePacketV2(context, "heartRateLoad"));
  assert.ok(getRideAnalysisEvidencePacketV2(context, "powerOutput"));
  assert.ok(getRideAnalysisEvidencePacketV2(context, "cadenceStrategy"));
  assert.ok(getRideAnalysisEvidencePacketV2(context, "crossSensorCoordination"));
  assert.ok(getRideAnalysisEvidencePacketV2(context, "intensityAndTrainingLoad"));
  assert.equal(getRideAnalysisEvidencePacketV2(context, "historicalPerformance"), undefined);

  const power = getRideAnalysisEvidencePacketV2(context, "powerOutput")!;
  const powerClaimIds = new Set(power.claimIds);
  const allPowerClaims = context.allowedClaims.filter((claim) => claim.key.startsWith("power."));
  assert.ok(allPowerClaims.length >= 10);
  assert.ok(allPowerClaims.every((claim) => powerClaimIds.has(claim.claimId)));
  assert.equal(new Set(power.claimIds).size, power.claimIds.length);
  assert.ok(power.claimGroups.calculated.length > 0);
});

test("all qualified cruise segments remain in the problem packet instead of selecting one", () => {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  const context = buildContext(record);
  const power = getRideAnalysisEvidencePacketV2(context, "powerOutput");
  assert.ok(power);
  const segmentIds = context.allowedClaims
    .filter((claim) => claim.key.startsWith("segment.cruise.") && claim.key.endsWith(".span"))
    .map((claim) => claim.claimId);
  assert.ok(segmentIds.length >= 3);
  assert.deepEqual(segmentIds.filter((claimId) => power!.claimIds.includes(claimId)), segmentIds);
});

test("cruise segment sensor observations follow the sensor's dimension (PD-AI-30)", () => {
  // Regression (2026-10-07 live run): the model intuitively cited cruise
  // heart-rate claims in the heart-rate dimension, but heartRateLoad's
  // supports list only carried the climb precedent — cruise heart-rate
  // observations reached pacing/power via the segment.cruise. key prefix
  // only, so CLAIM_NOT_IN_DIMENSION fired on a semantically correct
  // reference. PD-AI-30 completes the segment×sensor observation matrix.
  // Synthetic 30-min constant-speed ride with gentle elevation (cruise
  // detection needs a defined grade) and full sensors.
  const points: Omit<RideSeriesPoint, "sequence">[] = [{ distanceM: 0, elapsedTimeS: 0, elevationM: 100 }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  let elevationM = 100;
  for (let index = 0; index < 180; index += 1) {
    elapsedTimeS += 10;
    distanceM += 50;
    elevationM += 0.1;
    points.push({ distanceM, elapsedTimeS, elevationM, speedMps: 5, powerW: 200, heartRateBpm: 140, cadenceRpm: 85 });
  }
  const series = buildRideSeries({ rideId: "s2-02-cruise-hr", sourceKind: "sample", parserVersion: "s2-02-fixture-v1", startTime: START, points });
  const record: RideRecord = {
    activity: {
      schemaVersion: "0.2",
      rideId: "s2-02-cruise-hr",
      sport: "cycling",
      source: { kind: "sample", parserVersion: "s2-02-fixture-v1" },
      startTime: START,
      metrics: {},
      sensorQuality: {
        gps: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        power: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        heart_rate: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
        cadence: { coverage: 1, sampleCount: points.length, invalidSampleCount: 0 },
      },
      sourceIssues: [],
    },
    series,
  };
  const context = buildContext(record);
  const heartRate = getRideAnalysisEvidencePacketV2(context, "heartRateLoad");
  assert.ok(heartRate);
  const cruiseHeartRateIds = context.allowedClaims
    .filter((claim) => claim.key.startsWith("segment.cruise.") && claim.key.endsWith(".heart_rate.mean"))
    .map((claim) => claim.claimId);
  assert.ok(cruiseHeartRateIds.length >= 1);
  assert.deepEqual(
    cruiseHeartRateIds.filter((claimId) => heartRate!.claimIds.includes(claimId)),
    cruiseHeartRateIds,
  );
  // Cruise span claims anchor segment duration in the HR dimension too,
  // mirroring the climb precedent that pairs span + sensor mean.
  const cruiseSpanIds = context.allowedClaims
    .filter((claim) => claim.key.startsWith("segment.cruise.") && claim.key.endsWith(".span"))
    .map((claim) => claim.claimId);
  assert.ok(cruiseSpanIds.length >= 1);
  assert.deepEqual(
    cruiseSpanIds.filter((claimId) => heartRate!.claimIds.includes(claimId)),
    cruiseSpanIds,
  );
});

test("qualified climb claims reach every related problem packet", () => {
  const record = fullRecord();
  const snapshotValue = buildRideCapabilityClaimsV2(record, {
    windows: buildRideTemporalWindowsV2(record, { climbs: oneClimb() }),
    profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, START),
  });
  const context = buildRideAnalysisEvidencePacketsV2(snapshotValue, {
    analysisRunId: "run:s2-02:climb",
    userScope: "user:s2-02:test",
  });
  const climbClaims = context.allowedClaims.filter((claim) => claim.key.startsWith("segment.climb.s2-02-climb-1."));
  assert.ok(climbClaims.length >= 5);
  // S2-05 (option B): crossSensorCoordination no longer carries segment claims.
  const expectedByDimension = {
    climbPerformance: [".span", ".speed.mean", ".heart_rate.mean", ".power.mean", ".cadence.mean"],
    heartRateLoad: [".span", ".heart_rate.mean"],
    powerOutput: [".span", ".power.mean"],
  } as const;
  for (const dimensionId of Object.keys(expectedByDimension) as Array<keyof typeof expectedByDimension>) {
    const packet = getRideAnalysisEvidencePacketV2(context, dimensionId);
    assert.ok(packet, dimensionId);
    const packetKeys = new Set(context.allowedClaims
      .filter((claim) => packet!.claimIds.includes(claim.claimId))
      .map((claim) => claim.key));
    for (const suffix of expectedByDimension[dimensionId]) {
      assert.ok(packetKeys.has(`segment.climb.s2-02-climb-1${suffix}`), `${dimensionId}:${suffix}`);
    }
  }
});

test("missing FTP removes only the intensity packet while independent power remains", () => {
  const context = buildContext(fullRecord(), 0);
  assert.ok(getRideAnalysisEvidencePacketV2(context, "powerOutput"));
  assert.ok(getRideAnalysisEvidencePacketV2(context, "heartRateLoad"));
  assert.equal(getRideAnalysisEvidencePacketV2(context, "intensityAndTrainingLoad"), undefined);
  assert.equal(context.allowedClaims.some((claim) => claim.key === "power.intensityFactor"), false);
  assert.equal(validateRideAnalysisEvidenceV2(context).length, 0);
});

test("packet limitations preserve optional capability gaps without dropping valid claims", () => {
  const context = buildContext(fullRecord());
  const heartRate = getRideAnalysisEvidencePacketV2(context, "heartRateLoad")!;
  assert.equal(heartRate.optionalEvidence.find((item) => item.capabilityKey === "heartRateDrift")?.status, "fulfilled");
  assert.equal(heartRate.limitations.some((item) => item.includes("heartRateDrift")), false);

  const fixture = getRideFixture("l3-power-preview");
  const powerOnly = buildContext({ activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) });
  assert.equal(getRideAnalysisEvidencePacketV2(powerOnly, "heartRateLoad"), undefined);
  const power = getRideAnalysisEvidencePacketV2(powerOnly, "powerOutput");
  assert.ok(power);
  assert.ok(power!.limitations.some((item) => item.startsWith("crossSensorAlignment:")));
  assert.ok(power!.claimIds.length > 1);
});

test("invalid snapshot or missing packet identity fails closed", () => {
  const value = snapshot(fullRecord());
  value.claims[0]!.sourceRefs[0]!.version = "stale";
  assert.throws(() => buildRideAnalysisEvidencePacketsV2(value, {
    analysisRunId: "run:s2-02:test",
    userScope: "user:s2-02:test",
  }), /S2-01 snapshot is invalid/);
  assert.throws(() => buildRideAnalysisEvidencePacketsV2(snapshot(fullRecord()), {
    analysisRunId: " ",
    userScope: "user:s2-02:test",
  }), /analysisRunId/);
});

test("V21-07 derived metrics land in their owning dimensions (VI/EF shared, split/negativeSplit pacing)", () => {
  // Regression (2026-10-08): buildDerivedMetricClaimsV21 emits supports values
  // (power_variability / pacing_split / aerobic_efficiency / power_curve) and
  // "pacing.*" keys that were absent from PACKET_DEFINITIONS, so VI / split /
  // negativeSplit were dropped from every packet (and EF only reached
  // heartRateLoad, never crossSensor). The model then cited them across
  // dimensions -> CLAIM_NOT_IN_DIMENSION, or quoted a VI number with no claim ->
  // NUMBER_NOT_IN_CLAIMS. This test pins the dimension assignment.
  const points: Omit<RideSeriesPoint, "sequence">[] = [{ distanceM: 0, elapsedTimeS: 0 }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  for (let index = 0; index < 70; index += 1) {
    elapsedTimeS += 10;
    distanceM += 50;
    // 后半程功率略高 → 触发 negative_split + splitDifference
    const powerW = index < 35 ? 190 : 210;
    points.push({ distanceM, elapsedTimeS, speedMps: 5, powerW, heartRateBpm: 140, cadenceRpm: 85 });
  }
  const series = buildRideSeries({ rideId: "s2-02-derived", sourceKind: "sample", parserVersion: "s2-02-fixture-v1", startTime: START, points });
  const record: RideRecord = {
    activity: { ...fullRecord().activity, rideId: "s2-02-derived" },
    series,
  };

  const context = buildContext(record);
  const keyById = new Map(context.allowedClaims.map((claim) => [claim.claimId, claim.key]));
  const has = (dimensionId: string, key: string) => {
    const packet = getRideAnalysisEvidencePacketV2(context, dimensionId as never);
    return packet !== undefined && packet.claimIds.some((id) => keyById.get(id) === key);
  };

  // VI 共享：配速执行 + 功率输出两个维度都能引用（避免跨维度误判）
  assert.ok(has("pacingExecution", "pacing.variabilityIndex"), "VI 应进入 pacingExecution");
  assert.ok(has("powerOutput", "pacing.variabilityIndex"), "VI 应进入 powerOutput（共享指标）");

  // split/负分割：配速执行维度
  assert.ok(has("pacingExecution", "pacing.splitDifference"), "splitDifference 应进入 pacingExecution");
  assert.ok(has("pacingExecution", "pacing.negativeSplit"), "negativeSplit 应进入 pacingExecution");

  // EF 共享：心率负荷 + 跨传感器配合两个维度都能引用
  assert.ok(has("heartRateLoad", "heartRate.efficiencyFactor"), "EF 应进入 heartRateLoad");
  assert.ok(has("crossSensorCoordination", "heartRate.efficiencyFactor"), "EF 应进入 crossSensorCoordination（共享指标）");

  // 功率曲线：功率输出维度（key "power." 前缀）
  assert.ok(has("powerOutput", "power.curve.5s"), "功率曲线应进入 powerOutput");
});
