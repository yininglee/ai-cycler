// AGT-A0 验收 smoke：对话链路（主对话 + 分类器）真实调用硅基流动各 1 次，验证
// Prompt 迁入代码库后的端到端可用性。用法：node --experimental-strip-types scripts/smoke-siliconflow-chat.ts
// 需要 .env.local 中 CHAT_MODEL_ENABLED=true、SILICONFLOW_API_TOKEN 已配置。
import { readFileSync } from "node:fs";

import { createChatProvider } from "../src/chat/chat-agent.ts";
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
  // 无 .env.local 时仅用进程环境
}

const provider = createChatProvider(environment);
if (!provider) {
  console.error("SMOKE_FAIL: chat provider not configured (CHAT_MODEL_ENABLED / SILICONFLOW_API_TOKEN)");
  process.exit(2);
}
const chatResult = await provider.run({
  requestId: "smoke-siliconflow-chat",
  agentVersion: "ride-chat-agent-v0.1",
  route: "social",
  text: "你好呀，最近 riding 情况怎么样？",
});
console.log("CHAT_RAW:", chatResult.rawText.slice(0, 400));

// FORCE_CLASSIFIER=1 可在 CHAT_CLASSIFIER_ENABLED=false 的 A0 中间态强制跑一次真实分类调用
// （用于验收验证 v0.3 prompt + 硅基流动模型的端到端可用性，不改变 .env.local）。
if (process.env.FORCE_CLASSIFIER === "1") environment.CHAT_CLASSIFIER_ENABLED = "true";

const classifier = createChatClassifier(environment);
if (!classifier) {
  console.log("CLASSIFIER: not enabled (CHAT_CLASSIFIER_ENABLED != true) — skip（A0 中间态预期）");
} else {
  const classified = await classifier.classify({ requestId: "smoke-siliconflow-classifier", text: "我总共骑了多少公里？" });
  console.log("CLASSIFIER_RAW:", JSON.stringify(classified));
}
console.log("SMOKE_OK");
