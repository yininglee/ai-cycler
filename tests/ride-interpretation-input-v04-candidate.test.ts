import assert from "node:assert/strict";
import test from "node:test";

import {
  projectRideInterpretationInputV04Candidate,
  validateRideInterpretationInputV04Candidate,
} from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";

function buildInput(fixtureId: string, options?: { mode?: "default" | "expanded"; softPowerGap?: boolean; profile?: boolean }) {
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (options?.softPowerGap) record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const profile = options?.profile === false ? undefined : createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
  const context = buildRideAnalysisContext(record, { profile });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context), options?.mode);
  return { context, plan, input: projectRideInterpretationInputV04Candidate(context, plan) };
}

test("candidate input projects only selected L6 evidence and registered visuals", () => {
  const { context, plan, input } = buildInput("l3-power-preview", { mode: "expanded" });

  assert.ok(input);
  assert.equal(input!.contractVersion, "ride-interpretation-input-v0.4-candidate");
  assert.deepEqual(input!.dimensionInterpretations.map((unit) => unit.dimensionId), plan.focusDimensionIds);
  assert.ok(input!.allowedClaims.length < context.allowedClaims.length);
  assert.equal(input!.dimensionInterpretations.some((unit) => unit.dimensionId === "history_change"), false);
  assert.equal("featureSnapshot" in input!, false);
  assert.equal("recordedMetrics" in input!, false);
  assert.equal("series" in input!, false);
  assert.ok(input!.visualRegistry.every((visual) => input!.allowedClaims.some((claim) => visual.sourceClaimIds.includes(claim.claimId))));
  assert.deepEqual(validateRideInterpretationInputV04Candidate(input!), { valid: true, issues: [] });
});

test("soft power limitation is preserved as a selected candidate limitation", () => {
  const { input } = buildInput("l3-power-preview", { softPowerGap: true });

  assert.ok(input);
  assert.ok(input!.limitations.some((limitation) => limitation.dimensionId === "power_output"));
  assert.ok(input!.candidateClaims.some((claim) => claim.claimType === "limitation" && claim.dimensionId === "power_output"));
});

test("optional sensor dimensions stay absent from the model input", () => {
  const { input } = buildInput("l1-built-in-sample", { profile: false });

  assert.ok(input);
  for (const dimensionId of ["heart_rate", "power_output", "cadence"] as const) {
    assert.equal(input!.dimensionInterpretations.some((unit) => unit.dimensionId === dimensionId), false);
    assert.equal(input!.candidateClaims.some((claim) => claim.dimensionId === dimensionId), false);
  }
});

test("candidate input rejects unselected evidence and history dimensions", () => {
  const { context, input } = buildInput("l3-power-preview");
  assert.ok(input);

  const unexpectedClaim = context.allowedClaims.find((claim) => !input!.allowedClaims.some((allowed) => allowed.claimId === claim.claimId))!;
  const expandedClaims = structuredClone(input!);
  expandedClaims.allowedClaims.push(unexpectedClaim);
  assert.ok(validateRideInterpretationInputV04Candidate(expandedClaims).issues.includes("UNSELECTED_SOURCE_CLAIM_EXPOSED"));

  const historyInput = structuredClone(input!);
  historyInput.dimensionInterpretations[0]!.dimensionId = "history_change";
  assert.ok(validateRideInterpretationInputV04Candidate(historyInput).issues.includes("HISTORY_DIMENSION_NOT_ALLOWED"));

  const historyClaimInput = structuredClone(input!);
  historyClaimInput.candidateClaims[0]!.dimensionId = "history_change";
  assert.ok(validateRideInterpretationInputV04Candidate(historyClaimInput).issues.includes("HISTORY_CLAIM_NOT_ALLOWED"));
});
