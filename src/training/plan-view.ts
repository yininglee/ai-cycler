import type { PlanBasis, PlanIntake, TrainingPlan, planConstraints } from "../domain/training-plan.ts";
export type TrainingPlanView = {
  id: string | null; version?: number; intakeVersion?: number; confirmedIntakeVersion?: number | null;
  intake?: PlanIntake; basis?: PlanBasis; constraints?: ReturnType<typeof planConstraints>; missing?: string[];
  draft?: TrainingPlan | null; active?: TrainingPlan | null; activeVersion?: number | null; draftVersion?: number | null;
  viewPlan?: TrainingPlan | null; profileChanged?: boolean; activeProfileChanged?: boolean;
  activatedAt?: Record<string, string>; replacedAt?: Record<string, string>;
  workoutRecords?: Record<string, { completedAt: string; rideId?: string }>;
  executionRecords?: Record<string, { rideId: string; revision: number }>;
};
