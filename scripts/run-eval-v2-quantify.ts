/**
 * EVAL-01 失败率量化 runner（自动指标部分，2026-10-07）。
 *
 * 复用生产服务 runRideInterpretationV2（同一 Provider、Prompt、校验器、
 * 修复编排、预算门），对每个样例连续调用 N 次（同输入重复），统计：
 *   首轮通过率 / 修复后通过率 / 最终降级率 / 失败错误类型分布 / 延迟 / 成本。
 *
 * 用法：
 *   node --experimental-strip-types scripts/run-eval-v2-quantify.ts [--runs 5] [--sample <id>...]
 * 默认跑 DEFAULT_SAMPLES 全部样例各 --runs 次；--sample 可只跑指定样例（冒烟/调试）。
 * 真实模型调用（约 0.1-0.3 元/次），产出 output/v2-eval-quantify/ 报告。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import FitParser from "fit-file-parser";

import { createUserProfile } from "../src/domain/user-profile.ts";
import { demoImportedRideMeta } from "../src/fixtures/demo-imported-ride-manifest.ts";
import { loadDemoImportedRides } from "../src/fixtures/demo-imported-rides.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { readRideModelProviderConfigV2, RideModelClientV2 } from "../src/ai/ride-model-provider-v2.ts";
import { runRideInterpretationV2, type RideModelCallerV2 } from "../src/ai/ride-interpretation-service-v2.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import type { UserProfile } from "../src/domain/user-profile.ts";

const RUNS = Number((process.argv.find((a) => a === "--runs") !== undefined
  ? process.argv[process.argv.indexOf("--runs") + 1] : "10"));
const SAMPLE_FILTER = (() => {
  const idx = process.argv.indexOf("--sample");
  return idx >= 0 ? process.argv.slice(idx + 1).filter((a) => !a.startsWith("--")) : [];
})();
const OUT_DIR = join(process.cwd(), "output", "v2-eval-quantify");

// 样例清单（决策点 1：最终冻结集待用户确认后固化；当前为可运行的现成样例）。
// source: demo=演示 FIT / upload=本地上传 / fixture=内置样例
interface SampleSpec { id: string; source: "demo" | "upload" | "fixture"; }
const DEFAULT_SAMPLES: SampleSpec[] = [
  { id: "demo-ride-2026-07-22", source: "demo" },
  { id: "demo-ride-2026-08-20", source: "demo" },
  { id: "upload-965aa12e-01a1-4aaf-84bc-66395c9e92eb", source: "upload" },
  { id: "l3-power-preview", source: "fixture" },
];

const WEIGHT_KG = 70;
const AGE = 32;
const HEIGHT_CM = 175;

async function loadEnv(): Promise<void> {
  try {
    const text = await readFile(join(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && m[2] !== undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // 无 .env.local 时退回进程环境
  }
}

async function extractProfileFromFit(path: string): Promise<{ ftpWatts: number; maxHeartRateBpm: number }> {
  const buffer = await readFile(path);
  const parser = new FitParser({ force: true, mode: "list" });
  const data = await new Promise<Record<string, unknown>>((resolve, reject) => {
    parser.parse(buffer, (err: string | undefined, result?: unknown) => {
      if (err) reject(new Error(err));
      else resolve(result as Record<string, unknown>);
    });
  });
  const zones = (data.zones_target as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
  const ftp = Number(zones.functional_threshold_power);
  const maxHr = Number(zones.max_heart_rate);
  return {
    ftpWatts: Number.isFinite(ftp) && ftp > 0 ? ftp : 200,
    maxHeartRateBpm: Number.isFinite(maxHr) && maxHr > 0 ? maxHr : 200,
  };
}

async function resolveSample(spec: SampleSpec): Promise<{ record: RideRecord; profile: UserProfile }> {
  if (spec.source === "demo") {
    const demos = await loadDemoImportedRides();
    const demo = demos.find((item) => item.rideId === spec.id);
    if (!demo) throw new Error(`demo ride not found: ${spec.id}`);
    const meta = demoImportedRideMeta(spec.id);
    const { ftpWatts, maxHeartRateBpm } = await extractProfileFromFit(join(process.cwd(), "test-data", "demo-imported-rides", meta!.fileName));
    return { record: demo.record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm, ftpWatts }) };
  }
  if (spec.source === "upload") {
    const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
    const ride = state.rides?.[spec.id];
    if (!ride?.record) throw new Error(`uploaded ride not found: ${spec.id}`);
    return { record: ride.record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm: 200, ftpWatts: 200 }) };
  }
  const fixture = getRideFixture(spec.id);
  const record: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  return { record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm: 188, ftpWatts: 240 }) };
}

interface RunOutcome {
  source: "v2" | "b0";
  stage: string;
  failureCodes: string[];
  modelCalls: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

async function runOne(caller: RideModelCallerV2, record: RideRecord, profile: UserProfile, tag: string): Promise<RunOutcome> {
  const result = await runRideInterpretationV2({
    record,
    profile,
    analysisRunId: `eval-v2-${tag}-${Math.random().toString(36).slice(2, 10)}`,
    userScope: "eval-v2",
    requestId: Math.random().toString(36).slice(2, 10),
    modelCaller: caller,
    allowModelRepair: true,
  });
  const callRecords = result.callRecords ?? [];
  const latencyMs = callRecords.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0);
  const promptTokens = callRecords.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0), 0);
  const completionTokens = callRecords.reduce((sum, r) => sum + (r.usage?.outputTokens ?? 0), 0);
  return {
    source: result.source,
    stage: result.stage,
    failureCodes: result.source === "b0" ? (result.failureCodes ?? [result.fallbackCode]) : [],
    modelCalls: callRecords.length,
    latencyMs,
    promptTokens,
    completionTokens,
  };
}

async function main(): Promise<void> {
  await loadEnv();
  const providerConfig = readRideModelProviderConfigV2(process.env);
  if (!providerConfig) {
    console.error("未配置模型 Provider（.env.local 缺 SILICONFLOW_API_TOKEN 等）");
    process.exit(1);
  }
  const client = new RideModelClientV2(providerConfig);
  const caller: RideModelCallerV2 = (invocation) => client.run(invocation);

  const samples = SAMPLE_FILTER.length ? DEFAULT_SAMPLES.filter((s) => SAMPLE_FILTER.includes(s.id)) : DEFAULT_SAMPLES;
  if (!samples.length) {
    console.error("无样例：--sample 未匹配任何 DEFAULT_SAMPLES");
    process.exit(1);
  }

  console.log(`样例 ${samples.length} 条 × ${RUNS} 次 = ${samples.length * RUNS} 次真实调用`);
  console.log(`模型: ${providerConfig.modelId} | temperature 0.3 | enable_thinking false\n`);

  const allOutcomes: Array<{ sample: string; run: number; outcome: RunOutcome }> = [];
  for (const spec of samples) {
    const { record, profile } = await resolveSample(spec);
    for (let run = 1; run <= RUNS; run += 1) {
      const outcome = await runOne(caller, record, profile, spec.id);
      allOutcomes.push({ sample: spec.id, run, outcome });
      console.log(`[${spec.id}] 第 ${run}/${RUNS} 次 → ${outcome.source} / ${outcome.stage} / 调用 ${outcome.modelCalls} 次 / ${(outcome.latencyMs / 1000).toFixed(1)}s / ${outcome.failureCodes.join(",") || "-"}`);
    }
  }

  // 汇总
  const bySample = new Map<string, RunOutcome[]>();
  for (const entry of allOutcomes) {
    const list = bySample.get(entry.sample) ?? [];
    list.push(entry.outcome);
    bySample.set(entry.sample, list);
  }
  const total = allOutcomes.length;
  const firstRound = allOutcomes.filter((e) => e.outcome.stage === "firstPass").length;
  const repaired = allOutcomes.filter((e) => e.outcome.stage === "deterministicRepairPass" || e.outcome.stage === "modelRepairPass").length;
  const degraded = allOutcomes.filter((e) => e.outcome.source === "b0").length;
  const errorDist = new Map<string, number>();
  for (const e of allOutcomes) for (const code of e.outcome.failureCodes) errorDist.set(code, (errorDist.get(code) ?? 0) + 1);
  const latencies = allOutcomes.map((e) => e.outcome.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  const promptTokens = allOutcomes.reduce((s, e) => s + e.outcome.promptTokens, 0);
  const completionTokens = allOutcomes.reduce((s, e) => s + e.outcome.completionTokens, 0);

  const report = {
    runId: "EVAL-V2-R01-20261007",
    versionStack: {
      prompt: "ride-prompt-v2.7.1",
      outputSchema: "ride-output-v2.2.0",
      inputSchema: "ride-model-input-v2.4.0",
      evidenceRules: "ride-evidence-rules-v2.1.0",
      model: providerConfig.modelId,
      sampling: { temperature: 0.3, enable_thinking: false },
    },
    samples: samples.map((s) => s.id),
    runsPerSample: RUNS,
    totals: {
      runs: total,
      firstRoundPass: firstRound,
      firstRoundPassRate: (firstRound / total * 100).toFixed(1) + "%",
      repairPass: repaired,
      repairPassRate: (repaired / total * 100).toFixed(1) + "%",
      finalPass: total - degraded,
      finalDegradation: degraded,
      finalDegradationRate: (degraded / total * 100).toFixed(1) + "%",
    },
    errorDistribution: Object.fromEntries([...errorDist.entries()].sort((a, b) => b[1] - a[1])),
    latency: { p50s: (pct(0.5) / 1000).toFixed(1), p95s: (pct(0.95) / 1000).toFixed(1), maxS: (Math.max(...latencies) / 1000).toFixed(1) },
    cost: { promptTokens, completionTokens },
    perSample: Object.fromEntries([...bySample.entries()].map(([id, list]) => [id, {
      runs: list.length,
      firstRoundPass: list.filter((o) => o.stage === "firstPass").length,
      degraded: list.filter((o) => o.source === "b0").length,
      stages: list.map((o) => o.stage),
      failureCodes: list.flatMap((o) => o.failureCodes),
    }])),
    thresholds: { pass: "<= 5% 最终降级率放行", mixed: "5-15% 定处理方案", stop: "> 15% 停下换模型/加强提示" },
    runOutcomes: allOutcomes.map((e) => ({ sample: e.sample, run: e.run, source: e.outcome.source, stage: e.outcome.stage, failureCodes: e.outcome.failureCodes, modelCalls: e.outcome.modelCalls, latencyMs: e.outcome.latencyMs })),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log("\n===== 汇总 =====");
  console.log(`总调用 ${total} 次 | 首轮通过 ${firstRound}（${report.totals.firstRoundPassRate}）| 修复通过 ${repaired}（${report.totals.repairPassRate}）| 最终降级 ${degraded}（${report.totals.finalDegradationRate}）`);
  console.log(`延迟 P50 ${report.latency.p50s}s / P95 ${report.latency.p95s}s / 最大 ${report.latency.maxS}s`);
  console.log(`错误分布: ${JSON.stringify(report.errorDistribution)}`);
  console.log(`\n报告已落盘: output/v2-eval-quantify/report.json`);
}

await main();
