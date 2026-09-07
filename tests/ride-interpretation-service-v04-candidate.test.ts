import assert from "node:assert/strict";
import test from "node:test";

import type { RideInterpretationProviderV04Candidate } from "../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import {
  claimFactFallbackText,
  PROVEN_SAFE_DIMENSION_FALLBACK_TEXT,
  PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  runRideInterpretationV04Candidate,
} from "../src/ai/ride-interpretation-service-v04-candidate.ts";
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

test("candidate schema repair forbids introducing data-completeness evaluation", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.schemaVersion = "invalid-test-schema" as never;
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "schema-repair-data-completeness-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /不得评价数据或记录完整度/);
  assert.match(instruction, /数据完整、记录完整、数据记录完成/);
  assert.match(instruction, /不得因修复 JSON 结构而新增/);
  assert.match(instruction, /可以删除违规的可选高光或完整违规叙述句/);
  assert.match(instruction, /不得删除系统已选维度、限制、nextAction、计划事实或计划图表/);
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

test("candidate restores planned visuals and replaces an action-only overall narrative with claim facts", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  assert.ok(candidateInput.overallAssessment.visualRefIds.length > 0);
  invalid.overallAssessment.text = "建议下次继续记录本次体感。";
  invalid.overallAssessment.visualRefIds = [];
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "overall-boundary-fact-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(result.output.overallAssessment.visualRefIds, candidateInput.overallAssessment.visualRefIds);
  assert.equal(
    result.output.overallAssessment.text,
    claimFactFallbackText(invalid.overallAssessment.claimIds, candidateInput) ?? PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  );
});

test("candidate deterministically restores every planned dimension visual before model repair", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.dimensions[0]!.visualRefIds = [];
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "dimension-visual-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.output.dimensions[0]!.visualRefIds, candidateInput.dimensionInterpretations[0]!.visualRefIds);
});

test("candidate drops an optional highlight with an unsafe action instead of repairing model text", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.highlights = [{
    text: "建议下次增加高强度训练。",
    claimIds: [invalid.overallAssessment.claimIds[0]!],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "highlight-action-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.output.highlights, []);
});

test("candidate repair instruction moves label suggestions out of narratives after FIX-018 fallback", async () => {
  const candidateInput = input();
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.oneLineLabel = { ...invalid.oneLineLabel, text: "建议下次继续记录本次体感。" };
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "unsafe-label-action-repair");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /整体评价和任何维度解读只保留事实、当次表现、体现\/反映的骑行能力/);
  assert.match(instruction, /所有建议只能写入固定的 nextAction/);
});

test("candidate deterministically drops a highlight with an invalid target", async () => {
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
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(result.output.highlights, []);
});

test("candidate deterministically reconciles highlight evidence to the overall assessment", async () => {
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
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.ok(result.output.overallAssessment.claimIds.includes(dimension.claimIds[0]!));
  assert.deepEqual(result.output.highlights[0]!.visualRefIds, []);
});

test("candidate drops a highlight whose number cannot be supported", async () => {
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
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(result.output.highlights, []);
});

