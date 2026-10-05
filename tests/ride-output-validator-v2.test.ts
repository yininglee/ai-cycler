import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_MODEL_INPUT_RULES_VERSION,
  RIDE_MODEL_INPUT_SCHEMA_VERSION,
  type RideModelInputQuestionV2,
  type RideModelInputV2,
} from "../src/domain/ride-model-input-v2.ts";
import {
  RIDE_EVIDENCE_RULES_VERSION,
  RIDE_EVIDENCE_SCHEMA_VERSION,
  type V2AnalysisClaim,
} from "../src/domain/ride-analysis-evidence-v2.ts";
import {
  RIDE_OUTPUT_SCHEMA_VERSION,
  type RideModelOutputV2,
} from "../src/ai/ride-output-schema-v2.ts";
import { validateRideModelOutputV2 } from "../src/ai/ride-output-validator-v2.ts";

const powerMean = claim("c-power-mean", { key: "power.mean", value: 220, unit: "W", displayValue: "220" });
const powerCv = claim("c-power-cv", {
  key: "power.coefficientOfVariation",
  value: 0.041,
  unit: "ratio",
  displayValue: "4.1",
  displayUnit: "%",
  supports: ["power_stability"],
});
const hrMean = claim("c-hr-mean", { key: "heartRate.mean", value: 150, unit: "bpm", displayValue: "150" });
const historyPower = claim("c-history-power", {
  kind: "history",
  key: "history.same_route.power",
  value: 205,
  unit: "W",
  displayValue: "205",
});

function claim(claimId: string, overrides: Partial<V2AnalysisClaim> = {}): V2AnalysisClaim {
  return {
    claimId,
    rideId: "ride-1",
    kind: "metric",
    key: `power.${claimId}`,
    value: 1,
    unit: "W",
    confidence: "high",
    provenance: "calculated",
    qualityStatus: "valid",
    sourceRefs: [],
    evidenceIds: [],
    supports: [],
    prohibits: ["causation"],
    ...overrides,
  };
}

function question(
  dimensionId: string,
  claims: V2AnalysisClaim[],
  overrides: Partial<RideModelInputQuestionV2> = {},
): RideModelInputQuestionV2 {
  return {
    dimensionId,
    question: `question for ${dimensionId}`,
    eligibility: "available",
    qualityStatus: "valid",
    claims,
    limitations: [],
    supports: [],
    prohibits: [],
    knowledge: [],
    recommendationAnchorClaimIds: [],
    ...overrides,
  };
}

function makeInput(questions: RideModelInputQuestionV2[]): RideModelInputV2 {
  return {
    schemaVersion: RIDE_MODEL_INPUT_SCHEMA_VERSION,
    rulesVersion: RIDE_MODEL_INPUT_RULES_VERSION,
    evidenceRulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    evidenceSchemaVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rideId: "ride-1",
    analysisRunId: "run-s6-01",
    userScope: "user-s6-01",
    privacyFlags: [],
    questions,
    inputStats: {
      totalCharacters: 0,
      maxInputCharacters: 160_000,
      questionCount: questions.length,
      claimCount: questions.reduce((total, item) => total + item.claims.length, 0),
      knowledgeCount: 0,
    },
  };
}

const powerQuestion = question("powerOutput", [powerMean, powerCv], {
  limitations: ["power.coverage:90%"],
  knowledge: [{
    knowledgeId: "kb-1",
    citation: "TrainingPeaks Glossary",
    explanation: "按 TrainingPeaks 指标标准，单次 TSS 超过 300 后恢复需求显著上升。",
    conditions: [],
  }],
});
const hrQuestion = question("heartRateLoad", [hrMean]);

function standardInput(): RideModelInputV2 {
  return makeInput([powerQuestion, hrQuestion]);
}

function baseOutput(overrides: Partial<RideModelOutputV2> = {}): RideModelOutputV2 {
  return {
    schemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
    label: { text: "本次骑行功率输出集中", conclusionType: "fact", claimIds: ["c-power-mean"] },
    overallAssessment: {
      text: "本次骑行功率与心率数据完整，整体为一次中等强度的耐力训练。",
      conclusionType: "fact",
      claimIds: ["c-power-mean", "c-hr-mean"],
    },
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "平均功率 220W，变异系数 4.1%，输出稳定。", conclusionType: "fact", claimIds: ["c-power-mean", "c-power-cv"] },
        ],
      },
      {
        dimensionId: "heartRateLoad",
        assertions: [{ text: "平均心率 150bpm。", conclusionType: "fact", claimIds: ["c-hr-mean"] }],
      },
    ],
    suggestions: [
      { text: "下一次骑行可关注热身后阈值区间的可重复性。", conclusionType: "suggestion", claimIds: ["c-power-mean"] },
    ],
    limitations: ["power.coverage:90%"],
    ...overrides,
  };
}

