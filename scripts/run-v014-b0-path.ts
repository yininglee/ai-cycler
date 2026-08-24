import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import type { RideAnalysisInvocation, RideAnalysisProvider } from "../src/ai/coze-workflow-client.ts";
import { prepareRideAnalysis, runRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import { validateB0RideAnalysis } from "../src/domain/ride-summary.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

class TwiceInvalidProvider implements RideAnalysisProvider {
  readonly calls: RideAnalysisInvocation[] = [];
  private readonly outputs = ["not-json", "still-not-json"];

  async run(input: RideAnalysisInvocation): Promise<{ rawText: string; providerRequestId: string }> {
    this.calls.push(input);
    const rawText = this.outputs[this.calls.length - 1];
    if (rawText === undefined) throw new Error("Unexpected third provider call");
    return { rawText, providerRequestId: `v014-b0-provider-${this.calls.length}` };
  }
}

const fixture = getRideFixture("l3-built-in-sample");
const prepared = prepareRideAnalysis(
  { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
  "eval-v014-b0-path",
);
const provider = new TwiceInvalidProvider();
const result = await runRideAnalysis(prepared, {
  enabled: true,
  provider,
  modelId: "deterministic-test-double",
  requestId: "v014-final-b0-path",
});

assert.equal(result.source, "b0");
assert.equal(result.fallbackCode, "REPAIR_FAILED");
assert.equal(result.attempts, 2);
assert.equal(provider.calls.length, 2);
assert.deepEqual(result.output, prepared.b0.output);
const b0Validation = validateB0RideAnalysis(prepared.b0);
assert.equal(b0Validation.valid, true, b0Validation.issues.join(","));

const repairCall = provider.calls[1];
assert.ok(repairCall?.repairInstruction);
assert.equal(repairCall.previousOutput, "not-json");

const artifact = {
  run_id: "RUN-20260824-027",
  date: "2026-08-24",
  work_item: "ITEM-V014",
  run_type: "deterministic_second_failure_b0",
  evidence_source: "automated-service-verification",
  case_id: "l3-built-in-sample",
  version_matrix: {
    ...result.versions,
    feature_rules: prepared.context.featureSnapshot.rulesVersion,
    provider_kind: "deterministic_test_double",
  },
  provider_queue: [
    { attempt: 1, raw_output: "not-json" },
    { attempt: 2, raw_output: "still-not-json" },
  ],
  expected: {
    max_attempts: 2,
    source: "b0",
    fallback_code: "REPAIR_FAILED",
    no_third_attempt: true,
  },
  observed: {
    source: result.source,
    fallback_code: result.fallbackCode,
    attempts: result.attempts,
    provider_call_count: provider.calls.length,
    no_third_attempt: provider.calls.length === 2,
    provider_request_ids: result.providerRequestIds,
    validation_issues: result.validationIssues,
    selected_example_ids: result.selectedExampleIds,
    few_shot_mode: result.versions.fewShotMode,
    repair_instruction: repairCall.repairInstruction,
    repair_previous_output: repairCall.previousOutput,
    b0_template_version: result.versions.b0Template,
    b0_output_valid: b0Validation.valid,
    b0_validation_issues: b0Validation.issues,
    b0_output: result.output,
  },
  execution_metadata: {
    real_model_called: false,
    provider_attempts: 2,
    model_tokens: 0,
    model_cost_cny: 0,
    local_process_latency_ms: result.latencyMs,
  },
  result: "PASS",
  human_review: {
    status: "PASS",
    reason: "Service v1.5 stops after one constrained repair and returns the valid deterministic B0 output after the second validation failure; no third Provider call occurs.",
  },
  next_action: "Submit the final v3.1.2 constrained-repair and B0-path slice for user preview before deciding ITEM-V014 acceptance.",
};

await writeFile("eval/runs/RUN-20260824-027.json", `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log("已生成 eval/runs/RUN-20260824-027.json");