test("candidate deterministically reconciles overall and highlight evidence in dependency order", async () => {
  const candidateInput = inputForFixture("l2-built-in-sample");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const outsideClaimId = invalid.dimensions[1]!.claimIds.find((claimId) => !invalid.overallAssessment.claimIds.includes(claimId));
  assert.ok(outsideClaimId);
  const sourceId = candidateInput.candidateClaims.find((claim) => claim.claimId === outsideClaimId)?.sourceClaimIds[0];
  const source = candidateInput.allowedClaims.find((claim) => claim.claimId === sourceId);
  assert.ok(source?.displayValue ?? source?.value !== undefined);
  invalid.overallAssessment.text = `整体记录包含${source!.displayValue ?? source!.value}。`;
  invalid.highlights = [{
    text: `该数值${source!.displayValue ?? source!.value}值得回看。`,
    claimIds: [outsideClaimId],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "evidence-chain-repair");
  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.ok(result.output.overallAssessment.claimIds.includes(outsideClaimId));
  assert.deepEqual(result.output.highlights[0]!.claimIds, [outsideClaimId]);
});

test("candidate deterministically reconciles F09 highlight numeric evidence and removes visuals outside overall", async () => {
  const candidateInput = inputForFixture("fit-power-dropout-with-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const outsideClaimId = invalid.dimensions
    .flatMap((dimension) => dimension.claimIds)
    .find((claimId) => !invalid.overallAssessment.claimIds.includes(claimId));
  const outsideVisualId = invalid.dimensions
    .flatMap((dimension) => dimension.visualRefIds)
    .find((visualRefId) => !invalid.overallAssessment.visualRefIds.includes(visualRefId));
  assert.ok(outsideClaimId);
  assert.ok(outsideVisualId);
  const source = candidateInput.candidateClaims.find((claim) => claim.claimId === outsideClaimId)?.sourceClaimIds
    .map((sourceClaimId) => candidateInput.allowedClaims.find((claim) => claim.claimId === sourceClaimId))
    .find((claim): claim is NonNullable<typeof claim> => Boolean(claim?.displayValue ?? claim?.value !== undefined));
  assert.ok(source);
  const number = source.displayValue ?? String(source.value);
  invalid.highlights = [{
    text: `该数值${number}值得回看。`,
    claimIds: [outsideClaimId],
    visualRefIds: [outsideVisualId],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "f09-evidence-visual-repair");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.ok(result.output.overallAssessment.claimIds.includes(outsideClaimId));
  assert.deepEqual(result.output.highlights[0]!.claimIds, [outsideClaimId]);
  assert.deepEqual(result.output.highlights[0]!.visualRefIds, []);
});

test("candidate deterministically reconciles the FORMAL-07 F02 numeric highlight chain", async () => {
  const candidateInput = inputForFixture("l1-gpx-normal");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const outsideClaimId = invalid.dimensions
    .flatMap((dimension) => dimension.claimIds)
    .find((claimId) => !invalid.overallAssessment.claimIds.includes(claimId));
  assert.ok(outsideClaimId);
  const source = candidateInput.candidateClaims.find((claim) => claim.claimId === outsideClaimId)?.sourceClaimIds
    .map((sourceClaimId) => candidateInput.allowedClaims.find((claim) => claim.claimId === sourceClaimId))
    .find((claim): claim is NonNullable<typeof claim> => Boolean(claim?.displayValue ?? claim?.value !== undefined));
  assert.ok(source);
  const number = source.displayValue ?? String(source.value);
  invalid.overallAssessment.text = `整体记录包含${number}。`;
  invalid.highlights = [{
    text: `该数值${number}值得回看。`,
    claimIds: [outsideClaimId],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "formal-07-f02-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.ok(result.output.overallAssessment.claimIds.includes(outsideClaimId));
  assert.deepEqual(result.output.highlights[0]!.claimIds, [outsideClaimId]);
});

test("candidate deterministically removes optional F04 highlight action and preserves the required dimension narrative", async () => {
  const candidateInput = inputForFixture("l2-built-in-sample");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  const originalText = heartRate.text;
  heartRate.text = `${originalText}建议下次增加高强度训练安排。`;
  invalid.highlights = [{
    text: "建议下次增加高强度训练。",
    claimIds: [invalid.overallAssessment.claimIds[0]!],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "formal-07-f04-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, originalText);
  assert.deepEqual(result.output.highlights, []);
});

test("candidate deterministically trims trailing F04 action clauses from both required narratives", async () => {
  const candidateInput = inputForFixture("l2-built-in-sample");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  const factualOverall = invalid.overallAssessment.text.replace(/[。！？!?]+$/, "");
  const factualHeartRate = heartRate.text.replace(/[。！？!?]+$/, "");
  invalid.overallAssessment.text = `${factualOverall}，建议下次增加高强度训练安排。`;
  heartRate.text = `${factualHeartRate}，建议下次增加高强度训练安排。`;
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "formal-07-f04-trailing-actions");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.overallAssessment.text, factualOverall);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, factualHeartRate);
});

test("candidate deterministically resolves all FORMAL-07 F05 action combinations", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const cases = [
    { id: "r5", overall: true, dimension: true, highlight: true },
    { id: "r6", overall: false, dimension: true, highlight: true },
    { id: "r7", overall: true, dimension: true, highlight: false },
  ];

  for (const current of cases) {
    const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
    const originalOverall = invalid.overallAssessment.text;
    const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
    assert.ok(heartRate);
    const originalDimension = heartRate.text;
    if (current.overall) invalid.overallAssessment.text = `${originalOverall}建议下次增加高强度训练安排。`;
    if (current.dimension) heartRate.text = `${originalDimension}建议下次增加高强度训练安排。`;
    if (current.highlight) {
      invalid.highlights = [{
        text: "建议下次增加高强度训练。",
        claimIds: [invalid.overallAssessment.claimIds[0]!],
        visualRefIds: [],
        target: { kind: "overall" },
      }];
    }
    const provider = new SequenceProvider([JSON.stringify(invalid)]);

    const result = await runRideInterpretationV04Candidate(candidateInput, provider, `formal-07-f05-${current.id}-boundary`);

    assert.equal(result.source, "candidate");
    assert.equal(result.attempts, 1);
    assert.equal(result.output.overallAssessment.text, originalOverall);
    assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, originalDimension);
    assert.equal(result.output.highlights.length, current.highlight ? 0 : 1);
  }
});

test("candidate trims imperative F05 training tails only after a factual clause boundary", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  const factualOverall = invalid.overallAssessment.text.replace(/[。！？!?]+$/, "");
  const factualHeartRate = heartRate.text.replace(/[。！？!?]+$/, "");
  invalid.overallAssessment.text = `${factualOverall}，安排间歇训练以提升能力。`;
  heartRate.text = `${factualHeartRate}；进行高强度训练安排。`;
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "formal-07-f05-imperative-tails");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.overallAssessment.text, factualOverall);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, factualHeartRate);
});

