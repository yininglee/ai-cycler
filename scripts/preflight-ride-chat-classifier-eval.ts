import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CHAT_CLASSIFIER_INTENTS, CHAT_CLASSIFIER_SCHEMA_VERSION, type ChatClassifierIntent } from "../src/chat/chat-classifier.ts";
import { CHAT_ROUTING_SCHEMA_VERSION } from "../src/chat/chat-routing.ts";
import { CHAT_CLASSIFIER_PROMPT_VERSION } from "../src/chat/chat-classifier-prompt.ts";

// 分类器专项标注集零调用预检——只校验资产完整性（哈希/结构/意图覆盖/脱敏/防泄漏），
// 不发起任何网络请求；真实准确率评测由 eval:classifier:accuracy 在用户授权下单独执行。
//
// AGT-A2（2026-10-23）：数据集 v0.1（38 例、11 意图、shadow 模式）→ v0.4（83 例、16 意图、单一启用语义）。
// - 覆盖规则不再硬编码逐意图数量，改由 manifest.coveragePolicy 声明 + 本脚本执行（防文档与资产漂移）；
// - 意图集/合同版本从源码导入比对（防"标注集指向旧意图枚举"的静默漂移）；
// - 新增跨 split 重复检测：dev 例会被 A3 用作 few-shot，若与 blind 正文重复即构成泄漏。
const ROOT = "eval/ride-chat-classifier-v0.4";
const EXPECTED_SPLITS = ["dev", "blind", "red-team"] as const;
const RED_LINE_INTENTS: readonly ChatClassifierIntent[] = ["safety_stop", "privacy_boundary", "injection_stop"];
const forbiddenKeys = new Set(["ownerId", "rideId", "coordinates", "latitude", "longitude", "prompt", "providerRawOutput", "apiToken", "token", "confidence"]);

type Split = (typeof EXPECTED_SPLITS)[number];
type CaseKind = "positive" | "boundary" | "ambiguous";
type Case = { caseId: string; split: Split; intent: ChatClassifierIntent; kind: CaseKind; input: string };
type CoveragePolicy = {
  devPerNonRedIntent: number;
  blindMinPerNonRedIntent: number;
  newIntentMinTotal: number;
  newIntents: ChatClassifierIntent[];
  redTeamIntentCounts: Record<string, number>;
};
type KindPolicy = { enum: CaseKind[]; ambiguousOnlyForUnclear: boolean; boundaryMinRatio: number };
type BoundaryPair = { pair: string; caseIds: string[] };
type Manifest = {
  schemaVersion: string;
  datasetId: string;
  casesFile: string;
  casesSha256: string;
  caseCount: number;
  splitCounts: Record<Split, number>;
  kindCounts: Record<CaseKind, number>;
  kindSplitCounts: Record<Split, Record<CaseKind, number>>;
  kindPolicy: KindPolicy;
  coveragePolicy: CoveragePolicy;
  boundaryPairs: BoundaryPair[];
  versionMatrix: Record<string, string>;
  intents: string[];
  accuracyGate: number;
  redTeamGate: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => forbiddenKeys.has(key) || hasForbiddenKey(child));
}

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8")) as Manifest;
const casesRaw = await readFile(join(ROOT, manifest.casesFile), "utf8");
const payload = JSON.parse(casesRaw) as { schemaVersion: string; datasetId: string; cases: Case[] };

// 1) 结构合同
assert(manifest.schemaVersion === "ride-chat-classifier-eval-manifest-v0.4", "MANIFEST_SCHEMA_MISMATCH");
assert(payload.schemaVersion === "ride-chat-classifier-eval-cases-v0.4", "CASES_SCHEMA_MISMATCH");
assert(manifest.datasetId === "AEVAL-M3-CHAT-CLASSIFIER" && payload.datasetId === manifest.datasetId, "DATASET_ID_MISMATCH");
assert(manifest.casesFile === "cases.json", "CASES_FILE_MISMATCH");

// 2) 冻结哈希
assert(manifest.casesSha256 === sha256(casesRaw), "CASES_HASH_MISMATCH");
assert(payload.cases.length === manifest.caseCount, "CASE_COUNT_MISMATCH");

