import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CozeWorkflowError,
  type RideAnalysisInvocation,
  type RideAnalysisProvider,
  type RideAnalysisProviderResult,
} from "../ai/coze-workflow-client.ts";
import {
  RIDE_ANALYSIS_PROMPT_VERSION,
  RIDE_ANALYSIS_SERVICE_VERSION,
  RIDE_ANALYSIS_WORKFLOW_VERSION,
  prepareRideAnalysis,
  runRideAnalysis,
  type RideAnalysisRuntimeResult,
} from "../ai/ride-analysis-service.ts";
import { RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION } from "../ai/ride-analysis-output-v03.ts";
import {
  ANALYSIS_ELIGIBILITY_RULES_VERSION,
  ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
} from "../domain/analysis-eligibility.ts";
import {
  RIDE_ANALYSIS_CONTEXT_RULES_VERSION,
  RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
} from "../domain/ride-analysis-context.ts";
import { RIDE_FEATURE_RULES_VERSION } from "../domain/ride-features.ts";
import { B0_TEMPLATE_VERSION } from "../domain/ride-summary.ts";
import {
  getT001AutomaticRideAnalysisCase,
  t001AutomaticRideAnalysisCaseIds,
  type T001AutomaticRideAnalysisCaseId,
} from "../fixtures/ride-analysis-t001.ts";

export const T001_B2_RAW_BATCH_SCHEMA_VERSION = "t001-b2-raw-batch-v0.3" as const;
export const T001_B2_RESULT_SCHEMA_VERSION = "t001-b2-evaluated-run-v0.3" as const;
export const T001_B2_REPETITIONS = 3 as const;
export const T001_B2_B0_RUN_ID = "RUN-20260824-028" as const;
export const T001_B2_FROZEN_INPUT_SET_SHA256 = "5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671" as const;
export const T001_B2_RESTRICTED_CASE_IDS = [
  "RA-AUTO-001", "RA-AUTO-005", "RA-AUTO-006", "RA-AUTO-010",
  "RA-AUTO-011", "RA-AUTO-013", "RA-AUTO-018",
] as const satisfies readonly T001AutomaticRideAnalysisCaseId[];
export const NOT_OBSERVABLE = "NOT_OBSERVABLE" as const;
export type ObservableNumber = number | typeof NOT_OBSERVABLE;
export type ObservableString = string | typeof NOT_OBSERVABLE;

export type T001PromptAbArm = "A" | "B";

export interface T001PromptAbExperiment {
  experimentId: "T001-PROMPT-AB-v0.1";
  arm: T001PromptAbArm;
  promptAsset: "prompts/cycling-buddy-ride-analysis-v3.1.2.md"
    | "prompts/cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md";
  platformWorkflowVersion: string;
  baselineRunId?: "RUN-20260825-756";
  timeoutMs: 15_000;
  sameModel: true;
  sameInputSet: true;
}

export interface T001B2VersionMatrix {
  appVersion: "visual-shell-v0.1";
  outputSchemaVersion: typeof RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION;
  contextSchemaVersion: typeof RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION;
  contextRulesVersion: typeof RIDE_ANALYSIS_CONTEXT_RULES_VERSION;
  featureRulesVersion: typeof RIDE_FEATURE_RULES_VERSION;
  eligibilitySchemaVersion: typeof ANALYSIS_ELIGIBILITY_SCHEMA_VERSION;
  eligibilityRulesVersion: typeof ANALYSIS_ELIGIBILITY_RULES_VERSION;
  promptVersion: typeof RIDE_ANALYSIS_PROMPT_VERSION;
  serviceVersion: typeof RIDE_ANALYSIS_SERVICE_VERSION;
  workflowVersion: typeof RIDE_ANALYSIS_WORKFLOW_VERSION;
  fewShotMode: "disabled";
  b0TemplateVersion: typeof B0_TEMPLATE_VERSION;
  inputSetSha256: typeof T001_B2_FROZEN_INPUT_SET_SHA256;
  sourceCommit: string;
  modelId: ObservableString;
  region: ObservableString;
  modelParameters: Record<string, unknown>;
}

