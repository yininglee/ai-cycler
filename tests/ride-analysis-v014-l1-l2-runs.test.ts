import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

interface V014TrialRun {
  run_id: string;
  case_id: string;
  evidence_source: { metadata_screenshot: string };
  version_matrix: {
    feature_rules_version: string;
    prompt_version_claimed: string;
    service_validation_version: string;
    workflow_version_claimed: string;
    few_shot_mode: string;
    model_id: string;
    model_display_name: string;
  };
  request_metadata: {
    request_id: string;
    provider_request_id: string;
    workflow_duration_display_s: number;
    model_node_duration_display_s: number;
    latency_ms: string;
    input_tokens: string;
    output_tokens: string;
    total_tokens_displayed: number;
    cost_cny: string;
  };
  raw_output: unknown;
  service_validation: { status: string; issues: string[]; model_called_during_validation: boolean };
  human_review: { status: string };
}

const expectedMetadata = {
  "RUN-20260824-024": { caseId: "l1-built-in-sample", workflowSeconds: 11, nodeSeconds: 10, tokens: 8583 },
  "RUN-20260824-025": { caseId: "l2-built-in-sample", workflowSeconds: 16, nodeSeconds: 15, tokens: 11092 },
} as const;

for (const runId of Object.keys(expectedMetadata) as Array<keyof typeof expectedMetadata>) {
  const run = JSON.parse(
    readFileSync(new URL(`../eval/runs/${runId}.json`, import.meta.url), "utf8"),
  ) as V014TrialRun;
  const expected = expectedMetadata[runId];

  test(`${runId} replays the unchanged final v3.1.2 output through Service v1.5`, () => {
    const fixture = getRideFixture(run.case_id);
    const prepared = prepareRideAnalysis(
      { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
      `eval-${run.run_id}`,
    );
    const result = validateRideAnalysisOutputV03(run.raw_output, prepared.context, prepared.eligibility);

    assert.equal(run.case_id, expected.caseId);
    assert.equal(run.version_matrix.feature_rules_version, RIDE_FEATURE_RULES_VERSION);
    assert.equal(run.version_matrix.prompt_version_claimed, RIDE_ANALYSIS_PROMPT_VERSION);
    assert.equal(run.version_matrix.service_validation_version, RIDE_ANALYSIS_SERVICE_VERSION);
    assert.equal(run.version_matrix.workflow_version_claimed, RIDE_ANALYSIS_WORKFLOW_VERSION);
    assert.equal(run.version_matrix.few_shot_mode, "disabled");
    assert.equal(result.valid, true, result.issues.join(","));
    assert.deepEqual(result.issues, run.service_validation.issues);
    assert.equal(run.service_validation.status, "PASS");
    assert.equal(run.service_validation.model_called_during_validation, false);
    assert.equal(run.human_review.status, "PENDING_USER_PREVIEW");
  });

  test(`${runId} preserves screenshot metadata without inventing provider fields`, () => {
    assert.equal(run.version_matrix.model_display_name, "豆包·2.0-lite");
    assert.equal(run.version_matrix.model_id, "NOT_RECORDED");
    assert.equal(run.request_metadata.workflow_duration_display_s, expected.workflowSeconds);
    assert.equal(run.request_metadata.model_node_duration_display_s, expected.nodeSeconds);
    assert.equal(run.request_metadata.total_tokens_displayed, expected.tokens);
    assert.equal(run.request_metadata.request_id, "NOT_RECORDED");
    assert.equal(run.request_metadata.provider_request_id, "NOT_RECORDED");
    assert.equal(run.request_metadata.latency_ms, "NOT_RECORDED_EXACT");
    assert.equal(run.request_metadata.input_tokens, "NOT_RECORDED");
    assert.equal(run.request_metadata.output_tokens, "NOT_RECORDED");
    assert.equal(run.request_metadata.cost_cny, "NOT_RECORDED");
    assert.equal(existsSync(new URL(`../${run.evidence_source.metadata_screenshot}`, import.meta.url)), true);
  });
}
