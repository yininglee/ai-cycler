import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CozeWorkflowClient,
  CozeWorkflowError,
  readCozeWorkflowConfig,
  type CozeWorkflowConfig,
  type RideAnalysisInvocation,
  type RideAnalysisProvider,
  type RideAnalysisProviderResult,
  type ServerEnvironment,
} from "../src/ai/coze-workflow-client.ts";
import {
  RIDE_ANALYSIS_PROMPT_VERSION,
  RIDE_ANALYSIS_SERVICE_VERSION,
  RIDE_ANALYSIS_WORKFLOW_VERSION,
  prepareRideAnalysis,
  runRideAnalysis,
} from "../src/ai/ride-analysis-service.ts";
import {
  ANALYSIS_ELIGIBILITY_RULES_VERSION,
  ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
} from "../src/domain/analysis-eligibility.ts";
import {
  RIDE_ANALYSIS_CONTEXT_RULES_VERSION,
  RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
} from "../src/domain/ride-analysis-context.ts";
import { RIDE_FEATURE_RULES_VERSION } from "../src/domain/ride-features.ts";
import { B0_TEMPLATE_VERSION } from "../src/domain/ride-summary.ts";
import {
  NOT_OBSERVABLE,
  T001_B2_FROZEN_INPUT_SET_SHA256,
  T001_B2_RAW_BATCH_SCHEMA_VERSION,
  type T001B2Attempt,
  type T001B2RawBatch,
  type T001B2RawRecord,
} from "../src/eval/t001-b2-benchmark.ts";
import {
  getT001AutomaticRideAnalysisCase,
  t001AutomaticRideAnalysisCaseIds,
  type T001AutomaticRideAnalysisCaseId,
} from "../src/fixtures/ride-analysis-t001.ts";