function failureCodes(result: ReturnType<typeof validateRideModelOutputV2>): string[] {
  assert.equal(result.status, "fail");
  if (result.status !== "fail") throw new Error("unreachable");
  return result.issues.map((item) => item.code);
}

test("S6-01 accepts a contract-compliant output with citations and limitation backfill", () => {
  const result = validateRideModelOutputV2(standardInput(), baseOutput());
  assert.deepEqual(result, { status: "pass" });
});

test("S6-01 accepts an output that omits every optional section", () => {
  const output = baseOutput({
    highlights: undefined,
    suggestions: undefined,
    historyComparison: undefined,
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), output), { status: "pass" });
});

test("S6-01 blocks fabricated claim and knowledge references", () => {
  const fabricatedClaim = baseOutput({
    label: { text: "本次骑行功率输出集中", conclusionType: "fact", claimIds: ["c-fabricated"] },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), fabricatedClaim)).includes("CLAIM_NOT_IN_INPUT"));

  const fabricatedKnowledge = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "功率区间划分通常以 FTP 为锚。", conclusionType: "knowledgeReference", claimIds: ["c-power-mean"], knowledgeIds: ["kb-fake"] },
        ],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), fabricatedKnowledge)).includes("KNOWLEDGE_NOT_IN_INPUT"));
});

test("S6-01 blocks stability wording without a variance claim", () => {
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), output)).includes("STABILITY_WITHOUT_VARIANCE"));
});

test("S6-01 blocks history wording and historyComparison without comparable history", () => {
  const withSection = baseOutput({
    historyComparison: { text: "相比之前有进步。", conclusionType: "historyComparison", claimIds: ["c-power-mean"] },
  });
  const codes = failureCodes(validateRideModelOutputV2(standardInput(), withSection));
  assert.ok(codes.includes("HISTORY_WITHOUT_BASELINE"));

  const withWording = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均功率 220W，相比之前有进步。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), withWording)).includes("HISTORY_WITHOUT_BASELINE"));

  const historyInput = makeInput([
    { ...powerQuestion, claims: [...powerQuestion.claims, historyPower] },
    hrQuestion,
  ]);
  const validHistory = baseOutput({
    historyComparison: { text: "同等路线平均功率 220W，此前为 205W。", conclusionType: "historyComparison", claimIds: ["c-power-mean", "c-history-power"] },
  });
  assert.deepEqual(validateRideModelOutputV2(historyInput, validHistory), { status: "pass" });
});

test("PMC-01 passes recovery wording backed by a TSB claim at or above +5", () => {
  const tsbClaim = claim("c-pmc-tsb", {
    kind: "history",
    key: "history.pmc.tsb",
    value: 12.5,
    unit: "TSS",
    displayValue: "+12.5",
    supports: ["recovery_signal", "long_term_load"],
  });
  const historyQuestion = question("historicalPerformance", [tsbClaim]);
  const output = baseOutput({
    historyComparison: {
      text: "训练负荷平衡（TSB +12.5），整体恢复良好。",
      conclusionType: "historyComparison",
      claimIds: ["c-pmc-tsb"],
    },
  });
  const result = validateRideModelOutputV2(makeInput([powerQuestion, hrQuestion, historyQuestion]), output);
  assert.equal(result.status, "pass");
});

test("PMC-01 still blocks recovery wording when TSB is below +5 or unreferenced", () => {
  const lowTsbClaim = claim("c-pmc-tsb-low", {
    kind: "history",
    key: "history.pmc.tsb",
    value: 3,
    unit: "TSS",
    displayValue: "+3",
    supports: ["recovery_signal"],
  });
  const historyQuestion = question("historicalPerformance", [lowTsbClaim]);
  const input = makeInput([powerQuestion, hrQuestion, historyQuestion]);
  const lowTsb = baseOutput({
    historyComparison: {
      text: "训练负荷平衡（TSB +3），整体恢复良好。",
      conclusionType: "historyComparison",
      claimIds: ["c-pmc-tsb-low"],
    },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(input, lowTsb)).includes("RECOVERY_CONCLUSION_FORBIDDEN"));

  const unreferenced = baseOutput({
    overallAssessment: {
      text: "本次骑行功率与心率数据完整，整体恢复良好。",
      conclusionType: "fact",
      claimIds: ["c-power-mean", "c-hr-mean"],
    },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(input, unreferenced)).includes("RECOVERY_CONCLUSION_FORBIDDEN"));
});

