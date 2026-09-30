import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const ROOT = process.cwd();
const REVIEW_DIR = `${ROOT}/eval/human-review`;
const reviewers = ["A", "B"] as const;
const dimensions = ["factualFaithfulness", "insightValue", "actionability", "clarity", "tone", "uncertainty"] as const;
type Dimension = typeof dimensions[number];

function stableHash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 12); }
function sourceFor(reviewer: string, itemId: string, variantId: "variant-X" | "variant-Y"): "A" | "B" {
  const variants = ["variant-X", "variant-Y"].sort((left, right) => stableHash(`${reviewer}:${itemId}:${left}`).localeCompare(stableHash(`${reviewer}:${itemId}:${right}`)));
  const originalSource = variantId === "variant-X" ? "A" : "B";
  return variants.indexOf(variantId) === (originalSource === "A" ? 0 : 1) ? originalSource : originalSource === "A" ? "B" : "A";
}

function parseRows(text: string): Map<string, { scores: Record<"X" | "Y", Record<Dimension, number>>; preference: string; hard: string; comment: string }> {
  const rows = new Map<string, { scores: Record<"X" | "Y", Record<Dimension, number>>; preference: string; hard: string; comment: string }>();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\| AB-ITEM-\d{3} \|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 16) throw new Error(`INVALID_SCORE_COLUMNS:${cells[0]}:${cells.length}`);
    const itemId = cells[0];
    const parseScores = (offset: number) => Object.fromEntries(dimensions.map((dimension, index) => {
      const value = Number(cells[offset + index]);
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`INVALID_SCORE:${itemId}:${cells[offset + index]}`);
      return [dimension, value];
    })) as Record<Dimension, number>;
    rows.set(itemId, { scores: { X: parseScores(1), Y: parseScores(7) }, preference: cells[13], hard: cells[14], comment: cells[15] });
  }
  return rows;
}

const scoreRows = new Map<string, Map<string, ReturnType<typeof parseRows> extends Map<string, infer V> ? V : never>>();
for (const reviewer of reviewers) {
  scoreRows.set(reviewer, parseRows(await readFile(`${REVIEW_DIR}/T001-PROMPT-AB-blind-score-sheet-${reviewer}-v0.1.md`, "utf8")));
}
const itemIds = [...scoreRows.values()][0] ? [...[...scoreRows.values()][0].keys()].sort() : [];
if (itemIds.length !== 21 || reviewers.some((reviewer) => scoreRows.get(reviewer)!.size !== 21 || itemIds.some((itemId) => !scoreRows.get(reviewer)!.has(itemId)))) {
  throw new Error("INCOMPLETE_OR_MISMATCHED_REVIEW_ROWS");
}

const sums: Record<"A" | "B", Record<Dimension, number>> = {
  A: Object.fromEntries(dimensions.map((dimension) => [dimension, 0])) as Record<Dimension, number>,
  B: Object.fromEntries(dimensions.map((dimension) => [dimension, 0])) as Record<Dimension, number>,
};
const counts: Record<"A" | "B", number> = { A: 0, B: 0 };
const preferenceVotes: Record<"A" | "B" | "tie", number> = { A: 0, B: 0, tie: 0 };
const disagreements: Array<{ itemId: string; dimension: Dimension; difference: number }> = [];
const hardNotes: Array<{ reviewer: string; itemId: string; note: string }> = [];

