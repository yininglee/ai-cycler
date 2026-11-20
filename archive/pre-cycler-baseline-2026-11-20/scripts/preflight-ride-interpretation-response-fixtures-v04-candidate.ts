import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import type { RideInterpretationOutputV04Candidate } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { assembleRideInterpretationPresentationV04Candidate } from "../src/ai/ride-interpretation-presentation-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

type InputId = "full" | "partial" | "formal-f02" | "formal-f04" | "formal-f05" | "formal-f09";
type FixtureCase = {
  id: string;
  inputId: InputId;
  output: RideInterpretationOutputV04Candidate;
  expected: { validationStatus: "accepted" | "rejected"; fallbackLevel: "none" | "b0"; issueCodes: string[] };
};

const payload = JSON.parse(readFileSync(resolve("eval/ride-interpretation-v0.4-candidate/response-fixtures.json"), "utf8")) as {
  schemaVersion: string;
  cases: FixtureCase[];
};
assert.equal(payload.schemaVersion, "ride-interpretation-response-fixtures-v0.1");
assert.equal(payload.cases.length, 35);

function inputFor(inputId: InputId) {
  const fixtureId = inputId === "formal-f02"
    ? "l1-gpx-normal"
    : inputId === "formal-f04"
      ? "l2-built-in-sample"
      : inputId === "formal-f05"
        ? "l2-fit-heart-rate"
        : inputId === "formal-f09"
          ? "fit-power-dropout-with-heart-rate"
          : "l3-power-preview";
  const fixture = getRideFixture(fixtureId);
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (inputId === "partial") record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const context = buildRideAnalysisContext(
    record,
    { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z") },
  );
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  assert.ok(input);
  return input;
}

for (const fixture of payload.cases) {
  const presentation = assembleRideInterpretationPresentationV04Candidate(fixture.output, inputFor(fixture.inputId));
  assert.equal(presentation.validationStatus, fixture.expected.validationStatus, `${fixture.id}: validation status`);
  assert.equal(presentation.fallbackLevel, fixture.expected.fallbackLevel, `${fixture.id}: fallback`);
  for (const issueCode of fixture.expected.issueCodes) {
    assert.ok(presentation.errorCodes.includes(issueCode), `${fixture.id}: missing ${issueCode}`);
  }
  if (fixture.expected.validationStatus === "accepted") {
    assert.ok(presentation.acceptedOutput, `${fixture.id}: accepted output missing`);
    assert.ok(presentation.renderedBlocks.length > 0, `${fixture.id}: rendered blocks missing`);
  } else {
    assert.equal(presentation.acceptedOutput, null, `${fixture.id}: rejected output leaked`);
    assert.deepEqual(presentation.renderedBlocks, [], `${fixture.id}: rejected blocks leaked`);
    assert.deepEqual(presentation.resolvedVisuals, [], `${fixture.id}: rejected visuals leaked`);
  }
  console.log(`PASS ${fixture.id}`);
}

console.log(`Ride interpretation response-fixture preflight passed: ${payload.cases.length} scenarios, no model calls.`);
