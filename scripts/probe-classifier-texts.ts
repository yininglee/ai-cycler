// A5 bad case 归因探针：把任意文本送进分类器，打印 intent，用于确认"触发词假设"。
// 用法：node --experimental-strip-types scripts/probe-classifier-texts.ts "文本1" "文本2" ...
// 只做归因诊断，不写 run 记录、不计入准确率。
import { readFileSync } from "node:fs";

import { createChatClassifier } from "../src/chat/chat-classifier.ts";

const environment: Record<string, string | undefined> = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2] ?? "";
    environment[match[1]] = /^".*"$/.test(value) || /^'.*'$/.test(value) ? value.slice(1, -1) : value;
  }
} catch {
  // 仅用进程环境
}
environment.CHAT_CLASSIFIER_ENABLED = "true";

const classifier = createChatClassifier(environment);
if (!classifier) {
  console.error("CLASSIFIER_NOT_CONFIGURED");
  process.exit(2);
}

const texts = process.argv.slice(2);
if (texts.length === 0) {
  console.error("用法：probe-classifier-texts.ts \"文本1\" \"文本2\" ...");
  process.exit(2);
}

for (const text of texts) {
  try {
    const result = await classifier.classify({ requestId: `probe:${Date.now()}`, text });
    console.log(`${result.intent.padEnd(21)} | ${text}`);
  } catch (cause) {
    console.log(`ERROR ${cause instanceof Error ? cause.message : String(cause)} | ${text}`);
  }
}
