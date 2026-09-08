import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { POST as chatRoute } from "../app/api/chat/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";

const cookie = (setCookie: string | undefined) => setCookie?.split(";", 1)[0] ?? "";

test("chat route derives a missing current ride server-side without accepting or exposing identifiers", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "本次骑行平均功率是多少？" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { decision: { route: string; allowModel: boolean }; modelInvoked: boolean; execution: string; fallbackCode: string; providerRawOutput?: string; toolContext?: unknown; toolTrace?: unknown };
  assert.equal(body.decision.route, "current_ride");
  assert.equal(body.decision.allowModel, true);
  assert.equal(body.modelInvoked, false);
  assert.equal(body.execution, "template");
  assert.equal(body.fallbackCode, "TOOLS_NO_CURRENT_RIDE");
  assert.equal(body.providerRawOutput, undefined);
  assert.equal(body.toolContext, undefined);
  assert.equal(body.toolTrace, undefined);
});

test("chat route blocks safety input before any model path", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "胸痛并且呼吸困难，怎么办？" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { decision: { route: string; action: string; allowModel: boolean }; modelInvoked: boolean; execution: string };
  assert.deepEqual({ route: body.decision.route, action: body.decision.action, allowModel: body.decision.allowModel, modelInvoked: body.modelInvoked, execution: body.execution }, {
    route: "safety_stop",
    action: "safety_stop",
    allowModel: false,
    modelInvoked: false,
    execution: "template",
  });
});

test("chat route records only redacted observability metadata", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const response = await chatRoute(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie(session.setCookie) },
    body: JSON.stringify({ text: "你好" }),
  }));
  assert.equal(response.status, 200);
  const events = await getApplicationRepository().listDemoEvents(session.userId);
  const chatEvents = events.filter((event) => event.type.startsWith("chat_"));
  assert.deepEqual(chatEvents.map((event) => event.type), ["chat_requested", "chat_degraded"]);
  assert.equal(chatEvents[0]?.requestRef?.length, 20);
  assert.equal(chatEvents[0]?.attributes?.route, "social");
  assert.equal(chatEvents[1]?.attributes?.fallbackCode, "MODEL_NOT_CONFIGURED");
  assert.equal(chatEvents[1]?.attributes?.tokenStatus, "not_observed");
  assert.equal(chatEvents[1]?.attributes?.costStatus, "not_observed");
  const serialized = JSON.stringify(chatEvents);
  assert.doesNotMatch(serialized, /你好|"(?:prompt|token|secret|ownerId|rideId|providerRawOutput)"/i);
  assert.doesNotMatch(serialized, new RegExp(session.userId));
});
