import assert from "node:assert/strict";
import test from "node:test";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import {
  ONE_LINE_LABEL_MAX_LENGTH,
  buildRideInterpretationOutputV04CandidateFixture,
  normalizeRideInterpretationOutputV04Candidate,
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

function inputForFixture(fixtureId: string) {
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
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

test("candidate output allows only the evidence a natural-language card actually uses", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);

  const concise = structuredClone(output);
  concise.overallAssessment.claimIds = concise.overallAssessment.claimIds.slice(0, 2);
  concise.dimensions[0]!.claimIds = concise.dimensions[0]!.claimIds.slice(0, 2);
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(concise, input), { valid: true, issues: [] });

  const combinedOverall = structuredClone(output);
  const reusableDimensionClaim = input.dimensionInterpretations
    .flatMap((dimension) => [
      ...dimension.factClaimIds,
      ...dimension.performanceClaimIds,
      ...dimension.capabilityEvidenceClaimIds,
      ...dimension.meaningClaimIds,
    ])
    .find((claimId) => !combinedOverall.overallAssessment.claimIds.includes(claimId));
  assert.ok(reusableDimensionClaim);
  const reusableCandidate = input.candidateClaims.find((claim) => claim.claimId === reusableDimensionClaim);
  const reusableSource = input.allowedClaims.find((claim) => claim.claimId === reusableCandidate?.sourceClaimIds[0]);
  assert.ok(reusableSource?.displayValue);
  combinedOverall.overallAssessment.claimIds = [
    ...combinedOverall.overallAssessment.claimIds,
    reusableDimensionClaim,
  ].filter((claimId, index, ids) => ids.indexOf(claimId) === index);
  combinedOverall.overallAssessment.text = `整体补充${reusableSource.displayValue}${reusableSource.displayUnit ?? ""}。`;
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(combinedOverall, input), { valid: true, issues: [] });

  const crossPlanEvidence = structuredClone(output);
  crossPlanEvidence.dimensions[0]!.claimIds = [crossPlanEvidence.dimensions[1]!.claimIds[0]!];
  assert.ok(validateRideInterpretationOutputV04Candidate(crossPlanEvidence, input).issues.includes("DIMENSION_power_output_CLAIM_OUTSIDE_PLAN"));
});

test("candidate output rejects plan drift, misplaced highlights, and invalid action evidence", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);

  const changedVisual = structuredClone(output);
  changedVisual.dimensions[0]!.visualRefIds = ["visual:invented"];
  assert.ok(validateRideInterpretationOutputV04Candidate(changedVisual, input).issues.includes("DIMENSION_power_output_VISUAL_MISMATCH"));

  const inventedHighlight = structuredClone(output);
  inventedHighlight.highlights = [{ text: "越权高光", claimIds: ["invented"], visualRefIds: [], target: { kind: "overall" } }];
  assert.ok(validateRideInterpretationOutputV04Candidate(inventedHighlight, input).issues.includes("HIGHLIGHT_0_CLAIM_INVALID"));

  const dimensionTargetHighlight = structuredClone(output);
  dimensionTargetHighlight.highlights = [{
    text: "错误地使用了维度归属。",
    claimIds: [dimensionTargetHighlight.dimensions[1]!.claimIds[0]!],
    visualRefIds: [],
    target: { kind: "dimension", dimensionId: dimensionTargetHighlight.dimensions[0]!.dimensionId },
  }] as unknown as typeof dimensionTargetHighlight.highlights;
  assert.ok(validateRideInterpretationOutputV04Candidate(dimensionTargetHighlight, input).issues.includes("HIGHLIGHT_0_TARGET_INVALID"));

  const invalidAction = structuredClone(output);
  invalidAction.nextAction = { kind: "general", text: "整理本次体感。", basisClaimIds: [input.candidateClaims[0]!.claimId] };
  assert.ok(validateRideInterpretationOutputV04Candidate(invalidAction, input).issues.includes("GENERAL_ACTION_HAS_BASIS"));
});

test("candidate output keeps all highlights in the overall assessment evidence boundary", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  assert.ok(output.highlights.every((highlight) => highlight.target.kind === "overall"));
  assert.ok(output.highlights.every((highlight) => highlight.claimIds.every((claimId) => output.overallAssessment.claimIds.includes(claimId))));
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(output, input), { valid: true, issues: [] });
});