test("S6-01 blocks causal, plan, and recovery conclusions", () => {
  const causal = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "后段爬坡导致了功率下降。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), causal)).includes("CAUSALITY_UPGRADED"));

  const plan = baseOutput({
    label: { text: "本次骑行完成了训练计划", conclusionType: "fact", claimIds: ["c-power-mean"] },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), plan)).includes("PLAN_COMPLETION_FORBIDDEN"));

  const recovery = baseOutput({
    overallAssessment: {
      text: "本次骑行功率与心率数据完整，整体恢复良好。",
      conclusionType: "fact",
      claimIds: ["c-power-mean", "c-hr-mean"],
    },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), recovery)).includes("RECOVERY_CONCLUSION_FORBIDDEN"));
});

test("PMC-01 exempts recovery/load wording inside suggestions from the recovery gate", () => {
  const suggestion = baseOutput({
    suggestions: [
      {
        text: "近期负荷偏高，建议这几天注意恢复、适当降低负荷，恢复良好后再考虑加量。",
        conclusionType: "suggestion",
        claimIds: ["c-power-mean"],
      },
    ],
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), suggestion), { status: "pass" });
});

test("PMC-01 allows knowledge-reference numbers quoted from the cited knowledge explanation", () => {
  const output = baseOutput({
    dimensions: [
      {
        ...baseOutput().dimensions[0],
        assertions: [
          {
            text: "按 TrainingPeaks 指标标准，单次超过 300 后恢复需求显著上升。",
            conclusionType: "knowledgeReference",
            claimIds: [],
            knowledgeIds: ["kb-1"],
          },
        ],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), output), { status: "pass" });
});

test("PMC-01 still blocks knowledge-reference numbers absent from the cited knowledge", () => {
  const output = baseOutput({
    dimensions: [
      {
        ...baseOutput().dimensions[0],
        assertions: [
          {
            text: "按 TrainingPeaks 指标标准，单次超过 500 后恢复需求显著上升。",
            conclusionType: "knowledgeReference",
            claimIds: [],
            knowledgeIds: ["kb-1"],
          },
        ],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), output)).includes("NUMBER_NOT_IN_CLAIMS"));
});

test("S6-01 allows goal-oriented suggestion wording while blocking plan assertions", () => {
  const goalOriented = baseOutput({
    suggestions: [
      {
        text: "如果想要进步，你可以在下次训练计划加入短爬坡间歇。",
        conclusionType: "suggestion",
        claimIds: ["c-power-mean"],
      },
    ],
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), goalOriented), { status: "pass" });

  const planAssertion = baseOutput({
    label: { text: "本次骑行完成了训练计划", conclusionType: "fact", claimIds: ["c-power-mean"] },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), planAssertion)).includes("PLAN_COMPLETION_FORBIDDEN"));
});

test("S6-01 allows occurrence wording and operational suggestion numbers", () => {
  const factWithOccurrence = baseOutput({
    label: {
      text: "近3次骑行中这一次输出最集中",
      conclusionType: "fact",
      claimIds: ["c-power-mean", "c-power-cv"],
    },
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), factWithOccurrence), { status: "pass" });

  const suggestionWithOperationalNumbers = baseOutput({
    suggestions: [
      {
        text: "建议准备100ml电解质水，途中每15分钟补充一次。",
        conclusionType: "suggestion",
        claimIds: ["c-power-mean"],
      },
    ],
  });
  assert.deepEqual(
    validateRideModelOutputV2(standardInput(), suggestionWithOperationalNumbers),
    { status: "pass" },
  );
});

test("S6-01 allows operational and methodology stability wording, blocks assertive stability", () => {
  const suggestionStability = baseOutput({
    suggestions: [
      {
        text: "下次骑行尽量保持稳定输出，可降低无谓的体力波动。",
        conclusionType: "suggestion",
        claimIds: ["c-power-mean"],
      },
    ],
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), suggestionStability), { status: "pass" });

  const knowledgeStability = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "长时间配速保持稳定的骑行通常有利于有氧基础发展。", conclusionType: "knowledgeReference", claimIds: ["c-power-mean"], knowledgeIds: ["kb-1"] },
        ],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(validateRideModelOutputV2(standardInput(), knowledgeStability).status === "pass");
});

