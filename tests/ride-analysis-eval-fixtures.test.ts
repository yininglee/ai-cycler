import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { validateRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import { getRideAnalysisEvalFixture, rideAnalysisEvalCaseIds } from "../src/fixtures/ride-analysis-eval.ts";

test("T001 supplemental fixtures build valid v0.3 model contexts", () => {
  for (const caseId of rideAnalysisEvalCaseIds) {
    const fixture = getRideAnalysisEvalFixture(caseId);
    const prepared = prepareRideAnalysis(fixture.record, "eval-t001", fixture.contextOptions);
    const contextValidation = validateRideAnalysisContext(prepared.context);
    assert.equal(contextValidation.valid, true, `${caseId}: ${JSON.stringify(contextValidation.issues)}`);
    assert.equal(prepared.eligibility.eligible, true, `${caseId} must remain eligible for automatic analysis`);
    assert.deepEqual(prepared.eligibility.allowedDimensionKeys, fixture.expectedDimensionKeys, caseId);
    assert.equal(Boolean(prepared.context.historicalComparison && prepared.eligibility.allowedDimensionKeys.includes("history")), fixture.expectedHistoryAvailable, caseId);
    assert.equal(prepared.context.rideId, fixture.record.activity.rideId, caseId);
  }
});

test("T001 supplemental fixtures preserve their intended capability boundaries", () => {
  const estimated = prepareRideAnalysis(getRideAnalysisEvalFixture("RA-AUTO-007").record, "eval-t001", getRideAnalysisEvalFixture("RA-AUTO-007").contextOptions);
  assert.equal(estimated.context.profileFacts.maxHeartRate?.source, "system_estimated");
  assert.equal(estimated.context.profileFacts.maxHeartRate?.formulaVersion, "max-heart-rate-220-age-v1");

  const noBaseline = prepareRideAnalysis(getRideAnalysisEvalFixture("RA-AUTO-009").record, "eval-t001", getRideAnalysisEvalFixture("RA-AUTO-009").contextOptions);
  assert.equal(noBaseline.context.profileFacts.maxHeartRate, undefined);
  assert.equal(noBaseline.context.capabilities.find((item) => item.key === "maxHeartRateBaseline")?.available, false);

  const indoorHeartRate = prepareRideAnalysis(getRideAnalysisEvalFixture("RA-AUTO-010").record, "eval-t001", {});
  assert.equal(indoorHeartRate.context.capabilities.find((item) => item.key === "route")?.available, false);
  assert.equal(indoorHeartRate.context.capabilities.find((item) => item.key === "heartRate")?.available, true);
  assert.deepEqual(buildAnalysisEligibility(indoorHeartRate.context).allowedDimensionKeys, ["heartRate"]);

  const indoorPower = prepareRideAnalysis(getRideAnalysisEvalFixture("RA-AUTO-015").record, "eval-t001", {});
  assert.equal(indoorPower.context.capabilities.find((item) => item.key === "power")?.available, true);
  assert.equal(indoorPower.context.capabilities.find((item) => item.key === "speed")?.available, false);
  assert.deepEqual(buildAnalysisEligibility(indoorPower.context).allowedDimensionKeys, ["power"]);

  for (const caseId of ["RA-AUTO-005", "RA-AUTO-013"] as const) {
    const fixture = getRideAnalysisEvalFixture(caseId);
    const prepared = prepareRideAnalysis(fixture.record, "eval-t001", fixture.contextOptions);
    assert.equal(prepared.context.historicalComparison?.comparability.status, "not_comparable");
    assert.equal(prepared.eligibility.allowedDimensionKeys.includes("history"), false);
  }
});
