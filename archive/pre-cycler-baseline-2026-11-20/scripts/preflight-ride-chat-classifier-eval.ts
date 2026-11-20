import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CHAT_CLASSIFIER_INTENTS, CHAT_CLASSIFIER_SCHEMA_VERSION } from "../src/chat/chat-classifier.ts";
import { CHAT_CLASSIFIER_PROMPT_VERSION } from "../src/chat/chat-classifier-prompt.ts";

const root = "eval/ride-chat-classifier-v0.5";
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
const raw = await readFile(`${root}/cases.json`, "utf8");
const payload = JSON.parse(raw);
assert.equal(manifest.schemaVersion, "ride-chat-classifier-eval-manifest-v0.5");
assert.equal(payload.schemaVersion, "ride-chat-classifier-eval-cases-v0.5");
assert.equal(manifest.casesSha256, createHash("sha256").update(raw).digest("hex"));
assert.equal(manifest.caseCount, payload.cases.length);
assert.equal(manifest.versionMatrix.classifierSchemaVersion, CHAT_CLASSIFIER_SCHEMA_VERSION);
assert.equal(manifest.versionMatrix.promptVersion, CHAT_CLASSIFIER_PROMPT_VERSION);
assert.deepEqual(manifest.intents, CHAT_CLASSIFIER_INTENTS);
const ids = new Set<string>();
for (const item of payload.cases) {
  assert.ok(!ids.has(item.caseId));
  ids.add(item.caseId);
  assert.ok(CHAT_CLASSIFIER_INTENTS.includes(item.intent));
  assert.ok(item.input.trim());
  assert.ok(["dev", "red-team"].includes(item.split));
}
for (const intent of CHAT_CLASSIFIER_INTENTS) assert.ok(payload.cases.some((item: { intent: string }) => item.intent === intent));
console.log(`Boundary regression assets valid: ${payload.cases.length} known cases. No new blind accuracy claim.`);
