import { getRequestSession } from "../../../src/auth/session.ts";
import { CHAT_AGENT_SCHEMA_VERSION, createChatProvider, publicChatAgentResult, runChatAgent, type ChatProvider, type ChatProviderInvocation } from "../../../src/chat/chat-agent.ts";
import {
  createChatClassifier,
  readChatClassifierMode,
  resolveActiveChatRouting,
  routingEventAttributes,
  runChatClassifierShadow,
  type ChatClassifierMode,
  type ChatClassifierShadowOutcome,
} from "../../../src/chat/chat-classifier.ts";
import { createChatToolLoopRunner, createChatToolRunner, type ChatToolLoopRunner } from "../../../src/chat/chat-tool-orchestration.ts";
import { CHAT_INPUT_MAX_BYTES, CHAT_SUMMARIES_MAX_BYTES, routeChatInput, sanitizeChatSummaries, type ChatInputGatewayResult } from "../../../src/chat/chat-routing.ts";
import { detectAnchorConfirmation, resolveAnchorConfirmation, type RideAnchorOverride } from "../../../src/chat/chat-ride-anchor.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { getRideRepository } from "../../../src/persistence/demo-ride-repository.ts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

function elapsed(startedAt: number): number {
  return Math.max(0, Math.min(60_000, Math.round(Date.now() - startedAt)));
}

function observedProvider(provider: ChatProvider | undefined, metrics: { calls: number; durationMs: number }): ChatProvider | undefined {
  if (!provider) return undefined;
  return {
    async run(input: ChatProviderInvocation) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        return await provider.run(input);
      } finally {
        metrics.durationMs += elapsed(startedAt);
      }
    },
  };
}

function observedToolRunner(runner: ReturnType<typeof createChatToolRunner>, metrics: { calls: number; durationMs: number }) {
  return {
    async run(input: Parameters<typeof runner.run>[0]) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        return await runner.run(input);
      } finally {
        metrics.durationMs += elapsed(startedAt);
      }
    },
  };
}

// CHAT-17 P3：L2b 循环 runner 观测包装——仅计 startLoop 次数与耗时（工具调用数由
// loopTrace.steps 承载，不与单工具 toolCalls 计数混同）。
function observedToolLoopRunner(runner: ChatToolLoopRunner, metrics: { calls: number; durationMs: number }): ChatToolLoopRunner {
  return {
    async startLoop(input: Parameters<ChatToolLoopRunner["startLoop"]>[0]) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        return await runner.startLoop(input);
      } finally {
        metrics.durationMs += elapsed(startedAt);
      }
    },
    executeLoopCalls: (input) => runner.executeLoopCalls(input),
  };
}

