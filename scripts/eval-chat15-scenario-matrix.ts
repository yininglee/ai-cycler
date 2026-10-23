import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createChatProvider, runChatAgent, type ChatProvider } from "../src/chat/chat-agent.ts";
import { createChatClassifier, resolveChatRouting } from "../src/chat/chat-classifier.ts";
import { routeChatInput } from "../src/chat/chat-routing.ts";
import { createChatToolRunner } from "../src/chat/chat-tool-orchestration.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import type { ServerEnvironment } from "../src/ai/coze-workflow-error.ts";

// CHAT-15 ④：场景工作流真实链路输出对齐——端到端场景回归采样（真实模型调用，需用户授权后手动执行）。
// 走与 app/api/chat/route.ts 同构的完整链路（网关 → active 分类器路由 → 真实 provider + 真实工具），
// 按场景 × 问题矩阵采样，统计 execution / repairAttempts / fallbackCode / validationCode 分布与
// OUTPUT_NUMERIC_UNSUPPORTED 的违规数字归因，验证 Prompt v0.1.4 + 场景化修复指令的效果。
// 运行记录写入 eval/runs/AEVAL-CHAT15-MATRIX-<时间戳>.json（不含 ownerId，仅记采样环境摘要）。

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
const provider = createChatProvider(environment) as ChatProvider;
if (!provider) {
  console.error("CHAT15_PROVIDER_NOT_CONFIGURED：需要 CHAT_PROVIDER_KIND=coze_workflow 且 COZE_CHAT_WORKFLOW_ID/VERSION、COZE_CHAT_API_URL/TOKEN 可用。");
  process.exit(2);
}

const repository = getApplicationRepository();

// ownerId：优先 AEVAL_CHAT15_OWNER_ID；默认取 .local-data 状态文件中记录最多的 owner（dev 会话用户）。
function resolveOwnerId(): { ownerId: string; rideCount: number } {
  const explicit = environment.AEVAL_CHAT15_OWNER_ID?.trim();
  const statePath = join(process.env.LOCAL_DATA_DIR || join(process.cwd(), ".local-data"), "application-state.json");
  let owners = new Map<string, number>();
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { rides?: Record<string, { ownerId?: string }> };
    for (const entry of Object.values(state.rides ?? {})) {
      if (entry.ownerId) owners.set(entry.ownerId, (owners.get(entry.ownerId) ?? 0) + 1);
    }
  } catch {
    owners = new Map();
  }
  if (explicit) {
    const rideCount = owners.get(explicit) ?? 0;
    if (rideCount === 0) {
      console.error(`CHAT15_OWNER_NOT_FOUND：AEVAL_CHAT15_OWNER_ID=${explicit} 名下没有骑行记录。`);
      process.exit(2);
    }
    return { ownerId: explicit, rideCount };
  }
  if (owners.size === 0) {
    console.error("CHAT15_OWNER_UNRESOLVED：无法从 .local-data 解析 owner，请设置 AEVAL_CHAT15_OWNER_ID（浏览器 /chat 会话 cookie 中的 local-user-*）。");
    process.exit(2);
  }
  const [ownerId, rideCount] = [...owners.entries()].sort((a, b) => b[1] - a[1])[0];
  return { ownerId, rideCount };
}

// 场景 × 问题矩阵（覆盖全部 4 个模型表达场景；history_compare/current_ride 各含 2 条高频问法）。
// CHAT-15 复盘修正：「我的骑行能力怎么样？」按 v0.2 分类器边界属 capability_gap（长期能力评估），
// 非 capabilities 工具场景——改用「目前可以分析哪些数据？」测 get_capabilities 真实链路，
// 并保留能力问法作为 capability_gap 边界核查点。
const MATRIX: Array<{ scenario: string; expectedRoute: string; question: string }> = [
  { scenario: "social", expectedRoute: "social", question: "你好" },
  { scenario: "current_ride", expectedRoute: "current_ride", question: "这次骑行数据怎么样？" },
  { scenario: "current_ride", expectedRoute: "current_ride", question: "本次骑行的平均功率是多少？" },
  { scenario: "capabilities", expectedRoute: "capabilities", question: "目前可以分析哪些数据？" },
  { scenario: "capabilities", expectedRoute: "capability_gap", question: "我的骑行能力怎么样？" },
  { scenario: "history_compare", expectedRoute: "history_compare", question: "这次比上一次骑得远了吗？" },
  { scenario: "history_compare", expectedRoute: "history_compare", question: "我最近的骑行有进步吗？" },
];

