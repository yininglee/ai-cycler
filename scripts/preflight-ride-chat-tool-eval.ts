// AGT-B5 preflight：评测资产静态校验（**零模型调用**）。
//
// 校验：manifest 与 cases 的 SHA/count 一致；每个 case 的工具名都在代码枚举里；
// 边界集的 scenario/behavior 在允许集合内；证据形态覆盖齐全。
// 用法：node --env-file=.env.local scripts/preflight-ride-chat-tool-eval.ts

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { chatToolSpecs, type ChatToolName } from "../src/chat/chat-tools.ts";

const problems: string[] = [];
const notes: string[] = [];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkManifest(dir: string, label: string): { caseCount: number; cases: Array<Record<string, unknown>> } {
  const manifest = readJson<Record<string, unknown>>(`${dir}/manifest.json`);
  const casesFile = `${dir}/${String(manifest.casesFile)}`;
  const cases = readJson<{ cases: Array<Record<string, unknown>> }>(casesFile).cases;
  if (sha256(casesFile) !== manifest.casesSha256) problems.push(`${label}: casesSha256 不一致（cases 被改过但 manifest 未更新）`);
  if (cases.length !== manifest.caseCount) problems.push(`${label}: caseCount ${manifest.caseCount} ≠ 实际 ${cases.length}`);
  const ids = new Set(cases.map((item) => String(item.caseId)));
  if (ids.size !== cases.length) problems.push(`${label}: caseId 有重复`);
  notes.push(`${label}: ${cases.length} 例，SHA 前缀 ${String(manifest.casesSha256).slice(0, 8)}`);
  return { caseCount: cases.length, cases };
}

// 工具名唯一事实源 = chatToolSpecs 的键（与 catalog/spec 声明同源）
const TOOL_SET = new Set<string>(Object.keys(chatToolSpecs));

// ---- 编排集 ----
const orch = checkManifest("eval/ride-chat-tool-orchestration-v0.2", "orchestration");
const evidenceKinds = new Set<string>();
for (const item of orch.cases) {
  const expected = item.expected as { requiredTools: string[]; requiredAnyOf?: string[]; forbiddenTools: string[]; requiredEvidence: string[] };
  // 工具名必须存在于代码枚举（防手写拼错）
  for (const tool of [...expected.requiredTools, ...(expected.requiredAnyOf ?? []), ...expected.forbiddenTools]) {
    if (!TOOL_SET.has(tool)) problems.push(`${String(item.caseId)}: 未知工具 "${tool}"`);
  }
  // 同一工具不能既必需又禁止
  const both = expected.requiredTools.filter((tool) => expected.forbiddenTools.includes(tool));
  if (both.length > 0) problems.push(`${String(item.caseId)}: 工具同时出现在 required/forbidden：${both.join(",")}`);
  // requiredAnyOf 也算"有要求"（同一诉求多条合法路径的情形）
  if (expected.requiredTools.length === 0 && (expected.requiredAnyOf ?? []).length === 0 && expected.forbiddenTools.length === 0) {
    problems.push(`${String(item.caseId)}: required / requiredAnyOf / forbidden 都为空，该例无法判分`);
  }
  // 同一工具不能既在 requiredAnyOf 又被禁止
  const anyBoth = (expected.requiredAnyOf ?? []).filter((tool) => expected.forbiddenTools.includes(tool));
  if (anyBoth.length > 0) problems.push(`${String(item.caseId)}: requiredAnyOf 与 forbidden 冲突：${anyBoth.join(",")}`);
  for (const kind of expected.requiredEvidence) evidenceKinds.add(kind);
}
for (const kind of ["claims", "knowledge", "capabilities"]) {
  if (!evidenceKinds.has(kind)) problems.push(`orchestration: 证据形态未覆盖 "${kind}"`);
}
const splitOf = (split: string) => orch.cases.filter((item) => item.split === split).length;
if (splitOf("negative") < 2) problems.push("orchestration: 负例少于 2");
if (orch.cases.length < 20) problems.push(`orchestration: 少于 20 例（当前 ${orch.cases.length}）`);
notes.push(`orchestration 分布: regression=${splitOf("regression")} boundary=${splitOf("boundary")} negative=${splitOf("negative")}；证据形态=${[...evidenceKinds].join("/")}`);

