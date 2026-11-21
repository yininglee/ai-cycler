import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { planRuntime } from "../training/plan-service.ts";
import { PLAN_SCHEDULING_RULES, parsePlanIntakePatch, parsePlanProposal, PlanError, planDate, planWeekCount, type PlanIntake, type PlanProposal, type TrainingPlan, type PlanDay } from "../domain/training-plan.ts";
import { trainingPlanStatus, type TrainingPlanStatus } from "../training/plan-view.ts";
import type { ChatAgentInteraction } from "./chat-interaction.ts";

export const PLAN_TOOL_NAMES = ["get_training_plan_context", "prepare_training_plan", "propose_training_plan"] as const;
export type PlanToolName = typeof PLAN_TOOL_NAMES[number];
export type PlanToolInvocation = { tool: "get_training_plan_context"; input: { version?: number; date?: string } }
  | { tool: "prepare_training_plan"; input: { patch: Partial<PlanIntake>; expectedVersion: number; startNew?: boolean } }
  | { tool: "propose_training_plan"; input: { intakeVersion: number; baseVersion: number; proposal: PlanProposal } };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function parsePlanTool(tool: unknown, input: Record<string, unknown>): PlanToolInvocation | undefined {
  if (tool === "get_training_plan_context" && Object.keys(input).every(key => ["version", "date"].includes(key)) && (input.version === undefined || version(input.version) && input.version >= 1) && (input.date === undefined || planDate(input.date))) return { tool, input: input as { version?: number; date?: string } };
  if (tool === "prepare_training_plan" && Object.keys(input).every(key => ["expectedVersion", "patch", "startNew"].includes(key)) && record(input.patch) && version(input.expectedVersion) && (input.startNew === undefined || typeof input.startNew === "boolean")) return { tool, input: { patch: parsePlanIntakePatch(input.patch), expectedVersion: input.expectedVersion, ...(input.startNew !== undefined ? { startNew: input.startNew } : {}) } };
  if (tool === "propose_training_plan" && Object.keys(input).sort().join() === "baseVersion,intakeVersion,proposal" && version(input.intakeVersion) && version(input.baseVersion)) return { tool, input: { intakeVersion: input.intakeVersion, baseVersion: input.baseVersion, proposal: parsePlanProposal(input.proposal) } };
  return undefined;
}
function summary(plan: TrainingPlan | null, status: TrainingPlanStatus = "draft") {
  return plan ? { status, scheduleOverview: `目标为${plan.intake.goal}，周期${plan.intake.startDate}至${plan.intake.endDate}，首周${plan.days.filter(day => day.week === 1 && day.minutes > 0).length}次训练、共${plan.days.filter(day => day.week === 1).reduce((sum, day) => sum + day.minutes, 0)}分钟。`, id: plan.id, version: plan.version, intakeVersion: plan.intakeVersion, startDate: plan.intake.startDate, endDate: plan.intake.endDate,
    totalMinutes: plan.days.reduce((sum, day) => sum + day.minutes, 0), weeks: planWeekCount(plan.intake),
    weekly: Array.from({ length: planWeekCount(plan.intake) }, (_, i) => { const days = plan.days.filter(day => day.week === i + 1); return { week: i + 1, sessions: days.filter(day => day.minutes > 0).length, minutes: days.reduce((sum, day) => sum + day.minutes, 0) }; }),
    goal: plan.intake.goal, proposal: plan.proposal, basisSource: plan.basis.source } : null;
}
type PlanContext = Awaited<ReturnType<Awaited<ReturnType<typeof planRuntime>>["context"]>>;
export type PlanToolResult = {
  schemaVersion: "chat-tools-v0.2"; tool: PlanToolName; status: "context" | "intake_ready" | "draft_ready" | "blocked";
  state: { id: string; intakeVersion: number; confirmedIntakeVersion: number | null; version: number; intake: PlanIntake; basis: PlanContext["basis"]; constraints: PlanContext["constraints"]; missing: string[]; draft: ReturnType<typeof summary>; active: ReturnType<typeof summary>; selected: { plan: ReturnType<typeof summary>; date?: string; day: PlanDay | null } | null };
  issues: Array<{ code: string; message: string; date?: string }>;
  schedulingRules?: string;
  unchanged?: boolean;
  claims: Array<{ claimId: string; kind: "metric"; key: string; value: number; unit: string; confidence: "high" }>;
  interaction?: ChatAgentInteraction;
};
export const isPlanToolResult = (v: { tool: string }): v is PlanToolResult => (PLAN_TOOL_NAMES as readonly string[]).includes(v.tool);
export async function executePlanTool(repository: ApplicationRepository, ownerId: string, call: PlanToolInvocation): Promise<PlanToolResult> {
  const service = await planRuntime(ownerId, repository);
  let status: PlanToolResult["status"] = "context";
  let unchanged = false;
  let issues: PlanToolResult["issues"] = [];
  try {
    if (call.tool === "prepare_training_plan") { await service.prepare(call.input.patch, call.input.expectedVersion, true, call.input.startNew); status = "intake_ready"; }
    if (call.tool === "propose_training_plan") { const plan = await service.propose({ ...call.input, reviseDraftOnly: true }); unchanged = plan.version === call.input.baseVersion; status = "draft_ready"; }
  } catch (error) {
    if (!(error instanceof PlanError)) throw error;
    status = "blocked"; issues = error.issues.length ? error.issues : [{ code: error.code, message: error.code === "INTAKE_NOT_CONFIRMED" ? "请先在信息卡核对并确认生成。" : error.code === "VERSION_CONFLICT" ? "信息或草案版本已变化，请重新读取后再修改。" : "信息或规则未通过，当前计划没有启用。" }];
  }
  const context = await service.context(), workspace = context.workspace;
  let selected: PlanToolResult["state"]["selected"] = null;
  if (call.tool === "get_training_plan_context" && (call.input.version !== undefined || call.input.date)) {
    const plan = call.input.version !== undefined ? workspace.plans.find(plan => plan.version === call.input.version) : context.draft ?? context.active;
    if (!plan) { status = "blocked"; issues.push({ code: "NOT_FOUND", message: "所选计划版本不可用，请核对当前版本。" }); }
    else selected = { plan: summary(plan, trainingPlanStatus(workspace, plan.version)), ...(call.input.date ? { date: call.input.date } : {}), day: call.input.date ? plan.days.find(day => day.date === call.input.date) ?? null : null };
  }
  const state = { id: workspace.id, intakeVersion: workspace.intakeVersion, confirmedIntakeVersion: workspace.confirmedIntakeVersion, version: workspace.version, intake: workspace.intake, basis: context.basis, constraints: context.constraints, missing: context.missing, draft: summary(context.draft), active: summary(context.active, "active"), selected };
  const claims: PlanToolResult["claims"] = [{ claimId: "claim:plan:workflow", kind: "metric", key: "plan_workflow_available", value: 1, unit: "count", confidence: "high" },
    { claimId: "claim:plan:version", kind: "metric", key: "plan_version", value: state.version, unit: "count", confidence: "high" },
    ...(state.draft ? [{ claimId: "claim:plan:minutes", kind: "metric" as const, key: "plan_total_minutes", value: state.draft.totalMinutes, unit: "min", confidence: "high" as const }] : [])];
  // Only references leave the server. No confirmation token is ever an Agent result.
  const referencedPlan = call.tool === "get_training_plan_context" ? selected?.plan ?? state.draft ?? state.active : status === "draft_ready" ? state.draft : null;
  const creating = call.tool === "prepare_training_plan" && call.input.startNew === true && status === "intake_ready";
  const artifact = call.tool === "get_training_plan_context" && status === "blocked" ? undefined : { kind: "training_plan" as const, payload: { planId: workspace.id, intakeVersion: workspace.intakeVersion, version: referencedPlan?.version ?? null, view: creating ? "create" as const : referencedPlan ? referencedPlan.version === workspace.activeVersion ? "active" as const : "draft" as const : "intake" as const } };
  return { schemaVersion: "chat-tools-v0.2", tool: call.tool, status, state, issues,
    ...(context.draft && { schedulingRules: PLAN_SCHEDULING_RULES }), claims, ...(unchanged ? { unchanged: true } : {}), ...(artifact ? { interaction: { artifact } } : {}) };
}
export function planNumericFacts(result: PlanToolResult) {
  const numbers = (v: unknown): Array<{ value?: number; displayValue?: string }> => typeof v === "number" ? [{ value: v }] : Array.isArray(v) ? v.flatMap(numbers) : record(v) ? Object.entries(v).filter(([key]) => !["rationale", "profileHash", "id", "goal", "notes", "selfReportedBasis", "periodReason"].includes(key)).flatMap(([, entry]) => numbers(entry)) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? [{ displayValue: v }] : [];
  return [...numbers(result.state), ...[result.state.intake.goal, result.state.active?.goal, result.state.draft?.goal, result.state.selected?.plan?.goal].flatMap(goal => goal ? [{ displayValue: goal }] : []), ...result.issues.map(issue => ({ displayValue: issue.message }))];
}
