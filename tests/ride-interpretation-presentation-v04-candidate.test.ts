import assert from "node:assert/strict";
import test from "node:test";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { assembleRideInterpretationPresentationV04Candidate } from "../src/ai/ride-interpretation-presentation-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function presentationFor(softPowerGap = false) {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (softPowerGap) record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const context = buildRideAnalysisContext(record, { profile });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
  const input = projectRideInterpretationInputV04Candidate(context, plan);
  assert.ok(input);
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  return { input, output };
}

test("accepted output becomes an ordered, traceable presentation without creating new content", () => {
  const { input, output } = presentationFor();
  const presentation = assembleRideInterpretationPresentationV04Candidate(output, input);

  assert.equal(presentation.validationStatus, "accepted");
  assert.equal(presentation.fallbackLevel, "none");
  assert.deepEqual(presentation.errorCodes, []);
  assert.deepEqual(presentation.acceptedOutput, output);
  assert.deepEqual(presentation.renderedBlocks.slice(0, 2).map((block) => block.kind), ["one_line_label", "overall_assessment"]);
  const highlightIndex = presentation.renderedBlocks.findIndex((block) => block.blockId.startsWith("highlight:overall:"));
  const firstDimensionIndex = presentation.renderedBlocks.findIndex((block) => block.kind === "dimension");
  assert.ok(highlightIndex > 1 && highlightIndex < firstDimensionIndex);
  const firstDimension = output.dimensions[0]!;
  const dimensionBlockIndex = presentation.renderedBlocks.findIndex((block) => block.blockId === `dimension:${firstDimension.dimensionId}`);
  assert.notEqual(presentation.renderedBlocks[dimensionBlockIndex + 1]?.kind, "highlight");
  assert.ok(presentation.renderedBlocks.filter((block) => block.kind === "highlight").every((block) => block.blockId.startsWith("highlight:overall:")));
  assert.deepEqual(presentation.renderedBlocks.filter((block) => block.kind === "dimension").map((block) => block.dimensionId), output.dimensions.map((dimension) => dimension.dimensionId));
  assert.ok(presentation.traceRefs.candidateClaimIds.every((claimId) => input.candidateClaims.some((claim) => claim.claimId === claimId)));
  assert.ok(presentation.resolvedVisuals.every((visual) => input.visualRegistry.some((entry) => entry.visualId === visual.visualId)));
});

test("partial data keeps its limitation next to the affected dimension", () => {
  const { input, output } = presentationFor(true);
  const presentation = assembleRideInterpretationPresentationV04Candidate(output, input);
  const powerDimensionIndex = presentation.renderedBlocks.findIndex((block) => block.blockId === "dimension:power_output");
  const powerLimitationIndex = presentation.renderedBlocks.findIndex((block) => block.blockId === "limitation:power_output");

  assert.equal(presentation.validationStatus, "accepted");
  assert.ok(powerLimitationIndex > powerDimensionIndex);
  assert.ok(presentation.renderedBlocks.slice(powerDimensionIndex + 1, powerLimitationIndex).every((block) => block.kind !== "highlight"));
});

test("invalid output rejects all candidate text and visuals for B0 fallback", () => {
  const { input, output } = presentationFor();
  output.overallAssessment.text = "本次事实为 999。";
  const presentation = assembleRideInterpretationPresentationV04Candidate(output, input);

  assert.equal(presentation.validationStatus, "rejected");
  assert.equal(presentation.fallbackLevel, "b0");
  assert.equal(presentation.acceptedOutput, null);
  assert.deepEqual(presentation.resolvedVisuals, []);
  assert.deepEqual(presentation.renderedBlocks, []);
  assert.deepEqual(presentation.traceRefs, { candidateClaimIds: [], sourceClaimIds: [], visualRefIds: [] });
  assert.ok(presentation.errorCodes.includes("OVERALL_UNSUPPORTED_NUMBER"));
});
