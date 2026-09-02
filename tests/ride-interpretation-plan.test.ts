import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function contextFor(fixtureId: string, withProfile = false) {
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  const profile = withProfile ? createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW) : undefined;
  const context = buildRideAnalysisContext(record, { profile });
  return { context, eligibility: buildAnalysisEligibility(context) };
}

test("default plan selects at most three dimensions from deterministic claims", () => {
  const { context, eligibility } = contextFor("l3-power-preview", true);
  const plan = buildRideInterpretationPlan(context, eligibility);

  assert.ok(plan.candidate);
  assert.ok(plan.focusDimensionIds.length <= 3);
  assert.deepEqual(plan.focusDimensionIds, ["power_output", "heart_rate", "route_pacing"]);
  assert.equal(plan.candidate!.dimensionAvailability.history_change, "hidden");
  assert.ok(plan.exclusions.some((item) => item.dimensionId === "history_change" && item.reason === "persistent_history_deferred"));
  assert.ok(plan.candidate!.dimensionInterpretations.every((unit) => unit.visualRefIds.length === 1));
});

test("expanded plan includes every eligible non-history dimension", () => {
  const { context, eligibility } = contextFor("l3-power-preview", true);
  const plan = buildRideInterpretationPlan(context, eligibility, "expanded");

  assert.ok(plan.candidate);
  assert.deepEqual(plan.focusDimensionIds, plan.eligibleDimensionIds);
  assert.equal(plan.focusDimensionIds.includes("history_change"), false);
  assert.equal(plan.focusDimensionIds.includes("pacing_stability"), true);
  assert.equal(plan.candidate!.visualRegistry.filter((visual) => visual.visualId === "visual:series:speed").length, 1);
});

test("soft power quality stays partial and carries a limitation reference", () => {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  // A 26-second gap exceeds the hard threshold but remains within the
  // deterministic soft-quality allowance and interpolation cap.
  record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const context = buildRideAnalysisContext(record, { profile });
  const eligibility = buildAnalysisEligibility(context);
  const plan = buildRideInterpretationPlan(context, eligibility);

  assert.ok(plan.candidate);
  assert.equal(plan.candidate!.dimensionAvailability.power_output, "partial");
  assert.ok(plan.candidate!.limitations.some((item) => item.dimensionId === "power_output"));
});

test("unavailable sensor dimensions remain hidden instead of creating placeholders", () => {
  const { context, eligibility } = contextFor("l1-built-in-sample");
  const plan = buildRideInterpretationPlan(context, eligibility);

  assert.ok(plan.candidate);
  assert.equal(plan.candidate!.dimensionAvailability.heart_rate, "hidden");
  assert.equal(plan.candidate!.dimensionAvailability.power_output, "hidden");
  assert.equal(plan.candidate!.dimensionAvailability.cadence, "hidden");
  assert.equal(plan.candidate!.dimensionInterpretations.some((unit) => unit.dimensionId === "heart_rate"), false);
  assert.equal(plan.candidate!.dimensionInterpretations.some((unit) => unit.dimensionId === "power_output"), false);
  assert.equal(plan.candidate!.dimensionInterpretations.some((unit) => unit.dimensionId === "cadence"), false);
  assert.ok(plan.exclusions.some((item) => item.dimensionId === "heart_rate"));
  assert.ok(plan.exclusions.some((item) => item.dimensionId === "power_output"));
  assert.ok(plan.exclusions.some((item) => item.dimensionId === "cadence"));
});
