/**
 * EVAL-V21-R01：REPAIR_FAILED 失败率量化（2026-10-08）。
 *
 * 4 条样例 × 5 次 = 20 次真实模型调用，走完整生产链路（与
 * runRideInterpretationV2 / app/api/ride-analysis?engine=v2 完全一致）：
 *   首轮调用 → 独立校验（记录 issue 全文 + 违规断言原文）
 *   → orchestrateRideOutputValidationV2（确定性收敛 → 至多一次模型修复 → 全量重验）
 *   → firstPass / deterministicRepairPass / modelRepairPass / REPAIR_FAILED。
 *
 * 诊断留痕（每次调用立即落盘，支持断点续跑）：
 *   output/v21-eval/EVAL-V21-R01-20261008/raw/<rideId>-run<k>.json
 *   output/v21-eval/EVAL-V21-R01-20261008/raw/<rideId>-run<k>-first-output.txt
 * 汇总：--report 重新生成 summary.json + report.md。
 *
 * 用法：
 *   node --experimental-strip-types scripts/eval-v21-repair-failure-rate.ts [rideId]
 *   node --experimental-strip-types scripts/eval-v21-repair-failure-rate.ts --report
 * 真实模型调用，约 0.1–0.3 元/次。
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { createUserProfile } from "../src/domain/user-profile.ts";
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
import { readRideModelProviderConfigV2, RideModelClientV2, type RideModelCallRecordV2 } from "../src/ai/ride-model-provider-v2.ts";
import { validateRideModelOutputV2 } from "../src/ai/ride-output-validator-v2.ts";
import { orchestrateRideOutputValidationV2 } from "../src/ai/ride-output-repair-v2.ts";

const RUN_ID = "EVAL-V21-R01-20261008";
const OUT_DIR = join(process.cwd(), "output", "v21-eval", RUN_ID);
const RAW_DIR = join(OUT_DIR, "raw");
const REPEATS = 5;

const RIDE_IDS = [
  "demo-ride-2026-07-22", // 长骑行全传感器：派生指标全量供给压力
  "demo-ride-2026-08-20", // 通勤缺功率：limitation 回填路径
  "upload-0312e501-02d6-4a02-bba1-c05d4e35cff5",
  "upload-07971de0-6774-431b-8eca-2512f89c5791",
] as const;

const SAMPLE_LABELS: Record<string, string> = {
  "demo-ride-2026-07-22": "长骑行全传感器",
  "demo-ride-2026-08-20": "通勤缺功率",
  "upload-0312e501-02d6-4a02-bba1-c05d4e35cff5": "真实上传 A",
  "upload-07971de0-6774-431b-8eca-2512f89c5791": "真实上传 B",
};

// V2.1 归因标签（测评方案 §5）
function attributeTag(code: string, path: string, message: string): string {
  if (code === "NUMBER_NOT_IN_CLAIMS") {
    if (/variabilityIndex|efficiencyFactor|split|negativeSplit|vam|curve|wkg|decoupl|relativeStress|tss|intensityFactor|stoppedTime/i.test(message + path)) return "derived-unbound";
    if (/knowledge/i.test(message)) return "knowledge-range";
    return "number-unbound";
  }
  if (code === "CLAIM_NOT_IN_DIMENSION") {
    if (/variabilityIndex|efficiencyFactor|averageWkg|relativePower/i.test(message + path)) return "cross-dimension";
    return "cross-dimension";
  }
  if (code === "KNOWLEDGE_NOT_IN_DIMENSION" || code === "KNOWLEDGE_NOT_IN_INPUT" || code === "KNOWLEDGE_REFERENCE_WITHOUT_KNOWLEDGE") return "knowledge-structure";
  if (/^STABILITY_|^HISTORY_|^RECOVERY_|^PLAN_/.test(code)) return "expression-gate";
  if (code === "FACT_WITHOUT_CLAIM" || code === "CONCLUSION_TYPE_INVALID") return "structure";
  if (/FIELD_MISSING|OUTPUT_NOT_JSON|JSON/.test(code)) return "structure";
  if (/TIMEOUT|PROVIDER|RATE/.test(code)) return "provider";
  return "other";
}

// 按 issue.path 从输出对象提取违规断言原文（诊断用）
function excerptAt(output: unknown, path: string): string | undefined {
  const segments = path.match(/[^[.\]]+/g) ?? [];
  let current: unknown = output;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (typeof current === "object") current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  if (typeof current === "string") return current.slice(0, 200);
  if (current && typeof current === "object" && typeof (current as Record<string, unknown>).text === "string") {
    return ((current as Record<string, unknown>).text as string).slice(0, 200);
  }
  return undefined;
}

function parseModelJsonText(rawText: string): unknown {
  try { return JSON.parse(rawText); } catch { /* fall through */ }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { return undefined; } }
  return undefined;
}

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