async function recordChatEvent(ownerId: string, type: "chat_requested" | "chat_completed" | "chat_degraded", requestId: string, attributes: Record<string, string>): Promise<void> {
  try {
    await getApplicationRepository().saveDemoEvent(ownerId, createDemoEvent({ type, requestId, attributes }));
  } catch {
    // Observability must never change the chat response.
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = getRequestSession(request);
  if (!session) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });

  let body: unknown;
  try {
    const raw = await request.text();
    // CHAT-14 P1：正文限额 = 问题 + 会话摘要预算（≤6 条白名单槽位）+ 余量。
    if (Buffer.byteLength(raw, "utf8") > CHAT_INPUT_MAX_BYTES + CHAT_SUMMARIES_MAX_BYTES + 256) return Response.json({ error: "INPUT_TOO_LARGE" }, { status: 413, headers });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).every((key) => key === "text" || key === "summaries") || !("text" in body)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers });
  }
  // CHAT-14 P1：摘要网关校验——非法整体静默丢弃（请求照常，退回无上下文基线），事件记 summariesDropped。
  const { summaries, dropped: summariesDropped } = sanitizeChatSummaries((body as { summaries?: unknown }).summaries);
  const result = routeChatInput(session.userId, (body as { text: unknown }).text);
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "INPUT_TOO_LARGE" ? 413 : 400;
    return Response.json({ error: result.code }, { status, headers });
  }
  const requestId = crypto.randomUUID();
  const tag = `[chat-trace] [${requestId}]`;
  const toolMetrics = { calls: 0, durationMs: 0 };
  const modelMetrics = { calls: 0, durationMs: 0 };
  const loopMetrics = { calls: 0, durationMs: 0 };
  // DEMO-IMPORTED-RIDES：聊天工具、锚点确认与聚合路由共用这一个仓储视图，
  // 因此演示记录与用户自己导入的记录在这些链路上同等可见。
  const repository = await getRideRepository();
  // CHAT-12 P3：混合意图路由——CHAT_CLASSIFIER_MODE=active 时分类器接管主路由：
  // L0 快路径（红线 + 高置信聚合/身份）零调用直答，未命中交 L1 语义分类器，
  // 失败/超时/限流/未配置一律降级 P1 全量规则保底；shadow（默认）保持 P2 影子行为。
  const classifierMode: ChatClassifierMode = readChatClassifierMode();
  console.log(`${tag} gateway OK | text="${result.text}" | rule.route=${result.decision.route} rule.reason=${result.decision.reasonCode} | classifier.mode=${classifierMode}`);
  let classifier: ReturnType<typeof createChatClassifier>;
  let classifierConfigInvalid = false;
  try {
    classifier = createChatClassifier();
  } catch {
    classifier = undefined;
    classifierConfigInvalid = true;
  }
  let decision = result.decision;
  let routedBy: "rules" | "rules_l0" | "classifier" | "rules_fallback" = "rules";
  let routingOutcome: ChatClassifierShadowOutcome | undefined;
  let configStatus: "not_configured" | "CLASSIFIER_CONFIG_INVALID" | undefined;
  let shadowPromise: Promise<ChatClassifierShadowOutcome> | undefined;
  if (classifierMode === "active") {
    if (classifierConfigInvalid) {
      routedBy = "rules_fallback";
      configStatus = "CLASSIFIER_CONFIG_INVALID";
    } else {
      const resolution = await resolveActiveChatRouting({
        text: result.text,
        ruleDecision: result.decision,
        classifier,
        requestId,
      });
      decision = resolution.decision;
      routedBy = resolution.routedBy;
      routingOutcome = resolution.outcome;
      configStatus = resolution.configStatus;
    }
  } else if (classifier) {
    // CHAT-12 P2：影子模式——与主链路并行执行，只记录分类结果与规则层对照，不影响路由与回复
    // （runChatClassifierShadow 内部捕获全部异常，不产生未处理拒绝）。
    shadowPromise = runChatClassifierShadow({ client: classifier, requestId, text: result.text });
  }
  console.log(`${tag} routing resolved | final.route=${decision.route} final.reason=${decision.reasonCode} routedBy=${routedBy} ${configStatus ? `configStatus=${configStatus}` : ""}`);

  // CHAT-14 P2（G-RIDE-DEIXIS）：锚点确认轮——纯确认语（“最近一次”/“是的”/日期）且摘要挂起
  // 轮（工具路由、无锚点 = 上一轮触发了锚点澄清）存在时，以确认结果建立锚点并重答挂起原问题；
  // 日期无匹配时确定性回复（零模型调用）。摘要不参与新问题路由，仅用于挂起识别。
  let effectiveText = result.text;
  let anchorConfirmation = false;
  let anchorOverride: RideAnchorOverride | undefined;
  const confirmation = detectAnchorConfirmation({ text: result.text, decision, summaries });
  if (confirmation) {
    const confirmationEntries = await repository.listRides(session.userId);
    const resolved = resolveAnchorConfirmation({ confirmation, entries: confirmationEntries });
    if (resolved.kind === "reply") {
      console.log(`${tag} anchor confirmation → DATE_NOT_FOUND deterministic reply`);
      await recordChatEvent(session.userId, "chat_requested", requestId, {
        agentVersion: CHAT_AGENT_SCHEMA_VERSION,
        route: decision.route,
        summariesCount: String(summaries.length),
        ...(summariesDropped ? { summariesDropped: "true" } : {}),
        anchorConfirmation: "date_not_found",
        ...routingEventAttributes({ mode: classifierMode, routedBy, route: decision.route, outcome: routingOutcome, configStatus }),
        tokenStatus: "not_observed",
        costStatus: "not_observed",
      });
      return Response.json({ reply: resolved.reply, text: result.text }, { headers });
    }
    effectiveText = resolved.text;
    decision = resolved.decision;
    anchorConfirmation = true;
    anchorOverride = resolved.anchor;
    console.log(`${tag} anchor confirmation → complete pending question | text="${effectiveText}" anchor=${JSON.stringify(resolved.anchor)}`);
  }
  await recordChatEvent(session.userId, "chat_requested", requestId, {
    agentVersion: CHAT_AGENT_SCHEMA_VERSION,
    route: decision.route,
    // CHAT-14 P1：脱敏事件不落摘要原文，仅记数量与丢弃标记。
    summariesCount: String(summaries.length),
    ...(summariesDropped ? { summariesDropped: "true" } : {}),
    ...(anchorConfirmation ? { anchorConfirmation: "completed" } : {}),
    ...routingEventAttributes({ mode: classifierMode, routedBy, route: decision.route, outcome: routingOutcome, configStatus }),
    tokenStatus: "not_observed",
    costStatus: "not_observed",
  });
  const agentResult = await runChatAgent({
    text: effectiveText,
    decision,
    provider: observedProvider(createChatProvider(), modelMetrics),
    toolRunner: observedToolRunner(createChatToolRunner(repository, session.userId), toolMetrics),
    // CHAT-17 P3：L2b 循环 runner（autonomous_tools 路由）。
    loopRunner: observedToolLoopRunner(createChatToolLoopRunner(repository, session.userId), loopMetrics),
    requestId,
    // CHAT-14 P1/P2：摘要传递（表达层指代消解）与锚点覆写（确认轮）。
    summaries,
    ...(anchorOverride ? { anchorOverride } : {}),
    // CHAT-12 P1：聚合路由在服务端直接用仓储数据作答，与 /chat 页摘要同源。
    ...(decision.route === "aggregate"
      ? { aggregateRecords: (await repository.listRides(session.userId)).map((entry) => entry.record) }
      : {}),
  });
  const shadowOutcome = shadowPromise ? await shadowPromise : routingOutcome;
  const eventType = agentResult.fallbackCode || agentResult.execution === "validation_rejected" ? "chat_degraded" : "chat_completed";
  console.log(`${tag} agent done | execution=${agentResult.execution} modelInvoked=${agentResult.modelInvoked} modelCalls=${modelMetrics.calls} toolCalls=${toolMetrics.calls} repairAttempts=${agentResult.repairAttempts ?? 0}${agentResult.fallbackCode ? ` fallbackCode=${agentResult.fallbackCode}` : ""}${agentResult.outputValidation ? ` validation.status=${agentResult.outputValidation.status} validation.code=${agentResult.outputValidation.code ?? "ok"}` : ""} | reply.len=${agentResult.reply.length}`);
  await recordChatEvent(session.userId, eventType, requestId, {
    agentVersion: agentResult.schemaVersion,
    route: agentResult.decision.route,
    execution: agentResult.execution,
    modelInvoked: String(agentResult.modelInvoked),
    modelCalls: String(modelMetrics.calls),
    modelDurationMs: String(modelMetrics.durationMs),
    toolCalls: String(toolMetrics.calls),
    toolDurationMs: String(toolMetrics.durationMs),
    repairAttempts: String(agentResult.repairAttempts ?? 0),
    toolStatus: agentResult.toolTrace?.status ?? "not_called",
    validationStatus: agentResult.outputValidation?.status ?? "not_run",
    // CHAT-17 P3：L2b 循环轨迹（脱敏：状态/预算计数/步骤状态序列，不含输入输出内容）。
    ...(agentResult.loopTrace ? {
      loopStatus: agentResult.loopTrace.status,
      loopToolCalls: String(agentResult.loopTrace.toolCalls),
      loopProviderCalls: String(agentResult.loopTrace.providerCalls),
      loopSteps: agentResult.loopTrace.steps.map((step) => `${step.tool}:${step.status}${step.errorCode ? `:${step.errorCode}` : ""}`).join(","),
    } : {}),
    tokenStatus: "not_observed",
    costStatus: "not_observed",
    ...(agentResult.fallbackCode ? { fallbackCode: agentResult.fallbackCode } : {}),
    ...(agentResult.outputValidation?.code ? { validationCode: agentResult.outputValidation.code } : {}),
    ...routingEventAttributes({ mode: classifierMode, routedBy, route: agentResult.decision.route, outcome: shadowOutcome, configStatus }),
  });
  return Response.json({ ...publicChatAgentResult(agentResult), text: result.text }, { headers });
}
