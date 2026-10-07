/**
 * 导出 V2 骑后解读的「模型输入」样例（真实长骑行 demo-ride-*.fit）。
 * 与线上 /api/ride-analysis?ai=v2 走同一条解析 + 组装链路。
 * 产出四份对照文件：
 *   - input-full.json            完整货架（含全部追溯字段）
 *   - input-slim.json            精简投影（剥离模型用不上的追溯字段）
 *   - input-profile-claims.json  个人资料相关 Claim（从 input 单独挑出）
 *   - prompt.txt                 喂给模型的文字清单
 *
 * 用法：
 *   node --experimental-strip-types scripts/export-v2-model-input-sample.ts [demo-ride-2026-07-22|demo-ride-2026-08-20]
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
import { rideKnowledgeBaseBatch1V2, RIDE_KNOWLEDGE_BASE_BATCH1_VERSION } from "../src/domain/ride-knowledge-base-batch1-v2.ts";
import { buildRideModelInputV2, type RideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import { buildRidePromptV2 } from "../src/ai/ride-prompt-v2.ts";

const RIDE_ID = process.argv[2] ?? "demo-ride-2026-07-22";
const META = demoImportedRideMeta(RIDE_ID);
if (!META) {
  console.error(`未知演示记录: ${RIDE_ID}（可选 demo-ride-2026-07-22 / demo-ride-2026-08-20）`);
  process.exit(1);
}
const FIT_PATH = join(process.cwd(), "test-data", "demo-imported-rides", META.fileName);
const RUN = "run-export-demo";
const SCOPE = "user-demo";
// 演示用完整个人资料（真实线上来自会话 Profile）。
// 注：age / heightCm 当前不生成任何输入 Claim（见正文说明），仅为完整展示而填。
const WEIGHT_KG = 70;
const AGE = 32;
const HEIGHT_CM = 175;
const OUT_DIR = join(process.cwd(), "output", `v2-input-sample-${RIDE_ID}`);

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

async function buildInput(): Promise<{ input: RideModelInputV2; ftpWatts: number; maxHeartRateBpm: number }> {
  const demos = await loadDemoImportedRides();
  const demo = demos.find((item) => item.rideId === RIDE_ID);
  if (!demo) throw new Error(`demo ride not found: ${RIDE_ID}`);
  const record = demo.record;
  const { ftpWatts, maxHeartRateBpm } = await extractProfileFromFit(FIT_PATH);
  const profile = createUserProfile({
    age: AGE,
    heightCm: HEIGHT_CM,
    weightKg: WEIGHT_KG,
    maxHeartRateBpm,
    ftpWatts,
  });

  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: RUN,
    userScope: SCOPE,
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: rideKnowledgeBaseBatch1V2,
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
    retrievedAt: "2026-10-06T00:00:00.000Z",
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: RUN, userScope: SCOPE });
  if (result.status !== "ready") {
    throw new Error(`input blocked: ${result.failureCode} ${result.reason}`);
  }
  return { input: result.input, ftpWatts, maxHeartRateBpm };
}

// 精简投影（仅演示用，不修改生产代码）：剥离模型用不上的追溯/元数据字段。
function slimProject(input: RideModelInputV2): unknown {
  return {
    claims: input.claims.map((c) => ({
      claimId: c.claimId,
      kind: c.kind,
      value: c.value,
      unit: c.unit,
      text: c.text,
      confidence: c.confidence,
      qualityStatus: c.qualityStatus,
      displayValue: c.displayValue,
      displayUnit: c.displayUnit,
      supports: c.supports,
      prohibits: c.prohibits,
    })),
    knowledge: input.knowledge.map((k) => ({
      knowledgeId: k.knowledgeId,
      citation: k.citation,
      explanation: k.explanation,
      conditions: k.conditions,
      conclusionStrength: k.conclusionStrength,
      limitations: k.limitations,
      safetyBoundaries: k.safetyBoundaries,
      forbiddenFactKeys: k.forbiddenFactKeys,
    })),
    questions: input.questions,
  };
}

// 个人资料相关 Claim 判定：直接来自 profile 字段（profile.*），
// 或依赖 profile 计算的派生 Claim（功体比、强度因子、功率/心率区间）。
function isProfileRelated(key: string): boolean {
  return key.startsWith("profile.")
    || key === "power.normalizedWkg"
    || key === "power.intensityFactor"
    || key.startsWith("power.zone.")
    || key.startsWith("heartRate.zone.");
}

async function main(): Promise<void> {
  const { input, ftpWatts, maxHeartRateBpm } = await buildInput();
  const prompt = buildRidePromptV2(input);

  const fullJson = JSON.stringify(input, null, 2);
  const slimJson = JSON.stringify(slimProject(input), null, 2);
  const fullCompact = JSON.stringify(input);
  const slimCompact = JSON.stringify(slimProject(input));

  const profileClaims = input.claims.filter((c) => isProfileRelated(c.key));
  const profileClaimsJson = JSON.stringify(
    {
      note: "个人资料相关的 Claim（来自 FTP / 最大心率 / 体重；年龄与身高当前不生成 Claim）",
      profileFields: { ftpWatts, maxHeartRateBpm, weightKg: WEIGHT_KG, age: AGE, heightCm: HEIGHT_CM },
      count: profileClaims.length,
      claims: profileClaims,
    },
    null,
    2,
  );

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "input-full.json"), fullJson, "utf8");
  await writeFile(join(OUT_DIR, "input-slim.json"), slimJson, "utf8");
  await writeFile(join(OUT_DIR, "input-profile-claims.json"), profileClaimsJson, "utf8");
  await writeFile(join(OUT_DIR, "prompt.txt"), prompt.promptText, "utf8");

  const stats = {
    rideId: RIDE_ID,
    profile: { ftpWatts, maxHeartRateBpm, weightKg: WEIGHT_KG, age: AGE, heightCm: HEIGHT_CM },
    claims: input.claims.length,
    profileRelatedClaims: profileClaims.length,
    knowledge: input.knowledge.length,
    questions: input.questions.length,
    fullCharacters: fullCompact.length,
    slimCharacters: slimCompact.length,
    savedCharacters: fullCompact.length - slimCompact.length,
    savedPercent: ((1 - slimCompact.length / fullCompact.length) * 100).toFixed(1),
    promptTotalCharacters: prompt.promptText.length,
  };
  console.log(JSON.stringify(stats, null, 2));
}

await main();
