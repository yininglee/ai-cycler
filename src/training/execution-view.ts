import type { PlanDay } from "../domain/training-plan.ts";
import type { TrainingExecution, TrainingExecutionRef } from "../domain/training-execution.ts";
export type ExecutionCandidate = { rideId: string; startTime: string; source: string; distanceM: number | null; minutes: number | null; hasPower: boolean; hasHeartRate: boolean };
export type ExecutionView = {
  date: string; status: "no_plan" | "draft_only" | "not_started" | "ended" | "rest" | "training" | "replaced" | "deleted";
  ref: TrainingExecutionRef | null; goal: string | null; startDate: string | null; endDate: string | null;
  day: PlanDay | null; canLink: boolean; execution: TrainingExecution | null; revision: number;
  staleReason: string | null; profileChanged: boolean;
  candidates: ExecutionCandidate[]; candidateCount: number; candidateOffset: number; moreCandidates: boolean;
};
