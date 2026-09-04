import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ServerEnvironment } from "../src/ai/coze-workflow-client.ts";
import {
  RideInterpretationCozeClientV04Candidate,
  readRideInterpretationCozeConfigV04Candidate,
} from "../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { runRideInterpretationV04Candidate } from "../src/ai/ride-interpretation-service-v04-candidate.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const ROOT = process.cwd();
const PLAN_PATH = join(
  ROOT,
  "eval",
  "ride-interpretation-v0.4-candidate",
  process.env.AEVAL_FORMAL_PLAN_FILE?.trim() || "formal-stability-plan-v0.3.json",
);
const RUNS_PATH = join(ROOT, "eval", "runs");
const NOT_OBSERVABLE = "NOT_OBSERVABLE";
const PREFLIGHT = process.argv.includes("--preflight");
const RUNTIME_ASSET_PATHS = new Set([
  "src/ai/ride-interpretation-output-v04-candidate.ts",
  "src/ai/ride-interpretation-service-v04-candidate.ts",
]);

type FormalPlan = {
  schemaVersion: string;
  benchmark: string;
  status: "FROZEN";
  versionMatrix: { workflowName: string; workflowId: string; workflowVersion: string; modelId: string; promptVersion: string; inputContractVersion: string; outputContractVersion: string };
  profile: { age: number; maxHeartRateBpm: number; weightKg: number; ftpWatts: number; effectiveAt: string };
  repetitionsPerCase: number;
  expectedSlots: number;
  planVersion: string;
  slotTimeoutMs: number;
  runtimeAssets?: Array<{ path: string; sha256: string }>;
  cases: Array<{ caseId: string; fixtureId: string; tier: "L1" | "L2" | "L3"; scenario: string; inputSha256: string }>;
};

type Result = {
  slot: string;
  caseId: string;
  fixtureId: string;
  tier: "L1" | "L2" | "L3";
  repetition: number;
  outcome: "success" | "failure";
  source: "candidate" | "b0";
  attempts: 1 | 2;
  repairTriggered: boolean;
  noThirdAttempt: boolean;
  b0Fallback: boolean;
  fallbackCode?: string;
  latencyMs: number;
  providerRequestIds: string[];
  providerDiagnostics?: Array<{ code: string; httpStatus?: number; businessCode?: number; responseJson?: boolean; responseBytes?: number }>;
  validation: { valid: boolean; issues: string[] };
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
}

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2] ?? "";
    values[match[1]] = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw;
  }
  return values;
}

