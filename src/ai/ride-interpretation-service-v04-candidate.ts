import { CozeWorkflowError } from "./coze-workflow-error.ts";
import type {
  RideInterpretationInvocationV04Candidate,
  RideInterpretationProviderV04Candidate,
} from "./ride-interpretation-coze-client-v04-candidate.ts";
import {
  claimNumericVariants,
  normalizeRideInterpretationOutputV04Candidate,
  validateRideInterpretationOutputV04Candidate,
  type RideInterpretationOutputV04Candidate,
} from "./ride-interpretation-output-v04-candidate.ts";
import type { CandidateClaim } from "./ride-interpretation-v04-candidate.ts";
import type { RideInterpretationInputV04Candidate } from "./ride-interpretation-input-v04-candidate.ts";

export const RIDE_INTERPRETATION_SERVICE_V04_CANDIDATE_VERSION = "ride-interpretation-service-v0.4-candidate.1" as const;
/** Maximum wall time allowed for each Provider invocation. */
export const RIDE_INTERPRETATION_ATTEMPT_TIMEOUT_MS_V04_CANDIDATE = 25_000;
/** @deprecated Use the per-attempt name; retained for callers compiled against the earlier candidate API. */
export const RIDE_INTERPRETATION_TOTAL_BUDGET_MS_V04_CANDIDATE = RIDE_INTERPRETATION_ATTEMPT_TIMEOUT_MS_V04_CANDIDATE;

export type RideInterpretationFallbackCodeV04Candidate = "AI_NOT_CONFIGURED" | "AI_TIMEOUT" | "PROVIDER_ERROR" | "REPAIR_FAILED";

interface RuntimeBase {
  attempts: 1 | 2;
  latencyMs: number;
  validationIssues: string[];
  providerRequestIds: string[];
  providerDiagnostics?: ProviderDiagnostics[];
}

export interface ProviderDiagnostics {
  code: string;
  httpStatus?: number;
  businessCode?: number;
  responseJson?: boolean;
  responseBytes?: number;
}

export type RideInterpretationRuntimeResultV04Candidate =
  | (RuntimeBase & { source: "candidate"; output: RideInterpretationOutputV04Candidate; fallbackCode?: never })
  | (RuntimeBase & { source: "b0"; output: null; fallbackCode: RideInterpretationFallbackCodeV04Candidate });

function parseOutput(rawText: string): RideInterpretationOutputV04Candidate | undefined {
  try {
    return normalizeRideInterpretationOutputV04Candidate(JSON.parse(rawText));
  } catch {
    return undefined;
  }
}

function validateRawOutput(rawText: string, input: RideInterpretationInputV04Candidate): {
  output?: RideInterpretationOutputV04Candidate;
  valid: boolean;
  issues: string[];
} {
  const output = parseOutput(rawText);
  if (!output || typeof output !== "object") return { valid: false, issues: ["OUTPUT_NOT_JSON"] };
  try {
    return { output, ...validateRideInterpretationOutputV04Candidate(output, input) };
  } catch {
    return { valid: false, issues: ["OUTPUT_INVALID_SHAPE"] };
  }
}

function numericVariantsForClaim(claim: CandidateClaim, input: RideInterpretationInputV04Candidate): Set<string> {
  const values = new Set<string>();
  for (const sourceClaimId of claim.sourceClaimIds) {
    const source = input.allowedClaims.find((candidate) => candidate.claimId === sourceClaimId);
    if (!source) continue;
    for (const variant of claimNumericVariants(source)) values.add(variant);
  }
  return values;
}

