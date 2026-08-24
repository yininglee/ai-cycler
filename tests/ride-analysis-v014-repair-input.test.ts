import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COZE_INPUT_VARIABLES } from "../src/ai/coze-workflow-client.ts";
import { validateRideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

interface CozeRepairInput {
  analysis_context: string;
  analysis_elig: string;
  few_shot_json: string;
  repair_instruction: string;
  previous_output: string;
}

interface RepairRun {
  version_matrix: {
    prompt_version_claimed: string;
    service_validation_version: string;
    workflow_version_claimed: string;
    few_shot_mode: string;
    model_display_name: string;
    model_id: string;
  };
  request_metadata: {
    workflow_duration_display_seconds: number;
    model_node_duration_display_seconds: number;
    total_tokens_display: number;
    request_id: string;
    latency_ms: string;
    cost_cny: string;
  };
  screenshot_evidence: { path: string; sha256: string };
  raw_output: unknown;
  corrected_service_validation: { status: string; issues: string[] };
  repair_scope_review: { status: string; matches_accepted_run_023_output: boolean; unrelated_changes: unknown[] };
}

const input = JSON.parse(
  readFileSync(
    new URL("../output/coze-inputs/l3-built-in-sample-repair-v3.1.2.json", import.meta.url),
    "utf8",
  ),
) as CozeRepairInput;
const repairRun = JSON.parse(
  readFileSync(new URL("../eval/runs/RUN-20260824-026.json", import.meta.url), "utf8"),
) as RepairRun;
const acceptedRun = JSON.parse(
  readFileSync(new URL("../eval/runs/RUN-20260824-023.json", import.meta.url), "utf8"),
) as { raw_output: unknown };

test("V014 repair export uses exactly the five Coze inputs and keeps few-shot disabled", () => {
  assert.deepEqual(Object.keys(input), [...COZE_INPUT_VARIABLES]);
  const fewShot = JSON.parse(input.few_shot_json) as { mode: string; examples: unknown[] };
  assert.equal(fewShot.mode, "disabled");
  assert.deepEqual(fewShot.examples, []);
});

test("V014 repair export contains a reproducible invalid previous output and matching repair codes", () => {
  const fixture = getRideFixture("l3-built-in-sample");
  const prepared = prepareRideAnalysis(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    "local-demo",
  );
  assert.deepEqual(JSON.parse(input.analysis_context), prepared.context);
  assert.deepEqual(JSON.parse(input.analysis_elig), prepared.eligibility);

  const validation = validateRideAnalysisOutputV03(
    JSON.parse(input.previous_output),
    prepared.context,
    prepared.eligibility,
  );
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes("OVERALL_UNKNOWN_CLAIM"));
  assert.ok(validation.issues.includes("OVERALL_UNSUPPORTED_NUMBER"));
  assert.ok(validation.issues.includes("TEXT_UNSUPPORTED_NUMBER"));
  for (const issue of validation.issues) assert.match(input.repair_instruction, new RegExp(issue));
  assert.match(input.repair_instruction, /不得新增事实、数字、claim、维度或建议/);
});

test("RUN-20260824-026 replays the final v3.1.2 constrained repair and changes only injected faults", () => {
  const fixture = getRideFixture("l3-built-in-sample");
  const prepared = prepareRideAnalysis(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    "local-demo",
  );
  const validation = validateRideAnalysisOutputV03(
    repairRun.raw_output,
    prepared.context,
    prepared.eligibility,
  );

  assert.equal(validation.valid, true, validation.issues.join(","));
  assert.deepEqual(repairRun.raw_output, acceptedRun.raw_output);
  assert.equal(JSON.stringify(repairRun.raw_output).includes("999"), false);
  assert.equal(JSON.stringify(repairRun.raw_output).includes("claim:other-ride:avgPowerW"), false);
  assert.equal(repairRun.corrected_service_validation.status, "PASS");
  assert.deepEqual(repairRun.corrected_service_validation.issues, []);
  assert.equal(repairRun.repair_scope_review.status, "PASS");
  assert.equal(repairRun.repair_scope_review.matches_accepted_run_023_output, true);
  assert.deepEqual(repairRun.repair_scope_review.unrelated_changes, []);
});

test("RUN-20260824-026 preserves visible screenshot metadata without inventing provider details", () => {
  assert.equal(repairRun.version_matrix.prompt_version_claimed, "3.1.2");
  assert.equal(repairRun.version_matrix.service_validation_version, "ride-analysis-service-v1.5");
  assert.equal(repairRun.version_matrix.workflow_version_claimed, "ride_analysis_v2-dev.15");
  assert.equal(repairRun.version_matrix.few_shot_mode, "disabled");
  assert.equal(repairRun.version_matrix.model_display_name, "豆包·2.0-lite");
  assert.equal(repairRun.version_matrix.model_id, "NOT_RECORDED");
  assert.equal(repairRun.request_metadata.workflow_duration_display_seconds, 19);
  assert.equal(repairRun.request_metadata.model_node_duration_display_seconds, 18);
  assert.equal(repairRun.request_metadata.total_tokens_display, 14543);
  assert.equal(repairRun.request_metadata.request_id, "NOT_RECORDED");
  assert.equal(repairRun.request_metadata.latency_ms, "NOT_RECORDED");
  assert.equal(repairRun.request_metadata.cost_cny, "NOT_RECORDED");

  const screenshot = readFileSync(new URL(`../${repairRun.screenshot_evidence.path}`, import.meta.url));
  assert.equal(createHash("sha256").update(screenshot).digest("hex"), repairRun.screenshot_evidence.sha256);
});
