import assert from "node:assert/strict";
import test from "node:test";

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

function inputFor(softPowerGap = false) {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (softPowerGap) record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const context = buildRideAnalysisContext(record, { profile });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
  const input = projectRideInterpretationInputV04Candidate(context, plan);
  assert.ok(input);
  return input;
}

test("candidate output fixture mirrors the selected L7 plan", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);

  assert.deepEqual(validateRideInterpretationOutputV04Candidate(output, input), { valid: true, issues: [] });
  assert.deepEqual(output.dimensions.map((dimension) => dimension.dimensionId), input.dimensionInterpretations.map((dimension) => dimension.dimensionId));
  assert.equal(output.overallAssessment.text.includes("本次"), true);
  assert.equal(output.dimensions.every((dimension) => dimension.text.length > 0), true);
  assert.ok(output.highlights.length <= 3);
});

test("partial power output preserves its deterministic limitation", () => {
  const input = inputFor(true);
  const output = buildRideInterpretationOutputV04CandidateFixture(input);

  assert.ok(output.limitations.some((limitation) => limitation.dimensionId === "power_output"));
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(output, input), { valid: true, issues: [] });
});

test("candidate output rejects plan drift, invented events, and invalid action evidence", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);

  const changedVisual = structuredClone(output);
  changedVisual.dimensions[0]!.visualRefIds = ["visual:invented"];
  assert.ok(validateRideInterpretationOutputV04Candidate(changedVisual, input).issues.includes("DIMENSION_power_output_VISUAL_MISMATCH"));

  const inventedHighlight = structuredClone(output);
  inventedHighlight.highlights = [{ text: "越权高光", claimIds: ["invented"], visualRefIds: [] }];
  assert.ok(validateRideInterpretationOutputV04Candidate(inventedHighlight, input).issues.includes("HIGHLIGHT_0_CLAIM_INVALID"));

  const invalidAction = structuredClone(output);
  invalidAction.nextAction = { kind: "general", text: "整理本次体感。", basisClaimIds: [input.candidateClaims[0]!.claimId] };
  assert.ok(validateRideInterpretationOutputV04Candidate(invalidAction, input).issues.includes("GENERAL_ACTION_HAS_BASIS"));
});

test("candidate output validates each semantic layer against its own Claim boundary", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);

  const factCandidate = input.candidateClaims.find((claim) => claim.claimId === input.overallAssessment.factClaimIds[0]);
  const factSource = input.allowedClaims.find((claim) => claim.claimId === factCandidate?.sourceClaimIds[0]);
  assert.equal(typeof factSource?.value, "number");
  const allowedNumber = structuredClone(output);
  allowedNumber.overallAssessment.text = `本次事实为 ${factSource!.value}。`;
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(allowedNumber, input), { valid: true, issues: [] });

  const unsupportedNumber = structuredClone(output);
  unsupportedNumber.overallAssessment.text = "本次事实为 999。";
  assert.ok(validateRideInterpretationOutputV04Candidate(unsupportedNumber, input).issues.includes("OVERALL_UNSUPPORTED_NUMBER"));

  const longTermCapability = structuredClone(output);
  longTermCapability.overallAssessment.text = "你具备较强的长期骑行能力。";
  assert.ok(validateRideInterpretationOutputV04Candidate(longTermCapability, input).issues.includes("OVERALL_LONG_TERM_CAPABILITY_LANGUAGE"));

  const causalInference = structuredClone(output);
  causalInference.dimensions[0]!.text = "因为该维度变化，所以表现发生变化。";
  assert.ok(validateRideInterpretationOutputV04Candidate(causalInference, input).issues.includes("DIMENSION_power_output_UNSUPPORTED_CAUSALITY"));

  const dataCompleteness = structuredClone(output);
  dataCompleteness.dimensions[0]!.text = "数据记录完整，因此可作为结论。";
  assert.ok(validateRideInterpretationOutputV04Candidate(dataCompleteness, input).issues.includes("DIMENSION_power_output_DATA_COMPLETENESS_EVALUATION"));
});