interface StoredProfile {
  age?: { value?: number };
  maxHeartRate?: { valueBpm?: number };
  heightCm?: { value?: number };
  weightKg?: { value?: number };
  ftp?: { valueWatts?: number };
}

async function loadRecordAndProfile(rideId: string): Promise<{ record: unknown; profile: ReturnType<typeof createUserProfile> }> {
  // demo 骑行从 fixtures；upload 骑行从 .local-data（与生产 getRideRepository 同源）。
  if (rideId.startsWith("demo-ride-")) {
    const demos = await loadDemoImportedRides();
    const demo = demos.find((item) => item.rideId === rideId);
    if (!demo) throw new Error(`demo ride not found: ${rideId}`);
    const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
    return { record: demo.record, profile: profileFromState(state) };
  }
  const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
  const entry = (state.rides as Record<string, { record?: unknown }> | undefined)?.[rideId];
  if (!entry?.record) throw new Error(`uploaded ride not found in .local-data: ${rideId}`);
  return { record: entry.record, profile: profileFromState(state) };
}

function profileFromState(state: { profiles?: Record<string, StoredProfile> }): ReturnType<typeof createUserProfile> {
  const stored = state.profiles?.[Object.keys(state.profiles ?? {})[0]];
  if (!stored) throw new Error("no profile in .local-data");
  return createUserProfile({
    age: stored.age?.value ?? 30,
    heightCm: stored.heightCm?.value ?? 172,
    weightKg: stored.weightKg?.value ?? 70,
    maxHeartRateBpm: stored.maxHeartRate?.valueBpm ?? 190,
    ftpWatts: stored.ftp?.valueWatts ?? 200,
  });
}

function buildInput(record: unknown, profile: ReturnType<typeof createUserProfile>, rideId: string): RideModelInputV2 {
  const elevationSummary = buildRideElevationSummary(record as never);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record as never);
  const windows = buildRideTemporalWindowsV2(record as never, { climbs: eventClimbs, routeShape });
  const profileHistory = buildRideProfileHistoryV2(record as never, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: `eval-${RUN_ID}`,
    userScope: "eval-v21",
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: rideKnowledgeBaseV21,
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_V21_VERSION,
    retrievedAt: new Date().toISOString(),
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: `eval-${RUN_ID}`, userScope: "eval-v21" });
  if (result.status !== "ready") throw new Error(`[${rideId}] input blocked: ${result.failureCode}`);
  return result.input;
}

interface RunOutcome {
  rideId: string;
  runIndex: number;
  startedAt: string;
  status: "firstPass" | "deterministicRepairPass" | "modelRepairPass" | "repairFailed" | "providerError";
  fallbackCode?: string;
  failureCodes?: string[];
  firstRound: {
    parseOk: boolean;
    issueCount: number;
    issues: Array<{ code: string; path: string; message: string; excerpt?: string; tag: string }>;
  };
  orchestration: {
    steps: Array<{ step: string; detail: string }>;
    modelRepairCalls: number;
    fallbackReason?: string;
  };
  callRecords: Array<{ latencyMs: number; usage?: unknown; errorCode?: string }>;
}

