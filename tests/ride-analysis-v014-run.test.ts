import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateRideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import {
  RIDE_ANALYSIS_PROMPT_VERSION,
  RIDE_ANALYSIS_SERVICE_VERSION,
  RIDE_ANALYSIS_WORKFLOW_VERSION,
  prepareRideAnalysis,
} from "../src/ai/ride-analysis-service.ts";
import { RIDE_FEATURE_RULES_VERSION } from "../src/domain/ride-features.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

interface V014L3Run {
  case_id: string;
  version_matrix: {
    feature_rules_version: string;
    prompt_version_claimed: string;
    service_validation_version: string;
    workflow_version_claimed: string;
    few_shot_mode: string;
    model_id: string;
  };
  corrected_replay_version_matrix: {
    feature_rules_version: string;
    service_validation_version: string;
    model_called: boolean;
  };
  request_metadata: {
    request_id: string;
    latency_ms: string;
    total_tokens: string;
    cost_cny: string;
  };
  raw_output: unknown;
  original_contract_validation: { status: string; issues: string[]; model_called_during_validation: boolean };
  corrected_service_validation: { status: string; issues: string[]; model_called_during_validation: boolean };
}

const run = JSON.parse(
  readFileSync(new URL("../eval/runs/RUN-20260824-023.json", import.meta.url), "utf8"),
) as V014L3Run;

test("RUN-20260824-023 replays the user-provided v3.1.2 L3 output through the current contract", () => {
  const fixture = getRideFixture(run.case_id);
  const prepared = prepareRideAnalysis(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    "eval-v014-run-023",
  );
  const result = validateRideAnalysisOutputV03(run.raw_output, prepared.context, prepared.eligibility);

  assert.equal(run.version_matrix.prompt_version_claimed, RIDE_ANALYSIS_PROMPT_VERSION);
  assert.equal(run.version_matrix.service_validation_version, "ride-analysis-service-v1.4");
  assert.equal(run.version_matrix.feature_rules_version, "ride-feature-rules-v0.1");
  assert.equal(run.version_matrix.workflow_version_claimed, RIDE_ANALYSIS_WORKFLOW_VERSION);
  assert.equal(run.version_matrix.few_shot_mode, "disabled");
  assert.equal(run.corrected_replay_version_matrix.service_validation_version, RIDE_ANALYSIS_SERVICE_VERSION);
  assert.equal(run.corrected_replay_version_matrix.feature_rules_version, RIDE_FEATURE_RULES_VERSION);
  assert.equal(run.corrected_replay_version_matrix.model_called, false);
  assert.equal(result.valid, true, result.issues.join(","));
  assert.deepEqual(result.issues, run.corrected_service_validation.issues);
  assert.equal(run.original_contract_validation.status, "FAIL");
  assert.deepEqual(run.original_contract_validation.issues, ["DIMENSION_UNSUPPORTED_NUMBER", "TEXT_UNSUPPORTED_NUMBER"]);
  assert.equal(run.corrected_service_validation.status, "PASS");
  assert.equal(run.corrected_service_validation.model_called_during_validation, false);
});

test("RUN-20260824-023 preserves missing provider metadata instead of inventing it", () => {
  assert.equal(run.version_matrix.model_id, "NOT_RECORDED");
  assert.equal(run.request_metadata.request_id, "NOT_RECORDED");
  assert.equal(run.request_metadata.latency_ms, "NOT_RECORDED");
  assert.equal(run.request_metadata.total_tokens, "NOT_RECORDED");
  assert.equal(run.request_metadata.cost_cny, "NOT_RECORDED");
});