test("candidate trims residual F05 modal training tails only after a factual clause boundary", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  const factualOverall = invalid.overallAssessment.text.replace(/[。！？!?]+$/, "");
  const factualHeartRate = heartRate.text.replace(/[。！？!?]+$/, "");
  invalid.overallAssessment.text = `${factualOverall}；后续需逐步增加训练负荷。`;
  heartRate.text = `${factualHeartRate}，可适当加强高强度训练。`;
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "f05-residual-modal-training-tails");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.overallAssessment.text, factualOverall);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, factualHeartRate);
});

test("candidate reconciles shared-evidence numbers while trimming independent overall and dimension actions", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  const terrainFact = candidateInput.allowedClaims.find((claim) => claim.key === "elevationGainM");
  assert.ok(terrainFact?.displayValue);
  const factualOverall = invalid.overallAssessment.text;
  const factualHeartRate = heartRate.text;
  invalid.overallAssessment.text = `${factualOverall}本次爬升${terrainFact.displayValue}米，建议下次增加高强度训练安排。`;
  heartRate.text = `${factualHeartRate}，建议下次增加高强度训练安排。`;
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "fix-015-shared-evidence-action-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.ok(result.output.overallAssessment.claimIds.includes("candidate:terrain_climb:fact"));
  assert.ok(result.output.overallAssessment.claimIds.includes("candidate:terrain_climb:performance"));
  assert.equal(result.output.overallAssessment.text, factualOverall);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, factualHeartRate);
});

test("candidate replaces a modal high-risk phrase without a factual boundary using deterministic facts", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "后续需逐步增加训练负荷。";
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "f05-residual-modal-no-prefix-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(
    result.output.overallAssessment.text,
    claimFactFallbackText(invalid.overallAssessment.claimIds, candidateInput) ?? PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  );
});

test("candidate deterministically restores the FORMAL-07 F09 visual and removes a safe dimension action sentence", async () => {
  const candidateInput = inputForFixture("fit-power-dropout-with-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  const originalText = heartRate.text;
  invalid.overallAssessment.visualRefIds = [];
  heartRate.text = `${originalText}建议下次增加高强度训练安排。`;
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "formal-07-f09-r4-boundary");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.output.overallAssessment.visualRefIds, candidateInput.overallAssessment.visualRefIds);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, originalText);
});

test("candidate keeps the FORMAL-07 F09 numeric chain at B0 when it has no unique legal evidence", async () => {
  const candidateInput = inputForFixture("fit-power-dropout-with-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "整体记录包含999。";
  invalid.highlights = [{
    text: "本次值得回看的数值是999。",
    claimIds: [invalid.overallAssessment.claimIds[0]!],
    visualRefIds: [],
    target: { kind: "overall" },
  }];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "formal-07-f09-r6-unrecoverable");

  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.ok(result.validationIssues.includes("OVERALL_UNSUPPORTED_NUMBER"));
});

test("candidate replaces an action-only overall narrative with deterministic claim facts without repair", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "建议下次增加高强度训练安排。";
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "action-only-narrative-fact-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(
    result.output.overallAssessment.text,
    claimFactFallbackText(invalid.overallAssessment.claimIds, candidateInput) ?? PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  );
});

test("candidate rejects low-risk monitoring language in the overall narrative while retaining nextAction", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  output.overallAssessment.text = "本次心率变化值得关注，建议下次查看体感并按需调整节奏。";
  const provider = new SequenceProvider([JSON.stringify(output), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "low-risk-monitoring-language");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.overallAssessment.text, "本次心率变化值得关注");
});

test("candidate deterministically trims an implicit heart-rate action tail without rejecting factual stability", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  heartRate.text = "本次心率与配速变化保持一致，骑后留意体感并按需调整节奏。";
  const provider = new SequenceProvider([JSON.stringify(output), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "implicit-dimension-action-language");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, "本次心率与配速变化保持一致");
});