// ---- 边界集 ----
const bnd = checkManifest("eval/ride-chat-boundary-v0.1", "boundary");
const SCENARIOS = new Set(["full", "no_power", "no_profile", "no_records", "no_elevation", "empty_window"]);
// clarify：模糊指代（"这次"）在多记录下应触发锚点确认——这是**被记录的正确行为**，
// 不是失败（AGT-B5 首轮 Run 的教训：用模糊指代期望"调工具"，会把系统正确行为记成失败）。
// no_write_refusal：反误伤断言——只要求没被写拒绝拦，不评判答复质量
const BEHAVIORS = new Set(["tool_executed", "graceful_unavailable", "safety_stop", "reject_write", "clarify", "no_write_refusal"]);
for (const item of bnd.cases) {
  const expected = item.expected as { behavior: string };
  if (!SCENARIOS.has(String(item.scenario))) problems.push(`${String(item.caseId)}: 未知 scenario "${String(item.scenario)}"`);
  if (!BEHAVIORS.has(expected.behavior)) problems.push(`${String(item.caseId)}: 未知 behavior "${expected.behavior}"`);
}
const setCount = (set: string) => bnd.cases.filter((item) => item.set === set).length;
for (const set of ["window_out", "no_power", "kb_partial", "no_profile", "pmc_unavailable", "no_elevation", "no_records", "safety", "anchor_deixis", "multi_turn"]) {
  if (setCount(set) === 0) problems.push(`boundary: 缺少分组 "${set}"`);
}
notes.push(`boundary 分组: ${["window_out","no_power","kb_partial","no_profile","pmc_unavailable","no_elevation","no_records","safety","anchor_deixis","multi_turn"].map((set) => `${set}=${setCount(set)}`).join(" ")}`);

// ---- M3 v0.7 继承校验 ----
const m3 = readJson<Record<string, unknown>>("eval/ride-chat-v0.7/manifest.json");
const m3Cases = `${"eval/ride-chat-v0.7"}/${String(m3.casesFile)}`;
if (sha256(m3Cases) !== m3.casesSha256) problems.push("m3-v0.7: casesSha256 不一致");
const allowed = (m3.allowedTools as string[]) ?? [];
if (allowed.length !== 9) problems.push(`m3-v0.7: allowedTools 应为 9 个（当前 ${allowed.length}）`);
for (const tool of allowed) if (!TOOL_SET.has(tool)) problems.push(`m3-v0.7: allowedTools 含未知工具 "${tool}"`);
const forbidden = (m3.forbiddenCapabilities as string[]) ?? [];
for (const stale of ["rag", "get_profile_context", "compare_recent_rides"]) {
  if (forbidden.includes(stale)) problems.push(`m3-v0.7: forbiddenCapabilities 仍含已实现能力 "${stale}"`);
}
if (String((m3.versionMatrix as Record<string, unknown>).outputSchemaVersion) !== "ride-chat-output-v0.2") {
  problems.push("m3-v0.7: outputSchemaVersion 应为 ride-chat-output-v0.2");
}
notes.push(`m3-v0.7: ${String(m3.caseCount)} 例，allowedTools=${allowed.length}，forbidden=${forbidden.join(",")}`);

console.log("=== preflight（零模型调用）===");
for (const note of notes) console.log(`  · ${note}`);
if (problems.length === 0) {
  console.log("\n结果：PASS（0 问题）");
} else {
  console.log(`\n结果：FAIL（${problems.length} 问题）`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  process.exitCode = 1;
}

// 供评测脚本复用的类型（避免重复声明）
export type OrchestrationCase = {
  caseId: string;
  split: string;
  kind: string;
  input: string;
  expected: { requiredTools: ChatToolName[]; forbiddenTools: ChatToolName[]; requiredEvidence: string[] };
};
