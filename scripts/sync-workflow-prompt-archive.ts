import { readFileSync, writeFileSync } from "node:fs";

import { CHAT_WORKFLOW_PROMPT_VERSION, CHAT_WORKFLOW_SYSTEM_PROMPT } from "../src/chat/chat-workflow-prompt.ts";

// AGT-B0：把代码内唯一事实源（CHAT_WORKFLOW_SYSTEM_PROMPT）同步进归档副本的第一个
// `text` 代码块（系统提示词）——与 `prompt:classifier:sync` 同一模式，消除手动复制漂移。
// 归档副本的说明性前言与用户输入提示词块不动。
// 一致性由 tests/chat-b0-contracts.test.ts 断言，本脚本只负责改完 Prompt 后一键对齐。
const target = "prompts/ride-chat-workflow-v0.1.md";
const raw = readFileSync(target, "utf8");
const pattern = /```text\n[\s\S]*?\n```/;
if (!pattern.test(raw)) throw new Error(`ARCHIVE_BLOCK_NOT_FOUND: ${target}`);
const next = raw.replace(/当前 Prompt 版本：`[^`]+`/, `当前 Prompt 版本：\`${CHAT_WORKFLOW_PROMPT_VERSION}\``).replace(pattern, `\`\`\`text\n${CHAT_WORKFLOW_SYSTEM_PROMPT}\n\`\`\``);
if (next === raw) {
  console.log(`archive already in sync: ${target} (${CHAT_WORKFLOW_PROMPT_VERSION})`);
} else {
  writeFileSync(target, next, "utf8");
  console.log(`archive synced: ${target} (${CHAT_WORKFLOW_PROMPT_VERSION}, ${CHAT_WORKFLOW_SYSTEM_PROMPT.length} chars)`);
}