export interface T001B2Attempt {
  attempt: 1 | 2;
  outcome: "response" | "timeout" | "provider_error";
  providerRequestId: string;
  latencyMs: number;
  rawText?: string;
}

export interface T001B2RawRecord {
  caseId: T001AutomaticRideAnalysisCaseId;
  repetition: 1 | 2 | 3;
  requestId: string;
  startedAt: string;
  completedAt: string;
  totalLatencyMs: number;
  firstTokenLatencyMs: ObservableNumber;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costCny: ObservableNumber;
  costSource: ObservableString;
  attempts: T001B2Attempt[];
}

export interface T001B2ExecutionScope {
  kind: "full" | "restricted";
  caseIds: T001AutomaticRideAnalysisCaseId[];
  repetitionsPerCase: 1 | typeof T001_B2_REPETITIONS;
  expectedSlotCount: number;
}

export interface T001B2RawBatch {
  schemaVersion: typeof T001_B2_RAW_BATCH_SCHEMA_VERSION;
  batchId: string;
  plan: "B2";
  versionMatrix: T001B2VersionMatrix;
  experiment?: T001PromptAbExperiment;
  executionScope?: T001B2ExecutionScope;
  records: T001B2RawRecord[];
}

export interface T001B2EvaluatedRecord extends T001B2RawRecord {
  slotId: string;
  firstAttemptContractValid: boolean | null;
  runtimeResult: RideAnalysisRuntimeResult;
}

export interface T001B2EvaluatedBatch {
  schemaVersion: typeof T001_B2_RESULT_SCHEMA_VERSION;
  runId: string;
  benchmark: "T001";
  plan: "B2";
  validationStatus: "PASS" | "FAIL";
  benchmarkStatus: "NOT_SCORED";
  versionMatrix: T001B2VersionMatrix;
  experiment?: T001PromptAbExperiment;
  dataset: {
    caseCount: number;
  repetitionsPerCase: 1 | typeof T001_B2_REPETITIONS;
    expectedSlotCount: number;
    b0RunId: typeof T001_B2_B0_RUN_ID;
  };
  executionScope?: T001B2ExecutionScope;
  summary: {
    slotCount: number;
    firstAttemptContractValidCount: number;
    repairedSuccessCount: number;
    b2SuccessCount: number;
    b0FallbackCount: number;
    safetyStopCount: number;
    modelCallCount: number;
    tokenCount: number;
    costCny: ObservableNumber;
    latencyMs: { p50: number; p95: number };
  };
  issues: string[];
  records: T001B2EvaluatedRecord[];
}

const FIXED_VERSION_MATRIX = {
  appVersion: "visual-shell-v0.1",
  outputSchemaVersion: RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  contextSchemaVersion: RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
  contextRulesVersion: RIDE_ANALYSIS_CONTEXT_RULES_VERSION,
  featureRulesVersion: RIDE_FEATURE_RULES_VERSION,
  eligibilitySchemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
  eligibilityRulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
  promptVersion: RIDE_ANALYSIS_PROMPT_VERSION,
  serviceVersion: RIDE_ANALYSIS_SERVICE_VERSION,
  workflowVersion: RIDE_ANALYSIS_WORKFLOW_VERSION,
  fewShotMode: "disabled",
  b0TemplateVersion: B0_TEMPLATE_VERSION,
  inputSetSha256: T001_B2_FROZEN_INPUT_SET_SHA256,
} as const;