function reconcileEvidenceBoundary(
  output: RideInterpretationOutputV04Candidate,
  input: RideInterpretationInputV04Candidate,
): RideInterpretationOutputV04Candidate {
  // Do not try to normalize partial or malformed objects. Structural failures
  // still belong to the single constrained model repair path.
  if (
    !Array.isArray(output.overallAssessment?.claimIds)
    || !Array.isArray(output.overallAssessment?.visualRefIds)
    || typeof output.overallAssessment?.text !== "string"
    || !Array.isArray(output.dimensions)
    || !Array.isArray(output.highlights)
    || output.dimensions.some((dimension) => (
      !Array.isArray(dimension?.claimIds)
      || !Array.isArray(dimension?.visualRefIds)
      || typeof dimension?.text !== "string"
    ))
    || output.highlights.some((highlight) => (
      !Array.isArray(highlight?.claimIds)
      || !Array.isArray(highlight?.visualRefIds)
      || typeof highlight?.text !== "string"
    ))
  ) {
    return output;
  }

  const candidateClaims = new Map(input.candidateClaims.map((claim) => [claim.claimId, claim]));
  const overallClaimIds = new Set(output.overallAssessment.claimIds);
  const nonLimitationClaims = input.candidateClaims.filter((claim) => claim.claimType !== "limitation");
  const claimsForNumber = (token: string): CandidateClaim[] => nonLimitationClaims.filter((claim) => numericVariantsForClaim(claim, input).has(token));
  const evidenceKeyForClaim = (claim: CandidateClaim): string => {
    const evidenceIds = claim.sourceClaimIds.flatMap((sourceClaimId) => (
      input.allowedClaims.find((source) => source.claimId === sourceClaimId)?.evidenceIds ?? []
    )).sort();
    return evidenceIds.length > 0 ? evidenceIds.join("|") : claim.sourceClaimIds.slice().sort().join("|");
  };
  const safelyMatchingClaims = (token: string): CandidateClaim[] => {
    const matches = claimsForNumber(token);
    if (matches.length <= 1) return matches;
    // A metric and its derived feature can intentionally expose the same
    // deterministic evidence (for example recorded elevation and positive
    // elevation gain). Bind the whole equivalent evidence group; do not guess
    // when the same number comes from different evidence.
    const evidenceGroups = new Set(matches.map(evidenceKeyForClaim));
    return evidenceGroups.size === 1 ? matches : [];
  };

  // A repair response may preserve a valid number but omit the one Candidate Claim
  // that supports it. Add only uniquely matching planned evidence.
  for (const token of output.overallAssessment.text.matchAll(/[-+]?\d+(?:\.\d+)?/g)) {
    for (const match of safelyMatchingClaims(Number(token[0]).toString())) overallClaimIds.add(match.claimId);
  }

  const dimensions = output.dimensions.length === input.dimensionInterpretations.length
    && output.dimensions.every((dimension, index) => dimension.dimensionId === input.dimensionInterpretations[index]?.dimensionId)
    ? output.dimensions.map((dimension, index) => ({
      ...dimension,
      // These bindings are owned by the frozen server plan, never by the model.
      visualRefIds: [...input.dimensionInterpretations[index]!.visualRefIds],
    }))
    : output.dimensions;

  const highlights = output.highlights.flatMap((highlight) => {
    const claimIds = [...highlight.claimIds];
    for (const claimId of claimIds) {
      if (!candidateClaims.has(claimId) || candidateClaims.get(claimId)!.claimType === "limitation") return [];
    }
    for (const token of highlight.text.matchAll(/[-+]?\d+(?:\.\d+)?/g)) {
      const matches = safelyMatchingClaims(Number(token[0]).toString());
      const existingMatch = matches.find((match) => claimIds.includes(match.claimId));
      const selectedMatch = existingMatch ?? matches[0];
      if (selectedMatch) claimIds.push(selectedMatch.claimId);
    }
    const uniqueClaimIds = [...new Set(claimIds)];
    if (uniqueClaimIds.some((claimId) => !overallClaimIds.has(claimId))) {
      for (const claimId of uniqueClaimIds) overallClaimIds.add(claimId);
    }
    // A highlight may only reuse visuals already selected for the overall card.
    // Never add or replace a visual: an empty visual list is the safe fallback.
    const visualRefIds = highlight.visualRefIds.filter((visualRefId) => input.overallAssessment.visualRefIds.includes(visualRefId));
    return [{ ...highlight, claimIds: uniqueClaimIds, visualRefIds }];
  });

  return {
    ...output,
    overallAssessment: {
      ...output.overallAssessment,
      claimIds: [...overallClaimIds],
      // The overall card must always render the server-selected visual order.
      visualRefIds: [...input.overallAssessment.visualRefIds],
    },
    dimensions,
    highlights,
  };
}

