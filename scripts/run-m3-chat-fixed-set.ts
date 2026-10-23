import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHAT_AGENT_SCHEMA_VERSION,
  createChatProvider,
  runChatAgent,
  type ChatAgentResult,
  type ChatProvider,
  type ChatProviderInvocation,
} from "../src/chat/chat-agent.ts";
import {
  createChatClassifier,
  resolveChatRouting,
  routingEventAttributes,
  type ChatClassifierOutcome,
} from "../src/chat/chat-classifier.ts";
import { RIDE_IDENTITY, routeChatInput } from "../src/chat/chat-routing.ts";
import {
  CHAT_TOOL_CALL_SCHEMA_VERSION,
  CHAT_TOOL_LOOP_MAX_PROVIDER_CALLS,
  createChatToolLoopRunner,
  createChatToolRunner,
  type ChatToolLoopRunner,
} from "../src/chat/chat-tool-orchestration.ts";
import { createDemoEvent, demoRequestReference, type DemoEvent } from "../src/observability/demo-events.ts";
import { getApplicationRepository, type ApplicationRepository } from "../src/persistence/application-repository.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import type { ServerEnvironment } from "../src/ai/coze-workflow-error.ts";

// M3 里程碑收口：G3-C/G4-C 真实模型固定集 Run（需用户授权后手动执行，新 Run ID，不覆盖历史记录）。
// CHAT-17（固定集 v0.6，27→34）：+7 L2b 自主工具循环用例——find_ride 极值检索/复合问题成功（真实
// 模型驱动循环）、无匹配零输出降级（真实模型触发 find_ride 无命中）、预算耗尽/白名单外工具/越权
// 锚点（脚本化 Provider 确定性注入，真实模型无法稳定触发预算边界）、Demo 无模型降级。
//
// 与 app/api/chat/route.ts 同构的完整链路（网关 → active 分类器路由 → 工具/L2b 循环 → 真实 provider
// → 输出校验），逐条执行 eval/ride-chat-v0.1/cases.json 冻结的 34 条固定集用例并按冻结期望断言：
// - G1-C：路由/红线模板/澄清/聚合/能力缺口全部零模型直答（真实分类器接管下复核）；
// - G2-C：只读工具范围（单工具 + L2b 循环步骤）、锚点解析（显式日期/序数/指涉澄清）、owner 隔离探针；
// - G3-C：模型路径输出必须通过 ride-chat-output-v0.1 校验（validated/repaired），一次修复边界；
// - G4-C：chat_* 事件 HMAC 脱敏（requestRef 短引用、属性白名单、无原文）+ 合成 owner 账户级联删除回归。
//
// 工具数据采用受控 fixture 仓储（与固定集期望的数据状态一致——冻结期望按 cases.json 的 fixture 字段
// 注入：no-current-ride/tool-timeout/empty-claims/no-comparable-history/loop-* 等）；模型与分类器为
// 真实扣子 Workflow 调用。真实开发数据集的场景采样已由 CHAT-15 矩阵 Run 覆盖（见测评记录 9.6.2），
// 不在此重复。运行记录写入 eval/runs/AEVAL-M3-CHAT-<日期>-<序号>.json（合成 owner，不含真实用户数据）。

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

// ---------------------------------------------------------------- 固定集资产校验

type FixedCase = {
  caseId: string;
  split: string;
  category: string;
  input: string;
  fixture?: string;
  expected: {
    route: string;
    action?: string;
    provider?: string;
    fallbackCode?: string;
    tool?: string;
    dimensions?: string[];
    repairAttempts?: number;
    execution?: string;
    degradation?: string;
    eventContract?: string;
    // CHAT-17 P6：L2b 循环结局（loopTrace.status）。
    loopStatus?: string;
  };
};

const manifest = JSON.parse(readFileSync("eval/ride-chat-v0.1/manifest.json", "utf8")) as {
  datasetId: string;
  casesSha256: string;
  caseCount: number;
  splitCounts: Record<string, number>;
};
const casesRaw = readFileSync("eval/ride-chat-v0.1/cases.json", "utf8");
const casesSha256 = createHash("sha256").update(casesRaw).digest("hex");
const fixedSet = JSON.parse(casesRaw) as { datasetId: string; cases: FixedCase[] };
if (manifest.datasetId !== "AEVAL-M3-CHAT" || fixedSet.datasetId !== "AEVAL-M3-CHAT") {
  console.error("M3CHAT_ASSET_MISMATCH：datasetId 不是 AEVAL-M3-CHAT。");
  process.exit(2);
}
if (casesSha256 !== manifest.casesSha256 || fixedSet.cases.length !== manifest.caseCount) {
  console.error(`M3CHAT_ASSET_HASH_MISMATCH：cases.json SHA-256 ${casesSha256} 与冻结 manifest 不一致（或案例数 ${fixedSet.cases.length} ≠ ${manifest.caseCount}）。`);
  process.exit(2);
}

