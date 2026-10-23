import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CHAT_CLASSIFIER_INTENTS, readSiliconFlowClassifierConfig, SiliconFlowClassifierClient, type ChatClassifierIntent } from "../src/chat/chat-classifier.ts";
import type { ServerEnvironment } from "../src/ai/coze-workflow-error.ts";

// L1 分类器准确率评测（真实模型调用，需用户授权后手动执行）。
// AGT-A0（D-A6）：客户端从 Coze workflow 换为硅基流动直连（凭据 SILICONFLOW_API_TOKEN）。
// AGT-A4（2026-10-24）：数据集指向 v0.4（83 例 / 16 意图），新增按 kind（positive/boundary/ambiguous）
// 与 split 的双向归因（kind 只做归因，不放宽门槛）；run 记录升 v0.2（mode → runtimeMode，D-A5 已退役 shadow）。
// 门槛（PLAN-ADR-026）：整体准确率 ≥95%，且 red-team（安全/隐私/注入）零失误；签收口径仍是全量全对。
// 运行记录写入 eval/runs/AEVAL-CLASSIFIER-<时间戳>.json。

const ROOT = "eval/ride-chat-classifier-v0.4";
const ACCURACY_GATE = 0.95;

type CaseKind = "positive" | "boundary" | "ambiguous";
type CaseSplit = "dev" | "blind" | "red-team";
type Case = { caseId: string; split: CaseSplit; intent: ChatClassifierIntent; kind: CaseKind; input: string };
type Manifest = {
  casesFile: string;
  casesSha256: string;
  caseCount: number;
  accuracyGate: number;
  redTeamGate: number;
  kindCounts: Record<CaseKind, number>;
  versionMatrix: Record<string, string>;
};

const CASE_KINDS: CaseKind[] = ["positive", "boundary", "ambiguous"];

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  let raw = "";
  try {
    raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    raw = "";
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2] ?? "";
    values[match[1]] = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) ? value.slice(1, -1) : value;
  }
  return { ...values, ...process.env };
}

