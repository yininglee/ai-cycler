import type { RideAnalysisOutputV03 } from "../ai/ride-analysis-output-v03.ts";
import { prepareRideAnalysis } from "../ai/ride-analysis-service.ts";
import { getT001AutomaticRideAnalysisCase } from "../fixtures/ride-analysis-t001.ts";
import type { T001B2EvaluatedBatch, T001B2EvaluatedRecord } from "./t001-b2-benchmark.ts";

export interface PromptAbArmSummary {
  arm: "A" | "B";
  runId: string;
  slotCount: number;
  b2SuccessRate: number;
  firstAttemptContractSuccessRate: number;
  timeoutSlotRate: number;
  repairTriggerRate: number;
  repairSuccessRate: number;
  b0FallbackRate: number;
  providerCallCount: number;
  tokenCount: number;
  claimIntegrity: {
    contractValidRate: number;
    unknownClaimReferenceCount: number;
    unusedAllowedClaimCount: number;
    overallReferencedClaimCount: number;
    b2OutputCount: number;
  };
  humanReadability: "NOT_SCORED";
}

export interface PromptAbComparison {
  schemaVersion: "t001-prompt-ab-comparison-v0.1";
  experimentId: "T001-PROMPT-AB-v0.1";
  status: "READY_FOR_HUMAN_REVIEW";
  conditions: {
    sameInputSet: true;
    sameModel: true;
    timeoutMs: 15_000;
    repetitionsPerCase: 3;
  };
  arms: { A: PromptAbArmSummary; B: PromptAbArmSummary };
  delta: Record<keyof Omit<PromptAbArmSummary, "arm" | "runId" | "slotCount" | "claimIntegrity" | "humanReadability">, number>;
  humanReview: { status: "NOT_SCORED"; packageRequired: true; reviewersRequired: 2 };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Number((count / total).toFixed(4));
}

function outputFor(record: T001B2EvaluatedRecord): RideAnalysisOutputV03 | undefined {
  return record.runtimeResult.source === "b2" ? record.runtimeResult.output : undefined;
}

function claimIntegrity(records: T001B2EvaluatedRecord[]): PromptAbArmSummary["claimIntegrity"] {
  let b2OutputCount = 0;
  let contractValidCount = 0;
  let unknownClaimReferenceCount = 0;
  let unusedAllowedClaimCount = 0;
  let overallReferencedClaimCount = 0;
  for (const record of records) {
    const output = outputFor(record);
    if (!output) continue;
    b2OutputCount += 1;
    // A repaired B2 result is contract-valid even though the runtime retains first-attempt issues for audit.
    contractValidCount += record.runtimeResult.source === "b2" ? 1 : 0;
    const item = getT001AutomaticRideAnalysisCase(record.caseId);
    const prepared = prepareRideAnalysis(item.record, `eval-t001:${record.caseId}`, item.contextOptions);
    const allowed = new Set(prepared.context.allowedClaims.map((claim) => claim.claimId));
    const referenced = new Set<string>(output.overallAssessment.claimIds);
    for (const dimension of output.dimensions) for (const claimId of dimension.claimIds) referenced.add(claimId);
    unknownClaimReferenceCount += [...referenced].filter((claimId) => !allowed.has(claimId)).length;
    unusedAllowedClaimCount += [...allowed].filter((claimId) => !referenced.has(claimId)).length;
    overallReferencedClaimCount += output.overallAssessment.claimIds.length;
  }
  return {
    contractValidRate: rate(contractValidCount, b2OutputCount),
    unknownClaimReferenceCount,
    unusedAllowedClaimCount,
    overallReferencedClaimCount: b2OutputCount === 0 ? 0 : Number((overallReferencedClaimCount / b2OutputCount).toFixed(2)),
    b2OutputCount,
  };
}

export function summarizePromptAbArm(batch: T001B2EvaluatedBatch): PromptAbArmSummary {
  if (!batch.experiment || (batch.experiment.arm !== "A" && batch.experiment.arm !== "B")) {
    throw new Error("PROMPT_AB_EXPERIMENT_METADATA_REQUIRED");
  }
  const records = batch.records;
  const slotCount = records.length;
  const timeoutSlots = records.filter((record) => record.attempts.some((attempt) => attempt.outcome === "timeout")).length;
  const repairTriggered = records.filter((record) => record.attempts.length >= 2).length;
  const repairSucceeded = records.filter((record) => record.runtimeResult.source === "b2" && record.attempts.length === 2).length;
  return {
    arm: batch.experiment.arm,
    runId: batch.runId,
    slotCount,
    b2SuccessRate: rate(batch.summary.b2SuccessCount, slotCount),
    firstAttemptContractSuccessRate: rate(batch.summary.firstAttemptContractValidCount, slotCount),
    timeoutSlotRate: rate(timeoutSlots, slotCount),
    repairTriggerRate: rate(repairTriggered, slotCount),
    repairSuccessRate: rate(repairSucceeded, repairTriggered),
    b0FallbackRate: rate(batch.summary.b0FallbackCount, slotCount),
    providerCallCount: batch.summary.modelCallCount,
    tokenCount: batch.summary.tokenCount,
    claimIntegrity: claimIntegrity(records),
    humanReadability: "NOT_SCORED",
  };
}

export function comparePromptAb(a: T001B2EvaluatedBatch, b: T001B2EvaluatedBatch): PromptAbComparison {
  const armA = summarizePromptAbArm(a);
  const armB = summarizePromptAbArm(b);
  if (armA.arm !== "A" || armB.arm !== "B") throw new Error("PROMPT_AB_ARM_ORDER_REQUIRED");
  if (armA.slotCount !== armB.slotCount || armA.slotCount !== 21) throw new Error("PROMPT_AB_SLOT_COUNT_MISMATCH");
  if (a.experiment?.timeoutMs !== 15_000 || b.experiment?.timeoutMs !== 15_000) throw new Error("PROMPT_AB_TIMEOUT_MISMATCH");
  if (a.versionMatrix.inputSetSha256 !== b.versionMatrix.inputSetSha256) throw new Error("PROMPT_AB_INPUT_SET_MISMATCH");
  const delta = {
    b2SuccessRate: Number((armB.b2SuccessRate - armA.b2SuccessRate).toFixed(4)),
    firstAttemptContractSuccessRate: Number((armB.firstAttemptContractSuccessRate - armA.firstAttemptContractSuccessRate).toFixed(4)),
    timeoutSlotRate: Number((armB.timeoutSlotRate - armA.timeoutSlotRate).toFixed(4)),
    repairTriggerRate: Number((armB.repairTriggerRate - armA.repairTriggerRate).toFixed(4)),
    repairSuccessRate: Number((armB.repairSuccessRate - armA.repairSuccessRate).toFixed(4)),
    b0FallbackRate: Number((armB.b0FallbackRate - armA.b0FallbackRate).toFixed(4)),
    providerCallCount: armB.providerCallCount - armA.providerCallCount,
    tokenCount: armB.tokenCount - armA.tokenCount,
  };
  return {
    schemaVersion: "t001-prompt-ab-comparison-v0.1",
    experimentId: "T001-PROMPT-AB-v0.1",
    status: "READY_FOR_HUMAN_REVIEW",
    conditions: { sameInputSet: true, sameModel: true, timeoutMs: 15_000, repetitionsPerCase: 3 },
    arms: { A: armA, B: armB },
    delta,
    humanReview: { status: "NOT_SCORED", packageRequired: true, reviewersRequired: 2 },
  };
}
