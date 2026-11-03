import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { executionRuntime } from "../training/execution-service.ts";
import type { ExecutionView } from "../training/execution-view.ts";
import { planDate, PlanError } from "../domain/training-plan.ts";
import type { TrainingExecutionRef } from "../domain/training-execution.ts";
import type { ChatAgentInteraction } from "./chat-interaction.ts";
export const EXECUTION_TOOL_NAMES = ["get_training_execution", "prepare_training_record_link", "assess_training_execution"] as const;
export type ExecutionToolName = typeof EXECUTION_TOOL_NAMES[number];
export type ExecutionToolInvocation = { tool: "get_training_execution"; input: Partial<TrainingExecutionRef> }
  | { tool: "prepare_training_record_link"; input: Partial<TrainingExecutionRef> }
  | { tool: "assess_training_execution"; input: TrainingExecutionRef & { expectedRevision: number } };
const integer = (value: unknown, min = 1): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(v);
export function parseExecutionTool(tool: unknown, input: Record<string, unknown>): ExecutionToolInvocation | undefined {
  if (tool === "get_training_execution" || tool === "prepare_training_record_link") {
    if (Object.keys(input).every(key => ["planId", "version", "date"].includes(key)) && (input.planId === undefined || identifier(input.planId)) && (input.version === undefined || integer(input.version)) && (input.date === undefined || planDate(input.date))) return { tool, input: input as Partial<TrainingExecutionRef> };
  }
  if (tool === "assess_training_execution" && Object.keys(input).sort().join() === "date,expectedRevision,planId,version" && identifier(input.planId) && integer(input.version) && integer(input.expectedRevision) && planDate(input.date)) return { tool, input: input as TrainingExecutionRef & { expectedRevision: number } };
}
export type ExecutionToolResult = {
  schemaVersion: "chat-tools-v0.2"; tool: ExecutionToolName; status: "ready" | "needs_link" | "blocked";
  view: ExecutionView | null; issues: Array<{ code: string; message: string }>;
  claims: Array<{ claimId: string; kind: "metric"; key: string; value: number; unit: string; confidence: "high" }>;
  assessmentBinding?: TrainingExecutionRef & { revision: number; assessmentRevision: number; recordHash: string };
  assessmentRequest?: { tool: "assess_training_execution"; input: TrainingExecutionRef & { expectedRevision: number } };
  interaction?: ChatAgentInteraction;
};
export const isExecutionToolResult = (value: { tool: string }): value is ExecutionToolResult => (EXECUTION_TOOL_NAMES as readonly string[]).includes(value.tool);
export async function executeExecutionTool(repository: ApplicationRepository, ownerId: string, call: ExecutionToolInvocation): Promise<ExecutionToolResult> {
  const service = await executionRuntime(ownerId, repository);
  const issues: ExecutionToolResult["issues"] = [];
  let assessed = false;
  if (call.tool === "assess_training_execution") {
    try { await service.assess(call.input); assessed = true; }
    catch (error) {
      if (!(error instanceof PlanError)) throw error;
      issues.push({ code: error.code, message: error.code === "LINK_REQUIRED" ? "需本人先选择并明确确认关联一条骑行记录。" : "执行数据或关联版本已变化，请重新读取后重试；没有使用旧评估。" });
    }
  }
  let view: ExecutionView | null = null;
  try { view = await service.context(call.input); }
  catch (error) { if (!(error instanceof PlanError)) throw error; issues.push({ code: error.code, message: "所选计划或日期不可用，请重新核对。" }); }
  // Candidate metrics belong to the user's selector, not the evaluated record.
  // Keep them out of model evidence so another candidate cannot justify an
  // unsupported conclusion about the confirmed association.
  if (view) view.candidates = [];
  // Context identifies the confirmed association and revision. Only the actual
  // assessment capability supplies comparison facts to a model response.
  if ((call.tool !== "assess_training_execution" || !assessed) && view?.execution && !["deleted", "replaced"].includes(view.status)) {
    view.execution.facts = null; view.execution.narrative = null;
  }
  const facts = view?.execution?.facts;
  const claims: ExecutionToolResult["claims"] = [{ claimId: "claim:execution:workflow", kind: "metric", key: "execution_workflow_available", value: 1, unit: "count", confidence: "high" }];
  const values = facts ? [["plannedMinutes", facts.plannedMinutes, "min"], ["movingMinutes", facts.movingMinutes, "min"], ["differenceMinutes", facts.differenceMinutes, "min"], ["durationPercent", facts.durationPercent, "percent"], ["averagePowerW", facts.averagePowerW, "W"], ["averageHeartRateBpm", facts.averageHeartRateBpm, "bpm"]] as const : [];
  for (const [key, value, unit] of values) if (value !== null) claims.push({ claimId: `claim:execution:${key}`, kind: "metric", key, value, unit, confidence: "high" });
  const interaction: ChatAgentInteraction | undefined = view?.ref ? { artifact: { kind: "training_execution", payload: { ...view.ref, revision: view.revision, assessmentRevision: view.execution?.assessmentRevision ?? 0, view: call.tool === "prepare_training_record_link" || !view.execution ? "link" : "assessment" } } } : undefined;
  return { schemaVersion: "chat-tools-v0.2", tool: call.tool, status: issues.length ? "blocked" : !view?.execution && call.tool === "assess_training_execution" ? "needs_link" : "ready", view, issues, claims,
    ...(call.tool === "get_training_execution" && view?.ref && view.execution && !["deleted", "replaced"].includes(view.status) ? { assessmentRequest: { tool: "assess_training_execution" as const, input: { ...view.ref, expectedRevision: view.revision } } } : {}),
    ...(assessed && view?.ref && view.execution?.facts && !view.staleReason ? { assessmentBinding: { ...view.ref, revision: view.execution.revision, assessmentRevision: view.execution.assessmentRevision, recordHash: view.execution.recordHash } } : {}), ...(interaction ? { interaction } : {}) };
}
export function executionNumericFacts(result: ExecutionToolResult): Array<{ value?: number; displayValue?: string }> {
  const walk = (v: unknown): Array<{ value?: number; displayValue?: string }> => typeof v === "number" ? [{ value: v }] : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? [{ displayValue: v }] : Array.isArray(v) ? v.flatMap(walk) : v && typeof v === "object" ? Object.entries(v).filter(([key]) => !["planId", "rideId", "recordHash", "planHash", "narrative", "linkedAt", "goal"].includes(key)).flatMap(([, value]) => walk(value)) : [];
  return [...walk(result.view), ...result.claims.map(claim => ({ value: claim.value })), ...result.issues.map(issue => ({ displayValue: issue.message }))];
}
