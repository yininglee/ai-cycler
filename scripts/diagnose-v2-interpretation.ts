/**
 * V2 骑后解读 REPAIR_FAILED 离线诊断（S2-07 Review 排查用，2026-10-07）。
 *
 * 同一份真实输入跑两个"臂"，其余条件完全一致（同模型、temperature 0.3、思考链随生产 provider——2026-10-07 起 PD-AI-23 对比实验开启，
 * 同校验器、同修复编排），唯一变量是首轮 prompt 的输入形态：
 *   A 臂 = 当前生产 prompt（v2.5.0 模型可见投影，剥离追溯字段）
 *   B 臂 = 旧版 prompt（全量 JSON.stringify(input)，v2.4.1 及之前的形态）
 *
 * 每臂输出：首轮模型原文、首轮校验的全部 issue（code/path/message）、
 * 修复编排结局（stage / fallback failureCodes）。
 *
 * 用法：node --experimental-strip-types scripts/diagnose-v2-interpretation.ts [rideId]
 * 默认 rideId = demo-ride-2026-08-20（最便宜）。真实模型调用，约 0.1-0.3 元。
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
import { readRideModelProviderConfigV2, RideModelClientV2 } from "../src/ai/ride-model-provider-v2.ts";
import { validateRideModelOutputV2 } from "../src/ai/ride-output-validator-v2.ts";
import { orchestrateRideOutputValidationV2 } from "../src/ai/ride-output-repair-v2.ts";

const RIDE_ID = process.argv[2] ?? "demo-ride-2026-08-20";
const META = demoImportedRideMeta(RIDE_ID);
if (!META) {
  console.error(`未知演示记录: ${RIDE_ID}`);
  process.exit(1);
}
const FIT_PATH = join(process.cwd(), "test-data", "demo-imported-rides", META.fileName);
const OUT_DIR = join(process.cwd(), "output", "v2-diagnosis");

// 与服务一致：演示场景补全 Profile（真实线上来自会话）。
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
  } catch {
    // 无 .env.local 时退回进程环境
  }
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
  const profile = createUserProfile({
    age: AGE, heightCm: HEIGHT_CM, weightKg: WEIGHT_KG, maxHeartRateBpm, ftpWatts,
  });
  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: "run-diagnosis",
    userScope: "user-diagnosis",
  });
  // PD-AI-25 知识库软关（2026-10-07）：与生产 service 一致，不附带知识条目。
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: [],
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
    retrievedAt: "2026-10-07T00:00:00.000Z",
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: "run-diagnosis", userScope: "user-diagnosis" });
  if (result.status !== "ready") throw new Error(`input blocked: ${result.failureCode}`);
  return result.input;
}

// 与服务内私有 parseModelJsonText 相同的逻辑。
function parseModelJsonText(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch { /* fall through */ }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { return undefined; }
  }
  return undefined;
}

interface ArmOutcome {
  arm: string;
  firstRoundIssues: { code: string; path: string; message: string }[] | "PASS";
  orchestrationStage: string;
  fallbackFailureCodes: string[] | undefined;
  modelCalls: number;
  latencyMsFirst: number;
}

async function runArm(
  label: string,
  promptText: string,
  promptVersion: string,
  input: RideModelInputV2,
  client: RideModelClientV2,
): Promise<{ outcome: ArmOutcome; rawFirst: string }> {
  const analysisRunId = "run-diagnosis";
  const started = Date.now();
  const first = await client.run({
    analysisRunId,
    requestId: `diag-${label}-first`,
    promptText,
    promptVersion,
    jsonMode: true,
  });
  const latencyMsFirst = Date.now() - started;
  let modelCalls = 1;
  const rawFirst = first.rawText;
  const firstParsed = parseModelJsonText(rawFirst);

  // 首轮直接校验，拿全量 issue 明细（生产链路只留 failureCodes，明细在这里看）。
  const firstValidation = firstParsed === undefined
    ? { status: "fail" as const, issues: [{ code: "FIELD_TYPE_INVALID", path: "$", message: "first-round output is not parseable JSON" }] }
    : validateRideModelOutputV2(input, firstParsed);

  const repairCaller = async (call: { analysisRunId: string; requestId: string; promptText: string; promptVersion: string }) => {
    modelCalls += 1;
    const result = await client.run({
      analysisRunId: call.analysisRunId,
      requestId: call.requestId,
      promptText: call.promptText,
      promptVersion: call.promptVersion,
      jsonMode: true,
    });
    return { rawText: result.rawText };
  };

  const orchestration = await orchestrateRideOutputValidationV2({
    input,
    firstOutput: firstParsed,
    requestId: `diag-${label}`,
    repairCaller,
    allowModelRepair: true,
  });

  return {
    outcome: {
      arm: label,
      firstRoundIssues: firstValidation.status === "pass" ? "PASS" : firstValidation.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })),
      orchestrationStage: orchestration.status === "fallback" ? `fallback(${orchestration.fallback?.reason})` : orchestration.stage,
      fallbackFailureCodes: orchestration.fallback?.failureCodes,
      modelCalls,
      latencyMsFirst,
    },
    rawFirst,
  };
}

