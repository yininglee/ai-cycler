import assert from "node:assert/strict";
import test from "node:test";

import {
  disabledRideAnalysisFewShots,
  rideAnalysisFewShotLibrary,
  selectRideAnalysisFewShots,
  validateRideAnalysisFewShotLibrary,
} from "../src/ai/ride-analysis-few-shot.ts";
import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function prepared(fixtureId: string) {
  const fixture = getRideFixture(fixtureId);
  return prepareRideAnalysis({ activity: fixture.activity, series: fixture.series });
}

test("few-shot v0.1 retains ten synthetic draft categories without approving them for runtime", () => {
  assert.deepEqual(validateRideAnalysisFewShotLibrary(), []);
  assert.equal(rideAnalysisFewShotLibrary.examples.length, 10);
  assert.ok(rideAnalysisFewShotLibrary.examples.every((example) => example.qualityStatus === "draft_needs_review"));
});

test("the current baseline serializes no examples unless the feature is explicitly enabled", () => {
  const selected = disabledRideAnalysisFewShots();
  assert.equal(selected.mode, "disabled");
  assert.equal(selected.reason, "baseline_no_few_shot");
  assert.deepEqual(selected.exampleIds, []);
  assert.deepEqual(selected.examples, []);
});

test("the router deterministically refuses draft examples even when selection is requested", () => {
  const input = prepared("l3-built-in-sample");
  const first = selectRideAnalysisFewShots(input.context, input.eligibility);
  const second = selectRideAnalysisFewShots(input.context, input.eligibility);
  assert.deepEqual(first, second);
  assert.equal(first.mode, "disabled");
  assert.equal(first.reason, "no_approved_examples");
  assert.deepEqual(first.exampleIds, []);
  assert.deepEqual(first.examples, []);
});

test("repair also refuses the unapproved repair draft", () => {
  const input = prepared("l2-built-in-sample");
  const selected = selectRideAnalysisFewShots(input.context, input.eligibility, "repair");
  assert.equal(selected.mode, "disabled");
  assert.equal(selected.reason, "no_approved_examples");
  assert.deepEqual(selected.examples, []);
});

test("ineligible records receive no few-shot payload", () => {
  const input = prepared("fit-truncated-file");
  const selected = selectRideAnalysisFewShots(input.context, input.eligibility);
  assert.equal(input.eligibility.eligible, false);
  assert.deepEqual(selected.examples, []);
});
