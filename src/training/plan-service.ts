import { createHash } from "node:crypto";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { getApplicationRepository } from "../persistence/application-repository.ts";
import { getRideRepository } from "../persistence/demo-ride-repository.ts";
import { TrainingPlanStore, type PlanWorkspace } from "../persistence/training-plan-store.ts";
import { createConfirmedWriteService, type ConfirmedWriteHandler } from "../chat/chat-write-confirmation.ts";
import { executionKey, rideShanghaiDate, validRideMetric } from "../domain/training-execution.ts";
import { planExplanationValid } from "./plan-explanation.ts";
import { createTrainingPlan, missingPlanIntake, parsePlanIntakePatch, parsePlanProposal, planConstraints, planDayIndex, planMonday, planToday, validateTrainingPlan, PlanError, type PlanBasis, type PlanIntake, type PlanProposal, type TrainingPlan } from "../domain/training-plan.ts";

export async function planRuntime(ownerId: string, repository: ApplicationRepository = getApplicationRepository()) {
  const profile = await repository.getProfile(ownerId);
  const profileHash = createHash("sha256").update(JSON.stringify({ age: profile?.age, ftp: profile?.ftp, maxHeartRate: profile?.maxHeartRate, goal: profile?.ux?.goal })).digest("hex");
  const entries = await (await getRideRepository()).listRides(ownerId);
  const today = planToday();
  const recent = entries.map(e => e.record).filter(record => {
    if (!record.activity.startTime || !Number.isFinite(Date.parse(record.activity.startTime))) return false;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(record.activity.startTime));
    return date <= today && planDayIndex(today) - planDayIndex(date) < 28;
  });
  const durations = recent.flatMap(record => { const metric = record.activity.metrics.movingTimeS; return metric?.qualityStatus === "valid" && Number.isFinite(metric.value) ? [metric.value / 60] : []; });
  const recordedBasis = { weeklyMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / 4) : null, longestRideMinutes: durations.length ? Math.round(Math.max(...durations)) : null };
  const store = new TrainingPlanStore(profile?.ux?.mode === "blank" ? `blank:${profile.ux.blankSince}` : "default");
  function basis(intake: PlanIntake): PlanBasis {
    const selfReported = intake.weeklyMinutes !== null || intake.longestRideMinutes !== null;
    return { profileHash, ftpWatts: profile?.ftp?.trustStatus === "user_confirmed" ? profile.ftp.valueWatts : null,
      weeklyMinutes: intake.weeklyMinutes ?? recordedBasis.weeklyMinutes, longestRideMinutes: intake.longestRideMinutes ?? recordedBasis.longestRideMinutes,
      rideCount: recent.length, source: selfReported ? "self_report" : recent.length ? "records" : "missing" };
  }
  const current = (workspace: PlanWorkspace, version: number | null) => workspace.plans.find(plan => plan.version === version && !workspace.deletedVersions[String(plan.version)]) ?? null;
  const handler: ConfirmedWriteHandler<PlanWorkspace> = {
    async loadCurrent(workspace, targetId) {
      const draft = current(workspace, workspace.draftVersion);
      return workspace.id === targetId && draft ? { version: `v${draft.version}`, content: { plan: draft, activeVersion: workspace.activeVersion, replacementDate: planToday() } } : null;
    },
    validateSchema(content) {
      const plan = (content as { plan?: TrainingPlan })?.plan;
      if (!plan) return false;
      try {
        parsePlanIntakePatch(plan.intake); parsePlanProposal(plan.proposal);
        const canonical = createTrainingPlan({ id: plan.id, version: plan.version, intakeVersion: plan.intakeVersion, intake: plan.intake, basis: plan.basis, proposal: plan.proposal, now: plan.createdAt });
        return JSON.stringify(canonical) === JSON.stringify(plan);
      } catch { return false; }
    },
    validateRules(content) {
      const plan = (content as { plan: TrainingPlan }).plan;
      return plan.basis.profileHash === profileHash && validateTrainingPlan(plan).length === 0 && planExplanationValid(plan);
    },
    async apply(workspace, _id, draft) {
      const plan = (draft.content as { plan: TrainingPlan }).plan;
      if (workspace.activeVersion !== null) workspace.replacedAt[String(workspace.activeVersion)] = `${(draft.content as { replacementDate: string }).replacementDate}T00:00:00+08:00`;
      workspace.activeVersion = plan.version; workspace.draftVersion = null;
      workspace.activatedAt[String(plan.version)] = new Date().toISOString();
      return { planId: workspace.id, version: plan.version, activated: true };
    },
  };
  const deleteHandler: ConfirmedWriteHandler<PlanWorkspace> = {
    async loadCurrent(workspace, targetId) {
      const match = targetId.match(/:v([1-9]\d*)$/);
      const plan = match && targetId.slice(0, match.index) === workspace.id ? current(workspace, Number(match[1])) : null;
      return plan ? { version: `v${plan.version}`, content: { plan, activeVersion: workspace.activeVersion, draftVersion: workspace.draftVersion, workspaceVersion: workspace.version } } : null;
    },
    validateSchema(content) { const plan = (content as { plan?: TrainingPlan })?.plan; return !!plan && plan.schemaVersion === "training-plan-v1" && Number.isSafeInteger(plan.version) && plan.version > 0 && Array.isArray(plan.days); },
    validateRules() { return true; },
    async apply(workspace, _id, draft) {
      const plan = (draft.content as { plan: TrainingPlan }).plan;
      workspace.deletedVersions[String(plan.version)] = new Date().toISOString();
      if (workspace.activeVersion === plan.version) workspace.activeVersion = null;
      if (workspace.draftVersion === plan.version) workspace.draftVersion = null;
      for (const [id, link] of Object.entries(workspace.linkDrafts)) if (link.planVersion === plan.version) delete workspace.linkDrafts[id];
      return { planId: workspace.id, version: plan.version, deleted: true };
    },
  };
  const handlers = new Map([["activate_training_plan", handler], ["delete_training_plan", deleteHandler]]);
  const confirmation = createConfirmedWriteService(store, handlers);
  return {
    store, confirmation,
    async issueDelete(input: { planId: string; version: number; idempotencyKey: string }) {
      if ((await store.read(ownerId)).id !== input.planId) throw new PlanError("NOT_FOUND");
      return confirmation.issue({ ownerId, action: "delete_training_plan", targetId: `${input.planId}:v${input.version}`, expectedVersion: `v${input.version}`, idempotencyKey: input.idempotencyKey, ttlMs: 10 * 60 * 1000 });
    },
    async issue(input: { planId: string; version: number; activeVersion: number | null; idempotencyKey: string }) {
      const checkedHandler = { ...handler, async loadCurrent(workspace: PlanWorkspace, targetId: string) {
        if (workspace.activeVersion !== input.activeVersion) throw new PlanError("VERSION_CONFLICT");
        return handler.loadCurrent(workspace, targetId);
      } };
      return createConfirmedWriteService(store, new Map([["activate_training_plan", checkedHandler]])).issue({ ownerId, action: "activate_training_plan", targetId: input.planId, expectedVersion: `v${input.version}`, idempotencyKey: input.idempotencyKey, ttlMs: 10 * 60 * 1000 });
    },
    weekProgress(workspace: PlanWorkspace, active: TrainingPlan | null): Record<string, number | null> {
      if (!active) return {};
      const monday = planMonday(today);
      const records = new Map(entries.map(({ record }) => [record.activity.rideId, record]));
      const progress: Record<string, number | null> = {};
      for (const day of active.days) {
        if (day.date < monday || day.date > today) continue;
        const execution = workspace.executions[executionKey(active.version, day.date)];
        const record = execution && records.get(execution.rideId);
        if (!record || rideShanghaiDate(record) !== day.date) continue;
        const moving = validRideMetric(record, "movingTimeS");
        progress[day.date] = day.minutes > 0 && moving !== null ? Math.min(1, moving / (day.minutes * 60)) : null;
      }
      return progress;
    },
    async context() {
      const workspace = await store.read(ownerId);
      const actualBasis = basis(workspace.intake);
      const draft = current(workspace, workspace.draftVersion), active = current(workspace, workspace.activeVersion);
      return { workspace, basis: actualBasis, constraints: planConstraints(actualBasis), missing: missingPlanIntake(workspace.intake, actualBasis), draft, active, profileChanged: !!(draft ?? active) && (draft ?? active)!.basis.profileHash !== profileHash, activeProfileChanged: !!active && active.basis.profileHash !== profileHash };
    },
    async prepare(patch: Partial<PlanIntake>, expectedVersion?: number, fromAgent = false, startNew = false) {
      const parsed = parsePlanIntakePatch(patch);
      // Only a direct user form confirmation may declare no training concern.
      if (fromAgent && parsed.healthConcern === false) delete parsed.healthConcern;
      return store.transaction<PlanWorkspace>(ownerId, async tx => {
        const workspace = tx.domain;
        if (expectedVersion !== undefined && workspace.intakeVersion !== expectedVersion) throw new PlanError("VERSION_CONFLICT");
        const next = { ...workspace.intake, ...parsed };
        if (startNew || JSON.stringify(next) !== JSON.stringify(workspace.intake)) {
          workspace.intake = startNew ? { ...next, healthConcern: parsed.healthConcern ?? null } : next; workspace.intakeVersion++; workspace.confirmedIntakeVersion = null; workspace.draftVersion = null;
        }
        return structuredClone(workspace);
      });
    },
    async confirmIntake(input: unknown, expectedVersion: number) {
      const parsed = parsePlanIntakePatch(input);
      return store.transaction<PlanWorkspace>(ownerId, async tx => {
        const workspace = tx.domain;
        if (workspace.intakeVersion !== expectedVersion) throw new PlanError("VERSION_CONFLICT");
        workspace.intake = { ...workspace.intake, ...parsed }; workspace.intakeVersion++;
        const actualBasis = basis(workspace.intake), missing = missingPlanIntake(workspace.intake, actualBasis);
        if (missing.length) throw new PlanError("MISSING_INTAKE", missing.map(message => ({ code: "MISSING_INTAKE", message })));
        if (workspace.intake.healthConcern !== false) throw new PlanError("TRAINING_CONCERN");
        const { startDate, endDate } = workspace.intake;
        if (!startDate || !endDate || endDate < startDate || planDayIndex(endDate) - planDayIndex(startDate) > 365 || endDate < today) throw new PlanError("INVALID_PERIOD");
        workspace.confirmedIntakeVersion = workspace.intakeVersion; workspace.draftVersion = null;
        return structuredClone(workspace);
      });
    },
    async propose(input: { intakeVersion: number; baseVersion: number; proposal: PlanProposal }) {
      const proposal = parsePlanProposal(input.proposal);
      return store.transaction<TrainingPlan>(ownerId, async tx => {
        const workspace = tx.domain;
        if (input.baseVersion !== workspace.version || input.intakeVersion !== workspace.intakeVersion) throw new PlanError("VERSION_CONFLICT");
        if (workspace.confirmedIntakeVersion !== workspace.intakeVersion) throw new PlanError("INTAKE_NOT_CONFIRMED");
        const draft = createTrainingPlan({ id: workspace.id, version: workspace.version + 1, intakeVersion: workspace.intakeVersion, intake: workspace.intake, basis: basis(workspace.intake), proposal });
        if (!planExplanationValid(draft)) throw new PlanError("RULES_REJECTED", [{ code: "EXPLANATION_UNSUPPORTED", message: "计划说明含未经支持的数值或承诺，请仅解释已核对的基础与当前安排。" }]);
        const existing = current(workspace, workspace.draftVersion);
        if (existing && existing.intakeVersion === draft.intakeVersion && JSON.stringify(existing.basis) === JSON.stringify(draft.basis) && JSON.stringify(existing.days) === JSON.stringify(draft.days)) return structuredClone(existing);
        workspace.version = draft.version; workspace.draftVersion = draft.version; workspace.plans.push(draft);
        return structuredClone(draft);
      });
    },
  };
}
