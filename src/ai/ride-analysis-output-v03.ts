import type { Confidence } from "../domain/ride-schema.ts";
import {
  type AnalysisDimensionKey,
  type AnalysisEligibility,
  validateAnalysisEligibility,
} from "../domain/analysis-eligibility.ts";
import type { RideAnalysisContext } from "../domain/ride-analysis-context.ts";

export const RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION = "ride-analysis-output-v0.3" as const;

export interface RideAnalysisDimensionInsight {
  key: AnalysisDimensionKey;
  text: string;
  claimIds: string[];
  confidence: Confidence;
}

export interface RideAnalysisNotableEvent {
  eventId: string;
  text: string;
  claimIds: string[];
}

export interface RideAnalysisNextAction {
  kind: "grounded" | "general";
  text: string;
  basisClaimIds: string[];
}

export interface RideAnalysisOutputV03 {
  schemaVersion: typeof RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION;
  headline: string;
  overallAssessment: {
    text: string;
    claimIds: string[];
  };
  dimensions: RideAnalysisDimensionInsight[];
  notableEvents: RideAnalysisNotableEvent[];
  nextAction: RideAnalysisNextAction | null;
  limitations: string[];
  safetyLevel: "normal" | "caution" | "stop";
  shareCopy: [string, string, string];
}

export interface RideAnalysisOutputV03ValidationResult {
  valid: boolean;
  issues: string[];
  output?: RideAnalysisOutputV03;
}

const DIMENSION_KEYS = new Set<AnalysisDimensionKey>(["endurance", "pace", "climbing", "heartRate", "power", "cadence", "history"]);
const CONFIDENCE_VALUES = new Set<Confidence>(["high", "medium", "low"]);
const SAFETY_VALUES = new Set<RideAnalysisOutputV03["safetyLevel"]>(["normal", "caution", "stop"]);
const NUMBER_PATTERN = /[-+]?\d+(?:\.\d+)?/g;
const FORBIDDEN_PATTERNS = [/医疗诊断/, /保证提升/, /恢复时间/, /体能(?:提升|进步|退步)/, /提示词|system prompt|密钥/i];
const VISIBLE_HISTORY_GAP_PATTERNS = [/没有(?:可比)?历史/, /无(?:可用|足够|可比).*历史.*(?:对比|比较)/, /历史(?:骑行|记录|数据)?(?:不足|不可比)/, /无法(?:和|与)?过往骑行对比/, /无法.*历史.*对比/, /(?:不包含|不提供|未提供|没有).{0,8}历史(?:对比|比较|分析)/];
const DATA_COMPLETENESS_PATTERNS = [/数据(?:记录)?完整/, /记录完整(?:清晰)?/, /数据记录(?:完成|已完成)/];
const DISTANCE_CLASSIFICATION_PATTERNS = [/长距离(?:骑行)?/, /短距离(?:骑行)?/];
const ROUTE_CLASSIFICATION_PATTERNS = [/起伏(?:不大|很小|较小|平缓|明显|较大|很大)/, /起伏平缓/, /海拔落差不大/, /(?:路线|路况|地形|地势)(?:较为|比较|整体|相对)?(?:平缓|平坦|陡峭)/];
const EFFORT_CLASSIFICATION_PATTERNS = [/(?:轻松|舒适|休闲|吃力)的?骑行/, /轻松(?:完成|骑行|达到)/, /舒服出汗/, /畅快骑行/, /舒服/, /状态(?:很好|不错|较好|不佳|较差)/];
const UNSUPPORTED_CONTEXT_LABEL_PATTERNS = [/(?:周末|工作日|节假日|今天|今日|昨天|昨日|明天)/, /(?:晨骑|早骑|午骑|夜骑|夜间骑行|清晨骑行)/];
const UNSUPPORTED_PLAN_PATTERNS = [/(?:今日|今天)?骑行计划/, /按计划/, /完成(?:了)?计划/];
const UNSUPPORTED_SUBJECTIVE_EXPERIENCE_PATTERNS = [/活力满满/, /享受(?:在路上|骑行|本次|这次)/, /骑行的(?:快乐|乐趣)/];
const PHYSIOLOGICAL_CAUSALITY_PATTERNS = [/符合.*体能变化规律/, /说明.*(?:疲劳|体能)/];
const MISSING_INPUT_LISTING_PATTERNS = [
  /(?:缺少|没有|无)(?:[^。；,，]{0,18})(?:心率|功率|踏频|传感器|设备数据).{0,12}(?:无法|不能|不支持)/,
  /(?:无法|不能|不支持).{0,12}(?:心率|功率|踏频|传感器|设备数据)/,
];
const SENSOR_LIMITATION_PATTERNS = [/(?:心率|功率|踏频|传感器|设备数据)/];
const SENSOR_IMPACT_PATTERNS = [/(?:因此|所以|导致|无法|不能|不涉及|不包含|限制|仅能)/];
const LOW_VALUE_META_PATTERNS = [
  /(?:基础|基本)(?:的)?(?:骑行)?数据(?:特征|信息)/,
  /(?:爬升|距离|速度|功率|心率|踏频)总量明确/,
];
const HALF_SEGMENT_PATTERNS = [/前半程/, /后半程/];
const OVERBROAD_SERIES_CONCLUSION_PATTERNS = [/(?:全程|整个骑行|整个过程).{0,12}(?:没有变化|无变化|保持不变)/, /(?:没有变化|无变化|保持不变).{0,12}(?:全程|整个骑行|整个过程)/];
const UNSCOPED_CONSISTENCY_PATTERN = /(?:功率|速度|心率|踏频)(?:输出|节奏)?保持一致/g;
const HEADLINE_EVALUATION_PATTERNS = [
  /整体/, /节奏/, /配速/, /表现/, /完成度/, /连贯/, /一致/, /变化/, /回落/, /起伏/, /稳定/, /平稳/, /均衡/, /衔接/,
];