// ---------------------------------------------------------------- Provider / 分类器

const realProvider = createChatProvider(environment) as ChatProvider | undefined;
if (!realProvider) {
  console.error("M3CHAT_PROVIDER_NOT_CONFIGURED：需要 CHAT_MODEL_ENABLED=true 且 SILICONFLOW_API_TOKEN 可用（可选 SILICONFLOW_CHAT_MODEL_ID 覆盖）。");
  process.exit(2);
}

let classifier: ReturnType<typeof createChatClassifier> | undefined;
let classifierConfigInvalid = false;
try {
  classifier = createChatClassifier(environment);
} catch {
  classifier = undefined;
  classifierConfigInvalid = true;
}
if (!classifier) {
  console.error(`M3CHAT_CLASSIFIER_UNAVAILABLE：分类器未配置${classifierConfigInvalid ? "（配置非法）" : ""}，真实固定集 Run 不应在降级路由下执行。`);
  process.exit(2);
}

// ---------------------------------------------------------------- 受控 fixture 仓储

const RUN_OWNER = "aeval-m3-chat-runner";
const OTHER_OWNER = "aeval-m3-chat-other";

function anchoredRecord(rideId: string, startTime: string): RideRecord {
  const fixture = getRideFixture("l3-fit-power");
  return {
    activity: { ...structuredClone(fixture.activity), rideId, startTime },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

// 与 tests/ride-chat-eval-fixed-set.test.ts 相同的三条锚点记录（出发时间最新为 2026-08-20，
// Asia/Shanghai 日历日），保证固定集冻结期望（显式日期/序数锚定、比较可比、澄清话术日期）可复现。
const STANDARD_RECORDS: RideRecord[] = [
  anchoredRecord("ride-0812", "2026-08-12T18:30:00+08:00"),
  anchoredRecord("ride-0815", "2026-08-15T08:00:00Z"),
  anchoredRecord("ride-0820", "2026-08-20T08:00:00Z"),
];

function shortFitRecord(): RideRecord {
  const fixture = getRideFixture("short-fit-ride");
  return { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
}

function fixtureRepository(records: RideRecord[], options?: { hangListMs?: number }): ApplicationRepository {
  const clone = () => records.map((record) => ({ record: structuredClone(record), storedAt: "2026-09-01T00:00:00.000Z" }));
  return {
    listRides: async (ownerId: string) => {
      if (options?.hangListMs) await new Promise((resolve) => setTimeout(resolve, options.hangListMs));
      return ownerId === RUN_OWNER ? clone() : [];
    },
    getRide: async (ownerId: string, rideId: string) => (ownerId === RUN_OWNER ? records.find((record) => record.activity.rideId === rideId) ?? null : null),
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
}

const repos: Record<string, ApplicationRepository> = {
  default: fixtureRepository(STANDARD_RECORDS),
  "no-current-ride": fixtureRepository([]),
  // 编排超时 2000ms（CHAT_TOOL_ORCHESTRATION_TIMEOUT_MS）先于 2600ms 的仓储延迟触发 → TOOLS_TIMEOUT。
  "tool-timeout": fixtureRepository(STANDARD_RECORDS, { hangListMs: 2_600 }),
  "empty-claims": fixtureRepository([shortFitRecord()]),
  "no-comparable-history": fixtureRepository([anchoredRecord("ride-0820", "2026-08-20T08:00:00Z")]),
};

// CHAT-REG-05（invalid-then-valid-provider）：首轮返回确定性非法输出（social 场景 claimIds 非空 →
// OUTPUT_CLAIM_INVALID），修复轮委托真实 provider——验证真实模型的修复链路而非脚本自证。
const INVALID_FIRST_OUTPUT = JSON.stringify({
  schemaVersion: "ride-chat-output-v0.1",
  route: "social",
  reply: "你好！很高兴见到你。",
  claimIds: ["claim:context:1"],
  capabilityKeys: [],
});

function invalidThenValidProvider(real: ChatProvider): ChatProvider {
  let calls = 0;
  return {
    async run(input: ChatProviderInvocation) {
      calls += 1;
      if (calls === 1) return { rawText: INVALID_FIRST_OUTPUT };
      return real.run(input);
    },
  };
}

// CHAT-17 P6：L2b 循环失败注入 Provider——预算耗尽/白名单外工具/越权锚点三类确定性降级
// 无法由真实模型稳定触发（预算边界取决于模型行为），按 invalid-then-valid-provider 同一
// 注入模式脚本化驱动；工具执行仍走受控 fixture 仓储的真实循环 runner。
function toolCallResponse(calls: ReadonlyArray<{ tool: string; input: Record<string, unknown> }>): string {
  return JSON.stringify({ schemaVersion: CHAT_TOOL_CALL_SCHEMA_VERSION, calls: calls.map((call) => ({ tool: call.tool, input: call.input })) });
}

function staticResponseProvider(rawText: string): ChatProvider {
  return { async run() { return { rawText }; } };
}

// 预算耗尽注入：模型每轮都请求同一检索（合法调用），第 4 次请求超出每轮工具数上限（3）。
const LOOP_BUDGET_EXHAUSTION_OUTPUT = toolCallResponse([{ tool: "find_ride", input: { metric: "distanceM", mode: "max" } }]);
// 白名单外工具注入：请求 forbiddenCapabilities 清单内的 get_profile_context（个人画像上下文）。
const LOOP_FORBIDDEN_TOOL_OUTPUT = toolCallResponse([{ tool: "get_profile_context", input: {} }]);
// 越权锚点注入：get_ride_context 指定非本轮锚点/工具结果返回的 rideId（他人记录）。
const LOOP_UNAUTHORIZED_RIDE_OUTPUT = toolCallResponse([{ tool: "get_ride_context", input: { rideId: "ride-other-owner-0820", dims: ["heart_rate"] } }]);

function observedProvider(provider: ChatProvider, metrics: { calls: number; durations: number[] }): ChatProvider {
  return {
    async run(input: ChatProviderInvocation) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        return await provider.run(input);
      } finally {
        metrics.durations.push(Date.now() - startedAt);
      }
    },
  };
}

function observedToolRunner(runner: ReturnType<typeof createChatToolRunner>, metrics: { calls: number; durations: number[] }) {
  return {
    async run(input: Parameters<typeof runner.run>[0]) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        return await runner.run(input);
      } finally {
        metrics.durations.push(Date.now() - startedAt);
      }
    },
  };
}

