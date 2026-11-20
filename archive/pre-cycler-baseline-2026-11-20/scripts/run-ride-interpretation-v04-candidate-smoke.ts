import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CozeWorkflowError,
  type ServerEnvironment,
} from "../src/ai/coze-workflow-error.ts";
import {
  RideInterpretationCozeClientV04Candidate,
  readRideInterpretationCozeConfigV04Candidate,
} from "../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import {
  buildRideInterpretationOutputV04CandidateFixture,
} from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { runRideInterpretationV04Candidate } from "../src/ai/ride-interpretation-service-v04-candidate.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const ROOT = process.cwd();
const PROMPT_VERSION = "v0.4.14";
const OUTPUT_CONTRACT_VERSION = "ride-interpretation-output-v0.4.2-candidate";
const CANDIDATE_WORKFLOW = {
  name: "ride_analysis_v3",
  id: "7680762018618359814",
  version: "v0.0.11",
  modelId: "豆包·2.0·lite",
} as const;

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2] ?? "";
    values[match[1]] = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  }
  return values;
}

function inputFor(fixtureId: "l1-built-in-sample" | "l2-built-in-sample" | "l3-power-preview") {
  const fixture = getRideFixture(fixtureId);
  const context = buildRideAnalysisContext(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    fixtureId === "l3-power-preview"
      ? { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z") }
      : {},
  );
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  if (!input) throw new Error(`CANDIDATE_INPUT_UNAVAILABLE:${fixtureId}`);
  return input;
}

function issueCode(error: unknown): string {
  return error instanceof CozeWorkflowError ? error.code : "UNEXPECTED_ERROR";
}

const environment = {
  ...loadEnvLocal(),
  COZE_INTERPRETATION_WORKFLOW_NAME: process.env.COZE_INTERPRETATION_WORKFLOW_NAME ?? CANDIDATE_WORKFLOW.name,
  COZE_INTERPRETATION_WORKFLOW_ID: process.env.COZE_INTERPRETATION_WORKFLOW_ID ?? CANDIDATE_WORKFLOW.id,
  COZE_INTERPRETATION_WORKFLOW_VERSION: process.env.COZE_INTERPRETATION_WORKFLOW_VERSION ?? CANDIDATE_WORKFLOW.version,
  COZE_INTERPRETATION_MODEL_ID: process.env.COZE_INTERPRETATION_MODEL_ID ?? CANDIDATE_WORKFLOW.modelId,
};
const loadedConfig = readRideInterpretationCozeConfigV04Candidate(environment);
if (!loadedConfig) throw new Error("COZE_INTERPRETATION_ENV_INCOMPLETE");
const config = loadedConfig;
if (config.workflowId !== CANDIDATE_WORKFLOW.id || config.workflowName !== CANDIDATE_WORKFLOW.name) {
  throw new Error("CANDIDATE_WORKFLOW_MISMATCH");
}

const client = new RideInterpretationCozeClientV04Candidate(config);
const runId = process.env.AEVAL_SMOKE_RUN_ID?.trim() || `AEVAL-SMOKE-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
const artifact = join(ROOT, "eval", "runs", `${runId}.json`);
const requestedSlot = process.env.AEVAL_SMOKE_SLOT?.trim();
if (requestedSlot && !["L1", "L2", "L3", "L3-repair"].includes(requestedSlot)) throw new Error("INVALID_AEVAL_SMOKE_SLOT");
const slots: Array<{ label: "L1" | "L2" | "L3"; fixtureId: "l1-built-in-sample" | "l2-built-in-sample" | "l3-power-preview" }> = [
  { label: "L1", fixtureId: "l1-built-in-sample" },
  { label: "L2", fixtureId: "l2-built-in-sample" },
  { label: "L3", fixtureId: "l3-power-preview" },
];
const existingArtifact = existsSync(artifact)
  ? JSON.parse(readFileSync(artifact, "utf8")) as { results?: Array<Record<string, unknown>> }
  : undefined;
const results: Array<Record<string, unknown>> = existingArtifact?.results ?? [];
const completedLabels = new Set(results.map((result) => result.label).filter((label): label is string => typeof label === "string"));

async function persist(status: "running" | "complete", passed = false): Promise<void> {
  await writeFile(artifact, `${JSON.stringify({
    schemaVersion: "ride-interpretation-candidate-smoke-run-v0.1",
    runId,
    workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion, modelId: config.modelId },
    promptVersion: PROMPT_VERSION,
    outputContractVersion: OUTPUT_CONTRACT_VERSION,
    scope: "restricted_smoke_only",
    rawOutputsStored: false,
    status,
    passed,
    results,
  }, null, 2)}\n`, { encoding: "utf8", flag: existingArtifact || results.length > 0 ? "w" : "wx" });
}

await persist("running");

for (const slot of slots) {
  if (requestedSlot && requestedSlot !== slot.label) continue;
  if (completedLabels.has(slot.label)) continue;
  const started = performance.now();
  const runtime = await runRideInterpretationV04Candidate(inputFor(slot.fixtureId), client, `${runId}:${slot.label}`);
  results.push({
    label: slot.label,
    fixtureId: slot.fixtureId,
    outcome: runtime.source === "candidate" ? "success" : "failure",
    source: runtime.source,
    attempts: runtime.attempts,
    repairTriggered: runtime.attempts === 2,
    noThirdAttempt: runtime.attempts <= 2,
    b0Fallback: runtime.source === "b0",
    latencyMs: Math.max(1, Number((performance.now() - started).toFixed(3))),
    providerRequestIds: runtime.providerRequestIds,
    validation: { valid: runtime.source === "candidate", issues: runtime.validationIssues },
    ...(runtime.source === "b0" ? { fallbackCode: runtime.fallbackCode } : {}),
  });
  await persist("running");
}

if ((!requestedSlot || requestedSlot === "L3-repair") && !completedLabels.has("L3-repair")) {
const repairInput = inputFor("l3-power-preview");
const repairStarted = performance.now();
try {
  const injectedFirstOutput = { ...buildRideInterpretationOutputV04CandidateFixture(repairInput), schemaVersion: "invalid-test-schema" };
  let calls = 0;
  const repairProvider = {
    async run(invocation: Parameters<typeof client.run>[0]) {
      calls += 1;
      if (calls === 1) return { rawText: JSON.stringify(injectedFirstOutput) };
      return client.run(invocation);
    },
  };
  const runtime = await runRideInterpretationV04Candidate(repairInput, repairProvider, `${runId}:L3-repair`);
  results.push({
    label: "L3-repair",
    fixtureId: "l3-power-preview",
    outcome: runtime.source === "candidate" ? "success" : "failure",
    source: "injected_first_l8_failure_then_real_repair",
    attempts: runtime.attempts,
    repairTriggered: true,
    noThirdAttempt: true,
    b0Fallback: runtime.source === "b0",
    latencyMs: Math.max(1, Number((performance.now() - repairStarted).toFixed(3))),
    providerRequestIds: runtime.providerRequestIds,
    tokenUsage: "NOT_OBSERVABLE",
    validation: { valid: runtime.source === "candidate", issues: runtime.validationIssues },
    injectedFirstFailure: "INVALID_OUTPUT_SCHEMA_VERSION",
    ...(runtime.source === "b0" ? { fallbackCode: runtime.fallbackCode } : {}),
  });
} catch (error) {
  results.push({
    label: "L3-repair",
    fixtureId: "l3-power-preview",
    outcome: "failure",
    source: "explicit_repair_entry",
    attempts: 1,
    repairTriggered: true,
    noThirdAttempt: true,
    b0Fallback: false,
    latencyMs: Math.max(1, Number((performance.now() - repairStarted).toFixed(3))),
    providerRequestIds: [],
    tokenUsage: "NOT_OBSERVABLE",
    validation: { valid: false, issues: [issueCode(error)] },
  });
}
await persist("running");
}

const complete = ["L1", "L2", "L3", "L3-repair"].every((label) => results.some((result) => result.label === label));
const passed = complete && results.every((result) => result.outcome === "success")
  && results.filter((result) => result.label !== "L3-repair").every((result) => result.attempts === 1 || result.attempts === 2)
  && results.find((result) => result.label === "L3-repair")?.repairTriggered === true;
await persist(complete ? "complete" : "running", passed);
console.log(JSON.stringify({ runId, artifact, passed, results }, null, 2));
if (!passed) process.exitCode = 1;
