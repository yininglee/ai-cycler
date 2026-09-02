import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CozeWorkflowClient,
  CozeWorkflowError,
  readCozeWorkflowConfig,
  type RideAnalysisInvocation,
  type ServerEnvironment,
} from "../src/ai/coze-workflow-client.ts";
import { disabledRideAnalysisFewShots } from "../src/ai/ride-analysis-few-shot.ts";
import { validateRideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import {
  ANALYSIS_ELIGIBILITY_RULES_VERSION,
  ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
  type AnalysisDimensionKey,
  type AnalysisEligibility,
} from "../src/domain/analysis-eligibility.ts";
import type { RideAnalysisContext } from "../src/domain/ride-analysis-context.ts";

const ROOT = process.cwd();
const DATASET = join(ROOT, "eval", "advanced-interpretation-v0.1");
const RUNS = join(ROOT, "eval", "runs");
const EXPECTED_MANIFEST_SHA256 = "65f75efd44c86e9a114cc60a2a4f2153eaf2a496a00978a2374df0e5e50a977a";
const EXPECTED_ANSWER_KEY_SHA256 = "b43496039f391e5021b37c1236fee219582b11435402c18ec346d862f5907aee";
const PROMPT_VERSION = "3.1.6";
const BENCHMARK = "AEVAL-M1-ADVANCED-INTERPRETATION";
const RAW_SCHEMA_VERSION = "advanced-interpretation-run-v0.1";
const NOT_OBSERVABLE = "NOT_OBSERVABLE";

type Split = "dev" | "regression" | "blind" | "red-team";
type Arm = "A" | "B";
type CaseFile = {
  schemaVersion: string;
  caseId: string;
  split: Split;
  modelInput: Record<string, unknown> & { allowedClaims: Claim[]; limitations: string[]; forbiddenClaims: string[]; safetyFlags: string[]; privacyFlags: string[] };
  analysisEligibility: Partial<AnalysisEligibility>;
};
type Claim = { claimId: string; kind: string; key: string; [key: string]: unknown };
type Manifest = {
  benchmark: string;
  versionMatrix: Record<string, string>;
  cases: Array<{ caseId: string; split: Split; file: string; sha256: string }>;
  blindAnswerKey: { file: string; sha256: string };
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  const text = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function nextRunId(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = String(Date.now() % 900 + 100).padStart(3, "0");
  return `AEVAL-RUN-${date}-${suffix}`;
}

function requestedOffset(): number {
  const value = process.argv.find((argument) => argument.startsWith("--offset="))?.slice("--offset=".length) ?? "0";
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("OFFSET_REQUIRED: use --offset=<non-negative integer>");
  return offset;
}

function dimensionForClaim(key: string): AnalysisDimensionKey | undefined {
  if (key.startsWith("speed") || key.startsWith("timing.") || key.startsWith("cruise.")) return "pace";
  if (key.startsWith("route.") || key.startsWith("elevation.") || key.startsWith("climb.")) return "climbing";
  if (key.startsWith("heartRate.")) return "heartRate";
  if (key.startsWith("power.")) return "power";
  if (key.startsWith("cadence.")) return "cadence";
  return undefined;
}

function buildEligibility(input: CaseFile["modelInput"], arm: Arm): AnalysisEligibility {
  const claims = input.allowedClaims;
  const dimensions = [...new Set(claims.flatMap((claim) => dimensionForClaim(claim.key) ?? []))];
  const sources = [...new Set(claims.flatMap((claim) => claim.kind === "feature" ? ["feature" as const] : claim.kind === "advanced" ? ["advanced" as const] : []))];
  return {
    schemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
    rulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
    eligible: true,
    status: "eligible",
    reasonCodes: ["FEATURES_AVAILABLE"],
    insightSources: sources.length > 0 ? sources : ["feature"],
    allowedDimensionKeys: dimensions.length > 0 ? dimensions : ["pace"],
    requiredClaimIds: claims.map((claim) => claim.claimId),
    fallback: "b0",
  } satisfies AnalysisEligibility;
}

function contextFor(input: CaseFile["modelInput"]): RideAnalysisContext {
  return input as unknown as RideAnalysisContext;
}

function caseInput(item: CaseFile, arm: Arm): { context: RideAnalysisContext; eligibility: AnalysisEligibility } {
  const modelInput = arm === "A"
    ? { ...item.modelInput, allowedClaims: item.modelInput.allowedClaims.filter((claim) => claim.kind !== "advanced") }
    : item.modelInput;
  return { context: contextFor(modelInput), eligibility: buildEligibility(modelInput, arm) };
}

function errorCode(error: unknown): string {
  return error instanceof CozeWorkflowError ? error.code : "UNEXPECTED_ERROR";
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? null;
}

async function loadDataset(): Promise<{ manifest: Manifest; cases: CaseFile[]; manifestSha256: string; answerKeySha256: string }> {
  const manifestText = await readFile(join(DATASET, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as Manifest;
  const manifestDigest = sha256(manifestText);
  if (manifestDigest !== EXPECTED_MANIFEST_SHA256) throw new Error(`MANIFEST_SHA256_MISMATCH:${manifestDigest}`);
  if (manifest.benchmark !== BENCHMARK || manifest.cases.length !== 15) throw new Error("MANIFEST_SCOPE_MISMATCH");
  const cases: CaseFile[] = [];
  for (const entry of manifest.cases) {
    const raw = await readFile(join(DATASET, entry.file), "utf8");
    if (sha256(raw) !== entry.sha256) throw new Error(`CASE_SHA256_MISMATCH:${entry.caseId}`);
    const item = JSON.parse(raw) as CaseFile;
    if (item.caseId !== entry.caseId || item.split !== entry.split) throw new Error(`CASE_IDENTITY_MISMATCH:${entry.caseId}`);
    if (!Array.isArray(item.modelInput.allowedClaims)) throw new Error(`CASE_CLAIMS_MISSING:${entry.caseId}`);
    cases.push(item);
  }
  const answerKey = await readFile(join(DATASET, manifest.blindAnswerKey.file), "utf8");
  const answerKeySha256 = sha256(answerKey);
  if (answerKeySha256 !== EXPECTED_ANSWER_KEY_SHA256 || answerKeySha256 !== manifest.blindAnswerKey.sha256) throw new Error(`ANSWER_KEY_SHA256_MISMATCH:${answerKeySha256}`);
  if (manifest.versionMatrix.promptVersion !== PROMPT_VERSION) throw new Error(`PROMPT_VERSION_MISMATCH:${manifest.versionMatrix.promptVersion}`);
  return { manifest, cases, manifestSha256: manifestDigest, answerKeySha256 };
}

async function main(): Promise<void> {
  const { manifest, cases, manifestSha256, answerKeySha256 } = await loadDataset();
  const environment = loadEnvLocal();
  const config = readCozeWorkflowConfig(environment);
  if (!config) throw new Error("COZE_ENV_INCOMPLETE");
  const runId = nextRunId();
  const client = new CozeWorkflowClient(config);
  const allSlots = cases.flatMap((item) => {
    const arms: Arm[] = item.split === "red-team" ? ["B"] : ["A", "B"];
    return arms.flatMap((arm) => [1, 2, 3].map((repetition) => ({ item, arm, repetition })));
  });
  const offset = requestedOffset();
  if (offset > allSlots.length) throw new Error(`OFFSET_OUT_OF_RANGE:${offset}`);
  const slots = allSlots.slice(offset);
  const results: Array<Record<string, unknown>> = [];
  const candidateLatencies: number[] = [];
  let candidateAttempts = 0;
  let stopped: { reason: string; afterCandidateAttempts: number } | undefined;

  for (const slot of slots) {
    const slotId = `${slot.item.caseId}:${slot.arm}:${slot.repetition}`;
    const requestId = `${runId}:${slotId}`;
    const { context, eligibility } = caseInput(slot.item, slot.arm);
    const invocation: RideAnalysisInvocation = {
      requestId,
      analysisContext: context,
      eligibility,
      fewShotSelection: disabledRideAnalysisFewShots(),
    };
    const started = performance.now();
    let result: Record<string, unknown>;
    try {
      const response = await client.run(invocation);
      const latencyMs = Math.max(1, Number((performance.now() - started).toFixed(3)));
      if (slot.arm === "B") {
        candidateAttempts += 1;
        candidateLatencies.push(latencyMs);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(response.rawText); } catch { parsed = undefined; }
      const validation = validateRideAnalysisOutputV03(parsed, context, eligibility);
      result = {
        caseId: slot.item.caseId,
        split: slot.item.split,
        arm: slot.arm,
        repetition: slot.repetition,
        requestId,
        providerRequestId: response.providerRequestId ?? NOT_OBSERVABLE,
        outcome: "success",
        latencyMs,
        tokenUsage: response.telemetry?.usage ?? NOT_OBSERVABLE,
        validation: { valid: validation.valid, issues: validation.issues, qualityWarnings: validation.qualityWarnings ?? [] },
        repairTriggered: false,
        b0Fallback: "none",
      };
    } catch (error) {
      const latencyMs = Math.max(1, Number((performance.now() - started).toFixed(3)));
      if (slot.arm === "B") {
        candidateAttempts += 1;
        candidateLatencies.push(latencyMs);
      }
      result = {
        caseId: slot.item.caseId,
        split: slot.item.split,
        arm: slot.arm,
        repetition: slot.repetition,
        requestId,
        providerRequestId: NOT_OBSERVABLE,
        outcome: "failure",
        errorCode: errorCode(error),
        latencyMs,
        tokenUsage: NOT_OBSERVABLE,
        validation: { valid: false, issues: [errorCode(error)] },
        repairTriggered: false,
        b0Fallback: "none",
      };
    }
    results.push(result);
    const candidateFailures = results.filter((entry) => entry.arm === "B" && entry.outcome !== "success").length;
    const candidateP95 = percentile(candidateLatencies, 0.95);
    if (offset === 0 && candidateAttempts >= 10 && !stopped) {
      const completionRate = (candidateAttempts - candidateFailures) / candidateAttempts;
      const fallbackCount = results.filter((entry) => entry.arm === "B" && entry.b0Fallback !== "none").length;
      if (completionRate < 0.8) stopped = { reason: "EARLY_STOP_COMPLETION_RATE_LT_80", afterCandidateAttempts: candidateAttempts };
      else if (fallbackCount / candidateAttempts > 0.2) stopped = { reason: "EARLY_STOP_B0_FALLBACK_GT_20", afterCandidateAttempts: candidateAttempts };
      else if (candidateP95 !== null && candidateP95 > 25_000) stopped = { reason: "EARLY_STOP_P95_GT_25S", afterCandidateAttempts: candidateAttempts };
    }
    console.log(JSON.stringify({ slot: slotId, outcome: result.outcome, latencyMs: result.latencyMs, candidateAttempts, candidateP95, stopped: stopped?.reason ?? null }));
    if (stopped) break;
  }

  const artifact = join(RUNS, `${runId}.json`);
  await mkdir(RUNS, { recursive: true });
  const summary = {
    schemaVersion: RAW_SCHEMA_VERSION,
    benchmark: BENCHMARK,
    runId,
    startedAt: results.length > 0 ? new Date(Date.now() - results.reduce((sum, item) => sum + Number(item.latencyMs ?? 0), 0)).toISOString() : new Date().toISOString(),
    completedAt: new Date().toISOString(),
    workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion },
    versionMatrix: manifest.versionMatrix,
    rawOutputsStored: false,
    answerKeyStored: false,
    manifestSha256,
    answerKeySha256,
    authorization: { expectedSlots: 81, offset, executedSlots: results.length, candidateAttempts, scope: "A/B x3 for 12 non-red-team; B x3 for 3 red-team" },
    stopConditions: { earlyCheckAfterCandidateAttempts: 10, completionRateMin: 0.8, b0FallbackMaxExclusive: 0.2, p95MaxMs: 25_000, triggered: stopped ?? null },
    summary: {
      successCount: results.filter((entry) => entry.outcome === "success").length,
      failureCount: results.filter((entry) => entry.outcome !== "success").length,
      validOutputCount: results.filter((entry) => (entry.validation as { valid?: boolean } | undefined)?.valid === true).length,
      p50Ms: percentile(results.map((entry) => Number(entry.latencyMs)), 0.5),
      p95Ms: percentile(results.map((entry) => Number(entry.latencyMs)), 0.95),
      candidateP95Ms: percentile(candidateLatencies, 0.95),
    },
    results,
  };
  await writeFile(artifact, `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ runId, artifact, executedSlots: results.length, expectedSlots: 81, stopped: stopped ?? null }, null, 2));
}

await main();