// FIX-018: labels for the deterministic fact fallback. They mirror the
// user-facing metric names so a degraded narrative only restates facts that
// the server already computed and whitelisted.
const FACT_FALLBACK_CLAIM_LABELS: Record<string, string> = {
  distanceM: "距离",
  elapsedTimeS: "总时间",
  movingTimeS: "骑行时间",
  elevationGainM: "累计爬升",
  elevationLossM: "累计下降",
  avgSpeedMps: "平均速度",
  maxSpeedMps: "最高速度",
  avgHeartRateBpm: "平均心率",
  maxHeartRateBpm: "最高心率",
  avgPowerW: "平均功率",
  maxPowerW: "最大功率",
  normalizedPowerW: "标准化功率",
  avgCadenceRpm: "平均踏频",
  maxCadenceRpm: "最大踏频",
  activityEnergyKcal: "运动消耗",
  speedSeriesMeanMps: "速度序列均值",
  heartRateSeriesMeanBpm: "心率序列均值",
  powerSeriesMeanW: "功率序列均值",
  elevationPositiveGainM: "正向海拔增益",
  speedStdDevMps: "速度波动",
  "timing.elapsedAverageSpeedMps": "总均速",
};

// Both sentences are substrings of the fixture-proven narrative in
// buildRideInterpretationOutputV04CandidateFixture. Removing a middle section
// cannot introduce a pattern violation the full sentence does not already
// avoid, so both variants are provably L8-safe.
export const PROVEN_SAFE_DIMENSION_FALLBACK_TEXT =
  "本次记录提供了该维度的可靠证据；这些证据共同反映了本次骑行的表现，也让你可以从对应证据理解这次骑行。";
export const PROVEN_SAFE_OVERALL_FALLBACK_TEXT =
  "本次记录提供了可靠证据；这些证据共同反映了本次骑行的表现，也让你可以从对应证据理解这次骑行。";

/**
 * FIX-018: build a fact-only narrative for one output object from the source
 * claims its own claimIds reference. Every number is a verbatim `displayValue`
 * token, and claimNumericVariants whitelists exactly those tokens, so the
 * result cannot introduce an unsupported number. Claims without a label, a
 * display value, or with a duration-style display are skipped.
 */
export function claimFactFallbackText(
  claimIds: string[],
  input: RideInterpretationInputV04Candidate,
): string | undefined {
  const candidateClaims = new Map(input.candidateClaims.map((claim) => [claim.claimId, claim]));
  const allowedClaims = new Map(input.allowedClaims.map((claim) => [claim.claimId, claim]));
  const fragments: string[] = [];
  const seenSourceClaimIds = new Set<string>();
  for (const claimId of claimIds) {
    const candidate = candidateClaims.get(claimId);
    if (!candidate) continue;
    for (const sourceClaimId of candidate.sourceClaimIds) {
      if (seenSourceClaimIds.has(sourceClaimId)) continue;
      seenSourceClaimIds.add(sourceClaimId);
      const source = allowedClaims.get(sourceClaimId);
      if (!source) continue;
      const label = FACT_FALLBACK_CLAIM_LABELS[source.key];
      if (!label || !source.displayValue || source.displayUnit === "duration") continue;
      fragments.push(`${label} ${source.displayValue}${source.displayUnit ? ` ${source.displayUnit}` : ""}`);
    }
  }
  if (fragments.length === 0) return undefined;
  return `${fragments.join("；")}。`;
}