const CASE_IDS = new Set<string>(t001AutomaticRideAnalysisCaseIds);
const UNRECORDED_MODEL_IDS = new Set(["", "unrecorded", "not_recorded", "not-applicable", "not_applicable_b0"]);

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validDate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function slotId(record: Pick<T001B2RawRecord, "caseId" | "repetition">): string {
  return `${record.caseId}#${record.repetition}`;
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return Number((sorted[index] ?? 0).toFixed(3));
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function calculateCurrentT001InputSetSha256(rootDirectory = process.cwd()): string {
  const digest = createHash("sha256");
  for (const caseId of t001AutomaticRideAnalysisCaseIds) {
    const file = readFileSync(join(rootDirectory, "output", "coze-inputs", `t001-${caseId}.json`));
    digest.update(caseId);
    digest.update("\0");
    digest.update(file);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function validateVersionMatrix(value: unknown, issues: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push("INVALID_VERSION_MATRIX");
    return;
  }
  const matrix = value as Partial<T001B2VersionMatrix>;
  for (const [key, expected] of Object.entries(FIXED_VERSION_MATRIX)) {
    if (matrix[key as keyof T001B2VersionMatrix] !== expected) issues.push(`VERSION_MISMATCH:${key}`);
  }
  if (typeof matrix.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(matrix.sourceCommit)) {
    issues.push("SOURCE_COMMIT_NOT_RECORDED");
  }
  if (
    typeof matrix.modelId !== "string"
    || !matrix.modelId.trim()
    || (matrix.modelId !== NOT_OBSERVABLE && UNRECORDED_MODEL_IDS.has(matrix.modelId.trim().toLowerCase()))
  ) issues.push("MODEL_ID_NOT_RECORDED");
  if (
    typeof matrix.region !== "string"
    || !matrix.region.trim()
    || (matrix.region !== NOT_OBSERVABLE && matrix.region.trim().toLowerCase() === "unrecorded")
  ) issues.push("MODEL_REGION_NOT_RECORDED");
  if (
    !matrix.modelParameters
    || typeof matrix.modelParameters !== "object"
    || Array.isArray(matrix.modelParameters)
    || Object.keys(matrix.modelParameters).length === 0
  ) {
    issues.push("MODEL_PARAMETERS_NOT_RECORDED");
  }
}

function validateRecordMetadata(record: T001B2RawRecord, eligibility: boolean, issues: string[]): void {
  const prefix = slotId(record);
  if (!CASE_IDS.has(record.caseId)) issues.push(`${prefix}:UNKNOWN_CASE`);
  if (![1, 2, 3].includes(record.repetition)) issues.push(`${prefix}:INVALID_REPETITION`);
  if (typeof record.requestId !== "string" || !record.requestId.trim()) issues.push(`${prefix}:MISSING_REQUEST_ID`);
  const started = validDate(record.startedAt);
  const completed = validDate(record.completedAt);
  if (started === undefined || completed === undefined || completed < started) issues.push(`${prefix}:INVALID_TIMESTAMPS`);
  if (!positive(record.totalLatencyMs)) issues.push(`${prefix}:MISSING_TOTAL_LATENCY`);
  const costObservable = record.costCny === NOT_OBSERVABLE || finiteNonNegative(record.costCny);
  if (!costObservable) issues.push(`${prefix}:MISSING_COST`);
  else if (!eligibility && record.costCny !== 0) issues.push(`${prefix}:INELIGIBLE_WITH_MODEL_COST`);
  if (typeof record.costSource !== "string" || !record.costSource.trim()) issues.push(`${prefix}:MISSING_COST_SOURCE`);
  if (!eligibility && record.costSource !== "NOT_APPLICABLE") issues.push(`${prefix}:INELIGIBLE_WITH_COST_SOURCE`);
  const firstTokenObservable = record.firstTokenLatencyMs === NOT_OBSERVABLE
    || finiteNonNegative(record.firstTokenLatencyMs);
  if (!firstTokenObservable) issues.push(`${prefix}:MISSING_FIRST_TOKEN_LATENCY`);
  else if (!eligibility && record.firstTokenLatencyMs !== 0) issues.push(`${prefix}:INELIGIBLE_WITH_FIRST_TOKEN_LATENCY`);
  else if (eligibility && record.firstTokenLatencyMs !== NOT_OBSERVABLE && !positive(record.firstTokenLatencyMs)) {
    issues.push(`${prefix}:INVALID_FIRST_TOKEN_LATENCY`);
  }
  const tokenUsageValid = Boolean(
    record.tokenUsage
    && Number.isInteger(record.tokenUsage.inputTokens)
    && Number.isInteger(record.tokenUsage.outputTokens)
    && Number.isInteger(record.tokenUsage.totalTokens),
  );
  if (!tokenUsageValid) {
    issues.push(`${prefix}:MISSING_TOKEN_USAGE`);
  } else if (
    record.tokenUsage.inputTokens < 0
    || record.tokenUsage.outputTokens < 0
    || record.tokenUsage.totalTokens !== record.tokenUsage.inputTokens + record.tokenUsage.outputTokens
  ) {
    issues.push(`${prefix}:INVALID_TOKEN_USAGE`);
  }

  if (!Array.isArray(record.attempts) || record.attempts.length > 2) {
    issues.push(`${prefix}:INVALID_ATTEMPT_COUNT`);
    return;
  }
  if (eligibility && record.attempts.length === 0) issues.push(`${prefix}:ELIGIBLE_WITHOUT_MODEL_ATTEMPT`);
  if (!eligibility && record.attempts.length > 0) issues.push(`${prefix}:INELIGIBLE_WITH_MODEL_ATTEMPT`);
  const hasModelResponse = record.attempts.some(
    (attempt) => Boolean(attempt && typeof attempt === "object" && !Array.isArray(attempt) && attempt.outcome === "response"),
  );
  if (tokenUsageValid && hasModelResponse && record.tokenUsage.totalTokens <= 0) issues.push(`${prefix}:RESPONSE_WITHOUT_TOKEN_USAGE`);
  if (tokenUsageValid && !eligibility && record.tokenUsage.totalTokens !== 0) issues.push(`${prefix}:INELIGIBLE_WITH_TOKEN_USAGE`);

  let attemptLatency = 0;
  for (const [index, attempt] of record.attempts.entries()) {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
      issues.push(`${prefix}:INVALID_ATTEMPT:${index + 1}`);
      continue;
    }
    if (attempt.attempt !== index + 1) issues.push(`${prefix}:NON_SEQUENTIAL_ATTEMPT`);
    if (!["response", "timeout", "provider_error"].includes(attempt.outcome)) issues.push(`${prefix}:INVALID_ATTEMPT_OUTCOME`);
    if (typeof attempt.providerRequestId !== "string" || !attempt.providerRequestId.trim()) issues.push(`${prefix}:MISSING_PROVIDER_REQUEST_ID`);
    if (!positive(attempt.latencyMs)) issues.push(`${prefix}:MISSING_ATTEMPT_LATENCY`);
    else attemptLatency += attempt.latencyMs;
    if (attempt.outcome === "response" && !attempt.rawText?.trim()) issues.push(`${prefix}:MISSING_RAW_OUTPUT`);
    if (attempt.outcome !== "response" && attempt.rawText !== undefined) issues.push(`${prefix}:ERROR_ATTEMPT_HAS_RAW_OUTPUT`);
  }
  if (positive(record.totalLatencyMs) && attemptLatency > record.totalLatencyMs) issues.push(`${prefix}:ATTEMPT_LATENCY_EXCEEDS_TOTAL`);
}

class RecordedAttemptProvider implements RideAnalysisProvider {
  calls = 0;
  private readonly attempts: T001B2Attempt[];

  constructor(attempts: T001B2Attempt[]) {
    this.attempts = attempts;
  }

  async run(_input: RideAnalysisInvocation): Promise<RideAnalysisProviderResult> {
    const attempt = this.attempts[this.calls++];
    if (!attempt) throw new Error("Recorded provider was called more times than captured attempts");
    if (attempt.outcome === "timeout") throw new CozeWorkflowError("AI_TIMEOUT", "Recorded timeout");
    if (attempt.outcome === "provider_error") throw new CozeWorkflowError("PROVIDER_HTTP_ERROR", "Recorded provider error");
    return { rawText: attempt.rawText!, providerRequestId: attempt.providerRequestId };
  }
}

export function expectedT001B2SlotIds(
  caseIds: readonly T001AutomaticRideAnalysisCaseId[] = t001AutomaticRideAnalysisCaseIds,
  repetitionsPerCase: 1 | typeof T001_B2_REPETITIONS = T001_B2_REPETITIONS,
): string[] {
  return caseIds.flatMap((caseId) => Array.from({ length: repetitionsPerCase }, (_, index) => `${caseId}#${index + 1}`));
}

function executionScopeFor(batch: T001B2RawBatch): T001B2ExecutionScope {
  const scope = batch.executionScope;
  if (!scope) {
    return {
      kind: "full",
      caseIds: [...t001AutomaticRideAnalysisCaseIds],
      repetitionsPerCase: T001_B2_REPETITIONS,
      expectedSlotCount: expectedT001B2SlotIds().length,
    };
  }
  return scope;
}

function validateExecutionScope(batch: T001B2RawBatch, issues: string[]): T001B2ExecutionScope {
  const scope = executionScopeFor(batch);
  if (scope.kind !== "full" && scope.kind !== "restricted") issues.push("INVALID_EXECUTION_SCOPE_KIND");
  if (!Array.isArray(scope.caseIds) || scope.caseIds.length === 0) issues.push("INVALID_EXECUTION_SCOPE_CASES");
  const uniqueCaseIds = Array.isArray(scope.caseIds) ? [...new Set(scope.caseIds)] : [];
  if (uniqueCaseIds.length !== (Array.isArray(scope.caseIds) ? scope.caseIds.length : 0)) issues.push("DUPLICATE_EXECUTION_SCOPE_CASE");
  if (uniqueCaseIds.some((caseId) => !CASE_IDS.has(caseId))) issues.push("UNKNOWN_EXECUTION_SCOPE_CASE");
  if (scope.kind === "full" && uniqueCaseIds.length !== t001AutomaticRideAnalysisCaseIds.length) issues.push("FULL_SCOPE_CASE_COUNT_MISMATCH");
  if (scope.kind === "restricted" && uniqueCaseIds.length >= t001AutomaticRideAnalysisCaseIds.length) issues.push("RESTRICTED_SCOPE_NOT_RESTRICTED");
  const expectedRepetitions = scope.kind === "full" ? T001_B2_REPETITIONS : scope.repetitionsPerCase;
  if (expectedRepetitions !== 1 && expectedRepetitions !== T001_B2_REPETITIONS) issues.push("INVALID_EXECUTION_SCOPE_REPETITIONS");
  const expectedSlotCount = uniqueCaseIds.length * expectedRepetitions;
  if (scope.expectedSlotCount !== expectedSlotCount) issues.push("INVALID_EXECUTION_SCOPE_SLOT_COUNT");
  return {
    ...scope,
    caseIds: uniqueCaseIds as T001AutomaticRideAnalysisCaseId[],
    repetitionsPerCase: expectedRepetitions,
    expectedSlotCount,
  };
}

export function validateT001B2BatchMetadata(batch: T001B2RawBatch): string[] {
  const issues: string[] = [];
  if (batch.schemaVersion !== T001_B2_RAW_BATCH_SCHEMA_VERSION) issues.push("INVALID_BATCH_SCHEMA_VERSION");
  if (typeof batch.batchId !== "string" || !/^RUN-\d{8}-\d{3}$/.test(batch.batchId)) issues.push("INVALID_BATCH_ID");
  if (batch.plan !== "B2") issues.push("INVALID_BENCHMARK_PLAN");
  validateVersionMatrix(batch.versionMatrix, issues);
  const executionScope = validateExecutionScope(batch, issues);
  if (!Array.isArray(batch.records)) return [...issues, "INVALID_RECORDS"];

  const seenSlots = new Set<string>();
  const seenRequests = new Set<string>();
  for (const [index, value] of batch.records.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push(`INVALID_RECORD:${index}`);
      continue;
    }
    const record = value as T001B2RawRecord;
    const item = CASE_IDS.has(record.caseId) ? getT001AutomaticRideAnalysisCase(record.caseId) : undefined;
    const eligible = item ? prepareRideAnalysis(item.record, `eval-t001:${record.caseId}`, item.contextOptions).eligibility.eligible : false;
    validateRecordMetadata(record, eligible, issues);
    const slot = slotId(record);
    if (seenSlots.has(slot)) issues.push(`${slot}:DUPLICATE_SLOT`);
    seenSlots.add(slot);
    if (typeof record.requestId === "string") {
      if (seenRequests.has(record.requestId)) issues.push(`${slot}:DUPLICATE_REQUEST_ID`);
      seenRequests.add(record.requestId);
    }
  }
  for (const expected of expectedT001B2SlotIds(executionScope.caseIds, executionScope.repetitionsPerCase)) if (!seenSlots.has(expected)) issues.push(`${expected}:MISSING_SLOT`);
  if (batch.records.length !== executionScope.expectedSlotCount) issues.push(`INVALID_SLOT_COUNT:${batch.records.length}`);
  return [...new Set(issues)];
}

