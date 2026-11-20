/**
 * V21 派生指标接线修复后的实测诊断（2026-10-08）。
 *
 * 用当前生产形态（v21 知识库 + 知识输入打开 + 修复后的 packet 组装）跑真实
 * 模型，捕获首轮校验的完整 issue 明细（code/path/message）与首轮模型原文，
 * 用于定位修复后仍残留的 NUMBER_NOT_IN_CLAIMS / CLAIM_NOT_IN_DIMENSION。
 *
 * 用法：node --experimental-strip-types scripts/diagnose-v21-number-not-in-claims.ts [rideId]
 * 默认 demo-ride-2026-07-22。真实模型调用，约 0.1-0.3 元/次。
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
import { rideKnowledgeBaseV21, RIDE_KNOWLEDGE_BASE_V21_VERSION } from "../src/domain/ride-knowledge-base-v21.ts";
import { buildRideModelInputV2, type RideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import { buildRidePromptV2 } from "../src/ai/ride-prompt-v2.ts";
import { readRideModelProviderConfigV2, RideModelClientV2 } from "../src/ai/ride-model-provider-v2.ts";
import { validateRideModelOutputV2 } from "../src/ai/ride-output-validator-v2.ts";

const RIDE_ID = process.argv[2] ?? "demo-ride-2026-07-22";
const META = demoImportedRideMeta(RIDE_ID);
if (!META) {
  console.error(`未知演示记录: ${RIDE_ID}`);
  process.exit(1);
}
const FIT_PATH = join(process.cwd(), "test-data", "demo-imported-rides", META.fileName);
const OUT_DIR = join(process.cwd(), "output", "v21-diagnosis");

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
  } catch { /* 无 .env.local 时退回进程环境 */ }
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

async function buildInput(): Promise<RideModelInputV2> {
  const demos = await loadDemoImportedRides();
  const demo = demos.find((item) => item.rideId === RIDE_ID);
  if (!demo) throw new Error(`demo ride not found: ${RIDE_ID}`);
  const record = demo.record;
  const { ftpWatts, maxHeartRateBpm } = await extractProfileFromFit(FIT_PATH);
  const profile = createUserProfile({ age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm, ftpWatts });
  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: "run-diagnosis",
    userScope: "user-diagnosis",
  });
  // V2.1 生产形态：v21 知识库 + 知识输入打开（与 service 一致）。
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: rideKnowledgeBaseV21,
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_V21_VERSION,
    retrievedAt: "2026-10-08T00:00:00.000Z",
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: "run-diagnosis", userScope: "user-diagnosis" });
  if (result.status !== "ready") throw new Error(`input blocked: ${result.failureCode}`);
  return result.input;
}

function parseModelJsonText(rawText: string): unknown {
  try { return JSON.parse(rawText); } catch { /* fall through */ }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { return undefined; } }
  return undefined;
}

async function main(): Promise<void> {
  const env = await loadEnv();
  const config = readRideModelProviderConfigV2(env);
  if (!config) { console.error("未找到 SILICONFLOW_API_TOKEN"); process.exit(1); }
  const client = new RideModelClientV2(config);
  const input = await buildInput();
  const prompt = buildRidePromptV2(input);

  console.log(`输入规模：claims=${input.claims.length}, knowledge=${input.knowledge.length}, questions=${input.questions.length}`);
  console.log(`模型: ${config.modelId} | temperature 0.3 | enable_thinking false`);
  console.log("");

  const first = await client.run({
    analysisRunId: "run-diagnosis",
    requestId: `diag-v21-${RIDE_ID}`,
    promptText: prompt.promptText,
    promptVersion: prompt.promptVersion,
    jsonMode: true,
  });
  const firstParsed = parseModelJsonText(first.rawText);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, `${RIDE_ID}-first-output.txt`), first.rawText, "utf8");

  if (firstParsed === undefined) {
    console.log("首轮输出不是可解析 JSON，原文已落盘 output/v21-diagnosis/");
    return;
  }
  const validation = validateRideModelOutputV2(input, firstParsed);
  if (validation.status === "pass") {
    console.log("首轮校验：PASS（修复后无 issue）");
    return;
  }
  console.log(`首轮校验：FAIL，共 ${validation.issues.length} 个 issue：`);
  for (const issue of validation.issues) {
    console.log(`  - ${issue.code} @ ${issue.path}`);
    console.log(`    ${issue.message}`);
  }
}

await main();