function reconcileDeterministicBoundary(
  output: RideInterpretationOutputV04Candidate,
  input: RideInterpretationInputV04Candidate,
): { output: RideInterpretationOutputV04Candidate; valid: boolean; issues: string[] } {
  const evidenceReconciled = reconcileEvidenceBoundary(output, input);
  const firstValidation = validateRideInterpretationOutputV04Candidate(evidenceReconciled, input);
  const invalidHighlightIndexes = new Set(
    firstValidation.issues.flatMap((issue) => {
      const match = /^HIGHLIGHT_(\d+)_/.exec(issue);
      return match ? [Number(match[1])] : [];
    }),
  );
  // Highlights are optional. Dropping an invalid one is safer than trying to
  // rewrite model-authored text or preserve an incomplete evidence chain.
  const outputWithoutInvalidHighlights = invalidHighlightIndexes.size === 0
    ? evidenceReconciled
    : {
    ...evidenceReconciled,
    highlights: evidenceReconciled.highlights.filter((_, index) => !invalidHighlightIndexes.has(index)),
  };
  const highlightReconciledValidation = validateRideInterpretationOutputV04Candidate(outputWithoutInvalidHighlights, input);
  if (highlightReconciledValidation.valid) return { output: outputWithoutInvalidHighlights, ...highlightReconciledValidation };

  const actionScopes = actionScopesForIssues(highlightReconciledValidation.issues);
  if (actionScopes.size === 0) return { output: outputWithoutInvalidHighlights, ...highlightReconciledValidation };

  const removeUnsafeActionSentences = (text: string): string | undefined => {
    // Before removing a whole sentence, preserve an evidence-backed prefix
    // when an L8-recognized action clause begins after a clear clause boundary.
    // This covers a common model shape: "事实，骑后留意体感并按需调整节奏。".
    const lowRiskActionTail = /[，,；;]\s*(?=(?:(?:后续|接下来|今后|之后|骑后|骑行后|运动后).{0,16}(?:记录|观察|查看|留意|关注|监测|回看|整理|补水|补充水分|放松|休息|调整|控制|保持|避免|安排|增加|减少|训练|恢复)|(?:记录|观察|查看|留意|关注|监测|回看|整理|补水|补充水分|放松|休息|调整|控制|保持|避免|安排|增加|减少|训练|恢复).{0,8}(?:体感|节奏|强度|负荷|水分|状态|记录|数据|心率|功率|踏频|爬坡|休息|训练|恢复)))/g.exec(text);
    if (lowRiskActionTail && lowRiskActionTail.index > 0) {
      const factualPrefix = text.slice(0, lowRiskActionTail.index).trim();
      if (factualPrefix.length > 0) return factualPrefix;
    }

    const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [];
    const retained = sentences.filter((sentence) => !/(?:建议|应当|应该|下次|下回|下一次|后续|接下来|今后|可以尝试|可尝试|请|记得|不妨|宜|训练计划|训练安排|恢复\d*天|间歇|冲刺|阈值|高强度|加量|加练|负荷|(?:需要|需|要|可|可以|应|应该|应当|宜).{0,6}(?:记录|观察|查看|留意|关注|监测|回看|整理|补水|放松|休息|调整|控制|保持|避免|安排|增加|减少|训练|恢复)|(?:继续|保持|注意|留意|查看|监测|回看|整理|补水|放松|休息|调整|控制|避免|安排|增加|减少|训练).{0,8}(?:本次|骑行|体感|节奏|强度|负荷|水分|状态|记录|数据|心率|功率|踏频|爬坡|休息|训练|恢复))/.test(sentence));
    const reconciled = retained.join("").trim();
    if (retained.length !== sentences.length && reconciled.length > 0) return reconciled;

    // The model can append a recommendation to an otherwise factual clause
    // without a sentence terminator. Only remove from an explicit directive;
    // never use high-risk activity words alone, since they may describe facts.
    // Some repair responses use an imperative training verb without an
    // introductory suggestion. It is removable only after a factual clause
    // boundary and only with a complete high-risk training phrase.
    const directive = /(?:建议|应当|应该|下次|下回|下一次|后续|接下来|今后|可以尝试|可尝试|请|记得|不妨|宜|训练计划|训练安排|恢复\d*天)/g.exec(text);
    const imperativeTail = /[，,；;]\s*(?:安排(?:间歇|冲刺|阈值|高强度|加量|加练|负荷|训练)|(?:增加|进行|加入|开展)(?:间歇|冲刺|阈值|高强度|加量|加练|负荷)(?:训练)?)/g.exec(text);
    // Some repair output states the same concrete training instruction with a
    // modal prefix. It remains removable only after a factual clause boundary,
    // a specific action verb, and a complete high-risk training object.
    const residualTrainingTail = /[，,；;]\s*(?:(?:后续|下次|接下来)\s*)?(?:(?:建议|应当|应该|可以|可|需要|需|宜)\s*)?(?:(?:适当|逐步|继续|重点)\s*)?(?:安排|进行|开展|加入|增加|加强|加大|调整)(?:(?:间歇|冲刺|阈值|高强度|加量|加练)(?:训练)?|(?:训练)?(?:强度|负荷)|训练)/g.exec(text);
    const firstActionIndex = Math.min(
      ...[directive?.index, imperativeTail?.index, residualTrainingTail?.index].filter((index): index is number => index !== undefined && index > 0),
    );
    if (!Number.isFinite(firstActionIndex)) return undefined;
    const factualPrefix = text.slice(0, firstActionIndex).replace(/[，,；;]\s*$/, "").trim();
    if (factualPrefix.length > 0) return factualPrefix;

    return undefined;
  };

  const reconciledOverallText = actionScopes.has("overall")
    ? removeUnsafeActionSentences(outputWithoutInvalidHighlights.overallAssessment.text)
    : undefined;
  const reconciledDimensions = outputWithoutInvalidHighlights.dimensions.map((dimension) => {
    const text = actionScopes.has(`dimension:${dimension.dimensionId}`)
      ? removeUnsafeActionSentences(dimension.text)
      : undefined;
    return text ? { ...dimension, text } : dimension;
  });
  let reconciledOutput: RideInterpretationOutputV04Candidate = outputWithoutInvalidHighlights;
  let reconciledValidation = highlightReconciledValidation;
  if (reconciledOverallText || reconciledDimensions.some((dimension, index) => dimension !== outputWithoutInvalidHighlights.dimensions[index])) {
    reconciledOutput = {
      ...outputWithoutInvalidHighlights,
      overallAssessment: reconciledOverallText
        ? { ...outputWithoutInvalidHighlights.overallAssessment, text: reconciledOverallText }
        : outputWithoutInvalidHighlights.overallAssessment,
      dimensions: reconciledDimensions,
    };
    // Keep deterministic text cleanup even when another independent hard gate
    // (for example an unsupported number) still fails and needs model repair.
    // This prevents a repaired action clause from masking the actual remaining
    // issue and lets the single repair focus on that issue.
    reconciledValidation = validateRideInterpretationOutputV04Candidate(reconciledOutput, input);
  }

  // FIX-018: when overall/dimension action language cannot be safely located
  // and trimmed, replace the affected narrative with deterministic claim facts
  // (then a proven-safe template) instead of sending it to model repair. This
  // closes the recurring un-locatable action-language failure class without
  // loosening any hard gate or adding a third provider call.
  for (const useClaimFacts of [true, false]) {
    if (reconciledValidation.valid) break;
    const remainingScopes = actionScopesForIssues(reconciledValidation.issues);
    if (remainingScopes.size === 0) break;
    const fallbackText = (scope: string, claimIds: string[]): string => {
      if (useClaimFacts) {
        const factText = claimFactFallbackText(claimIds, input);
        if (factText) return factText;
      }
      return scope === "overall" ? PROVEN_SAFE_OVERALL_FALLBACK_TEXT : PROVEN_SAFE_DIMENSION_FALLBACK_TEXT;
    };
    reconciledOutput = {
      ...reconciledOutput,
      overallAssessment: remainingScopes.has("overall")
        ? { ...reconciledOutput.overallAssessment, text: fallbackText("overall", reconciledOutput.overallAssessment.claimIds) }
        : reconciledOutput.overallAssessment,
      dimensions: reconciledOutput.dimensions.map((dimension) => (remainingScopes.has(`dimension:${dimension.dimensionId}`)
        ? { ...dimension, text: fallbackText(`dimension:${dimension.dimensionId}`, dimension.claimIds) }
        : dimension)),
    };
    reconciledValidation = validateRideInterpretationOutputV04Candidate(reconciledOutput, input);
  }
  return { output: reconciledOutput, ...reconciledValidation };
}

