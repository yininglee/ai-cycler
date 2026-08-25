import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const EVAL_DIR = `${ROOT}/eval/human-review`;
const B2_RUN = JSON.parse(await readFile(`${ROOT}/eval/runs/RUN-20260824-367.json`, "utf8")) as {
  records: Array<{ caseId: string; repetition: number; runtimeResult: { source: string; output: Record<string, unknown> } }>;
};
const B0_RUN = JSON.parse(await readFile(`${ROOT}/eval/runs/RUN-20260824-028.json`, "utf8")) as {
  results: Array<{ caseId: string; context: Record<string, unknown>; b0: { output: Record<string, unknown> } }>;
};

function parseInput(caseId: string): Record<string, unknown> {
  const file = `${ROOT}/output/coze-inputs/t001-${caseId}.json`;
  const input = JSON.parse(readFileSync(file, "utf8")) as { analysis_context: string; analysis_elig: string };
  return {
    ...JSON.parse(input.analysis_context),
    eligibility: JSON.parse(input.analysis_elig),
  } as Record<string, unknown>;
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function claimMap(context: Record<string, unknown>): Map<string, string> {
  const claims = Array.isArray(context.allowedClaims) ? context.allowedClaims : [];
  const ids = claims.flatMap((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return [];
    const id = (claim as Record<string, unknown>).claimId;
    return typeof id === "string" ? [id] : [];
  });
  return new Map(ids.map((id, index) => [id, `claim-${String(index + 1).padStart(3, "0")}`]));
}

const CLAIM_DESCRIPTIONS: Record<string, string> = {
  distanceM: "本次骑行记录的总距离",
  movingTimeS: "本次骑行的移动时间",
  elevationGainM: "本次骑行累计爬升的高度",
  avgSpeedMps: "本次骑行的平均速度",
  activityEnergyKcal: "本次骑行记录的运动消耗值",
  maxHeartRateBpm: "本次骑行记录中的最高心率",
  avgHeartRateBpm: "本次骑行的平均心率",
  normalizedPowerW: "标准化功率，用于概括功率输出的加权水平",
  avgPowerW: "本次骑行的平均功率",
  maxCadenceRpm: "本次骑行记录中的最高踏频",
  avgCadenceRpm: "本次骑行的平均踏频",
  speedSeriesMeanMps: "速度序列的平均值",
  speedStdDevMps: "速度序列的标准差，表示速度波动幅度",
  speedCoefficientOfVariation: "速度变异系数，表示相对平均速度的波动程度",
  speedFirstLastDeltaMps: "结束阶段与开始阶段的速度差值",
  heartRateSeriesMeanBpm: "心率序列的平均值",
  heartRateStdDevBpm: "心率序列的标准差，表示心率波动幅度",
  heartRateFirstLastDeltaBpm: "结束阶段与开始阶段的心率差值",
  powerSeriesMeanW: "功率序列的平均值",
  powerStdDevW: "功率序列的标准差，表示功率波动幅度",
  powerCoefficientOfVariation: "功率变异系数，表示相对平均功率的波动程度",
  powerFirstLastDeltaW: "结束阶段与开始阶段的功率差值",
  normalizedPowerRatio: "标准化功率与平均功率的比值",
  cadenceSeriesMeanRpm: "踏频序列的平均值",
  cadenceStdDevRpm: "踏频序列的标准差，表示踏频波动幅度",
  cadenceCoefficientOfVariation: "踏频变异系数，表示相对平均踏频的波动程度",
  cadenceFirstLastDeltaRpm: "结束阶段与开始阶段的踏频差值",
  elevationPositiveGainM: "根据海拔序列计算的累计爬升",
  elevationMinM: "海拔序列中的最低海拔",
  elevationMaxM: "海拔序列中的最高海拔",
  elevationRangeM: "海拔序列的最高与最低海拔之差",
};

function replaceClaims(value: unknown, mapping: Map<string, string>): unknown {
  if (typeof value === "string") return mapping.get(value) ?? value.replace(/^claim:[^:]+:/, "claim-anon:");
  if (Array.isArray(value)) return value.map((item) => replaceClaims(item, mapping));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, replaceClaims(nested, mapping)]));
}

function evidence(context: Record<string, unknown>, mapping: Map<string, string>): Record<string, unknown> {
  const allowedClaims = Array.isArray(context.allowedClaims) ? context.allowedClaims : [];
  const safeClaims = allowedClaims.map((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return claim;
    const item = claim as Record<string, unknown>;
    return {
      claimId: mapping.get(String(item.claimId)) ?? "claim-anon",
      kind: item.kind,
      key: item.key,
      description: CLAIM_DESCRIPTIONS[String(item.key)] ?? "该证据字段在本次骑行中的记录或计算结果",
      value: item.value,
      unit: item.unit,
      displayValue: item.displayValue,
      displayUnit: item.displayUnit,
      provenance: item.provenance,
      confidence: item.confidence,
    };
  });
  const capabilities = Array.isArray(context.capabilities)
    ? context.capabilities.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const value = item as Record<string, unknown>;
      return { key: value.key, available: value.available, qualityStatus: value.qualityStatus, unavailableReason: value.unavailableReason };
    })
    : [];
  return {
    allowedClaims: safeClaims,
    capabilities,
    allowedDimensionKeys: context.eligibility && typeof context.eligibility === "object"
      ? (context.eligibility as Record<string, unknown>).allowedDimensionKeys ?? []
      : [],
    profileFacts: context.profileFacts ?? {},
    historicalComparison: context.historicalComparison ?? null,
    limitations: context.limitations ?? [],
  };
}

