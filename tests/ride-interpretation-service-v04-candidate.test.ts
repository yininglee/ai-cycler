import assert from "node:assert/strict";
import test from "node:test";

import type { RideInterpretationProviderV04Candidate } from "../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { runRideInterpretationV04Candidate } from "../src/ai/ride-interpretation-service-v04-candidate.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function inputForFixture(fixtureId = "l3-power-preview") {
  const fixture = getRideFixture(fixtureId);
  const context = buildRideAnalysisContext(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z") },
  );
  const value = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  assert.ok(value);
  return value;
}

function input() {
  return inputForFixture();
}

class SequenceProvider implements RideInterpretationProviderV04Candidate {
  calls: Parameters<RideInterpretationProviderV04Candidate["run"]>[0][] = [];
  private readonly replies: string[];

  constructor(replies: string[]) {
    this.replies = replies;
  }
  async run(value: Parameters<RideInterpretationProviderV04Candidate["run"]>[0]) {
    this.calls.push(value);
    return { rawText: this.replies[this.calls.length - 1] ?? "{}", providerRequestId: `request-${this.calls.length}` };
  }
}

class TimedSequenceProvider extends SequenceProvider {
  private readonly delayMs: number;

  constructor(replies: string[], delayMs: number) {
    super(replies);
    this.delayMs = delayMs;
  }

  override async run(value: Parameters<RideInterpretationProviderV04Candidate["run"]>[0]) {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.run(value);
  }
}

test("candidate service accepts a valid first output", async () => {
  const candidateInput = input();
  const provider = new SequenceProvider([JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "first-pass");
  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
});

test("candidate service performs exactly one constrained repair", async () => {
  const candidateInput = input();
  const provider = new SequenceProvider(["not-json", JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "repair-pass");
  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1]!.repairInstruction ?? "", /OUTPUT_NOT_JSON/);
  assert.equal(provider.calls[1]!.previousOutput, "not-json");
});

test("candidate repair instruction permits only planned claim repair and explains L2/L3 evidence failures", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.oneLineLabel = {
    text: "本次功率表现出色",
    claimIds: [candidateInput.overallAssessment.factClaimIds[0]!],
  };
  invalid.overallAssessment.text = "本次事实为999。";
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "evidence-repair");
  assert.equal(result.source, "candidate");
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /performance 或 relation Claim/);
  assert.match(instruction, /整体评价中不能由其 claimIds 直接支持的数字/);
  assert.match(instruction, /本次输入中映射同一数值的非 limitation Candidate Claim/);
  assert.match(instruction, /可来自其他已选业务项/);
  assert.match(instruction, /输入计划已开放的 Candidate Claim 中替换或补齐/);
});

test("candidate repair instruction keeps overall interpretation separate from next steps and restores planned visuals", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  assert.ok(candidateInput.overallAssessment.visualRefIds.length > 0);
  invalid.overallAssessment.text = "建议下次继续记录本次体感。";
  invalid.overallAssessment.visualRefIds = [];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "overall-boundary-repair");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /OVERALL_ACTION_LANGUAGE_NOT_ALLOWED/);
  assert.match(instruction, /下一步建议只能写在 nextAction/);
  assert.match(instruction, /OVERALL_VISUAL_MISMATCH/);
  assert.match(instruction, /input\.overallAssessment\.visualRefIds/);
  assert.match(instruction, /不得删除、增加、替换、重排/);
});

test("candidate repair instruction fixes every highlight back to the overall assessment evidence boundary", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const dimension = invalid.dimensions[1]!;
  invalid.highlights = [{
    text: "心率维度的高光。",
    claimIds: [dimension.claimIds[0]!],
    visualRefIds: [dimension.visualRefIds[0]!],
    target: { kind: "dimension", dimensionId: dimension.dimensionId } as unknown as { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "highlight-repair");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /target: \{ "kind": "overall" \}/);
  assert.match(instruction, /不得输出 dimension、dimensionId/);
});

test("candidate repair instruction trims highlight evidence to the overall assessment", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const dimension = invalid.dimensions[1]!;
  invalid.highlights = [{
    text: "心率维度的高光。",
    claimIds: [dimension.claimIds[0]!],
    visualRefIds: [dimension.visualRefIds[0]!],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "highlight-evidence-repair");
  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /overallAssessment\.claimIds/);
  assert.match(instruction, /overallAssessment\.visualRefIds/);
});

test("candidate repair keeps highlight numbers only with a complete overall evidence chain", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.highlights = [{
    text: "本次值得回看的数值是999。",
    claimIds: [invalid.overallAssessment.claimIds[0]!],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  const repaired = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  repaired.highlights = [];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(repaired)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "highlight-numeric-repair");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  assert.equal(provider.calls.length, 2);
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /HIGHLIGHT_0_UNSUPPORTED_NUMBER/);
  assert.match(instruction, /完整证据链/);
  assert.match(instruction, /overallAssessment\.claimIds/);
  assert.match(instruction, /不得只删除高光 Claim ID 而保留数字/);
});

test("candidate service accepts a factual label even when its Claim is performance evidence", async () => {
  const candidateInput = input();
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  output.oneLineLabel.text = "本次功率为172.12W";
  const provider = new SequenceProvider([JSON.stringify(output)]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "factual-performance-label");
  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
});

test("candidate service degrades after the repair fails without a third invocation", async () => {
  const candidateInput = input();
  const provider = new SequenceProvider(["not-json", "still-not-json", JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "repair-fail");
  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.attempts, 2);
  assert.equal(provider.calls.length, 2);
});

test("candidate service gives the first call and repair independent timeout windows", async () => {
  const candidateInput = input();
  const valid = JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput));
  const provider = new TimedSequenceProvider(["not-json", valid], 15);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "budget-repair", 20);
  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]!.timeoutMs, 20);
  assert.equal(provider.calls[1]!.timeoutMs, 20);
  assert.ok(result.latencyMs >= 30);
});

test("candidate service does not start repair when the first call exceeds its timeout", async () => {
  const candidateInput = input();
  const provider = new TimedSequenceProvider(["not-json"], 15);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "budget-no-repair", 5);
  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "AI_TIMEOUT");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
});
