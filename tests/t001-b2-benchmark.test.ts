import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import type { AnalysisDimensionKey } from "../src/domain/analysis-eligibility.ts";
import {
  T001_B2_RAW_BATCH_SCHEMA_VERSION,
  evaluateT001B2Batch,
  evaluateT001B2Record,
  expectedT001B2SlotIds,
  validateT001B2BatchMetadata,
  type T001B2RawBatch,
  type T001B2RawRecord,
} from "../src/eval/t001-b2-benchmark.ts";
import {
  getT001AutomaticRideAnalysisCase,
  t001AutomaticRideAnalysisCaseIds,
} from "../src/fixtures/ride-analysis-t001.ts";

interface BenchmarkManifest {
  schemaVersion: string;
  dataset: { caseIds: string[]; repetitionsPerCase: number; expectedSlotCount: number; b0RunId: string };
  fixedVersionMatrix: Record<string, unknown>;
}

const manifest = JSON.parse(readFileSync(new URL("../eval/t001-b2-benchmark-manifest.json", import.meta.url), "utf8")) as BenchmarkManifest;

const dimensionLabels: Record<AnalysisDimensionKey, { topic: string; headline: string }> = {
  endurance: { topic: "耐力", headline: "本次骑行耐力表现可关注" },
  pace: { topic: "速度", headline: "本次骑行速度变化可关注" },
  climbing: { topic: "爬升", headline: "本次骑行爬升表现可关注" },
  heartRate: { topic: "心率", headline: "本次骑行心率变化可关注" },
  power: { topic: "功率", headline: "本次骑行功率表现可关注" },
  cadence: { topic: "踏频", headline: "本次骑行踏频变化可关注" },
  history: { topic: "历史表现", headline: "本次骑行历史表现可关注" },
};

function claimForDimension(caseId: typeof t001AutomaticRideAnalysisCaseIds[number], dimension: AnalysisDimensionKey): string {
  const item = getT001AutomaticRideAnalysisCase(caseId);
  const prepared = prepareRideAnalysis(item.record, `test-t001:${caseId}`, item.contextOptions);
  const prefixes: Record<AnalysisDimensionKey, string[]> = {
    endurance: ["distance", "movingTime", "elapsedTime"],
    pace: ["speed", "avgSpeed", "maxSpeed"],
    climbing: ["elevation"],
    heartRate: ["heartRate", "avgHeartRate", "maxHeartRate"],
    power: ["power", "avgPower", "maxPower", "normalizedPower"],
    cadence: ["cadence", "avgCadence", "maxCadence"],
    history: [],
  };
  const claim = prepared.context.allowedClaims.find((itemClaim) => prefixes[dimension].some((prefix) => itemClaim.key.startsWith(prefix)))
    ?? prepared.context.allowedClaims.find((itemClaim) => itemClaim.kind === "history");
  if (!claim) throw new Error(`${caseId} has no claim for ${dimension}`);
  return claim.claimId;
}

function validOutput(caseId: typeof t001AutomaticRideAnalysisCaseIds[number]): string {
  const item = getT001AutomaticRideAnalysisCase(caseId);
  const prepared = prepareRideAnalysis(item.record, `test-t001:${caseId}`, item.contextOptions);
  const dimension = prepared.eligibility.allowedDimensionKeys[0];
  if (!dimension) throw new Error(`${caseId} is not model eligible`);
  const claimId = claimForDimension(caseId, dimension);
  const label = dimensionLabels[dimension];
  return JSON.stringify({
    schemaVersion: "ride-analysis-output-v0.3",
    headline: label.headline,
    overallAssessment: { text: `本次骑行的${label.topic}数据可用于回顾本次表现。`, claimIds: [claimId] },
    dimensions: [{ key: dimension, text: `本次骑行有可追溯的${label.topic}记录。`, claimIds: [claimId], confidence: "high" }],
    notableEvents: [],
    nextAction: { kind: "general", text: "骑行后注意补充水分", basisClaimIds: [] },
    limitations: [],
    safetyLevel: "normal",
    shareCopy: ["完成本次骑行记录", "记录一次骑行过程", "保存本次骑行回顾"],
  });
}

