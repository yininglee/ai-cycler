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
import {
  RIDE_REPAIR_PROMPT_VERSION,
  buildRideRepairPromptV2,
  orchestrateRideOutputValidationV2,
  sanitizeRideOutputForRepairReference,
  type RideOutputRepairCallV2,
} from "../src/ai/ride-output-repair-v2.ts";

// S2-06: claims live once at the top level of the input; the pool lets
// hand-built questions reference them by id like the production assembler.
const claimPool = new Map<string, V2AnalysisClaim>();

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
  return {
    schemaVersion: RIDE_MODEL_INPUT_SCHEMA_VERSION,
    rulesVersion: RIDE_MODEL_INPUT_RULES_VERSION,
    evidenceRulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    evidenceSchemaVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rideId: "ride-1",
    analysisRunId: "run-s6-02",
    userScope: "user-s6-02",
    privacyFlags: [],
    claims: [...claimIds].map((id) => claimPool.get(id)!),
    knowledge: [],
    questions,
    inputStats: {
      totalCharacters: 0,
      modelVisibleCharacters: 0,
      maxInputCharacters: 160_000,
      questionCount: questions.length,
      claimCount: claimIds.size,
      knowledgeCount: 0,
      aggregatedRelationPairCount: 0,
      aggregatedRelationWindowCount: 0,
    },
  };
}

