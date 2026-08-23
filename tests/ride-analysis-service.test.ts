import assert from "node:assert/strict";
import test from "node:test";

import { CozeWorkflowError, type RideAnalysisInvocation, type RideAnalysisProvider } from "../src/ai/coze-workflow-client.ts";
import { prepareRideAnalysis, runRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import type { RideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

class QueuedProvider implements RideAnalysisProvider {
  readonly calls: RideAnalysisInvocation[] = [];
  private readonly queue: Array<string | Error>;

  constructor(queue: Array<string | Error>) {
    this.queue = queue;
  }

  async run(input: RideAnalysisInvocation): Promise<{ rawText: string; providerRequestId: string }> {
    this.calls.push(input);
    const item = this.queue.shift();
    if (item instanceof Error) throw item;
    if (typeof item !== "string") throw new Error("Fake provider queue exhausted");
    return { rawText: item, providerRequestId: `provider-${this.calls.length}` };
  }
}

function prepared(fixtureId = "l3-built-in-sample", safetyFlags: string[] = []) {
  const fixture = getRideFixture(fixtureId);
  return prepareRideAnalysis(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    "local-demo",
    { safetyFlags },
  );
}

function validOutput(): RideAnalysisOutputV03 {
  return {
    schemaVersion: "ride-analysis-output-v0.3",
    headline: "节奏出现变化，完成本次骑行",
    overallAssessment: {
      text: "本次骑行首段与末段四分之一的平均功率存在差异，说明功率输出在阶段之间有所变化。",
      claimIds: ["claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW"],
    },
    dimensions: [{
      key: "power",
      text: "首段与末段四分之一的平均功率存在差异，反映出阶段输出并不相同。",
      claimIds: ["claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW"],
      confidence: "high",
    }],
    notableEvents: [],
    nextAction: null,
    limitations: ["本次解读只覆盖当前记录中可用的骑行指标。"],
    safetyLevel: "normal",
    shareCopy: ["完成本次骑行。", "本次骑行已完成。", "记录一次骑行。"],
  };
}

test("AI server flag returns B0 without calling a provider", async () => {
  const provider = new QueuedProvider([JSON.stringify(validOutput())]);
  const result = await runRideAnalysis(prepared(), { enabled: false, provider });

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "AI_DISABLED");
  assert.equal(result.attempts, 0);
  assert.equal(provider.calls.length, 0);
});

test("enabled AI without complete server configuration returns B0", async () => {
  const result = await runRideAnalysis(prepared(), { enabled: true });

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "AI_NOT_CONFIGURED");
  assert.equal(result.attempts, 0);
});

test("a valid first model result returns B2 with the new version matrix", async () => {
  const provider = new QueuedProvider([JSON.stringify(validOutput())]);
  const result = await runRideAnalysis(prepared(), { enabled: true, provider, modelId: "test-fast-model" });

  assert.equal(result.source, "b2");
  assert.equal(result.attempts, 1);
  assert.equal(result.fallbackCode, undefined);
  assert.equal(result.versions.outputSchema, "ride-analysis-output-v0.3");
  assert.equal(result.versions.prompt, "3.1.2");
  assert.equal(result.versions.fewShotMode, "disabled");
  assert.equal(result.versions.modelId, "test-fast-model");
  assert.deepEqual(result.selectedExampleIds, []);
  assert.equal(provider.calls[0]!.fewShotSelection.mode, "disabled");
  assert.deepEqual(provider.calls[0]!.fewShotSelection.examples, []);
  assert.deepEqual(result.providerRequestIds, ["provider-1"]);
});

test("an invalid first result gets exactly one constrained repair", async () => {
  const invalid = validOutput();
  invalid.overallAssessment = { text: "本次功率达到999瓦。", claimIds: ["claim:other-ride:avgPowerW"] };
  const provider = new QueuedProvider([
    JSON.stringify(invalid),
    JSON.stringify(validOutput()),
    JSON.stringify(validOutput()),
  ]);
  const result = await runRideAnalysis(prepared(), { enabled: true, provider });

  assert.equal(result.source, "b2");
  assert.equal(result.attempts, 2);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1]!.repairInstruction ?? "", /OVERALL_UNKNOWN_CLAIM/);
  assert.match(provider.calls[1]!.repairInstruction ?? "", /OVERALL_UNSUPPORTED_NUMBER/);
  assert.equal(provider.calls[1]!.previousOutput, JSON.stringify(invalid));
  assert.equal(provider.calls[1]!.fewShotSelection.mode, "disabled");
  assert.deepEqual(provider.calls[1]!.fewShotSelection.examples, []);
});

test("the explicit switch still cannot inject unapproved draft examples", async () => {
  const provider = new QueuedProvider([JSON.stringify(validOutput())]);
  const result = await runRideAnalysis(prepared(), { enabled: true, provider, fewShotEnabled: true });

  assert.equal(result.source, "b2");
  assert.equal(result.versions.fewShotMode, "disabled");
  assert.deepEqual(result.selectedExampleIds, []);
  assert.equal(provider.calls[0]!.fewShotSelection.reason, "no_approved_examples");
  assert.deepEqual(provider.calls[0]!.fewShotSelection.examples, []);
});

test("a second validation failure degrades to B0", async () => {
  const baseline = prepared();
  const provider = new QueuedProvider(["not-json", "still-not-json"]);
  const result = await runRideAnalysis(baseline, { enabled: true, provider });

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.output, baseline.b0.output);
});

test("provider timeout degrades immediately without an unconstrained retry", async () => {
  const provider = new QueuedProvider([new CozeWorkflowError("AI_TIMEOUT", "test timeout")]);
  const result = await runRideAnalysis(prepared(), { enabled: true, provider });

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "AI_TIMEOUT");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
});

test("provider errors degrade without returning provider details", async () => {
  const provider = new QueuedProvider([new Error("upstream secret detail")]);
  const result = await runRideAnalysis(prepared(), { enabled: true, provider });

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "PROVIDER_ERROR");
  assert.equal(JSON.stringify(result).includes("upstream secret detail"), false);
});

test("records without insight sources never reach the model", async () => {
  const baseline = prepared("fit-truncated-file");
  const provider = new QueuedProvider([JSON.stringify(validOutput())]);
  const result = await runRideAnalysis(baseline, { enabled: true, provider });

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "DATA_NOT_ELIGIBLE");
  assert.equal(provider.calls.length, 0);
});

test("a safety block uses the fixed stop path without model invocation", async () => {
  const provider = new QueuedProvider([JSON.stringify(validOutput())]);
  const result = await runRideAnalysis(prepared("l3-built-in-sample", ["critical_safety"]), { enabled: true, provider });

  assert.equal(result.source, "safety_stop");
  assert.equal(result.fallbackCode, "SAFETY_STOP");
  assert.equal(result.output.safetyLevel, "stop");
  assert.equal(provider.calls.length, 0);
});
