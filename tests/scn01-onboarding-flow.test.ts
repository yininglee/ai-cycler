import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/chat/route.ts";
import { PUT as saveProfile, GET as getProfile } from "../app/api/profile/route.ts";
import { PUT as ux } from "../app/api/ux/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { planRuntime } from "../src/training/plan-service.ts";
import { sanitizeChatInteractionPayload } from "../src/chat/chat-interaction.ts";
import { parseChatToolInvocation, executeChatTool } from "../src/chat/chat-tools.ts";

async function blank() {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const cookie = session.setCookie!.split(";")[0];
  const request = (body: unknown) => new Request("http://localhost/api/chat", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await ux(request({ action: "blank" }));
  return { owner: session.userId, cookie, request, repo: getApplicationRepository() };
}

const call = (tool: string, input = {}) => ({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool, input }] });
const answer = (reply: string) => (request: any) => ({ schemaVersion: "ride-chat-output-v0.2", route: request.route, reply,
  claimIds: [request.toolResults.at(-1).context.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] });

/** Scripted provider verifies API/authorization wiring, not model language quality. */
async function withModel(outputs: any[], work: (requests: any[]) => Promise<void>, classifier = false) {
  const env = { CHAT_MODEL_ENABLED: "true", CHAT_CLASSIFIER_ENABLED: String(classifier), CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const original = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const prompt = body.messages[1].content;
    if (prompt.includes("<classify_request>")) return Response.json({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "chat-classifier-v0.3", intent: "allow", needsClarification: false }) } }] });
    const request = JSON.parse(prompt.split("<chat_request>\n")[1].split("\n</chat_request>")[0]);
    requests.push(request);
    assert.ok(outputs.length, "unexpected model round");
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return Response.json({ choices: [{ message: { content: JSON.stringify(typeof next === "function" ? next(request) : next) } }] });
  }) as typeof fetch;
  try { await work(requests); assert.equal(outputs.length, 0); }
  finally { globalThis.fetch = original; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("SCN-01: first-use language reaches the model, which chooses existing onboarding actions", async () => {
  const f = await blank();
  await withModel([call("show_onboarding"), answer("可以补充资料、导入记录或制定训练计划，也可以先直接提问。")], async requests => {
    const body = await (await POST(f.request({ text: "第一次使用，我该怎么开始？" }))).json();
    assert.equal(body.executionRoute, "agent_loop"); assert.equal(body.modelInvoked, true);
    assert.equal(body.artifact.kind, "onboarding"); assert.equal(requests.length, 2);
    assert.equal((await f.repo.getProfile(f.owner))?.age, undefined);
  });
});

test("SCN-01: model-proposed profile is read-only; explicit existing save persists and reloads sources", async () => {
  const f = await blank();
  await withModel([call("prepare_profile_proposal", { input: { age: 31, weightKg: 71, ftpWatts: 220 } }), answer("请核对资料，确认前不会保存。")], async () => {
    const body = await (await POST(f.request({ text: "我今年31岁，体重71 kg，FTP 220W" }))).json();
    assert.equal(body.artifact.kind, "profile_proposal");
    assert.deepEqual(body.artifact.payload.input, { age: 31, weightKg: 71, ftpWatts: 220 });
    assert.equal((await f.repo.getProfile(f.owner))?.weightKg, undefined);
    assert.equal((await saveProfile(f.request(body.artifact.payload.input))).status, 200);
    const saved = await (await getProfile(new Request("http://localhost/api/profile", { headers: { Cookie: f.cookie } }))).json();
    assert.equal(saved.weightKg.value, 71); assert.equal(saved.weightKg.source, "user_provided"); assert.equal(saved.ftp.trustStatus, "user_confirmed");
  });
  await withModel([call("prepare_profile_proposal", { input: { weightKg: 72 } }), answer("请核对变更后再保存。")], async () => {
    const body = await (await POST(f.request({ text: "体重改为72 kg" }))).json();
    assert.equal(body.artifact.payload.previous.weightKg, 71);
    assert.equal((await f.repo.getProfile(f.owner))?.weightKg?.value, 71);
  });
});

test("SCN-01: safety precedes all model and proposal calls", async () => {
  const f = await blank();
  await withModel([], async requests => {
    const body = await (await POST(f.request({ text: "体重70 kg，现在胸痛怎么办" }))).json();
    assert.equal(body.executionRoute, "stop"); assert.equal(body.artifact, undefined); assert.equal(requests.length, 0);
  });
});

test("SCN-01: ambiguity is passed to contextual AI instead of deterministic profile or ride templates", async () => {
  const f = await blank();
  await withModel([call("get_user_context"), answer("请确认你想修改的资料及单位。")], async requests => {
    const body = await (await POST(f.request({ text: "体重140，身高175", summaries: [{ kind: "session_turn", route: "autonomous_tools", question: "我想更新个人资料" }] }))).json();
    assert.equal(body.execution, "validated"); assert.equal(body.artifact, undefined);
    assert.equal(requests[0].text, "体重140，身高175");
    assert.equal(requests[0].sessionSummaries[0].question, "我想更新个人资料");
    assert.equal((await f.repo.getProfile(f.owner))?.weightKg, undefined);
  });
});

test("SCN-01: explicitly unknown FTP and HR remain pending; confirmed estimates retain their source", async () => {
  const f = await blank();
  await withModel([call("prepare_profile_proposal", { input: { age: 31, maxHeartRateBpm: null, ftpWatts: null } }), answer("未知项目已标明，请核对后再保存。")], async () => {
    const body = await (await POST(f.request({ text: "我今年31岁，FTP不知道，最大心率不清楚" }))).json();
    assert.equal(body.execution, "validated");
    await saveProfile(f.request(body.artifact.payload.input));
    const stored = await f.repo.getProfile(f.owner);
    assert.equal(stored?.ftp, undefined); assert.equal(stored?.maxHeartRate?.source, "system_estimated");
  });
});

test("Planning goal: model stages a per-plan goal without an independent goal record or activation", async () => {
  const f = await blank(), goal = "提升耐力，完成100 km";
  await withModel([call("get_training_plan_context"), call("prepare_training_plan", { expectedVersion: 0, patch: { goal } }), answer("已准备本次计划信息，请核对目标并补充时间安排。")], async requests => {
    const body = await (await POST(f.request({ text: "帮我制定训练计划，我想提升耐力，完成100 km" }))).json();
    assert.equal(body.execution, "validated", JSON.stringify(body)); assert.equal(body.artifact.kind, "training_plan");
    const state = await (await planRuntime(f.owner)).context();
    assert.equal(state.workspace.intake.goal, goal); assert.equal(state.workspace.confirmedIntakeVersion, null); assert.equal(state.active, null);
    assert.equal((await f.repo.getProfile(f.owner))?.ux?.goal, null); assert.equal(requests.length, 3);
  });
});

test("Planning goal: short and unfamiliar requests use contextual plan tools without reviving a global editor", async () => {
  const f = await blank(), profile = (await f.repo.getProfile(f.owner))!;
  profile.ux = { ...profile.ux, goal: { title: "旧独立目标", detail: "完成100 km", updatedAt: new Date().toISOString() } };
  await f.repo.saveProfile(f.owner, profile);
  for (const text of ["改目标", "该目标", "本周我想换一个追求", "先前那个方向不合适，我们换换", "最近的记录看完了，我想修改目标"]) {
    await withModel([call("get_training_plan_context"), answer("目标在制定本次训练计划时补充；你可以说明这次计划想达成的方向。")], async requests => {
      const body = await (await POST(f.request({ text, summaries: [{ kind: "session_turn", route: "autonomous_tools", question: "我在考虑调整训练计划的目标" }] }))).json();
      assert.equal(body.execution, "validated", JSON.stringify(body)); assert.equal(body.executionRoute, "agent_loop");
      assert.equal(body.artifact.kind, "training_plan"); assert.equal(requests[1].toolResults[0].context.state.intake.goal, "");
      assert.ok(!requests[0].toolCatalog.tools.some((tool: any) => tool.tool === "prepare_goal_editor"));
      assert.equal((await f.repo.getProfile(f.owner))?.ux?.goal?.title, "旧独立目标");
      assert.equal((await (await planRuntime(f.owner)).context()).workspace.intakeVersion, 0);
    }, true);
  }
});

test("Planning goal: queried goal numbers come from the actual pending plan, without a separate editor", async () => {
  const f = await blank(), service = await planRuntime(f.owner);
  await service.prepare({ goal: "提升耐力，完成100 km" }, 0);
  await withModel([call("get_training_plan_context"), answer("你待核对的计划目标是提升耐力，完成100 km，计划尚未启用。")], async () => {
    const body = await (await POST(f.request({ text: "我这次计划的目标是什么？" }))).json();
    assert.equal(body.execution, "validated", JSON.stringify(body)); assert.equal(body.artifact.kind, "training_plan");
    assert.equal((await service.context()).active, null);
  });
});

test("SCN-01: goal-related knowledge uses retrieved knowledge rather than automatic editor preparation", async () => {
  const f = await blank();
  await withModel([call("search_knowledge_base", { keywords: ["心率"], maxEntries: 1 }), (request: any) => ({ schemaVersion: "ride-chat-output-v0.2", route: request.route,
    reply: "训练目标需要结合个人基础，心率可以帮助理解运动强度。", claimIds: [], capabilityKeys: [], knowledgeIds: [request.toolResults[0].context.items[0].knowledgeId] })], async () => {
    const body = await (await POST(f.request({ text: "目标与心率训练区间有什么关系？" }))).json();
    assert.equal(body.execution, "validated", JSON.stringify(body)); assert.equal(body.artifact, undefined);
  });
});

test("SCN-01: failed providers cannot turn goal commands into deterministic success or editor artifacts", async () => {
  const f = await blank();
  await withModel([new Error("test provider failure")], async () => {
    const body = await (await POST(f.request({ text: "改目标" }))).json();
    assert.equal(body.fallbackCode, "MODEL_TEMPORARY_UNAVAILABLE"); assert.equal(body.artifact, undefined);
    assert.equal((await f.repo.getProfile(f.owner))?.ux?.goal, null);
  });
});

test("SCN-01: preparation tools reject forged ownership, extra fields, invalid drafts and out-of-range profile", async () => {
  for (const value of [
    { tool: "get_user_context", input: { ownerId: "other" } },
    { tool: "prepare_goal_editor", input: { draft: { title: "提升 FTP", detail: "", confirm: true } } },
    { tool: "prepare_goal_editor", input: { draft: { title: "自定义", detail: "" } } },
    { tool: "prepare_profile_proposal", input: { input: { weightKg: 9999 } } },
  ]) assert.throws(() => parseChatToolInvocation(value));
  for (const payload of [{ input: { weightKg: 9999 }, previous: {} }, { input: { ownerId: "other" }, previous: {} }, { input: { weightKg: 71 }, previous: {}, confirm: true }])
    assert.equal(sanitizeChatInteractionPayload({ artifact: { kind: "profile_proposal", payload } }).artifact, undefined);
  const f = await blank(); const other = await blank();
  const profile = (await other.repo.getProfile(other.owner))!; profile.ux = { ...profile.ux, goal: { title: "提升 FTP", detail: "private", updatedAt: new Date().toISOString() } }; await other.repo.saveProfile(other.owner, profile);
  const result = await executeChatTool(f.repo, f.owner, parseChatToolInvocation({ tool: "get_user_context", input: {} }));
  assert.equal("goal" in result && result.goal, null); assert.ok(!JSON.stringify(result).includes("private"));
});

test("Planning goal: rejected model text cannot expose a plan intake or claim a goal is activated", async () => {
  const f = await blank();
  const invalid = { schemaVersion: "ride-chat-output-v0.2", route: "autonomous_tools", reply: "没有来源的数值99999。", claimIds: ["claim:loop:1:1"], capabilityKeys: [], knowledgeIds: [] };
  await withModel([call("get_training_plan_context"), call("prepare_training_plan", { expectedVersion: 0, patch: { goal: "提升耐力" } }), invalid, invalid], async () => {
    const body = await (await POST(f.request({ text: "制定计划，目标是提升耐力。" }))).json();
    assert.equal(body.fallbackCode, "REPAIR_FAILED"); assert.equal(body.artifact, undefined);
    assert.equal((await (await planRuntime(f.owner)).context()).active, null);
    assert.equal((await f.repo.getProfile(f.owner))?.ux?.goal, null);
  });
});

test("ARCH clarification: contextual AI may ask about intent or units without inventing evidence or opening an editor", async () => {
  const f = await blank();
  await withModel([(request: any) => ({ schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "clarification",
    reply: "你希望调整目标的哪个方面？", claimIds: [], capabilityKeys: [], knowledgeIds: [] })], async requests => {
    const body = await (await POST(f.request({ text: "换换吧", summaries: [{ kind: "session_turn", route: "autonomous_tools", question: "我想调整目标" }] }))).json();
    assert.equal(body.execution, "validated", JSON.stringify(body)); assert.equal(body.responseKind, "clarification");
    assert.equal(body.loopTrace.toolCalls, 0); assert.equal(body.artifact, undefined); assert.equal(requests.length, 1);
  }, true);
});

test("ARCH context: an expired inherited ride cannot block a goal request; explicit invalid selections remain rejected", async () => {
  const f = await blank();
  const summaries = [{ kind: "session_turn", route: "current_ride", question: "看这次骑行", choice: { kind: "ride", id: "deleted-ride" } }];
  await withModel([call("get_training_plan_context"), answer("可以在制定训练计划时设置本次目标。")], async requests => {
    const body = await (await POST(f.request({ text: "改目标", summaries }))).json();
    assert.equal(body.execution, "validated", JSON.stringify(body)); assert.equal(body.artifact.kind, "training_plan");
    assert.equal(body.choice, undefined); assert.equal(body.rideScope, "cleared");
    assert.equal(requests[0].toolCatalog.anchorRideId, "");
  });
  await withModel([], async () => {
    const response = await POST(f.request({ text: "请分析所选骑行", choice: { kind: "ride", id: "deleted-ride" } }));
    assert.equal(response.status, 404);
  });
});

test("SCN-01: a model-inferred profile unit is rejected as a proposal and returned to AI for clarification", async () => {
  const f = await blank();
  await withModel([call("prepare_profile_proposal", { input: { weightKg: 140 } }), answer("已准备资料卡。"), (request: any) => {
    const result = request.toolResults[0].context;
    assert.equal(result.clarificationNeeded, "PROFILE_UNITS_OR_VALUE"); assert.equal(result.interaction, undefined);
    return { schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "clarification", reply: "体重的单位是公斤还是斤？", claimIds: [], capabilityKeys: [], knowledgeIds: [] };
  }], async () => {
    const body = await (await POST(f.request({ text: "体重140" }))).json();
    assert.equal(body.execution, "repaired", JSON.stringify(body)); assert.equal(body.responseKind, "clarification"); assert.equal(body.artifact, undefined);
    assert.equal((await f.repo.getProfile(f.owner))?.weightKg, undefined);
  });
});