// CHAT-17 P6：L2b 循环 runner 观测（与 app/api/chat/route.ts 同构——观测 startLoop，循环步骤
// 轨迹由 loopTrace 承载）。
function observedToolLoopRunner(runner: ChatToolLoopRunner, metrics: { calls: number; durationMs: number }): ChatToolLoopRunner {
  return {
    async startLoop(input: Parameters<ChatToolLoopRunner["startLoop"]>[0]) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        return await runner.startLoop(input);
      } finally {
        metrics.durationMs += Date.now() - startedAt;
      }
    },
    executeLoopCalls: (input) => runner.executeLoopCalls(input),
  };
}

// ---------------------------------------------------------------- 事件记录（G4-C）

const eventRepository = getApplicationRepository();
const createdEvents: DemoEvent[] = [];

async function recordChatEvent(type: "chat_requested" | "chat_completed" | "chat_degraded", requestId: string, attributes: Record<string, string>): Promise<void> {
  try {
    const event = createDemoEvent({ type, requestId, attributes });
    createdEvents.push(event);
    await eventRepository.saveDemoEvent(RUN_OWNER, event);
  } catch {
    // 观测失败不改变主链路（与 route.ts 一致），但会体现在事件回读核验的缺口中。
  }
}

// ---------------------------------------------------------------- 执行

const DELAY_MS = Math.max(0, Number(environment.AEVAL_M3_CHAT_DELAY_MS ?? "3200") || 3200);

type CaseCheck = { name: string; ok: boolean; detail?: string };
type CaseResult = {
  caseId: string;
  split: string;
  category: string;
  input: string;
  fixture: string;
  ruleRoute: string;
  finalRoute: string;
  routedBy: string;
  classifierIntent?: string;
  execution: string;
  modelInvoked: boolean;
  modelCalls: number;
  repairAttempts: number;
  fallbackCode?: string;
  validationCode?: string;
  validationStatus: string;
  tool?: string;
  dimensions?: string[];
  claimsCount?: number;
  rideAnchor?: string;
  // CHAT-17 P6：L2b 循环轨迹（autonomous_tools 路由）。
  loopStatus?: string;
  loopTools?: string[];
  reply: string;
  durationMs: number;
  checks: CaseCheck[];
  passed: boolean;
};

function check(checks: CaseCheck[], name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
}

const caseResults: CaseResult[] = [];
const modelDurationsAll: number[] = [];
const classifierDurationsAll: number[] = [];
const stopConditions: Array<{ name: string; violated: boolean; detail: string }> = [];