function rawRecord(caseId: typeof t001AutomaticRideAnalysisCaseIds[number], repetition: 1 | 2 | 3): T001B2RawRecord {
  const item = getT001AutomaticRideAnalysisCase(caseId);
  const eligible = prepareRideAnalysis(item.record, `test-t001:${caseId}`, item.contextOptions).eligibility.eligible;
  return {
    caseId,
    repetition,
    requestId: `t001-b2-${caseId}-${repetition}`,
    startedAt: "2026-08-24T08:00:00.000Z",
    completedAt: "2026-08-24T08:00:00.010Z",
    totalLatencyMs: 10,
    tokenUsage: eligible
      ? { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    costCny: eligible ? 0.001 : 0,
    attempts: eligible
      ? [{ attempt: 1, outcome: "response", providerRequestId: `provider-${caseId}-${repetition}`, latencyMs: 5, rawText: validOutput(caseId) }]
      : [],
  };
}

function completeBatch(): T001B2RawBatch {
  return {
    schemaVersion: T001_B2_RAW_BATCH_SCHEMA_VERSION,
    batchId: "RUN-20260824-001",
    plan: "B2",
    versionMatrix: {
      appVersion: "visual-shell-v0.1",
      outputSchemaVersion: "ride-analysis-output-v0.3",
      contextSchemaVersion: "0.2",
      contextRulesVersion: "ride-analysis-context-rules-v0.2",
      eligibilitySchemaVersion: "0.1",
      eligibilityRulesVersion: "analysis-eligibility-rules-v0.1",
      promptVersion: "3.1.2",
      serviceVersion: "ride-analysis-service-v1.4",
      workflowVersion: "ride_analysis_v2-dev.15",
      fewShotMode: "disabled",
      b0TemplateVersion: "b0-template-v0.1",
      modelId: "coze-test-model-exact-id",
      region: "cn-test",
      modelParameters: { mode: "provider_default_recorded" },
    },
    records: t001AutomaticRideAnalysisCaseIds.flatMap((caseId) => [1, 2, 3].map((repetition) => rawRecord(caseId, repetition as 1 | 2 | 3))),
  };
}

test("T001 B2 manifest freezes 18 cases and 54 unique run slots", () => {
  assert.equal(manifest.schemaVersion, "t001-b2-benchmark-manifest-v0.1");
  assert.deepEqual(manifest.dataset.caseIds, t001AutomaticRideAnalysisCaseIds);
  assert.equal(manifest.dataset.repetitionsPerCase, 3);
  assert.equal(manifest.dataset.expectedSlotCount, 54);
  assert.equal(manifest.dataset.b0RunId, "RUN-20260823-022");
  assert.equal(expectedT001B2SlotIds().length, 54);
  assert.equal(new Set(expectedT001B2SlotIds()).size, 54);
});

test("T001 B2 metadata gate rejects unrecorded model identity and incomplete or duplicate slots", () => {
  const batch = completeBatch();
  batch.versionMatrix.modelId = "unrecorded";
  batch.records[1] = structuredClone(batch.records[0]!);
  const issues = validateT001B2BatchMetadata(batch);
  assert.ok(issues.includes("MODEL_ID_NOT_RECORDED"));
  assert.ok(issues.some((issue) => issue.endsWith(":DUPLICATE_SLOT")));
  assert.ok(issues.some((issue) => issue.endsWith(":MISSING_SLOT")));
});

test("T001 B2 metadata gate reports malformed nested input without throwing", () => {
  const malformed = completeBatch() as unknown as Record<string, unknown>;
  malformed.versionMatrix = { modelId: 42 };
  malformed.records = [null, "invalid-record"];
  assert.doesNotThrow(() => validateT001B2BatchMetadata(malformed as unknown as T001B2RawBatch));
  const issues = validateT001B2BatchMetadata(malformed as unknown as T001B2RawBatch);
  assert.ok(issues.includes("MODEL_ID_NOT_RECORDED"));
  assert.ok(issues.includes("MODEL_REGION_NOT_RECORDED"));
  assert.ok(issues.includes("MODEL_PARAMETERS_NOT_RECORDED"));
  assert.ok(issues.includes("INVALID_RECORD:0"));
  assert.ok(issues.includes("INVALID_RECORD:1"));
});

test("T001 B2 metadata gate rejects model cost on service-ineligible records", () => {
  const batch = completeBatch();
  const ineligible = batch.records.find((record) => record.caseId === "RA-AUTO-018");
  assert.ok(ineligible);
  ineligible.costCny = 0.001;
  const issues = validateT001B2BatchMetadata(batch);
  assert.ok(issues.includes("RA-AUTO-018#1:INELIGIBLE_WITH_MODEL_COST"));
});

test("T001 B2 importer replays all 54 slots through the service contract", async () => {
  const result = await evaluateT001B2Batch(completeBatch());
  assert.equal(result.validationStatus, "PASS", JSON.stringify(result.issues));
  assert.equal(result.benchmarkStatus, "NOT_SCORED");
  assert.equal(result.summary.slotCount, 54);
  assert.equal(result.summary.b2SuccessCount, 51);
  assert.equal(result.summary.b0FallbackCount, 3);
  assert.equal(result.summary.modelCallCount, 51);
  assert.equal(result.summary.firstAttemptContractValidCount, 51);
  assert.equal(result.summary.repairedSuccessCount, 0);
  assert.equal(result.records.filter((record) => record.caseId === "RA-AUTO-018").every((record) => record.runtimeResult.source === "b0"), true);
});

test("T001 B2 importer preserves one constrained repair and second-failure B0 degradation", async () => {
  const repairedRecord = rawRecord("RA-AUTO-001", 1);
  repairedRecord.attempts = [
    { attempt: 1, outcome: "response", providerRequestId: "repair-first", latencyMs: 4, rawText: "not-json" },
    { attempt: 2, outcome: "response", providerRequestId: "repair-second", latencyMs: 4, rawText: validOutput("RA-AUTO-001") },
  ];
  const repaired = await evaluateT001B2Record(repairedRecord, "coze-test-model-exact-id");
  assert.equal(repaired.runtimeResult.source, "b2");
  assert.equal(repaired.runtimeResult.attempts, 2);
  assert.equal(repaired.firstAttemptContractValid, false);

  const degradedRecord = structuredClone(repairedRecord);
  degradedRecord.attempts[1]!.rawText = "still-not-json";
  const degraded = await evaluateT001B2Record(degradedRecord, "coze-test-model-exact-id");
  assert.equal(degraded.runtimeResult.source, "b0");
  assert.equal(degraded.runtimeResult.fallbackCode, "REPAIR_FAILED");
  assert.equal(degraded.runtimeResult.attempts, 2);
});
