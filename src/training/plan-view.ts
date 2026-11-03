import type { PlanBasis, PlanIntake, TrainingPlan, planConstraints } from "../domain/training-plan.ts";
export type TrainingPlanView = {
  id: string | null; version?: number; intakeVersion?: number; confirmedIntakeVersion?: number | null;
  intake?: PlanIntake; basis?: PlanBasis; constraints?: ReturnType<typeof planConstraints>; missing?: string[];
  draft?: TrainingPlan | null; active?: TrainingPlan | null; activeVersion?: number | null; draftVersion?: number | null;
  planStatuses?: Record<string, TrainingPlanStatus>;
  viewPlan?: TrainingPlan | null; profileChanged?: boolean; activeProfileChanged?: boolean;
  deletedVersions?: Record<string, string>;
  activatedAt?: Record<string, string>; replacedAt?: Record<string, string>;
  workoutRecords?: Record<string, { completedAt: string; rideId?: string }>;
  executionRecords?: Record<string, { rideId: string; revision: number }>;
};

export type TrainingPlanStatus = "draft" | "active" | "unadopted" | "terminated";
export const trainingPlanStatusLabel: Record<TrainingPlanStatus, string> = {
  draft: "待确认草案", active: "已生效", unadopted: "未采纳", terminated: "已终止",
};
/** Lifecycle comes from durable activation/deletion history, never version ordering. */
export function trainingPlanStatus(state: {
  activeVersion: number | null; draftVersion: number | null;
  activatedAt: Record<string, string>; replacedAt: Record<string, string>; deletedVersions: Record<string, string>;
}, version: number): TrainingPlanStatus {
  const key = String(version);
  if (state.deletedVersions[key] || state.replacedAt[key]) return "terminated";
  if (state.activeVersion === version) return "active";
  if (state.activatedAt[key]) return "terminated";
  if (state.draftVersion === version) return "draft";
  return "unadopted";
}
