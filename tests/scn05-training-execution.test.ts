import "./helpers/route-test-env.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { addPlanDays, emptyPlanIntake, planToday, type PlanProposal } from "../src/domain/training-plan.ts";
import { calculateExecutionFacts, rideShanghaiDate } from "../src/domain/training-execution.ts";
import { planRuntime } from "../src/training/plan-service.ts";
import { executionRuntime } from "../src/training/execution-service.ts";
import { GET, POST } from "../app/api/training-execution/route.ts";
import { GET as getPlan, POST as postPlan } from "../app/api/training-plans/route.ts";
import { POST as chat } from "../app/api/chat/route.ts";
import { executeExecutionTool } from "../src/chat/chat-execution-tools.ts";
import { validateChatOutput } from "../src/chat/chat-output-validation.ts";
import { makeChatDecision } from "../src/chat/chat-routing.ts";
import { sanitizeChatInteractionPayload } from "../src/chat/chat-interaction.ts";
const today = planToday(), weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
const proposal = (minutes = 30): PlanProposal => ({ rationale: "根据本人核对的信息，先安排轻松骑行。", blocks: [{ fromWeek: 1, toWeek: 1, sessions: [{ weekday, kind: "endurance", minutes }] }] });
const confirmed = (grant: any) => ({ confirmed: true, token: grant.token, action: grant.action, targetId: grant.targetId, version: grant.version, idempotencyKey: grant.idempotencyKey });
const code = (expected: string) => (error: any) => error?.code === expected;
function owner() {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const request = (body?: unknown, query = "") => new Request(`http://localhost/api/test${query}`, { method: body === undefined ? "GET" : "POST", headers: { Cookie: session.setCookie!.split(";")[0], "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { id: session.userId, request };
}
function ride(id: string, start = `${today}T10:00:00+08:00`, minutes = 35) {
  const fixture = getRideFixture("l3-fit-power"), record = structuredClone({ activity: fixture.activity, series: fixture.series });
  record.activity.rideId = id; record.series.rideId = id; record.activity.startTime = start;
  record.activity.metrics.movingTimeS!.value = minutes * 60;
  return record;
}
async function setup(activate = true) {
  const f = owner(), plans = await planRuntime(f.id);
  await plans.prepare({ ...emptyPlanIntake(), goal: "恢复规律骑行", startDate: today, endDate: today, availability: [{ weekday, minutes: 45 }], weeklyMinutes: 120, longestRideMinutes: 60, selfReportedBasis: "近期每周轻松骑两次", powerMeter: false, healthConcern: false }, 0);
  const intake = await plans.confirmIntake({}, 1);
  const plan = await plans.propose({ intakeVersion: intake.intakeVersion, baseVersion: 0, proposal: proposal() });
  if (activate) await plans.confirmation.confirm({ ownerId: f.id, request: confirmed(await plans.issue({ planId: plan.id, version: 1, activeVersion: null, idempotencyKey: "activate" })) });
  await getApplicationRepository().saveRide(f.id, ride("a"));
  await getApplicationRepository().saveRide(f.id, ride("b", `${today}T15:00:00+08:00`, 20));
  const service = await executionRuntime(f.id), ref = { planId: plan.id, version: 1, date: today };
  return { f, plans, plan, service, ref };
}
async function link(s: Awaited<ReturnType<typeof setup>>, rideId = "a", revision = 0) {
  const grant = await s.service.issueLink({ ...s.ref, rideId, expectedRevision: revision, idempotencyKey: `link-${rideId}-${revision}` });
  return s.service.confirmation.confirm({ ownerId: s.f.id, request: confirmed(grant) });
}

test("SCN-05: Shanghai day candidates remain separate and imports never associate automatically", async () => {
  const s = await setup();
  for (const record of [ride("before", `${addPlanDays(today, -1)}T23:59:59+08:00`), ride("boundary", `${today}T00:00:00+08:00`), ride("after", `${addPlanDays(today, 1)}T00:00:00+08:00`)]) await getApplicationRepository().saveRide(s.f.id, record);
  const view = await s.service.context(); assert.equal(view.date, today); assert.equal(view.execution, null);
  assert.deepEqual(view.candidates.map(x => x.rideId), ["b", "a", "boundary"]);
  assert.equal(rideShanghaiDate(ride("utc", `${addPlanDays(today, -1)}T16:00:00Z`)), today);
  const prepared = await s.service.issueLink({ ...s.ref, rideId: "a", expectedRevision: 0, idempotencyKey: "cancel" });
  assert.equal((await s.service.context()).execution, null);
  await assert.rejects(s.service.confirmation.confirm({ ownerId: s.f.id, request: { ...confirmed(prepared), confirmed: false } }));
  assert.equal((await s.service.context()).execution, null);
});
test("SCN-05: candidate pagination has no truncation or automatic selection", async () => {
  const s = await setup();
  for (let i = 0; i < 23; i++) await getApplicationRepository().saveRide(s.f.id, ride(`many-${i}`));
  const first = await s.service.context(), last = await s.service.context({ offset: 20 });
  assert.equal(first.candidateCount, 25); assert.equal(first.candidates.length, 20); assert.equal(first.moreCandidates, true);
  assert.equal(last.candidates.length, 5); assert.equal(last.moreCandidates, false); assert.equal(last.execution, null);
});
test("SCN-05: confirmation replay commits once, versions and owners prevent stale linkage", async () => {
  const s = await setup(), grant = await s.service.issueLink({ ...s.ref, rideId: "a", expectedRevision: 0, idempotencyKey: "once" });
  const body = { action: "confirm", request: confirmed(grant) };
  const first = await POST(s.f.request(body)), replay = await POST(s.f.request(body));
  assert.equal(first.status, 200); assert.equal((await replay.json()).replayed, true);
  const view = await s.service.context(); assert.equal(view.revision, 1); assert.equal(view.execution?.rideId, "a");
  await assert.rejects(s.service.issueLink({ ...s.ref, rideId: "b", expectedRevision: 0, idempotencyKey: "stale" }), code("VERSION_CONFLICT"));
  assert.notEqual((await POST(owner().request(body))).status, 200);
  assert.equal((await GET(owner().request(undefined, `?planId=${s.ref.planId}&version=1&date=${today}`))).status, 404);
});
test("SCN-05: draft, future, replacement and deleted plan cannot accept new association", async () => {
  const draft = await setup(false);
  await assert.rejects(draft.service.issueLink({ ...draft.ref, rideId: "a", expectedRevision: 0, idempotencyKey: "draft" }), code("WORKOUT_NOT_LINKABLE"));
  const s = await setup(); await link(s);
  const v2 = await s.plans.propose({ intakeVersion: s.plan.intakeVersion, baseVersion: 1, proposal: proposal(25) });
  await s.plans.confirmation.confirm({ ownerId: s.f.id, request: confirmed(await s.plans.issue({ planId: s.plan.id, version: 2, activeVersion: 1, idempotencyKey: "replace" })) });
  assert.equal((await s.service.context()).ref?.version, 1); // Today's confirmed execution survives replacement.
  await assert.rejects(s.service.issueLink({ ...s.ref, rideId: "b", expectedRevision: 1, idempotencyKey: "replaced" }), code("WORKOUT_NOT_LINKABLE"));
  assert.equal((await s.service.context({ version: v2.version })).canLink, true);
  await assert.rejects(s.service.issueLink({ ...s.ref, date: addPlanDays(today, 1), rideId: "a", expectedRevision: 0, idempotencyKey: "future" }));
});
test("SCN-05: duration attainment is independent of intensity and interval quality", async () => {
  const s = await setup(); await link(s);
  const assessed = await s.service.assess({ ...s.ref, expectedRevision: 1 });
  assert.equal(assessed.facts!.durationStatus, "reached"); assert.equal(assessed.facts!.movingMinutes, 35);
  assert.equal(assessed.facts!.plannedAveragePowerW, null); assert.equal(assessed.facts!.stepsStatus, "not_verifiable"); assert.equal(assessed.facts!.intensityStatus, "not_comparable");
  const context = await executeExecutionTool(getApplicationRepository(), s.f.id, { tool: "get_training_execution", input: s.ref });
  assert.equal(context.view!.execution!.facts, null); assert.equal(context.assessmentBinding, undefined);
  const readOnlyAnswer = validateChatOutput(JSON.stringify({ schemaVersion: "ride-chat-output-v0.3", route: "autonomous_tools", responseKind: "answer", reply: "已确认关联的骑行时长达标。", claimIds: [context.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] }), { decision: makeChatDecision("autonomous_tools", "none", "AUTONOMOUS_TOOLS", 1), loopToolResults: [context] });
  assert.equal(readOnlyAnswer.ok, false); if (!readOnlyAnswer.ok) assert.equal(readOnlyAnswer.code, "OUTPUT_ACTION_UNSUPPORTED");
  const evaluated = await executeExecutionTool(getApplicationRepository(), s.f.id, { tool: "assess_training_execution", input: { ...s.ref, expectedRevision: 1 } });
  assert.equal(evaluated.view!.execution!.facts!.movingMinutes, 35); assert.ok(evaluated.assessmentBinding);
  assert.deepEqual(evaluated.view!.candidates, []);
  const artifact = evaluated.interaction!.artifact!;
  assert.equal(sanitizeChatInteractionPayload({ artifact }).artifact?.kind, "training_execution");
  for (const patch of [{ revision: -1 }, { assessmentRevision: 0.5 }, { revision: "1" }]) assert.equal(sanitizeChatInteractionPayload({ artifact: { ...artifact, payload: { ...artifact.payload, ...patch } } }).artifact, undefined);
  const missing = ride("missing"); delete missing.activity.metrics.movingTimeS;
  assert.equal(calculateExecutionFacts(s.plan, s.plan.days[0], missing).durationStatus, "unknown");
  const estimated = ride("estimated"); estimated.activity.metrics.movingTimeS!.provenance = "estimated";
  assert.equal(calculateExecutionFacts(s.plan, s.plan.days[0], estimated).movingMinutes, null);
});
test("SCN-05: replacing a confirmed record atomically clears old facts and AI feedback", async () => {
  const s = await setup(); await link(s);
  const first = await s.service.assess({ ...s.ref, expectedRevision: 1 });
  await s.service.saveFeedback({ ...s.ref, revision: 1, assessmentRevision: first.assessmentRevision, recordHash: first.recordHash, reply: "时长达到安排，但步骤尚无法核实。" });
  await link(s, "b", 1);
  const view = await s.service.context(); assert.equal(view.execution!.rideId, "b"); assert.equal(view.execution!.facts, null); assert.equal(view.execution!.narrative, null);
  await assert.rejects(s.service.saveFeedback({ ...s.ref, revision: 1, assessmentRevision: first.assessmentRevision, recordHash: first.recordHash, reply: "迟到的旧回复" }), code("VERSION_CONFLICT"));
  const next = await s.service.assess({ ...s.ref, expectedRevision: 2 }); assert.equal(next.facts!.durationStatus, "below");
});
test("SCN-05: source change or deletion hides stale conclusions and rejects delayed feedback", async () => {
  const s = await setup(); await link(s); const first = await s.service.assess({ ...s.ref, expectedRevision: 1 });
  await getApplicationRepository().saveRide(s.f.id, ride("a", `${today}T10:00:00+08:00`, 15));
  let view = await s.service.context(); assert.ok(view.staleReason); assert.equal(view.execution!.facts, null);
  await assert.rejects(s.service.saveFeedback({ ...s.ref, revision: 1, assessmentRevision: first.assessmentRevision, recordHash: first.recordHash, reply: "旧结论" }), code("CONTENT_CHANGED"));
  const updated = await s.service.assess({ ...s.ref, expectedRevision: 1 }); assert.equal(updated.facts!.movingMinutes, 15);
  await getApplicationRepository().deleteRide(s.f.id, "a"); view = await s.service.context(); assert.equal(view.execution!.facts, null);
  await assert.rejects(s.service.assess({ ...s.ref, expectedRevision: 1 }), code("RECORD_UNAVAILABLE"));
});
test("SCN-05: explicit delete is replayable, clears active state and preserves ride and execution history", async () => {
  const s = await setup(); await link(s); const evaluated = await s.service.assess({ ...s.ref, expectedRevision: 1 });
  const issued = await postPlan(s.f.request({ action: "issue_delete", planId: s.plan.id, version: 1, idempotencyKey: "delete-once" })); assert.equal(issued.status, 200);
  assert.equal((await s.plans.context()).active?.version, 1);
  const { grant } = await issued.json(), body = { action: "confirm", request: confirmed(grant) };
  assert.equal((await postPlan(s.f.request(body))).status, 200); assert.equal((await (await postPlan(s.f.request(body))).json()).replayed, true);
  assert.equal((await s.plans.context()).active, null); assert.equal((await s.service.context()).status, "no_plan");
  assert.equal((await s.service.context(s.ref)).execution!.facts!.movingMinutes, 35);
  assert.ok(await getApplicationRepository().getRide(s.f.id, "a"));
  assert.equal((await (await getPlan(s.f.request(undefined, `?planId=${s.plan.id}&version=1`))).json()).error, "PLAN_DELETED");
  await assert.rejects(s.service.assess({ ...s.ref, expectedRevision: 1 }), code("PLAN_DELETED"));
  await assert.rejects(s.service.saveFeedback({ ...s.ref, revision: 1, assessmentRevision: evaluated.assessmentRevision, recordHash: evaluated.recordHash, reply: "删除后迟到的反馈" }), code("PLAN_DELETED"));
});
test("SCN-05: delete a historical or draft version without deleting the active version", async () => {
  const s = await setup(); await s.plans.propose({ intakeVersion: s.plan.intakeVersion, baseVersion: 1, proposal: proposal(25) });
  const grant = await s.plans.issueDelete({ planId: s.plan.id, version: 2, idempotencyKey: "draft-delete" });
  await s.plans.confirmation.confirm({ ownerId: s.f.id, request: confirmed(grant) });
  const view = await s.plans.context(); assert.equal(view.active?.version, 1); assert.equal(view.draft, null);
  await assert.rejects(s.plans.issueDelete({ planId: s.plan.id, version: 2, idempotencyKey: "again" }));
});
test("SCN-05: stale delete grants cannot remove a version after activation state changes", async () => {
  const s = await setup(), grant = await s.plans.issueDelete({ planId: s.plan.id, version: 1, idempotencyKey: "stale-delete" });
  await s.plans.propose({ intakeVersion: s.plan.intakeVersion, baseVersion: 1, proposal: proposal(25) });
  await assert.rejects(s.plans.confirmation.confirm({ ownerId: s.f.id, request: confirmed(grant) }), code("CONTENT_CHANGED"));
  assert.equal((await s.plans.context()).active?.version, 1);
});
test("SCN-05: one ride cannot complete two plan versions and failed assessment preserves association", async () => {
  const s = await setup(); await link(s);
  await s.plans.propose({ intakeVersion: s.plan.intakeVersion, baseVersion: 1, proposal: proposal(25) });
  await s.plans.confirmation.confirm({ ownerId: s.f.id, request: confirmed(await s.plans.issue({ planId: s.plan.id, version: 2, activeVersion: 1, idempotencyKey: "activate-next" })) });
  const grant = await s.service.issueLink({ ...s.ref, version: 2, rideId: "a", expectedRevision: 0, idempotencyKey: "reuse-ride" });
  await assert.rejects(s.service.confirmation.confirm({ ownerId: s.f.id, request: confirmed(grant) }), code("RECORD_ALREADY_LINKED"));
  const failed = await executeExecutionTool(getApplicationRepository(), s.f.id, { tool: "assess_training_execution", input: { ...s.ref, expectedRevision: 99 } });
  assert.equal(failed.status, "blocked"); assert.equal(failed.assessmentBinding, undefined); assert.equal(failed.view!.execution!.facts, null);
  assert.equal((await s.service.context(s.ref)).execution!.revision, 1);
});
test("SCN-05: unlinked completion or fatigue stays read-only until explicit UI confirmation", async () => {
  const s = await setup(), before = await s.plans.store.read(s.f.id);
  const original = globalThis.fetch, env = { CHAT_MODEL_ENABLED: "true", CHAT_CLASSIFIER_ENABLED: "false", CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" }, previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])); Object.assign(process.env, env);
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body)), request = JSON.parse(body.messages[1].content.split("<chat_request>\n")[1].split("\n</chat_request>")[0]), last = request.toolResults?.at(-1)?.context;
    return Response.json({ choices: [{ message: { content: JSON.stringify(!last ? { schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "get_training_execution", input: {} }] } : { schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "answer", reply: "累了可以先休息，今天先放一放。没有上传记录也不代表没有训练，准备好后再继续。", claimIds: [last.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] }) } }] });
  }) as typeof fetch;
  try {
    const response = await chat(s.f.request({ text: "今天很累，不想练了。" })); assert.equal((await response.json()).execution, "validated");
    assert.deepEqual(await s.plans.store.read(s.f.id), before);
  } finally { globalThis.fetch = original; for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
test("SCN-05: real Agent orchestration assesses the confirmed record and saves only validated narrative", async () => {
  const s = await setup(); await link(s);
  const original = globalThis.fetch, env = { CHAT_MODEL_ENABLED: "true", CHAT_CLASSIFIER_ENABLED: "false", CHAT_PROVIDER_KIND: "siliconflow", SILICONFLOW_API_TOKEN: "test-only" }, previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])); Object.assign(process.env, env);
  let unsupportedAnswers = 0, calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    const body = JSON.parse(String(options?.body)), request = JSON.parse(body.messages[1].content.split("<chat_request>\n")[1].split("\n</chat_request>")[0]), last = request.toolResults?.at(-1)?.context;
    const call = (name: string, input: unknown) => ({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: name, input }] });
    const invalid = last && last.tool !== "assess_training_execution" && unsupportedAnswers++ < 2;
    const result = !last ? call("get_training_execution", {}) : invalid ? { schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "answer", reply: "时长达标。", claimIds: [last.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] } : last.tool !== "assess_training_execution" ? call("assess_training_execution", last.assessmentRequest.input) : { schemaVersion: "ride-chat-output-v0.3", route: request.route, responseKind: "answer", reply: "时长已达到计划安排；强度和步骤完成情况尚无法核实，可以结合主观感受继续讨论。", claimIds: [last.claims[0].claimId], capabilityKeys: [], knowledgeIds: [] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  }) as typeof fetch;
  try {
    const response = await chat(s.f.request({ text: "请评估我今天训练的完成情况。" })); const result = await response.json();
    assert.equal(result.execution, "validated"); assert.equal(result.choice.id, "a");
    assert.equal(result.repairAttempts, 1); assert.equal(calls, 5);
    assert.match((await s.service.context()).execution!.narrative!.reply, /步骤/);
  } finally { globalThis.fetch = original; for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