const WORKFLOW_NAME = "ride_analysis_v2";
const WORKFLOW_ID = "7676429753852018707";
const WORKFLOW_VERSION = "v0.0.2";
const ROOT = process.cwd();

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  const text = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function sha256(path: string, content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function currentCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function assertRuntimeFilesCommitted(): void {
  const changed = execFileSync(
    "git",
    ["status", "--porcelain", "--", "package.json", ".env.example", "src/ai/coze-workflow-client.ts", "scripts/run-t001-b2-coze-api.ts"],
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  if (changed) throw new Error(`RUNTIME_FILES_NOT_COMMITTED:${changed.replaceAll("\n", ";")}`);
}

function nextRunId(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `RUN-${date}-${String(Date.now() % 900 + 100).padStart(3, "0")}`;
}

function parseOutputForRecord(value: string): string {
  return value.trim();
}

interface CapturedAttempt extends T001B2Attempt {
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

class CapturingProvider implements RideAnalysisProvider {
  readonly attempts: CapturedAttempt[] = [];
  private readonly client: CozeWorkflowClient;

  constructor(client: CozeWorkflowClient) {
    this.client = client;
  }

  async run(input: RideAnalysisInvocation): Promise<RideAnalysisProviderResult> {
    const attempt = (this.attempts.length + 1) as 1 | 2;
    const started = performance.now();
    try {
      const result = await this.client.run(input);
      const latencyMs = Math.max(1, Number((performance.now() - started).toFixed(3)));
      this.attempts.push({
        attempt,
        outcome: "response",
        providerRequestId: result.providerRequestId ?? NOT_OBSERVABLE,
        latencyMs,
        rawText: parseOutputForRecord(result.rawText),
        ...(result.telemetry?.usage ? { usage: result.telemetry.usage } : {}),
      });
      return result;
    } catch (error) {
      const latencyMs = Math.max(1, Number((performance.now() - started).toFixed(3)));
      const code = error instanceof CozeWorkflowError && error.code === "AI_TIMEOUT" ? "timeout" : "provider_error";
      this.attempts.push({
        attempt,
        outcome: code,
        providerRequestId: NOT_OBSERVABLE,
        latencyMs,
      });
      throw error;
    }
  }
}

function usageFor(attempts: CapturedAttempt[]): { inputTokens: number; outputTokens: number; totalTokens: number } {
  return attempts.reduce(
    (sum, attempt) => ({
      inputTokens: sum.inputTokens + (attempt.usage?.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (attempt.usage?.outputTokens ?? 0),
      totalTokens: sum.totalTokens + (attempt.usage?.totalTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

function validateEnvironment(environment: ServerEnvironment): CozeWorkflowConfig {
  const config = readCozeWorkflowConfig(environment);
  if (!config) throw new Error("COZE_ENV_INCOMPLETE: .env.local must contain API URL, workflow name/id/version and PAT");
  if (config.workflowName !== WORKFLOW_NAME) throw new Error(`WORKFLOW_NAME_MISMATCH:${config.workflowName}`);
  if (config.workflowId !== WORKFLOW_ID) throw new Error(`WORKFLOW_ID_MISMATCH:${config.workflowId}`);
  if (config.workflowVersion !== WORKFLOW_VERSION) throw new Error(`WORKFLOW_VERSION_MISMATCH:${config.workflowVersion}`);
  if (!config.apiToken.startsWith("pat_")) throw new Error("COZE_API_TOKEN_FORMAT_INVALID");
  if (config.modelId !== NOT_OBSERVABLE) throw new Error("COZE_MODEL_ID_MUST_BE_NOT_OBSERVABLE");
  return config;
}

async function validateInputs(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(ROOT, "eval/t001-b2-benchmark-manifest.json"), "utf8")) as {
    inputSet: { files: Array<{ caseId: string; path: string; sha256: string }> };
  };
  const digest = createHash("sha256");
  for (const item of manifest.inputSet.files) {
    const content = await readFile(join(ROOT, item.path));
    const actual = sha256(item.path, content);
    if (actual !== item.sha256) throw new Error(`INPUT_SHA256_MISMATCH:${item.caseId}`);
    digest.update(item.caseId);
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
  }
  const aggregate = digest.digest("hex");
  if (aggregate !== T001_B2_FROZEN_INPUT_SET_SHA256) throw new Error(`INPUT_SET_SHA256_MISMATCH:${aggregate}`);
}

async function preflight(): Promise<void> {
  const environment = loadEnvLocal();
  const config = validateEnvironment(environment);
  await validateInputs();
  const commit = currentCommit();
  assertRuntimeFilesCommitted();
  console.log(JSON.stringify({
    preflight: "PASS",
    workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion },
    inputSetSha256: T001_B2_FROZEN_INPUT_SET_SHA256,
    sourceCommit: commit,
    apiToken: "PRESENT_REDACTED",
    timeoutMs: config.timeoutMs,
    modelId: NOT_OBSERVABLE,
    externalCalls: 0,
  }, null, 2));
}

async function runBatch(): Promise<void> {
  await preflight();
  const environment = loadEnvLocal();
  const config = validateEnvironment(environment);
  const batchId = nextRunId();
  const client = new CozeWorkflowClient(config);
  const records: T001B2RawRecord[] = [];
  for (const caseId of t001AutomaticRideAnalysisCaseIds) {
    const item = getT001AutomaticRideAnalysisCase(caseId);
    const prepared = prepareRideAnalysis(item.record, `eval-t001:${caseId}`, item.contextOptions);
    for (const repetition of [1, 2, 3] as const) {
      const requestId = `${batchId}:${caseId}:${repetition}:${randomUUID()}`;
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const provider = prepared.eligibility.eligible ? new CapturingProvider(client) : undefined;
      const runtime = await runRideAnalysis(prepared, {
        enabled: true,
        ...(provider ? { provider } : {}),
        modelId: NOT_OBSERVABLE,
        requestId,
        fewShotEnabled: false,
      });
      const totalLatencyMs = Math.max(1, Number((performance.now() - started).toFixed(3)));
      const captured = provider?.attempts ?? [];
      const usage = usageFor(captured);
      records.push({
        caseId: caseId as T001AutomaticRideAnalysisCaseId,
        repetition,
        requestId,
        startedAt,
        completedAt: new Date().toISOString(),
        totalLatencyMs,
        firstTokenLatencyMs: prepared.eligibility.eligible ? NOT_OBSERVABLE : 0,
        tokenUsage: usage,
        costCny: prepared.eligibility.eligible ? NOT_OBSERVABLE : 0,
        costSource: prepared.eligibility.eligible ? NOT_OBSERVABLE : "NOT_APPLICABLE",
        attempts: captured.map(({ usage: _usage, ...attempt }) => attempt),
      });
      console.log(JSON.stringify({ slot: `${caseId}#${repetition}`, source: runtime.source, attempts: captured.length, totalLatencyMs }));
    }
  }
  const batch: T001B2RawBatch = {
    schemaVersion: T001_B2_RAW_BATCH_SCHEMA_VERSION,
    batchId,
    plan: "B2",
    versionMatrix: {
      appVersion: "visual-shell-v0.1",
      outputSchemaVersion: "ride-analysis-output-v0.3",
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
      sourceCommit: currentCommit(),
      modelId: NOT_OBSERVABLE,
      region: NOT_OBSERVABLE,
      modelParameters: { workflowName: WORKFLOW_NAME, workflowVersion: WORKFLOW_VERSION, isAsync: false },
    },
    records,
  };
  const outputPath = join(ROOT, "eval", "runs", `${batchId}-raw.json`);
  await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ batchId, records: records.length, artifact: outputPath, benchmarkStatus: "NOT_SCORED" }, null, 2));
}

if (process.argv.includes("--preflight")) await preflight();
else await runBatch();