async function main(): Promise<void> {
  const env = await loadEnv();
  const config = readRideModelProviderConfigV2(env);
  if (!config) {
    console.error("未找到 SILICONFLOW_API_TOKEN（.env.local），无法诊断。");
    process.exit(1);
  }
  const client = new RideModelClientV2(config);
  const input = await buildInput();

  const prompt = buildRidePromptV2(input);
  // B 臂：把投影段换回全量 JSON（v2.4.1 及之前的形态），指令与版本头保持一致。
  const marker = "【版本化输入 JSON】\n";
  const prefix = prompt.promptText.slice(0, prompt.promptText.indexOf(marker) + marker.length);
  const legacyPromptText = `${prefix}${JSON.stringify(input)}`;

  console.log(`输入规模：claims=${input.claims.length}, knowledge=${input.knowledge.length}, questions=${input.questions.length}`);
  console.log(`A 臂 prompt（投影）字符数: ${prompt.promptText.length}`);
  console.log("模型:", config.modelId, "| temperature 0.3 | enable_thinking false（生产锁定；PD-AI-23 思考链实验 2026-10-07 否决：8 次中 4 次卡满 300s 超时）");
  console.log("");

  await mkdir(OUT_DIR, { recursive: true });

  // 用法：node ... diagnose-v2-interpretation.ts <rideId> [--arm A|B|AB]
  // 默认只跑 A 臂（生产形态）——B 臂是 S2-07 输入压缩验收时的定责对照，已完成使命；
  // 现在排查模型侧问题（输出不稳定/思考链对比）不需要重复失败样本。
  const armArg = process.argv.find((arg) => arg.startsWith("--arm="));
  const arms = armArg ? armArg.split("=")[1]! : "A";

  console.log("=== A 臂：当前生产 prompt（模型可见投影） ===");
  const armA = await runArm("A-current", prompt.promptText, prompt.promptVersion, input, client);
  console.log(JSON.stringify(armA.outcome, null, 2));
  await writeFile(join(OUT_DIR, `${RIDE_ID}-armA-first-output.txt`), armA.rawFirst, "utf8");

  if (arms.toUpperCase().includes("B")) {
    console.log("");
    console.log("=== B 臂：旧版 prompt（全量 JSON 输入，S2-07 定责对照，默认不跑） ===");
    const armB = await runArm("B-legacy-full-json", legacyPromptText, "ride-prompt-v2.5.0+legacy-input", input, client);
    console.log(JSON.stringify(armB.outcome, null, 2));
    await writeFile(join(OUT_DIR, `${RIDE_ID}-armB-first-output.txt`), armB.rawFirst, "utf8");

    console.log("");
    console.log("=== 诊断结论判定 ===");
    const aFailed = armA.outcome.orchestrationStage.startsWith("fallback");
    const bFailed = armB.outcome.orchestrationStage.startsWith("fallback");
    if (aFailed && !bFailed) {
      console.log("A 臂失败、B 臂通过 → 高度指向 S2-07 瘦身投影影响模型输出质量");
    } else if (!aFailed && bFailed) {
      console.log("A 臂通过、B 臂失败 → 瘦身投影反而更好；失败与 S2-07 无关");
    } else if (aFailed && bFailed) {
      console.log("两臂都失败 → 与输入形态无关，指向模型输出不稳定或思考链的影响");
    } else {
      console.log("两臂都通过 → 本次复现未失败，属间歇性问题（与 2026-10-06 已记录的不稳定类别一致）");
    }
  }
}

await main();