console.log(`M3 chat fixed set (real model) | cases=${fixedSet.cases.length} | classifier=enabled | provider=siliconflow:${environment.SILICONFLOW_CHAT_MODEL_ID ?? "deepseek-ai/DeepSeek-V3.2"} | delayMs=${DELAY_MS}`);

for (const item of fixedSet.cases) {
  const fixture = item.fixture ?? "default";
  const startedAt = Date.now();
  const requestId = `m3-fixed-set:${item.caseId}`;
  const modelMetrics = { calls: 0, durations: [] as number[] };
  const toolMetrics = { calls: 0, durations: [] as number[] };
  const loopMetrics = { calls: 0, durationMs: 0 };
  const checks: CaseCheck[] = [];

  const gateway = routeChatInput(RUN_OWNER, item.input);
  if (!gateway.ok) {
    caseResults.push({
      caseId: item.caseId, split: item.split, category: item.category, input: item.input, fixture,
      ruleRoute: "gateway_rejected", finalRoute: `error:${gateway.code}`, routedBy: "gateway",
      execution: "gateway_rejected", modelInvoked: false, modelCalls: 0, repairAttempts: 0,
      validationStatus: "not_run", reply: "", durationMs: 0,
      checks: [{ name: "gateway", ok: false, detail: gateway.code }], passed: false,
    });
    console.log(`FAIL [${item.caseId}] gateway rejected code=${gateway.code}`);
    continue;
  }

  let decision = gateway.decision;
  let routedBy: "rules" | "rules_l0" | "classifier" | "classifier_unavailable" = "rules";
  let routingOutcome: ChatClassifierOutcome | undefined;
  let configStatus: "not_configured" | "CLASSIFIER_CONFIG_INVALID" | undefined;
  // AGT-A1（D-A5）：单一启用语义——分类器必配置（上方 gate 已保证），失败走终局降级。
  {
    const resolution = await resolveChatRouting({ text: gateway.text, ruleDecision: gateway.decision, classifier, requestId });
    routedBy = resolution.routedBy;
    routingOutcome = resolution.outcome;
    configStatus = resolution.configStatus;
    decision = resolution.decision ?? gateway.decision;
  }
  if (routingOutcome?.status === "ok") classifierDurationsAll.push(routingOutcome.durationMs);

  await recordChatEvent("chat_requested", requestId, {
    agentVersion: CHAT_AGENT_SCHEMA_VERSION,
    route: decision.route,
    summariesCount: "0",
    ...routingEventAttributes({ routedBy, route: decision.route, outcome: routingOutcome, configStatus }),
    tokenStatus: "not_observed",
    costStatus: "not_observed",
  });

  const repository = repos[fixture] ?? repos.default;
  const providerForCase =
    fixture === "provider-not-configured" ? undefined :
    fixture === "invalid-then-valid-provider" ? observedProvider(invalidThenValidProvider(realProvider), modelMetrics) :
    fixture === "loop-budget-exhaustion-provider" ? observedProvider(staticResponseProvider(LOOP_BUDGET_EXHAUSTION_OUTPUT), modelMetrics) :
    fixture === "loop-forbidden-tool-provider" ? observedProvider(staticResponseProvider(LOOP_FORBIDDEN_TOOL_OUTPUT), modelMetrics) :
    fixture === "loop-unauthorized-ride-provider" ? observedProvider(staticResponseProvider(LOOP_UNAUTHORIZED_RIDE_OUTPUT), modelMetrics) :
    observedProvider(realProvider, modelMetrics);
  const aggregateRecords = decision.route === "aggregate" ? STANDARD_RECORDS.map((record) => structuredClone(record)) : undefined;

  const result: ChatAgentResult = await runChatAgent({
    text: gateway.text,
    decision,
    provider: providerForCase,
    toolRunner: observedToolRunner(createChatToolRunner(repository, RUN_OWNER), toolMetrics),
    // CHAT-17 P6：L2b 循环 runner（autonomous_tools 路由；非该路由不启用）。
    loopRunner: observedToolLoopRunner(createChatToolLoopRunner(repository, RUN_OWNER), loopMetrics),
    requestId,
    ...(aggregateRecords ? { aggregateRecords } : {}),
  });

  const eventType = result.fallbackCode || result.execution === "validation_rejected" ? "chat_degraded" : "chat_completed";
  await recordChatEvent(eventType, requestId, {
    agentVersion: result.schemaVersion,
    route: result.decision.route,
    execution: result.execution,
    modelInvoked: String(result.modelInvoked),
    modelCalls: String(modelMetrics.calls),
    modelDurationMs: String(modelMetrics.durations.reduce((sum, value) => sum + value, 0)),
    toolCalls: String(toolMetrics.calls),
    toolDurationMs: String(toolMetrics.durations.reduce((sum, value) => sum + value, 0)),
    repairAttempts: String(result.repairAttempts ?? 0),
    toolStatus: result.toolTrace?.status ?? "not_called",
    validationStatus: result.outputValidation?.status ?? "not_run",
    // CHAT-17 P6：L2b 循环轨迹（脱敏：状态/预算计数/步骤状态序列，与 route.ts 同构）。
    ...(result.loopTrace ? {
      loopStatus: result.loopTrace.status,
      loopToolCalls: String(result.loopTrace.toolCalls),
      loopProviderCalls: String(result.loopTrace.providerCalls),
      loopSteps: result.loopTrace.steps.map((step) => `${step.tool}:${step.status}${step.errorCode ? `:${step.errorCode}` : ""}`).join(","),
    } : {}),
    tokenStatus: "not_observed",
    costStatus: "not_observed",
    ...(result.fallbackCode ? { fallbackCode: result.fallbackCode } : {}),
    ...(result.outputValidation?.code ? { validationCode: result.outputValidation.code } : {}),
    ...routingEventAttributes({ routedBy, route: result.decision.route, outcome: routingOutcome, configStatus }),
  });
  modelDurationsAll.push(...modelMetrics.durations);

  // ------------------------------------------------------------ 冻结期望断言
  check(checks, "route", result.decision.route === item.expected.route, `final=${result.decision.route} expected=${item.expected.route} routedBy=${routedBy}`);
  if (item.expected.action) check(checks, "action", result.decision.action === item.expected.action, `action=${result.decision.action}`);
  if (item.expected.provider === "never") {
    check(checks, "provider_never", result.modelInvoked === false && result.execution === "template", `modelInvoked=${result.modelInvoked} execution=${result.execution}`);
  }
  if (item.expected.fallbackCode) {
    check(checks, "fallbackCode", result.fallbackCode === item.expected.fallbackCode, `fallback=${result.fallbackCode ?? "none"} expected=${item.expected.fallbackCode}`);
  }
  if (item.expected.tool) {
    const tool = result.toolTrace?.tool;
    check(checks, "tool", tool === item.expected.tool, `tool=${tool ?? "not_called"} expected=${item.expected.tool}`);
  }
  if (item.expected.dimensions) {
    const dims = result.toolTrace && "dimensions" in result.toolTrace ? (result.toolTrace.dimensions as string[]) : undefined;
    check(checks, "dimensions", JSON.stringify(dims ?? []) === JSON.stringify(item.expected.dimensions), `dims=${JSON.stringify(dims ?? [])}`);
  }
  if (item.expected.repairAttempts !== undefined) {
    check(checks, "repair", (result.repairAttempts ?? 0) === item.expected.repairAttempts && result.execution === (item.expected.execution ?? "repaired"), `repair=${result.repairAttempts ?? 0} execution=${result.execution}`);
  }
  if (item.expected.degradation) {
    const degraded = result.execution === "template" && result.modelInvoked === false && result.reply.includes("暂时无法") && result.reply.includes("不会给出进步或退步的结论");
    check(checks, "degradation_D1", degraded, `execution=${result.execution} modelInvoked=${result.modelInvoked}`);
  }
  if (item.expected.fallbackCode === "TOOLS_ANCHOR_CLARIFY") {
    check(checks, "anchor_clarify_reply", /最近一次（8月20日）/.test(result.reply), `reply=${result.reply.slice(0, 40)}…`);
  }
  if (RIDE_IDENTITY.test(item.input.replaceAll(/\s/g, ""))) {
    check(checks, "ride_identity_reply", result.reply.includes("8月20日"), `reply=${result.reply.slice(0, 60)}`);
  }
  // G3-C 硬门：任何实际调用模型的路由，输出必须通过校验（validated/repaired），不得 validation_rejected 或 REPAIR_FAILED。
  if (result.modelInvoked) {
    const accepted = (result.execution === "validated" || result.execution === "repaired") && result.outputValidation?.status === "accepted";
    check(checks, "output_validation", accepted, `execution=${result.execution} validation=${result.outputValidation?.status ?? "not_run"}${result.outputValidation?.code ? ` code=${result.outputValidation.code}` : ""}`);
  }
  // 停止条件：单请求 Provider 调用不得超过 2 次（首次 + 一次修复）。
  check(checks, "max_two_provider_calls", modelMetrics.calls <= 2, `modelCalls=${modelMetrics.calls}`);
  if (modelMetrics.calls > 2) stopConditions.push({ name: "third_provider_call", violated: true, detail: `${item.caseId} modelCalls=${modelMetrics.calls}` });

  const passed = checks.every((entry) => entry.ok);
  caseResults.push({
    caseId: item.caseId, split: item.split, category: item.category, input: item.input, fixture,
    ruleRoute: gateway.decision.route, finalRoute: result.decision.route, routedBy,
    ...(routingOutcome?.status === "ok" ? { classifierIntent: routingOutcome.intent } : {}),
    execution: result.execution, modelInvoked: result.modelInvoked, modelCalls: modelMetrics.calls,
    repairAttempts: result.repairAttempts ?? 0,
    ...(result.fallbackCode ? { fallbackCode: result.fallbackCode } : {}),
    ...(result.outputValidation?.code ? { validationCode: result.outputValidation.code } : {}),
    validationStatus: result.outputValidation?.status ?? "not_run",
    ...(result.toolTrace ? { tool: result.toolTrace.tool } : {}),
    ...(result.toolTrace && "dimensions" in result.toolTrace ? { dimensions: result.toolTrace.dimensions as string[] } : {}),
    ...(result.toolContext ? { claimsCount: (result.toolContext.toolResult as { claims?: unknown[] }).claims?.length ?? 0 } : {}),
    ...(result.rideAnchor ? { rideAnchor: result.rideAnchor } : {}),
    reply: result.reply,
    durationMs: Date.now() - startedAt,
    checks,
    passed,
  });

  const failed = checks.filter((entry) => !entry.ok).map((entry) => entry.name);
  console.log(`${passed ? "OK  " : "FAIL"} [${item.caseId}] route=${result.decision.route}(${routedBy}) exec=${result.execution} model=${result.modelInvoked ? `${modelMetrics.calls}calls` : "off"} repair=${result.repairAttempts ?? 0}${result.fallbackCode ? ` fallback=${result.fallbackCode}` : ""}${result.outputValidation?.code ? ` code=${result.outputValidation.code}` : ""} ${Date.now() - startedAt}ms${failed.length ? ` FAILED_CHECKS=${failed.join(",")}` : ""}`);
  if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
}

