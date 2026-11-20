import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ServerEnvironment } from "../src/ai/coze-workflow-error.ts";
import {
  RideInterpretationCozeClientV04Candidate,
  readRideInterpretationCozeConfigV04Candidate,
} from "../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { runRideInterpretationV04Candidate } from "../src/ai/ride-interpretation-service-v04-candidate.ts";
import { runTargetedDiagnosticRepetitions, type TargetedDiagnosticProgress } from "../src/ai/ride-interpretation-targeted-diagnostic.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const ROOT = process.cwd();
const PLAN_FILE = process.env.AEVAL_FORMAL_PLAN_FILE?.trim() || "formal-stability-plan-v0.4.json";
const PLAN_PATH = join(ROOT, "eval", "ride-interpretation-v0.4-candidate", PLAN_FILE);
const RUNS_PATH = join(ROOT, "eval", "runs");
const PREFLIGHT = process.argv.includes("--preflight");
const TARGET_CASE_ID = process.env.AEVAL_TARGETED_CASE_ID?.trim() || "F04";
const ORIGINAL_FORMAL_RUN_ID = "AEVAL-RUN-20260903-117";

type FormalPlan = {
  schemaVersion: string;
  benchmark: string;
  status: "FROZEN";
  versionMatrix: {
    workflowName: string;
    workflowId: string;
    workflowVersion: string;
    modelId: string;
    promptVersion: string;
    inputContractVersion: string;
    outputContractVersion: string;
  };
  profile: { age: number; maxHeartRateBpm: number; weightKg: number; ftpWatts: number; effectiveAt: string };
  repetitionsPerCase: number;
  planVersion: string;
  slotTimeoutMs: number;
  cases: Array<{
    caseId: string;
    fixtureId: string;
    tier: "L1" | "L2" | "L3";
    scenario: string;
    inputSha256: string;
  }>;
};

type TargetedResult = {
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
  providerDiagnostics?: Array<{
    code: string;
    httpStatus?: number;
    businessCode?: number;
    responseJson?: boolean;
    responseBytes?: number;
  }>;
  validation: { valid: boolean; issues: string[] };
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2] ?? "";
    values[match[1]] = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;
  }
  return values;
}