function actionScopesForIssues(issues: string[]): Set<string> {
  return new Set(
    issues.flatMap((issue) => {
      if (issue === "OVERALL_ACTION_LANGUAGE_NOT_ALLOWED") return ["overall"];
      const match = /^DIMENSION_([^_]+(?:_[^_]+)*)_ACTION_LANGUAGE_NOT_ALLOWED$/.exec(issue);
      return match ? [`dimension:${match[1]}`] : [];
    }),
  );
}

function repairActions(issues: string[]): string[] {
  const actions: string[] = [];
  if (issues.some((issue) => issue === "ONE_LINE_LABEL_EVALUATION_WITHOUT_PERFORMANCE_EVIDENCE")) {
    actions.push("一句话标签若保留稳定、表现、能力、强弱等评价词，claimIds 必须补齐输入计划中的 performance 或 relation Claim；若没有该证据，则删除评价词并改成纯事实描述。");
  }
  if (issues.some((issue) => issue === "ONE_LINE_LABEL_UNSUPPORTED_NUMBER")) {
    actions.push("删除标签中没有被其 claimIds 直接支持的数字；只有把对应输入计划内的事实 Claim 放入标签 claimIds 后，才可保留该数字。");
  }
  if (issues.some((issue) => issue === "OVERALL_UNSUPPORTED_NUMBER")) {
    actions.push("删除整体评价中不能由其 claimIds 直接支持的数字；或仅补齐本次输入中映射同一数值的非 limitation Candidate Claim，并将它写入 overallAssessment.claimIds。该 Claim 可来自其他已选业务项；不得计算、拼接或从其他输出文本借用数字。");
  }
  if (issues.some((issue) => /(?:OVERALL|DIMENSION_.+|ONE_LINE_LABEL|HIGHLIGHT_\d+)_ACTION_LANGUAGE_NOT_ALLOWED/.test(issue))) {
    const actionScopes = actionScopesForIssues(issues);
    const targetObjects = [
      ...(actionScopes.has("overall") ? ["overallAssessment.text"] : []),
      ...[...actionScopes]
        .filter((scope) => scope.startsWith("dimension:"))
        .map((scope) => `dimensions 中 dimensionId 为 ${scope.slice("dimension:".length)} 的 text`),
    ];
    const scopeInstruction = targetObjects.length > 0
      ? `本次只处理 ${targetObjects.join("、")}；不得改写其他整体或维度叙述。`
      : "只处理报错对象，不得改写无报错的整体或维度叙述。";
    actions.push(`${scopeInstruction} 整体评价和任何维度解读只保留事实、当次表现、体现/反映的骑行能力，不得出现任何行动建议、行动引导、观察/记录/回看/留意/补水/调整/休息措辞或“下次/后续/可以/应当”表达。删除这些对象中的整句或行动尾句；所有建议只能写入固定的 nextAction，标签和高光同样不得写行动建议。`);
  }
  if (issues.some((issue) => issue === "OVERALL_VISUAL_MISMATCH")) {
    actions.push("将 overallAssessment.visualRefIds 完整恢复为输入 input.overallAssessment.visualRefIds 的原顺序；不得删除、增加、替换、重排或借用维度图表。整体高光若保留，其 visualRefIds 仍必须是修复后整体评价图表的子集。");
  }
  if (issues.some((issue) => /^HIGHLIGHT_\d+_TARGET_/.test(issue))) {
    actions.push("只修正每条 highlights 的 target：统一写成 target: { \"kind\": \"overall\" }。不得输出 dimension、dimensionId 或其他 target kind；高光即使概括某个维度，也统一显示在整体评价下。");
  }
  const highlightUnsupportedNumber = issues.some((issue) => /^HIGHLIGHT_\d+_UNSUPPORTED_NUMBER$/.test(issue));
  const highlightClaimOutsideOverall = issues.some((issue) => /^HIGHLIGHT_\d+_CLAIM_OUTSIDE_TARGET$/.test(issue));
  if (highlightUnsupportedNumber || highlightClaimOutsideOverall) {
    actions.push("逐条检查数字高光的完整证据链：高光文字中的每个数字必须由该高光 claimIds 中的 Candidate Claim 支持，且这些 Claim 同时必须已出现在 overallAssessment.claimIds。若整体评价计划允许并且该数字确实要保留，先把对应计划内 Candidate Claim 补入 overallAssessment.claimIds，再在高光中复用；否则删除数字，必要时删除整条高光。不得只删除高光 Claim ID 而保留数字。");
  }
  if (issues.some((issue) => /^HIGHLIGHT_\d+_VISUAL_OUTSIDE_TARGET$/.test(issue))) {
    actions.push("逐条检查 highlights.visualRefIds：删除不在 overallAssessment.visualRefIds 中的图表，或仅从整体评价已引用的图表中替换；无法满足时将该高光的 visualRefIds 设为 []。");
  }
  return actions;
}

