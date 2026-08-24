import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RIDE_ANALYSIS_PROMPT_VERSION,
  RIDE_ANALYSIS_SERVICE_VERSION,
  RIDE_ANALYSIS_WORKFLOW_VERSION,
  prepareRideAnalysis,
} from "../src/ai/ride-analysis-service.ts";
import { RIDE_FEATURE_RULES_VERSION } from "../src/domain/ride-features.ts";
import { validateB0RideAnalysis } from "../src/domain/ride-summary.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

interface B0Run {
  version_matrix: {
    service: string;
    prompt: string;
    workflow: string;
    feature_rules: string;
    fewShotMode: string;
    b0Template: string;
    provider_kind: string;
  };
  expected: { max_attempts: number; source: string; fallback_code: string; no_third_attempt: boolean };
  observed: {
    source: string;
    fallback_code: string;
    attempts: number;
    provider_call_count: number;
    no_third_attempt: boolean;
    provider_request_ids: string[];
    validation_issues: string[];
    selected_example_ids: string[];
    few_shot_mode: string;
    repair_instruction: string;
    repair_previous_output: string;
    b0_output_valid: boolean;
    b0_validation_issues: string[];
    b0_output: unknown;
  };
  execution_metadata: { real_model_called: boolean; provider_attempts: number; model_tokens: number; model_cost_cny: number };
  result: string;
}

const run = JSON.parse(
  readFileSync(new URL("../eval/runs/RUN-20260824-027.json", import.meta.url), "utf8"),
) as B0Run;

test("RUN-20260824-027 freezes the current final-version B0 degradation matrix", () => {
  assert.equal(run.version_matrix.service, RIDE_ANALYSIS_SERVICE_VERSION);
  assert.equal(run.version_matrix.prompt, RIDE_ANALYSIS_PROMPT_VERSION);
  assert.equal(run.version_matrix.workflow, RIDE_ANALYSIS_WORKFLOW_VERSION);
  assert.equal(run.version_matrix.feature_rules, RIDE_FEATURE_RULES_VERSION);
  assert.equal(run.version_matrix.fewShotMode, "disabled");
  assert.equal(run.version_matrix.b0Template, "b0-template-v0.1");
  assert.equal(run.version_matrix.provider_kind, "deterministic_test_double");
});

test("RUN-20260824-027 stops after one repair and returns the valid deterministic B0", () => {
  const fixture = getRideFixture("l3-built-in-sample");
  const prepared = prepareRideAnalysis(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    "eval-v014-b0-path",
  );

  assert.deepEqual(run.expected, {
    max_attempts: 2,
    source: "b0",
    fallback_code: "REPAIR_FAILED",
    no_third_attempt: true,
  });
  assert.equal(run.observed.source, "b0");
  assert.equal(run.observed.fallback_code, "REPAIR_FAILED");
  assert.equal(run.observed.attempts, 2);
  assert.equal(run.observed.provider_call_count, 2);
  assert.equal(run.observed.no_third_attempt, true);
  assert.deepEqual(run.observed.provider_request_ids, ["v014-b0-provider-1", "v014-b0-provider-2"]);
  assert.deepEqual(run.observed.validation_issues, ["OUTPUT_NOT_OBJECT"]);
  assert.deepEqual(run.observed.selected_example_ids, []);
  assert.equal(run.observed.few_shot_mode, "disabled");
  assert.match(run.observed.repair_instruction, /OUTPUT_NOT_OBJECT/);
  assert.equal(run.observed.repair_previous_output, "not-json");
  assert.equal(run.observed.b0_output_valid, true);
  assert.deepEqual(run.observed.b0_validation_issues, []);
  assert.deepEqual(run.observed.b0_output, prepared.b0.output);
  assert.equal(validateB0RideAnalysis(prepared.b0).valid, true);
  assert.equal(run.execution_metadata.real_model_called, false);
  assert.equal(run.execution_metadata.provider_attempts, 2);
  assert.equal(run.execution_metadata.model_tokens, 0);
  assert.equal(run.execution_metadata.model_cost_cny, 0);
  assert.equal(run.result, "PASS");
});