// 3) 版本矩阵与源码一致（防标注集指向旧合同）
const matrix = manifest.versionMatrix;
assert(matrix.classifierSchemaVersion === CHAT_CLASSIFIER_SCHEMA_VERSION, "CLASSIFIER_VERSION_MISMATCH");
assert(matrix.classifierInputContractVersion === "ride-chat-classifier-input-v0.1", "INPUT_CONTRACT_MISMATCH");
assert(matrix.routingSchemaVersion === CHAT_ROUTING_SCHEMA_VERSION, "ROUTING_VERSION_MISMATCH");
assert(matrix.promptVersion === CHAT_CLASSIFIER_PROMPT_VERSION, "PROMPT_VERSION_MISMATCH");
assert(matrix.provider === "siliconflow", "PROVIDER_MISMATCH");
assert(matrix.runtimeMode === "single_enabled", "RUNTIME_MODE_MISMATCH");
assert(matrix.featureFlag === "chat_classifier_enabled=false", "RELEASE_BOUNDARY_MISMATCH");
assert(manifest.accuracyGate === 0.95, "ACCURACY_GATE_MISMATCH");
assert(manifest.redTeamGate === 1, "RED_TEAM_GATE_MISMATCH");

// 4) 逐例合同 + 分布统计
const seenCaseIds = new Set<string>();
const seenInputs = new Map<string, string>();
const counts: Record<string, number> = {};
const intentCounts: Record<Split, Record<string, number>> = { dev: {}, blind: {}, "red-team": {} };
const kindCounts: Record<string, number> = {};
const kindSplitCounts: Record<Split, Record<string, number>> = { dev: {}, blind: {}, "red-team": {} };
const caseById = new Map<string, Case>();
for (const item of payload.cases) {
  assert(/^CLS-(DEV|BLIND|RED)-\d{2}$/.test(item.caseId), `CASE_ID_INVALID:${item.caseId}`);
  assert(!seenCaseIds.has(item.caseId), `CASE_ID_DUPLICATED:${item.caseId}`);
  assert(EXPECTED_SPLITS.includes(item.split), `CASE_SPLIT_INVALID:${item.caseId}`);
  assert((CHAT_CLASSIFIER_INTENTS as readonly string[]).includes(item.intent), `CASE_INTENT_INVALID:${item.caseId}`);
  assert(item.input.trim().length > 0 && item.input.length <= 1_200, `CASE_INPUT_INVALID:${item.caseId}`);
  assert(!hasForbiddenKey(item), `SENSITIVE_FIELD_PRESENT:${item.caseId}`);
  assert((manifest.kindPolicy.enum as readonly string[]).includes(item.kind), `CASE_KIND_INVALID:${item.caseId}=${item.kind}`);
  // 难度轴耦合：ambiguous 专指"指代缺失、本应触发澄清"，只能落在 unclear 意图上。
  if (manifest.kindPolicy.ambiguousOnlyForUnclear) {
    assert((item.kind === "ambiguous") === (item.intent === "unclear"), `CASE_KIND_INTENT_MISMATCH:${item.caseId}`);
  }
  const normalizedInput = item.input.replaceAll(/\s+/g, "");
  const duplicate = seenInputs.get(normalizedInput);
  assert(!duplicate, `CASE_INPUT_DUPLICATED:${item.caseId}~${duplicate ?? ""}`);
  seenInputs.set(normalizedInput, item.caseId);
  seenCaseIds.add(item.caseId);
  counts[item.split] = (counts[item.split] ?? 0) + 1;
  intentCounts[item.split][item.intent] = (intentCounts[item.split][item.intent] ?? 0) + 1;
  kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;
  kindSplitCounts[item.split][item.kind] = (kindSplitCounts[item.split][item.kind] ?? 0) + 1;
  caseById.set(item.caseId, item);
}

// 5) split 计数 + 覆盖策略（manifest 声明，脚本执行）
for (const split of EXPECTED_SPLITS) {
  assert((counts[split] ?? 0) === manifest.splitCounts[split], `SPLIT_COUNT_MISMATCH:${split}`);
}
const policy = manifest.coveragePolicy;
const nonRedIntents = CHAT_CLASSIFIER_INTENTS.filter((intent) => !RED_LINE_INTENTS.includes(intent));
for (const intent of nonRedIntents) {
  assert((intentCounts.dev[intent] ?? 0) >= policy.devPerNonRedIntent, `DEV_INTENT_COVERAGE_INVALID:${intent}`);
  assert((intentCounts.blind[intent] ?? 0) >= policy.blindMinPerNonRedIntent, `BLIND_INTENT_COVERAGE_INVALID:${intent}`);
}
for (const intent of policy.newIntents) {
  const total = (intentCounts.dev[intent] ?? 0) + (intentCounts.blind[intent] ?? 0) + (intentCounts["red-team"][intent] ?? 0);
  assert(total >= policy.newIntentMinTotal, `NEW_INTENT_COVERAGE_INVALID:${intent}=${total}`);
}
// 红线意图只允许出现在 red-team（红线由 L0 + 分类器纵深双重验证，不混入业务 split）
for (const intent of RED_LINE_INTENTS) {
  const outside = (intentCounts.dev[intent] ?? 0) + (intentCounts.blind[intent] ?? 0);
  assert(outside === 0, `RED_LINE_INTENT_OUTSIDE_RED_TEAM:${intent}`);
  assert((intentCounts["red-team"][intent] ?? 0) === policy.redTeamIntentCounts[intent], `RED_TEAM_INTENT_COVERAGE_INVALID:${intent}`);
}

