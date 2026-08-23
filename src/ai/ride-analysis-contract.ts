import type { MetricKey } from "../domain/ride-schema.ts";
import type {
  AllowedClaim,
  RideAnalysisOutput,
  RideContextSnapshot,
} from "../domain/ride-summary.ts";

export const B2_OUTPUT_SCHEMA_VERSION = "ride-analysis-output-v0.2" as const;

export interface RideAnalysisValidationResult {
  valid: boolean;
  issues: string[];
  output?: RideAnalysisOutput;
}

const ROOT_KEYS = new Set([
  "headline",
  "summary",
  "highlights",
  "nextAction",
  "limitations",
  "safetyLevel",
  "shareCopy",
]);
const HIGHLIGHT_KEYS = new Set(["text", "claimIds", "confidence"]);
const NEXT_ACTION_KEYS = new Set(["text", "basisClaimIds"]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const SAFETY_LEVEL_VALUES = new Set(["normal", "caution", "stop"]);
const HEART_RATE_METRICS = new Set<MetricKey>(["avgHeartRateBpm", "maxHeartRateBpm"]);
const POWER_METRICS = new Set<MetricKey>(["avgPowerW", "normalizedPowerW"]);
const NUMBER_PATTERN = /[-+]?\d+(?:\.\d+)?/g;
const ALWAYS_FORBIDDEN_PATTERNS = [
  /FTP/i,
  /TSS/i,
  /\bIF\b/i,
  /医疗诊断/,
  /保证提升/,
  /恢复时间/,
  /体能(?:提升|进步|退步)/,
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value as string[];
}

function normalizeNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toString() : value;
}

function numberTokens(value: string): string[] {
  return [...value.matchAll(NUMBER_PATTERN)].map((match) => normalizeNumber(match[0]));
}

function allowedNumbersForClaims(claims: AllowedClaim[]): Set<string> {
  return new Set(claims.flatMap((claim) => [
    ...numberTokens(claim.text),
    ...numberTokens(claim.displayValue),
    normalizeNumber(String(claim.value)),
  ]));
}

function outputText(output: RideAnalysisOutput): string[] {
  return [
    output.headline,
    output.summary,
    ...output.highlights.map((item) => item.text),
    output.nextAction.text,
    ...output.limitations,
    ...output.shareCopy,
  ];
}

function validateShape(value: unknown): RideAnalysisValidationResult {
  const issues: string[] = [];
  const root = asRecord(value);
  if (!root) return { valid: false, issues: ["OUTPUT_NOT_OBJECT"] };
  if (!hasOnlyKeys(root, ROOT_KEYS)) issues.push("OUTPUT_UNKNOWN_FIELD");

  const headline = typeof root.headline === "string" ? root.headline : undefined;
  const summary = typeof root.summary === "string" ? root.summary : undefined;
  const limitations = asStringArray(root.limitations);
  const shareCopy = asStringArray(root.shareCopy);
  const safetyLevel = typeof root.safetyLevel === "string" && SAFETY_LEVEL_VALUES.has(root.safetyLevel)
    ? root.safetyLevel as RideAnalysisOutput["safetyLevel"]
    : undefined;
  const highlightsValue = Array.isArray(root.highlights) ? root.highlights : undefined;
  const nextActionValue = asRecord(root.nextAction);

  if (!headline) issues.push("INVALID_HEADLINE_TYPE");
  if (!summary) issues.push("INVALID_SUMMARY_TYPE");
  if (!limitations) issues.push("INVALID_LIMITATIONS_TYPE");
  if (!shareCopy) issues.push("INVALID_SHARE_COPY_TYPE");
  if (!safetyLevel) issues.push("INVALID_SAFETY_LEVEL");
  if (!highlightsValue) issues.push("INVALID_HIGHLIGHTS_TYPE");
  if (!nextActionValue) issues.push("INVALID_NEXT_ACTION_TYPE");

  const highlights: RideAnalysisOutput["highlights"] = [];
  if (highlightsValue) {
    for (const value of highlightsValue) {
      const item = asRecord(value);
      if (!item) {
        issues.push("INVALID_HIGHLIGHT_TYPE");
        continue;
      }
      if (!hasOnlyKeys(item, HIGHLIGHT_KEYS)) issues.push("HIGHLIGHT_UNKNOWN_FIELD");
      const text = typeof item.text === "string" ? item.text : undefined;
      const claimIds = asStringArray(item.claimIds);
      const confidence = typeof item.confidence === "string" && CONFIDENCE_VALUES.has(item.confidence)
        ? item.confidence as RideAnalysisOutput["highlights"][number]["confidence"]
        : undefined;
      if (!text) issues.push("INVALID_HIGHLIGHT_TEXT");
      if (!claimIds) issues.push("INVALID_HIGHLIGHT_CLAIM_IDS");
      if (!confidence) issues.push("INVALID_HIGHLIGHT_CONFIDENCE");
      if (text && claimIds && confidence) highlights.push({ text, claimIds, confidence });
    }
  }

  let nextAction: RideAnalysisOutput["nextAction"] | undefined;
  if (nextActionValue) {
    if (!hasOnlyKeys(nextActionValue, NEXT_ACTION_KEYS)) issues.push("NEXT_ACTION_UNKNOWN_FIELD");
    const text = typeof nextActionValue.text === "string" ? nextActionValue.text : undefined;
    const basisClaimIds = asStringArray(nextActionValue.basisClaimIds);
    if (!text) issues.push("INVALID_NEXT_ACTION_TEXT");
    if (!basisClaimIds) issues.push("INVALID_ACTION_CLAIM_IDS");
    if (text && basisClaimIds) nextAction = { text, basisClaimIds };
  }

  if (issues.length > 0 || !headline || !summary || !limitations || !shareCopy || !safetyLevel || !nextAction) {
    return { valid: false, issues: [...new Set(issues)] };
  }

  return {
    valid: true,
    issues: [],
    output: {
      headline,
      summary,
      highlights,
      nextAction,
      limitations,
      safetyLevel,
      shareCopy: shareCopy as [string, string, string],
    },
  };
}

