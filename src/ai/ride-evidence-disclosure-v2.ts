import type { RideModelInputV2 } from "../domain/ride-model-input-v2.ts";

export const RIDE_EVIDENCE_DISCLOSURE = `【数据有限时如何写】
- 整体评价：eligibility=available 的问题不足两个时，写“本次可用数据有限”并陈述已知事实。
- 维度仍有事实：每条骑行判断引用该维度给出的事实。若 qualityStatus=soft、eligibility=partial 或引用了 soft Claim，降低结论强度，并在该维度提示“本维度数据覆盖有限”。
- 维度没有可引用事实（例如只有 limitation Claim）：整个从 dimensions 数组中省略该维度。具体缺项放在 limitations 中，按输入原文回填已解读维度及无事实维度的限制，不在正文列举缺少哪些指标。`;

/** Keep the stated limits of omitted, evidence-free dimensions visible in the report. */
export function disclosureQuestions(input: RideModelInputV2, included: Set<string>) {
  const facts = new Set(input.claims.filter(claim => claim.kind !== "limitation").map(claim => claim.claimId));
  return input.questions.filter(question => included.has(question.dimensionId) || !question.claimIds.some(id => facts.has(id)));
}
