/**
 * NUMBER_NOT_IN_CLAIMS 归因诊断（EVAL-01 方案 C，2026-10-07）。
 *
 * 目标：把 NUMBER_NOT_IN_CLAIMS 违规逐条捞出来分类——
 *   (a) "等价没覆盖" = 校验器误拦：违规数字其实与某个引用 Claim 的值在语义上等价
 *       （舍入到第 3 位、单位换算 km/h↔m/s、百分比↔比值、或数字其实藏在 claim.text
 *        里却被 structuralNumberPattern 误剥），属校验器缺陷，应修校验器；
 *   (b) "模型凭空造数" = 模型真错：违规数字与所有引用 Claim 的值都无关，属模型问题，
 *       应换模型/加强提示。
 *
 * 方法：对每个样例连跑 --runs 次真实调用（只抓首轮，不触发修复），首轮输出直接过
 *   validateRideModelOutputV2 拿全量 issue 明细（生产链路只留 failureCodes），对每条
 *   NUMBER_NOT_IN_CLAIMS 拉出：违规数字、所在 assertion 原文、conclusionType、引用
 *   claimIds，以及每个引用 Claim 的 value/displayValue/text 与"数字面"（extractNumbers
 *   剥离结构数字后的结果）和最近候选值差，供人工判类。
 *
 * 落盘 output/v2-number-diagnosis/<sample>/run-N.json + summary.json。
 *
 * 用法：node --experimental-strip-types scripts/diagnose-number-not-in-claims.ts [--runs 5] [--sample <id>...]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import FitParser from "fit-file-parser";

import { createUserProfile } from "../src/domain/user-profile.ts";
import { demoImportedRideMeta } from "../src/fixtures/demo-imported-ride-manifest.ts";
import { loadDemoImportedRides } from "../src/fixtures/demo-imported-rides.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
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
  ? process.argv[process.argv.indexOf("--runs") + 1] : "5"));
const SAMPLE_FILTER = (() => {
  const idx = process.argv.indexOf("--sample");
  return idx >= 0 ? process.argv.slice(idx + 1).filter((a) => !a.startsWith("--")) : [];
})();
const OUT_DIR = join(process.cwd(), "output", "v2-number-diagnosis");

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

// ---- 与 validator 保持同步的纯函数（来源 ride-output-validator-v2.ts）----
const structuralNumberPattern = /Z[1-7]|\d+\s*级|第[一二三四五六七八九十\d]+段|[^第]段\s*\d+|上\d+次|这\d+次|近\d+次|前\d+次|每\d+(分钟|小时|天|次|公里|km)/g;
function extractNumbers(text: string): number[] {
  const stripped = text.replace(structuralNumberPattern, " ");
  return [...stripped.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}
function roundedVariants(value: number): number[] {
  if (!Number.isFinite(value)) return [];
  return [0, 1, 2].map((digits) => Number(value.toFixed(digits)));
}
function claimCandidates(claim: V2AnalysisClaim): number[] {
  const candidates: number[] = [];
  if (typeof claim.value === "number") candidates.push(claim.value, ...roundedVariants(claim.value));
  for (const source of [claim.displayValue ?? "", claim.text ?? ""]) {
    for (const allowed of extractNumbers(String(source))) candidates.push(allowed, ...roundedVariants(allowed));
  }
  return [...new Set(candidates)];
}

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

async function buildInput(record: RideRecord, profile: UserProfile): Promise<RideModelInputV2> {
  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: "run-diag-number", userScope: "user-diag-number",
  });
  // PD-AI-25 知识软关：与生产 service 一致，不附带知识条目。
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: [],
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
    retrievedAt: "2026-10-07T00:00:00.000Z",
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: "run-diag-number", userScope: "user-diag-number" });
  if (result.status !== "ready") throw new Error(`input blocked: ${result.failureCode}`);
  return result.input;
}

function parseModelJsonText(rawText: string): unknown {
  try { return JSON.parse(rawText); } catch { /* fall through */ }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { return undefined; } }
  return undefined;
}

// 把 issue 的 path（形如 dimensions[0].assertions[1].text）定位到父对象
// （dimensions[0].assertions[1]），拿到 text/claimIds/conclusionType。
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

interface ViolationDetail {
  path: string;
  message: string;
  number: number;
  text: string;
  conclusionType: string | undefined;
  claimIds: string[];
  knowledgeIds: string[];
  claims: Array<{
    claimId: string;
    key: string;
    kind: string;
    value: unknown;
    displayValue: string | undefined;
    text: string | undefined;
    candidates: number[];
    nearestCandidate: number | null;
    nearestDiff: number | null;
  }>;
}

