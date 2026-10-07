import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_MODEL_INPUT_RULES_VERSION,
  RIDE_MODEL_INPUT_SCHEMA_VERSION,
  type RideModelInputKnowledgeV2,
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

// S2-06: claims and knowledge live once at the top level of the input; the
// pools below let hand-built questions reference them by id exactly like the
// production assembler does.
const claimPool = new Map<string, V2AnalysisClaim>();
const knowledgePool = new Map<string, RideModelInputKnowledgeV2>();

function claim(claimId: string, overrides: Partial<V2AnalysisClaim> = {}): V2AnalysisClaim {
  const value: V2AnalysisClaim = {
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
  claimPool.set(claimId, value);
  return value;
}

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

function knowledge(knowledgeId: string, overrides: Partial<RideModelInputKnowledgeV2> = {}): RideModelInputKnowledgeV2 {
  const value: RideModelInputKnowledgeV2 = {
    knowledgeId,
    citation: "TrainingPeaks Glossary",
    explanation: "按 TrainingPeaks 指标标准，单次 TSS 超过 300 后恢复需求显著上升。",
    conditions: [],
    ...overrides,
  };
  knowledgePool.set(knowledgeId, value);
  return value;
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
    claimIds: claims.map((item) => item.claimId),
    limitations: [],
    supports: [],
    prohibits: [],
    knowledgeIds: [],
    recommendationAnchorClaimIds: [],
    ...overrides,
  };
}

function makeInput(questions: RideModelInputQuestionV2[]): RideModelInputV2 {
  const claimIds = new Set(questions.flatMap((item) => item.claimIds));
  const knowledgeIds = new Set(questions.flatMap((item) => item.knowledgeIds));
  return {
    schemaVersion: RIDE_MODEL_INPUT_SCHEMA_VERSION,
    rulesVersion: RIDE_MODEL_INPUT_RULES_VERSION,
    evidenceRulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    evidenceSchemaVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rideId: "ride-1",
    analysisRunId: "run-s6-01",
    userScope: "user-s6-01",
    privacyFlags: [],
    claims: [...claimIds].map((id) => claimPool.get(id)!),
    knowledge: [...knowledgeIds].map((id) => knowledgePool.get(id)!),
    questions,
    inputStats: {
      totalCharacters: 0,
      modelVisibleCharacters: 0,
      maxInputCharacters: 160_000,
      questionCount: questions.length,
      claimCount: claimIds.size,
      knowledgeCount: knowledgeIds.size,
      aggregatedRelationPairCount: 0,
      aggregatedRelationWindowCount: 0,
    },
  };
}

// S2-06 defense line: the output contract no longer has a top-level
// historyComparison field, but the validator still rejects one — attach it
// the way a non-compliant model response would.
function attachHistoryComparison(output: RideModelOutputV2, assertion: unknown): RideModelOutputV2 {
  (output as unknown as Record<string, unknown>).historyComparison = assertion;
  return output;
}