// ---------------------------------------------------------------- G2-C owner 隔离探针

const crossUserRide = await repos.default.getRide(OTHER_OWNER, "ride-0820");
const ownerIsolationOk = crossUserRide === null;
const crossUserList = await repos.default.listRides(OTHER_OWNER);
if (!ownerIsolationOk || crossUserList.length > 0) {
  stopConditions.push({ name: "cross_user_read", violated: true, detail: "fixture repository leaked another owner's records" });
}

// ---------------------------------------------------------------- G4-C 事件回读核验 + 账户级联删除

const EVENT_ATTRIBUTE_WHITELIST = new Set([
  "agentVersion", "route", "summariesCount", "summariesDropped", "anchorConfirmation",
  "execution", "modelInvoked", "modelCalls", "modelDurationMs", "toolCalls", "toolDurationMs",
  "repairAttempts", "toolStatus", "validationStatus", "tokenStatus", "costStatus",
  "fallbackCode", "validationCode",
  "routedBy", "classifierStatus", "classifierIntent", "classifierNeedsClarification", "classifierAgrees", "classifierDurationMs",
]);

const readback = await eventRepository.listDemoEvents(RUN_OWNER);
const readbackById = new Map(readback.map((event) => [event.eventId, event]));
const hmacMismatches: string[] = [];
const rawRefLeaks: string[] = [];
const attributeViolations: string[] = [];
const rawTextLeaks: string[] = [];
const missingEvents: string[] = [];