function newRunId(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AEVAL-TARGET-${date}-${String((Date.now() % 900) + 100).padStart(3, "0")}`;
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
  if (!input) throw new Error(`TARGETED_INPUT_UNAVAILABLE:${fixtureId}`);
  return input;
}

function positiveRepetitions(plan: FormalPlan): number {
  const requested = Number(process.env.AEVAL_TARGETED_REPETITIONS ?? plan.repetitionsPerCase);
  if (!Number.isInteger(requested) || requested < 1 || requested > plan.repetitionsPerCase) {
    throw new Error(`TARGETED_REPETITIONS_INVALID:max=${plan.repetitionsPerCase}`);
  }
  return requested;
}

async function main(): Promise<void> {
  const plan = JSON.parse(await readFile(PLAN_PATH, "utf8")) as FormalPlan;
  if (plan.schemaVersion !== "ride-interpretation-formal-stability-plan-v0.1" || plan.status !== "FROZEN" || plan.benchmark !== "AEVAL-M1-RIDE-INTERPRETATION-V04-FORMAL") {
    throw new Error("FORMAL_PLAN_INVALID");
  }
  const target = plan.cases.find((item) => item.caseId === TARGET_CASE_ID);
  if (!target) throw new Error(`TARGETED_CASE_NOT_FOUND:${TARGET_CASE_ID}`);
  const input = inputFor(plan, target.fixtureId);
  const inputHash = sha256(JSON.stringify(input));
  if (inputHash !== target.inputSha256) throw new Error(`FORMAL_INPUT_SHA256_MISMATCH:${target.caseId}`);
  const repetitions = positiveRepetitions(plan);
  if (PREFLIGHT) {
    console.log(JSON.stringify({ caseId: target.caseId, fixtureId: target.fixtureId, repetitions, inputSha256: inputHash, workflow: plan.versionMatrix, noModelCalls: true }, null, 2));
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
  if (config.workflowName !== plan.versionMatrix.workflowName || config.workflowId !== plan.versionMatrix.workflowId || config.workflowVersion !== plan.versionMatrix.workflowVersion) {
    throw new Error("TARGETED_WORKFLOW_MISMATCH");
  }

  const runId = process.env.AEVAL_TARGETED_RUN_ID?.trim() || newRunId();
  if (!/^AEVAL-TARGET-\d{8}-\d{3}$/.test(runId)) throw new Error("TARGETED_RUN_ID_INVALID");
  const artifact = join(RUNS_PATH, `${runId}.json`);
  if (existsSync(artifact)) throw new Error("TARGETED_RUN_ALREADY_EXISTS");
  const client = new RideInterpretationCozeClientV04Candidate(config);
  let artifactExists = false;
  const persist = async (progress: TargetedDiagnosticProgress<TargetedResult>): Promise<void> => {
    const { status, results: persistedResults, stop } = progress;
    const accepted = persistedResults.filter((result) => result.outcome === "success");
    const issueCounts = persistedResults.flatMap((result) => result.validation.issues).reduce<Record<string, number>>((counts, issue) => {
      counts[issue] = (counts[issue] ?? 0) + 1;
      return counts;
    }, {});
    await mkdir(RUNS_PATH, { recursive: true });
    await writeFile(artifact, `${JSON.stringify({
      schemaVersion: "ride-interpretation-targeted-diagnostic-run-v0.1",
      benchmark: plan.benchmark,
      runId,
      originalFormalRunId: ORIGINAL_FORMAL_RUN_ID,
      targetCaseId: target.caseId,
      targetFixtureId: target.fixtureId,
      planFile: PLAN_FILE,
      planSha256: sha256((await readFile(PLAN_PATH, "utf8")).toString()),
      inputSha256: inputHash,
      workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion, modelId: config.modelId },
      versionMatrix: plan.versionMatrix,
      rawOutputsStored: false,
      candidateInputsStored: false,
      tokenUsageStored: false,
      status,
      authorization: { repetitions, scope: `${target.caseId} frozen de-identified candidate input`, diagnosticOnly: true },
      summary: {
        executedSlots: persistedResults.length,
        acceptedCount: accepted.length,
        failedCount: persistedResults.length - accepted.length,
        firstPassCount: accepted.filter((result) => result.attempts === 1).length,
        repairedPassCount: accepted.filter((result) => result.attempts === 2).length,
        b0Count: persistedResults.filter((result) => result.b0Fallback).length,
        noThirdAttempt: persistedResults.every((result) => result.noThirdAttempt),
        issueCounts,
      },
      ...(stop ? { stop } : {}),
      results: persistedResults,
    }, null, 2)}\n`, { encoding: "utf8", flag: artifactExists ? "w" : "wx" });
    artifactExists = true;
  };

  const completed = await runTargetedDiagnosticRepetitions({
    repetitions,
    persist,
    runSlot: async (repetition): Promise<TargetedResult> => {
    const slot = `${target.caseId}:R${repetition}`;
    const runtime = await runRideInterpretationV04Candidate(input, client, `${runId}:${slot}`, plan.slotTimeoutMs);
    const result: TargetedResult = {
      slot,
      caseId: target.caseId,
      fixtureId: target.fixtureId,
      tier: target.tier,
      repetition,
      outcome: runtime.source === "candidate" ? "success" : "failure",
      source: runtime.source,
      attempts: runtime.attempts,
      repairTriggered: runtime.attempts === 2,
      noThirdAttempt: runtime.attempts <= 2,
      b0Fallback: runtime.source === "b0",
      ...(runtime.source === "b0" ? { fallbackCode: runtime.fallbackCode } : {}),
      latencyMs: runtime.latencyMs,
      providerRequestIds: runtime.providerRequestIds.length > 0 ? runtime.providerRequestIds : ["NOT_OBSERVABLE"],
      ...(runtime.providerDiagnostics ? { providerDiagnostics: runtime.providerDiagnostics } : {}),
      validation: { valid: runtime.source === "candidate", issues: runtime.validationIssues },
    };
    console.log(JSON.stringify({ slot, outcome: result.outcome, attempts: result.attempts, b0: result.b0Fallback, fallbackCode: result.fallbackCode ?? null, latencyMs: result.latencyMs, issues: result.validation.issues }));
    return result;
    },
  });
  console.log(JSON.stringify({ runId, artifact, targetCaseId: target.caseId, executedSlots: completed.results.length, acceptedCount: completed.results.filter((result) => result.outcome === "success").length, overallPassed: completed.results.length === repetitions && completed.results.every((result) => result.outcome === "success"), stop: completed.stop ?? null }, null, 2));
}

await main();
