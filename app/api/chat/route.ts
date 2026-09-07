import { getRequestSession } from "../../../src/auth/session.ts";
import { CHAT_AGENT_SCHEMA_VERSION, createChatProvider, publicChatAgentResult, runChatAgent, type ChatProvider, type ChatProviderInvocation } from "../../../src/chat/chat-agent.ts";
import { createChatToolRunner } from "../../../src/chat/chat-tool-orchestration.ts";
import { CHAT_INPUT_MAX_BYTES, routeChatInput, type ChatInputGatewayResult } from "../../../src/chat/chat-routing.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";

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
    if (Buffer.byteLength(raw, "utf8") > CHAT_INPUT_MAX_BYTES + 256) return Response.json({ error: "INPUT_TOO_LARGE" }, { status: 413, headers });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).every((key) => key === "text") || !("text" in body)) {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers });
  }
  const result = routeChatInput(session.userId, (body as { text: unknown }).text);
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "INPUT_TOO_LARGE" ? 413 : 400;
    return Response.json({ error: result.code }, { status, headers });
  }
  const requestId = crypto.randomUUID();
  const toolMetrics = { calls: 0, durationMs: 0 };
  const modelMetrics = { calls: 0, durationMs: 0 };
  const repository = getApplicationRepository();
  await recordChatEvent(session.userId, "chat_requested", requestId, {
    agentVersion: CHAT_AGENT_SCHEMA_VERSION,
    route: result.decision.route,
    tokenStatus: "not_observed",
    costStatus: "not_observed",
  });
  const agentResult = await runChatAgent({
    text: result.text,
    decision: result.decision,
    provider: observedProvider(createChatProvider(), modelMetrics),
    toolRunner: observedToolRunner(createChatToolRunner(repository, session.userId), toolMetrics),
    requestId,
  });
  const eventType = agentResult.fallbackCode || agentResult.execution === "validation_rejected" ? "chat_degraded" : "chat_completed";
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
    tokenStatus: "not_observed",
    costStatus: "not_observed",
    ...(agentResult.fallbackCode ? { fallbackCode: agentResult.fallbackCode } : {}),
    ...(agentResult.outputValidation?.code ? { validationCode: agentResult.outputValidation.code } : {}),
  });
  return Response.json({ ...publicChatAgentResult(agentResult), text: result.text }, { headers });
}
