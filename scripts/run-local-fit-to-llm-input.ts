/**
 * 使用本项目已实现的功能，运行 L0→L6 数据处理，并输出"点击 AI 解读后输入大模型的内容"。
 * 不调用扣子工作流：只走到 L6 投影（ride_interp_input），即模型实际收到的输入。
 *
 * 用法：
 *   node --experimental-strip-types scripts/run-local-fit-to-llm-input.ts <ride.fit> [default|expanded] [weightKg]
 */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import FitParser from "fit-file-parser";

import { isRideParseError, parseRideRecord } from "../src/parsers/index.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import {
  buildRideAnalysisContext,
  validateRideAnalysisContext,
  type RideAnalysisContext,
} from "../src/domain/ride-analysis-context.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import {
  projectRideInterpretationInputV04Candidate,
  validateRideInterpretationInputV04Candidate,
  type RideInterpretationInputV04Candidate,
} from "../src/ai/ride-interpretation-input-v04-candidate.ts";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "L0-L6-运行产物");
const FIT_PATH = process.argv[2];
const MODE: "default" | "expanded" = process.argv[3] === "expanded" ? "expanded" : "default";
const WEIGHT_KG = process.argv[4] !== undefined ? Number(process.argv[4]) : undefined;

if (!FIT_PATH) {
  console.error("用法：node --experimental-strip-types scripts/run-local-fit-to-llm-input.ts <ride.fit> [default|expanded]");
  process.exitCode = 2;
} else {
  await main();
}