test("S6-01 blocks numbers that do not match the referenced claims", () => {
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均功率 250W，变异系数 4.1%，输出稳定。", conclusionType: "fact", claimIds: ["c-power-mean", "c-power-cv"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), output)).includes("NUMBER_NOT_IN_CLAIMS"));
});

test("S6-01 blocks suggestions without a factual anchor", () => {
  const output = baseOutput({
    suggestions: [{ text: "建议保持当前节奏。", conclusionType: "suggestion", claimIds: [] }],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), output)).includes("SUGGESTION_ANCHOR_MISSING"));
});

test("S6-01 blocks knowledge acting as a personal fact or cited without knowledge IDs", () => {
  const knowledgeAsFact = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "本次骑行属于轻度负荷。", conclusionType: "fact", claimIds: [], knowledgeIds: ["kb-1"] },
        ],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), knowledgeAsFact)).includes("FACT_WITHOUT_CLAIM"));

  const knowledgeWithoutId = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "功率区间划分通常以 FTP 为锚。", conclusionType: "knowledgeReference", claimIds: ["c-power-mean"] },
        ],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), knowledgeWithoutId)).includes("KNOWLEDGE_REFERENCE_WITHOUT_KNOWLEDGE"));
});

test("S6-01 blocks structural contract violations", () => {
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), null)).includes("OUTPUT_NOT_OBJECT"));

  const missingLabel = baseOutput() as unknown as Record<string, unknown>;
  delete missingLabel.label;
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), missingLabel)).includes("FIELD_MISSING"));

  const wrongVersion = baseOutput({ schemaVersion: "ride-output-v1.0.0" });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), wrongVersion)).includes("SCHEMA_VERSION_MISMATCH"));

  const noDimensions = baseOutput({ dimensions: [] });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), noDimensions)).includes("DIMENSIONS_EMPTY"));

  const weakLabel = baseOutput({
    label: {
      text: "本次骑行功率输出一般",
      conclusionType: "fact",
      claimIds: [claim("c-low", { confidence: "low", key: "power.low", value: 1, displayValue: "1" }).claimId],
    },
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), weakLabel)).includes("LABEL_CLAIM_REQUIRED"));
});

test("S6-01 enforces verbatim limitation backfill", () => {
  const invented = baseOutput({ limitations: ["power.coverage:90%", "编造的限制"] });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), invented)).includes("LIMITATION_NOT_FROM_INPUT"));

  const notBackfilled = baseOutput({ limitations: [] });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), notBackfilled)).includes("LIMITATION_BACKFILL_MISSING"));
});

test("S6-01 enforces dimension scoping of claims and knowledge", () => {
  const crossDimension = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均心率 150bpm。", conclusionType: "fact", claimIds: ["c-hr-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), crossDimension)).includes("CLAIM_NOT_IN_DIMENSION"));

  const unknownDimension = baseOutput({
    dimensions: [
      { dimensionId: "nutrition", assertions: [{ text: "补给策略合理。", conclusionType: "fact", claimIds: ["c-power-mean"] }] },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), unknownDimension)).includes("DIMENSION_NOT_IN_INPUT"));
});

test("S6-01 enforces soft-quality disclosure and data-limited assessment", () => {
  const softInput = makeInput([
    { ...powerQuestion, qualityStatus: "soft" },
    hrQuestion,
  ]);
  const undisclosed = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均功率 220W，变异系数 4.1%，输出稳定。", conclusionType: "fact", claimIds: ["c-power-mean", "c-power-cv"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(softInput, undisclosed)).includes("SOFT_QUALITY_NOT_DISCLOSED"));

  const singleQuestionInput = makeInput([powerQuestion]);
  const singleQuestionOutput = (overrides: Partial<RideModelOutputV2>): RideModelOutputV2 =>
    baseOutput({
      dimensions: [baseOutput().dimensions[0]],
      overallAssessment: { text: "本次骑行整体为中等强度耐力训练。", conclusionType: "fact", claimIds: ["c-power-mean"] },
      ...overrides,
    });
  const noDisclosure = singleQuestionOutput({});
  assert.ok(failureCodes(validateRideModelOutputV2(singleQuestionInput, noDisclosure)).includes("DATA_LIMITED_NOT_STATED"));

  const disclosed = singleQuestionOutput({
    overallAssessment: { text: "本次可用数据有限，整体为中等强度耐力训练。", conclusionType: "fact", claimIds: ["c-power-mean"] },
  });
  assert.deepEqual(validateRideModelOutputV2(singleQuestionInput, disclosed), { status: "pass" });
});
