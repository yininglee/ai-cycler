export const TRAINING_PLAN_RULES_VERSION = "training-plan-rules-v1" as const;
export const TRAINING_PLAN_SCHEMA_VERSION = "training-plan-v1" as const;
export const WORKOUT_KINDS = ["recovery", "endurance", "tempo", "threshold"] as const;
export type WorkoutKind = typeof WORKOUT_KINDS[number];
export type Availability = { weekday: number; minutes: number };
export type PlanIntake = {
  goal: string; startDate: string | null; endDate: string | null; periodReason: string;
  availability: Availability[]; weeklyMinutes: number | null; longestRideMinutes: number | null;
  selfReportedBasis: string; powerMeter: boolean | null; avoidDates: string[];
  healthConcern: boolean | null; notes: string;
};
export type PlanBasis = { profileHash: string; ftpWatts: number | null; weeklyMinutes: number | null; longestRideMinutes: number | null; rideCount: number; source: "records" | "self_report" | "missing" };
export type PlanBlock = { fromWeek: number; toWeek: number; sessions: Array<{ weekday: number; kind: WorkoutKind; minutes: number }> };
export type PlanProposal = { blocks: PlanBlock[]; rationale: string };
export type PlanStep = { label: string; minutes: number; effort: string; powerWatts?: [number, number] };
export type PlanDay = { date: string; week: number; kind: WorkoutKind | "rest"; title: string; minutes: number; purpose: string; steps: PlanStep[] };
export type TrainingPlan = {
  schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION; rulesVersion: typeof TRAINING_PLAN_RULES_VERSION;
  id: string; version: number; createdAt: string; intakeVersion: number;
  intake: PlanIntake; basis: PlanBasis; proposal: PlanProposal; days: PlanDay[];
};
export type PlanRuleIssue = { code: string; message: string; date?: string };
export class PlanError extends Error {
  readonly code: string;
  readonly issues: PlanRuleIssue[];
  constructor(code: string, issues: PlanRuleIssue[] = []) { super(code); this.name = "PlanError"; this.code = code; this.issues = issues; }
}
export const emptyPlanIntake = (): PlanIntake => ({ goal: "", startDate: null, endDate: null, periodReason: "", availability: [], weeklyMinutes: null, longestRideMinutes: null, selfReportedBasis: "", powerMeter: null, avoidDates: [], healthConcern: null, notes: "" });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
export function planDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export const planToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const planDayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
export const addPlanDays = (date: string, days: number) => new Date((planDayIndex(date) + days) * 86_400_000).toISOString().slice(0, 10);
export const planWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
export const planMonday = (date: string) => addPlanDays(date, 1 - planWeekday(date));
export function planWeekCount(intake: Pick<PlanIntake, "startDate" | "endDate">): number {
  return intake.startDate && intake.endDate ? Math.floor((planDayIndex(intake.endDate) - planDayIndex(planMonday(intake.startDate))) / 7) + 1 : 0;
}

/** Explicit structured values only; the Agent interprets language, this checks its parameters. */
export function parsePlanIntakePatch(value: unknown): Partial<PlanIntake> {
  if (!object(value)) throw new PlanError("INVALID_INPUT");
  const allowed = Object.keys(emptyPlanIntake());
  for (const [key, v] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new PlanError("INVALID_INPUT");
    const valid = key === "goal" ? text(v, 500)
      : ["periodReason", "selfReportedBasis", "notes"].includes(key) ? text(v, 400)
        : key === "startDate" || key === "endDate" ? v === null || planDate(v)
          : key === "weeklyMinutes" ? v === null || integer(v, 0, 2400)
            : key === "longestRideMinutes" ? v === null || integer(v, 0, 600)
              : key === "powerMeter" || key === "healthConcern" ? v === null || typeof v === "boolean"
                : key === "avoidDates" ? Array.isArray(v) && v.length <= 100 && v.every(planDate) && new Set(v).size === v.length
                  : key === "availability" && Array.isArray(v) && v.length <= 7 && v.every(day => object(day) && Object.keys(day).sort().join() === "minutes,weekday" && integer(day.weekday, 1, 7) && integer(day.minutes, 15, 240)) && new Set(v.map(day => day.weekday)).size === v.length;
    if (!valid) throw new PlanError("INVALID_INPUT");
  }
  return structuredClone(value) as Partial<PlanIntake>;
}
export function parsePlanProposal(value: unknown): PlanProposal {
  if (!object(value) || Object.keys(value).sort().join() !== "blocks,rationale" || !text(value.rationale, 600) || !value.rationale.trim() || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 16) throw new PlanError("INVALID_INPUT");
  for (const block of value.blocks) {
    if (!object(block) || Object.keys(block).sort().join() !== "fromWeek,sessions,toWeek" || !integer(block.fromWeek, 1, 54) || !integer(block.toWeek, block.fromWeek, 54) || !Array.isArray(block.sessions) || !block.sessions.length || block.sessions.length > 6) throw new PlanError("INVALID_INPUT");
    for (const session of block.sessions) if (!object(session) || Object.keys(session).sort().join() !== "kind,minutes,weekday" || !integer(session.weekday, 1, 7) || !integer(session.minutes, 15, 240) || !(WORKOUT_KINDS as readonly unknown[]).includes(session.kind)) throw new PlanError("INVALID_INPUT");
    if (new Set(block.sessions.map(session => session.weekday)).size !== block.sessions.length) throw new PlanError("INVALID_INPUT");
  }
  return structuredClone(value) as PlanProposal;
}