async function runOnce(
  client: RideModelClientV2,
  rideId: string,
  runIndex: number,
): Promise<RunOutcome> {
  const startedAt = new Date().toISOString();
  const { record, profile } = await loadRecordAndProfile(rideId);
  const input = buildInput(record, profile, rideId);
  const prompt = buildRidePromptV2(input);
  const callRecords: Array<{ latencyMs: number; usage?: unknown; errorCode?: string }> = [];

  const first = await client.run({
    analysisRunId: `eval-${RUN_ID}`,
    requestId: `${RUN_ID}-${rideId}-run${runIndex}`,
    promptText: prompt.promptText,
    promptVersion: prompt.promptVersion,
    jsonMode: true,
  });
  if (first.callRecord) {
    callRecords.push({ latencyMs: first.callRecord.latencyMs, usage: first.callRecord.usage, errorCode: first.callRecord.errorCode });
  }
  await writeFile(join(RAW_DIR, `${rideId}-run${runIndex}-first-output.txt`), first.rawText, "utf8");

  const firstParsed = parseModelJsonText(first.rawText);
  const firstIssues = firstParsed === undefined
    ? [{ code: "OUTPUT_NOT_JSON", path: "$", message: "first-round output is not parseable JSON", excerpt: undefined, tag: attributeTag("OUTPUT_NOT_JSON", "$", "") }]
    : (validateRideModelOutputV2(input, firstParsed).status === "pass" ? [] : validateRideModelOutputV2(input, firstParsed).status === "fail"
      ? (validateRideModelOutputV2(input, firstParsed) as { status: "fail"; issues: Array<{ code: string; path: string; message: string }> }).issues.map((issue) => ({
        ...issue,
        excerpt: excerptAt(firstParsed, issue.path),
        tag: attributeTag(issue.code, issue.path, issue.message),
      }))
      : []);

  const repairCallRecords: Array<{ latencyMs: number; usage?: unknown; errorCode?: string }> = [];
  const repairCaller = firstParsed === undefined ? undefined : async (call: { promptText: string; promptVersion: string; requestId: string }) => {
    const result = await client.run({
      analysisRunId: `eval-${RUN_ID}`,
      requestId: call.requestId,
      promptText: call.promptText,
      promptVersion: call.promptVersion,
      jsonMode: true,
    });
    if (result.callRecord) {
      repairCallRecords.push({ latencyMs: result.callRecord.latencyMs, usage: result.callRecord.usage, errorCode: result.callRecord.errorCode });
    }
    return { rawText: result.rawText };
  };

  let orchestration: Awaited<ReturnType<typeof orchestrateRideOutputValidationV2>> | undefined;
  let providerError: string | undefined;
  if (firstParsed !== undefined) {
    try {
      orchestration = await orchestrateRideOutputValidationV2({
        input,
        firstOutput: firstParsed,
        requestId: `${RUN_ID}-${rideId}-run${runIndex}`,
        ...(repairCaller ? { repairCaller } : {}),
      });
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    }
  }

  callRecords.push(...repairCallRecords);

  let status: RunOutcome["status"];
  let fallbackCode: string | undefined;
  let failureCodes: string[] | undefined;
  if (providerError) {
    status = "providerError";
    fallbackCode = providerError.slice(0, 120);
  } else if (!orchestration) {
    status = "repairFailed";
    fallbackCode = "FIRST_OUTPUT_UNPARSEABLE";
    failureCodes = ["OUTPUT_NOT_JSON"];
  } else if (orchestration.status === "pass") {
    status = orchestration.stage as "firstPass" | "deterministicRepairPass" | "modelRepairPass";
  } else {
    status = "repairFailed";
    fallbackCode = "REPAIR_FAILED";
    failureCodes = [...(orchestration.fallback?.failureCodes ?? [])];
  }

  return {
    rideId,
    runIndex,
    startedAt,
    status,
    ...(fallbackCode ? { fallbackCode } : {}),
    ...(failureCodes?.length ? { failureCodes } : {}),
    firstRound: {
      parseOk: firstParsed !== undefined,
      issueCount: firstIssues.length,
      issues: firstIssues,
    },
    orchestration: {
      steps: orchestration?.steps ?? [],
      modelRepairCalls: orchestration?.modelRepairCalls ?? 0,
      ...(orchestration?.fallback?.reason ? { fallbackReason: orchestration.fallback.reason } : {}),
    },
    callRecords,
  };
}