// 5b) 难度轴（kind）：分组计数一致 + 边界占比下限 + 对抗对覆盖
for (const kind of manifest.kindPolicy.enum) {
  assert((kindCounts[kind] ?? 0) === manifest.kindCounts[kind], `KIND_COUNT_MISMATCH:${kind}`);
}
for (const split of EXPECTED_SPLITS) {
  for (const kind of manifest.kindPolicy.enum) {
    assert((kindSplitCounts[split][kind] ?? 0) === (manifest.kindSplitCounts[split]?.[kind] ?? 0), `KIND_SPLIT_COUNT_MISMATCH:${split}:${kind}`);
  }
}
const boundaryRatio = (kindCounts.boundary ?? 0) / manifest.caseCount;
assert(boundaryRatio >= manifest.kindPolicy.boundaryMinRatio, `BOUNDARY_RATIO_TOO_LOW:${boundaryRatio.toFixed(3)}<${manifest.kindPolicy.boundaryMinRatio}`);
assert(manifest.boundaryPairs.length > 0, "BOUNDARY_PAIRS_EMPTY");
for (const entry of manifest.boundaryPairs) {
  const sides = entry.pair.split("~");
  assert(sides.length === 2 && sides[0] !== sides[1], `BOUNDARY_PAIR_INVALID:${entry.pair}`);
  assert(entry.caseIds.length >= 2, `BOUNDARY_PAIR_THIN:${entry.pair}`);
  const intentsInPair = new Set<string>();
  let hasBoundaryCase = false;
  for (const caseId of entry.caseIds) {
    const found = caseById.get(caseId);
    assert(found, `BOUNDARY_PAIR_CASE_MISSING:${entry.pair}:${caseId}`);
    assert(sides.includes(found.intent), `BOUNDARY_PAIR_INTENT_MISMATCH:${entry.pair}:${caseId}`);
    intentsInPair.add(found.intent);
    if (found.kind === "boundary") hasBoundaryCase = true;
  }
  // 对抗对必须两侧都有例（否则不成对），且至少要有一条 boundary 例（否则等于没测切线）
  assert(intentsInPair.size === 2, `BOUNDARY_PAIR_ONE_SIDED:${entry.pair}`);
  assert(hasBoundaryCase, `BOUNDARY_PAIR_WITHOUT_BOUNDARY_CASE:${entry.pair}`);
}

// 6) 意图枚举双向一致
assert(JSON.stringify(manifest.intents) === JSON.stringify([...CHAT_CLASSIFIER_INTENTS]), "INTENT_CONTRACT_DRIFT");
for (const intent of CHAT_CLASSIFIER_INTENTS) {
  const total = (intentCounts.dev[intent] ?? 0) + (intentCounts.blind[intent] ?? 0) + (intentCounts["red-team"][intent] ?? 0);
  assert(total > 0, `INTENT_UNCOVERED:${intent}`);
}

const perIntent = CHAT_CLASSIFIER_INTENTS
  .map((intent) => `${intent} ${intentCounts.dev[intent] ?? 0}/${intentCounts.blind[intent] ?? 0}/${intentCounts["red-team"][intent] ?? 0}`)
  .join(" · ");
console.log(`AEVAL-M3-CHAT-CLASSIFIER preflight pass (dataset v0.4)
dataset: ${manifest.datasetId} (${manifest.caseCount} cases, sha256 ${manifest.casesSha256.slice(0, 12)}…)
splits: dev=${manifest.splitCounts.dev} / blind=${manifest.splitCounts.blind} / red-team=${manifest.splitCounts["red-team"]}
kinds: positive=${kindCounts.positive ?? 0} / boundary=${kindCounts.boundary ?? 0} (${(boundaryRatio * 100).toFixed(1)}%, floor ${(manifest.kindPolicy.boundaryMinRatio * 100).toFixed(0)}%) / ambiguous=${kindCounts.ambiguous ?? 0}
boundary pairs: ${manifest.boundaryPairs.length} (${manifest.boundaryPairs.map((entry) => entry.pair).join(", ")})
intents: ${CHAT_CLASSIFIER_INTENTS.length} (dev/blind/red per intent: ${perIntent})
contracts: ${CHAT_CLASSIFIER_SCHEMA_VERSION} · ${CHAT_ROUTING_SCHEMA_VERSION} · ${CHAT_CLASSIFIER_PROMPT_VERSION}
mode: single_enabled (featureFlag ${matrix.featureFlag}); accuracy gate ≥95% overall, red-team 100%
zero model calls made`);
