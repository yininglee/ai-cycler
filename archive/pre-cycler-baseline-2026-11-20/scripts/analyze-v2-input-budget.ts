/**
 * 诊断 INPUT_BUDGET_EXCEEDED：加载本地状态里的上传骑行，
 * 走与生产一致的组装链（知识软关），强制大预算让组装完成，
 * 然后对完整序列化做体积归因（claim 家族、区段数、问题包大小、
 * 瘦身投影后的真实 prompt 体积）。
 *
 * 用法：node --experimental-strip-types scripts/analyze-v2-input-budget.ts <rideId>
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createUserProfile } from "../src/domain/user-profile.ts";
import { buildRideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import { buildRideTemporalWindowsV2 } from "../src/domain/ride-temporal-windows-v2.ts";
import { buildRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { buildRideAnalysisEvidencePacketsV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { attachRideKnowledgeEvidenceV2 } from "../src/domain/ride-analysis-knowledge-v2.ts";
import { buildRideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import { buildRidePromptV2 } from "../src/ai/ride-prompt-v2.ts";

const RIDE_ID = process.argv[2];
if (!RIDE_ID) {
  console.error("用法: node --experimental-strip-types scripts/analyze-v2-input-budget.ts <rideId>");
  process.exit(1);
}
const RUN = "run-budget-diagnosis";
const SCOPE = "user-budget-diagnosis";
const OUT_DIR = join(process.cwd(), "output", "v2-budget-diagnosis");

// 与生产一致的默认 Profile（演示口径：FTP 200 / 最大心率 200 / 体重 70）。
const profile = createUserProfile({ age: 32, heightCm: 175, weightKg: 70, maxHeartRateBpm: 200, ftpWatts: 200 });

async function main(): Promise<void> {
  const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
  const ride = state.rides?.[RIDE_ID];
  if (!ride?.record) throw new Error(`ride not found in local state: ${RIDE_ID}`);
  const record = ride.record;

  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: RUN,
    userScope: SCOPE,
  });
  // 与生产一致：知识软关（KNOWLEDGE_INPUT_ENABLED = false → 空知识库）。
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: [],
    knowledgeBaseVersion: "ride-kb-batch1-1.0.0",
    retrievedAt: "2026-10-07T00:00:00.000Z",
  });
  // 强制大预算让组装完成，才能做归因。
  const result = buildRideModelInputV2(knowledgeContext, {
    analysisRunId: RUN,
    userScope: SCOPE,
    maxInputCharacters: 10_000_000,
  });
  if (result.status !== "ready") throw new Error(`unexpected block: ${result.failureCode} ${result.reason}`);

  const input = result.input;
  const fullJson = JSON.stringify(input);
  const prompt = buildRidePromptV2(input);

  // ① 总量与真实成本
  console.log("== 总量 ==");
  console.log("完整序列化（预算门量的对象）:", fullJson.length, "字符（预算 160,000）");
  console.log("瘦身投影后 prompt（模型实际吃的）:", prompt.promptText.length, "字符");
  console.log("超预算倍数（完整 / 预算）:", (fullJson.length / 160_000).toFixed(2) + "x");
  console.log("投影后 / 预算:", (prompt.promptText.length / 160_000).toFixed(2) + "x");
  console.log("claim 总数:", input.claims.length, "| questions:", input.questions.length);

  // ② claim 家族归因（按 key 前缀分组）
  console.log("\n== claim 家族体积归因（完整序列化口径）==");
  const familyOf = (key: string): string => {
    if (key.startsWith("segment.cruise.")) return "segment.cruise（巡航段）";
    if (key.startsWith("segment.climb.")) return "segment.climb（爬坡段）";
    if (key.startsWith("segment.terrain.")) return "segment.terrain（地形段）";
    if (key.startsWith("relation.fixed.")) return "relation.fixed（固定窗口关系）";
    if (key.startsWith("power.zone.")) return "power.zone（功率区间）";
    if (key.startsWith("heartRate.zone.")) return "heartRate.zone（心率区间）";
    if (key.startsWith("cadence.zone.")) return "cadence.zone（踏频区间）";
    if (key.startsWith("power.")) return "power（功率）";
    if (key.startsWith("heartRate.")) return "heartRate（心率）";
    if (key.startsWith("cadence.")) return "cadence（踏频）";
    if (key.startsWith("speed.")) return "speed（速度）";
    if (key.startsWith("timing.")) return "timing（计时）";
    if (key.startsWith("stops.")) return "stops（停歇）";
    if (key.startsWith("elevation.") || key.startsWith("climb.")) return "elevation/climb（海拔爬升）";
    if (key.startsWith("terrain.")) return "terrain（地形距离）";
    if (key.startsWith("metric.")) return "metric（设备汇总）";
    if (key.startsWith("profile.")) return "profile（个人资料）";
    return key.split(".")[0] + "（其他）";
  };
  const families = new Map<string, { count: number; chars: number }>();
  for (const claim of input.claims) {
    const family = familyOf(claim.key);
    const size = JSON.stringify(claim).length;
    const entry = families.get(family) ?? { count: 0, chars: 0 };
    entry.count += 1;
    entry.chars += size;
    families.set(family, entry);
  }
  const claimChars = input.claims.reduce((sum, c) => sum + JSON.stringify(c).length, 0);
  console.log("claims 序列化合计:", claimChars, "字符（占完整", ((claimChars / fullJson.length) * 100).toFixed(1) + "%）");
  for (const [family, entry] of [...families.entries()].sort((a, b) => b[1].chars - a[1].chars)) {
    console.log(`  ${family}: ${entry.count} 条 / ${entry.chars} 字符（占 claims ${(entry.chars / claimChars * 100).toFixed(1)}%）`);
  }

  // ③ 区段数量
  const cruiseCount = input.claims.filter((c) => c.key.startsWith("segment.cruise.") && c.key.endsWith(".span")).length;
  const climbCount = input.claims.filter((c) => c.key.startsWith("segment.climb.") && c.key.endsWith(".span")).length;
  const terrainCount = input.claims.filter((c) => c.key.startsWith("segment.terrain.") && c.key.endsWith(".span")).length;
  console.log("\n== 区段数量 ==");
  console.log(`巡航段: ${cruiseCount} | 爬坡代表段: ${climbCount} | 地形段: ${terrainCount}`);
  console.log("聚合关系对:", input.inputStats.aggregatedRelationPairCount, "| 聚合窗口数:", input.inputStats.aggregatedRelationWindowCount);

  // ④ 问题包大小
  console.log("\n== 问题包大小（claimIds 引用数）==");
  for (const q of input.questions) {
    console.log(`  ${q.dimensionId}: ${q.claimIds.length} claimIds / ${JSON.stringify(q).length} 字符`);
  }

  // ⑤ 骑行基本形态
  const metrics = record.activity?.metrics ?? {};
  console.log("\n== 骑行形态 ==");
  console.log("metrics:", JSON.stringify({ distanceM: metrics.distanceM, movingTimeS: metrics.movingTimeS, elapsedTimeS: metrics.elapsedTimeS, elevationGainM: metrics.elevationGainM, avgPowerW: metrics.avgPowerW, avgHeartRateBpm: metrics.avgHeartRateBpm, avgCadenceRpm: metrics.avgCadenceRpm }));
  const sensors = Object.keys(record.activity?.sensorQuality ?? {});
  console.log("传感器:", sensors.join(", "), "| 序列点数:", record.series?.points?.length ?? "未知");

  // ⑥ 落盘供查看
  await mkdir(OUT_DIR, { recursive: true });
  const tag = RIDE_ID.slice(0, 24);
  await writeFile(join(OUT_DIR, `${tag}-input-full.json`), JSON.stringify(input, null, 2), "utf8");
  await writeFile(join(OUT_DIR, `${tag}-prompt.txt`), prompt.promptText, "utf8");
  console.log(`\n已落盘: output/v2-budget-diagnosis/${tag}-input-full.json 与 ${tag}-prompt.txt`);
}

await main();