test("candidate deterministically trims a route-pacing action tail without changing unaffected narratives", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const routePacing = output.dimensions.find((dimension) => dimension.dimensionId === "route_pacing");
  const heartRate = output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(routePacing);
  assert.ok(heartRate);
  const originalOverall = output.overallAssessment.text;
  const originalHeartRate = heartRate.text;
  routePacing.text = "本次配速变化较小，节奏较为稳定，骑后留意体感并按需调整节奏。";
  const provider = new SequenceProvider([JSON.stringify(output)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "fix-017-route-pacing-action-tail");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "route_pacing")?.text, "本次配速变化较小，节奏较为稳定");
  assert.equal(result.output.overallAssessment.text, originalOverall);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text, originalHeartRate);
});

test("candidate replaces a route-pacing action-only narrative with deterministic claim facts", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const routePacing = invalid.dimensions.find((dimension) => dimension.dimensionId === "route_pacing");
  assert.ok(routePacing);
  routePacing.text = "骑后留意体感并按需调整节奏。";
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "fix-018-route-pacing-action-only-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(
    result.output.dimensions.find((dimension) => dimension.dimensionId === "route_pacing")?.text,
    claimFactFallbackText(routePacing.claimIds, candidateInput) ?? PROVEN_SAFE_DIMENSION_FALLBACK_TEXT,
  );
});

test("candidate falls back to the proven-safe template when no labeled claim facts exist", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const strippedInput = structuredClone(candidateInput);
  for (const claim of strippedInput.allowedClaims) delete claim.displayValue;
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "建议下次增加高强度训练安排。";
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(strippedInput, provider, "fix-018-template-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.output.overallAssessment.text, PROVEN_SAFE_OVERALL_FALLBACK_TEXT);
});

test("candidate applies the deterministic fallback after a repaired response reintroduces action language", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const repaired = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const heartRate = repaired.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  assert.ok(heartRate);
  heartRate.text = "建议下次增加高强度训练安排。";
  const provider = new SequenceProvider(["not-json", JSON.stringify(repaired)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "fix-018-repair-round-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 2);
  assert.equal(provider.calls.length, 2);
  assert.equal(
    result.output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")?.text,
    claimFactFallbackText(heartRate.claimIds, candidateInput) ?? PROVEN_SAFE_DIMENSION_FALLBACK_TEXT,
  );
});

test("candidate preserves factual route-pacing text without an action phrase", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const output = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  const routePacing = output.dimensions.find((dimension) => dimension.dimensionId === "route_pacing");
  assert.ok(routePacing);
  routePacing.text = "本次配速变化较小，节奏较为稳定。";
  const provider = new SequenceProvider([JSON.stringify(output)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "fix-017-route-pacing-factual");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(result.output.dimensions.find((dimension) => dimension.dimensionId === "route_pacing")?.text, routePacing.text);
});

test("candidate repair instruction hardens dimension action and completeness boundaries", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.dimensions.find((dimension) => dimension.dimensionId === "heart_rate")!.text = "建议下次增加高强度训练安排。数据记录完整。";
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(buildRideInterpretationOutputV04CandidateFixture(candidateInput))]);

  await runRideInterpretationV04Candidate(candidateInput, provider, "fix-014-prompt-boundary");
  const instruction = provider.calls[1]!.repairInstruction ?? "";
  assert.match(instruction, /不得出现任何行动建议或行动引导/);
  assert.match(instruction, /所有建议只能放在 nextAction/);
  assert.match(instruction, /不得评价数据或记录完整度/);
});

test("candidate replaces an isolated high-risk activity fact with deterministic facts instead of unsafe trimming", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "本次包含冲刺段。";
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "isolated-activity-word-fact-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(
    result.output.overallAssessment.text,
    claimFactFallbackText(invalid.overallAssessment.claimIds, candidateInput) ?? PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  );
});

test("candidate replaces a high-risk phrase without an imperative tail boundary using deterministic facts", async () => {
  const candidateInput = inputForFixture("l2-fit-heart-rate");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "本次安排了冲刺段。";
  const provider = new SequenceProvider([JSON.stringify(invalid)]);

  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "imperative-tail-boundary-fact-fallback");

  assert.equal(result.source, "candidate");
  assert.equal(result.attempts, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(
    result.output.overallAssessment.text,
    claimFactFallbackText(invalid.overallAssessment.claimIds, candidateInput) ?? PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  );
});

test("candidate repair keeps rejecting unsupported numbers after evidence reconciliation", async () => {
  const candidateInput = inputForFixture("l2-built-in-sample");
  const invalid = buildRideInterpretationOutputV04CandidateFixture(candidateInput);
  invalid.overallAssessment.text = "整体记录包含999。";
  invalid.highlights = [];
  const provider = new SequenceProvider([JSON.stringify(invalid), JSON.stringify(invalid)]);
  const result = await runRideInterpretationV04Candidate(candidateInput, provider, "unsupported-number-repair");
  assert.equal(result.source, "b0");
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.ok(result.validationIssues.includes("OVERALL_UNSUPPORTED_NUMBER"));
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