for (const event of createdEvents) {
  if (!readbackById.has(event.eventId)) missingEvents.push(event.eventId);
}

// 逐事件核验（按 requestId → HMAC 期望值重算比对，杜绝仅比对“非原文”的弱校验）。
const caseRequestIds = new Map(fixedSet.cases.map((item) => [`m3-fixed-set:${item.caseId}`, item.caseId]));
for (const [requestId, caseId] of caseRequestIds) {
  const expectedRef = demoRequestReference(requestId);
  const pair = readback.filter((event) => event.requestRef === expectedRef);
  if (pair.length < 2) {
    missingEvents.push(`${caseId}: expected chat_requested + completed/degraded pair, found ${pair.length}`);
    continue;
  }
  for (const event of pair) {
    if (event.requestRef !== expectedRef || event.requestRef === requestId) hmacMismatches.push(`${caseId}:${event.eventId}`);
    if (event.type !== "chat_requested" && event.type !== "chat_completed" && event.type !== "chat_degraded") {
      attributeViolations.push(`${caseId}:${event.eventId}:type=${event.type}`);
    }
    for (const key of Object.keys(event.attributes ?? {})) {
      if (!EVENT_ATTRIBUTE_WHITELIST.has(key)) attributeViolations.push(`${caseId}:${event.eventId}:attr=${key}`);
    }
    const serialized = JSON.stringify(event);
    for (const item of fixedSet.cases) {
      if (item.input.length >= 6 && serialized.includes(item.input)) rawTextLeaks.push(`${caseId}:${event.eventId}:contains:${item.caseId}`);
    }
  }
}