function repairInstruction(issues: string[]): string {
  return [
    "上一输出未通过服务端 L8 校验。只修正 JSON 结构、计划回填、Claim/图表引用、数字或越权表达。",
    `错误码：${[...new Set(issues)].join(",") || "OUTPUT_NOT_JSON"}`,
    ...repairActions(issues),
    "所有叙述文本均不得评价数据或记录完整度；不得写数据完整、记录完整、数据记录完成或同义表述。该类表述不是本次骑行结论，也不得因修复 JSON 结构而新增。",
    "整体评价和维度评价不得出现任何行动建议或行动引导，即使它与当前 Claim 直接相关；它们只能写事实→本次骑行表现→体现/反映的骑行能力。所有建议只能放在 nextAction；删除整体评价和维度评价中的建议句或行动尾句。",
    "可以删除违规的可选高光或完整违规叙述句；不得删除系统已选维度、限制、nextAction、计划事实或计划图表。可以只在输入计划已开放的 Candidate Claim 中替换或补齐 claimIds。不得创造新 Claim、数字或跨维度计算；只输出 ride-interpretation-output-v0.4.2-candidate JSON。",
  ].join("\n");
}

function diagnosticsFor(error: unknown): ProviderDiagnostics {
  if (error instanceof CozeWorkflowError) {
    return { code: error.code, ...(error.details ?? {}) };
  }
  return { code: "UNKNOWN_PROVIDER_ERROR" };
}