export async function evaluateT001B2Record(
  record: T001B2RawRecord,
  modelId: string,
): Promise<T001B2EvaluatedRecord> {
  const item = getT001AutomaticRideAnalysisCase(record.caseId);
  const prepared = prepareRideAnalysis(item.record, `eval-t001:${record.caseId}`, item.contextOptions);
  const provider = new RecordedAttemptProvider(record.attempts);
  const runtimeResult = await runRideAnalysis(prepared, {
    enabled: true,
    provider,
    modelId,
    requestId: record.requestId,
    fewShotEnabled: false,
  });
  if (provider.calls !== record.attempts.length) throw new Error(`${slotId(record)}:RECORDED_ATTEMPTS_NOT_CONSUMED`);
  const first = record.attempts[0];
  const firstAttemptContractValid = first?.outcome === "response"
    ? runtimeResult.attempts === 1 && runtimeResult.source === "b2"
    : first ? false : null;
  return { ...record, slotId: slotId(record), firstAttemptContractValid, runtimeResult };
}

export async function evaluateT001B2Batch(batch: T001B2RawBatch): Promise<T001B2EvaluatedBatch> {
  const issues = validateT001B2BatchMetadata(batch);
  const executionScope = executionScopeFor(batch);
  const records: T001B2EvaluatedRecord[] = [];
  if (issues.length === 0) {
    for (const record of batch.records) {
      try {
        records.push(await evaluateT001B2Record(record, batch.versionMatrix.modelId));
      } catch (error) {
        issues.push(error instanceof Error ? error.message : `${slotId(record)}:EVALUATION_FAILED`);
      }
    }
  }
  const b2SuccessCount = records.filter((record) => record.runtimeResult.source === "b2").length;
  const b0FallbackCount = records.filter((record) => record.runtimeResult.source === "b0").length;
  const safetyStopCount = records.filter((record) => record.runtimeResult.source === "safety_stop").length;
  const firstAttemptContractValidCount = records.filter((record) => record.firstAttemptContractValid).length;
  const repairedSuccessCount = records.filter((record) => record.runtimeResult.source === "b2" && record.runtimeResult.attempts === 2).length;
  return {
    schemaVersion: T001_B2_RESULT_SCHEMA_VERSION,
    runId: batch.batchId,
    benchmark: "T001",
    plan: "B2",
    validationStatus: issues.length === 0 ? "PASS" : "FAIL",
    benchmarkStatus: "NOT_SCORED",
    versionMatrix: batch.versionMatrix,
    ...(batch.experiment ? { experiment: batch.experiment } : {}),
    dataset: {
      caseCount: executionScope.caseIds.length,
      repetitionsPerCase: executionScope.repetitionsPerCase,
      expectedSlotCount: executionScope.expectedSlotCount,
      b0RunId: T001_B2_B0_RUN_ID,
    },
    ...(batch.executionScope ? { executionScope } : {}),
    summary: {
      slotCount: records.length,
      firstAttemptContractValidCount,
      repairedSuccessCount,
      b2SuccessCount,
      b0FallbackCount,
      safetyStopCount,
      modelCallCount: records.reduce((sum, record) => sum + record.attempts.length, 0),
      tokenCount: records.reduce((sum, record) => sum + record.tokenUsage.totalTokens, 0),
      costCny: records.some((record) => record.costCny === NOT_OBSERVABLE)
        ? NOT_OBSERVABLE
        : Number(records.reduce((sum, record) => sum + (record.costCny as number), 0).toFixed(6)),
      latencyMs: {
        p50: percentile(records.map((record) => record.totalLatencyMs), 0.5),
        p95: percentile(records.map((record) => record.totalLatencyMs), 0.95),
      },
    },
    issues: [...new Set(issues)],
    records,
  };
}

export function parseT001B2RawBatch(value: unknown): T001B2RawBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("B2 batch must be a JSON object");
  return value as T001B2RawBatch;
}

export function rawAttemptJson(attempt: T001B2Attempt): unknown {
  return attempt.outcome === "response" && attempt.rawText ? parseJson(attempt.rawText) : undefined;
}
