import type { RideRecord, MetricKey } from "./ride-schema.ts";
import type { PlanDay, TrainingPlan } from "./training-plan.ts";

export const TRAINING_EXECUTION_VERSION = "training-execution-v1" as const;
export type ExecutionFacts = {
  schemaVersion: typeof TRAINING_EXECUTION_VERSION; date: string; title: string;
  plannedMinutes: number; movingMinutes: number | null; elapsedMinutes: number | null;
  differenceMinutes: number | null; durationPercent: number | null;
  durationStatus: "reached" | "below" | "unknown" | "rest";
  averagePowerW: number | null; averageHeartRateBpm: number | null;
  plannedAveragePowerW: [number, number] | null;
  intensityStatus: "reference_only" | "not_comparable";
  stepsStatus: "not_verifiable"; limitations: string[];
};
export type TrainingExecution = {
  planVersion: number; date: string; revision: number; rideId: string; linkedAt: string;
  recordHash: string; planHash: string; assessmentRevision: number;
  facts: ExecutionFacts | null; narrative: { reply: string; createdAt: string } | null;
  feedbackError: string | null;
};
export type TrainingLinkDraft = { id: string; planVersion: number; date: string; rideId: string; expectedRevision: number; recordHash: string; planHash: string };
export type TrainingExecutionRef = { planId: string; version: number; date: string };
export const executionKey = (version: number, date: string) => `${version}:${date}`;
export function rideShanghaiDate(record: RideRecord): string | null {
  const time = record.activity.startTime;
  return time && Number.isFinite(Date.parse(time)) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time)) : null;
}
export function validRideMetric(record: RideRecord, key: MetricKey): number | null {
  const value = record.activity.metrics[key];
  return value?.qualityStatus === "valid" && value.provenance !== "estimated" && value.confidence !== "low" && Number.isFinite(value.value) && value.value >= 0 ? value.value : null;
}
const rounded = (value: number) => Math.round(value * 100) / 100;
/** Compare only facts with a shared meaning. No clinical score or inferred FTP. */
export function calculateExecutionFacts(plan: TrainingPlan, day: PlanDay, record: RideRecord): ExecutionFacts {
  const moving = validRideMetric(record, "movingTimeS"), elapsed = validRideMetric(record, "elapsedTimeS");
  const plannedS = day.minutes * 60, averagePowerW = validRideMetric(record, "avgPowerW");
  const limitations = ["记录没有与计划步骤对应的圈段标记，无法核实每一步的完成及间歇顺序。"];
  if (moving === null) limitations.push("缺少有效移动时长；总时长可能包含停顿，不能据此判定达到计划训练时长。");
  const powered = !!plan.intake.powerMeter && !!plan.basis.ftpWatts && day.steps.length > 0 && day.steps.every(step => !!step.powerWatts);
  const range: [number, number] | null = powered ? [0, 1].map(index => Math.round(day.steps.reduce((sum, step) => sum + step.powerWatts![index] * step.minutes, 0) / day.minutes)) as [number, number] : null;
  if (!range) limitations.push("计划采用主观用力／交谈提示，记录没有对应主观反馈，不能把功率或心率直接换算成执行质量。");
  else if (averagePowerW === null) limitations.push("缺少有效平均功率，无法与计划功率目标作整体参照。");
  else limitations.push("计划加权功率区间与实际平均功率仅作整体参照；时长、停顿和步骤顺序不同都会影响比较，不能据此判定间歇完成。");
  if (!day.minutes) limitations.push("当天为休息安排；关联骑行仅记录实际活动，不作缺训或训练完成评分。");
  return { schemaVersion: TRAINING_EXECUTION_VERSION, date: day.date, title: day.title,
    plannedMinutes: day.minutes, movingMinutes: moving === null ? null : rounded(moving / 60), elapsedMinutes: elapsed === null ? null : rounded(elapsed / 60),
    differenceMinutes: moving === null || !plannedS ? null : rounded((moving - plannedS) / 60),
    durationPercent: moving === null || !plannedS ? null : rounded(moving / plannedS * 100),
    durationStatus: !plannedS ? "rest" : moving === null ? "unknown" : moving >= plannedS ? "reached" : "below",
    averagePowerW, averageHeartRateBpm: validRideMetric(record, "avgHeartRateBpm"), plannedAveragePowerW: range,
    intensityStatus: range && averagePowerW !== null ? "reference_only" : "not_comparable", stepsStatus: "not_verifiable", limitations };
}
