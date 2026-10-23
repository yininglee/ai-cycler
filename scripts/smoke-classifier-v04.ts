// AGT-A3 验收 smoke：分类器 Prompt v0.4 真实调用（硅基流动），验证 16 意图合同端到端可用。
// 用法：node --experimental-strip-types scripts/smoke-classifier-v04.ts
// 需要 .env.local 中 SILICONFLOW_API_TOKEN；脚本仅在进程内强制 CHAT_CLASSIFIER_ENABLED=true，
// 不改写 .env.local（A0~A5 中间态线上仍走规则基线）。
// 探针取自标注集 dev split（不取 blind：避免"看盲例→改 prompt"的评测泄漏）；
// 这里只做可用性 smoke，不作为准确率证据——准确率由 AGT-A5 的全新 Run 承担。
import { readFileSync } from "node:fs";

import { CHAT_CLASSIFIER_SCHEMA_VERSION, createChatClassifier } from "../src/chat/chat-classifier.ts";

const environment: Record<string, string | undefined> = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2] ?? "";
    environment[match[1]] = /^".*"$/.test(value) || /^'.*'$/.test(value) ? value.slice(1, -1) : value;
  }
} catch {
  // 无 .env.local 时仅用进程环境
}
environment.CHAT_CLASSIFIER_ENABLED = "true";

const probes = [
  { expected: "training_plan", text: "帮我安排下周的骑行训练" },
  { expected: "training_supervision", text: "今天这课完成度怎么样？" },
  { expected: "kb_qa", text: "为什么要做区间训练？" },
  { expected: "capability_gap", text: "能把骑行记录同步到 Strava 吗？" },
  { expected: "companion", text: "你好呀，最近过得怎么样？" },
  { expected: "level_assessment", text: "我的骑行能力水平怎么样？" },
  { expected: "open_chat", text: "距离最远的那次骑行，平均心率是多少？" },
  { expected: "aggregate", text: "我总共骑了多少公里？" },
];

const classifier = createChatClassifier(environment);
if (!classifier) {
  console.error("SMOKE_FAIL: classifier not configured (SILICONFLOW_API_TOKEN)");
  process.exit(2);
}

let schemaValid = 0;
let matched = 0;
for (const probe of probes) {
  const startedAt = Date.now();
  try {
    const result = await classifier.classify({ requestId: `smoke-v04:${probe.expected}`, text: probe.text });
    const schemaOk = result.schemaVersion === CHAT_CLASSIFIER_SCHEMA_VERSION;
    if (schemaOk) schemaValid += 1;
    if (result.intent === probe.expected) matched += 1;
    console.log(`${result.intent === probe.expected ? "HIT " : "MISS"} [${probe.expected} → ${result.intent}] needsClarification=${result.needsClarification} schema=${result.schemaVersion} ${Date.now() - startedAt}ms | ${probe.text}`);
  } catch (cause) {
    console.log(`FAIL [${probe.expected}] ${cause instanceof Error ? cause.message : String(cause)} | ${probe.text}`);
  }
}

console.log(`\nsmoke summary: schema ${schemaValid}/${probes.length} · intent ${matched}/${probes.length} (advisory only, not an accuracy gate)`);
if (schemaValid !== probes.length) {
  console.error("SMOKE_FAIL: some responses did not satisfy chat-classifier-v0.2");
  process.exit(1);
}
console.log("SMOKE_OK");