function hasPattern(texts: string[], patterns: RegExp[]): boolean {
  return texts.some((text) => patterns.some((pattern) => pattern.test(text)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function numberTokens(value: string): string[] {
  return [...value.matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]).toString());
}

function addNumericVariants(target: Set<string>, value: number, rounded = false): void {
  if (!Number.isFinite(value)) return;
  target.add(value.toString());
  if (!rounded) return;
  for (const digits of [0, 1, 2]) target.add(Number(value.toFixed(digits)).toString());
}

function claimNumericVariants(claim: RideAnalysisContext["allowedClaims"][number]): Set<string> {
  const variants = new Set<string>();
  const sourceValues: number[] = [];
  if (claim.value !== undefined && Number.isFinite(claim.value)) sourceValues.push(claim.value);
  for (const text of [claim.text, claim.displayValue]) {
    if (!text) continue;
    for (const token of numberTokens(text)) sourceValues.push(Number(token));
  }
  for (const value of sourceValues) addNumericVariants(variants, value);

  // These are the only model-side display conversions currently accepted. They
  // are presentation changes of one Claim, not permission to invent metrics.
  if (claim.unit === "m/s") addNumericVariants(variants, claim.value! * 3.6, true);
  if (claim.unit === "km/h") addNumericVariants(variants, claim.value! / 3.6, true);
  if (claim.key === "distanceM" && claim.unit === "m") addNumericVariants(variants, claim.value! / 1_000, true);
  if ((claim.key === "elapsedTimeS" || claim.key === "movingTimeS") && claim.unit === "s") {
    addNumericVariants(variants, claim.value! / 60, true);
    addNumericVariants(variants, claim.value! / 3_600, true);
  }
  if (claim.unit === "ratio" && (claim.key === "normalizedPowerRatio" || claim.key.endsWith("CoefficientOfVariation"))) {
    addNumericVariants(variants, claim.value! * 100, true);
    addNumericVariants(variants, (claim.value! - 1) * 100, true);
    addNumericVariants(variants, (1 - claim.value!) * 100, true);
  }
  return variants;
}

function claimNumbers(context: RideAnalysisContext, claimIds: string[]): Set<string> {
  const claims = new Map(context.allowedClaims.map((claim) => [claim.claimId, claim]));
  const normalized = new Set<string>();
  for (const claimId of claimIds) {
    const claim = claims.get(claimId);
    if (!claim) continue;
    for (const number of claimNumericVariants(claim)) normalized.add(number);
    for (const number of claimNumericVariants(claim)) {
      const parsed = Number(number);
      if (!Number.isFinite(parsed)) continue;
    // Natural Chinese phrasing often expresses a negative delta as "lower by 4.49".
      if (parsed < 0) normalized.add(Math.abs(parsed).toString());
    }
  }
  return normalized;
}

function validateClaimRefs(claimIds: string[], context: RideAnalysisContext, issues: string[], field: string): void {
  const claims = new Set(context.allowedClaims.map((claim) => claim.claimId));
  if (new Set(claimIds).size !== claimIds.length) issues.push(`${field}_DUPLICATE_CLAIM`);
  for (const claimId of claimIds) if (!claims.has(claimId)) issues.push(`${field}_UNKNOWN_CLAIM`);
}

function validateClaimNumbers(text: string, claimIds: string[], context: RideAnalysisContext, issues: string[], field: string): void {
  const allowed = claimNumbers(context, claimIds);
  for (const token of numberTokens(text)) if (!allowed.has(Number(token).toString())) issues.push(`${field}_UNSUPPORTED_NUMBER`);
}

type OverallTopic = "distance" | "time" | "pace" | "elevation" | "heartRate" | "power" | "cadence" | "energy";

const OVERALL_TOPIC_PATTERNS: Array<[OverallTopic, RegExp]> = [
  ["heartRate", /心率/],
  ["power", /功率|标准化功率|训练负荷/],
  ["cadence", /踏频|踩踏/],
  ["elevation", /爬升|海拔/],
  ["energy", /运动消耗|消耗|卡路里|大卡/],
  ["distance", /距离|里程|公里|km(?!\/h)/i],
  ["time", /用时|时长|小时|分钟|移动时间/],
  ["pace", /速度|配速|节奏/],
];

function claimSupportsTopic(claim: RideAnalysisContext["allowedClaims"][number], topic: OverallTopic): boolean {
  const key = claim.key.toLowerCase();
  switch (topic) {
    case "distance": return key === "distancem";
    case "time": return key === "movingtimes" || key === "elapsedtimes";
    case "pace": return key.includes("speed") || key === "avgspeedmps" || key === "maxspeedmps";
    case "elevation": return key.toLowerCase().includes("elevation");
    case "heartRate": return key.toLowerCase().includes("heartrate");
    case "power": return key.toLowerCase().includes("power");
    case "cadence": return key.toLowerCase().includes("cadence");
    case "energy": return key === "activityenergykcal";
  }
}

function validateOverallClaimCoverage(text: string, claimIds: string[], context: RideAnalysisContext, issues: string[]): void {
  const claims = new Map(context.allowedClaims.map((claim) => [claim.claimId, claim]));
  const referenced = claimIds.map((claimId) => claims.get(claimId)).filter((claim): claim is NonNullable<typeof claim> => Boolean(claim));
  for (const [topic, pattern] of OVERALL_TOPIC_PATTERNS) {
    if (pattern.test(text) && !referenced.some((claim) => claimSupportsTopic(claim, topic))) {
      issues.push("OVERALL_TOPIC_WITHOUT_CLAIM");
    }
  }
}

function hasUnscopedConsistencyConclusion(texts: string[]): boolean {
  for (const text of texts) {
    for (const match of text.matchAll(UNSCOPED_CONSISTENCY_PATTERN)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 6), match.index ?? 0);
      if (!/(首末|开始|结束|阶段)/.test(before)) return true;
    }
  }
  return false;
}

