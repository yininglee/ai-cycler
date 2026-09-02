import assert from "node:assert/strict";

import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function profile() {
  return createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
}

function planFor(fixtureId: string, mode: "default" | "expanded" = "default", softPowerGap = false) {
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (softPowerGap) {
    record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  }
  const context = buildRideAnalysisContext(record, { profile: profile() });
  return buildRideInterpretationPlan(context, buildAnalysisEligibility(context), mode);
}

const defaultPlan = planFor("l3-power-preview");
assert.ok(defaultPlan.candidate, "L3 default plan must be available");
assert.ok(defaultPlan.focusDimensionIds.length <= 3, "default focus budget must be at most three");
assert.equal(defaultPlan.candidate.dimensionAvailability.history_change, "hidden");
assert.ok(defaultPlan.exclusions.some((entry) => entry.dimensionId === "history_change" && entry.reason === "persistent_history_deferred"));
assert.ok(defaultPlan.candidate.dimensionInterpretations.every((unit) => unit.visualRefIds.length === 1));
console.log("PASS l3-default");

const expandedPlan = planFor("l3-power-preview", "expanded");
assert.ok(expandedPlan.candidate, "L3 expanded plan must be available");
assert.deepEqual(expandedPlan.focusDimensionIds, expandedPlan.eligibleDimensionIds);
assert.deepEqual(
  expandedPlan.candidate.dimensionInterpretations.map((unit) => unit.dimensionId),
  expandedPlan.eligibleDimensionIds,
);
console.log("PASS l3-expanded");

const softPowerPlan = planFor("l3-power-preview", "default", true);
assert.ok(softPowerPlan.candidate, "soft power plan must be available");
assert.equal(softPowerPlan.candidate.dimensionAvailability.power_output, "partial");
assert.ok(softPowerPlan.candidate.limitations.some((entry) => entry.dimensionId === "power_output"));
console.log("PASS l3-soft-power");

const noSensorFixture = getRideFixture("l1-built-in-sample");
const noSensorRecord = { activity: structuredClone(noSensorFixture.activity), series: structuredClone(noSensorFixture.series) };
const noSensorContext = buildRideAnalysisContext(noSensorRecord);
const noSensorPlan = buildRideInterpretationPlan(noSensorContext, buildAnalysisEligibility(noSensorContext));
assert.ok(noSensorPlan.candidate, "route and terrain plan must remain available without optional sensors");
for (const dimensionId of ["heart_rate", "power_output", "cadence"] as const) {
  assert.equal(noSensorPlan.candidate.dimensionAvailability[dimensionId], "hidden");
  assert.equal(noSensorPlan.candidate.dimensionInterpretations.some((unit) => unit.dimensionId === dimensionId), false);
}
console.log("PASS l1-optional-sensors-hidden");

console.log("Ride interpretation plan preflight passed: 4 scenarios, no model calls.");