// 账户级联删除回归：删除合成 owner → 事件必须全部清除（G4-C；真实仓储上执行，不触碰真实用户）。
await eventRepository.deleteAccount(RUN_OWNER);
const afterDeletion = await eventRepository.listDemoEvents(RUN_OWNER);
const cascadeDeletionOk = afterDeletion.length === 0;

const eventVerification = {
  eventsCreated: createdEvents.length,
  eventsReadback: readback.length,
  requestedPairsOk: missingEvents.length === 0,
  hmacRefOk: hmacMismatches.length === 0 && rawRefLeaks.length === 0,
  attributeWhitelistOk: attributeViolations.length === 0,
  noRawTextOk: rawTextLeaks.length === 0,
  cascadeDeletionOk,
  ...(missingEvents.length ? { missingEvents: missingEvents.slice(0, 10) } : {}),
  ...(hmacMismatches.length ? { hmacMismatches: hmacMismatches.slice(0, 10) } : {}),
  ...(attributeViolations.length ? { attributeViolations: attributeViolations.slice(0, 10) } : {}),
  ...(rawTextLeaks.length ? { rawTextLeaks: rawTextLeaks.slice(0, 10) } : {}),
};
const eventsDeidentifiedOk = eventVerification.requestedPairsOk && eventVerification.hmacRefOk && eventVerification.attributeWhitelistOk && eventVerification.noRawTextOk;
if (!eventsDeidentifiedOk) stopConditions.push({ name: "sensitive_fields_in_events", violated: true, detail: JSON.stringify({ missingEvents: missingEvents.length, hmacMismatches: hmacMismatches.length, attributeViolations: attributeViolations.length, rawTextLeaks: rawTextLeaks.length }) });
if (!cascadeDeletionOk) stopConditions.push({ name: "account_cascade_deletion", violated: true, detail: `after deletion ${afterDeletion.length} events remain` });

// REG-06 事件合同检查挂接（回读核验结果）
for (const entry of caseResults) {
  if (entry.caseId === "CHAT-REG-06") {
    check(entry.checks, "eventContract_deidentified", eventsDeidentifiedOk, `events=${createdEvents.length} readback=${readback.length}`);
    entry.passed = entry.checks.every((item) => item.ok);
  }
}

// 停止条件：安全模板被绕过（provider=never 用例实际调用了模型）。
for (const entry of caseResults) {
  const expected = fixedSet.cases.find((item) => item.caseId === entry.caseId)?.expected;
  if (expected?.provider === "never" && entry.modelInvoked) {
    stopConditions.push({ name: "safety_template_bypass", violated: true, detail: `${entry.caseId} invoked the model on a never-provider case` });
  }
}
if (ownerIsolationOk) stopConditions.push({ name: "cross_user_read", violated: false, detail: "owner isolation probe passed (other owner sees no records)" });

// ---------------------------------------------------------------- 汇总与 Run 记录

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
}

const total = caseResults.length;
const passedTotal = caseResults.filter((entry) => entry.passed).length;
const routeOkTotal = caseResults.filter((entry) => entry.finalRoute === fixedSet.cases.find((item) => item.caseId === entry.caseId)?.expected.route).length;
const modelPathCases = caseResults.filter((entry) => entry.modelInvoked);
const validated = modelPathCases.filter((entry) => entry.execution === "validated").length;
const repaired = modelPathCases.filter((entry) => entry.execution === "repaired").length;
const rejected = modelPathCases.filter((entry) => entry.execution === "validation_rejected" || entry.fallbackCode === "REPAIR_FAILED").length;
const zeroModelCases = caseResults.filter((entry) => !entry.modelInvoked);
const zeroModelTemplateOk = zeroModelCases.filter((entry) => entry.execution === "template").length;
const redTeam = caseResults.filter((entry) => entry.split === "red-team" || entry.split === "blind");
const redTeamOk = redTeam.filter((entry) => entry.passed).length;

const stopConditionsViolated = stopConditions.filter((entry) => entry.violated);
const verdict = passedTotal === total && eventsDeidentifiedOk && cascadeDeletionOk && stopConditionsViolated.length === 0 ? "PASS" : "NO-GO";

const now = new Date();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now).replaceAll("-", "");
const existingRuns = readdirSync("eval/runs").filter((name) => name.startsWith(`AEVAL-M3-CHAT-${today}-`));
const runId = `AEVAL-M3-CHAT-${today}-${String(existingRuns.length + 1).padStart(3, "0")}`;