const powerQuestion = question("powerOutput", [powerMean, powerCv], {
  limitations: ["power.coverage:90%"],
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

interface CallCounter {
  count: number;
  lastCall?: RideOutputRepairCallV2;
}

function repairCallerReturning(output: unknown, counter: CallCounter) {
  return async (call: RideOutputRepairCallV2): Promise<{ rawText: string }> => {
    counter.count += 1;
    counter.lastCall = call;
    return { rawText: typeof output === "string" ? output : JSON.stringify(output) };
  };
}

function repairCallerThrowing(counter: CallCounter, errorCode = "AI_TIMEOUT") {
  return async (call: RideOutputRepairCallV2): Promise<{ rawText: string }> => {
    counter.count += 1;
    counter.lastCall = call;
    const error = new Error("model request timed out") as Error & { code: string };
    error.code = errorCode;
    throw error;
  };
}

const validRepairOutput = baseOutput();

test("S6-02 passes a first-round valid output with zero repair work", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput(),
    requestId: "req-1",
    repairCaller: repairCallerReturning(baseOutput(), counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "firstPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(counter.count, 0);
});

test("V21-15 P1: an empty-assertions dimension is deleted deterministically (no repair call)", async () => {
  // Regression (R02 live failure amplifier): the model emitted
  // `"assertions": []` for the data-missing cross-sensor dimension (a Prompt
  // v2.8.2 side effect). The validator does not require full dimension
  // coverage, so deleting the empty dimension is lossless — and it must not
  // consume the single model repair call.
  const counter: CallCounter = { count: 0 };
  const output = baseOutput({
    dimensions: [
      { dimensionId: "powerOutput", assertions: [] },
      {
        dimensionId: "heartRateLoad",
        assertions: [{ text: "平均心率 150bpm。", conclusionType: "fact", claimIds: ["c-hr-mean"] }],
      },
    ],
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: output,
    requestId: "req-empty-dimension",
    repairCaller: repairCallerReturning(baseOutput(), counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "deterministicRepairPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(counter.count, 0);
  assert.equal(
    result.steps.some((step) => step.step === "deterministic_organize" && step.detail.includes("empty dimension")),
    true,
  );
  // The emptied powerOutput dimension is gone; heartRateLoad survives.
  const dimensions = (result.output as unknown as { dimensions: Array<{ dimensionId: string }> }).dimensions;
  assert.deepEqual(dimensions.map((dimension) => dimension.dimensionId), ["heartRateLoad"]);
});

test("V21-15 P1: a dimension whose assertions are missing (not an empty array) still goes to the repair call", async () => {
  // Only the exactly-empty array is safe to drop; a dimension with missing /
  // non-array assertions is structural damage and must reach the model
  // repair call instead of being silently deleted.
  const counter: CallCounter = { count: 0 };
  const output = baseOutput({
    dimensions: [
      { dimensionId: "powerOutput" } as unknown as RideModelOutputV2["dimensions"][number],
      {
        dimensionId: "heartRateLoad",
        assertions: [{ text: "平均心率 150bpm。", conclusionType: "fact", claimIds: ["c-hr-mean"] }],
      },
    ],
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: output,
    requestId: "req-broken-dimension",
    repairCaller: repairCallerReturning(baseOutput(), counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "modelRepairPass");
  assert.equal(counter.count, 1);
});

test("S6-02 deterministically fixes schema version and limitation backfill, then fully revalidates", async () => {
  const counter: CallCounter = { count: 0 };
  const broken = baseOutput({
    schemaVersion: "ride-output-v1.0.0",
    limitations: [],
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: broken,
    requestId: "req-2",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "deterministicRepairPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(counter.count, 0);
  assert.ok(result.output);
  assert.equal(result.output.schemaVersion, RIDE_OUTPUT_SCHEMA_VERSION);
  assert.deepEqual(result.output.limitations, ["power.coverage:90%"]);
  // The original first output must not be mutated by organizing.
  assert.deepEqual(broken.limitations, []);
  assert.equal(broken.schemaVersion, "ride-output-v1.0.0");
});

test("S6-02 deterministically filters fabricated limitation entries back to input text", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput({ limitations: ["power.coverage:90%", "编造的限制"] }),
    requestId: "req-3",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "deterministicRepairPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.deepEqual(result.output?.limitations, ["power.coverage:90%"]);
});

test("S6-02 deletes invalid optional fragments (fabricated highlight, anchorless suggestion) deterministically", async () => {
  const counter: CallCounter = { count: 0 };
  const output = baseOutput({
    highlights: [
      { text: "峰值功率惊人。", conclusionType: "fact", claimIds: ["c-fabricated"] },
    ],
    suggestions: [{ text: "建议保持当前节奏。", conclusionType: "suggestion", claimIds: [] }],
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: output,
    requestId: "req-4",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "deterministicRepairPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(counter.count, 0);
  // Fabricated citation was confined to the optional highlight, so deletion
  // resolved it — the rest of the output survived intact.
  assert.deepEqual(result.output?.highlights, []);
  assert.deepEqual(result.output?.suggestions, []);
});

test("S6-02 deletes an optional historyComparison without comparable history", async () => {
  const counter: CallCounter = { count: 0 };
  // S2-06: historyComparison left the output contract; a non-compliant
  // response that still carries it gets the fragment deleted deterministically.
  const firstOutput = baseOutput() as unknown as Record<string, unknown>;
  firstOutput.historyComparison = { text: "相比之前有进步。", conclusionType: "historyComparison", claimIds: ["c-power-mean"] };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput,
    requestId: "req-5",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "deterministicRepairPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(
    (result.output as unknown as Record<string, unknown>).historyComparison,
    undefined,
  );
});

test("S6-02 performs exactly one constrained model repair when local organizing cannot fix a core wording issue", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput({
      dimensions: [
        {
          dimensionId: "powerOutput",
          assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
        },
        ...baseOutput().dimensions.slice(1),
      ],
    }),
    requestId: "req-6",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "modelRepairPass");
  assert.equal(result.modelRepairCalls, 1);
  assert.equal(counter.count, 1);
  // The repair prompt must carry the server error codes and the original input.
  assert.ok(counter.lastCall);
  assert.equal(counter.lastCall.promptVersion, RIDE_REPAIR_PROMPT_VERSION);
  assert.ok(counter.lastCall.promptText.includes("STABILITY_WITHOUT_VARIANCE"));
  assert.ok(counter.lastCall.promptText.includes("run-s6-02"));
  assert.ok(counter.lastCall.promptText.includes("c-power-mean"));
  assert.ok(counter.lastCall.promptText.includes("power.mean"));
});

test("S6-02 degrades after a failed repair with exactly one repair call and no third attempt", async () => {
  const counter: CallCounter = { count: 0 };
  const stillBroken = baseOutput({
    dimensions: [
      {
        dimensionId: "powerOutput",
        assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
      },
      ...baseOutput().dimensions.slice(1),
    ],
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: stillBroken,
    requestId: "req-7",
    repairCaller: repairCallerReturning(stillBroken, counter),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.stage, "repairFailed");
  assert.equal(result.modelRepairCalls, 1);
  assert.equal(counter.count, 1);
  assert.equal(result.fallback?.reason, "REPAIR_OUTPUT_INVALID");
  assert.ok(result.fallback?.failureCodes.includes("STABILITY_WITHOUT_VARIANCE"));
});

test("S6-02 rejects a repair output that invents a new claim reference", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput({
      dimensions: [
        {
          dimensionId: "powerOutput",
          assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
        },
        ...baseOutput().dimensions.slice(1),
      ],
    }),
    requestId: "req-8",
    repairCaller: repairCallerReturning(
      baseOutput({ label: { text: "本次骑行功率输出集中", conclusionType: "fact", claimIds: ["c-invented"] } }),
      counter,
    ),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.reason, "REPAIR_OUTPUT_INVALID");
  assert.ok(result.fallback?.failureCodes.includes("CLAIM_NOT_IN_INPUT"));
  assert.equal(result.modelRepairCalls, 1);
});

test("S6-02 never repairs fabricated citations in core content — direct fallback with zero repair calls", async () => {
  const counter: CallCounter = { count: 0 };
  const fabricatedLabel = baseOutput({
    label: { text: "本次骑行功率输出集中", conclusionType: "fact", claimIds: ["c-fabricated"] },
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: fabricatedLabel,
    requestId: "req-9",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.reason, "UNREPAIRABLE_ISSUES");
  assert.ok(result.fallback?.failureCodes.includes("CLAIM_NOT_IN_INPUT"));
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(counter.count, 0);
});

test("PMC-01 gives recovery wording without TSB support exactly one model repair", async () => {
  const counter: CallCounter = { count: 0 };
  const recovery = baseOutput({
    overallAssessment: {
      text: "本次骑行功率与心率数据完整，整体恢复良好。",
      conclusionType: "fact",
      claimIds: ["c-power-mean", "c-hr-mean"],
    },
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: recovery,
    requestId: "req-10",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "modelRepairPass");
  assert.equal(result.modelRepairCalls, 1);
  assert.equal(counter.count, 1);
});

test("PMC-01 degrades after the single repair when recovery wording persists", async () => {
  const counter: CallCounter = { count: 0 };
  const recovery = baseOutput({
    overallAssessment: {
      text: "本次骑行功率与心率数据完整，整体恢复良好。",
      conclusionType: "fact",
      claimIds: ["c-power-mean", "c-hr-mean"],
    },
  });
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: recovery,
    requestId: "req-10b",
    // The repair output keeps the unsupported recovery wording.
    repairCaller: repairCallerReturning(recovery, counter),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.reason, "REPAIR_OUTPUT_INVALID");
  assert.ok(result.fallback?.failureCodes.includes("RECOVERY_CONCLUSION_FORBIDDEN"));
  assert.equal(result.modelRepairCalls, 1);
  assert.equal(counter.count, 1);
});

test("S6-02 skips the model repair when the caller bars it (budget) and degrades", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput({
      dimensions: [
        {
          dimensionId: "powerOutput",
          assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
        },
        ...baseOutput().dimensions.slice(1),
      ],
    }),
    requestId: "req-11",
    repairCaller: repairCallerReturning(validRepairOutput, counter),
    allowModelRepair: false,
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.reason, "REPAIR_NOT_ALLOWED");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(counter.count, 0);
});

test("S6-02 degrades when the single repair call itself fails with a provider error", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput({
      dimensions: [
        {
          dimensionId: "powerOutput",
          assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
        },
        ...baseOutput().dimensions.slice(1),
      ],
    }),
    requestId: "req-12",
    repairCaller: repairCallerThrowing(counter, "AI_TIMEOUT"),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.reason, "REPAIR_CALL_FAILED");
  assert.equal(result.fallback?.providerErrorCode, "AI_TIMEOUT");
  assert.equal(result.modelRepairCalls, 1);
  assert.equal(counter.count, 1);
});

test("S6-02 degrades when the repair response is not JSON", async () => {
  const counter: CallCounter = { count: 0 };
  const result = await orchestrateRideOutputValidationV2({
    input: standardInput(),
    firstOutput: baseOutput({
      dimensions: [
        {
          dimensionId: "powerOutput",
          assertions: [{ text: "本次输出非常稳定。", conclusionType: "fact", claimIds: ["c-power-mean"] }],
        },
        ...baseOutput().dimensions.slice(1),
      ],
    }),
    requestId: "req-13",
    repairCaller: repairCallerReturning("这不是 JSON", counter),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.fallback?.reason, "REPAIR_OUTPUT_UNPARSEABLE");
  assert.equal(result.modelRepairCalls, 1);
});

test("S6-02 sanitizes the previous output to the field whitelist before attaching it to the repair prompt", () => {
  const output = baseOutput() as unknown as Record<string, unknown>;
  output.secretToken = "should-not-appear";
  (output.label as Record<string, unknown>).internalNote = "drop me";
  const sanitized = sanitizeRideOutputForRepairReference(output);
  assert.ok(sanitized);
  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes("secretToken"));
  assert.ok(!serialized.includes("internalNote"));
  assert.ok(!serialized.includes("schemaVersion"));
  assert.ok(serialized.includes("c-power-mean"));

  // Non-object outputs produce no reference at all (pure regeneration).
  assert.equal(sanitizeRideOutputForRepairReference("垃圾文本"), undefined);
});

test("S6-02 repair prompt is versioned and carries error codes, input, and reference state", () => {
  const withReference = buildRideRepairPromptV2({
    input: standardInput(),
    issues: [
      { code: "STABILITY_WITHOUT_VARIANCE", path: "dimensions[0].assertions[0]", message: "stability wording requires a variance claim" },
    ],
    sanitizedPreviousOutput: { label: { text: "x", conclusionType: "fact", claimIds: ["c-power-mean"] } },
  });
  assert.equal(withReference.promptVersion, RIDE_REPAIR_PROMPT_VERSION);
  assert.ok(withReference.promptText.includes("STABILITY_WITHOUT_VARIANCE"));
  assert.ok(withReference.promptText.includes("dimensions[0].assertions[0]"));
  assert.ok(withReference.promptText.includes("run-s6-02"));
  assert.ok(withReference.promptText.includes("c-power-mean"));

  const withoutReference = buildRideRepairPromptV2({
    input: standardInput(),
    issues: [{ code: "OUTPUT_NOT_OBJECT", path: "output", message: "model output must be a JSON object" }],
  });
  assert.ok(withoutReference.promptText.includes("不提供上一版输出"));
});
