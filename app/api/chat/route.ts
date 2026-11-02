import { hasExplicitChatRideReference, isStandaloneChatKnowledge, lastChatRideChoice } from "../../../src/chat/chat-context.ts";
import { chatExecutionRoute } from "../../../src/chat/chat-execution.ts";
import { buildChatRecordInteraction } from "../../../src/chat/chat-artifacts.ts";
import { isChatChoiceRef, type ChatChoiceRef } from "../../../src/chat/chat-interaction.ts";
import type { ChatToolResult } from "../../../src/chat/chat-tools.ts";
import { extractExplicitRideDate } from "../../../src/chat/chat-ride-anchor.ts";
import { isRecentOverviewQuestion } from "../../../src/chat/chat-routing.ts";
import { getRequestSession } from "../../../src/auth/session.ts";
import { CHAT_AGENT_SCHEMA_VERSION, chatRoutingUnavailableResult, createChatProvider, publicChatAgentResult, runChatAgent, type ChatProvider, type ChatProviderErrorCode, type ChatProviderInvocation } from "../../../src/chat/chat-agent.ts";
import {
  createChatClassifier,
  resolveChatExecutionRouting,
  routingEventAttributes,
  type ChatClassifierOutcome,
} from "../../../src/chat/chat-classifier.ts";
import { createChatToolLoopRunner, type ChatToolLoopRunner } from "../../../src/chat/chat-tool-orchestration.ts";
import { CHAT_INPUT_MAX_BYTES, CHAT_SUMMARIES_MAX_BYTES, classifyChatInputL0, routeChatInput, sanitizeChatSummaries, type ChatInputGatewayResult } from "../../../src/chat/chat-routing.ts";
import { detectAnchorConfirmation, resolveAnchorConfirmation, resolveRideAnchor, type RideAnchorOverride } from "../../../src/chat/chat-ride-anchor.ts";
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