function validateSemantics(
  output: RideAnalysisOutput,
  snapshot: RideContextSnapshot,
): string[] {
  const issues: string[] = [];
  const claimsById = new Map(snapshot.allowedClaims.map((claim) => [claim.claimId, claim]));
  const allAllowedNumbers = allowedNumbersForClaims(snapshot.allowedClaims);

  if (output.headline.length === 0 || output.headline.length > 20) issues.push("INVALID_HEADLINE_LENGTH");
  if (output.summary.length === 0 || output.summary.length > 120) issues.push("INVALID_SUMMARY_LENGTH");
  if (output.highlights.length > 3) issues.push("TOO_MANY_HIGHLIGHTS");
  if (snapshot.allowedClaims.length > 0 && output.highlights.length === 0) issues.push("MISSING_HIGHLIGHT");
  if (snapshot.allowedClaims.length === 0 && output.highlights.length > 0) issues.push("CLAIMLESS_HIGHLIGHT");
  if (output.shareCopy.length !== 3 || output.shareCopy.some((copy) => copy.length === 0 || copy.length > 50)) {
    issues.push("INVALID_SHARE_COPY_LENGTH");
  }
  if (output.limitations.length === 0) issues.push("MISSING_LIMITATION");

  for (const item of outputText(output)) {
    for (const pattern of ALWAYS_FORBIDDEN_PATTERNS) {
      if (pattern.test(item)) issues.push("FORBIDDEN_HIGH_RISK_TOPIC");
    }
    for (const token of numberTokens(item)) {
      if (!allAllowedNumbers.has(token)) issues.push("UNSUPPORTED_NUMBER");
    }
  }

  for (const highlight of output.highlights) {
    if (highlight.claimIds.length === 0) issues.push("HIGHLIGHT_WITHOUT_CLAIM");
    if (new Set(highlight.claimIds).size !== highlight.claimIds.length) issues.push("DUPLICATE_HIGHLIGHT_CLAIM");
    const claims = highlight.claimIds.flatMap((claimId) => {
      const claim = claimsById.get(claimId);
      if (!claim) {
        issues.push("UNKNOWN_HIGHLIGHT_CLAIM");
        return [];
      }
      return [claim];
    });
    const highlightNumbers = allowedNumbersForClaims(claims);
    for (const token of numberTokens(highlight.text)) {
      if (!highlightNumbers.has(token)) issues.push("HIGHLIGHT_NUMBER_NOT_IN_REFERENCED_CLAIM");
    }
    if (/心率/.test(highlight.text) && !claims.some((claim) => HEART_RATE_METRICS.has(claim.metricKey))) {
      issues.push("HEART_RATE_TOPIC_WITHOUT_CLAIM");
    }
    if (/(功率|标准化功率|\bNP\b)/i.test(highlight.text) && !claims.some((claim) => POWER_METRICS.has(claim.metricKey))) {
      issues.push("POWER_TOPIC_WITHOUT_CLAIM");
    }
  }

  if (new Set(output.nextAction.basisClaimIds).size !== output.nextAction.basisClaimIds.length) {
    issues.push("DUPLICATE_ACTION_CLAIM");
  }
  if (snapshot.allowedClaims.length > 0 && output.nextAction.basisClaimIds.length === 0) {
    issues.push("ACTION_WITHOUT_BASIS");
  }
  for (const claimId of output.nextAction.basisClaimIds) {
    if (!claimsById.has(claimId)) issues.push("UNKNOWN_ACTION_CLAIM");
  }
  const actionClaims = output.nextAction.basisClaimIds.flatMap((claimId) => {
    const claim = claimsById.get(claimId);
    return claim ? [claim] : [];
  });
  const actionNumbers = allowedNumbersForClaims(actionClaims);
  for (const token of numberTokens(output.nextAction.text)) {
    if (!actionNumbers.has(token)) issues.push("ACTION_NUMBER_NOT_IN_BASIS_CLAIM");
  }

  if (snapshot.analysisMode === "rejected" && (
    output.highlights.length > 0 || output.nextAction.basisClaimIds.length > 0
  )) {
    issues.push("REJECTED_RECORD_HAS_GENERATED_CLAIMS");
  }
  if (snapshot.safetyFlags.length > 0 && output.safetyLevel === "normal") {
    issues.push("SAFETY_FLAG_NOT_REFLECTED");
  }

  return [...new Set(issues)];
}

export function parseAndValidateRideAnalysisOutput(
  rawText: string,
  snapshot: RideContextSnapshot,
): RideAnalysisValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return { valid: false, issues: ["INVALID_JSON"] };
  }
  const shape = validateShape(value);
  if (!shape.valid || !shape.output) return shape;
  const semanticIssues = validateSemantics(shape.output, snapshot);
  return semanticIssues.length > 0
    ? { valid: false, issues: semanticIssues }
    : { valid: true, issues: [], output: shape.output };
}