function fallbackCode(error: unknown): RideInterpretationFallbackCodeV04Candidate {
  return error instanceof CozeWorkflowError && error.code === "AI_TIMEOUT" ? "AI_TIMEOUT" : "PROVIDER_ERROR";
}

export async function runRideInterpretationV04Candidate(
  input: RideInterpretationInputV04Candidate,
  provider: RideInterpretationProviderV04Candidate | undefined,
  requestId = crypto.randomUUID(),
  attemptTimeoutMs = RIDE_INTERPRETATION_ATTEMPT_TIMEOUT_MS_V04_CANDIDATE,
): Promise<RideInterpretationRuntimeResultV04Candidate> {
  const startedAt = Date.now();
  if (!provider) {
    return { source: "b0", output: null, fallbackCode: "AI_NOT_CONFIGURED", attempts: 1, latencyMs: 0, validationIssues: [], providerRequestIds: [] };
  }
  const providerRequestIds: string[] = [];
  const providerDiagnostics: ProviderDiagnostics[] = [];
  let firstRawText: string;
  try {
    const first = await provider.run({ requestId, input, timeoutMs: attemptTimeoutMs });
    if (first.providerRequestId) providerRequestIds.push(first.providerRequestId);
    if (Date.now() - startedAt > attemptTimeoutMs) {
      return { source: "b0", output: null, fallbackCode: "AI_TIMEOUT", attempts: 1, latencyMs: Date.now() - startedAt, validationIssues: [], providerRequestIds };
    }
    firstRawText = first.rawText;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (latencyMs <= attemptTimeoutMs) providerDiagnostics.push(diagnosticsFor(error));
    return { source: "b0", output: null, fallbackCode: latencyMs > attemptTimeoutMs ? "AI_TIMEOUT" : fallbackCode(error), attempts: 1, latencyMs, validationIssues: [], providerRequestIds, ...(providerDiagnostics.length ? { providerDiagnostics } : {}) };
  }

  const firstAttemptLatencyMs = Date.now() - startedAt;
  const firstRawValidation = validateRawOutput(firstRawText, input);
  const firstValidation = firstRawValidation.output
    ? reconcileDeterministicBoundary(firstRawValidation.output, input)
    : firstRawValidation;
  if (firstValidation.valid && firstValidation.output) {
    return { source: "candidate", output: firstValidation.output, attempts: 1, latencyMs: Date.now() - startedAt, validationIssues: [], providerRequestIds };
  }

  const repairStartedAt = Date.now();
  try {
    const repaired = await provider.run({
      requestId: `${requestId}:repair`,
      input,
      repairInstruction: repairInstruction(firstValidation.issues),
      previousOutput: firstRawText,
      timeoutMs: attemptTimeoutMs,
    } satisfies RideInterpretationInvocationV04Candidate);
    if (repaired.providerRequestId) providerRequestIds.push(repaired.providerRequestId);
    const repairLatencyMs = Date.now() - repairStartedAt;
    if (repairLatencyMs > attemptTimeoutMs) {
      return { source: "b0", output: null, fallbackCode: "AI_TIMEOUT", attempts: 2, latencyMs: firstAttemptLatencyMs + repairLatencyMs, validationIssues: firstValidation.issues, providerRequestIds };
    }
    const repairedRawValidation = validateRawOutput(repaired.rawText, input);
    const reconciledValidation = repairedRawValidation.output
      ? reconcileDeterministicBoundary(repairedRawValidation.output, input)
      : repairedRawValidation;
    if (reconciledValidation.valid && reconciledValidation.output) {
      return { source: "candidate", output: reconciledValidation.output, attempts: 2, latencyMs: firstAttemptLatencyMs + repairLatencyMs, validationIssues: firstValidation.issues, providerRequestIds };
    }
    return { source: "b0", output: null, fallbackCode: "REPAIR_FAILED", attempts: 2, latencyMs: Date.now() - startedAt, validationIssues: [...new Set([...firstValidation.issues, ...reconciledValidation.issues])], providerRequestIds };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (latencyMs - firstAttemptLatencyMs <= attemptTimeoutMs) providerDiagnostics.push(diagnosticsFor(error));
    return {
      source: "b0",
      output: null,
      fallbackCode: Date.now() - repairStartedAt > attemptTimeoutMs || fallbackCode(error) === "AI_TIMEOUT" ? "AI_TIMEOUT" : "REPAIR_FAILED",
      attempts: 2,
      latencyMs,
      validationIssues: firstValidation.issues,
      providerRequestIds,
      ...(providerDiagnostics.length ? { providerDiagnostics } : {}),
    };
  }
}