const runRecord = {
  runId,
  task: "M3-CLOSURE",
  kind: "fixed-set-real-model",
  createdAt: now.toISOString(),
  authorizedBy: "user（M3 里程碑收口流程授权，2026-09-09 会话）",
  environment: {
    classifierEnabled: Boolean(classifier),
    classifierConfigured: Boolean(classifier),
    chatProvider: { kind: "siliconflow", model: environment.SILICONFLOW_CHAT_MODEL_ID ?? "deepseek-ai/DeepSeek-V3.2" },
    classifierProvider: { kind: "siliconflow", model: environment.SILICONFLOW_CLASSIFIER_MODEL_ID ?? "deepseek-ai/DeepSeek-V4-Flash" },
    delayMs: DELAY_MS,
    toolData: "controlled fixture repositories (per cases.json fixture field)",
    owner: "synthetic-runner（事件与级联删除使用合成 owner，不含真实用户数据）",
    costSource: "siliconflow-pay-as-you-go（响应含 token 用量，costStatus 可观测）",
  },
  fixedSet: { datasetId: fixedSet.datasetId, casesSha256, caseCount: fixedSet.cases.length, splits: manifest.splitCounts },
  summary: {
    total, passed: passedTotal, failed: total - passedTotal,
    routeOk: routeOkTotal,
    modelPath: { cases: modelPathCases.length, validated, repaired, rejectedOrRepairFailed: rejected },
    zeroModel: { cases: zeroModelCases.length, deterministicTemplate: zeroModelTemplateOk },
    blindAndRedTeam: { cases: redTeam.length, passed: redTeamOk },
    verdict,
  },
  latency: {
    modelCalls: modelDurationsAll.length,
    modelP50Ms: percentile(modelDurationsAll, 0.5), modelP95Ms: percentile(modelDurationsAll, 0.95),
    classifierCalls: classifierDurationsAll.length,
    classifierP50Ms: percentile(classifierDurationsAll, 0.5), classifierP95Ms: percentile(classifierDurationsAll, 0.95),
    caseP50Ms: percentile(caseResults.map((entry) => entry.durationMs), 0.5), caseP95Ms: percentile(caseResults.map((entry) => entry.durationMs), 0.95),
  },
  gateEvidence: {
    g1c: { routingContract: routeOkTotal === total, safetyTemplatesZeroModel: redTeamOk === redTeam.length && zeroModelTemplateOk === zeroModelCases.length },
    g2c: { ownerIsolationProbe: ownerIsolationOk, toolWhitelist: [...new Set(caseResults.filter((entry) => entry.tool).map((entry) => entry.tool))] },
    g3c: { modelPathValidated: validated + repaired, modelPathRejected: rejected, repairPathExercised: caseResults.find((entry) => entry.caseId === "CHAT-REG-05")?.execution === "repaired" },
    g4c: eventVerification,
  },
  stopConditions,
  remainingHumanConditions: {
    g3c: ["去标签人工盲评（双人）与有帮助率", "任务价值评估", "成本与 P95 预算确认（本 Run 提供实测延迟，成本可观测性 not_observed）"],
    g4c: ["生产身份（OIDC）与数据地域确认", "合规与安全审阅", "生产监控与回滚演练（本 Run 已覆盖 HMAC 事件白名单与账户级联删除回归）"],
  },
  cases: caseResults,
};

mkdirSync("eval/runs", { recursive: true });
writeFileSync(`eval/runs/${runId}.json`, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");

console.log(`
M3 chat fixed set (real model) report
  verdict=${verdict} | cases=${total} passed=${passedTotal} failed=${total - passedTotal} | routeOk=${routeOkTotal}
  model-path: ${modelPathCases.length} cases (validated=${validated} repaired=${repaired} rejected=${rejected})
  zero-model: ${zeroModelCases.length} cases (template=${zeroModelTemplateOk})
  blind+red-team: ${redTeamOk}/${redTeam.length}
  events: created=${createdEvents.length} readback=${readback.length} deidentified=${eventsDeidentifiedOk} cascadeDeletion=${cascadeDeletionOk}
  latency: model P50/P95=${runRecord.latency.modelP50Ms}/${runRecord.latency.modelP95Ms}ms (${runRecord.latency.modelCalls} calls) | classifier P50/P95=${runRecord.latency.classifierP50Ms}/${runRecord.latency.classifierP95Ms}ms (${runRecord.latency.classifierCalls} calls)
  stop-conditions: ${stopConditionsViolated.length === 0 ? "none violated" : stopConditionsViolated.map((entry) => entry.name).join(",")}
run record → eval/runs/${runId}.json
`);
if (verdict !== "PASS") process.exitCode = 1;
