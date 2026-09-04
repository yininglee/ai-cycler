import assert from "node:assert/strict";
import test from "node:test";

import {
  COZE_INTERPRETATION_INPUT_VARIABLES,
  RideInterpretationCozeClientV04Candidate,
  readRideInterpretationCozeConfigV04Candidate,
  type RideInterpretationCozeConfigV04Candidate,
} from "../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const config: RideInterpretationCozeConfigV04Candidate = {
  apiUrl: "https://api.coze.cn/v1/workflow/run",
  workflowName: "ride_analysis_v3",
  workflowId: "candidate-workflow-test",
  workflowVersion: "v0.0.1",
  apiToken: "secret-test-token",
  modelId: "candidate-test-model",
  timeoutMs: 1_000,
  maxResponseBytes: 64_000,
};

function input() {
  const fixture = getRideFixture("l3-power-preview");
  const context = buildRideAnalysisContext(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z") },
  );
  const value = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  assert.ok(value);
  return value;
}

test("candidate Coze client sends only three isolated v0.4 inputs", async () => {
  const candidateInput = input();
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  let captured: RequestInit | undefined;
  const client = new RideInterpretationCozeClientV04Candidate(config, async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({
      code: 0,
      data: JSON.stringify({ interpretation_json: JSON.stringify(output) }),
      detail: { logid: "candidate-log" },
      execute_id: "candidate-execute",
      usage: { input_count: 9, output_count: 8, token_count: 17 },
    }), { status: 200 });
  });
  const result = await client.run({ requestId: "candidate-request", input: candidateInput });

  assert.equal(result.rawText, JSON.stringify(output));
  assert.equal(result.providerRequestId, "candidate-log");
  assert.deepEqual(result.telemetry?.usage, { inputTokens: 9, outputTokens: 8, totalTokens: 17 });
  const body = JSON.parse(String(captured?.body)) as Record<string, unknown>;
  assert.equal(body.workflow_id, "candidate-workflow-test");
  const parameters = body.parameters as Record<string, string>;
  assert.deepEqual(Object.keys(parameters), [...COZE_INTERPRETATION_INPUT_VARIABLES]);
  assert.ok(COZE_INTERPRETATION_INPUT_VARIABLES.every((name) => name.length <= 20));
  assert.equal(parameters.ride_interp_input, JSON.stringify(candidateInput));
  assert.equal(parameters.repair_instruction, "");
  assert.equal(parameters.previous_output, "");
  assert.equal("analysis_context" in parameters, false);
  assert.equal("secret-test-token".includes(result.rawText), false);
});

test("candidate Coze config requires its own workflow variables without replacing production values", () => {
  const loaded = readRideInterpretationCozeConfigV04Candidate({
    COZE_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_API_TOKEN: "token",
    COZE_WORKFLOW_ID: "production-workflow",
    COZE_INTERPRETATION_WORKFLOW_NAME: "ride_analysis_v3",
    COZE_INTERPRETATION_WORKFLOW_ID: "candidate-workflow",
    COZE_INTERPRETATION_WORKFLOW_VERSION: "v0.0.1",
    COZE_INTERPRETATION_MODEL_ID: "candidate-model",
  });
  assert.equal(loaded?.workflowId, "candidate-workflow");
  assert.equal(loaded?.workflowName, "ride_analysis_v3");
  assert.equal(readRideInterpretationCozeConfigV04Candidate({ COZE_API_URL: "https://api.coze.cn", COZE_API_TOKEN: "token" }), undefined);
});

test("candidate Coze client caps each invocation at its configured timeout", async () => {
  const candidateInput = input();
  let observedAbort = false;
  const client = new RideInterpretationCozeClientV04Candidate(config, async (_url, init) => {
    const signal = init?.signal as AbortSignal;
    signal.addEventListener("abort", () => { observedAbort = true; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 20);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    });
    return new Response(JSON.stringify({ code: 0, data: JSON.stringify({ interpretation_json: JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput)) }) }), { status: 200 });
  });
  await assert.rejects(() => client.run({ requestId: "budget-request", input: candidateInput, timeoutMs: 5 }), /timed out|Provider request timed out/);
  assert.equal(observedAbort, true);
});

test("candidate Coze client exposes safe Provider error diagnostics without response content", async () => {
  const client = new RideInterpretationCozeClientV04Candidate(config, async () => new Response(
    JSON.stringify({ code: 4028, msg: "quota exhausted", detail: { logid: "diagnostic-log" } }),
    { status: 200 },
  ));
  await assert.rejects(
    () => client.run({ requestId: "diagnostic-request", input: input() }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PROVIDER_REJECTED_REQUEST");
      assert.deepEqual((error as { details?: unknown }).details, {
        httpStatus: 200,
        businessCode: 4028,
        responseJson: true,
        responseBytes: JSON.stringify({ code: 4028, msg: "quota exhausted", detail: { logid: "diagnostic-log" } }).length,
      });
      assert.equal("quota exhausted".includes("diagnostic-log"), false);
      return true;
    },
  );
});

test("candidate Coze client unwraps nested object and JSON-string response envelopes", async () => {
  const candidateInput = input();
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const envelopes = [
    { code: 0, data: { output: { analysisJson: JSON.stringify(output) } } },
    { code: 0, data: JSON.stringify({ interpretationJson: JSON.stringify(output) }) },
  ];
  for (const envelope of envelopes) {
    const client = new RideInterpretationCozeClientV04Candidate(config, async () => new Response(JSON.stringify(envelope), { status: 200 }));
    const result = await client.run({ requestId: "nested-response", input: candidateInput });
    assert.equal(result.rawText, JSON.stringify(output));
  }
});
