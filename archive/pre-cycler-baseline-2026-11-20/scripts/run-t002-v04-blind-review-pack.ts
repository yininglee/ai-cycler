// T002-V04 blind review pack generator.
// Benchmark: AEVAL-M1-RIDE-INTERPRETATION-V04-BLIND-REVIEW
//
// Generates anonymized dual-reviewer packages for the v0.4 candidate chain:
//   - 9 frozen cases (F01-F09, formal-stability-plan-v0.16) x 1 real candidate
//     call each, outputs stored verbatim (requires user authorization);
//   - paired B0 deterministic fact-layer samples (no model calls);
//   - shuffled, de-identified reviewer A/B packages + scoring key + score sheets
//     + run record.
//
// Preflight (no model calls):
//   node scripts/run-t002-v04-blind-review-pack.ts --preflight
//
// Real run (only after explicit user authorization):
//   T002_V04_BLIND_REVIEW_CONFIRM=YES node scripts/run-t002-v04-blind-review-pack.ts
//
// Stop rule: any case ending in b0 or L8-invalid aborts the whole pack; no
// retries, no partial packs.

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
import type { RideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import type { RideInterpretationOutputV04Candidate } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import {
  PROVEN_SAFE_DIMENSION_FALLBACK_TEXT,
  PROVEN_SAFE_OVERALL_FALLBACK_TEXT,
  claimFactFallbackText,
  runRideInterpretationV04Candidate,
} from "../src/ai/ride-interpretation-service-v04-candidate.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const ROOT = process.cwd();
const PLAN_FILE = "formal-stability-plan-v0.16.json";
const PLAN_PATH = join(ROOT, "eval", "ride-interpretation-v0.4-candidate", PLAN_FILE);
const RUNS_PATH = join(ROOT, "eval", "runs");
const HUMAN_REVIEW_PATH = join(ROOT, "eval", "human-review");
const PREFLIGHT = process.argv.includes("--preflight");
const CONFIRMED = process.env.T002_V04_BLIND_REVIEW_CONFIRM === "YES";
const REVIEW_ID = "T002-V04";
const REVIEW_VERSION = "v0.1";
const REVIEWER_SEEDS = { A: 20260907, B: 955 } as const;
const SLOT_TIMEOUT_MS = 25_000;

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
  planVersion: string;
  slotTimeoutMs: number;
  runtimeAssets?: Array<{ path: string; sha256: string }>;
  cases: Array<{ caseId: string; fixtureId: string; tier: "L1" | "L2" | "L3"; scenario: string; inputSha256: string }>;
};

// Review-only presentation copies. DIMENSION_LABELS mirrors
// app/api/ride-analysis/route.ts and CLAIM_LABELS mirrors
// FACT_FALLBACK_CLAIM_LABELS in the frozen service module (SHA-frozen runtime
// assets must not be modified just to export these maps).
const DIMENSION_LABELS: Record<string, string> = {
  route_pacing: "沿途节奏",
  terrain_climb: "地形与爬坡",
  heart_rate: "心率负荷",
  power_output: "功率输出",
  cadence: "踩踏表现",
  pacing_stability: "节奏稳定性",
};

const CLAIM_LABELS: Record<string, string> = {
  distanceM: "距离",
  elapsedTimeS: "总时间",
  movingTimeS: "骑行时间",
  elevationGainM: "累计爬升",
  elevationLossM: "累计下降",
  avgSpeedMps: "平均速度",
  maxSpeedMps: "最高速度",
  avgHeartRateBpm: "平均心率",
  maxHeartRateBpm: "最高心率",
  avgPowerW: "平均功率",
  maxPowerW: "最大功率",
  normalizedPowerW: "标准化功率",
  avgCadenceRpm: "平均踏频",
  maxCadenceRpm: "最大踏频",
  activityEnergyKcal: "运动消耗",
  speedSeriesMeanMps: "速度序列均值",
  heartRateSeriesMeanBpm: "心率序列均值",
  powerSeriesMeanW: "功率序列均值",
  elevationPositiveGainM: "正向海拔增益",
  speedStdDevMps: "速度波动",
  "timing.elapsedAverageSpeedMps": "总均速",
};

