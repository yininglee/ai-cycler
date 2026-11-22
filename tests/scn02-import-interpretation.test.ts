import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { POST as upload } from "../app/api/rides/import/route.ts";
import { POST as chat } from "../app/api/chat/route.ts";
import { GET as summaries } from "../app/api/rides/summary/route.ts";
import { GET as cachedAnalysis, POST as analyze } from "../app/api/ride-analysis/route.ts";
import { PUT as saveProfile } from "../app/api/profile/route.ts";
import { PUT as ux } from "../app/api/ux/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { buildChatHomeSnapshot } from "../src/chat/chat-home.ts";
import { createChatSession, appendChatTurn, startChatConversation, getActiveChatConversation, buildChatSessionSummaries, rememberChatRideSelection, storeChatSession, readStoredChatSession } from "../src/chat/chat-session.ts";
import { parseImportReceipts, restoreImportReceipts, chatReturnPath } from "../src/chat/chat-import.ts";
import { buildCyclingFitSample } from "./helpers/fit-sample.ts";
import { interpretationProviderReply } from "./helpers/interpretation-provider.ts";
import { hasInterpretationIdentity, interpretationFailureMessage, interpretationLimitations } from "../src/ui/ride-interpretation-response.ts";

function owner() {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  return { id: session.userId, cookie,
    json: (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    get: (url: string) => new Request(`http://localhost${url}`, { headers: { Cookie: cookie } }),
    upload: (bytes: string | Uint8Array, name: string) => { const form = new FormData(); form.set("file", new Blob([typeof bytes === "string" ? bytes : bytes.buffer as ArrayBuffer]), name); return new Request("http://localhost/api/rides/import", { method: "POST", headers: { Cookie: cookie }, body: form }); },
  };
}
async function withEnv(env: Record<string, string>, work: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  try { await work(); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("SCN-02: AI chooses the import capability and cannot claim that preparation synchronized records", async () => {
  await withEnv({ CHAT_MODEL_ENABLED: "true", CHAT_CLASSIFIER_ENABLED: "false", CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" }, async () => {
    const f = owner(); const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = (async (_url, options) => {
      calls++; const body = JSON.parse(String(options?.body));
      const request = JSON.parse(body.messages[1].content.split("<chat_request>\n")[1].split("\n</chat_request>")[0]);
      assert.equal(request.text, "想把码表里的骑行拿过来");
      const result = !request.toolResults ? { schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "prepare_ride_import", input: {} }] }
        : { schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "answer", reply: "可以从这个入口导入文件，平台关联与同步目前为模拟。", claimIds: [request.toolResults[0].context.claims[0].claimId], knowledgeIds: [], capabilityKeys: [] };
      return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
    }) as typeof fetch;
    try { const body = await (await chat(f.json("/api/chat", { text: "想把码表里的骑行拿过来" }))).json();
      assert.equal(body.execution, "validated"); assert.equal(body.artifact.kind, "ride_import"); assert.equal(calls, 2);
      assert.equal((await getApplicationRepository().listRides(f.id)).length, 0);
    } finally { globalThis.fetch = original; }
  });
});

test("SCN-02: real file import, duplicate detection, hidden-file reimport and unauthorized summaries", async () => {
  const f = owner(); const bytes = await readFile(new URL("../test-data/synthetic-import-preview.gpx", import.meta.url));
  const first = await upload(f.upload(bytes, "ride.gpx")); assert.equal(first.status, 201); const { rideId } = await first.json();
  const duplicate = await (await upload(f.upload(bytes, "same.gpx"))).json(); assert.equal(duplicate.rideId, rideId); assert.equal(duplicate.duplicate, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  await ux(f.json("/api/ux", { action: "blank" }));
  assert.equal((await (await summaries(f.get(`/api/rides/summary?id=${rideId}`))).json()).rides.length, 0);
  const restored = await (await upload(f.upload(bytes, "again.gpx"))).json(); assert.equal(restored.rideId, rideId);
  assert.equal((await (await summaries(f.get(`/api/rides/summary?id=${rideId}`))).json()).rides[0].id, rideId);
  assert.equal((await getApplicationRepository().listRides(f.id)).length, 1);
  assert.equal((await (await summaries(owner().get(`/api/rides/summary?id=${rideId}`))).json()).rides.length, 0);
});

test("SCN-02: receipts return to the origin once; an inspected record survives refresh and neutral turns", () => {
  const snapshot = buildChatHomeSnapshot([]); const first = createChatSession(snapshot);
  let state = startChatConversation(first, snapshot);
  const receipt = { receiptId: "sync-1", conversationId: first.activeConversationId, ids: ["same-day-a", "same-day-b", "same-day-a"], text: "同步完成" };
  const parsed = parseImportReceipts([receipt], state.activeConversationId);
  const activeId = state.activeConversationId;
  state = restoreImportReceipts(state, parsed);
  state = restoreImportReceipts(state, parsed);
  assert.equal(state.conversations[0].messages.length, 2); assert.equal(state.conversations[1].messages.length, 1);
  assert.equal(state.activeConversationId, activeId);
  assert.equal(buildChatSessionSummaries(getActiveChatConversation(state)).length, 0, "import alone selects no ride");
  state = rememberChatRideSelection(state, "same-day-b");
  state = appendChatTurn(state, "谢谢", "不客气", "typed_input", { route: "social" });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage"); let raw = "";
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } } });
  try { assert.equal(storeChatSession(state), true); const restored = readStoredChatSession()!;
    assert.equal(buildChatSessionSummaries(getActiveChatConversation(restored)).at(-2)?.choice?.id, "same-day-b");
  } finally { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); }
  assert.equal(chatReturnPath("conversation-1"), "/chat?conversation=conversation-1");
  assert.equal(parseImportReceipts([{ ...receipt, ids: [null] }], "conversation-1").length, 0);
});

