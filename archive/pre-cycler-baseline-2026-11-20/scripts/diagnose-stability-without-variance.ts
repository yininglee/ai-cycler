/**
 * STABILITY_WITHOUT_VARIANCE 归因诊断（2026-10-07）。
 *
 * 目标：demo-ride-2026-08-20 反复报 STABILITY_WITHOUT_VARIANCE，但该骑行
 * 表现本可解读为稳定。抓取违规原文 + 引用的 claimIds 及其 key/supports，
 * 判断是：
 *   (a) 模型写"稳定"却只引用 mean（漏引 CV/lastMinusFirst）——Prompt/引用问题；
 *   (b) 模型引用了 lastMinusFirst 但仍被拦——校验器 varianceSupported 判定 bug；
 *   (c) 输入里根本没有 variance 类 claim 可引——证据层供给问题（CONTINUITY_GAP）。
 *
 * 只抓首轮（不触发修复），对每条 STABILITY_WITHOUT_VARIANCE 拉出断言原文、
 * conclusionType、引用 claimIds 与对应 claim 的 key/supports/displayValue。
 *
 * 用法：node --experimental-strip-types scripts/diagnose-stability-without-variance.ts [--runs 3] [--sample <id>]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import FitParser from "fit-file-parser";

import { createUserProfile } from "../src/domain/user-profile.ts";
import { demoImportedRideMeta } from "../src/fixtures/demo-imported-ride-manifest.ts";
import { loadDemoImportedRides } from "../src/fixtures/demo-imported-rides.ts";
import { buildRideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import { buildRideTemporalWindowsV2 } from "../src/domain/ride-temporal-windows-v2.ts";
import { buildRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { buildRideAnalysisEvidencePacketsV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { attachRideKnowledgeEvidenceV2 } from "../src/domain/ride-analysis-knowledge-v2.ts";
import { RIDE_KNOWLEDGE_BASE_BATCH1_VERSION } from "../src/domain/ride-knowledge-base-batch1-v2.ts";
import { buildRideModelInputV2, type RideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import { buildRidePromptV2 } from "../src/ai/ride-prompt-v2.ts";
import { readRideModelProviderConfigV2, RideModelClientV2 } from "../src/ai/ride-model-provider-v2.ts";
import { validateRideModelOutputV2 } from "../src/ai/ride-output-validator-v2.ts";
import type { V2AnalysisClaim } from "../src/domain/ride-analysis-evidence-v2.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import type { UserProfile } from "../src/domain/user-profile.ts";

const RUNS = Number((process.argv.find((a) => a === "--runs") !== undefined
  ? process.argv[process.argv.indexOf("--runs") + 1] : "3"));
const SAMPLE_IDX = process.argv.indexOf("--sample");
const SAMPLE_ID = SAMPLE_IDX >= 0 ? process.argv[SAMPLE_IDX + 1] : "demo-ride-2026-08-20";
const OUT_DIR = join(process.cwd(), "output", "v2-stability-diagnosis");

const WEIGHT_KG = 70;
const AGE = 32;
const HEIGHT_CM = 175;

async function loadEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    const text = await readFile(join(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && m[2] !== undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* no .env.local */ }
  return env;
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

async function resolveSample(spec: string): Promise<{ record: RideRecord; profile: UserProfile }> {
  if (spec.startsWith("upload-")) {
    const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
    const ride = state.rides?.[spec];
    if (!ride?.record) throw new Error(`uploaded ride not found: ${spec}`);
    return { record: ride.record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm: 200, ftpWatts: 200 }) };
  }
  const demos = await loadDemoImportedRides();
  const demo = demos.find((item) => item.rideId === spec);
  if (!demo) throw new Error(`demo ride not found: ${spec}`);
  const meta = demoImportedRideMeta(spec);
  const { ftpWatts, maxHeartRateBpm } = await extractProfileFromFit(join(process.cwd(), "test-data", "demo-imported-rides", meta!.fileName));
  return { record: demo.record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm, ftpWatts }) };
}

async function buildInput(record: RideRecord, profile: UserProfile): Promise<RideModelInputV2> {
  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: "run-diag-stability", userScope: "user-diag-stability",
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: [],
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
    retrievedAt: "2026-10-07T00:00:00.000Z",
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: "run-diag-stability", userScope: "user-diag-stability" });
  if (result.status !== "ready") throw new Error(`input blocked: ${result.failureCode}`);
  return result.input;
}

function parseModelJsonText(rawText: string): unknown {
  try { return JSON.parse(rawText); } catch { /* fall through */ }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { return undefined; } }
  return undefined;
}

function getAtPath(root: unknown, path: string): unknown {
  const segs = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = root;
  for (const seg of segs) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
function parentPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).slice(0, -1).join(".");
}