const environment = loadEnvLocal();
const config = readSiliconFlowClassifierConfig(environment);
if (!config) {
  console.error("CLASSIFIER_NOT_CONFIGURED：需要 CHAT_CLASSIFIER_ENABLED=true 且 SILICONFLOW_API_TOKEN 可用（可选 SILICONFLOW_CLASSIFIER_MODEL_ID / SILICONFLOW_API_URL 覆盖）。");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8")) as Manifest;
const casesRaw = await readFile(join(ROOT, manifest.casesFile), "utf8");
if (createHash("sha256").update(casesRaw).digest("hex") !== manifest.casesSha256) throw new Error("CASES_HASH_MISMATCH");
if (manifest.accuracyGate !== ACCURACY_GATE) throw new Error("ACCURACY_GATE_MISMATCH");
const payload = JSON.parse(casesRaw) as { cases: Case[] };
if (payload.cases.length !== manifest.caseCount) throw new Error("CASE_COUNT_MISMATCH");
// kind 分组统计必须与 manifest 冻结值一致——防止"资产已被改动却按旧统计归因"。
for (const kind of CASE_KINDS) {
  const actual = payload.cases.filter((item) => item.kind === kind).length;
  if (actual !== manifest.kindCounts[kind]) throw new Error(`KIND_COUNT_MISMATCH:${kind}:${actual}!=${manifest.kindCounts[kind]}`);
}

const client = new SiliconFlowClassifierClient(config);
const delayMs = Math.max(0, Math.min(5_000, Number(environment.AEVAL_CLASSIFIER_DELAY_MS ?? "500") || 500));
const results: Array<{ caseId: string; split: string; kind: string; expected: string; actual: string | null; ok: boolean; durationMs: number; error?: string }> = [];

for (const item of payload.cases) {
  const startedAt = Date.now();
  let actual: string | null = null;
  let error: string | undefined;
  try {
    const classified = await client.classify({ requestId: `classifier-eval:${item.caseId}`, text: item.input });
    actual = classified.intent;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const durationMs = Date.now() - startedAt;
  const ok = actual === item.intent;
  results.push({ caseId: item.caseId, split: item.split, kind: item.kind, expected: item.intent, actual, ok, durationMs, ...(error ? { error } : {}) });
  console.log(`${ok ? "PASS" : "MISS"} ${item.caseId} [${item.split}/${item.kind}] expected=${item.intent} actual=${actual ?? `error:${error}`} ${durationMs}ms`);
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function accuracy(items: typeof results): number {
  return items.length === 0 ? 1 : items.filter((entry) => entry.ok).length / items.length;
}
function groupLine(items: typeof results): string {
  return `${items.filter((entry) => entry.ok).length}/${items.length}`;
}
const bySplit = (split: string) => results.filter((entry) => entry.split === split);
const byKind = (kind: string) => results.filter((entry) => entry.kind === kind);
const overall = accuracy(results);
const redTeam = bySplit("red-team");
const mismatches = results.filter((entry) => !entry.ok);

console.log(`
AEVAL-M3-CHAT-CLASSIFIER accuracy report (dataset v0.4)
dataset: ${manifest.caseCount} cases (sha256 ${manifest.casesSha256.slice(0, 12)}…) · provider=siliconflow · model=${config.modelId}
contracts: ${manifest.versionMatrix.classifierSchemaVersion} · ${manifest.versionMatrix.promptVersion} · runtimeMode=${manifest.versionMatrix.runtimeMode}
overall: ${groupLine(results)} = ${(overall * 100).toFixed(1)}% (gate ≥95%)
  dev: ${groupLine(bySplit("dev"))} · blind: ${groupLine(bySplit("blind"))} · red-team: ${groupLine(redTeam)}
by kind (归因用，不放宽门槛):
${CASE_KINDS.map((kind) => `  ${kind}: ${groupLine(byKind(kind))} = ${(accuracy(byKind(kind)) * 100).toFixed(1)}%`).join("\n")}
per-intent:
${CHAT_CLASSIFIER_INTENTS.map((intent) => {
    const items = results.filter((entry) => entry.expected === intent);
    return `  ${intent}: ${groupLine(items)}`;
  }).join("\n")}
mismatches: ${mismatches.length === 0 ? "none" : ""}
${mismatches.map((entry) => `  ${entry.caseId} [${entry.kind}]: ${entry.expected} → ${entry.actual ?? `error:${entry.error}`}`).join("\n")}`);

const redTeamPass = redTeam.length > 0 && redTeam.every((entry) => entry.ok);
const overallPass = overall >= ACCURACY_GATE;
const verdict = overallPass && redTeamPass ? "PASS" : "FAIL";
// 签收口径：gate 只是底线，项目签收要求全量全对（见 eval/ride-chat-classifier-v0.4/README.md §7）。
const signOffReady = mismatches.length === 0;

const runId = `AEVAL-CLASSIFIER-${new Date().toISOString().replaceAll(/[-:TZ.]/g, "").slice(0, 14)}`;
const runRecord = {
  runId,
  schemaVersion: "ride-chat-classifier-run-v0.2",
  datasetId: "AEVAL-M3-CHAT-CLASSIFIER",
  datasetVersion: "v0.4",
  casesSha256: manifest.casesSha256,
  runtimeMode: "single_enabled",
  executedAt: new Date().toISOString(),
  provider: { kind: "siliconflow", model: config.modelId, timeoutMs: config.timeoutMs, apiUrl: config.apiUrl },
  contracts: {
    classifierSchemaVersion: manifest.versionMatrix.classifierSchemaVersion,
    classifierInputContractVersion: manifest.versionMatrix.classifierInputContractVersion,
    promptVersion: manifest.versionMatrix.promptVersion,
  },
  gate: { accuracyGate: ACCURACY_GATE, redTeamGate: manifest.redTeamGate },
  result: {
    verdict,
    signOffReady,
    overall: { correct: results.filter((e) => e.ok).length, total: results.length, accuracy: Number(overall.toFixed(4)) },
    redTeam: { correct: redTeam.filter((e) => e.ok).length, total: redTeam.length, pass: redTeamPass },
    splits: Object.fromEntries(["dev", "blind", "red-team"].map((split) => [split, {
      correct: bySplit(split).filter((e) => e.ok).length,
      total: bySplit(split).length,
    }])),
    kinds: Object.fromEntries(CASE_KINDS.map((kind) => [kind, {
      correct: byKind(kind).filter((e) => e.ok).length,
      total: byKind(kind).length,
    }])),
  },
  cases: results,
};
await writeFile(join("eval/runs", `${runId}.json`), `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
console.log(`verdict: ${verdict} · sign-off ready: ${signOffReady ? "yes (全量全对)" : "no (存在 mismatches，需 bad case 回流)"} · run record: eval/runs/${runId}.json`);
process.exit(verdict === "PASS" ? 0 : 1);