function newRunId(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AEVAL-RUN-${date}-${String((Date.now() % 900) + 100).padStart(3, "0")}`;
}

async function loadPlan(): Promise<FormalPlan> {
  const plan = JSON.parse(await readFile(PLAN_PATH, "utf8")) as FormalPlan;
  if (plan.schemaVersion !== "ride-interpretation-formal-stability-plan-v0.1" || !/^v0\.\d+$/.test(plan.planVersion) || plan.benchmark !== "AEVAL-M1-RIDE-INTERPRETATION-V04-FORMAL" || plan.status !== "FROZEN") throw new Error("FORMAL_PLAN_INVALID");
  if (plan.cases.length * plan.repetitionsPerCase !== plan.expectedSlots || plan.expectedSlots !== 81) throw new Error("FORMAL_PLAN_SLOT_COUNT_INVALID");
  return plan;
}

async function verifyRuntimeAssets(plan: FormalPlan): Promise<void> {
  for (const asset of plan.runtimeAssets ?? []) {
    if (!RUNTIME_ASSET_PATHS.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error("FORMAL_RUNTIME_ASSET_INVALID");
    }
    const actual = sha256(await readFile(join(ROOT, asset.path), "utf8"));
    if (actual !== asset.sha256) throw new Error(`FORMAL_RUNTIME_ASSET_SHA256_MISMATCH:${asset.path}`);
  }
}

function inputFor(plan: FormalPlan, fixtureId: string) {
  const fixture = getRideFixture(fixtureId);
  const profile = createUserProfile({
    age: plan.profile.age,
    maxHeartRateBpm: plan.profile.maxHeartRateBpm,
    weightKg: plan.profile.weightKg,
    ftpWatts: plan.profile.ftpWatts,
  }, plan.profile.effectiveAt);
  const context = buildRideAnalysisContext({ activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) }, { profile });
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  if (!input) throw new Error(`FORMAL_INPUT_UNAVAILABLE:${fixtureId}`);
  return input;
}

async function main(): Promise<void> {
  const plan = await loadPlan();
  for (const item of plan.cases) {
    if (sha256(JSON.stringify(inputFor(plan, item.fixtureId))) !== item.inputSha256) {
      throw new Error(`FORMAL_INPUT_SHA256_MISMATCH:${item.caseId}`);
    }
  }
  await verifyRuntimeAssets(plan);
  if (PREFLIGHT) {
    console.log(`Formal interpretation plan preflight passed: ${plan.cases.length} cases x ${plan.repetitionsPerCase} = ${plan.expectedSlots} slots, no model calls.`);
    return;
  }
  const environment = {
    ...loadEnvLocal(),
    COZE_INTERPRETATION_WORKFLOW_NAME: process.env.COZE_INTERPRETATION_WORKFLOW_NAME ?? plan.versionMatrix.workflowName,
    COZE_INTERPRETATION_WORKFLOW_ID: process.env.COZE_INTERPRETATION_WORKFLOW_ID ?? plan.versionMatrix.workflowId,
    COZE_INTERPRETATION_WORKFLOW_VERSION: process.env.COZE_INTERPRETATION_WORKFLOW_VERSION ?? plan.versionMatrix.workflowVersion,
    COZE_INTERPRETATION_MODEL_ID: process.env.COZE_INTERPRETATION_MODEL_ID ?? plan.versionMatrix.modelId,
  };
  const config = readRideInterpretationCozeConfigV04Candidate(environment);
  if (!config) throw new Error("COZE_INTERPRETATION_ENV_INCOMPLETE");
  if (config.workflowName !== plan.versionMatrix.workflowName || config.workflowId !== plan.versionMatrix.workflowId || config.workflowVersion !== plan.versionMatrix.workflowVersion) throw new Error("FORMAL_WORKFLOW_MISMATCH");

  const runId = process.env.AEVAL_INTERPRETATION_RUN_ID?.trim() || newRunId();
  if (!/^AEVAL-RUN-\d{8}-\d{3}$/.test(runId)) throw new Error("FORMAL_RUN_ID_INVALID");
  const artifact = join(RUNS_PATH, `${runId}.json`);
  const existing = existsSync(artifact)
    ? JSON.parse(readFileSync(artifact, "utf8")) as { results?: Result[]; stopped?: { reason: string } | null }
    : undefined;
  const results = existing?.results ?? [];
  let artifactExists = Boolean(existing);
  if (existing?.stopped) throw new Error("FORMAL_RUN_ALREADY_STOPPED");
  const completed = new Set(results.map((result) => result.slot));
  const slots = plan.cases.flatMap((item) => Array.from({ length: plan.repetitionsPerCase }, (_, index) => ({ ...item, repetition: index + 1, slot: `${item.caseId}:R${index + 1}` })));
  const client = new RideInterpretationCozeClientV04Candidate(config);
  const persist = async (status: "running" | "complete"): Promise<void> => {
    const latencies = results.map((result) => result.latencyMs);
    const accepted = results.filter((result) => result.outcome === "success");
    await mkdir(RUNS_PATH, { recursive: true });
    await writeFile(artifact, `${JSON.stringify({
      schemaVersion: "ride-interpretation-formal-run-v0.1",
      benchmark: plan.benchmark,
      runId,
      planSha256: sha256(await readFile(PLAN_PATH, "utf8")),
      workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion, modelId: config.modelId },
      versionMatrix: plan.versionMatrix,
      rawOutputsStored: false,
      candidateInputsStored: false,
      tokenUsageStored: false,
      status,
      stopped: null,
      overallPassed: results.length === plan.expectedSlots && accepted.length === plan.expectedSlots,
      authorization: { expectedSlots: plan.expectedSlots, executedSlots: results.length, scope: "9 frozen de-identified candidate inputs x 9 independent repetitions" },
      summary: {
        acceptedCount: accepted.length,
        failedCount: results.length - accepted.length,
        firstPassCount: accepted.filter((result) => result.attempts === 1).length,
        repairedPassCount: accepted.filter((result) => result.attempts === 2).length,
        b0Count: results.filter((result) => result.b0Fallback).length,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
      },
      results,
    }, null, 2)}\n`, { encoding: "utf8", flag: artifactExists ? "w" : "wx" });
    artifactExists = true;
  };

  await persist("running");
  for (const slot of slots) {
    if (completed.has(slot.slot)) continue;
    const input = inputFor(plan, slot.fixtureId);
    if (sha256(JSON.stringify(input)) !== slot.inputSha256) throw new Error(`FORMAL_INPUT_SHA256_MISMATCH:${slot.caseId}`);
    const runtime = await runRideInterpretationV04Candidate(input, client, `${runId}:${slot.slot}`, plan.slotTimeoutMs);
    const result: Result = {
      slot: slot.slot,
      caseId: slot.caseId,
      fixtureId: slot.fixtureId,
      tier: slot.tier,
      repetition: slot.repetition,
      outcome: runtime.source === "candidate" ? "success" : "failure",
      source: runtime.source,
      attempts: runtime.attempts,
      repairTriggered: runtime.attempts === 2,
      noThirdAttempt: runtime.attempts <= 2,
      b0Fallback: runtime.source === "b0",
      ...(runtime.source === "b0" ? { fallbackCode: runtime.fallbackCode } : {}),
      latencyMs: runtime.latencyMs,
      providerRequestIds: runtime.providerRequestIds.length > 0 ? runtime.providerRequestIds : [NOT_OBSERVABLE],
      ...(runtime.providerDiagnostics ? { providerDiagnostics: runtime.providerDiagnostics } : {}),
      validation: { valid: runtime.source === "candidate", issues: runtime.validationIssues },
    };
    results.push(result);
    const p95 = percentile(results.map((item) => item.latencyMs), 0.95);
    await persist("running");
    console.log(JSON.stringify({ slot: slot.slot, outcome: result.outcome, attempts: result.attempts, latencyMs: result.latencyMs, p95Ms: p95, b0: result.b0Fallback, fallbackCode: result.fallbackCode ?? null }));
  }
  await persist("complete");
  const finalP95 = percentile(results.map((item) => item.latencyMs), 0.95);
  const overallPassed = results.length === plan.expectedSlots && results.every((result) => result.outcome === "success");
  console.log(JSON.stringify({ runId, artifact, executedSlots: results.length, expectedSlots: plan.expectedSlots, overallPassed, p95Ms: finalP95 }, null, 2));
  if (!overallPassed) process.exitCode = 1;
}

await main();