async function generateReport(): Promise<void> {
  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json") && !f.includes("-first-output"));
  const outcomes: RunOutcome[] = [];
  for (const file of files) {
    outcomes.push(JSON.parse(await readFile(join(RAW_DIR, file), "utf8")) as RunOutcome);
  }
  outcomes.sort((a, b) => a.rideId.localeCompare(b.rideId) || a.runIndex - b.runIndex);

  const statusCount: Record<string, number> = {};
  const perRide: Record<string, Record<string, number>> = {};
  const firstIssueTags: Record<string, number> = {};
  const finalFailureCodes: Record<string, number> = {};
  let totalFirstIssues = 0;
  for (const outcome of outcomes) {
    statusCount[outcome.status] = (statusCount[outcome.status] ?? 0) + 1;
    perRide[outcome.rideId] ??= {};
    perRide[outcome.rideId]![outcome.status] = (perRide[outcome.rideId]![outcome.status] ?? 0) + 1;
    for (const issue of outcome.firstRound.issues) {
      totalFirstIssues += 1;
      firstIssueTags[issue.tag] = (firstIssueTags[issue.tag] ?? 0) + 1;
    }
    for (const code of outcome.failureCodes ?? []) {
      finalFailureCodes[code] = (finalFailureCodes[code] ?? 0) + 1;
    }
  }
  const total = outcomes.length;
  const degraded = statusCount["repairFailed"] ?? 0;
  const summary = {
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    total,
    statusCount,
    finalDegradationRate: total ? degraded / total : 0,
    perRide,
    firstIssueTags,
    finalFailureCodes,
    totalFirstIssues,
  };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const lines: string[] = [];
  lines.push(`# ${RUN_ID} 失败率量化报告`);
  lines.push("");
  lines.push(`- 生成时间：${summary.generatedAt}`);
  lines.push(`- 总调用：${total} 次（${RIDE_IDS.length} 样例 × ${REPEATS} 次，实际落盘 ${total}）`);
  lines.push(`- **最终降级率（repairFailed）：${total ? (degraded / total * 100).toFixed(1) : 0}%**（${degraded}/${total}）——阈值三档：≤5% 良好 / 5–15% 定方案 / >15% STOP`);
  lines.push("");
  lines.push("## 状态分布");
  lines.push("");
  lines.push("| 状态 | 次数 | 占比 |");
  lines.push("|---|---:|---:|");
  for (const [status, count] of Object.entries(statusCount)) {
    lines.push(`| ${status} | ${count} | ${total ? (count / total * 100).toFixed(1) : 0}% |`);
  }
  lines.push("");
  lines.push("## 分样例");
  lines.push("");
  lines.push("| 样例 | firstPass | deterministicRepairPass | modelRepairPass | repairFailed | providerError |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const rideId of RIDE_IDS) {
    const counts = perRide[rideId] ?? {};
    lines.push(`| ${SAMPLE_LABELS[rideId] ?? rideId} | ${counts["firstPass"] ?? 0} | ${counts["deterministicRepairPass"] ?? 0} | ${counts["modelRepairPass"] ?? 0} | ${counts["repairFailed"] ?? 0} | ${counts["providerError"] ?? 0} |`);
  }
  lines.push("");
  lines.push(`## 首轮 issue 归因标签分布（共 ${totalFirstIssues} 条）`);
  lines.push("");
  lines.push("| 标签 | 次数 | 说明 |");
  lines.push("|---|---:|---|");
  const tagDescriptions: Record<string, string> = {
    "number-unbound": "写了数字未绑对应 claim",
    "derived-unbound": "派生指标数字未绑 claim（Prompt v2.8.1 引导目标）",
    "cross-dimension": "跨维度引用共享指标",
    "knowledge-range": "知识范围数字相关",
    "knowledge-structure": "知识引用结构问题",
    "expression-gate": "稳定/历史/恢复/计划表达门",
    structure: "结构/JSON 解析问题",
    provider: "供应商错误",
    other: "其他",
  };
  for (const [tag, count] of Object.entries(firstIssueTags).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${tag} | ${count} | ${tagDescriptions[tag] ?? ""} |`);
  }
  lines.push("");
  if (Object.keys(finalFailureCodes).length) {
    lines.push("## 最终降级的 failureCodes 分布");
    lines.push("");
    lines.push("| 错误码 | 次数 |");
    lines.push("|---|---:|");
    for (const [code, count] of Object.entries(finalFailureCodes).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${code} | ${count} |`);
    }
    lines.push("");
  }
  lines.push("## 逐次明细（失败与修复线索）");
  lines.push("");
  for (const outcome of outcomes) {
    const label = `${SAMPLE_LABELS[outcome.rideId] ?? outcome.rideId} #${outcome.runIndex + 1}`;
    if (outcome.status === "firstPass") {
      lines.push(`- ✅ ${label}: firstPass`);
      continue;
    }
    lines.push(`- ${outcome.status === "repairFailed" || outcome.status === "providerError" ? "❌" : "🔁"} ${label}: **${outcome.status}**${outcome.fallbackCode ? ` (${outcome.fallbackCode})` : ""}，首轮 issue ${outcome.firstRound.issueCount} 条`);
    const byTag: Record<string, number> = {};
    for (const issue of outcome.firstRound.issues) byTag[issue.tag] = (byTag[issue.tag] ?? 0) + 1;
    for (const [tag, count] of Object.entries(byTag)) lines.push(`  - ${tag} ×${count}`);
    for (const issue of outcome.firstRound.issues.slice(0, 6)) {
      lines.push(`  - \`${issue.code}\` @ ${issue.path}${issue.excerpt ? `："${issue.excerpt.slice(0, 80)}"` : ""}`);
    }
    if (outcome.firstRound.issues.length > 6) lines.push(`  - …共 ${outcome.firstRound.issues.length} 条`);
  }
  await writeFile(join(OUT_DIR, "report.md"), lines.join("\n"), "utf8");
  console.log(`报告已生成: ${join(OUT_DIR, "report.md")}`);
  console.log(`总调用 ${total}，最终降级率 ${(summary.finalDegradationRate * 100).toFixed(1)}%`);
}