interface ViolationDetail {
  path: string;
  message: string;
  text: string;
  conclusionType: string | undefined;
  claimIds: string[];
  claims: Array<{ claimId: string; key: string; supports: string[]; displayValue: string | undefined; value: unknown }>;
}

function analyzeStabilityViolations(input: RideModelInputV2, output: unknown, issues: { code: string; path: string; message: string }[]): ViolationDetail[] {
  const claimsById = new Map(input.claims.map((c) => [c.claimId, c]));
  const out: ViolationDetail[] = [];
  for (const issue of issues) {
    if (issue.code !== "STABILITY_WITHOUT_VARIANCE") continue;
    const parent = getAtPath(output, parentPath(issue.path));
    const view = (parent && typeof parent === "object" ? parent : {}) as Record<string, unknown>;
    const claimIds = Array.isArray(view.claimIds) ? view.claimIds.filter((x): x is string => typeof x === "string") : [];
    const claims = claimIds.map((cid) => {
      const claim: V2AnalysisClaim | undefined = claimsById.get(cid);
      return {
        claimId: cid,
        key: claim?.key ?? "(unknown)",
        supports: claim?.supports ?? [],
        displayValue: claim?.displayValue,
        value: claim?.value ?? null,
      };
    });
    out.push({
      path: issue.path,
      message: issue.message,
      text: typeof view.text === "string" ? view.text : "(missing)",
      conclusionType: typeof view.conclusionType === "string" ? view.conclusionType : undefined,
      claimIds,
      claims,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const env = await loadEnv();
  const config = readRideModelProviderConfigV2(env);
  if (!config) { console.error("未找到 SILICONFLOW_API_TOKEN（.env.local），无法诊断。"); process.exit(1); }
  const client = new RideModelClientV2(config);

  const { record, profile } = await resolveSample(SAMPLE_ID);
  const input = await buildInput(record, profile);
  const prompt = buildRidePromptV2(input);
  await mkdir(join(OUT_DIR, SAMPLE_ID), { recursive: true });

  // 供给侧盘点：输入里有哪些 variance 类 claim 可引。
  const varianceKeys = input.claims.filter((c) => /coefficientOfVariation|lastMinusFirst|drift|variance/i.test(c.key)
    || c.supports.some((s) => s.endsWith("_stability")));
  console.log(`输入 claim 总数: ${input.claims.length}`);
  console.log(`variance 类 claim（CV/lastMinusFirst/drift/_stability）共 ${varianceKeys.length} 条：`);
  for (const c of varianceKeys) {
    console.log(`  - ${c.key}  supports=${JSON.stringify(c.supports)}  display="${c.displayValue ?? ""}"`);
  }
  console.log(`\n模型: ${config.modelId} | 跑 ${RUNS} 次（只抓首轮）\n`);

  const runs: unknown[] = [];
  for (let run = 1; run <= RUNS; run += 1) {
    const started = Date.now();
    const result = await client.run({
      analysisRunId: "run-diag-stability",
      requestId: `diag-stability-${SAMPLE_ID}-${run}`,
      promptText: prompt.promptText,
      promptVersion: prompt.promptVersion,
      jsonMode: true,
    });
    const latencyS = ((Date.now() - started) / 1000).toFixed(1);
    const parsed = parseModelJsonText(result.rawText);
    const validation = parsed === undefined
      ? { status: "fail" as const, issues: [{ code: "OUTPUT_NOT_OBJECT", path: "$", message: "first-round output is not parseable JSON" }] }
      : validateRideModelOutputV2(input, parsed);
    const issues = validation.status === "pass" ? [] : validation.issues;
    const violations = analyzeStabilityViolations(input, parsed, issues);

    console.log(`[${SAMPLE_ID}] 第 ${run}/${RUNS} 次 → ${issues.length} 个 issue / ${violations.length} 个 STABILITY_WITHOUT_VARIANCE / ${latencyS}s`);
    for (const v of violations) {
      console.log(`  @ ${v.path} [${v.conclusionType}] 原文: ${v.text.slice(0, 120)}`);
      console.log(`    claimIds: ${JSON.stringify(v.claimIds)}`);
      for (const c of v.claims) {
        console.log(`      claim ${c.claimId} key=${c.key} supports=${JSON.stringify(c.supports)} display="${c.displayValue ?? ""}" value=${String(c.value)}`);
      }
    }

    runs.push({
      run,
      latencyS,
      firstRawText: result.rawText,
      issues,
      violations,
    });
    await writeFile(join(OUT_DIR, SAMPLE_ID, `run-${run}.json`), JSON.stringify({
      sample: SAMPLE_ID, run, latencyS, firstRawText: result.rawText, issues, violations,
    }, null, 2), "utf8");
  }

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({ sample: SAMPLE_ID, runs: RUNS, varianceClaimsAvailable: varianceKeys.map((c) => c.key) }, null, 2), "utf8");
  console.log(`\n===== 完成，明细落盘 ${OUT_DIR} =====`);
}

await main();
