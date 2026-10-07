/**
 * 四条骑行修复失败复核（2026-10-08）。
 *
 * 背景：用户报告 upload-f95e988a / demo-08-20 / demo-07-22 / upload-965aa12e
 *   分别报 NO_DELIVERABLE_QUESTIONS / SOFT_QUALITY_NOT_DISCLOSED /
 *   STABILITY_WITHOUT_VARIANCE / NUMBER_NOT_IN_CLAIMS。其中 f95e 的输入资格
 *   （NO_DELIVERABLE_QUESTIONS）已确认是旧代码（最新代码下 ready），另三条是
 *   输出校验错误，需真跑模型确认是否为新变体。
 *
 * 方法：对每条样例连跑 --runs 次真实调用（只抓首轮，不触发修复），首轮输出直接
 *   过 validateRideModelOutputV2 拿全量 issue 明细，对每条 issue 输出 code / path /
 *   message / 所在 assertion 的 text / conclusionType / claimIds，供人工判类。
 *
 * 落盘 output/v2-four-rides-diagnosis/<sample>/run-N.json + summary.json。
 *
 * 用法：node --experimental-strip-types scripts/diagnose-four-rides-output.ts [--runs 1] [--sample <id>...]
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
import type { RideRecord } from "../src/domain/ride-schema.ts";
import type { UserProfile } from "../src/domain/user-profile.ts";

const RUNS = Number((process.argv.find((a) => a === "--runs") !== undefined
  ? process.argv[process.argv.indexOf("--runs") + 1] : "1"));
const SAMPLE_FILTER = (() => {
  const idx = process.argv.indexOf("--sample");
  return idx >= 0 ? process.argv.slice(idx + 1).filter((a) => !a.startsWith("--")) : [];
})();
const OUT_DIR = join(process.cwd(), "output", "v2-four-rides-diagnosis");

interface SampleSpec { id: string; source: "demo" | "upload"; }
const DEFAULT_SAMPLES: SampleSpec[] = [
  { id: "upload-f95e988a-477e-4703-a2e7-0d1547fbe0b1", source: "upload" },
  { id: "demo-ride-2026-08-20", source: "demo" },
  { id: "demo-ride-2026-07-22", source: "demo" },
  { id: "upload-965aa12e-01a1-4aaf-84bc-66395c9e92eb", source: "upload" },
];

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

async function resolveSample(spec: SampleSpec): Promise<{ record: RideRecord; profile: UserProfile }> {
  if (spec.source === "demo") {
    const demos = await loadDemoImportedRides();
    const demo = demos.find((item) => item.rideId === spec.id);
    if (!demo) throw new Error(`demo ride not found: ${spec.id}`);
    const meta = demoImportedRideMeta(spec.id);
    const { ftpWatts, maxHeartRateBpm } = await extractProfileFromFit(join(process.cwd(), "test-data", "demo-imported-rides", meta!.fileName));
    return { record: demo.record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm, ftpWatts }) };
  }
  const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
  const ride = state.rides?.[spec.id];
  if (!ride?.record) throw new Error(`uploaded ride not found: ${spec.id}`);
  return { record: ride.record, profile: createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm: 200, ftpWatts: 200 }) };
}

async function buildInput(record: RideRecord, profile: UserProfile): Promise<RideModelInputV2> {
  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: "run-diag-four", userScope: "user-diag-four",
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: [],
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
    retrievedAt: "2026-10-08T00:00:00.000Z",
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: "run-diag-four", userScope: "user-diag-four" });
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
  const segs = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  return segs.slice(0, -1).join(".");
}

interface IssueDetail {
  code: string;
  path: string;
  message: string;
  text: string;
  conclusionType: string | undefined;
  claimIds: string[];
}

function analyzeAllIssues(output: unknown, issues: { code: string; path: string; message: string }[]): IssueDetail[] {
  return issues.map((issue) => {
    const parent = getAtPath(output, parentPath(issue.path));
    const view = (parent && typeof parent === "object" ? parent : {}) as Record<string, unknown>;
    return {
      code: issue.code,
      path: issue.path,
      message: issue.message,
      text: typeof view.text === "string" ? view.text : "(no text at parent)",
      conclusionType: typeof view.conclusionType === "string" ? view.conclusionType : undefined,
      claimIds: Array.isArray(view.claimIds) ? view.claimIds.filter((x): x is string => typeof x === "string") : [],
    };
  });
}

async function main(): Promise<void> {
  const env = await loadEnv();
  const config = readRideModelProviderConfigV2(env);
  if (!config) { console.error("未找到 SILICONFLOW_API_TOKEN（.env.local），无法诊断。"); process.exit(1); }
  const client = new RideModelClientV2(config);

  const samples = SAMPLE_FILTER.length ? DEFAULT_SAMPLES.filter((s) => SAMPLE_FILTER.includes(s.id)) : DEFAULT_SAMPLES;
  if (!samples.length) { console.error("--sample 未匹配任何 DEFAULT_SAMPLES"); process.exit(1); }

  console.log(`样例 ${samples.length} 条 × ${RUNS} 次 = ${samples.length * RUNS} 次真实调用（只抓首轮，不触发修复）`);
  console.log(`模型: ${config.modelId} | temperature 0.3 | enable_thinking false\n`);

  const summary: Array<{ sample: string; run: number; pass: boolean; issueCodes: string[] }> = [];

  for (const spec of samples) {
    const { record, profile } = await resolveSample(spec);
    const input = await buildInput(record, profile);
    const prompt = buildRidePromptV2(input);
    await mkdir(join(OUT_DIR, spec.id), { recursive: true });

    for (let run = 1; run <= RUNS; run += 1) {
      const started = Date.now();
      const result = await client.run({
        analysisRunId: "run-diag-four",
        requestId: `diag-four-${spec.id}-${run}`,
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
      const details = analyzeAllIssues(parsed, issues);

      console.log(`[${spec.id}] 第 ${run}/${RUNS} 次 → ${issues.length} 个 issue / ${latencyS}s`);
      for (const d of details) {
        console.log(`    ${d.code} @ ${d.path} [${d.conclusionType ?? "-"}] claimIds=${d.claimIds.join(",") || "-"}`);
        console.log(`        ${d.text.slice(0, 140)}`);
      }

      await writeFile(join(OUT_DIR, spec.id, `run-${run}.json`), JSON.stringify({
        sample: spec.id, run, latencyS, firstRawText: result.rawText, issues: details,
      }, null, 2), "utf8");

      summary.push({ sample: spec.id, run, pass: issues.length === 0, issueCodes: issues.map((i) => i.code) });
    }
  }

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({ samples, runs: RUNS, summary }, null, 2), "utf8");
  console.log("\n===== 汇总 =====");
  for (const s of summary) console.log(`${s.sample} 第${s.run}次: ${s.pass ? "PASS" : "FAIL " + s.issueCodes.join(",")}`);
}

await main();