type EvidenceCard = {
  allowedClaims: Array<{ key: string; label: string; displayValue: string; displayUnit?: string }>;
  allowedDimensionKeys: string[];
  limitations: string[];
  profileFacts: Array<{ key: string; value: number; unit: string; source: "user_provided" }>;
};

type PresentedOutput = {
  headline: string;
  overallAssessment: { text: string };
  dimensions: Array<{ key: string; text: string }>;
  limitations: string[];
  nextAction: { kind: "grounded" | "general"; text: string } | null;
  safetyLevel: "normal";
};

type PackItem = { itemId: string; evidence: EvidenceCard; output: PresentedOutput };

type CaseRunResult = {
  caseId: string;
  fixtureId: string;
  tier: "L1" | "L2" | "L3";
  outcome: "success" | "failure";
  source: "candidate" | "b0";
  attempts: 1 | 2;
  latencyMs: number;
  validation: { valid: boolean; issues: string[] };
  outputSha256: string;
  output: RideInterpretationOutputV04Candidate | null;
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
  return `AEVAL-RUN-${date}-${String((Date.now() % 900) + 100).padStart(3, "0")}`;
}

// Deterministic seeded shuffle (mulberry32) so both packages are reproducible.
function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function inputFor(plan: FormalPlan, fixtureId: string): RideInterpretationInputV04Candidate {
  const fixture = getRideFixture(fixtureId);
  const profile = createUserProfile({
    age: plan.profile.age,
    maxHeartRateBpm: plan.profile.maxHeartRateBpm,
    weightKg: plan.profile.weightKg,
    ftpWatts: plan.profile.ftpWatts,
  }, plan.profile.effectiveAt);
  const context = buildRideAnalysisContext({ activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) }, { profile });
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  if (!input) throw new Error(`BLIND_REVIEW_INPUT_UNAVAILABLE:${fixtureId}`);
  return input;
}

function buildEvidenceCard(plan: FormalPlan, input: RideInterpretationInputV04Candidate): EvidenceCard {
  return {
    allowedClaims: input.allowedClaims
      .filter((claim) => claim.displayValue)
      .map((claim) => ({
        key: claim.key,
        label: CLAIM_LABELS[claim.key] ?? claim.key,
        displayValue: claim.displayValue!,
        ...(claim.displayUnit ? { displayUnit: claim.displayUnit } : {}),
      })),
    allowedDimensionKeys: input.dimensionInterpretations.map((dimension) => dimension.dimensionId),
    limitations: input.limitations.map((limitation) =>
      `${DIMENSION_LABELS[limitation.dimensionId] ?? limitation.dimensionId}：该维度保留了确定性数据限制。`),
    profileFacts: [
      { key: "age", value: plan.profile.age, unit: "years", source: "user_provided" },
      { key: "maxHeartRateBpm", value: plan.profile.maxHeartRateBpm, unit: "bpm", source: "user_provided" },
      { key: "weightKg", value: plan.profile.weightKg, unit: "kg", source: "user_provided" },
      { key: "ftpWatts", value: plan.profile.ftpWatts, unit: "W", source: "user_provided" },
    ],
  };
}

function presentCandidateOutput(output: RideInterpretationOutputV04Candidate): PresentedOutput {
  return {
    headline: output.oneLineLabel.text,
    overallAssessment: { text: output.overallAssessment.text },
    dimensions: output.dimensions.map((dimension) => ({ key: dimension.dimensionId, text: dimension.text })),
    limitations: output.limitations.map((limitation) =>
      `${DIMENSION_LABELS[limitation.dimensionId] ?? limitation.dimensionId}：该维度保留了确定性数据限制。`),
    nextAction: output.nextAction ? { kind: output.nextAction.kind, text: output.nextAction.text } : null,
    safetyLevel: "normal",
  };
}

