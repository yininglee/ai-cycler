import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CozeWorkflowClient,
  CozeWorkflowError,
  readCozeWorkflowConfig,
  type RideAnalysisInvocation,
  type ServerEnvironment,
} from "../src/ai/coze-workflow-client.ts";
import { validateRideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import type { AnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import type { RideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import type { FewShotSelection } from "../src/ai/ride-analysis-few-shot.ts";

const ROOT = process.cwd();
const PROMPT_VERSION = "3.1.6";
const OUTPUT_CONTRACT_VERSION = "ride-analysis-output-v0.3.2";
const CONTEXT_LABEL_PATTERN = /周末|工作日|节假日|今天|今日|昨天|昨日|明天|晨骑|早骑|午骑|夜骑|夜间骑行|清晨骑行|城市|郊区|山路|公路|环线|隧道|高楼|树丛/g;
const INPUTS = [
  ["L1", "output/coze-inputs/l1-built-in-sample.json", false],
  ["L2", "output/coze-inputs/l2-built-in-sample.json", false],
  ["L3", "output/coze-inputs/l3-built-in-sample.json", false],
  ["L3-repair", "output/coze-inputs/l3-built-in-sample-repair-v3.1.6.json", true],
] as const;

function contextLabelTerms(value: unknown): string[] {
  const text = JSON.stringify(value);
  return [...new Set(text.match(CONTEXT_LABEL_PATTERN) ?? [])];
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

function parseInput(file: string): {
  analysisContext: RideAnalysisContext;
  eligibility: AnalysisEligibility;
  fewShotSelection: FewShotSelection;
  repairInstruction?: string;
  previousOutput?: string;
} {
  const value = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as Record<string, string>;
  return {
    analysisContext: JSON.parse(value.analysis_context) as RideAnalysisContext,
    eligibility: JSON.parse(value.analysis_elig) as AnalysisEligibility,
    fewShotSelection: JSON.parse(value.few_shot_json) as FewShotSelection,
    ...(value.repair_instruction ? { repairInstruction: value.repair_instruction } : {}),
    ...(value.previous_output ? { previousOutput: value.previous_output } : {}),
  };
}

function errorCode(error: unknown): string {
  return error instanceof CozeWorkflowError ? error.code : "UNEXPECTED_ERROR";
}

const environment = loadEnvLocal();
const config = readCozeWorkflowConfig(environment);
if (!config) throw new Error("COZE_ENV_INCOMPLETE");
const client = new CozeWorkflowClient(config);
const runId = `SMOKE-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
const results: Array<Record<string, unknown>> = [];

for (const [label, file, isRepair] of INPUTS) {
  const parsed = parseInput(file);
  const requestId = `${runId}:${label}`;
  const invocation: RideAnalysisInvocation = {
    requestId,
    analysisContext: parsed.analysisContext,
    eligibility: parsed.eligibility,
    fewShotSelection: parsed.fewShotSelection,
    ...(parsed.repairInstruction ? { repairInstruction: parsed.repairInstruction } : {}),
    ...(parsed.previousOutput ? { previousOutput: parsed.previousOutput } : {}),
  };
  const started = performance.now();
  try {
    const response = await client.run(invocation);
    const latencyMs = Math.max(1, Number((performance.now() - started).toFixed(3)));
    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(response.rawText);
    } catch {
      parsedOutput = undefined;
    }
    const validation = validateRideAnalysisOutputV03(parsedOutput, parsed.analysisContext, parsed.eligibility);
    results.push({
      label,
      inputFile: file,
      workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion },
      promptVersion: PROMPT_VERSION,
      outputContractVersion: OUTPUT_CONTRACT_VERSION,
      requestId,
      providerRequestId: response.providerRequestId ?? "NOT_OBSERVABLE",
      outcome: "success",
      latencyMs,
      tokenUsage: response.telemetry?.usage ?? "NOT_OBSERVABLE",
      repairTriggered: isRepair,
      b0Fallback: "not_exercised_direct_provider_call",
      validation: {
        schema: validation.valid,
        claims: validation.valid,
        numbers: validation.valid,
        safety: validation.valid,
        valid: validation.valid,
        issues: validation.issues,
        qualityWarnings: validation.qualityWarnings ?? [],
        ...(validation.issues.includes("UNSUPPORTED_CONTEXT_LABEL")
          ? { diagnostic: { contextLabelTerms: contextLabelTerms(parsedOutput) } }
          : {}),
      },
    });
  } catch (error) {
    results.push({
      label,
      inputFile: file,
      workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion },
      promptVersion: PROMPT_VERSION,
      outputContractVersion: OUTPUT_CONTRACT_VERSION,
      requestId,
      providerRequestId: "NOT_OBSERVABLE",
      outcome: "failure",
      latencyMs: Math.max(1, Number((performance.now() - started).toFixed(3))),
      tokenUsage: "NOT_OBSERVABLE",
      repairTriggered: isRepair,
      b0Fallback: "not_exercised_direct_provider_call",
      validation: { schema: false, claims: false, numbers: false, safety: false, valid: false, issues: [errorCode(error)] },
    });
  }
}

const artifact = join(ROOT, "eval", "runs", `${runId}.json`);
await writeFile(artifact, `${JSON.stringify({
  schemaVersion: "coze-smoke-run-v0.1",
  runId,
  workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion },
  promptVersion: PROMPT_VERSION,
  outputContractVersion: OUTPUT_CONTRACT_VERSION,
  scope: "restricted_smoke_only",
  rawOutputsStored: false,
  results,
}, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ runId, artifact, workflowVersion: config.workflowVersion, results }, null, 2));
