// AGT-B0：chat 层的数值证据等价类（G4 修复）。
//
// 背景（2026-10-24 实测）：旧实现 `numericValues()` 只把 `claim.value` 与原样
// `displayValue` 收进白名单，判定用严格字面量相等——工具给 30.4 km，模型说
// "大约 30 公里" 被拒（`OUTPUT_NUMERIC_UNSUPPORTED`）。而骑后解读链路早在
// `src/ai/ride-interpretation-output-v04-candidate.ts: claimNumericVariants` 里
// 解决了同一问题（舍入 + 单位换算 + 比例），chat 层只是没接——属"资产没用上"。
//
// 本模块把该口径搬到 chat 层，**规则与 claimNumericVariants 逐条对齐**，并由
// `tests/chat-numeric-evidence.test.ts` 的一致性单测守住（同一输入必须产出同一变体集），
// 避免两条链路各写一套后悄悄漂移。
//
// 红线（与项目既有口径一致）：只允许"同一事实的呈现形式"——
//   ✅ 舍入（30.4 → 30 / 30.4）、单位换算（m↔km、m/s↔km/h、s↔min/h）、比例（ratio↔%）
//   ❌ 跨事实计算（用距离÷时间推速度、两个 claim 相减得到第三个新数字）
// 等价类放宽的是**表达形式**，不是**事实来源**：任何数字仍必须能溯源到本轮工具结果。

export type ChatNumericFact = {
  value?: number;
  unit?: string;
  key?: string;
  // 展示值（如 "30.4"、"1 小时 6 分钟"）——其中的数字 token 与原值同源，成对收编。
  displayValue?: string;
};

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;

// AGT-B5（校验器误伤，第五轮 REPAIR_FAILED 最大项的根因）：模型会在 reply 正文里内联
// 引用标记（如「约1001公里（claim:loop:1:2）」）标注来源——claimId/knowledgeId 里的
// 编号（1、2）不是数据数字，但旧提取器把它们当数字 → 白名单无裸 1/2 → NUMERIC_UNSUPPORTED
// 两轮拒 → REPAIR_FAILED。数字提取前必须先剥离引用标记。
const REFERENCE_PATTERN = /claim:[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*|kb-v[A-Za-z0-9_-]+/g;

/** 从文本中抽取数字 token（与 claimNumericVariants 的 numberTokens 同口径；引用标记已剥离）。 */
export function chatNumberTokens(text: string): string[] {
  return [...text.replaceAll(REFERENCE_PATTERN, " ").matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]).toString());
}

function addVariants(target: Set<string>, value: number, rounded = true): void {
  if (!Number.isFinite(value)) return;
  target.add(value.toString());
  if (!rounded) return;
  // 舍入到 0/1/2 位——覆盖"约 30 公里"（30.4）、"30.40" 这类口语化表达。
  for (const digits of [0, 1, 2]) target.add(Number(value.toFixed(digits)).toString());
}

/**
 * 单条数值事实的合法呈现形式。
 * 顺序与换算规则对齐 `src/ai/.../claimNumericVariants`（grep 该函数即可对照）。
 */
export function chatNumericVariants(fact: ChatNumericFact): Set<string> {
  const variants = new Set<string>();
  if (fact.value !== undefined && Number.isFinite(fact.value)) addVariants(variants, fact.value);
  for (const token of chatNumberTokens(fact.displayValue ?? "")) addVariants(variants, Number(token));

  // 以下都是**同一事实的呈现换算**，不是跨事实计算。
  if (fact.unit === "m/s" && fact.value !== undefined) addVariants(variants, fact.value * 3.6);
  if (fact.unit === "km/h" && fact.value !== undefined) addVariants(variants, fact.value / 3.6);
  if (fact.key === "distanceM" && fact.unit === "m" && fact.value !== undefined) addVariants(variants, fact.value / 1_000);
  if ((fact.key === "elapsedTimeS" || fact.key === "movingTimeS") && fact.unit === "s" && fact.value !== undefined) {
    addVariants(variants, fact.value / 60);
    addVariants(variants, fact.value / 3_600);
  }
  // AGT-B0：比 claimNumericVariants（只认 NP ratio 与 CV）更宽——chat 层任何 ratio
  // 事实都按百分比呈现，这是纯格式换算。为保持一致，若后续收窄须同步两侧单测。
  if (fact.unit === "ratio" && fact.value !== undefined) addVariants(variants, fact.value * 100);

  // 负数差值常被表述为"低了 4.5"——仍是同一事实，不是新计算。
  for (const variant of [...variants]) {
    const parsed = Number(variant);
    if (Number.isFinite(parsed) && parsed < 0) variants.add(Math.abs(parsed).toString());
  }
  return variants;
}

/** 一批事实的变体并集。 */
export function chatNumericVariantSet(facts: Iterable<ChatNumericFact>): Set<string> {
  const union = new Set<string>();
  for (const fact of facts) for (const variant of chatNumericVariants(fact)) union.add(variant);
  return union;
}

/**
 * 回复中的每个数字都必须能溯源到：本轮工具事实的等价类，或用户原句里的数字。
 * 用户原句同样走等价类（用户说 120.5、模型复述"约 120"不是幻觉）。
 */
export function chatNumbersSupported(
  reply: string,
  facts: Iterable<ChatNumericFact>,
  userText?: string,
): boolean {
  const allowed = chatNumericVariantSet(facts);
  for (const token of chatNumberTokens(userText ?? "")) addVariants(allowed, Number(token));
  // AGT-B5：统一走 chatNumberTokens（剥引用后的提取）——旧实现直接 reply.match(NUMBER_PATTERN)
  // 与 token 化双轨不一致，claim:loop:1:2 里的 1/2 被当数据数字误伤。
  return chatNumberTokens(reply).every((token) => allowed.has(token));
}