test("candidate output requires one next action and defaults to general without evidence", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  assert.equal(output.nextAction.kind, "general");
  assert.deepEqual(output.nextAction.basisClaimIds, []);

  const missingAction = { ...structuredClone(output), nextAction: null } as unknown as typeof output;
  const validation = validateRideInterpretationOutputV04Candidate(missingAction, input);
  assert.ok(validation.issues.includes("NEXT_ACTION_REQUIRED"));
});

test("candidate output rejects missing highlights instead of masking an end-node mapping error", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const normalized = normalizeRideInterpretationOutputV04Candidate({ ...output, highlights: null });
  assert.equal(normalized, undefined);

  const trimmed = normalizeRideInterpretationOutputV04Candidate({
    ...output,
    highlights: [...output.highlights, ...output.highlights, ...output.highlights, ...output.highlights],
  });
  assert.ok(trimmed);
  assert.equal(trimmed.highlights.length, 3);
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(trimmed, input), { valid: true, issues: [] });
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

  const cautiousLongTermReference = structuredClone(output);
  cautiousLongTermReference.overallAssessment.text = "本次可作为后续骑行能力观察的一次参考。";
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(cautiousLongTermReference, input), { valid: true, issues: [] });

  const actionInOverall = structuredClone(output);
  actionInOverall.overallAssessment.text = "建议下次继续记录本次体感变化。";
  assert.ok(validateRideInterpretationOutputV04Candidate(actionInOverall, input).issues.includes("OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"));

  const actionInDimension = structuredClone(output);
  actionInDimension.dimensions[0]!.text = "建议下次继续观察这一维度的变化。";
  assert.ok(validateRideInterpretationOutputV04Candidate(actionInDimension, input).issues.includes("DIMENSION_power_output_ACTION_LANGUAGE_NOT_ALLOWED"));

  const commonSenseActionInOverall = structuredClone(output);
  commonSenseActionInOverall.overallAssessment.text = "本次记录显示后程心率偏高，建议骑后适当休息并补水。";
  assert.ok(validateRideInterpretationOutputV04Candidate(commonSenseActionInOverall, input).issues.includes("OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"));

  const commonSenseActionInDimension = structuredClone(output);
  commonSenseActionInDimension.dimensions[0]!.text = "该维度后程波动较大，建议下次留意体感并适当调整节奏。";
  assert.ok(validateRideInterpretationOutputV04Candidate(commonSenseActionInDimension, input).issues.includes("DIMENSION_power_output_ACTION_LANGUAGE_NOT_ALLOWED"));

  const commonSenseMonitoringAction = structuredClone(output);
  commonSenseMonitoringAction.overallAssessment.text = "本次心率变化值得关注，建议下次查看体感并按需调整节奏。";
  assert.ok(validateRideInterpretationOutputV04Candidate(commonSenseMonitoringAction, input).issues.includes("OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"));

  const unsafeActionInOverall = structuredClone(output);
  unsafeActionInOverall.overallAssessment.text = "建议下次增加高强度训练安排。";
  assert.ok(validateRideInterpretationOutputV04Candidate(unsafeActionInOverall, input).issues.includes("OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"));

  const implicitUnsafeActionInOverall = structuredClone(output);
  implicitUnsafeActionInOverall.overallAssessment.text = "安排间歇训练以提升能力。";
  assert.ok(validateRideInterpretationOutputV04Candidate(implicitUnsafeActionInOverall, input).issues.includes("OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"));

  const longTermCapabilityInHighlight = structuredClone(output);
  longTermCapabilityInHighlight.highlights = [{
    text: "可作为后续骑行能力观察的一次参考。",
    claimIds: [longTermCapabilityInHighlight.overallAssessment.claimIds[0]!],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  assert.ok(validateRideInterpretationOutputV04Candidate(longTermCapabilityInHighlight, input).issues.includes("HIGHLIGHT_0_LONG_TERM_CAPABILITY_LANGUAGE"));

  const causalInference = structuredClone(output);
  causalInference.dimensions[0]!.text = "因为该维度变化，所以表现发生变化。";
  assert.ok(validateRideInterpretationOutputV04Candidate(causalInference, input).issues.includes("DIMENSION_power_output_UNSUPPORTED_CAUSALITY"));

  const dataCompleteness = structuredClone(output);
  dataCompleteness.dimensions[0]!.text = "数据记录完整，因此可作为结论。";
  assert.ok(validateRideInterpretationOutputV04Candidate(dataCompleteness, input).issues.includes("DIMENSION_power_output_DATA_COMPLETENESS_EVALUATION"));

});

