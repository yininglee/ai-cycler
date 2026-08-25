import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const OUT = `${ROOT}/eval/human-review`;
type Run = { records: Array<{ caseId: string; repetition: number; runtimeResult: { output: Record<string, unknown> } }> };
const A = JSON.parse(await readFile(`${ROOT}/eval/runs/RUN-20260825-756.json`, "utf8")) as Run;
const B = JSON.parse(await readFile(`${ROOT}/eval/runs/RUN-20260825-960.json`, "utf8")) as Run;

const descriptions: Record<string, string> = {
  distanceM: "本次骑行的总距离", movingTimeS: "本次骑行的移动时间", elevationGainM: "累计爬升高度",
  avgSpeedMps: "本次骑行的平均速度", avgHeartRateBpm: "本次骑行的平均心率", maxHeartRateBpm: "记录中的最高心率",
  avgPowerW: "本次骑行的平均功率", normalizedPowerW: "标准化功率，用于概括功率输出水平",
  avgCadenceRpm: "本次骑行的平均踏频", maxCadenceRpm: "记录中的最高踏频",
  speedSeriesMeanMps: "速度序列的平均值", speedCoefficientOfVariation: "速度变异系数，表示相对平均速度的波动程度",
  speedFirstLastDeltaMps: "结束阶段与开始阶段的速度差值", speedStdDevMps: "速度序列的标准差，表示速度波动幅度",
  heartRateSeriesMeanBpm: "心率序列的平均值", heartRateStdDevBpm: "心率标准差，表示心率波动幅度",
  heartRateFirstLastDeltaBpm: "结束阶段与开始阶段的心率差值", powerSeriesMeanW: "功率序列的平均值",
  powerCoefficientOfVariation: "功率变异系数，表示相对平均功率的波动程度", powerFirstLastDeltaW: "结束阶段与开始阶段的功率差值",
  normalizedPowerRatio: "标准化功率与平均功率的比值", cadenceSeriesMeanRpm: "踏频序列的平均值",
  cadenceCoefficientOfVariation: "踏频变异系数，表示相对平均踏频的波动程度", cadenceFirstLastDeltaRpm: "结束阶段与开始阶段的踏频差值",
  elevationPositiveGainM: "根据海拔序列计算的累计爬升", elevationMinM: "最低海拔", elevationMaxM: "最高海拔", elevationRangeM: "最高与最低海拔之差",
};

function inputContext(caseId: string): Record<string, unknown> {
  const input = JSON.parse(readFileSync(`${ROOT}/output/coze-inputs/t001-${caseId}.json`, "utf8")) as { analysis_context: string; analysis_elig: string };
  return { ...JSON.parse(input.analysis_context), eligibility: JSON.parse(input.analysis_elig) };
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 12); }
function claimMapping(context: Record<string, unknown>): Map<string, string> {
  const claims = Array.isArray(context.allowedClaims) ? context.allowedClaims : [];
  const ids = claims.flatMap((claim) => claim && typeof claim === "object" && !Array.isArray(claim) && typeof (claim as Record<string, unknown>).claimId === "string"
    ? [String((claim as Record<string, unknown>).claimId)] : []);
  return new Map(ids.map((id, index) => [id, `claim-${String(index + 1).padStart(3, "0")}`]));
}
function anonymize(value: unknown, mapping: Map<string, string>): unknown {
  if (typeof value === "string") return mapping.get(value) ?? value.replace(/^claim:[^:]+:/, "claim-anon:");
  if (Array.isArray(value)) return value.map((item) => anonymize(item, mapping));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, anonymize(nested, mapping)]));
}
function evidence(context: Record<string, unknown>, mapping: Map<string, string>): Record<string, unknown> {
  const claims = Array.isArray(context.allowedClaims) ? context.allowedClaims : [];
  return {
    allowedClaims: claims.map((claim) => {
      const item = claim as Record<string, unknown>;
      return {
        claimId: mapping.get(String(item.claimId)) ?? "claim-anon",
        key: item.key,
        kind: item.kind,
        description: descriptions[String(item.key)] ?? "该证据字段在本次骑行中的记录或计算结果",
        value: item.value,
        unit: item.unit,
        displayValue: item.displayValue,
        displayUnit: item.displayUnit,
        provenance: item.provenance,
        confidence: item.confidence,
      };
    }),
    capabilities: context.capabilities ?? [],
    allowedDimensionKeys: (context.eligibility as Record<string, unknown> | undefined)?.allowedDimensionKeys ?? [],
    profileFacts: context.profileFacts ?? {},
    historicalComparison: context.historicalComparison ?? null,
    limitations: context.limitations ?? [],
  };
}