const SAMPLES_PER_QUESTION = Math.max(1, Math.min(20, Number(environment.AEVAL_CHAT15_SAMPLES ?? "10") || 10));
const DELAY_MS = Math.max(0, Math.min(5_000, Number(environment.AEVAL_CHAT15_DELAY_MS ?? "500") || 500));

const NUMBERS = /\d+(?:\.\d+)?/g;

function extractNumbers(text: string): number[] {
  return (text.match(NUMBERS) ?? []).map(Number).filter((value) => Number.isFinite(value));
}

type Sample = {
  question: string;
  expectedRoute: string;
  run: number;
  routedBy: string;
  finalRoute: string;
  routeOk: boolean;
  execution: string;
  modelInvoked: boolean;
  repairAttempts: number;
  fallbackCode?: string;
  validationCode?: string;
  replyChars: number;
  replyNumbers: number[];
  durationMs: number;
};

const { ownerId, rideCount } = resolveOwnerId();
const toolRunner = createChatToolRunner(repository, ownerId);
const classifier = createChatClassifier(environment);
console.log(`CHAT-15 scenario matrix | owner rides=${rideCount} | classifier=${classifier ? "enabled" : "not-configured"} | samples/question=${SAMPLES_PER_QUESTION}`);

const samples: Sample[] = [];
let runIndex = 0;

