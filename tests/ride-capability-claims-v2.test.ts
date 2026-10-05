import assert from "node:assert/strict";
import test from "node:test";
import { buildRideSeries } from "../src/domain/ride-series.ts";
import type { RideRecord, RideSeriesPoint } from "../src/domain/ride-schema.ts";
import {
  RIDE_CONTIGUOUS_NP_RULES_VERSION,
  buildRideCapabilityClaimsV2,
  getEvidenceCapabilityV2,
  validateRideCapabilityClaimsV2,
} from "../src/domain/ride-capability-claims-v2.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const START = "2026-10-05T06:00:00.000Z";

function record(
  rows: Array<{ seconds: number; speed?: number; power?: number; heartRate?: number; cadence?: number }>,
  options: { timed?: boolean } = {},
): RideRecord {
  const points: Omit<RideSeriesPoint, "sequence">[] = [{
    distanceM: 0,
    ...(options.timed === false ? {} : { elapsedTimeS: 0 }),
  }];
  let elapsedTimeS = 0;
  let distanceM = 0;
  for (const row of rows) {
    elapsedTimeS += row.seconds;
    distanceM += row.seconds * (row.speed ?? 5);
    points.push({
      distanceM,
      ...(options.timed === false ? {} : { elapsedTimeS }),
      ...(row.speed === undefined ? {} : { speedMps: row.speed }),
      ...(row.power === undefined ? {} : { powerW: row.power }),
      ...(row.heartRate === undefined ? {} : { heartRateBpm: row.heartRate }),
      ...(row.cadence === undefined ? {} : { cadenceRpm: row.cadence }),
    });
  }
  const source = { kind: "sample" as const, parserVersion: "s2-01-fixture-v1" };
  const series = buildRideSeries({ rideId: "s2-01-ride", sourceKind: source.kind, parserVersion: source.parserVersion,
    ...(options.timed === false ? {} : { startTime: START }), points });
  return {
    activity: {
      schemaVersion: "0.2",
      rideId: "s2-01-ride",
      sport: "cycling",
      source,
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

function completeRecord(power = 200): RideRecord {
  return record(Array.from({ length: 12 }, () => ({ seconds: 10, speed: 5, power, heartRate: 140, cadence: 85 })));
}

function claimValue(snapshot: ReturnType<typeof buildRideCapabilityClaimsV2>, key: string): number | undefined {
  return snapshot.claims.find((item) => item.key === key)?.value;
}

test("S2-01 produces the complete capability set and traceable atomic claims", () => {
  const profile = createUserProfile({ age: 35, weightKg: 70, ftpWatts: 250 }, START);
  const snapshot = buildRideCapabilityClaimsV2(completeRecord(), { profile });
  assert.equal(validateRideCapabilityClaimsV2(snapshot).length, 0);
  assert.equal(snapshot.capabilities.length, 33);
  assert.equal(getEvidenceCapabilityV2(snapshot, "power").status, "available");
  assert.equal(getEvidenceCapabilityV2(snapshot, "powerPeaks").status, "available");
  assert.equal(getEvidenceCapabilityV2(snapshot, "crossSensorAlignment").status, "available");
  assert.equal(getEvidenceCapabilityV2(snapshot, "intensity").status, "available");
  assert.equal(getEvidenceCapabilityV2(snapshot, "trainingLoad").status, "available");
  assert.ok(snapshot.claims.every((item) => item.sourceRefs.length > 0 && item.evidenceIds.length > 0));
  assert.equal(getEvidenceCapabilityV2(snapshot, "longTermLoad").unavailableReason, "RULE_NOT_IMPLEMENTED_IN_S2_01");
});

test("missing FTP closes only FTP-dependent capabilities and claims", () => {
  const snapshot = buildRideCapabilityClaimsV2(completeRecord(), {
    profile: createUserProfile({ weightKg: 70 }, START),
  });
  for (const key of ["verifiedFtp", "powerZones", "intensity", "trainingLoad"] as const) {
    assert.equal(getEvidenceCapabilityV2(snapshot, key).status, "unavailable", key);
  }
  for (const key of ["power", "powerStability", "powerPeaks", "normalizedPower"] as const) {
    assert.notEqual(getEvidenceCapabilityV2(snapshot, key).status, "unavailable", key);
  }
  assert.ok(snapshot.claims.some((item) => item.key === "power.normalizedW"));
  assert.ok(snapshot.claims.every((item) => !["power.intensityFactor", "power.trainingStressScore"].includes(item.key)));
  assert.equal(validateRideCapabilityClaimsV2(snapshot).length, 0);
});

test("missing weight suppresses W/kg without removing absolute power, IF, or TSS", () => {
  const snapshot = buildRideCapabilityClaimsV2(completeRecord(), {
    profile: createUserProfile({ ftpWatts: 250 }, START),
  });
  assert.equal(getEvidenceCapabilityV2(snapshot, "intensity").status, "available");
  assert.equal(getEvidenceCapabilityV2(snapshot, "trainingLoad").status, "available");
  assert.ok(snapshot.claims.some((item) => item.key === "power.normalizedW"));
  assert.ok(snapshot.claims.some((item) => item.key === "power.intensityFactor"));
  assert.ok(snapshot.claims.some((item) => item.key === "power.trainingStressScore"));
  assert.ok(snapshot.claims.every((item) => !item.key.endsWith("Wkg")));
  assert.ok(snapshot.limitations.includes("power.weight:PROFILE_WEIGHT_MISSING"));
});

test("contiguous NP does not bridge a recording gap", () => {
  const ride = record([
    ...Array.from({ length: 30 }, () => ({ seconds: 10, speed: 5, power: 100 })),
    { seconds: 11, speed: 5, power: 400 },
    ...Array.from({ length: 30 }, () => ({ seconds: 10, speed: 5, power: 400 })),
  ]);
  const snapshot = buildRideCapabilityClaimsV2(ride);
  const np = snapshot.claims.find((item) => item.key === "power.normalizedW");
  assert.equal(np?.formulaVersion, RIDE_CONTIGUOUS_NP_RULES_VERSION);
  assert.ok(np);
  const npValue = np.value;
  if (npValue === undefined) throw new Error("normalized power claim is missing a value");
  assert.ok(npValue > 100 && npValue < 400);
  assert.equal(getEvidenceCapabilityV2(snapshot, "normalizedPower").status, "partial");
  assert.ok(np?.prohibits.includes("bridge_recording_gap"));
});

test("insufficient power quality leaves independent heart-rate and cadence claims available", () => {
  const ride = completeRecord();
  for (let index = 4; index < ride.series.points.length; index += 1) delete ride.series.points[index]!.powerW;
  ride.series.seriesMetadata.power!.sampleCount = ride.series.points.filter((point) => point.powerW !== undefined).length;
  ride.activity.sensorQuality.power = { coverage: 0.25, sampleCount: ride.series.points.length, invalidSampleCount: 0 };
  const snapshot = buildRideCapabilityClaimsV2(ride, {
    profile: createUserProfile({ age: 35, ftpWatts: 250 }, START),
  });
  assert.equal(getEvidenceCapabilityV2(snapshot, "power").status, "unavailable");
  assert.equal(getEvidenceCapabilityV2(snapshot, "normalizedPower").status, "unavailable");
  assert.equal(getEvidenceCapabilityV2(snapshot, "intensity").status, "unavailable");
  assert.notEqual(getEvidenceCapabilityV2(snapshot, "heartRate").status, "unavailable");
  assert.notEqual(getEvidenceCapabilityV2(snapshot, "cadence").status, "unavailable");
  assert.ok(snapshot.claims.some((item) => item.key === "heart_rate.mean"));
  assert.ok(snapshot.claims.some((item) => item.key === "cadence.mean"));
});

test("segment capabilities close when their sensor dependency is unavailable", () => {
  const fixture = getRideFixture("l3-power-preview");
  const snapshot = buildRideCapabilityClaimsV2({
    activity: structuredClone(fixture.activity),
    series: structuredClone(fixture.series),
  }, { profile: createUserProfile({ ftpWatts: 240 }, START) });
  assert.equal(getEvidenceCapabilityV2(snapshot, "speed").status, "unavailable");
  assert.equal(getEvidenceCapabilityV2(snapshot, "cruise").status, "unavailable");
  assert.equal(getEvidenceCapabilityV2(snapshot, "cruise").unavailableReason, "DEPENDENCY_UNAVAILABLE:speed");
  assert.equal(validateRideCapabilityClaimsV2(snapshot).length, 0);
});

test("untimed rides cannot unlock timing, process, NP, IF, or TSS", () => {
  const snapshot = buildRideCapabilityClaimsV2(record(Array.from({ length: 12 }, () => ({
    seconds: 10, speed: 5, power: 200, heartRate: 140, cadence: 85,
  })), { timed: false }), { profile: createUserProfile({ ftpWatts: 250 }, START) });
  for (const key of ["timing", "sensorContinuity", "powerStability", "normalizedPower", "intensity", "trainingLoad"] as const) {
    assert.equal(getEvidenceCapabilityV2(snapshot, key).status, "unavailable", key);
  }
  assert.notEqual(getEvidenceCapabilityV2(snapshot, "power").status, "unavailable");
});

test("same-window relation claims keep correlation and causation boundaries", () => {
  const snapshot = buildRideCapabilityClaimsV2(completeRecord());
  const relations = snapshot.claims.filter((item) => item.kind === "relation");
  assert.ok(relations.length >= 4);
  assert.ok(relations.every((item) => item.supports.includes("same_window_observation")));
  assert.ok(relations.every((item) => item.prohibits.includes("causation") && item.prohibits.includes("response_order")));
});

test("snapshot validator rejects unsupported capability and broken claim evidence", () => {
  const snapshot = buildRideCapabilityClaimsV2(completeRecord());
  getEvidenceCapabilityV2(snapshot, "historyComparison").status = "available";
  getEvidenceCapabilityV2(snapshot, "historyComparison").qualityStatus = "valid";
  getEvidenceCapabilityV2(snapshot, "historyComparison").unavailableReason = undefined;
  snapshot.claims[0]!.sourceRefs[0]!.version = "stale";
  const codes = validateRideCapabilityClaimsV2(snapshot).map((item) => item.code);
  assert.ok(codes.includes("CAPABILITY_EVIDENCE_MISSING"));
  assert.ok(codes.includes("CLAIM_SOURCE_INVALID"));
});

test("IF and TSS use contiguous NP, confirmed FTP, and eligible power time", () => {
  const snapshot = buildRideCapabilityClaimsV2(completeRecord(200), {
    profile: createUserProfile({ ftpWatts: 250 }, START),
  });
  assert.equal(claimValue(snapshot, "power.normalizedW"), 200);
  assert.equal(claimValue(snapshot, "power.intensityFactor"), 0.8);
  assert.equal(claimValue(snapshot, "power.trainingStressScore"), (120 * 200 * 0.8 / (250 * 3_600)) * 100);
});
