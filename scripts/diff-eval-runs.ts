// AGT-H1 回归定性工具：把两次 run 按 caseId 对起来，逐例标出「新增失败 / 修复 / 仍失败」。
//
// 用法：
//   node scripts/diff-eval-runs.ts <baseline.json> <current.json>
//
// 为什么要按 caseId 聚合而不是比总数：两套集每例重复 3 次，通过率是**每例每轮**的粒度；
// 只看 61→58 这种总数变化，无法回答"是不是同一批用例在抖"——而 H1 的归因恰恰取决于
// "变化集中在哪些用例"（记录选择相关 = 预期；无关用例 = 可疑）。
import { readFileSync } from "node:fs";

type RunResult = {
  caseId: string;
  round: number;
  pass: boolean;
  detail?: string;
  fallback?: string;
  steps?: string[];
  replyPreview?: string;
  elapsedMs?: number;
};
type Run = { datasetId: string; repeat: number; total: number; passed: number; results: RunResult[] };

function load(path: string): Run {
  return JSON.parse(readFileSync(path, "utf8")) as Run;
}

function group(run: Run): Map<string, { pass: number; total: number; details: string[] }> {
  const map = new Map<string, { pass: number; total: number; details: string[] }>();
  for (const item of run.results) {
    const entry = map.get(item.caseId) ?? { pass: 0, total: 0, details: [] };
    entry.total += 1;
    if (item.pass) entry.pass += 1;
    else entry.details.push(`r${item.round}: ${item.detail ?? "-"}`);
    map.set(item.caseId, entry);
  }
  return map;
}

const [, , baselinePath, currentPath] = process.argv;
if (!baselinePath || !currentPath) {
  console.error("用法: node scripts/diff-eval-runs.ts <baseline.json> <current.json>");
  process.exitCode = 1;
} else {
  const baseline = load(baselinePath);
  const current = load(currentPath);
  const before = group(baseline);
  const after = group(current);

  console.log(`基线 ${baselinePath.split("/").pop()}  ${baseline.passed}/${baseline.total}`);
  console.log(`本次 ${currentPath.split("/").pop()}  ${current.passed}/${current.total}`);
  console.log("");

  const regressed: string[] = [];
  const improved: string[] = [];
  const stillFailing: string[] = [];
  const flaky: string[] = [];

  for (const [caseId, now] of after) {
    const was = before.get(caseId);
    if (!was) {
      console.log(`[新用例] ${caseId}  ${now.pass}/${now.total}`);
      continue;
    }
    const wasPass = was.pass === was.total;
    const nowPass = now.pass === now.total;
    if (wasPass && !nowPass) regressed.push(caseId);
    else if (!wasPass && nowPass) improved.push(caseId);
    else if (!wasPass && !nowPass) stillFailing.push(caseId);
    else if (was.pass > 0 || now.pass > 0) flaky.push(caseId);
  }

  const report = (title: string, ids: string[], source: Map<string, { pass: number; total: number; details: string[] }>) => {
    if (ids.length === 0) return;
    console.log(`${title}（${ids.length} 例）`);
    for (const id of ids) {
      const now = after.get(id)!;
      const was = before.get(id);
      console.log(`  · ${id}  ${was ? `${was.pass}/${was.total}` : "-"} → ${now.pass}/${now.total}`);
      for (const detail of now.details.slice(0, 3)) console.log(`      ${detail}`);
    }
    console.log("");
  };

  report("⚠️ 新增失败（基线全过 → 本次有失败）", regressed, after);
  report("✅ 修复（基线有失败 → 本次全过）", improved, after);
  report("仍失败（两轮都有失败）", stillFailing, after);
  if (flaky.length > 0) console.log(`部分通过（两轮都非全过也非全败，波动）：${flaky.join(", ")}`);

  console.log("");
  console.log(`汇总：新增失败 ${regressed.length} / 修复 ${improved.length} / 仍失败 ${stillFailing.length} / 波动 ${flaky.length}`);
}