async function extractProfileFromFit(path: string): Promise<{ ftpWatts: number; maxHeartRateBpm: number }> {
  // FIT 的 zones_target 携带设备侧 FTP / 最大心率；本项目的解析器不消费该消息，
  // 这里直接用 fit-file-parser 读取，保证 profile 来自本文件数据而非硬编码。
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

async function main(): Promise<void> {
  const content = new Uint8Array(await readFile(FIT_PATH));
  const record = await parseRideRecord({
    rideId: "local-preview",
    fileName: basename(FIT_PATH),
    content,
  });
  if (isRideParseError(record)) {
    console.error(JSON.stringify({ code: record.code, message: record.message }, null, 2));
    process.exitCode = 1;
    return;
  }

  const { ftpWatts, maxHeartRateBpm } = await extractProfileFromFit(FIT_PATH);
  const profile = createUserProfile({
    ftpWatts,
    maxHeartRateBpm,
    weightKg: WEIGHT_KG,
  });

  const context: RideAnalysisContext = buildRideAnalysisContext(record, { profile });
  const contextValidation = validateRideAnalysisContext(context);
  const eligibility = buildAnalysisEligibility(context);
  const plan = buildRideInterpretationPlan(context, eligibility, MODE);
  const input = projectRideInterpretationInputV04Candidate(context, plan);
  if (!input) {
    console.error("L6 投影失败：无可用输入（可能无合格维度）");
    process.exitCode = 1;
    return;
  }
  const inputValidation = validateRideInterpretationInputV04Candidate(input);

  await writeOutputs({ record, context, contextValidation, eligibility, plan, input, inputValidation, ftpWatts, maxHeartRateBpm, weightKg: WEIGHT_KG });

  // 控制台速览
  console.log("=== L0–L6 运行完成（未调用扣子） ===");
  console.log(`rideId:            ${context.rideId}`);
  console.log(`源文件:            ${basename(FIT_PATH)}`);
  console.log(`profile:           ftp=${ftpWatts}W, maxHR=${maxHeartRateBpm}bpm, weight=${WEIGHT_KG !== undefined ? WEIGHT_KG + "kg" : "未提供"}`);
  console.log(`context 校验:      ${contextValidation.valid ? "valid" : "INVALID " + JSON.stringify(contextValidation.issues)}`);
  console.log(`eligibility:       ${eligibility.eligible ? "eligible" : eligibility.status} | 维度=${eligibility.allowedDimensionKeys.join(",")}`);
  console.log(`mode:              ${MODE}`);
  console.log(`eligibleDimensionIds: ${plan.eligibleDimensionIds.join(", ")}`);
  console.log(`focus(默认≤3):    ${plan.focusDimensionIds.join(", ")}`);
  console.log(`exclusions:        ${plan.exclusions.map((e) => `${e.dimensionId}:${e.reason}`).join("; ")}`);
  console.log(`candidateClaims:   ${input.candidateClaims.length} (fact/perf/cap/limitation)`);
  console.log(`allowedClaims(投影): ${input.allowedClaims.length} / 上下文总 ${context.allowedClaims.length}`);
  console.log(`visualRegistry:    ${input.visualRegistry.map((v) => v.visualId).join(", ")}`);
  console.log(`input 校验:        ${inputValidation.valid ? "valid" : "INVALID " + JSON.stringify(inputValidation.issues)}`);
  console.log(`\n产物目录: ${OUT_DIR}`);
  console.log(`  - ride_interp_input.json   (即模型收到的 ride_interp_input 载荷)`);
  console.log(`  - LLM_INPUT.md             (系统提示词 + 用户输入，最终送大模型的内容)`);
  console.log(`  - pipeline-trace.json      (L0–L6 中间产物，可追溯)`);
  console.log(`  - summary.md               (各层摘要)`);
}

async function writeOutputs(args: {
  record: { activity: { metrics: Record<string, unknown>; rideId: string; source: { fileName?: string } }; series: { points: unknown[]; meta?: Record<string, unknown> } };
  context: RideAnalysisContext;
  contextValidation: { valid: boolean; issues: unknown[] };
  eligibility: ReturnType<typeof buildAnalysisEligibility>;
  plan: ReturnType<typeof buildRideInterpretationPlan>;
  input: RideInterpretationInputV04Candidate;
  inputValidation: { valid: boolean; issues: string[] };
  ftpWatts: number;
  maxHeartRateBpm: number;
  weightKg?: number;
}): Promise<void> {
  const { record, context, contextValidation, eligibility, plan, input, inputValidation, ftpWatts, maxHeartRateBpm, weightKg } = args;
  const { mkdir, writeFile } = await import("node:fs/promises");

  await mkdir(OUT_DIR, { recursive: true });

  const metrics = record.activity.metrics as Record<string, { value: number; unit: string; displayValue?: string; displayUnit?: string }>;

  const trace = {
    L0_raw_input: {
      rideId: record.activity.rideId,
      source: record.activity.source,
      startTime: (record.activity as { startTime?: string }).startTime,
      recordCount: record.series.points.length,
      sessionMetrics: Object.fromEntries(
        Object.entries(metrics).map(([k, m]) => [k, { value: m.value, unit: m.unit }]),
      ),
    },
    L1_series: {
      pointCount: record.series.points.length,
      meta: record.series.meta ?? {},
    },
    L2_deterministic_metrics: {
      recordedMetrics: Object.keys(context.recordedMetrics),
      derivedMetrics: Object.keys(context.derivedMetrics),
      estimatedMetrics: Object.keys(context.estimatedMetrics),
      featureCount: context.featureSnapshot.features.length,
      featureKeys: context.featureSnapshot.features.map((f) => f.key),
    },
    L3_quality_and_eligibility: {
      eligibility: {
        eligible: eligibility.eligible,
        status: eligibility.status,
        reasonCodes: eligibility.reasonCodes,
        allowedDimensionKeys: eligibility.allowedDimensionKeys,
        insightSources: eligibility.insightSources,
      },
      contextLimitations: context.limitations,
      privacyFlags: context.privacyFlags,
      safetyFlags: context.safetyFlags,
    },
    L4_features_and_relations: {
      features: context.featureSnapshot.features.map((f) => ({
        claimId: f.claimId,
        key: f.key,
        value: f.value,
        unit: f.unit,
        displayValue: (f as { displayValue?: string }).displayValue,
        displayUnit: (f as { displayUnit?: string }).displayUnit,
        confidence: f.confidence,
      })),
      unavailable: context.featureSnapshot.unavailable,
    },
    L5_atomic_claims_source: {
      allowedClaimCount: context.allowedClaims.length,
      byKind: context.allowedClaims.reduce<Record<string, number>>((acc, c) => {
        acc[c.kind] = (acc[c.kind] ?? 0) + 1;
        return acc;
      }, {}),
      claims: context.allowedClaims.map((c) => ({
        claimId: c.claimId,
        kind: c.kind,
        key: c.key,
        value: c.value,
        displayValue: c.displayValue,
        displayUnit: c.displayUnit,
        confidence: c.confidence,
      })),
    },
    L6_plan_and_candidate: {
      planVersion: plan.planVersion,
      mode: plan.mode,
      eligibleDimensionIds: plan.eligibleDimensionIds,
      focusDimensionIds: plan.focusDimensionIds,
      priorityScores: plan.priorityScores,
      exclusions: plan.exclusions,
      dimensionAvailability: plan.candidate?.dimensionAvailability,
      candidateClaims: plan.candidate?.claims,
      visualRegistry: plan.candidate?.visualRegistry,
      overallAssessment: plan.candidate?.overallAssessment,
      dimensionInterpretations: plan.candidate?.dimensionInterpretations,
      limitations: plan.candidate?.limitations,
    },
    validations: {
      context: contextValidation,
      input: inputValidation,
    },
    profile: { ftpWatts, maxHeartRateBpm, weightKg: weightKg ?? "未提供" },
  };

  const inputPayload = input;

  await writeFile(join(OUT_DIR, "ride_interp_input.json"), JSON.stringify(inputPayload, null, 2), "utf8");
  await writeFile(join(OUT_DIR, "pipeline-trace.json"), JSON.stringify(trace, null, 2), "utf8");

  const systemPrompt = await extractSystemPrompt();
  const llmInputMd = buildLlmInputMarkdown(systemPrompt, inputPayload, {
    fileName: basename(FIT_PATH),
    ftpWatts,
    maxHeartRateBpm,
    weightKg,
    mode: MODE,
    eligibleDimensionIds: plan.eligibleDimensionIds,
    focusDimensionIds: plan.focusDimensionIds,
    exclusions: plan.exclusions,
  });
  await writeFile(join(OUT_DIR, "LLM_INPUT.md"), llmInputMd, "utf8");

  const summary = buildSummaryMd(args, inputPayload);
  await writeFile(join(OUT_DIR, "summary.md"), summary, "utf8");
}

async function extractSystemPrompt(): Promise<string> {
  const promptPath = join(ROOT, "prompts", "cycling-buddy-ride-interpretation-v0.4.14-candidate.md");
  const text = await readFile(promptPath, "utf8");
  const match = /```text\n([\s\S]*?)\n```/.exec(text);
  return match ? match[1]! : text;
}

function buildLlmInputMarkdown(
  systemPrompt: string,
  input: RideInterpretationInputV04Candidate,
  meta: {
    fileName: string;
    ftpWatts: number;
    maxHeartRateBpm: number;
    weightKg?: number;
    mode: string;
    eligibleDimensionIds: string[];
    focusDimensionIds: string[];
    exclusions: Array<{ dimensionId: string; reason: string }>;
  },
): string {
  const weightLine =
    meta.weightKg !== undefined
      ? `FTP=${meta.ftpWatts}W，最大心率=${meta.maxHeartRateBpm}bpm，体重=${meta.weightKg}kg（功体比已可用）`
      : `FTP=${meta.ftpWatts}W，最大心率=${meta.maxHeartRateBpm}bpm，体重=未提供（功体比不可用）`;
  return `# 点击「AI 解读」后输入大模型的内容（L0–L6 投影结果）

> 本文件由本项目已实现的 v0.4-candidate 离线管线生成，**未调用扣子工作流**。
> 模型收到的内容 = **系统提示词** + **用户输入**（用户输入里的 \`ride_interp_input\` 即下方 JSON）。
> 这正是扣子工作流配置里 \`ride_interp_input\`（变量 17）所承载的载荷。

## 运行参数
- 源文件：${meta.fileName}
- profile（FTP/maxHR 取自本文件 zones_target，体重来自用户给定）：${weightLine}
- 解读模式：${meta.mode}（default 模式最多 3 个重点维度）
- 合格维度：${meta.eligibleDimensionIds.join(", ")}
- 重点维度（focus）：${meta.focusDimensionIds.join(", ")}
- 排除：${meta.exclusions.map((e) => `${e.dimensionId}:${e.reason}`).join("；")}

---

## 一、系统提示词（System Prompt / 表达层约束）

\`\`\`text
${systemPrompt}
\`\`\`

---

## 二、用户输入（User Message / 运行时合同）

扣子工作流把以下模板中的 \`{{ride_interp_input}}\` 替换为下方 JSON 后发送：

\`\`\`text
请根据以下运行时合同生成本次骑后解读。

<ride_interp_input>
{{ride_interp_input}}
</ride_interp_input>

<repair_instruction>
{{repair_instruction}}
</repair_instruction>

<previous_output>
{{previous_output}}
</previous_output>
\`\`\`

### ride_interp_input（= 模型实际收到的结构化事实与计划）

\`\`\`json
${JSON.stringify(input, null, 2)}
\`\`\`

---

## 说明
- 模型**只**依据上面的 \`ride_interp_input\` 生成解读；不得重算数字、不得引用未选维度/历史/坐标/文件名。
- 系统提示词与输入合同均为冻结的 v0.4-candidate 离线资产，线上 Coze 迁移尚未启动。
`;
}

function buildSummaryMd(
  args: Parameters<typeof writeOutputs>[0],
  _input: RideInterpretationInputV04Candidate,
): string {
  const { record, context, eligibility, plan, input, ftpWatts, maxHeartRateBpm, weightKg } = args;
  const metrics = record.activity.metrics as Record<string, { value: number; unit: string; displayValue?: string; displayUnit?: string }>;
  const dimLines = plan.eligibleDimensionIds
    .map((d) => {
      const av = plan.candidate?.dimensionAvailability[d] ?? "hidden";
      const score = plan.priorityScores[d] ?? 0;
      const focus = plan.focusDimensionIds.includes(d) ? "★重点" : "";
      return `- \`${d}\`：可用性=${av}，优先级=${score} ${focus}`;
    })
    .join("\n");
  const claimLines = context.allowedClaims
    .map((c) => `- \`${c.claimId}\` [${c.kind}] ${c.key}${c.displayValue ? ` = ${c.displayValue}${c.displayUnit ?? ""}` : ""} (conf=${c.confidence})`)
    .join("\n");

  return `# L0–L6 数据处理过程摘要

源文件：\`${basename(FIT_PATH)}\`（rideId=\`local-preview\`）
profile：FTP=${ftpWatts}W，maxHR=${maxHeartRateBpm}bpm，体重=${weightKg !== undefined ? weightKg + "kg" : "未提供"}

## L0 原始输入
- 解析器版本：${(record.activity.source as { parserVersion?: string }).parserVersion}
- 设备：${(record.activity.source as { deviceManufacturer?: string }).deviceManufacturer} / ${(record.activity.source as { deviceProduct?: string }).deviceProduct}
- 记录点数：${record.series.points.length}
- 关键会话指标：${Object.entries(metrics).map(([k, m]) => `${k}=${m.displayValue ?? m.value}${m.displayUnit ?? m.unit}`).join("，")}

## L1 标准化时序
- 已生成统一时间轴的 series（${record.series.points.length} 点），单位统一为 m / s / m·s⁻¹ / W / bpm / rpm。
- 隐私边界已应用：\`${context.privacyFlags.join(", ")}\`（轨迹/精确坐标/文件名均排除）。

## L2 确定性指标（版本化纯函数，模型不可重算）
- 已记录指标：${Object.keys(context.recordedMetrics).join(", ")}
- 派生指标：${Object.keys(context.derivedMetrics).join(", ") || "（无）"}
- 估算指标：${Object.keys(context.estimatedMetrics).join(", ") || "（无）"}
- 特征快照：${context.featureSnapshot.features.length} 条 feature（含功率/速度/海拔/爬坡/巡航/节奏稳定性等）

## L3 质量与解读门
- eligibility.eligible = ${eligibility.eligible}（status=${eligibility.status}）
- 开放维度（allowedDimensionKeys）：${eligibility.allowedDimensionKeys.join(", ")}
- 洞察来源：${eligibility.insightSources.join(", ")}
- 上下文限制/不可用：${context.limitations.join("；") || "（无）"}

## L4 分段/事件/关系特征
- 由确定性规则产生的 feature 与 advanced claim（见 pipeline-trace.json 的 L4/L5）。
- 本次无可比历史快照 => history_change 关闭（persistent_history_deferred）。

## L5 原子 Claim（源事实，逐条单一结论）
${claimLines}

## L6 解读计划（L7 输入投影）
- 模式：${plan.mode}
- 维度可用性 / 优先级：
${dimLines}
- 排除：${plan.exclusions.map((e) => `${e.dimensionId}:${e.reason}`).join("；")}
- 候选 Claim 数：${input.candidateClaims.length}
- 投影到模型的 allowedClaims：${input.allowedClaims.length}（已按焦点维度裁剪，小于上下文总数 ${context.allowedClaims.length}）
- 视觉注册：${input.visualRegistry.map((v) => `${v.visualId}(${v.type})`).join("，")}

## 最终送大模型的内容
见 \`LLM_INPUT.md\`（系统提示词 + 用户输入模板），模型实际载荷见 \`ride_interp_input.json\`。
`;
}
