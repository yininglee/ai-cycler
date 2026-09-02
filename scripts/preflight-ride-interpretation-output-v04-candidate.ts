import assert from "node:assert/strict";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import {
  buildRideInterpretationOutputV04CandidateFixture,
  validateRideInterpretationOutputV04Candidate,
} from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function outputFor(fixtureId: string, softPowerGap = false, withProfile = true) {
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (softPowerGap) record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = withProfile ? createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW) : undefined;
  const context = buildRideAnalysisContext(record, { profile });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
  const input = projectRideInterpretationInputV04Candidate(context, plan);
  assert.ok(input, `${fixtureId} must create a candidate input`);
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  return { input, output };
}

const l3 = outputFor("l3-power-preview");
assert.deepEqual(validateRideInterpretationOutputV04Candidate(l3.output, l3.input), { valid: true, issues: [] });
assert.ok(l3.output.dimensions.length <= 3);
assert.ok(l3.output.dimensions.every((dimension) => dimension.text));
console.log("PASS l3-default-output");

const softPower = outputFor("l3-power-preview", true);
assert.ok(softPower.output.limitations.some((limitation) => limitation.dimensionId === "power_output"));
assert.deepEqual(validateRideInterpretationOutputV04Candidate(softPower.output, softPower.input), { valid: true, issues: [] });
console.log("PASS l3-soft-power-limitation");

const l1 = outputFor("l1-built-in-sample", false, false);
for (const dimensionId of ["heart_rate", "power_output", "cadence"] as const) {
  assert.equal(l1.output.dimensions.some((dimension) => dimension.dimensionId === dimensionId), false);
}
console.log("PASS l1-optional-sensors-hidden");

const drifted = structuredClone(l3.output);
drifted.dimensions[0]!.visualRefIds = ["visual:invented"];
assert.ok(validateRideInterpretationOutputV04Candidate(drifted, l3.input).issues.includes("DIMENSION_power_output_VISUAL_MISMATCH"));
console.log("PASS plan-drift-rejected");

const semanticViolation = structuredClone(l3.output);
semanticViolation.overallAssessment.text = "你具备较强的长期骑行能力。";
assert.ok(validateRideInterpretationOutputV04Candidate(semanticViolation, l3.input).issues.includes("OVERALL_LONG_TERM_CAPABILITY_LANGUAGE"));
console.log("PASS four-layer-semantic-boundary-rejected");

console.log("Ride interpretation output preflight passed: 5 scenarios, no model calls.");