function normalizeOutput(output: Record<string, unknown>): Record<string, unknown> {
  const overall = output.overallAssessment;
  const dimensions = Array.isArray(output.dimensions) ? output.dimensions : [];
  const highlights = Array.isArray(output.highlights) ? output.highlights : [];
  return {
    headline: typeof output.headline === "string" ? output.headline : typeof output.summary === "string" ? output.summary : "",
    overallAssessment: overall && typeof overall === "object"
      ? overall
      : { text: typeof output.summary === "string" ? output.summary : "", claimIds: [] },
    dimensions: dimensions.length > 0 ? dimensions : highlights.map((item) => ({ key: "fact", ...(item as Record<string, unknown>) })),
    limitations: output.limitations ?? [],
    nextAction: output.nextAction ?? null,
    notableEvents: output.notableEvents ?? [],
    safetyLevel: output.safetyLevel ?? "normal",
    shareCopy: output.shareCopy ?? [],
  };
}

function makeItem(itemId: string, context: Record<string, unknown>, output: Record<string, unknown>, sourceKey: string, pairKey?: string) {
  const mapping = claimMap(context);
  return {
    itemId,
    evidence: evidence(context, mapping),
    output: replaceClaims(normalizeOutput(output), mapping),
    _key: { sourceKey, pairKey: pairKey ?? null },
  };
}

const b2Records = B2_RUN.records.filter((record) => record.runtimeResult.source === "b2");
const b2Cases = new Set(b2Records.map((record) => record.caseId));
const pairedCases = [...b2Cases].sort().slice(0, 10);
const b0ByCase = new Map(B0_RUN.results.map((result) => [result.caseId, result]));
const entries: Array<Record<string, unknown>> = [];
const key: Array<Record<string, unknown>> = [];
let sequence = 1;
for (const record of b2Records) {
  const context = parseInput(record.caseId);
  const itemId = `ITEM-${String(sequence++).padStart(3, "0")}`;
  entries.push(makeItem(itemId, context, record.runtimeResult.output, `b2:${record.caseId}:${record.repetition}`, pairedCases.includes(record.caseId) ? record.caseId : undefined));
  key.push({ itemId, source: "B2", caseId: record.caseId, repetition: record.repetition, pairKey: pairedCases.includes(record.caseId) ? record.caseId : null });
}
for (const caseId of pairedCases) {
  const result = b0ByCase.get(caseId);
  if (!result) throw new Error(`Missing B0 result for ${caseId}`);
  const context = parseInput(caseId);
  const itemId = `ITEM-${String(sequence++).padStart(3, "0")}`;
  entries.push(makeItem(itemId, context, result.b0.output, `b0:${caseId}`, caseId));
  key.push({ itemId, source: "B0", caseId, repetition: null, pairKey: caseId });
}

function orderedFor(reviewer: string): Array<Record<string, unknown>> {
  return [...entries].sort((a, b) => stableId(`${reviewer}:${String(a.itemId)}`).localeCompare(stableId(`${reviewer}:${String(b.itemId)}`)))
    .map(({ _key: _hidden, ...item }) => item);
}

const instructions = {
  presentationVersion: "blind-review-presentation-v0.1",
  itemCount: entries.length,
  rubric: ["factualFaithfulness", "insightValue", "actionability", "clarity", "tone", "uncertainty"],
  scale: "每项1-5分；只依据输入证据和输出评分，不推断模型、批次或来源。任一维度分歧达到2分时复核。",
  forbiddenInference: ["不得根据输出格式推断来源", "不得把运行耗时或降级状态带入文案质量分", "不得将评分外推为G1或生产结论"],
};

await mkdir(EVAL_DIR, { recursive: true });
for (const reviewer of ["A", "B"]) {
  await writeFile(`${EVAL_DIR}/T001-B2-blind-reviewer-${reviewer}-v0.1.json`, `${JSON.stringify({ ...instructions, reviewer, items: orderedFor(reviewer) }, null, 2)}\n`, "utf8",);
  const rows = orderedFor(reviewer).map((item) => `| ${item.itemId} |  |  |  |  |  |  |  |  |`);
  await writeFile(`${EVAL_DIR}/T001-B2-blind-score-sheet-${reviewer}-v0.1.md`, `# T001 B2 匿名评分表（评审${reviewer}）\n\n只根据对应匿名输入证据和输出评分，不记录模型或批次猜测。\n\n| itemId | 事实忠实 | 洞察价值 | 行动性 | 易懂性 | 语气匹配 | 不确定性 | 硬门备注 | 评语 |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n${rows.join("\n")}\n\n分歧达到2分的条目在复核列中标记。\n`, "utf8");
}
await writeFile(`${EVAL_DIR}/T001-B2-scoring-key-v0.1.json`, `${JSON.stringify({ warning: "仅项目维护者使用，不发送给评审", runId: "RUN-20260824-367", items: key }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reviewerItems: entries.length, b2Items: b2Records.length, pairedB0Items: pairedCases.length, pairedCases, directory: EVAL_DIR }, null, 2));