// B0 deterministic fact layer: same rendering family as the FIX-018 fact
// fallback (claimFactFallbackText), shaped like the candidate presentation.
// No model calls are involved.
function buildB0Output(input: RideInterpretationInputV04Candidate): PresentedOutput {
  const unitClaimIds = (unit: { factClaimIds: string[]; performanceClaimIds: string[]; capabilityEvidenceClaimIds: string[]; meaningClaimIds: string[] }) => [
    ...unit.factClaimIds,
    ...unit.performanceClaimIds,
    ...unit.capabilityEvidenceClaimIds,
    ...unit.meaningClaimIds,
  ];
  const overallText = claimFactFallbackText(unitClaimIds(input.overallAssessment), input) ?? PROVEN_SAFE_OVERALL_FALLBACK_TEXT;
  const dimensions = input.dimensionInterpretations.map((dimension) => ({
    key: dimension.dimensionId,
    text: claimFactFallbackText(unitClaimIds(dimension), input) ?? PROVEN_SAFE_DIMENSION_FALLBACK_TEXT,
  }));
  return {
    headline: "本次骑行事实摘要",
    overallAssessment: { text: overallText },
    dimensions,
    limitations: input.limitations.map((limitation) =>
      `${DIMENSION_LABELS[limitation.dimensionId] ?? limitation.dimensionId}：该维度保留了确定性数据限制。`),
    nextAction: null,
    safetyLevel: "normal",
  };
}

function scoreSheetMarkdown(reviewer: "A" | "B", items: PackItem[]): string {
  const rows = items.map((item) => `| ${item.itemId} |  |  |  |  |  |  |  |  |`);
  return [
    `# T002-V04 匿名评分表（评审${reviewer}）`,
    "",
    "只根据对应匿名输入证据和输出评分，不记录模型或批次猜测。六项均填 1–5 整数。",
    "",
    "| itemId | 事实忠实 | 洞察价值 | 行动性 | 易懂性 | 语气匹配 | 不确定性 | 硬门备注 | 评语 |",
    "|---|---:|---:|---:|---:|---:|---:|---|---|",
    ...rows,
    "",
    "两评审分歧达到 2 分的条目将在汇总时标记复核。",
    "",
  ].join("\n");
}

async function verifyRuntimeAssets(plan: FormalPlan): Promise<void> {
  if (!plan.runtimeAssets) throw new Error("BLIND_REVIEW_PLAN_RUNTIME_ASSETS_MISSING");
  for (const asset of plan.runtimeAssets) {
    const content = await readFile(join(ROOT, asset.path), "utf8");
    if (sha256(content) !== asset.sha256) throw new Error(`BLIND_REVIEW_RUNTIME_ASSET_SHA_MISMATCH:${asset.path}`);
  }
}

