import assert from "node:assert/strict";
import test from "node:test";

import {
  COZE_INPUT_VARIABLES,
  CozeWorkflowClient,
  CozeWorkflowError,
  readCozeWorkflowConfig,
  type CozeWorkflowConfig,
} from "../src/ai/coze-workflow-client.ts";
import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import { disabledRideAnalysisFewShots } from "../src/ai/ride-analysis-few-shot.ts";
import type { RideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const config: CozeWorkflowConfig = {
  apiUrl: "https://api.coze.cn/v1/workflow/run",
  workflowId: "workflow-test",
  apiToken: "secret-test-token",
  modelId: "test-model",
  timeoutMs: 1_000,
  maxResponseBytes: 64_000,
};

function invocation() {
  const fixture = getRideFixture("l3-built-in-sample");
  const prepared = prepareRideAnalysis({ activity: fixture.activity, series: fixture.series });
  return {
    requestId: "local-request-1",
    analysisContext: prepared.context,
    eligibility: prepared.eligibility,
    fewShotSelection: disabledRideAnalysisFewShots(),
  };
}

function output(): RideAnalysisOutputV03 {
  return {
    schemaVersion: "ride-analysis-output-v0.3",
    headline: "节奏稳定的一次骑行",
    overallAssessment: { text: "本次输出节奏较为集中。", claimIds: ["claim:ride-l3-built-in-sample:feature:powerCoefficientOfVariation"] },
    dimensions: [],
    notableEvents: [],
    nextAction: null,
    limitations: [],
    safetyLevel: "normal",
    shareCopy: ["今天的节奏很稳。", "输出过程保持得不错。", "继续保持骑行节奏。"],
  };
}

test("Coze adapter sends five short v0.2 inputs with no examples and extracts a v0.3 object", async () => {
  const input = invocation();
  let capturedRequest: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedRequest = init;
    return new Response(JSON.stringify({
      code: 0,
      data: JSON.stringify({ analysis_json: JSON.stringify(output()) }),
      request_id: "coze-request-1",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const client = new CozeWorkflowClient(config, fetchImpl);
  const result = await client.run(input);

  assert.equal(result.rawText, JSON.stringify(output()));
  assert.equal(result.providerRequestId, "coze-request-1");
  const headers = new Headers(capturedRequest?.headers);
  assert.equal(headers.get("authorization"), "Bearer secret-test-token");
  const body = JSON.parse(String(capturedRequest?.body)) as Record<string, unknown>;
  assert.equal(body.workflow_id, "workflow-test");
  const parameters = body.parameters as Record<string, unknown>;
  assert.deepEqual(Object.keys(parameters), [...COZE_INPUT_VARIABLES]);
  assert.ok(COZE_INPUT_VARIABLES.every((name) => name.length <= 20));
  assert.equal(parameters.analysis_context, JSON.stringify(input.analysisContext));
  assert.equal(parameters.analysis_elig, JSON.stringify(input.eligibility));
  assert.equal(parameters.few_shot_json, JSON.stringify(input.fewShotSelection));
  assert.deepEqual(input.fewShotSelection.examples, []);
  assert.equal(parameters.repair_instruction, "");
  assert.equal(parameters.previous_output, "");
  assert.ok(!result.rawText.includes("secret-test-token"));
});

test("Coze adapter converts provider rejection to a stable internal error", async () => {
  const client = new CozeWorkflowClient(config, async () => new Response(
    JSON.stringify({ code: 4001, msg: "rejected" }),
    { status: 200 },
  ));

  await assert.rejects(
    () => client.run(invocation()),
    (error: unknown) => error instanceof CozeWorkflowError && error.code === "PROVIDER_REJECTED_REQUEST",
  );
});

test("a plausible but schema-invalid model object reaches service validation for constrained repair", async () => {
  const invalid = { ...output() } as Partial<RideAnalysisOutputV03>;
  delete invalid.schemaVersion;
  const client = new CozeWorkflowClient(config, async () => new Response(JSON.stringify({ code: 0, data: invalid }), { status: 200 }));
  const result = await client.run(invocation());
  assert.equal(result.rawText, JSON.stringify(invalid));
});

test("Coze configuration stays disabled until all server-only secrets exist", () => {
  assert.equal(readCozeWorkflowConfig({ AI_ANALYSIS_ENABLED: "true" }), undefined);
  const loaded = readCozeWorkflowConfig({
    COZE_API_URL: "https://api.coze.cn/v1/workflow/run",
    COZE_WORKFLOW_ID: "workflow-id",
    COZE_API_TOKEN: "token",
    COZE_MODEL_ID: "model-id",
  });
  assert.equal(loaded?.workflowId, "workflow-id");
  assert.equal(loaded?.modelId, "model-id");
});