for (const itemId of itemIds) {
  const perReviewer = reviewers.map((reviewer) => ({ reviewer, row: scoreRows.get(reviewer)!.get(itemId)! }));
  for (const { reviewer, row } of perReviewer) {
    const sourceX = sourceFor(reviewer, itemId, "variant-X");
    const sourceY = sourceFor(reviewer, itemId, "variant-Y");
    for (const dimension of dimensions) {
      sums[sourceX][dimension] += row.scores.X[dimension];
      sums[sourceY][dimension] += row.scores.Y[dimension];
    }
    counts[sourceX] += 1;
    counts[sourceY] += 1;
    if (row.preference === "相同") preferenceVotes.tie += 1;
    else if (row.preference === "X" || row.preference === "Y") preferenceVotes[row.preference === "X" ? sourceX : sourceY] += 1;
    if (row.hard !== "无明显硬门问题" && row.hard.trim()) hardNotes.push({ reviewer, itemId, note: row.hard });
  }
  for (const dimension of dimensions) {
    const sourceScores = Object.fromEntries(["A", "B"].map((source) => [source, perReviewer.map(({ reviewer, row }) => {
      const sourceX = sourceFor(reviewer, itemId, "variant-X");
      return sourceX === source ? row.scores.X[dimension] : row.scores.Y[dimension];
    })])) as Record<"A" | "B", number[]>;
    const differenceA = Math.abs((sourceScores.A[0] ?? 0) - (sourceScores.A[1] ?? 0));
    const differenceB = Math.abs((sourceScores.B[0] ?? 0) - (sourceScores.B[1] ?? 0));
    const difference = Math.max(differenceA, differenceB);
    if (difference >= 2) disagreements.push({ itemId, dimension, difference });
  }
}

const means = {
  A: Object.fromEntries(dimensions.map((dimension) => [dimension, Number((sums.A[dimension] / counts.A).toFixed(3))])),
  B: Object.fromEntries(dimensions.map((dimension) => [dimension, Number((sums.B[dimension] / counts.B).toFixed(3))])),
};
const delta = Object.fromEntries(dimensions.map((dimension) => [dimension, Number((means.A[dimension] - means.B[dimension]).toFixed(3))]));
const result = {
  schemaVersion: "t001-prompt-ab-human-review-result-v0.1",
  experimentId: "T001-PROMPT-AB-v0.1",
  status: "DIAGNOSTIC_ONLY",
  completeness: { reviewerA: 21, reviewerB: 21, expectedPerReviewer: 21, hardNotes: hardNotes.length, disagreementsAtLeast2: disagreements.length },
  means,
  deltaAminusB: delta,
  preferenceVotes,
  disagreements,
  hardNotes,
  boundaries: ["人工评分不改变机器运行结果", "不把一次小样本评分外推为生产质量", "不据此判断G1", "成本、精确模型ID、区域和首Token延迟仍未评分"],
};
await writeFile(`${REVIEW_DIR}/T001-PROMPT-AB-human-review-result-v0.1.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
const report = [
  "# T001 Prompt A/B 人工评审结果 v0.1",
  "",
  "## 状态",
  "",
  "`DIAGNOSTIC_ONLY`：两名评审均完成21/21项；结果用于判断候选可读性和洞察表达，不改变机器可靠性结论。",
  "",
  "## 评分均值（1–5）",
  "",
  "| 维度 | A | B | A-B |",
  "|---|---:|---:|---:|",
  ...dimensions.map((dimension) => `| ${dimension} | ${means.A[dimension]} | ${means.B[dimension]} | ${delta[dimension]} |`),
  "",
  "## 更易读偏好",
  "",
  `- A：${preferenceVotes.A}`,
  `- B：${preferenceVotes.B}`,
  `- 相同：${preferenceVotes.tie}`,
  "",
  "## 完整性与分歧",
  "",
  "- 评审A：21/21；评审B：21/21。",
  `- 分数分歧达到2分：${disagreements.length}项。`,
  `- 硬门备注：${hardNotes.length}项。`,
  "",
  "## 与机器结果的关系",
  "",
  "B 机器结果仍为 B2 2/21、B0 19/21，明显低于 A 的 B2 7/21。人工评分只评价最终输出的事实忠实、洞察价值、行动性、易懂性、语气和不确定性，不抵消 B 的运行时退化。",
  "",
  "结论保持诊断性：不替换 A，不判断 G1；是否继续 Compact Candidate 需要结合机器可靠性下降和人工评分共同决定。",
].join("\n");
await writeFile(`${REVIEW_DIR}/T001-PROMPT-AB-human-review-result-v0.1.md`, `${report}\n`, "utf8");
console.log(JSON.stringify({ artifact: `${REVIEW_DIR}/T001-PROMPT-AB-human-review-result-v0.1.json`, reviewerA: 21, reviewerB: 21, disagreements: disagreements.length, preferenceVotes, means }, null, 2));