const bySlot = (run: Run) => new Map(run.records.map((record) => [`${record.caseId}#${record.repetition}`, record]));
const aBySlot = bySlot(A);
const bBySlot = bySlot(B);
const slots = [...aBySlot.keys()].sort();
if (slots.length !== 21 || slots.some((slot) => !bBySlot.has(slot))) throw new Error("AB_REVIEW_SLOT_MISMATCH");

const entries = slots.map((slot, index) => {
  const [caseId] = slot.split("#");
  const context = inputContext(caseId);
  const mapping = claimMapping(context);
  const variants = [
    { variantId: "variant-X", output: anonymize(aBySlot.get(slot)!.runtimeResult.output, mapping), _source: "A" },
    { variantId: "variant-Y", output: anonymize(bBySlot.get(slot)!.runtimeResult.output, mapping), _source: "B" },
  ];
  return { itemId: `AB-ITEM-${String(index + 1).padStart(3, "0")}`, evidence: evidence(context, mapping), variants };
});

function ordered(reviewer: string) {
  return entries.map((entry) => ({
    ...entry,
    variants: [...entry.variants].sort((left, right) => hash(`${reviewer}:${entry.itemId}:${left.variantId}`).localeCompare(hash(`${reviewer}:${entry.itemId}:${right.variantId}`)))
      .map(({ _source: _hidden, ...variant }) => variant),
  })).sort((left, right) => hash(`${reviewer}:${left.itemId}`).localeCompare(hash(`${reviewer}:${right.itemId}`)));
}

const instructions = {
  presentationVersion: "t001-prompt-ab-blind-review-v0.1",
  itemCount: entries.length,
  rubric: ["factualFaithfulness", "insightValue", "actionability", "clarity", "tone", "uncertainty"],
  scale: "每个变体各项1-5分；另选出更易读的变体。只依据证据和输出，不推断来源。",
  forbiddenInference: ["不得根据格式推断A/B", "不得把运行耗时或降级状态带入评分", "不得将评分直接外推为G1或生产结论"],
};

await mkdir(OUT, { recursive: true });
for (const reviewer of ["A", "B"]) {
  const items = ordered(reviewer).map(({ itemId, evidence: itemEvidence, variants }) => ({ itemId, evidence: itemEvidence, variants }));
  await writeFile(`${OUT}/T001-PROMPT-AB-blind-reviewer-${reviewer}-v0.1.json`, `${JSON.stringify({ ...instructions, reviewer, items }, null, 2)}\n`, "utf8");
  const rows = items.map((item) => `| ${item.itemId} |  |  |  |  |  |  |  |  |  |`);
  await writeFile(`${OUT}/T001-PROMPT-AB-blind-score-sheet-${reviewer}-v0.1.md`, `# T001 Prompt A/B 匿名可读性评分表（评审${reviewer}）\n\n先阅读匿名包中同一 itemId 的 evidence 和两个 variant，再分别评分，并选择更易读的变体。\n\n| itemId | X事实 | X洞察 | X行动 | X易懂 | X语气 | X不确定性 | Y事实 | Y洞察 | Y行动 | Y易懂 | Y语气 | Y不确定性 | 更易读 X/Y/相同 | 硬门备注 | 评语 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|\n${rows.join("\n")}\n\n评分标准沿用 T001-B2 人工评测指南；分歧达到2分的条目需复核。\n`, "utf8");
}
await writeFile(`${OUT}/T001-PROMPT-AB-scoring-key-v0.1.json`, `${JSON.stringify({ warning: "仅项目维护者使用，不发送给评审", experimentId: "T001-PROMPT-AB-v0.1", items: entries.map((entry) => ({ itemId: entry.itemId, slot: slots[Number(entry.itemId.slice(-3)) - 1], variantX: "A_or_B_per_reviewer", variantY: "A_or_B_per_reviewer" })) }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ itemCount: entries.length, reviewers: 2, directory: OUT }, null, 2));