// CHAT-17 P3：L2b 循环 runner 观测包装——仅计 startLoop 次数与耗时（工具调用数由
// loopTrace.steps 承载，不与单工具 toolCalls 计数混同）。
function observedToolLoopRunner(runner: ChatToolLoopRunner, metrics: { calls: number; durationMs: number }, toolMetrics: { calls: number; durationMs: number }, evidence: ChatToolResult[], candidates: string[]): ChatToolLoopRunner {
  return {
    async startLoop(input: Parameters<ChatToolLoopRunner["startLoop"]>[0]) {
      metrics.calls += 1;
      const startedAt = Date.now();
      try {
        const result = await runner.startLoop(input);
        if (!result.ok) candidates.push(...(result.candidates ?? []).map(c => c.rideId));
        return result;
      } finally {
        metrics.durationMs += elapsed(startedAt);
      }
    },
    executeLoopCalls: async (input) => {
      const startedAt = Date.now();
      const receipts = await runner.executeLoopCalls(input);
      toolMetrics.calls += receipts.length;
      toolMetrics.durationMs += elapsed(startedAt);
      for (const receipt of receipts) if (receipt.status === "completed") evidence.push(receipt.result); else if (receipt.status === "reference_pending") candidates.push(...receipt.candidates.map(c => c.rideId));
      return receipts;
    },
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
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).every((key) => key === "text" || key === "summaries" || key === "choice") || !("text" in body)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers });
  }
  const choice = (body as { choice?: unknown }).choice;
  if (choice !== undefined && (!isChatChoiceRef(choice) || choice.kind !== "ride" || /^\d{4}-\d{2}-\d{2}$/.test(choice.id))) return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers });
  const selectedChoice = choice as ChatChoiceRef | undefined;
  // CHAT-14 P1：摘要网关校验——非法整体静默丢弃（请求照常，退回无上下文基线），事件记 summariesDropped。
  const { summaries, dropped: summariesDropped } = sanitizeChatSummaries((body as { summaries?: unknown }).summaries);
  const result = routeChatInput(session.userId, (body as { text: unknown }).text);
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "INPUT_TOO_LARGE" ? 413 : 400;
    return Response.json({ error: result.code }, { status, headers });
  }
  const requestId = crypto.randomUUID();
  const tag = `[chat-trace] [${requestId}]`;
  const candidateIds: string[] = [];
  const interactionEvidence: ChatToolResult[] = [];
  const toolMetrics = { calls: 0, durationMs: 0 };
  const modelMetrics = { calls: 0, durationMs: 0 };
  const loopMetrics = { calls: 0, durationMs: 0 };
  // DEMO-IMPORTED-RIDES：聊天工具、锚点确认与聚合路由共用这一个仓储视图，
  // 因此演示记录与用户自己导入的记录在这些链路上同等可见。
  const repository = await getRideRepository();
  // ARCH-02: L0 is deterministic; optional semantic classification retains boundary
  // checks and context hints. All allowed data/knowledge hints use the one loop.
  // A configured boundary classifier failing remains a closed, explicit degradation.
  console.log(`${tag} gateway OK | text="${result.text}" | rule.route=${result.decision.route} rule.reason=${result.decision.reasonCode}`);
  let classifier: ReturnType<typeof createChatClassifier>;
  let classifierConfigInvalid = false;
  try {
    classifier = createChatClassifier();
  } catch {
    classifier = undefined;
    classifierConfigInvalid = true;
  }
  let decision = result.decision;
  let routedBy: "rules" | "rules_l0" | "classifier" | "classifier_unavailable" = "rules";
  let routingOutcome: ChatClassifierOutcome | undefined;
  let configStatus: "not_configured" | "CLASSIFIER_CONFIG_INVALID" | undefined;
  let unavailableCode: ChatProviderErrorCode | undefined;
  if (classifierConfigInvalid) {
    configStatus = "CLASSIFIER_CONFIG_INVALID";
    unavailableCode = "MODEL_TEMPORARY_UNAVAILABLE";
  } else {
    const resolution = await resolveChatExecutionRouting({
      text: result.text,
      ruleDecision: result.decision,
      classifier,
      requestId,
    });
    routedBy = resolution.routedBy;
    routingOutcome = resolution.outcome;
    configStatus = resolution.configStatus;
    if (resolution.routedBy === "classifier_unavailable") {
      // runClassifierOutcome 的错误码运行时只会是 ChatProviderError.code 或
      // MODEL_TEMPORARY_UNAVAILABLE（CLASSIFIER_CONFIG_INVALID 属配置读取路径，此处不会出现）。
      unavailableCode = resolution.outcome?.status === "error" && resolution.outcome.code !== "CLASSIFIER_CONFIG_INVALID"
        ? resolution.outcome.code
        : "MODEL_TEMPORARY_UNAVAILABLE";
    } else {
      decision = resolution.decision ?? result.decision;
    }
  }
  console.log(`${tag} routing resolved | final.route=${decision.route} final.reason=${decision.reasonCode} routedBy=${routedBy} ${configStatus ? `configStatus=${configStatus}` : ""}`);

  // AGT-A1（D-A2）：分类器不可用 → 终局降级回复（零模型调用，不做锚点确认/工具/生成）。
  if (unavailableCode !== undefined && !classifyChatInputL0(result.text)) {
    const agentResult = chatRoutingUnavailableResult(unavailableCode, result.decision.normalizedLength);
    console.log(`${tag} routing unavailable → terminal degradation | code=${unavailableCode}`);
    await recordChatEvent(session.userId, "chat_requested", requestId, {
      agentVersion: CHAT_AGENT_SCHEMA_VERSION,
      route: agentResult.decision.route,
      summariesCount: String(summaries.length),
      ...(summariesDropped ? { summariesDropped: "true" } : {}),
      ...routingEventAttributes({ routedBy, route: agentResult.decision.route, outcome: routingOutcome }),
      tokenStatus: "not_observed",
      costStatus: "not_observed",
    });
    await recordChatEvent(session.userId, "chat_degraded", requestId, {
      agentVersion: agentResult.schemaVersion,
      route: agentResult.decision.route,
      executionRoute: agentResult.executionRoute ?? "deterministic",
      execution: agentResult.execution,
      modelInvoked: String(agentResult.modelInvoked),
      fallbackCode: agentResult.fallbackCode ?? "",
      ...routingEventAttributes({ routedBy, route: agentResult.decision.route, outcome: routingOutcome }),
    });
    return Response.json({ ...publicChatAgentResult(agentResult), executionRoute: "deterministic", text: result.text }, { headers });
  }

  // CHAT-14 P2（G-RIDE-DEIXIS）：锚点确认轮——纯确认语（“最近一次”/“是的”/日期）且摘要挂起
  // 轮（工具路由、无锚点 = 上一轮触发了锚点澄清）存在时，以确认结果建立锚点并重答挂起原问题；
  // 日期无匹配时确定性回复（零模型调用）。摘要不参与新问题路由，仅用于挂起识别。
  const explicitReference = hasExplicitChatRideReference(result.text);
  const overview = !selectedChoice && !explicitReference && (decision.route === "level_assessment" || isRecentOverviewQuestion(result.text));
  const standaloneKnowledge = !selectedChoice && isStandaloneChatKnowledge(result.text);
  const executionRoute = chatExecutionRoute(result.text, decision);
  const canInherit = executionRoute === "agent_loop";
  const inherited = canInherit && !overview && !explicitReference && !standaloneKnowledge ? lastChatRideChoice(summaries) : undefined;
  const effectiveChoice = executionRoute === "agent_loop" ? selectedChoice ?? (inherited?.kind === "ride" ? inherited : undefined) : undefined;
  if (effectiveChoice && !(await repository.listRides(session.userId)).some(e => e.record.activity.rideId === effectiveChoice.id)) return Response.json({ error: "NOT_FOUND", reply: "所选骑行已不可用，请重新选择记录。", rideScope: "cleared" }, { status: 404, headers });
  if (selectedChoice && explicitReference && executionRoute === "agent_loop") {
    const resolution = resolveRideAnchor({ text: result.text, route: decision.route, summaries: [], entries: await repository.listRides(session.userId) });
    const matches = resolution.status === "resolved" ? resolution.record.activity.rideId === selectedChoice.id
      : resolution.reason === "same_day_multiple" && resolution.candidates?.some(candidate => candidate.rideId === selectedChoice.id);
    if (!matches) return Response.json({ reply: "点选的记录与文字中的记录指向不一致，请重新选择要分析的骑行。", text: result.text, decision: { ...decision, route: "clarification", action: "select" }, rideScope: "cleared", executionRoute: "deterministic" }, { headers });
  }
  if (!overview && (selectedChoice || explicitReference) && decision.route === "level_assessment") decision = { ...decision, route: "current_ride", reasonCode: "CURRENT_RIDE" };
  if (standaloneKnowledge && executionRoute === "agent_loop") decision = { ...decision, route: "kb_qa", reasonCode: "KB_QA" };
  let effectiveText = result.text;
  let anchorConfirmation = false;
  let anchorOverride: RideAnchorOverride | undefined = effectiveChoice ? { rideId: effectiveChoice.id } : undefined;
  const confirmation = executionRoute === "agent_loop" && effectiveChoice === undefined ? detectAnchorConfirmation({ text: result.text, decision, summaries }) : null;
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
        ...routingEventAttributes({ routedBy, route: decision.route, outcome: routingOutcome, configStatus }),
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
    ...routingEventAttributes({ routedBy, route: decision.route, outcome: routingOutcome, configStatus }),
    tokenStatus: "not_observed",
    costStatus: "not_observed",
  });
  const agentResult = await runChatAgent({
    text: effectiveText,
    decision,
    provider: executionRoute === "agent_loop" ? observedProvider(createChatProvider(), modelMetrics) : undefined,
    // CHAT-17 P3：L2b 循环 runner（autonomous_tools 路由）。
    loopRunner: observedToolLoopRunner(createChatToolLoopRunner(repository, session.userId), loopMetrics, toolMetrics, interactionEvidence, candidateIds),
    requestId,
    // CHAT-14 P1/P2：摘要传递（表达层指代消解）与锚点覆写（确认轮）。
    summaries: overview ? [] : standaloneKnowledge ? summaries.map(({ choice: _choice, rideAnchor: _anchor, ...summary }) => ({ ...summary, rideScope: "cleared" as const })) : summaries,
    ...(anchorOverride ? { anchorOverride } : {}),
    // CHAT-12 P1：聚合路由在服务端直接用仓储数据作答，与 /chat 页摘要同源。
    ...(decision.route === "aggregate"
      ? { aggregateRecords: (await repository.listRides(session.userId)).map((entry) => entry.record) }
      : {}),
  });
  const selectionNeeded = agentResult.fallbackCode === "TOOLS_ANCHOR_CLARIFY" || agentResult.fallbackCode === "TOOLS_REFERENCE_NEEDED";
  const canPresent = selectionNeeded || agentResult.execution === "validated" || agentResult.execution === "repaired";
  const interaction = canPresent ? buildChatRecordInteraction(interactionEvidence, (await repository.listRides(session.userId)).map(e => e.record), selectionNeeded, candidateIds.length ? candidateIds : undefined) : {};
  const activeChoice = overview || selectionNeeded ? undefined : agentResult.choice ?? (!interactionEvidence.some(r => r.tool === "get_ride_history") && interaction.artifact?.kind === "ride_list" && interaction.artifact.payload.items.length === 1 ? { kind: "ride" as const, id: interaction.artifact.payload.items[0].rideId } : effectiveChoice);
  const eventType = agentResult.fallbackCode || agentResult.execution === "validation_rejected" ? "chat_degraded" : "chat_completed";
  console.log(`${tag} agent done | execution=${agentResult.execution} modelInvoked=${agentResult.modelInvoked} modelCalls=${modelMetrics.calls} toolCalls=${toolMetrics.calls} repairAttempts=${agentResult.repairAttempts ?? 0}${agentResult.fallbackCode ? ` fallbackCode=${agentResult.fallbackCode}` : ""}${agentResult.outputValidation ? ` validation.status=${agentResult.outputValidation.status} validation.code=${agentResult.outputValidation.code ?? "ok"}` : ""} | reply.len=${agentResult.reply.length}`);
  await recordChatEvent(session.userId, eventType, requestId, {
    agentVersion: agentResult.schemaVersion,
    route: agentResult.decision.route,
    executionRoute: agentResult.executionRoute ?? executionRoute,
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
    ...routingEventAttributes({ routedBy, route: agentResult.decision.route, outcome: routingOutcome, configStatus }),
  });
  return Response.json({ ...publicChatAgentResult({ ...agentResult, ...(overview || selectionNeeded ? { rideAnchor: undefined, choice: undefined } : {}), ...interaction, ...(selectionNeeded ? { decision: { ...agentResult.decision, action: "select" } } : {}) }), ...(activeChoice ? { choice: activeChoice } : {}), ...(overview ? { rideScope: "overview" } : selectionNeeded ? { rideScope: "pending" } : {}), text: result.text }, { headers });
}
