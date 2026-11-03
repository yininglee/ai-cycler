import type { TrainingPlan } from "../domain/training-plan.ts";
import { chatNumbersSupported, type ChatNumericFact } from "../chat/chat-numeric-evidence.ts";

/** Model prose is untrusted even when the schedule was validated. Never use
 * its numbers as evidence for itself or as personal baseline facts. */
export function planExplanationValid(plan: TrainingPlan): boolean {
  const facts: ChatNumericFact[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "number") facts.push({ value });
    else if (typeof value === "string") facts.push({ displayValue: value });
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
      if (!["id", "profileHash", "createdAt", "rationale", "goal", "notes", "selfReportedBasis", "periodReason", "schemaVersion", "rulesVersion"].includes(key)) walk(entry);
    }
  };
  walk(plan);
  facts.push({ value: plan.days.reduce((sum, day) => sum + day.minutes, 0) }, { value: plan.days.filter(day => day.minutes > 0).length });
  for (const week of new Set(plan.days.map(day => day.week))) {
    const days = plan.days.filter(day => day.week === week);
    facts.push({ value: days.filter(day => day.minutes).length }, { value: days.reduce((sum, day) => sum + day.minutes, 0) });
  }
  const text = plan.proposal.rationale;
  return chatNumbersSupported(text, facts) && !/(保证|必然|一定)(?:.{0,12})(提高|提升|进步|安全|有效)|治愈|服药|药物剂量|系统提示词|api[ _-]?key|访问令牌|忽略.{0,12}指令/i.test(text);
}