test("SCN-02: successful interpretation persists; cache has no provider cost and ignores retired engine hints and respects profile and visibility", async () => {
  await withEnv({ AI_ANALYSIS_ENABLED: "true", SILICONFLOW_API_TOKEN: "test-only", DEMO_VALIDATION_BYPASS: "off" }, async () => {
    const f = owner(); await saveProfile(f.json("/api/profile", { age: 31, weightKg: 71, ftpWatts: 220, maxHeartRateBpm: 190 }));
    const { rideId } = await (await upload(f.upload(buildCyclingFitSample({ recordCount: 121 }), "ride.fit"))).json();
    const original = globalThis.fetch; let modelCalls = 0;
    globalThis.fetch = (async (_url, options) => { modelCalls++; const body = JSON.parse(String(options?.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(interpretationProviderReply(body.messages[0].content)) } }] });
    }) as typeof fetch;
    try {
      await getApplicationRepository().saveAnalysisRun(f.id, rideId, {
        successfulCache: {
          fingerprint: "retired-coze-fingerprint", generatedAt: new Date().toISOString(),
          response: { rideId, source: "b2", v04Candidate: {} },
        },
      });
      const oldCache = await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}&engine=v1`))).json();
      assert.equal(oldCache.cached, false);
      assert.equal(modelCalls, 0);
      const generated = await (await analyze(f.json("/api/ride-analysis", { rideId }))).json();
      assert.equal(generated.source, "v2", JSON.stringify(generated)); assert.ok(modelCalls > 0);
      const count = modelCalls;
      const cache = await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}`))).json();
      assert.equal(cache.cached, true); assert.equal(cache.response.rideId, rideId); assert.equal(modelCalls, count);
      process.env.AI_ANALYSIS_ENABLED = "false";
      assert.equal((await (await analyze(f.json("/api/ride-analysis", { rideId }))).json()).source, "b0");
      assert.equal((await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}`))).json()).cached, true, "failed retry preserves an explicitly dated existing success");
      process.env.AI_ANALYSIS_ENABLED = "true";
      const legacyHint = await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}&engine=v1`))).json();
      assert.equal(legacyHint.cached, true);
      assert.equal(legacyHint.response.source, "v2");
      assert.equal(modelCalls, count);
      assert.equal((await cachedAnalysis(owner().get(`/api/ride-analysis?rideId=${rideId}`))).status, 400);
      await saveProfile(f.json("/api/profile", { ftpWatts: 230 }));
      assert.equal((await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}`))).json()).cached, false);
      await saveProfile(f.json("/api/profile", { ftpWatts: 220 }));
      process.env.DEMO_VALIDATION_BYPASS = "on";
      const bypassed = await (await analyze(f.json("/api/ride-analysis", { rideId }))).json();
      assert.equal(bypassed.v2Candidate.demoValidationBypass, true);
      assert.equal((await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}`))).json()).cached, false, "bypassed output is not verified cache");
      process.env.DEMO_VALIDATION_BYPASS = "off";
      await analyze(f.json("/api/ride-analysis", { rideId })); assert.ok(modelCalls > count, "explicit generation runs again");
      await ux(f.json("/api/ux", { action: "blank" }));
      assert.equal((await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}`))).status, 400);
      assert.equal((await analyze(f.json("/api/ride-analysis", { rideId }))).status, 400);
    } finally { globalThis.fetch = original; }
  });
});

test("SCN-02: disabled analysis stays retryable, is not cached as success and reports service rather than missing-data cause", async () => {
  await withEnv({ AI_ANALYSIS_ENABLED: "false" }, async () => {
    const f = owner(); const { rideId } = await (await upload(f.upload(buildCyclingFitSample({ recordCount: 121 }), "ride.fit"))).json();
    const result = await (await analyze(f.json("/api/ride-analysis", { rideId }))).json(); assert.equal(result.source, "b0"); assert.equal(result.fallbackCode, "AI_DISABLED");
    assert.equal((await (await cachedAnalysis(f.get(`/api/ride-analysis?rideId=${rideId}`))).json()).cached, false);
    assert.match(interpretationFailureMessage(result.fallbackCode), /未启用/);
    assert.equal(hasInterpretationIdentity({ rideId: "other", source: "v2" }, rideId), false);
    assert.equal(hasInterpretationIdentity({ rideId, source: "invented" }, rideId), false);
  });
});

test("SCN-02: user-facing limitations explain evidence gaps without changing validated codes", () => {
  const original = ["power:INSUFFICIENT_SAMPLES", "power:INSUFFICIENT_SAMPLES", "crossSensorAlignment:NO_COMMON_WINDOW", "本次未记录踏频。"];
  const display = interpretationLimitations(original);
  assert.equal(display.length, 3);
  assert.match(display[0], /功率.*有效数据不足/);
  assert.match(display[1], /共同有效的数据时段/);
  assert.equal(display[2], original[3]);
  assert.equal(original[0], "power:INSUFFICIENT_SAMPLES");
});