async function main(): Promise<void> {
  const plan = JSON.parse(await readFile(PLAN_PATH, "utf8")) as FormalPlan;
  if (plan.schemaVersion !== "ride-interpretation-formal-stability-plan-v0.1" || plan.status !== "FROZEN" || plan.benchmark !== "AEVAL-M1-RIDE-INTERPRETATION-V04-FORMAL") {
    throw new Error("BLIND_REVIEW_PLAN_INVALID");
  }
  if (plan.cases.length !== 9) throw new Error("BLIND_REVIEW_PLAN_CASES_UNEXPECTED");
  await verifyRuntimeAssets(plan);

  const inputs = plan.cases.map((target) => {
    const input = inputFor(plan, target.fixtureId);
    const inputHash = sha256(JSON.stringify(input));
    if (inputHash !== target.inputSha256) throw new Error(`BLIND_REVIEW_INPUT_SHA256_MISMATCH:${target.caseId}`);
    return { target, input };
  });

  if (PREFLIGHT) {
    console.log(JSON.stringify({
      reviewId: REVIEW_ID,
      planFile: PLAN_FILE,
      planVersion: plan.planVersion,
      runtimeAssetsVerified: (plan.runtimeAssets ?? []).length,
      cases: inputs.map(({ target }) => ({ caseId: target.caseId, fixtureId: target.fixtureId, tier: target.tier, inputSha256: target.inputSha256 })),
      versionMatrix: plan.versionMatrix,
      samplesPerReviewer: plan.cases.length * 2,
      reviewerSeeds: REVIEWER_SEEDS,
      noModelCalls: true,
    }, null, 2));
    return;
  }

  if (!CONFIRMED) {
    throw new Error("BLIND_REVIEW_NOT_AUTHORIZED:set T002_V04_BLIND_REVIEW_CONFIRM=YES after explicit user authorization");
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
    throw new Error("BLIND_REVIEW_WORKFLOW_MISMATCH");
  }

  const runId = process.env.T002_V04_BLIND_REVIEW_RUN_ID?.trim() || newRunId();
  if (!/^AEVAL-RUN-\d{8}-\d{3}$/.test(runId)) throw new Error("BLIND_REVIEW_RUN_ID_INVALID");
  const runArtifact = join(RUNS_PATH, `${runId}.json`);
  if (existsSync(runArtifact)) throw new Error("BLIND_REVIEW_RUN_ALREADY_EXISTS");

  const client = new RideInterpretationCozeClientV04Candidate(config);
  const results: CaseRunResult[] = [];
  let aborted: string | null = null;

  for (const { target, input } of inputs) {
    const runtime = await runRideInterpretationV04Candidate(input, client, `${runId}:${target.caseId}`, SLOT_TIMEOUT_MS);
    const result: CaseRunResult = {
      caseId: target.caseId,
      fixtureId: target.fixtureId,
      tier: target.tier,
      outcome: runtime.source === "candidate" ? "success" : "failure",
      source: runtime.source,
      attempts: runtime.attempts,
      latencyMs: runtime.latencyMs,
      validation: { valid: runtime.source === "candidate", issues: runtime.validationIssues },
      outputSha256: runtime.output ? sha256(JSON.stringify(runtime.output)) : "NOT_OBSERVABLE",
      output: runtime.output,
    };
    results.push(result);
    console.log(JSON.stringify({ caseId: target.caseId, outcome: result.outcome, attempts: result.attempts, latencyMs: result.latencyMs, issues: result.validation.issues }));
    if (runtime.source === "b0") {
      aborted = `B0_FALLBACK:${target.caseId}:${runtime.fallbackCode}`;
      break;
    }
  }

  await mkdir(RUNS_PATH, { recursive: true });
  const complete = aborted === null && results.length === plan.cases.length && results.every((result) => result.outcome === "success");
  await writeFile(runArtifact, `${JSON.stringify({
    schemaVersion: "ride-interpretation-blind-review-pack-run-v0.1",
    benchmark: "AEVAL-M1-RIDE-INTERPRETATION-V04-BLIND-REVIEW",
    reviewId: REVIEW_ID,
    reviewVersion: REVIEW_VERSION,
    runId,
    planFile: PLAN_FILE,
    planSha256: sha256(await readFile(PLAN_PATH, "utf8")),
    workflow: { name: config.workflowName, id: config.workflowId, version: config.workflowVersion, modelId: config.modelId },
    versionMatrix: plan.versionMatrix,
    rawOutputsStored: true,
    candidateInputsStored: false,
    tokenUsageStored: false,
    status: complete ? "complete" : "aborted",
    ...(aborted ? { aborted } : {}),
    authorization: { slots: plan.cases.length, scope: "9 frozen de-identified candidate inputs, one call each, outputs stored verbatim for blind review", authorizedBy: "user" },
    summary: {
      executedCases: results.length,
      successCount: results.filter((result) => result.outcome === "success").length,
      b0Count: results.filter((result) => result.source === "b0").length,
      p50Ms: results.length > 0 ? results.map((result) => result.latencyMs).sort((a, b) => a - b)[Math.floor(results.length / 2)] : null,
      maxMs: results.length > 0 ? Math.max(...results.map((result) => result.latencyMs)) : null,
    },
    results,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

  if (!complete) {
    console.log(JSON.stringify({ runId, status: "aborted", aborted, packsGenerated: false, artifact: runArtifact }, null, 2));
    return;
  }

  // Build paired samples: candidate + B0 per case, then shuffle per reviewer.
  type Sample = { source: "candidate" | "b0"; caseId: string; fixtureId: string; tier: string; evidence: EvidenceCard; output: PresentedOutput };
  const samples: Sample[] = [];
  for (let index = 0; index < plan.cases.length; index += 1) {
    const { target, input } = inputs[index]!;
    const evidence = buildEvidenceCard(plan, input);
    samples.push({ source: "candidate", caseId: target.caseId, fixtureId: target.fixtureId, tier: target.tier, evidence, output: presentCandidateOutput(results[index]!.output!) });
    samples.push({ source: "b0", caseId: target.caseId, fixtureId: target.fixtureId, tier: target.tier, evidence, output: buildB0Output(input) });
  }

  await mkdir(HUMAN_REVIEW_PATH, { recursive: true });
  const keyItems: Array<{ reviewer: "A" | "B"; itemId: string; source: "candidate" | "b0"; caseId: string; fixtureId: string; tier: string }> = [];

  for (const reviewer of ["A", "B"] as const) {
    const ordered = shuffled(samples, REVIEWER_SEEDS[reviewer]);
    const items: PackItem[] = ordered.map((sample, index) => ({ itemId: `ITEM-${String(index + 1).padStart(3, "0")}`, evidence: sample.evidence, output: sample.output }));
    for (let index = 0; index < ordered.length; index += 1) {
      const sample = ordered[index]!;
      keyItems.push({ reviewer, itemId: items[index]!.itemId, source: sample.source, caseId: sample.caseId, fixtureId: sample.fixtureId, tier: sample.tier });
    }
    await writeFile(
      join(HUMAN_REVIEW_PATH, `${REVIEW_ID}-blind-reviewer-${reviewer}-${REVIEW_VERSION}.json`),
      `${JSON.stringify({
        presentationVersion: "blind-review-presentation-v0.2",
        benchmark: "AEVAL-M1-RIDE-INTERPRETATION-V04-BLIND-REVIEW",
        itemCount: items.length,
        scale: "每项1-5分；只依据输入证据和输出评分，不推断模型、批次或来源。任一维度分歧达到2分时复核。",
        forbiddenInference: ["不猜测样本来源", "不计算加权总分", "不外推系统能力", "不判断版本 Gate"],
        reviewer,
        items,
      }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await writeFile(
      join(HUMAN_REVIEW_PATH, `${REVIEW_ID}-blind-score-sheet-${reviewer}-${REVIEW_VERSION}.md`),
      scoreSheetMarkdown(reviewer, items),
      { encoding: "utf8", flag: "wx" },
    );
  }

  await writeFile(
    join(HUMAN_REVIEW_PATH, `${REVIEW_ID}-scoring-key-${REVIEW_VERSION}.json`),
    `${JSON.stringify({
      warning: "仅项目维护者使用，不发送给评审",
      runId,
      reviewId: REVIEW_ID,
      reviewerSeeds: REVIEWER_SEEDS,
      items: keyItems,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  console.log(JSON.stringify({
    runId,
    status: "complete",
    packsGenerated: true,
    samplesPerReviewer: samples.length,
    reviewerSeeds: REVIEWER_SEEDS,
    artifacts: {
      run: runArtifact,
      reviewerA: join("eval", "human-review", `${REVIEW_ID}-blind-reviewer-A-${REVIEW_VERSION}.json`),
      reviewerB: join("eval", "human-review", `${REVIEW_ID}-blind-reviewer-B-${REVIEW_VERSION}.json`),
      scoreSheetA: join("eval", "human-review", `${REVIEW_ID}-blind-score-sheet-A-${REVIEW_VERSION}.md`),
      scoreSheetB: join("eval", "human-review", `${REVIEW_ID}-blind-score-sheet-B-${REVIEW_VERSION}.md`),
      scoringKey: join("eval", "human-review", `${REVIEW_ID}-scoring-key-${REVIEW_VERSION}.json`),
    },
  }, null, 2));
}

await main();
