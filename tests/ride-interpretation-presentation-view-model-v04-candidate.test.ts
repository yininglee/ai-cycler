import assert from "node:assert/strict";
import test from "node:test";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { assembleRideInterpretationPresentationV04Candidate } from "../src/ai/ride-interpretation-presentation-v04-candidate.ts";
import { buildRideInterpretationPresentationViewModelV04Candidate } from "../src/ai/ride-interpretation-presentation-view-model-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function candidate() {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  const context = buildRideAnalysisContext(record, { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z") });
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  assert.ok(input);
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const presentation = assembleRideInterpretationPresentationV04Candidate(output, input);
  return { record, presentation };
}

test("candidate presentation VM resolves L8 visual refs to deterministic charts", () => {
  const { record, presentation } = candidate();
  const viewModel = buildRideInterpretationPresentationViewModelV04Candidate(record, presentation);
  assert.equal(viewModel.validationStatus, "accepted");
  assert.deepEqual(viewModel.unresolvedVisualIds, []);
  assert.ok(viewModel.renderedBlocks.some((block) => block.visuals.some((visual) => visual.chartKey === "power")));
  assert.equal(viewModel.renderedBlocks[0]?.visuals.length, 0);
});

test("candidate presentation VM rejects a visual without an existing deterministic chart", () => {
  const { record, presentation } = candidate();
  const changed = structuredClone(presentation);
  changed.traceRefs.visualRefIds = [...changed.traceRefs.visualRefIds, "visual:relation:unknown"];
  changed.resolvedVisuals = [...changed.resolvedVisuals, {
    visualId: "visual:relation:unknown",
    type: "relation_trend",
    sourceClaimIds: [],
    availability: "available",
    ruleVersion: "ride-visual-rules-v0.1",
  }];
  const viewModel = buildRideInterpretationPresentationViewModelV04Candidate(record, changed);
  assert.equal(viewModel.validationStatus, "rejected");
  assert.deepEqual(viewModel.renderedBlocks, []);
  assert.deepEqual(viewModel.unresolvedVisualIds, ["visual:relation:unknown"]);
  assert.ok(viewModel.errorCodes.includes("DETERMINISTIC_VISUAL_NOT_FOUND"));
});

test("rejected L8 presentation cannot expose candidate blocks through the view model", () => {
  const { record, presentation } = candidate();
  const rejected = { ...presentation, validationStatus: "rejected" as const, errorCodes: ["TEST_REJECTED"], renderedBlocks: [] };
  const viewModel = buildRideInterpretationPresentationViewModelV04Candidate(record, rejected);
  assert.equal(viewModel.validationStatus, "rejected");
  assert.deepEqual(viewModel.renderedBlocks, []);
  assert.ok(viewModel.errorCodes.includes("SOURCE_PRESENTATION_REJECTED"));
});
