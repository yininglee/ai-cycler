import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import {
  prepareRideAnalysis,
} from "../src/ai/ride-analysis-service.ts";
import {
  validateAnalysisEligibility,
} from "../src/domain/analysis-eligibility.ts";
import { validateRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { generateB0RideAnalysis, validateB0RideAnalysis } from "../src/domain/ride-summary.ts";
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

const runId = "RUN-20260823-022";
const startedAt = new Date().toISOString();
const manifest = JSON.parse(await readFile("eval/ride-analysis-cases-v0.3-migration.json", "utf8")) as MigrationManifest;
const manifestByCase = new Map(manifest.cases.map((item) => [item.targetCaseId, item]));

const results = t001AutomaticRideAnalysisCaseIds.map((caseId) => {
  const item = getT001AutomaticRideAnalysisCase(caseId);
  const manifestCase = manifestByCase.get(caseId);
  if (!manifestCase) throw new Error(`Missing migration manifest entry: ${caseId}`);

  const started = performance.now();
  const prepared = prepareRideAnalysis(item.record, `eval-t001:${caseId}`, item.contextOptions);
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
    contextSchemaVersion: "RideAnalysisContext v0.2",
    contextRulesVersion: "ride-analysis-context-rules-v0.2",
    eligibilitySchemaVersion: "AnalysisEligibility v0.1",
    eligibilityRulesVersion: "analysis-eligibility-rules-v0.1",
    promptVersion: "3.1.2",
    serviceVersion: "ride-analysis-service-v1.4",
    workflowVersion: "ride_analysis_v2-dev.15",
    modelId: "not_applicable_b0",
    fewShotMode: "disabled",
    b0TemplateVersion: "b0-template-v0.1",
  },
  dataset: {
    migrationManifest: "eval/ride-analysis-cases-v0.3-migration.json",
    caseCount: results.length,
    repetitionsPerCase: 1,
    caseIds: [...t001AutomaticRideAnalysisCaseIds],
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
await writeFile(`eval/runs/${runId}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  runId,
  status: report.status,
  caseCount: results.length,
  summary: report.summary,
  failures,
  artifact: `eval/runs/${runId}.json`,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