export function missingPlanIntake(intake: PlanIntake, basis: PlanBasis): string[] {
  return [!intake.goal.trim() && "目标", !intake.startDate && "开始日期", !intake.endDate && "结束日期／周期", !intake.availability.length && "每周可训练日期及各天时长", basis.weeklyMinutes === null && "近期每周骑行时长或自述基础", basis.longestRideMinutes === null && "近期单次最长骑行时长", intake.healthConcern === null && "是否有影响训练的不适（需本人核对）"].filter((v): v is string => !!v);
}
const labels: Record<WorkoutKind, { title: string; purpose: string; effort: string; power: [number, number] }> = {
  recovery: { title: "轻松恢复骑", purpose: "轻松活动与恢复", effort: "轻松，可舒适交谈；主观用力 1–2 / 10", power: [45, 55] },
  endurance: { title: "有氧耐力骑", purpose: "建立可持续的有氧耐力", effort: "轻至中等，可完整交谈；主观用力 2–4 / 10", power: [56, 75] },
  tempo: { title: "节奏练习", purpose: "练习持续、受控的踩踏节奏", effort: "适中，保持受控；主观用力 5–6 / 10", power: [76, 90] },
  threshold: { title: "阈值间歇练习", purpose: "分段练习较吃力但受控的持续输出", effort: "较吃力但不力竭；主观用力 7–8 / 10", power: [91, 100] },
};
function steps(kind: WorkoutKind, minutes: number, intake: PlanIntake, basis: PlanBasis): PlanStep[] {
  const step = (label: string, length: number, type: WorkoutKind): PlanStep => ({ label, minutes: length, effort: labels[type].effort,
    ...(intake.powerMeter && basis.ftpWatts ? { powerWatts: labels[type].power.map(percent => Math.round(basis.ftpWatts! * percent / 100)) as [number, number] } : {}) });
  if (kind === "threshold") {
    const work = Math.min(15, Math.floor((minutes - 25) / 2));
    return [step("热身", 10, "recovery"), step("第一段受控间歇", work, kind), step("轻松恢复", 5, "recovery"), step("第二段受控间歇", work, kind), step("冷身", minutes - 25 - work * 2 + 10, "recovery")];
  }
  const warmup = kind === "tempo" ? 10 : 5;
  return [step("热身", warmup, "recovery"), step(labels[kind].title, minutes - warmup * 2, kind), step("冷身", warmup, "recovery")];
}
export function planConstraints(basis: PlanBasis) {
  return { firstWeekMaxMinutes: Math.floor(Math.max(60, (basis.weeklyMinutes ?? 0) * 1.1)), singleRideMaxMinutes: Math.floor(Math.min(240, Math.max(30, (basis.longestRideMinutes ?? 0) * 1.1))), weeklyGrowthMaxPercent: 10, maxHardSessionsPer7Days: 2, maxSessionsPer7Days: 6, allowHardSessions: (basis.weeklyMinutes ?? 0) >= 120 && (basis.longestRideMinutes ?? 0) >= 45 };
}
export function validateTrainingPlan(plan: TrainingPlan, today = planToday()): PlanRuleIssue[] {
  const issues: PlanRuleIssue[] = [];
  const { intake, basis, proposal } = plan;
  const issue = (code: string, message: string, date?: string) => issues.push({ code, message, ...(date ? { date } : {}) });
  if (missingPlanIntake(intake, basis).length) issue("MISSING_INTAKE", "必要信息尚未核对完整。");
  if (!intake.startDate || !intake.endDate || !planDate(intake.startDate) || !planDate(intake.endDate) || intake.endDate < intake.startDate || planDayIndex(intake.endDate) - planDayIndex(intake.startDate) > 365) { issue("INVALID_PERIOD", "日期范围需明确且不超过366天。"); return issues; }
  if (intake.endDate < today) issue("PERIOD_ENDED", "计划日期已结束，请更新周期。");
  if (intake.healthConcern !== false) issue("TRAINING_CONCERN", "有影响训练的不适或尚未核对，暂不生成可启用计划。");
  if (plan.rulesVersion !== TRAINING_PLAN_RULES_VERSION) issue("RULES_CHANGED", "规则版本已更新，需要重新生成。");
  const weeks = planWeekCount(intake), covered = new Set<number>();
  for (const block of proposal.blocks) for (let week = block.fromWeek; week <= block.toWeek; week++) {
    if (covered.has(week) || week > weeks) issue("BLOCK_COVERAGE", "周阶段存在重叠或超出周期。");
    covered.add(week);
  }
  if (covered.size !== weeks || !Array.from({ length: weeks }, (_, i) => covered.has(i + 1)).every(Boolean)) issue("BLOCK_COVERAGE", "周阶段必须覆盖整个周期且不重叠。");
  const constraints = planConstraints(basis);
  for (const day of plan.days) {
    if (!day.minutes) continue;
    const available = intake.availability.find(a => a.weekday === planWeekday(day.date));
    if (!available || day.minutes > available.minutes || intake.avoidDates.includes(day.date)) issue("AVAILABILITY", "训练安排超出可用日期或时长。", day.date);
    if (day.minutes > constraints.singleRideMaxMinutes) issue("SINGLE_RIDE_LIMIT", `单次时长不能超过当前基础对应的${constraints.singleRideMaxMinutes}分钟。`, day.date);
    if (day.kind === "tempo" || day.kind === "threshold") {
      if (!constraints.allowHardSessions) issue("BASELINE_TOO_LOW", "当前基础仅支持轻松和耐力训练。", day.date);
      if (day.minutes < (day.kind === "threshold" ? 35 : 30) || day.minutes > 60) issue("HARD_DURATION", "节奏／阈值单次时长需在相应的30或35分钟至60分钟之间。", day.date);
    }
    if (day.steps.some(step => step.minutes <= 0 || step.powerWatts && (!basis.ftpWatts || step.powerWatts[1] > basis.ftpWatts)) || day.steps.reduce((sum, step) => sum + step.minutes, 0) !== day.minutes) issue("STEP_LIMIT", "训练步骤时长或功率上限不合规则。", day.date);
  }
  for (let i = 0; i < plan.days.length; i++) {
    const window = plan.days.slice(i, i + 7), hard = window.filter(day => day.kind === "tempo" || day.kind === "threshold");
    if (window.filter(day => day.minutes > 0).length > 6) issue("RECOVERY_DAY", "任意连续七天至少保留一个休息日。");
    if (hard.length > 2) issue("HARD_FREQUENCY", "任意连续七天最多两次节奏／阈值练习。");
    if (i && ["tempo", "threshold"].includes(plan.days[i].kind) && ["tempo", "threshold"].includes(plan.days[i - 1].kind)) issue("HARD_CONSECUTIVE", "节奏／阈值练习不能连续两天安排。");
  }
  let previous = basis.weeklyMinutes ?? 0;
  for (let week = 1; week <= weeks; week++) {
    const days = plan.days.filter(day => day.week === week), total = days.reduce((sum, day) => sum + day.minutes, 0);
    const cap = Math.floor(Math.max(60, previous * 1.1));
    if (total > cap) issue("WEEKLY_VOLUME", `第${week}周总时长${total}分钟超过当前规则上限${cap}分钟。`);
    if (days.length === 7 && total > 0) previous = total;
  }
  if (!plan.days.some(day => day.minutes > 0)) issue("EMPTY_PLAN", "周期内没有实际训练日，请调整时间安排。");
  return issues;
}
export function createTrainingPlan(input: { id: string; version: number; intakeVersion: number; intake: PlanIntake; basis: PlanBasis; proposal: PlanProposal; now?: string }): TrainingPlan {
  const { intake, basis, proposal } = input;
  if (!intake.startDate || !intake.endDate || !planDate(intake.startDate) || !planDate(intake.endDate) || intake.endDate < intake.startDate || planDayIndex(intake.endDate) - planDayIndex(intake.startDate) > 365) throw new PlanError("RULES_REJECTED", [{ code: "INVALID_PERIOD", message: "请补齐有效日期范围。" }]);
  const days: PlanDay[] = [];
  for (let offset = 0; offset <= planDayIndex(intake.endDate) - planDayIndex(intake.startDate); offset++) {
    const date = addPlanDays(intake.startDate, offset);
    const week = Math.floor((planDayIndex(date) - planDayIndex(planMonday(intake.startDate))) / 7) + 1;
    const block = proposal.blocks.find(b => b.fromWeek <= week && b.toWeek >= week);
    const session = !intake.avoidDates.includes(date) ? block?.sessions.find(s => s.weekday === planWeekday(date)) : undefined;
    days.push(session ? { date, week, kind: session.kind, title: labels[session.kind].title, minutes: session.minutes, purpose: labels[session.kind].purpose, steps: steps(session.kind, session.minutes, intake, basis) }
      : { date, week, kind: "rest", title: "休息", minutes: 0, purpose: "恢复与日常活动，不补排训练", steps: [] });
  }
  const plan: TrainingPlan = { schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, rulesVersion: TRAINING_PLAN_RULES_VERSION, id: input.id, version: input.version, createdAt: input.now ?? new Date().toISOString(), intakeVersion: input.intakeVersion, intake: structuredClone(intake), basis: structuredClone(basis), proposal: structuredClone(proposal), days };
  const issues = validateTrainingPlan(plan);
  if (issues.length) throw new PlanError("RULES_REJECTED", issues);
  return plan;
}
