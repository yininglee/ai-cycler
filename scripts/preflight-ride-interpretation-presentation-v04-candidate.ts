import assert from "node:assert/strict";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { assembleRideInterpretationPresentationV04Candidate } from "../src/ai/ride-interpretation-presentation-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function candidateFor(softPowerGap = false) {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (softPowerGap) record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const context = buildRideAnalysisContext(record, { profile });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
  const input = projectRideInterpretationInputV04Candidate(context, plan);
  assert.ok(input);
  return { input, output: buildRideInterpretationOutputV04CandidateFixture(input) };
}

const accepted = candidateFor();
const acceptedPresentation = assembleRideInterpretationPresentationV04Candidate(accepted.output, accepted.input);
assert.equal(acceptedPresentation.validationStatus, "accepted");
assert.equal(acceptedPresentation.fallbackLevel, "none");
assert.ok(acceptedPresentation.resolvedVisuals.length > 0);
console.log("PASS accepted-presentation");

const partial = candidateFor(true);
const partialPresentation = assembleRideInterpretationPresentationV04Candidate(partial.output, partial.input);
assert.equal(partialPresentation.validationStatus, "accepted");
assert.ok(partialPresentation.renderedBlocks.some((block) => block.blockId === "limitation:power_output"));
console.log("PASS partial-limitation-adjacent");

const rejected = candidateFor();
rejected.output.overallAssessment.text = "你具备较强的长期骑行能力。";
const rejectedPresentation = assembleRideInterpretationPresentationV04Candidate(rejected.output, rejected.input);
assert.equal(rejectedPresentation.validationStatus, "rejected");
assert.equal(rejectedPresentation.fallbackLevel, "b0");
assert.deepEqual(rejectedPresentation.renderedBlocks, []);
assert.ok(rejectedPresentation.errorCodes.includes("OVERALL_LONG_TERM_CAPABILITY_LANGUAGE"));
console.log("PASS rejected-output-b0-fallback");

console.log("Ride interpretation presentation preflight passed: 3 scenarios, no model calls.");