test("candidate rejects terrain data-completeness wording", () => {
  const input = inputForFixture("l2-fit-heart-rate");
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const terrainDimension = output.dimensions.find((dimension) => dimension.dimensionId === "terrain_climb");
  if (!terrainDimension) return;
  terrainDimension.text = "爬坡数据完整，说明本次路线记录充分。";
  assert.ok(validateRideInterpretationOutputV04Candidate(output, input).issues.includes("DIMENSION_terrain_climb_DATA_COMPLETENESS_EVALUATION"));
});

test("one-line labels allow traceable numbers and fall back to factual wording without performance evidence", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const factCandidateId = input.overallAssessment.factClaimIds[0]!;
  const factCandidate = input.candidateClaims.find((claim) => claim.claimId === factCandidateId);
  const factSource = input.allowedClaims.find((claim) => claim.claimId === factCandidate?.sourceClaimIds[0]);
  assert.equal(typeof factSource?.displayValue, "string");

  const numericFactLabel = structuredClone(output);
  numericFactLabel.oneLineLabel = {
    text: `功率${factSource!.displayValue}${factSource!.displayUnit}`,
    claimIds: [factCandidateId],
  };
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(numericFactLabel, input), { valid: true, issues: [] });

  const unsupportedFactEvaluation = structuredClone(numericFactLabel);
  unsupportedFactEvaluation.oneLineLabel.text = "本次功率表现出色。";
  assert.ok(validateRideInterpretationOutputV04Candidate(unsupportedFactEvaluation, input).issues.includes("ONE_LINE_LABEL_EVALUATION_WITHOUT_PERFORMANCE_EVIDENCE"));
});

test("one-line labels can use performance evidence to describe a supported ride characteristic", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const performanceClaimId = output.oneLineLabel.claimIds[0]!;
  const performanceCandidate = input.candidateClaims.find((claim) => claim.claimId === performanceClaimId);
  const performanceSource = input.allowedClaims.find((claim) => claim.claimId === performanceCandidate?.sourceClaimIds[0]);
  assert.ok(performanceSource?.displayValue);

  const dataOnlyLabel = structuredClone(output);
  dataOnlyLabel.oneLineLabel.text = `功率${performanceSource!.displayValue}${performanceSource!.displayUnit}`;
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(dataOnlyLabel, input), { valid: true, issues: [] });

  const characteristicLabel = structuredClone(dataOnlyLabel);
  characteristicLabel.oneLineLabel.text = `功率稳定${performanceSource!.displayValue}${performanceSource!.displayUnit}`;
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(characteristicLabel, input), { valid: true, issues: [] });
});

test("one-line labels are limited to twelve visible characters", () => {
  const input = inputFor();
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const compactLabel = structuredClone(output);
  const distanceFactId = input.candidateClaims.find((claim) => claim.dimensionId === "route_pacing" && claim.claimType === "fact")?.claimId;
  assert.ok(distanceFactId);
  compactLabel.oneLineLabel.claimIds = [...compactLabel.oneLineLabel.claimIds, distanceFactId];
  compactLabel.oneLineLabel.text = "45公里中长途稳定骑行";
  assert.equal(Array.from(compactLabel.oneLineLabel.text).length, 11);
  assert.deepEqual(validateRideInterpretationOutputV04Candidate(compactLabel, input), { valid: true, issues: [] });

  const tooLongLabel = structuredClone(compactLabel);
  tooLongLabel.oneLineLabel.text = "45公里中长途稳定骑行表现";
  assert.equal(Array.from(tooLongLabel.oneLineLabel.text).length, ONE_LINE_LABEL_MAX_LENGTH + 1);
  assert.ok(validateRideInterpretationOutputV04Candidate(tooLongLabel, input).issues.includes("ONE_LINE_LABEL_TOO_LONG"));
});