async function main(): Promise<void> {
  if (process.argv[2] === "--report") {
    await generateReport();
    return;
  }
  const env = await loadEnv();
  const config = readRideModelProviderConfigV2(env);
  if (!config) { console.error("未找到 SILICONFLOW_API_TOKEN"); process.exit(1); }
  const client = new RideModelClientV2(config);
  await mkdir(RAW_DIR, { recursive: true });

  const targetRide = process.argv[2];
  const targets = targetRide ? [targetRide] : [...RIDE_IDS];
  for (const rideId of targets) {
    for (let runIndex = 0; runIndex < REPEATS; runIndex += 1) {
      const rawPath = join(RAW_DIR, `${rideId}-run${runIndex}.json`);
      if (existsSync(rawPath)) {
        console.log(`跳过（已完成）: ${rideId} run${runIndex}`);
        continue;
      }
      console.log(`[${new Date().toISOString()}] ${rideId} run${runIndex} 开始…`);
      try {
        const outcome = await runOnce(client, rideId, runIndex);
        await writeFile(rawPath, JSON.stringify(outcome, null, 2), "utf8");
        console.log(`  → ${outcome.status}${outcome.failureCodes?.length ? ` [${outcome.failureCodes.join(",")}]` : ""}（首轮 issue ${outcome.firstRound.issueCount}）`);
      } catch (error) {
        console.error(`  → 调用失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await generateReport();
}

await main();
