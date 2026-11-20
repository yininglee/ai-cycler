// 分类器评测成本实测：对给定用例发真实调用并打印 usage，用于 A5 全量 Run 的成本预算。
// 用法：node --experimental-strip-types scripts/measure-classifier-token-usage.ts [样本数]
// 只发少量调用（默认 3 条代表性用例），不做准确率判定，不写 run 记录。
import { readFileSync } from "node:fs";

import { CHAT_CLASSIFIER_SCHEMA_VERSION, readSiliconFlowClassifierConfig } from "../src/chat/chat-classifier.ts";
import { buildChatClassifierUserPrompt, CHAT_CLASSIFIER_SYSTEM_PROMPT } from "../src/chat/chat-classifier-prompt.ts";

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

const config = readSiliconFlowClassifierConfig(environment);
if (!config) {
  console.error("CLASSIFIER_NOT_CONFIGURED：需要 SILICONFLOW_API_TOKEN");
  process.exit(2);
}

const dataset = JSON.parse(readFileSync("eval/ride-chat-classifier-v0.4/cases.json", "utf8")) as {
  cases: Array<{ caseId: string; input: string }>;
};
// 取样：最短、中位、最长各一条（token 上限由最长例决定，均值由中位代表）
const sorted = [...dataset.cases].sort((a, b) => a.input.length - b.input.length);
const samples = [sorted[0]!, sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!];
const limit = Math.max(1, Math.min(samples.length, Number(process.argv[2] ?? samples.length)));

let promptTotal = 0;
let completionTotal = 0;
for (const sample of samples.slice(0, limit)) {
  const body = JSON.stringify({
    model: config.modelId,
    messages: [
      { role: "system", content: CHAT_CLASSIFIER_SYSTEM_PROMPT },
      { role: "user", content: buildChatClassifierUserPrompt(JSON.stringify({
        agent: "ride_chat_v1",
        classifierVersion: CHAT_CLASSIFIER_SCHEMA_VERSION,
        text: sample.input,
      })) },
    ],
    temperature: 0.3,
    enable_thinking: false,
    response_format: { type: "json_object" },
    max_tokens: 256,
  });
  const startedAt = Date.now();
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`FAIL ${sample.caseId} status=${response.status} ${text.slice(0, 200)}`);
    process.exit(1);
  }
  const envelope = JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const promptTokens = envelope.usage?.prompt_tokens ?? 0;
  const completionTokens = envelope.usage?.completion_tokens ?? 0;
  promptTotal += promptTokens;
  completionTotal += completionTokens;
  console.log(`${sample.caseId} (${sample.input.length} chars) prompt=${promptTokens} completion=${completionTokens} ${Date.now() - startedAt}ms`);
}

const calls = samples.length;
const avgPrompt = Math.round(promptTotal / calls);
const avgCompletion = Math.round(completionTotal / calls);
const totalCases = dataset.cases.length;
console.log(`
per-call (avg of ${calls} samples): prompt=${avgPrompt} tokens · completion=${avgCompletion} tokens
full run (${totalCases} cases × 1): prompt=${avgPrompt * totalCases} · completion=${avgCompletion * totalCases} tokens
model: ${config.modelId}
单价请按硅基流动控制台当前价目折算：成本 ≈ (输入 tokens / 1e6 × 输入单价) + (输出 tokens / 1e6 × 输出单价)`);
