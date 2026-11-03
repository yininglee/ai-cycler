import { createHash, randomUUID } from "node:crypto";
import { planRuntime } from "./plan-service.ts";
import { getRideRepository } from "../persistence/demo-ride-repository.ts";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import type { PlanWorkspace } from "../persistence/training-plan-store.ts";
import { planDate, planToday, PlanError, type TrainingPlan } from "../domain/training-plan.ts";
import { calculateExecutionFacts, executionKey, rideShanghaiDate, validRideMetric, type TrainingExecutionRef, type TrainingExecution } from "../domain/training-execution.ts";
import { createConfirmedWriteService, type ConfirmedWriteHandler } from "../chat/chat-write-confirmation.ts";
import type { ExecutionView } from "./execution-view.ts";

export const trainingContentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const timestampDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export function canLinkWorkout(workspace: PlanWorkspace, plan: TrainingPlan, date: string): boolean {
  const activated = workspace.activatedAt[String(plan.version)], replaced = workspace.replacedAt[String(plan.version)];
  return !!activated && !workspace.deletedVersions[String(plan.version)] && date <= planToday() && date >= timestampDate(activated)
    && (!replaced || date < timestampDate(replaced)) && plan.days.some(day => day.date === date);
}
export async function executionRuntime(ownerId: string, application?: ApplicationRepository) {
  const plans = await planRuntime(ownerId, application), store = plans.store;
  const repository = await getRideRepository();
  const records = async () => (await repository.listRides(ownerId)).map(entry => entry.record);
  const planFor = (workspace: PlanWorkspace, ref: TrainingExecutionRef) => {
    if (workspace.id !== ref.planId) throw new PlanError("NOT_FOUND");
    const plan = workspace.plans.find(plan => plan.version === ref.version);
    if (!plan || !plan.days.some(day => day.date === ref.date)) throw new PlanError("NOT_FOUND");
    return plan;
  };
  const handler: ConfirmedWriteHandler<PlanWorkspace> = {
    async loadCurrent(workspace, targetId) {
      const draft = workspace.linkDrafts[targetId];
      if (!draft) return null;
      const ref = { planId: workspace.id, version: draft.planVersion, date: draft.date }, plan = planFor(workspace, ref);
      if (!canLinkWorkout(workspace, plan, ref.date)) throw new PlanError("WORKOUT_NOT_LINKABLE");
      const record = (await records()).find(record => record.activity.rideId === draft.rideId);
      if (!record || rideShanghaiDate(record) !== ref.date) throw new PlanError("RECORD_UNAVAILABLE");
      const revision = workspace.executions[executionKey(ref.version, ref.date)]?.revision ?? 0;
      if (revision !== draft.expectedRevision) throw new PlanError("VERSION_CONFLICT");
      return { version: `r${revision}`, content: { draft, currentRecordHash: trainingContentHash(record), currentPlanHash: trainingContentHash(plan) } };
    },
    validateSchema(content) { return !!(content as { draft?: unknown })?.draft; },
    validateRules(content) {
      const value = content as { draft: { recordHash: string; planHash: string }; currentRecordHash: string; currentPlanHash: string };
      return value.draft.recordHash === value.currentRecordHash && value.draft.planHash === value.currentPlanHash;
    },
    async apply(workspace, targetId) {
      const draft = workspace.linkDrafts[targetId], key = executionKey(draft.planVersion, draft.date), previous = workspace.executions[key];
      if (Object.values(workspace.executions).some(execution => execution !== previous && execution.rideId === draft.rideId)) throw new PlanError("RECORD_ALREADY_LINKED");
      // Replacing a record clears the old conclusion in the same transaction.
      const execution: TrainingExecution = { planVersion: draft.planVersion, date: draft.date, revision: draft.expectedRevision + 1,
        rideId: draft.rideId, linkedAt: new Date().toISOString(), recordHash: draft.recordHash, planHash: draft.planHash,
        assessmentRevision: (previous?.assessmentRevision ?? 0) + 1, facts: null, narrative: null, feedbackError: null };
      workspace.executions[key] = execution; delete workspace.linkDrafts[targetId];
      return { planId: workspace.id, version: execution.planVersion, date: execution.date, revision: execution.revision, rideId: execution.rideId, linked: true };
    },
  };
  const confirmation = createConfirmedWriteService(store, new Map([["link_training_record", handler]]));
  return {
    store, confirmation,
    async context(input: Partial<TrainingExecutionRef> & { offset?: number } = {}): Promise<ExecutionView> {
      const context = await plans.context(), workspace = context.workspace, date = input.date ?? planToday();
      if (!planDate(date)) throw new PlanError("INVALID_INPUT");
      if (input.planId && input.planId !== workspace.id) throw new PlanError("NOT_FOUND");
      const preserved = input.version === undefined ? Object.values(workspace.executions).filter(item => item.date === date && !workspace.deletedVersions[String(item.planVersion)]).sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))[0] : undefined;
      const plan = input.version !== undefined ? workspace.plans.find(plan => plan.version === input.version) : preserved ? workspace.plans.find(plan => plan.version === preserved.planVersion) : context.active;
      if (input.version !== undefined && !plan) throw new PlanError("NOT_FOUND");
      const view: ExecutionView = { date, status: !plan && context.draft ? "draft_only" : "no_plan", ref: plan ? { planId: workspace.id, version: plan.version, date } : null,
        goal: plan?.intake.goal ?? context.draft?.intake.goal ?? null, startDate: plan?.intake.startDate ?? null, endDate: plan?.intake.endDate ?? null,
        day: plan?.days.find(day => day.date === date) ?? null, canLink: false, execution: null, revision: 0, staleReason: null,
        profileChanged: !!plan && plan.basis.profileHash !== context.basis.profileHash,
        candidates: [], candidateCount: 0, candidateOffset: input.offset ?? 0, moreCandidates: false };
      if (!plan) return view;
      const deleted = workspace.deletedVersions[String(plan.version)], replaced = workspace.replacedAt[String(plan.version)];
      view.status = deleted ? "deleted" : !workspace.activatedAt[String(plan.version)] ? "draft_only" : replaced && date >= timestampDate(replaced) ? "replaced" : date < plan.intake.startDate! ? "not_started" : date > plan.intake.endDate! ? "ended" : view.day?.minutes ? "training" : "rest";
      view.canLink = canLinkWorkout(workspace, plan, date);
      const visible = await records(), execution = workspace.executions[executionKey(plan.version, date)];
      if (execution) {
        view.execution = structuredClone(execution); view.revision = execution.revision;
        const record = visible.find(record => record.activity.rideId === execution.rideId);
        if (!record || trainingContentHash(record) !== execution.recordHash || trainingContentHash(plan) !== execution.planHash) {
          view.staleReason = !record ? "关联记录已删除或不可见，请重新选择记录。" : "关联数据已变化，原评估已失效，请重新评估。";
          view.execution.facts = null; view.execution.narrative = null;
        }
      }
      if (view.canLink) {
        const candidates = visible.filter(record => rideShanghaiDate(record) === date).sort((a, b) => b.activity.startTime!.localeCompare(a.activity.startTime!));
        view.candidateCount = candidates.length;
        view.moreCandidates = view.candidateOffset + 20 < candidates.length;
        view.candidates = candidates.slice(view.candidateOffset, view.candidateOffset + 20).map(record => ({ rideId: record.activity.rideId, startTime: record.activity.startTime!, source: `${record.activity.source.platformId ?? record.activity.source.kind}${record.activity.rideId.startsWith("platform-") || record.activity.source.kind === "sample" ? " · 模拟样例" : ""}`,
          distanceM: validRideMetric(record, "distanceM"), minutes: (validRideMetric(record, "movingTimeS") ?? validRideMetric(record, "elapsedTimeS")) === null ? null : (validRideMetric(record, "movingTimeS") ?? validRideMetric(record, "elapsedTimeS"))! / 60,
          hasPower: validRideMetric(record, "avgPowerW") !== null, hasHeartRate: validRideMetric(record, "avgHeartRateBpm") !== null }));
      }
      return view;
    },
    async issueLink(input: TrainingExecutionRef & { rideId: string; expectedRevision: number; idempotencyKey: string }) {
      const record = (await records()).find(record => record.activity.rideId === input.rideId);
      if (!record || rideShanghaiDate(record) !== input.date) throw new PlanError("RECORD_UNAVAILABLE");
      const draftId = `link-${randomUUID()}`;
      await store.transaction(ownerId, async tx => {
        const workspace = tx.domain, plan = planFor(workspace, input), key = executionKey(input.version, input.date);
        if (!canLinkWorkout(workspace, plan, input.date)) throw new PlanError("WORKOUT_NOT_LINKABLE");
        if ((workspace.executions[key]?.revision ?? 0) !== input.expectedRevision) throw new PlanError("VERSION_CONFLICT");
        // Expire unconfirmed selections for this workout when another is prepared.
        for (const [id, draft] of Object.entries(workspace.linkDrafts)) if (draft.planVersion === input.version && draft.date === input.date) delete workspace.linkDrafts[id];
        workspace.linkDrafts[draftId] = { id: draftId, planVersion: input.version, date: input.date, rideId: input.rideId, expectedRevision: input.expectedRevision, recordHash: trainingContentHash(record), planHash: trainingContentHash(plan) };
      });
      return confirmation.issue({ ownerId, action: "link_training_record", targetId: draftId, expectedVersion: `r${input.expectedRevision}`, idempotencyKey: input.idempotencyKey, ttlMs: 10 * 60 * 1000 });
    },
    async assess(input: TrainingExecutionRef & { expectedRevision: number; force?: boolean }) {
      const visible = await records();
      return store.transaction<TrainingExecution>(ownerId, async tx => {
        const plan = planFor(tx.domain, input), key = executionKey(input.version, input.date), execution = tx.domain.executions[key];
        if (tx.domain.deletedVersions[String(plan.version)]) throw new PlanError("PLAN_DELETED");
        if (!execution) throw new PlanError("LINK_REQUIRED");
        if (execution.revision !== input.expectedRevision) throw new PlanError("VERSION_CONFLICT");
        const record = visible.find(record => record.activity.rideId === execution.rideId);
        if (!record || rideShanghaiDate(record) !== input.date) throw new PlanError("RECORD_UNAVAILABLE");
        const recordHash = trainingContentHash(record), planHash = trainingContentHash(plan);
        if (!input.force && execution.facts && execution.recordHash === recordHash && execution.planHash === planHash) return structuredClone(execution);
        execution.facts = calculateExecutionFacts(plan, plan.days.find(day => day.date === input.date)!, record);
        execution.recordHash = recordHash; execution.planHash = planHash; execution.assessmentRevision++;
        execution.narrative = null; execution.feedbackError = null;
        return structuredClone(execution);
      });
    },
    async saveFeedback(input: TrainingExecutionRef & { revision: number; assessmentRevision: number; recordHash: string; reply: string | null }) {
      const visible = await records();
      return store.transaction(ownerId, async tx => {
        const plan = planFor(tx.domain, input), execution = tx.domain.executions[executionKey(input.version, input.date)];
        if (tx.domain.deletedVersions[String(plan.version)]) throw new PlanError("PLAN_DELETED");
        if (!execution || !execution.facts || execution.revision !== input.revision || execution.assessmentRevision !== input.assessmentRevision || execution.recordHash !== input.recordHash) throw new PlanError("VERSION_CONFLICT");
        const record = visible.find(record => record.activity.rideId === execution.rideId);
        if (!record || trainingContentHash(record) !== execution.recordHash || trainingContentHash(plan) !== execution.planHash) throw new PlanError("CONTENT_CHANGED");
        execution.narrative = input.reply === null ? null : { reply: input.reply, createdAt: new Date().toISOString() };
        execution.feedbackError = input.reply === null ? "AI反馈暂未生成，事实对比和关联已保留，可以重试。" : null;
      });
    },
  };
}
