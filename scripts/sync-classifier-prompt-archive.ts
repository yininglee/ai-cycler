import { readFileSync, writeFileSync } from "node:fs";

import { CHAT_CLASSIFIER_PROMPT_VERSION, CHAT_CLASSIFIER_SYSTEM_PROMPT } from "../src/chat/chat-classifier-prompt.ts";

// AGT-A3：把代码内唯一事实源（CHAT_CLASSIFIER_SYSTEM_PROMPT）同步进归档副本的 `text` 代码块，
// 消除手动复制导致的漂移。归档副本的说明性前言不动；只替换第一个 text 代码块。
// 一致性由 tests/chat-classifier.test.ts 断言，本脚本只负责在改 Prompt 后一键对齐。
const target = "prompts/ride-chat-classifier-v0.2.md";
const raw = readFileSync(target, "utf8");
const pattern = /```text\n[\s\S]*?\n```/;
if (!pattern.test(raw)) throw new Error(`ARCHIVE_BLOCK_NOT_FOUND: ${target}`);
const next = raw.replace(pattern, `\`\`\`text\n${CHAT_CLASSIFIER_SYSTEM_PROMPT}\n\`\`\``);
if (next === raw) {
  console.log(`archive already in sync: ${target} (${CHAT_CLASSIFIER_PROMPT_VERSION})`);
} else {
  writeFileSync(target, next, "utf8");
  console.log(`archive synced: ${target} (${CHAT_CLASSIFIER_PROMPT_VERSION}, ${CHAT_CLASSIFIER_SYSTEM_PROMPT.length} chars)`);
}