function analyzeViolations(input: RideModelInputV2, output: unknown, issues: { code: string; path: string; message: string }[]): ViolationDetail[] {
  const claimsById = new Map(input.claims.map((c) => [c.claimId, c]));
  const out: ViolationDetail[] = [];
  for (const issue of issues) {
    if (issue.code !== "NUMBER_NOT_IN_CLAIMS") continue;
    const numMatch = issue.message.match(/number\s+(-?\d+(?:\.\d+)?)\s+in/);
    const number = numMatch ? Number(numMatch[1]) : Number.NaN;
    const parent = getAtPath(output, parentPath(issue.path));
    const view = (parent && typeof parent === "object" ? parent : {}) as Record<string, unknown>;
    const claimIds = Array.isArray(view.claimIds) ? view.claimIds.filter((x): x is string => typeof x === "string") : [];
    const knowledgeIds = Array.isArray(view.knowledgeIds) ? view.knowledgeIds.filter((x): x is string => typeof x === "string") : [];
    const claims = claimIds.map((cid) => {
      const claim = claimsById.get(cid);
      const candidates = claim ? claimCandidates(claim) : [];
      let nearest: number | null = null;
      let nearestDiff: number | null = null;
      for (const cand of candidates) {
        const diff = Math.abs(cand - number);
        if (nearestDiff === null || diff < nearestDiff) { nearestDiff = diff; nearest = cand; }
      }
      return {
        claimId: cid,
        key: claim?.key ?? "(unknown)",
        kind: claim?.kind ?? "(unknown)",
        value: claim?.value ?? null,
        displayValue: claim?.displayValue,
        text: claim?.text,
        candidates,
        nearestCandidate: nearest,
        nearestDiff,
      };
    });
    out.push({
      path: issue.path,
      message: issue.message,
      number,
      text: typeof view.text === "string" ? view.text : "(missing)",
      conclusionType: typeof view.conclusionType === "string" ? view.conclusionType : undefined,
      claimIds,
      knowledgeIds,
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

  const samples = SAMPLE_FILTER.length ? DEFAULT_SAMPLES.filter((s) => SAMPLE_FILTER.includes(s.id)) : DEFAULT_SAMPLES;
  if (!samples.length) { console.error("--sample 未匹配任何 DEFAULT_SAMPLES"); process.exit(1); }

  console.log(`样例 ${samples.length} 条 × ${RUNS} 次 = ${samples.length * RUNS} 次真实调用（只抓首轮，不触发修复）`);
  console.log(`模型: ${config.modelId} | temperature 0.3 | enable_thinking false\n`);

  const summary: Array<{ sample: string; run: number; totalViolations: number; violationCount: number; otherIssues: string[] }> = [];

  for (const spec of samples) {
    const { record, profile } = await resolveSample(spec);
    const input = await buildInput(record, profile);
    const prompt = buildRidePromptV2(input);
    await mkdir(join(OUT_DIR, spec.id), { recursive: true });

    for (let run = 1; run <= RUNS; run += 1) {
      const started = Date.now();
      const result = await client.run({
        analysisRunId: "run-diag-number",
        requestId: `diag-number-${spec.id}-${run}`,
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
      const violations = analyzeViolations(input, parsed, issues);

      console.log(`[${spec.id}] 第 ${run}/${RUNS} 次 → ${issues.length} 个 issue / ${violations.length} 个 NUMBER_NOT_IN_CLAIMS / ${latencyS}s`);
      for (const v of violations) {
        console.log(`    #${v.number} @ ${v.path} [${v.conclusionType}] 原文: ${v.text.slice(0, 90)}`);
        for (const c of v.claims) {
          const diff = c.nearestDiff === null ? "-" : (Number.isInteger(c.nearestDiff) ? String(c.nearestDiff) : c.nearestDiff.toFixed(3));
          console.log(`      claim ${c.claimId} (${c.key}) value=${String(c.value)} display="${c.displayValue ?? ""}" text="${(c.text ?? "").slice(0, 50)}" | 候选=${JSON.stringify(c.candidates)} | 最近候选=${c.nearestCandidate} 差=${diff}`);
        }
      }

      await writeFile(join(OUT_DIR, spec.id, `run-${run}.json`), JSON.stringify({
        sample: spec.id,
        run,
        latencyS,
        firstRawText: result.rawText,
        issues,
        violations,
      }, null, 2), "utf8");

      summary.push({
        sample: spec.id,
        run,
        totalViolations: issues.length,
        violationCount: violations.length,
        otherIssues: issues.filter((i) => i.code !== "NUMBER_NOT_IN_CLAIMS").map((i) => i.code),
      });
    }
  }

  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({ samples, runs: RUNS, summary, violationsTotal: summary.reduce((s, x) => s + x.violationCount, 0) }, null, 2), "utf8");
  console.log("\n===== 汇总 =====");
  console.log(`NUMBER_NOT_IN_CLAIMS 共 ${summary.reduce((s, x) => s + x.violationCount, 0)} 条，明细落盘 ${OUT_DIR}`);
}

await main();
