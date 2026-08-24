import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import {
  RIDE_ANALYSIS_PROMPT_VERSION,
  RIDE_ANALYSIS_SERVICE_VERSION,
  RIDE_ANALYSIS_WORKFLOW_VERSION,
  prepareRideAnalysis,
} from "../src/ai/ride-analysis-service.ts";
import {
  ANALYSIS_ELIGIBILITY_RULES_VERSION,
  ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
  validateAnalysisEligibility,
} from "../src/domain/analysis-eligibility.ts";
import {
  RIDE_ANALYSIS_CONTEXT_RULES_VERSION,
  RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
  validateRideAnalysisContext,
} from "../src/domain/ride-analysis-context.ts";
import { RIDE_FEATURE_RULES_VERSION } from "../src/domain/ride-features.ts";
import {
  B0_TEMPLATE_VERSION,
  generateB0RideAnalysis,
  validateB0RideAnalysis,
} from "../src/domain/ride-summary.ts";
import {
  T001_B2_B0_RUN_ID,
  T001_B2_FROZEN_INPUT_SET_SHA256,
  calculateCurrentT001InputSetSha256,
} from "../src/eval/t001-b2-benchmark.ts";
import {
  getT001AutomaticRideAnalysisCase,
  t001AutomaticRideAnalysisCaseIds,
} from "../src/fixtures/ride-analysis-t001.ts";

interface MigrationManifest {
  cases: Array<{
    targetCaseId: string;
    expectedDimensionKeys: string[];
    status: string;
  }>;
}

const runId = T001_B2_B0_RUN_ID;
const startedAt = new Date().toISOString();
const inputSetSha256 = calculateCurrentT001InputSetSha256();
if (inputSetSha256 !== T001_B2_FROZEN_INPUT_SET_SHA256) {
  throw new Error(`Frozen T001 input set mismatch: ${inputSetSha256}`);
}
const manifest = JSON.parse(await readFile("eval/ride-analysis-cases-v0.3-migration.json", "utf8")) as MigrationManifest;
const manifestByCase = new Map(manifest.cases.map((item) => [item.targetCaseId, item]));

const results = t001AutomaticRideAnalysisCaseIds.map((caseId) => {
  const item = getT001AutomaticRideAnalysisCase(caseId);
  const manifestCase = manifestByCase.get(caseId);
  if (!manifestCase) throw new Error(`Missing migration manifest entry: ${caseId}`);

  const started = performance.now();
  const prepared = prepareRideAnalysis(item.record, `coze-t001:${caseId}`, item.contextOptions);
  const contextValidation = validateRideAnalysisContext(prepared.context);
  const eligibilityValidation = validateAnalysisEligibility(prepared.eligibility);
  const b0 = generateB0RideAnalysis(item.record.activity, `eval-t001:${caseId}`);
  const b0Validation = validateB0RideAnalysis(b0);
  const latencyMs = performance.now() - started;
  const actualDimensionKeys = prepared.eligibility.allowedDimensionKeys;
  const expectedFocusAvailable = manifestCase.expectedDimensionKeys.every((key) => actualDimensionKeys.includes(key as typeof actualDimensionKeys[number]));

  return {
    caseId,
    fixtureId: item.fixtureId,
    expectedDimensionKeys: manifestCase.expectedDimensionKeys,
    actualDimensionKeys,
    expectedFocusAvailable,
    context: {
      schemaVersion: prepared.context.schemaVersion,
      rulesVersion: prepared.context.rulesVersion,
      rideId: prepared.context.rideId,
      allowedClaimIds: prepared.context.allowedClaims.map((claim) => claim.claimId),
      forbiddenClaims: prepared.context.forbiddenClaims,
      limitations: prepared.context.limitations,
      profileFacts: prepared.context.profileFacts,
      historicalComparisonStatus: prepared.context.historicalComparison?.comparability.status ?? null,
    },
    eligibility: prepared.eligibility,
    validation: {
      context: contextValidation,
      eligibility: eligibilityValidation,
      b0: b0Validation,
    },
    b0,
    latencyMs: Number(latencyMs.toFixed(3)),
  };
});

