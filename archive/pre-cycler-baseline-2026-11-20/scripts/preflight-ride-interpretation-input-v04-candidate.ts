import assert from "node:assert/strict";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function inputFor(fixtureId: string, mode: "default" | "expanded" = "default", softPowerGap = false) {
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (softPowerGap) record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const context = buildRideAnalysisContext(record, { profile });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context), mode);
  return { context, input: projectRideInterpretationInputV04Candidate(context, plan) };
}

const { context: defaultContext, input: defaultInput } = inputFor("l3-power-preview");
assert.ok(defaultInput, "L3 default input must be available");
assert.ok(defaultInput.allowedClaims.length < defaultContext.allowedClaims.length, "L7 must not project the complete context");
assert.ok(defaultInput.dimensionInterpretations.length <= 3, "default input must preserve the focus budget");
assert.equal(defaultInput.dimensionInterpretations.some((unit) => unit.dimensionId === "history_change"), false);
console.log("PASS l3-default-minimal-input");

const { input: expandedInput } = inputFor("l3-power-preview", "expanded");
assert.ok(expandedInput, "L3 expanded input must be available");
assert.ok(expandedInput.dimensionInterpretations.some((unit) => unit.dimensionId === "pacing_stability"));
assert.ok(expandedInput.visualRegistry.some((visual) => visual.visualId === "visual:series:speed"));
console.log("PASS l3-expanded-visual-input");

const { input: softPowerInput } = inputFor("l3-power-preview", "default", true);
assert.ok(softPowerInput, "soft power input must be available");
assert.ok(softPowerInput.limitations.some((limitation) => limitation.dimensionId === "power_output"));
console.log("PASS l3-soft-power-limitation");

const l1Fixture = getRideFixture("l1-built-in-sample");
const l1Context = buildRideAnalysisContext({ activity: structuredClone(l1Fixture.activity), series: structuredClone(l1Fixture.series) });
const l1Plan = buildRideInterpretationPlan(l1Context, buildAnalysisEligibility(l1Context));
const l1Input = projectRideInterpretationInputV04Candidate(l1Context, l1Plan);
assert.ok(l1Input, "L1 route and terrain input must be available");
for (const dimensionId of ["heart_rate", "power_output", "cadence"] as const) {
  assert.equal(l1Input.dimensionInterpretations.some((unit) => unit.dimensionId === dimensionId), false);
}
console.log("PASS l1-optional-sensors-hidden");

console.log("Ride interpretation input preflight passed: 4 scenarios, no model calls.");