for (const entry of MATRIX) {
  for (let run = 1; run <= SAMPLES_PER_QUESTION; run += 1) {
    runIndex += 1;
    const requestId = `chat15-matrix:${runIndex}`;
    const startedAt = Date.now();
    const gateway = routeChatInput(ownerId, entry.question);
    if (!gateway.ok) {
      samples.push({ question: entry.question, expectedRoute: entry.expectedRoute, run, routedBy: "gateway", finalRoute: `error:${gateway.code}`, routeOk: false, execution: "gateway_rejected", modelInvoked: false, repairAttempts: 0, replyChars: 0, replyNumbers: [], durationMs: 0 });
      continue;
    }
    let decision = gateway.decision;
    let routedBy = "rules";
    // AGT-A1（D-A5）：单一启用语义——分类器未配置时 resolveChatRouting 返回规则基线。
    const resolution = await resolveChatRouting({ text: gateway.text, ruleDecision: gateway.decision, classifier, requestId });
    routedBy = resolution.routedBy;
    if (resolution.routedBy === "classifier_unavailable") {
      samples.push({ question: entry.question, expectedRoute: entry.expectedRoute, run, routedBy, finalRoute: "classifier_unavailable", routeOk: false, execution: "routing_unavailable", modelInvoked: false, repairAttempts: 0, replyChars: 0, replyNumbers: [], durationMs: Math.round(Date.now() - startedAt) });
      continue;
    }
    decision = resolution.decision ?? gateway.decision;
    const result = await runChatAgent({ text: gateway.text, decision, provider, toolRunner, requestId });
    samples.push({
      question: entry.question,
      expectedRoute: entry.expectedRoute,
      run,
      routedBy,
      finalRoute: result.decision.route,
      routeOk: result.decision.route === entry.expectedRoute,
      execution: result.execution,
      modelInvoked: result.modelInvoked,
      repairAttempts: result.repairAttempts ?? 0,
      ...(result.fallbackCode ? { fallbackCode: result.fallbackCode } : {}),
      ...(result.outputValidation?.code ? { validationCode: result.outputValidation.code } : {}),
      replyChars: result.reply.length,
      replyNumbers: extractNumbers(result.reply),
      durationMs: Date.now() - startedAt,
    });
    const last = samples[samples.length - 1];
    console.log(`${entry.expectedRoute === last.finalRoute ? "ROUTE-OK" : "ROUTE-MISS"} [${entry.scenario}] #${run} route=${last.finalRoute}(${routedBy}) exec=${last.execution} repair=${last.repairAttempts}${last.fallbackCode ? ` fallback=${last.fallbackCode}` : ""}${last.validationCode ? ` code=${last.validationCode}` : ""} ${last.durationMs}ms`);
    if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
}

// 汇总：场景级 execution / fallback / 校验码分布 + 路由正确性（active 分类器核查点）。
function distribution(items: Sample[], key: "execution" | "fallbackCode" | "validationCode" | "finalRoute" | "routedBy"): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = item[key] ?? "none";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

const byScenario = (scenario: string) => samples.filter((item) => MATRIX.some((entry) => entry.question === item.question && entry.scenario === scenario));
const scenarioSummary = ["social", "current_ride", "capabilities", "history_compare"].map((scenario) => {
  const items = byScenario(scenario);
  return {
    scenario,
    total: items.length,
    routeOk: items.filter((item) => item.routeOk).length,
    validatedFirstPass: items.filter((item) => item.execution === "validated").length,
    repaired: items.filter((item) => item.execution === "repaired").length,
    fallback: items.filter((item) => item.fallbackCode).length,
    execution: distribution(items, "execution"),
    fallbackCode: distribution(items, "fallbackCode"),
    validationCode: distribution(items, "validationCode"),
    finalRoute: distribution(items, "finalRoute"),
  };
});

// 归因：OUTPUT_NUMERIC_UNSUPPORTED / REPAIR_FAILED 样本的违规数字提取
// （repair 失败样本只有最终回复数字；首轮违规数字见服务端日志 chat-trace）。
const numericFailures = samples
  .filter((item) => item.validationCode === "OUTPUT_NUMERIC_UNSUPPORTED" || item.fallbackCode === "REPAIR_FAILED")
  .map((item) => ({ question: item.question, run: item.run, execution: item.execution, validationCode: item.validationCode, fallbackCode: item.fallbackCode, replyNumbers: item.replyNumbers }));

const total = samples.length;
const routeOkTotal = samples.filter((item) => item.routeOk).length;
const validatedFirstPass = samples.filter((item) => item.execution === "validated").length;
const repairedTotal = samples.filter((item) => item.execution === "repaired").length;
const fallbackTotal = samples.filter((item) => item.fallbackCode).length;

console.log(`
CHAT-15 scenario matrix report
  total=${total} routeOk=${routeOkTotal} validated(first-pass)=${validatedFirstPass} repaired=${repairedTotal} fallback=${fallbackTotal}
  by-scenario: ${JSON.stringify(scenarioSummary)}
  numeric-failures: ${numericFailures.length}
`);

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "");
const runRecord = {
  runId: `AEVAL-CHAT15-MATRIX-${timestamp}`,
  task: "CHAT-15",
  kind: "scenario-matrix-real-model",
  createdAt: new Date().toISOString(),
  environment: {
    classifierEnabled: Boolean(classifier),
    samplesPerQuestion: SAMPLES_PER_QUESTION,
    questions: MATRIX.length,
    ownerRideCount: rideCount,
    delayMs: DELAY_MS,
  },
  matrix: MATRIX,
  scenarioSummary,
  numericFailures,
  samples,
};

mkdirSync("eval/runs", { recursive: true });
writeFileSync(`eval/runs/${runRecord.runId}.json`, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
console.log(`run record → eval/runs/${runRecord.runId}.json`);