export function validateRideAnalysisOutputV03(
  value: unknown,
  context: RideAnalysisContext,
  eligibility: AnalysisEligibility,
): RideAnalysisOutputV03ValidationResult {
  const issues: string[] = [];
  const eligibilityValidation = validateAnalysisEligibility(eligibility);
  if (!eligibilityValidation.valid) issues.push(...eligibilityValidation.issues.map((issue) => `ELIGIBILITY_${issue}`));
  if (!eligibility.eligible) issues.push("ELIGIBILITY_BLOCKS_MODEL_OUTPUT");
  const root = asRecord(value);
  if (!root) return { valid: false, issues: ["OUTPUT_NOT_OBJECT", ...issues] };
  const rootKeys = new Set(["schemaVersion", "headline", "overallAssessment", "dimensions", "notableEvents", "nextAction", "limitations", "safetyLevel", "shareCopy"]);
  if (!hasOnlyKeys(root, rootKeys)) issues.push("OUTPUT_UNKNOWN_FIELD");
  if (root.schemaVersion !== RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION) issues.push("INVALID_OUTPUT_SCHEMA_VERSION");
  const headline = typeof root.headline === "string" ? root.headline : undefined;
  const overall = asRecord(root.overallAssessment);
  const dimensionsValue = Array.isArray(root.dimensions) ? root.dimensions : undefined;
  const eventsValue = Array.isArray(root.notableEvents) ? root.notableEvents : undefined;
  const nextActionValue = root.nextAction === null ? null : asRecord(root.nextAction);
  const limitations = asStringArray(root.limitations);
  const shareCopy = asStringArray(root.shareCopy);
  const safetyLevel = typeof root.safetyLevel === "string" && SAFETY_VALUES.has(root.safetyLevel as RideAnalysisOutputV03["safetyLevel"])
    ? root.safetyLevel as RideAnalysisOutputV03["safetyLevel"]
    : undefined;

  if (!headline) issues.push("INVALID_HEADLINE");
  if (!overall) issues.push("INVALID_OVERALL_ASSESSMENT");
  if (!dimensionsValue) issues.push("INVALID_DIMENSIONS");
  if (!eventsValue) issues.push("INVALID_NOTABLE_EVENTS");
  if (root.nextAction !== null && !nextActionValue) issues.push("INVALID_NEXT_ACTION");
  if (!limitations) issues.push("INVALID_LIMITATIONS");
  if (!shareCopy) issues.push("INVALID_SHARE_COPY");
  if (!safetyLevel) issues.push("INVALID_SAFETY_LEVEL");

  if (headline && (headline.length === 0 || headline.length > 20)) issues.push("INVALID_HEADLINE_LENGTH");
  if (overall) {
    if (!hasOnlyKeys(overall, new Set(["text", "claimIds"]))) issues.push("OVERALL_UNKNOWN_FIELD");
    if (typeof overall.text !== "string" || overall.text.length === 0 || overall.text.length > 240) issues.push("INVALID_OVERALL_TEXT");
    const claimIds = asStringArray(overall.claimIds);
    if (!claimIds || claimIds.length === 0) issues.push("INVALID_OVERALL_CLAIMS");
    else {
      validateClaimRefs(claimIds, context, issues, "OVERALL");
      validateClaimNumbers(overall.text as string, claimIds, context, issues, "OVERALL");
      validateOverallClaimCoverage(overall.text as string, claimIds, context, issues);
    }
  }

  const parsedDimensions: RideAnalysisDimensionInsight[] = [];
  if (dimensionsValue) {
    if (dimensionsValue.length > 6) issues.push("TOO_MANY_DIMENSIONS");
    for (const item of dimensionsValue) {
      const dimension = asRecord(item);
      if (!dimension || !hasOnlyKeys(dimension, new Set(["key", "text", "claimIds", "confidence"]))) {
        issues.push("INVALID_DIMENSION_OBJECT");
        continue;
      }
      const key = typeof dimension.key === "string" && DIMENSION_KEYS.has(dimension.key as AnalysisDimensionKey) ? dimension.key as AnalysisDimensionKey : undefined;
      const text = typeof dimension.text === "string" ? dimension.text : undefined;
      const claimIds = asStringArray(dimension.claimIds);
      const confidence = typeof dimension.confidence === "string" && CONFIDENCE_VALUES.has(dimension.confidence as Confidence) ? dimension.confidence as Confidence : undefined;
      if (!key) issues.push("INVALID_DIMENSION_KEY");
      if (key && !eligibility.allowedDimensionKeys.includes(key)) issues.push("DIMENSION_NOT_ELIGIBLE");
      if (!text || text.length === 0 || text.length > 160) issues.push("INVALID_DIMENSION_TEXT");
      if (!claimIds || claimIds.length === 0) issues.push("INVALID_DIMENSION_CLAIMS");
      if (!confidence) issues.push("INVALID_DIMENSION_CONFIDENCE");
      if (text && claimIds) {
        validateClaimRefs(claimIds, context, issues, "DIMENSION");
        validateClaimNumbers(text, claimIds, context, issues, "DIMENSION");
      }
      if (key && text && claimIds && confidence) parsedDimensions.push({ key, text, claimIds, confidence });
    }
  }

  const parsedEvents: RideAnalysisNotableEvent[] = [];
  if (eventsValue) {
    if (eventsValue.length > 3) issues.push("TOO_MANY_NOTABLE_EVENTS");
    for (const item of eventsValue) {
      const event = asRecord(item);
      if (!event || !hasOnlyKeys(event, new Set(["eventId", "text", "claimIds"]))) {
        issues.push("INVALID_EVENT_OBJECT");
        continue;
      }
      const eventId = typeof event.eventId === "string" && event.eventId.length > 0 ? event.eventId : undefined;
      const text = typeof event.text === "string" && event.text.length > 0 && event.text.length <= 120 ? event.text : undefined;
      const claimIds = asStringArray(event.claimIds);
      if (!eventId) issues.push("INVALID_EVENT_ID");
      if (!text) issues.push("INVALID_EVENT_TEXT");
      if (!claimIds || claimIds.length === 0) issues.push("INVALID_EVENT_CLAIMS");
      if (text && claimIds) {
        validateClaimRefs(claimIds, context, issues, "EVENT");
        validateClaimNumbers(text, claimIds, context, issues, "EVENT");
      }
      if (eventId && text && claimIds) parsedEvents.push({ eventId, text, claimIds });
    }
  }

  let parsedNextAction: RideAnalysisNextAction | null = null;
  if (root.nextAction === null) {
    parsedNextAction = null;
  } else if (nextActionValue) {
    if (!hasOnlyKeys(nextActionValue, new Set(["kind", "text", "basisClaimIds"]))) issues.push("NEXT_ACTION_UNKNOWN_FIELD");
    const kind = nextActionValue.kind === "grounded" || nextActionValue.kind === "general" ? nextActionValue.kind : undefined;
    const text = typeof nextActionValue.text === "string" && nextActionValue.text.length > 0 && nextActionValue.text.length <= 120 ? nextActionValue.text : undefined;
    const basisClaimIds = asStringArray(nextActionValue.basisClaimIds);
    if (!kind) issues.push("INVALID_NEXT_ACTION_KIND");
    if (!text) issues.push("INVALID_NEXT_ACTION_TEXT");
    if (!basisClaimIds) issues.push("INVALID_NEXT_ACTION_CLAIMS");
    if (kind === "grounded" && basisClaimIds && basisClaimIds.length === 0) issues.push("GROUNDED_ACTION_WITHOUT_CLAIM");
    if (kind === "general" && basisClaimIds && basisClaimIds.length > 0) issues.push("GENERAL_ACTION_HAS_CLAIM");
    if (text && basisClaimIds) {
      validateClaimRefs(basisClaimIds, context, issues, "ACTION");
      validateClaimNumbers(text, basisClaimIds, context, issues, "ACTION");
    }
    if (kind && text && basisClaimIds) parsedNextAction = { kind, text, basisClaimIds };
  }

  if (limitations && (limitations.length > 5 || limitations.some((item) => item.length === 0 || item.length > 120))) issues.push("INVALID_LIMITATIONS_LENGTH");
  if (shareCopy && (shareCopy.length !== 3 || shareCopy.some((item) => item.length === 0 || item.length > 50))) issues.push("INVALID_SHARE_COPY_LENGTH");
  const strictText = [headline ?? "", overall?.text as string ?? "", ...parsedDimensions.map((item) => item.text), ...parsedEvents.map((item) => item.text), parsedNextAction?.text ?? "", ...(limitations ?? [])];
  const strictNonLimitations = [headline ?? "", overall?.text as string ?? "", ...parsedDimensions.map((item) => item.text), ...parsedEvents.map((item) => item.text), parsedNextAction?.text ?? ""];
  const allText = [...strictText, ...(shareCopy ?? [])];
  for (const text of allText) if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))) issues.push("FORBIDDEN_HIGH_RISK_TOPIC");
  // Automatic ride analysis may disclose the absence of comparable history in limitations,
  // but the model must not turn that absence into visible prose or a history dimension.
  if (hasPattern(strictNonLimitations, VISIBLE_HISTORY_GAP_PATTERNS)) issues.push("VISIBLE_HISTORY_GAP");
  if (hasPattern(strictText, DATA_COMPLETENESS_PATTERNS)) issues.push("DATA_COMPLETENESS_EVALUATION");
  if (hasPattern(strictText, DISTANCE_CLASSIFICATION_PATTERNS)) issues.push("UNSUPPORTED_DISTANCE_CLASSIFICATION");
  if (hasPattern(strictText, ROUTE_CLASSIFICATION_PATTERNS)) issues.push("UNSUPPORTED_ROUTE_CLASSIFICATION");
  if (hasPattern(strictText, EFFORT_CLASSIFICATION_PATTERNS)) issues.push("UNSUPPORTED_EFFORT_CLASSIFICATION");
  if (hasPattern(allText, UNSUPPORTED_CONTEXT_LABEL_PATTERNS)) issues.push("UNSUPPORTED_CONTEXT_LABEL");
  if (hasPattern(allText, UNSUPPORTED_PLAN_PATTERNS)) issues.push("UNSUPPORTED_PLAN_REFERENCE");
  if (hasPattern(strictText, UNSUPPORTED_SUBJECTIVE_EXPERIENCE_PATTERNS)) issues.push("UNSUPPORTED_SUBJECTIVE_EXPERIENCE");
  if (hasPattern(strictNonLimitations, MISSING_INPUT_LISTING_PATTERNS)) issues.push("MISSING_INPUT_LISTING");
  if ((limitations ?? []).some((text) => hasPattern([text], SENSOR_LIMITATION_PATTERNS) && !hasPattern([text], SENSOR_IMPACT_PATTERNS))) issues.push("MISSING_INPUT_IMPACT");
  if (hasPattern(strictText, LOW_VALUE_META_PATTERNS)) issues.push("LOW_VALUE_META_LANGUAGE");
  if (hasPattern(strictText, PHYSIOLOGICAL_CAUSALITY_PATTERNS)) issues.push("UNSUPPORTED_PHYSIOLOGICAL_CAUSALITY");
  if (hasPattern(strictText, HALF_SEGMENT_PATTERNS)) issues.push("UNSUPPORTED_SEGMENT_LABEL");
  if (hasPattern(strictText, OVERBROAD_SERIES_CONCLUSION_PATTERNS)) issues.push("OVERBROAD_SERIES_CONCLUSION");
  if (hasUnscopedConsistencyConclusion(strictText)) issues.push("UNSCOPED_CONSISTENCY_CONCLUSION");
  if (headline && !hasPattern([headline], HEADLINE_EVALUATION_PATTERNS)) issues.push("HEADLINE_NOT_EVALUATIVE");
  const allAllowedNumbers = claimNumbers(context, context.allowedClaims.map((claim) => claim.claimId));
  for (const text of allText) {
    for (const token of numberTokens(text)) if (!allAllowedNumbers.has(Number(token).toString())) issues.push("TEXT_UNSUPPORTED_NUMBER");
  }
  if (context.safetyFlags.some((flag) => flag === "stop_generation" || flag === "critical_safety") && safetyLevel !== "stop") {
    issues.push("SAFETY_LEVEL_MISMATCH");
  }

  if (issues.length > 0 || !headline || !overall || !limitations || !shareCopy || !safetyLevel) return { valid: false, issues: [...new Set(issues)] };
  const overallClaimIds = asStringArray(overall.claimIds);
  if (!overallClaimIds) return { valid: false, issues: [...new Set([...issues, "INVALID_OVERALL_CLAIMS"]) ] };
  return {
    valid: true,
    issues: [],
    output: {
      schemaVersion: RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION,
      headline,
      overallAssessment: { text: overall.text as string, claimIds: overallClaimIds },
      dimensions: parsedDimensions,
      notableEvents: parsedEvents,
      nextAction: parsedNextAction,
      limitations,
      safetyLevel,
      shareCopy: shareCopy as [string, string, string],
    },
  };
}
