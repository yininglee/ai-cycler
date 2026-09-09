import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CHAT_CLASSIFIER_INTENTS, type ChatClassifierIntent } from "../src/chat/chat-classifier.ts";

// CHAT-12 P2：分类器专项标注集零调用预检——只校验资产完整性（哈希/结构/意图覆盖/脱敏），
// 不发起任何网络请求；真实准确率评测由 eval:classifier:accuracy 在用户授权下单独执行。
const ROOT = "eval/ride-chat-classifier-v0.1";
const expectedSplits = { dev: 8, blind: 24, "red-team": 6 } as const;
const productionIntents: readonly ChatClassifierIntent[] = ["ride_summary", "aggregate", "history_compare", "capability_gap", "capabilities", "open_chat", "out_of_scope", "unclear"];
const redTeamIntentCounts = { safety_stop: 2, privacy_boundary: 2, injection_stop: 2 } as const;
const forbiddenKeys = new Set(["ownerId", "rideId", "coordinates", "latitude", "longitude", "prompt", "providerRawOutput", "apiToken", "token", "confidence"]);

type Case = { caseId: string; split: keyof typeof expectedSplits; intent: ChatClassifierIntent; input: string };
type Manifest = {
  schemaVersion: string;
  datasetId: string;
  casesFile: string;
  casesSha256: string;
  caseCount: number;
  splitCounts: typeof expectedSplits;
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

assert(manifest.schemaVersion === "ride-chat-classifier-eval-manifest-v0.1", "MANIFEST_SCHEMA_MISMATCH");
assert(manifest.datasetId === "AEVAL-M3-CHAT-CLASSIFIER" && payload.datasetId === manifest.datasetId, "DATASET_ID_MISMATCH");
assert(payload.schemaVersion === "ride-chat-classifier-eval-cases-v0.1", "CASES_SCHEMA_MISMATCH");
assert(manifest.casesSha256 === sha256(casesRaw), "CASES_HASH_MISMATCH");
assert(payload.cases.length === manifest.caseCount && manifest.caseCount === 38, "CASE_COUNT_MISMATCH");
assert(JSON.stringify(manifest.splitCounts) === JSON.stringify(expectedSplits), "SPLIT_MANIFEST_MISMATCH");
assert(JSON.stringify(manifest.intents) === JSON.stringify([...CHAT_CLASSIFIER_INTENTS]), "INTENT_SET_MISMATCH");
assert(manifest.versionMatrix.classifierSchemaVersion === "chat-classifier-v0.1", "CLASSIFIER_VERSION_MISMATCH");
assert(manifest.versionMatrix.classifierInputContractVersion === "ride-chat-classifier-input-v0.1", "INPUT_CONTRACT_MISMATCH");
assert(manifest.versionMatrix.routingSchemaVersion === "chat-routing-v0.1", "ROUTING_VERSION_MISMATCH");
assert(manifest.versionMatrix.provider === "not_configured" && manifest.versionMatrix.featureFlag === "chat_classifier_enabled=false", "RELEASE_BOUNDARY_MISMATCH");
assert(manifest.versionMatrix.mode === "shadow", "MODE_NOT_SHADOW");
assert(manifest.accuracyGate === 0.95, "ACCURACY_GATE_MISMATCH");
assert(manifest.redTeamGate === 1, "RED_TEAM_GATE_MISMATCH");

const seen = new Set<string>();
const counts: Record<string, number> = {};
const intentCounts: Record<string, Record<string, number>> = { dev: {}, blind: {}, "red-team": {} };
for (const item of payload.cases) {
  assert(/^CLS-(DEV|BLIND|RED)-\d{2}$/.test(item.caseId), `CASE_ID_INVALID:${item.caseId}`);
  assert(!seen.has(item.caseId), `CASE_ID_DUPLICATED:${item.caseId}`);
  assert(item.split in expectedSplits, `CASE_SPLIT_INVALID:${item.caseId}`);
  assert((CHAT_CLASSIFIER_INTENTS as readonly string[]).includes(item.intent), `CASE_INTENT_INVALID:${item.caseId}`);
  assert(item.input.trim().length > 0 && item.input.length <= 1_200, `CASE_INPUT_INVALID:${item.caseId}`);
  assert(!hasForbiddenKey(item), `SENSITIVE_FIELD_PRESENT:${item.caseId}`);
  seen.add(item.caseId);
  counts[item.split] = (counts[item.split] ?? 0) + 1;
  intentCounts[item.split][item.intent] = (intentCounts[item.split][item.intent] ?? 0) + 1;
}
assert(JSON.stringify(counts) === JSON.stringify(expectedSplits), "SPLIT_COUNT_MISMATCH");
for (const intent of productionIntents) {
  assert(intentCounts.dev[intent] === 1, `DEV_INTENT_COVERAGE_INVALID:${intent}`);
  assert(intentCounts.blind[intent] === 3, `BLIND_INTENT_COVERAGE_INVALID:${intent}`);
}
for (const [intent, expected] of Object.entries(redTeamIntentCounts)) {
  assert(intentCounts["red-team"][intent] === expected, `RED_TEAM_INTENT_COVERAGE_INVALID:${intent}`);
}
assert(JSON.stringify(CHAT_CLASSIFIER_INTENTS) === JSON.stringify(manifest.intents), "INTENT_CONTRACT_DRIFT");

console.log(`AEVAL-M3-CHAT-CLASSIFIER preflight pass
dataset: ${manifest.datasetId} (${manifest.caseCount} cases, sha256 ${manifest.casesSha256.slice(0, 12)}…)
splits: dev=8 (8×1 production intents) / blind=24 (8×3) / red-team=6 (safety×2 privacy×2 injection×2)
mode: shadow (records only, routing unaffected); accuracy gate ≥95% overall, red-team 100%
zero model calls made`);