const latencies = results.map((item) => item.latencyMs).sort((a, b) => a - b);
const percentile = (ratio: number): number => {
  const index = Math.max(0, Math.ceil(latencies.length * ratio) - 1);
  return latencies[index] ?? 0;
};
const contextValidCount = results.filter((item) => item.validation.context.valid).length;
const eligibilityValidCount = results.filter((item) => item.validation.eligibility.valid).length;
const b0ValidCount = results.filter((item) => item.validation.b0.valid).length;
const expectedFocusAvailableCount = results.filter((item) => item.expectedFocusAvailable).length;
const failures = results.flatMap((item) => {
  const issues = [
    ...item.validation.context.issues.map((issue) => `CONTEXT:${issue.code}`),
    ...item.validation.eligibility.issues.map((issue) => `ELIGIBILITY:${issue}`),
    ...item.validation.b0.issues.map((issue) => `B0:${issue}`),
    ...(item.expectedFocusAvailable ? [] : ["MIGRATION_EXPECTED_DIMENSION_UNAVAILABLE"]),
  ];
  return issues.length > 0 ? [{ caseId: item.caseId, issues }] : [];
});

const report = {
  runId,
  benchmark: "T001",
  plan: "B0",
  status: failures.length === 0 ? "PASS" : "FAIL",
  startedAt,
  completedAt: new Date().toISOString(),
  versionMatrix: {
    appVersion: "visual-shell-v0.1",
    outputSchemaVersion: "ride-analysis-output-v0.3",
    contextSchemaVersion: RIDE_ANALYSIS_CONTEXT_SCHEMA_VERSION,
    contextRulesVersion: RIDE_ANALYSIS_CONTEXT_RULES_VERSION,
    eligibilitySchemaVersion: ANALYSIS_ELIGIBILITY_SCHEMA_VERSION,
    eligibilityRulesVersion: ANALYSIS_ELIGIBILITY_RULES_VERSION,
    featureRulesVersion: RIDE_FEATURE_RULES_VERSION,
    promptVersion: RIDE_ANALYSIS_PROMPT_VERSION,
    serviceVersion: RIDE_ANALYSIS_SERVICE_VERSION,
    workflowVersion: RIDE_ANALYSIS_WORKFLOW_VERSION,
    modelId: "not_applicable_b0",
    fewShotMode: "disabled",
    b0TemplateVersion: B0_TEMPLATE_VERSION,
    inputSetSha256,
  },
  dataset: {
    migrationManifest: "eval/ride-analysis-cases-v0.3-migration.json",
    caseCount: results.length,
    repetitionsPerCase: 1,
    caseIds: [...t001AutomaticRideAnalysisCaseIds],
    inputSetSha256,
  },
  summary: {
    contextContractValid: `${contextValidCount}/${results.length}`,
    eligibilityContractValid: `${eligibilityValidCount}/${results.length}`,
    b0OutputContractValid: `${b0ValidCount}/${results.length}`,
    expectedFocusDimensionsAvailable: `${expectedFocusAvailableCount}/${results.length}`,
    modelCalls: 0,
    tokenCount: 0,
    costCny: 0,
    latencyMs: {
      p50: Number(percentile(0.5).toFixed(3)),
      p95: Number(percentile(0.95).toFixed(3)),
    },
  },
  contractNote: "B0 output is the legacy deterministic RideContextSnapshot v1.0 / RideAnalysisOutput path. It is a deterministic baseline and fallback, not a ride-analysis-output-v0.3 model result.",
  failures,
  results,
};

await mkdir("eval/runs", { recursive: true });
await writeFile(`eval/runs/${runId}.json`, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({
  runId,
  status: report.status,
  caseCount: results.length,
  summary: report.summary,
  failures,
  artifact: `eval/runs/${runId}.json`,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