const powerKnowledge = knowledge("kb-1");
const powerQuestion = question("powerOutput", [powerMean, powerCv], {
  limitations: ["power.coverage:90%"],
  knowledgeIds: [powerKnowledge.knowledgeId],
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

test("S6-01 does not treat the Z2 zone name 稳定区间 as a stability assertion", () => {
  // Regression (2026-10-06 live run): quoting the official cadence/power zone
  // name and its share is faithful zone reporting, not a stability claim.
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "功率分布主要集中在稳定区间。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const result = validateRideModelOutputV2(standardInput(), output);
  assert.equal(result.status === "fail" ? result.issues.some((issue) => issue.code === "STABILITY_WITHOUT_VARIANCE") : false, false);
});

test("S6-01 does not treat the cadence zone name 稳定踏频 as a stability assertion", () => {
  // Regression (2026-10-07 live run, REPAIR_FAILED diagnosis): "稳定踏频占 7%"
  // is cadence zone-share reporting translated from claim key
  // cadence.zone.steady — same class as the PD-AI-22 稳定区间 exemption.
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "本次骑行平均踏频 79 rpm。踏频区间分布为：零踏频占 6%，稳定踏频占 7%，耐力踏频占 48%。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const result = validateRideModelOutputV2(standardInput(), output);
  assert.equal(result.status === "fail" ? result.issues.some((issue) => issue.code === "STABILITY_WITHOUT_VARIANCE") : false, false);
});

test("S6-01 does not treat the zone translation 稳定区 as a stability assertion", () => {
  // Regression (2026-10-07 second live run): the model translated
  // cadence.zone.steady as "稳定区" — a third attested translation of the same
  // zone-share wording, exempted alongside 稳定区间/稳定踏频.
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "踏频区间分布为：零区 6%，稳定区 7%，耐力区 48%，高区 33%。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const result = validateRideModelOutputV2(standardInput(), output);
  assert.equal(result.status === "fail" ? result.issues.some((issue) => issue.code === "STABILITY_WITHOUT_VARIANCE") : false, false);
});

test("S6-01 does not treat bare zone name + share 稳定 N% as a stability assertion", () => {
  // Regression (2026-10-07 STABILITY_WITHOUT_VARIANCE diagnosis, demo-08-20):
  // the model translated cadence.zone.steady as bare "稳定 7%" with no 踏频/区
  // suffix. A zone name followed directly by a percentage is zone-share
  // reporting, not a stability assertion (a real stability assertion never
  // carries a percentage immediately after the word).
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均踏频 79rpm，踏频区间分布：零速 6%、低踏频 6%、稳定 7%、耐力 48%、高踏频 33%。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const result = validateRideModelOutputV2(standardInput(), output);
  assert.equal(result.status === "fail" ? result.issues.some((issue) => issue.code === "STABILITY_WITHOUT_VARIANCE") : false, false);
});

test("S6-01 does not treat 平稳 N% as a stability assertion, but bare 平稳 still is", () => {
  // Regression (2026-10-07): the 平稳 branch previously used a POSITIVE
  // lookahead (平稳(?=\s*\d+\s*%)), which inverted the intent — "平稳 37%"
  // (zone share) was flagged while a bare "平稳" (a real assertion) slipped
  // through. Both shapes are now covered:
  //   - 平稳 N% = zone-share reporting → exempt;
  //   - bare 平稳 = stability assertion → still blocked without a variance claim.
  const zoneShare = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "功率分布平稳 37%。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const zoneShareResult = validateRideModelOutputV2(standardInput(), zoneShare);
  assert.equal(zoneShareResult.status === "fail" ? zoneShareResult.issues.some((issue) => issue.code === "STABILITY_WITHOUT_VARIANCE") : false, false);

  const bareAssertion = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "本次输出整体平稳。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(standardInput(), bareAssertion)).includes("STABILITY_WITHOUT_VARIANCE"));
});

test("S6-01 treats named-segment ordinals (巡航段1) as structural, not data values", () => {
  // Regression (2026-10-07 live run): "巡航段1（2 分钟）平均速度 29.97 km/h" got
  // its segment INDEX flagged as NUMBER_NOT_IN_CLAIMS. Business rules 14.5.1
  // exempt segment ordinals; the span's "2 分钟" is still number-checked.
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "巡航段1（2 分钟）平均速度 29.97 km/h，巡航段2（2 分钟）平均速度 27.96 km/h。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const result = validateRideModelOutputV2(standardInput(), output);
  // 29.97 / 27.96 may still be flagged (not in c-power-mean) — but the ordinal
  // "1" itself must not appear as a standalone failure reason.
  const ordinalFlag = result.status === "fail"
    ? result.issues.some((issue) => issue.code === "NUMBER_NOT_IN_CLAIMS" && issue.message.includes("number 1 ") && !issue.message.includes("29"))
    : false;
  assert.equal(ordinalFlag, false);
});

test("S6-01 blocks history wording and historyComparison without comparable history", () => {
  // S2-06: the top-level historyComparison section left the output contract;
  // a non-compliant response that still carries it must be rejected.
  const withSection = attachHistoryComparison(
    baseOutput(),
    { text: "相比之前有进步。", conclusionType: "historyComparison", claimIds: ["c-power-mean"] },
  );
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

  // Validator behavior when the input DOES carry history claims (pure-function
  // coverage; the production single-ride chain no longer builds such inputs).
  const historyInput = makeInput([
    { ...powerQuestion, claimIds: [...powerQuestion.claimIds, historyPower.claimId] },
    hrQuestion,
  ]);
  const validHistory = attachHistoryComparison(
    baseOutput(),
    { text: "同等路线平均功率 220W，此前为 205W。", conclusionType: "historyComparison", claimIds: ["c-power-mean", "c-history-power"] },
  );
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
  const output = attachHistoryComparison(
    baseOutput(),
    {
      text: "训练负荷平衡（TSB +12.5），整体恢复良好。",
      conclusionType: "historyComparison",
      claimIds: ["c-pmc-tsb"],
    },
  );
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
  const lowTsb = attachHistoryComparison(
    baseOutput(),
    {
      text: "训练负荷平衡（TSB +3），整体恢复良好。",
      conclusionType: "historyComparison",
      claimIds: ["c-pmc-tsb-low"],
    },
  );
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

test("PD-AI-27 interpretation must cite at least one claim of its dimension (arm A)", () => {
  const output = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "整体功率输出非常充分，节奏控制得当。", conclusionType: "interpretation", claimIds: [] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(
    failureCodes(validateRideModelOutputV2(standardInput(), output)).includes("INTERPRETATION_WITHOUT_CLAIM"),
  );
});

test("PD-AI-27 interpretation relaxes expression gates but keeps number + causality gates", () => {
  // 表达门豁免：无波动证据的"稳定"在 interpretation 中放行（先松表达门策略）
  const relaxed = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均功率 220W，整体输出稳定，节奏控制得当。", conclusionType: "interpretation", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.deepEqual(validateRideModelOutputV2(standardInput(), relaxed), { status: "pass" });

  // 数字门保留：interpretation 中的数字不在所引 claim 中，仍拦截
  const fabricatedNumber = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "平均功率 300W，整体输出充分。", conclusionType: "interpretation", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(
    failureCodes(validateRideModelOutputV2(standardInput(), fabricatedNumber)).includes("NUMBER_NOT_IN_CLAIMS"),
  );

  // 因果门保留：interpretation 中的因果表述仍拦截（全局红线）
  const causal = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "前段用力过猛导致后段功率下降。", conclusionType: "interpretation", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  assert.ok(
    failureCodes(validateRideModelOutputV2(standardInput(), causal)).includes("CAUSALITY_UPGRADED"),
  );
});

test("PD-AI-27 label and overallAssessment must remain fact, not interpretation", () => {
  const output = baseOutput({
    label: { text: "整体节奏稳健", conclusionType: "interpretation", claimIds: ["c-power-mean"] },
  });
  assert.ok(
    failureCodes(validateRideModelOutputV2(standardInput(), output)).includes("CONCLUSION_TYPE_INVALID"),
  );
});

test("PD-AI-28 allows rounded presentation of a claim value while cross-claim sums stay blocked", () => {
  // Live misfire (2026-10-07 S2-09 acceptance run): "强度因子接近 1.0" was
  // blocked because V2 claimAllowsNumber had no rounding equivalence — the V1
  // claimNumericVariants parity (round to 0/1/2 decimals) was never migrated.
  const intensityFactor = claim("c-if", {
    key: "power.intensityFactor",
    value: 0.9860817388748231,
    unit: "ratio",
    displayValue: "0.99",
  });
  const ifQuestion = question("powerOutput", [intensityFactor, powerMean]);
  const input = makeInput([ifQuestion]);
  const output = (assertionText: string): RideModelOutputV2 =>
    baseOutput({
      overallAssessment: { text: "本次可用数据有限，整体为一次高强度输出。", conclusionType: "fact", claimIds: ["c-power-mean"] },
      dimensions: [
        {
          dimensionId: "powerOutput",
          assertions: [{ text: assertionText, conclusionType: "fact", claimIds: ["c-if", "c-power-mean"] }],
        },
      ],
      suggestions: undefined,
      limitations: [],
    });

  // Rounding equivalence: 0.986... expressed as "接近 1.0" passes (round to 0 decimals = 1).
  const rounded = output("强度因子接近 1.0，平均功率 220W，整体属于高强度输出。");
  assert.deepEqual(validateRideModelOutputV2(input, rounded), { status: "pass" });

  // Cross-claim sums stay blocked (PD-AI-28 permanent rule): a summed number
  // with no single-claim basis is still fabrication and must be rejected.
  const summed = output("强度因子 0.99，平均功率 220W，两者合计 221。");
  assert.ok(
    failureCodes(validateRideModelOutputV2(input, summed)).includes("NUMBER_NOT_IN_CLAIMS"),
  );
});

test("PD-AI-29 ordinal exemption must not strip real data numbers after 第X段 wording", () => {
  // Live misfire (2026-10-07 PD-AI-29 trial run): "第二段 27.96 km/h" had
  // "段 27" stripped as a bare-段 ordinal (the generic 段N pattern), leaving
  // ".96" behind as a ghost number that failed NUMBER_NOT_IN_CLAIMS. The
  // ordinal branch now absorbs the 段 character (第X段) and the bare-段 shape
  // is guarded against a preceding 第, so a real data number directly after
  // "第X段" stays intact.
  const cruise0 = claim("c-cruise-0", { key: "segment.cruise.cruise-0.speed.mean", value: 29.97, unit: "km/h", displayValue: "29.97" });
  const cruise1 = claim("c-cruise-1", { key: "segment.cruise.cruise-1.speed.mean", value: 27.96, unit: "km/h", displayValue: "27.96" });
  const cruise2 = claim("c-cruise-2", { key: "segment.cruise.cruise-2.speed.mean", value: 29.23, unit: "km/h", displayValue: "29.23" });
  const pacingQuestion = question("pacingExecution", [cruise0, cruise1, cruise2]);
  const input = makeInput([pacingQuestion]);
  const output = baseOutput({
    label: { text: "一次配速均衡的通勤骑行", conclusionType: "fact", claimIds: ["c-cruise-0"] },
    overallAssessment: { text: "本次可用数据有限，整体为一次配速均衡的骑行。", conclusionType: "fact", claimIds: ["c-cruise-0"] },
    dimensions: [
      {
        dimensionId: "pacingExecution",
        assertions: [
          { text: "巡航段中，第一段速度 29.97 km/h，第二段 27.96 km/h，第三段 29.23 km/h，整体配速较为均衡。", conclusionType: "interpretation", claimIds: ["c-cruise-0", "c-cruise-1", "c-cruise-2"] },
        ],
      },
    ],
    suggestions: undefined,
    limitations: [],
  });
  assert.deepEqual(validateRideModelOutputV2(input, output), { status: "pass" });
});

test("spaced 第 N 段 / 第 N 个巡航段 ordinal is stripped as structural, not a data number", () => {
  // Live misfire (2026-10-08 upload-f95e988a): the model wrote "第 5 段" then
  // "第 5 个巡航段" for the same cruise segment; the 第X段 branch matched only
  // a trailing 段 and read the 5 as data -> NUMBER_NOT_IN_CLAIMS. The branch
  // now strips the 第N prefix regardless of the trailing noun.
  const span4 = claim("c-span-4", { key: "segment.cruise.cruise-4-1461.span", value: 180, unit: "s", displayValue: "3", displayUnit: "分钟" });
  const speed4 = claim("c-speed-4", { key: "segment.cruise.cruise-4-1461.speed.mean", value: 31.16, unit: "km/h", displayValue: "31.16" });
  const input = makeInput([question("pacingExecution", [span4, speed4])]);
  const output = baseOutput({
    label: { text: "一次巡航配速较高的骑行", conclusionType: "fact", claimIds: ["c-speed-4"] },
    overallAssessment: { text: "本次可用数据有限，整体为一次配速较高的骑行。", conclusionType: "fact", claimIds: ["c-speed-4"] },
    dimensions: [
      {
        dimensionId: "pacingExecution",
        assertions: [
          { text: "巡航段中，第 5 个巡航段（3 分钟）平均速度 31.16 km/h，为全程最快。", conclusionType: "interpretation", claimIds: ["c-span-4", "c-speed-4"] },
        ],
      },
    ],
    suggestions: undefined,
    limitations: [],
  });
  assert.deepEqual(validateRideModelOutputV2(input, output), { status: "pass" });
});

test("PD-AI-31 ordinal guard keeps segment data and strips bare ordinals (段N/坡N)", () => {
  // Regression (2026-10-07 live run + diagnosis): the bare 段N pattern used to
  // strip segment data — "爬坡段 8.1" -> ".1" ghost (NUMBER_NOT_IN_CLAIMS) and
  // "爬坡段 20 公里" -> the 20 vanished (silent under-check). The guard now only
  // strips a digit not followed by a digit/point/unit, so data stays intact and
  // bare ordinals (巡航段1 / 代表性爬坡 1) are still treated as structural.
  const dist = claim("c-climb-dist", { key: "segment.climb.distanceM", value: 20000, unit: "m", displayValue: "20" });
  const descent = claim("c-descent-dist", { key: "segment.climb.descentDistanceM", value: 18300, unit: "m", displayValue: "18.3" });
  const grade = claim("c-climb-grade", { key: "segment.climb.averageGrade", value: 0.058, unit: "ratio", displayValue: "5.8", displayUnit: "%" });
  const delta = claim("c-power-delta", { key: "power.lastMinusFirst", value: -31.5, unit: "W", displayValue: "-31.5" });
  const input = makeInput([question("powerOutput", [dist, descent, grade, delta])]);
  const output = baseOutput({
    label: { text: "一次爬坡为主的骑行", conclusionType: "fact", claimIds: ["c-climb-dist"] },
    overallAssessment: { text: "本次骑行可用数据有限，整体为一次爬坡为主的骑行。", conclusionType: "fact", claimIds: ["c-climb-dist"] },
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "代表性爬坡 1：爬坡段 20 公里，下坡段 18.3 公里，平均坡度 5.8%，末段比首段低 31.5W。", conclusionType: "fact", claimIds: ["c-climb-dist", "c-descent-dist", "c-climb-grade", "c-power-delta"] },
        ],
      },
    ],
    suggestions: undefined,
    limitations: [],
  });
  assert.deepEqual(validateRideModelOutputV2(input, output), { status: "pass" });
});

test("PD-AI-31 ordinal guard still number-checks integer segment data (爬坡段 20 公里)", () => {
  // If the bare 段N pattern still stripped "段 20", a fabricated "20" would
  // silently disappear and the number gate would under-check. It must stay and
  // be rejected because no referenced claim carries 20.
  const dist = claim("c-climb-dist2", { key: "segment.climb.distanceM", value: 25000, unit: "m", displayValue: "25" });
  const input = makeInput([question("powerOutput", [dist])]);
  const output = baseOutput({
    label: { text: "一次爬坡为主的骑行", conclusionType: "fact", claimIds: ["c-climb-dist2"] },
    overallAssessment: { text: "本次骑行可用数据有限。", conclusionType: "fact", claimIds: ["c-climb-dist2"] },
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [
          { text: "爬坡段 20 公里。", conclusionType: "fact", claimIds: ["c-climb-dist2"] },
        ],
      },
    ],
    suggestions: undefined,
    limitations: [],
  });
  assert.ok(failureCodes(validateRideModelOutputV2(input, output)).includes("NUMBER_NOT_IN_CLAIMS"));
});
