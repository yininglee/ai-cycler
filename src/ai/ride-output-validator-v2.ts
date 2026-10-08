import type { RideModelInputQuestionV2, RideModelInputV2 } from "../domain/ride-model-input-v2.ts";
import type { V2AnalysisClaim } from "../domain/ride-analysis-evidence-v2.ts";
import {
  RIDE_OUTPUT_SCHEMA_VERSION,
  rideOutputConclusionTypes,
  type RideOutputConclusionType,
} from "./ride-output-schema-v2.ts";
import { RIDE_PMC_RECOVERY_TSB_THRESHOLD } from "../domain/ride-pmc-load-v2.ts";

// S6-01 (V2 business rules 14.5 / PRD FR-10): independent output validator.
// It checks the model output against the input snapshot that was actually
// delivered to the model — never against prompt compliance or provider JSON
// guarantees. The validator is deliberately stricter than keyword matching for
// the gates it can decide reliably (references, numbers, stability, history,
// plan, causality, recovery, suggestion anchors, limitation backfill); anything
// it cannot reliably decide is left to the constrained conclusion types above,
// and a failed output must never be displayed as-is.

export type RideOutputFailureCode =
  | "OUTPUT_NOT_OBJECT"
  | "SCHEMA_VERSION_MISMATCH"
  | "FIELD_MISSING"
  | "FIELD_TYPE_INVALID"
  | "TEXT_EMPTY"
  | "CONCLUSION_TYPE_INVALID"
  | "DIMENSIONS_EMPTY"
  | "DIMENSION_NOT_IN_INPUT"
  | "CLAIM_NOT_IN_INPUT"
  | "CLAIM_NOT_IN_DIMENSION"
  | "KNOWLEDGE_NOT_IN_INPUT"
  | "KNOWLEDGE_NOT_IN_DIMENSION"
  | "FACT_WITHOUT_CLAIM"
  | "INTERPRETATION_WITHOUT_CLAIM"
  | "KNOWLEDGE_REFERENCE_WITHOUT_KNOWLEDGE"
  | "LABEL_CLAIM_REQUIRED"
  | "HIGHLIGHT_CLAIM_REQUIRED"
  | "NUMBER_NOT_IN_CLAIMS"
  | "STABILITY_WITHOUT_VARIANCE"
  | "HISTORY_WITHOUT_BASELINE"
  | "PLAN_COMPLETION_FORBIDDEN"
  | "CAUSALITY_UPGRADED"
  | "RECOVERY_CONCLUSION_FORBIDDEN"
  | "SUGGESTION_ANCHOR_MISSING"
  | "LIMITATION_NOT_FROM_INPUT"
  | "LIMITATION_BACKFILL_MISSING"
  | "SOFT_QUALITY_NOT_DISCLOSED"
  | "DATA_LIMITED_NOT_STATED";

export interface RideOutputIssueV2 {
  code: RideOutputFailureCode;
  path: string;
  message: string;
}

export type RideOutputValidationResultV2 =
  | { status: "pass" }
  | { status: "fail"; issues: RideOutputIssueV2[] };

interface AssertionView {
  text: unknown;
  conclusionType: unknown;
  claimIds: unknown;
  knowledgeIds?: unknown;
}

interface ClaimBinding {
  claim: V2AnalysisClaim;
  // A claim legitimately fans out into several question packets (e.g. timing
  // and cruise-segment claims are delivered to both pacingExecution and
  // powerOutput), so every delivered dimension is tracked here.
  dimensionIds: Set<string>;
}

// "稳定区间" is the official Z2 cadence/power zone name; "稳定踏频"/"稳定区"/
// "平稳" are attested live translations of zone names (cadence.zone.steady) —
// all are zone-share wording, not stability assertions. The negative lookahead
// keeps zone-share wording legal (user decisions 2026-10-06 PD-AI-22; two
// 2026-10-07 revisions extended the exemption after live misfires on
// "稳定踏频占 7%", "稳定区 7%" and "平稳 37%"). A third 2026-10-07 revision
// (STABILITY_WITHOUT_VARIANCE diagnosis on demo-08-20) extended both branches
// to also exempt a bare zone name followed directly by a percentage — the model
// translated cadence.zone.steady as "稳定 7%" with no 踏频/区 suffix. So a real
// stability assertion never carries a percentage immediately after the word:
// the "稳定/平稳 + N%" shape is always zone-share reporting. The 平稳 branch is
// now a NEGATIVE lookahead (平稳 not followed by N%) — the previous positive
// lookahead was inverted: it flagged "平稳 37%" (zone share) as an assertion
// while missing a bare "平稳" (a real assertion).
const stabilityTextPattern = /稳定(?!区间|踏频|区|\s*\d+\s*%)|平稳(?!\s*\d+\s*%)|保持良好/;
const historyTextPattern = /进步|退步|相比之前|相比以往|比之前|长期负荷/;
const causalTextPattern = /导致|造成|引发/;
// Plan wording is only forbidden as an assertion ("completed the plan"); goal-
// oriented suggestions ("add intervals to your next plan") stay legal.
const planAssertionTextPattern = /完成了?(训练)?计划|按计划(完成|执行|达成)|完成(了)?(训练)?目标|符合(训练)?计划|达成(训练)?目标/;
const recoveryTextPattern = /恢复良好|已恢复|恢复完成|完全恢复/;
const dataLimitedDisclosurePattern = /有限|不足/;
const softDisclosurePattern = /部分|缺失|有限/;
// V21-15 P2 (2026-10-08): power.curve.* (max average power per duration —
// 5s/60s/300s/1200s/3600s) is process data by construction: the curve's
// gradient across durations IS the within-ride output structure, so wording
// like "长时耐力输出相对平稳" anchored on curve claims is evidence-backed, not a
// bare mean claim (R02 demo-07-22 #3 misfire). A mean claim (power.mean)
// still never satisfies the stability gate.
const varianceClaimKeyPattern = /coefficientOfVariation|lastMinusFirst|drift|variance|power\.curve/i;
// Zone labels (Z1-Z7), climb grades (1 级/HC), ordinal markers, and
// occurrence/frequency wording ("上1次"、"这2次"、"每15分钟") are structural,
// not data values. The 第N prefix (第 + 数字/汉字) is ALWAYS an ordinal — the
// model keeps inventing shapes ("第1段", then "第 5 段", then "第 5 个巡航段",
// all 2026-10-08 upload-f95e988a), so the branch strips 第N without depending
// on a trailing noun. The 段 char left behind is then re-guarded by the bare-段
// branch below: a real data number after it ("第二段 27.96 km/h" -> "段 27.96")
// survives via the digit/point/unit negative lookahead. Bare ordinals
// ("巡航段1"、"代表性爬坡 1") must not be followed by another digit, a decimal
// point, or a unit — otherwise the number is segment data ("爬坡段 20 公里"、
// "下坡段 18.3 公里"、"首段 31.5W"). The "not a digit/point" guard also stops
// \d+ backtracking: without it "下坡段 18.3" matches "段 1" and leaves "8.3"
// behind as a ghost number.
// Business rules 14.5.1 exempt zone labels and segment ordinals from checking.
const SEGMENT_DATA_UNITS = "公里|千米|km|米|m|分钟|小时|秒|瓦|W|w|rpm|%|km/h|m/s|bpm|千卡|kcal";
// A bare ordinal never carries a unit, so a digit followed by one of the above
// is data, not an ordinal. Keep the unit list generous — adding a unit can only
// remove a false exemption, never create one.
const SEGMENT_ORDINAL_TAIL = "(?![\\d.]|\\s*(?:" + SEGMENT_DATA_UNITS + "))";
const structuralNumberPattern = new RegExp(
  "Z[1-7]|\\d+\\s*级|第\\s*[一二三四五六七八九十\\d]+"
  + "|[^第]段\\s*\\d+" + SEGMENT_ORDINAL_TAIL
  + "|爬坡\\s*\\d+" + SEGMENT_ORDINAL_TAIL
  + "|上\\d+次|这\\d+次|近\\d+次|前\\d+次|每\\d+(分钟|小时|天|次|公里|km)",
  "g",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// V21 knowledge base carries dense sports-science benchmark RANGES ("2–5% 理想
// 负分割", "0.60–0.70 轻松耐力", "800–1200 训练有素"). Two helpers cooperate:
//   - extractNumbers returns only single numbers. It strips the ranges FIRST so
//     a hyphenated range ("0.96-1.05", "85-95") is not misread as a negative
//     number ("-1.05", "-95") — that false negative is what previously tripped
//     NUMBER_NOT_IN_CLAIMS when the model paraphrased an en-dash range with a
//     plain hyphen.
//   - extractNumberRanges recovers the ranges themselves, so a number quoted
//     inside a cited knowledge range ("约 3%", "约 0.8", "约 1000") is accepted
//     as legitimate paraphrase rather than flagged as fabrication.
const numberRangePattern = /(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)/g;

function extractNumbers(text: string): number[] {
  const stripped = text.replace(structuralNumberPattern, " ").replace(numberRangePattern, " ");
  return [...stripped.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function extractNumberRanges(text: string): Array<[number, number]> {
  const stripped = text.replace(structuralNumberPattern, " ");
  return [...stripped.matchAll(numberRangePattern)].map((match) => {
    const lo = Number(match[1]);
    const hi = Number(match[2]);
    return lo <= hi ? [lo, hi] : [hi, lo];
  });
}

// PD-AI-28 (2026-10-07): rounding equivalence, migrated from the V1
// claimNumericVariants parity (addNumericVariants rounded=true). A claim value
// may be faithfully expressed rounded to 0/1/2 decimals — e.g. IF 0.99 written
// as "接近 1.0". Rounding is a deterministic single-value presentation form,
// unlike cross-claim calculations (e.g. "Z5-Z7 合计 24%" = 10+9+5), which stay
// forbidden: no verification is possible over claim combinations, and model
// arithmetic cannot be trusted. Derived aggregates belong in the evidence
// layer as deterministic calculated claims.
function roundedVariants(value: number): number[] {
  if (!Number.isFinite(value)) return [];
  return [0, 1, 2].map((digits) => Number(value.toFixed(digits)));
}

function claimAllowsNumber(claim: V2AnalysisClaim, number: number): boolean {
  // Sign equivalence: a negative claim value (e.g. lastMinusFirst -31.5 W) is
  // faithfully expressed in natural language as "下降 31.5 W", so the absolute
  // value is allowed as well. Rounding equivalence: see roundedVariants above.
  const candidates: number[] = [];
  if (typeof claim.value === "number") {
    candidates.push(claim.value, ...roundedVariants(claim.value));
  }
  for (const source of [claim.displayValue ?? "", claim.text ?? ""]) {
    for (const allowed of extractNumbers(String(source))) {
      candidates.push(allowed, ...roundedVariants(allowed));
    }
  }
  return candidates.some((candidate) => candidate === number || candidate === -number);
}

export function validateRideModelOutputV2(
  input: RideModelInputV2,
  output: unknown,
): RideOutputValidationResultV2 {
  const issues: RideOutputIssueV2[] = [];
  const issue = (code: RideOutputFailureCode, path: string, message: string) => {
    issues.push({ code, path, message });
  };

  if (!isRecord(output)) {
    issue("OUTPUT_NOT_OBJECT", "output", "model output must be a JSON object");
    return { status: "fail", issues };
  }
  if (output.schemaVersion !== RIDE_OUTPUT_SCHEMA_VERSION) {
    issue(
      "SCHEMA_VERSION_MISMATCH",
      "output.schemaVersion",
      `expected "${RIDE_OUTPUT_SCHEMA_VERSION}" but received "${String(output.schemaVersion)}"`,
    );
  }

  for (const field of ["label", "overallAssessment", "dimensions", "limitations"] as const) {
    if (output[field] === undefined) {
      issue("FIELD_MISSING", `output.${field}`, "required field is missing");
    }
  }
  if (issues.some((item) => item.code === "FIELD_MISSING")) {
    return { status: "fail", issues };
  }

  // Input indexes used by every assertion check. S2-06: claims and knowledge
  // live once at the top level of the input; questions reference them by id,
  // so the fan-out into several question packets is recorded per dimension.
  const claimsById = new Map<string, ClaimBinding>();
  for (const claim of input.claims) {
    claimsById.set(claim.claimId, { claim, dimensionIds: new Set() });
  }
  const knowledgeById = new Map(input.knowledge.map((item) => [item.knowledgeId, item]));
  const knowledgeDimensionsById = new Map<string, Set<string>>();
  const questionsByDimension = new Map<string, RideModelInputQuestionV2>();
  for (const question of input.questions) {
    questionsByDimension.set(question.dimensionId, question);
    for (const claimId of question.claimIds) {
      claimsById.get(claimId)?.dimensionIds.add(question.dimensionId);
    }
    for (const knowledgeId of question.knowledgeIds) {
      // Only ids that exist in the delivered top-level list count as input;
      // dangling references simply never register and are rejected on use.
      if (!knowledgeById.has(knowledgeId)) continue;
      const dimensions = knowledgeDimensionsById.get(knowledgeId);
      if (dimensions) dimensions.add(question.dimensionId);
      else knowledgeDimensionsById.set(knowledgeId, new Set([question.dimensionId]));
    }
  }
  const inputHasHistoryClaims = input.claims.some((claim) => claim.kind === "history");

  const resolveClaims = (path: string, claimIds: string[], dimensionId?: string): V2AnalysisClaim[] => {
    const claims: V2AnalysisClaim[] = [];
    for (const claimId of claimIds) {
      const binding = claimsById.get(claimId);
      if (!binding) {
        issue("CLAIM_NOT_IN_INPUT", path, `claimId "${claimId}" does not exist in the delivered input`);
        continue;
      }
      if (dimensionId && !binding.dimensionIds.has(dimensionId)) {
        issue(
          "CLAIM_NOT_IN_DIMENSION",
          path,
          `claimId "${claimId}" belongs to dimension "${[...binding.dimensionIds].join(", ")}", not "${dimensionId}"`,
        );
        continue;
      }
      claims.push(binding.claim);
    }
    return claims;
  };

  const checkKnowledgeIds = (path: string, knowledgeIds: string[], dimensionId?: string) => {
    for (const knowledgeId of knowledgeIds) {
      const boundDimensions = knowledgeDimensionsById.get(knowledgeId);
      if (!boundDimensions) {
        issue("KNOWLEDGE_NOT_IN_INPUT", path, `knowledgeId "${knowledgeId}" does not exist in the delivered input`);
      } else if (dimensionId && !boundDimensions.has(dimensionId)) {
        issue(
          "KNOWLEDGE_NOT_IN_DIMENSION",
          path,
          `knowledgeId "${knowledgeId}" is attached to dimension "${[...boundDimensions].join(", ")}", not "${dimensionId}"`,
        );
      }
    }
  };

  const validateAssertion = (
    path: string,
    view: AssertionView,
    dimensionId?: string,
  ): V2AnalysisClaim[] => {
    if (!isRecord(view)) {
      issue("FIELD_TYPE_INVALID", path, "assertion must be an object");
      return [];
    }
    if (typeof view.text !== "string" || !view.text.trim()) {
      issue("TEXT_EMPTY", `${path}.text`, "assertion text must be a non-empty string");
      return [];
    }
    const text = view.text;
    if (
      typeof view.conclusionType !== "string"
      || !rideOutputConclusionTypes.includes(view.conclusionType as RideOutputConclusionType)
    ) {
      issue("CONCLUSION_TYPE_INVALID", `${path}.conclusionType`, `unsupported conclusion type "${String(view.conclusionType)}"`);
      return [];
    }
    if (!isStringArray(view.claimIds)) {
      issue("FIELD_TYPE_INVALID", `${path}.claimIds`, "claimIds must be an array of strings");
      return [];
    }
    if (view.knowledgeIds !== undefined && !isStringArray(view.knowledgeIds)) {
      issue("FIELD_TYPE_INVALID", `${path}.knowledgeIds`, "knowledgeIds must be an array of strings");
      return [];
    }
    const claimIds = view.claimIds;
    const knowledgeIds = (view.knowledgeIds as string[] | undefined) ?? [];

    checkKnowledgeIds(`${path}.knowledgeIds`, knowledgeIds, dimensionId);
    const claims = resolveClaims(`${path}.claimIds`, claimIds, dimensionId);

    // Binding rules: facts need ride/history claims; knowledge references need
    // knowledge IDs and can never act as personal ride facts.
    if (view.conclusionType === "fact" && claimIds.length === 0) {
      issue("FACT_WITHOUT_CLAIM", path, "a fact conclusion must cite at least one claim; knowledge cannot act as a personal ride fact");
    }
    // PD-AI-27: interpretation carries the "how was the ride / what it means"
    // qualitative reading. It must stay grounded in facts (arm A), so it cites
    // at least one claim of its dimension. Number and causality gates still
    // apply; stability/history/recovery/plan expression gates are relaxed for
    // now (isAssertiveConclusion below excludes interpretation).
    if (view.conclusionType === "interpretation" && claimIds.length === 0) {
      issue("INTERPRETATION_WITHOUT_CLAIM", path, "an interpretation conclusion must cite at least one claim of its dimension");
    }
    if (view.conclusionType === "knowledgeReference" && knowledgeIds.length === 0) {
      issue("KNOWLEDGE_REFERENCE_WITHOUT_KNOWLEDGE", path, "a knowledgeReference conclusion must cite at least one knowledgeId");
    }
    if (view.conclusionType === "historyComparison") {
      const historyClaims = claims.filter((claim) => claim.kind === "history");
      if (!historyClaims.length) {
        issue("HISTORY_WITHOUT_BASELINE", path, "a historyComparison conclusion must cite comparable-history claims");
      }
    }

    // Every number in an assertion must hit a value of a referenced claim (or a
    // number inside the referenced knowledge citation/conditions/explanation).
    // Suggestions are exempt: operational numbers there (补水量、时长安排) are
    // legitimate and their factual basis is already guaranteed by the anchor
    // gate. Knowledge references may quote numbers from the cited knowledge's
    // self-written explanation — that text is the only legitimate source of
    // knowledge content, so numbers outside it are still fabrication.
    if (view.conclusionType !== "suggestion") {
      for (const number of extractNumbers(text)) {
        const claimHit = claims.some((claim) => claimAllowsNumber(claim, number));
        if (claimHit) continue;
        const knowledgeHit = knowledgeIds.some((knowledgeId) => {
          const knowledge = knowledgeById.get(knowledgeId);
          if (!knowledge) return false;
          const sources = [knowledge.citation, knowledge.explanation ?? "", ...knowledge.conditions];
          return sources.some((source) => {
            const text = source ?? "";
            if (extractNumbers(text).includes(number)) return true;
            return extractNumberRanges(text).some(([lo, hi]) => number >= lo && number <= hi);
          });
        });
        if (!knowledgeHit) {
          issue(
            "NUMBER_NOT_IN_CLAIMS",
            `${path}.text`,
            `number ${number} in the text does not match any referenced claim value/displayValue`,
          );
        }
      }
    }

    // Expression gates (business rules 14.5 / 15). Stability, history, plan,
    // and recovery gates only apply to assertions (fact / historyComparison):
    // operational wording inside suggestions ("保持稳定输出"、"想要进步"、
    // "注意恢复、适当降低负荷") and methodology wording in knowledge references
    // are not claims about the ride itself. Causality stays global: it is a
    // red line in every position.
    const isAssertiveConclusion =
      view.conclusionType === "fact" || view.conclusionType === "historyComparison";
    if (isAssertiveConclusion && stabilityTextPattern.test(text)) {
      const varianceSupported = claims.some(
        (claim) =>
          varianceClaimKeyPattern.test(claim.key)
          || claim.supports.some((support) => support.endsWith("_stability")),
      );
      if (!varianceSupported) {
        issue(
          "STABILITY_WITHOUT_VARIANCE",
          path,
          "stability wording requires a referenced variance/process claim; a mean or generic performance claim is not enough",
        );
      }
    }
    if (isAssertiveConclusion && historyTextPattern.test(text)) {
      const hasHistory = claims.some((claim) => claim.kind === "history");
      if (!hasHistory) {
        issue(
          "HISTORY_WITHOUT_BASELINE",
          path,
          "history wording requires a referenced comparable-history claim",
        );
      }
    }
    if (causalTextPattern.test(text)) {
      issue(
        "CAUSALITY_UPGRADED",
        path,
        "causal wording is forbidden; only relation or co-occurrence wording is allowed",
      );
    }
    if (isAssertiveConclusion && planAssertionTextPattern.test(text)) {
      issue(
        "PLAN_COMPLETION_FORBIDDEN",
        path,
        "plan or goal-completion assertions are forbidden because no plan claim exists in the input",
      );
    }
    // PMC-01 (PRD FR-08, user decision 2026-10-06): recovery-completion
    // wording in assertions is no longer an unconditional red line. It passes
    // only when the assertion cites a PMC TSB history claim whose value reached
    // the recovery threshold (+5). Inside suggestions and knowledge references
    // recovery/load wording is operational advice or methodology, not a claim
    // about recovery state, so the gate is scoped to assertive conclusions.
    if (isAssertiveConclusion && recoveryTextPattern.test(text)) {
      const tsbSupported = claims.some(
        (claim) =>
          claim.key === "history.pmc.tsb"
          && typeof claim.value === "number"
          && claim.value >= RIDE_PMC_RECOVERY_TSB_THRESHOLD,
      );
      if (!tsbSupported) {
        issue(
          "RECOVERY_CONCLUSION_FORBIDDEN",
          path,
          `recovery-completion wording requires a referenced PMC TSB claim with TSB >= ${RIDE_PMC_RECOVERY_TSB_THRESHOLD}; otherwise recovery may only appear as a watch-out suggestion`,
        );
      }
    }
    return claims;
  };

  const asAssertionView = (value: unknown): AssertionView => {
    if (!isRecord(value)) return { text: undefined, conclusionType: undefined, claimIds: undefined };
    return {
      text: value.text,
      conclusionType: value.conclusionType,
      claimIds: value.claimIds,
      ...(value.knowledgeIds === undefined ? {} : { knowledgeIds: value.knowledgeIds }),
    };
  };

  // label & overallAssessment must be fact conclusions anchored in claims.
  const labelClaims = validateAssertion("label", asAssertionView(output.label));
  if (isRecord(output.label) && output.label.conclusionType !== "fact") {
    issue("CONCLUSION_TYPE_INVALID", "label.conclusionType", "label must be a fact conclusion");
  }
  if (!labelClaims.some((claim) => claim.confidence === "high" && claim.kind !== "limitation")) {
    issue(
      "LABEL_CLAIM_REQUIRED",
      "label.claimIds",
      "label must cite at least one high-confidence, non-limitation claim",
    );
  }

  const overallClaims = validateAssertion("overallAssessment", asAssertionView(output.overallAssessment));
  if (isRecord(output.overallAssessment) && output.overallAssessment.conclusionType !== "fact") {
    issue("CONCLUSION_TYPE_INVALID", "overallAssessment.conclusionType", "overallAssessment must be a fact conclusion");
  }
  const availableQuestionCount = input.questions.filter(
    (question) => question.eligibility === "available",
  ).length;
  if (
    availableQuestionCount < 2
    && isRecord(output.overallAssessment)
    && typeof output.overallAssessment.text === "string"
    && !dataLimitedDisclosurePattern.test(output.overallAssessment.text)
  ) {
    issue(
      "DATA_LIMITED_NOT_STATED",
      "overallAssessment.text",
      "with fewer than two available analysis questions the overall assessment must state that the available data is limited",
    );
  }

  // highlights: optional; each must cite a high-confidence current-ride claim.
  if (output.highlights !== undefined) {
    if (!Array.isArray(output.highlights)) {
      issue("FIELD_TYPE_INVALID", "highlights", "highlights must be an array");
    } else {
      output.highlights.forEach((highlight, index) => {
        const claims = validateAssertion(`highlights[${index}]`, asAssertionView(highlight));
        if (
          !claims.some(
            (claim) =>
              claim.confidence === "high"
              && (claim.kind === "metric" || claim.kind === "feature" || claim.kind === "advanced"),
          )
        ) {
          issue(
            "HIGHLIGHT_CLAIM_REQUIRED",
            `highlights[${index}].claimIds`,
            "each highlight must cite at least one high-confidence current-ride claim (metric/feature/advanced)",
          );
        }
      });
    }
  }

  // dimensions: dimensionId must exist; claims/knowledge must belong to it;
  // soft-quality disclosure and limitation backfill are enforced per dimension.
  if (!Array.isArray(output.dimensions)) {
    issue("FIELD_TYPE_INVALID", "dimensions", "dimensions must be an array");
  } else {
    if (!output.dimensions.length) {
      issue("DIMENSIONS_EMPTY", "dimensions", "at least one dimension interpretation is required");
    }
    output.dimensions.forEach((dimension, index) => {
      const path = `dimensions[${index}]`;
      if (!isRecord(dimension)) {
        issue("FIELD_TYPE_INVALID", path, "dimension must be an object");
        return;
      }
      if (!Array.isArray(dimension.assertions) || !dimension.assertions.length) {
        issue("FIELD_TYPE_INVALID", `${path}.assertions`, "dimension assertions must be a non-empty array");
        return;
      }
      const question = questionsByDimension.get(String(dimension.dimensionId));
      if (!question) {
        issue(
          "DIMENSION_NOT_IN_INPUT",
          `${path}.dimensionId`,
          `dimensionId "${String(dimension.dimensionId)}" does not exist in the delivered input`,
        );
        return;
      }
      const joinedText: string[] = [];
      dimension.assertions.forEach((assertion, assertionIndex) => {
        const view = asAssertionView(assertion);
        validateAssertion(`${path}.assertions[${assertionIndex}]`, view, question.dimensionId);
        if (isRecord(view) && typeof view.text === "string") joinedText.push(view.text);
      });
      if (question.qualityStatus === "soft" && !softDisclosurePattern.test(joinedText.join(" "))) {
        issue(
          "SOFT_QUALITY_NOT_DISCLOSED",
          `${path}.assertions`,
          "a soft-quality dimension must disclose partial data limitations in its text",
        );
      }
    });
  }

  // historyComparison: only with comparable-history claims in the input.
  if (output.historyComparison !== undefined) {
    validateAssertion("historyComparison", asAssertionView(output.historyComparison));
    if (!inputHasHistoryClaims) {
      issue(
        "HISTORY_WITHOUT_BASELINE",
        "historyComparison",
        "historyComparison must be omitted when the delivered input contains no comparable-history claims",
      );
    }
  }

  // suggestions: each needs a factual anchor claim (ride or history, not a
  // limitation); limitations alone can never support a suggestion.
  if (output.suggestions !== undefined) {
    if (!Array.isArray(output.suggestions)) {
      issue("FIELD_TYPE_INVALID", "suggestions", "suggestions must be an array");
    } else {
      output.suggestions.forEach((suggestion: unknown, index) => {
        const claims = validateAssertion(`suggestions[${index}]`, asAssertionView(suggestion));
        if (
          !claims.some(
            (claim) =>
              claim.kind === "metric" || claim.kind === "feature" || claim.kind === "advanced" || claim.kind === "history",
          )
        ) {
          issue(
            "SUGGESTION_ANCHOR_MISSING",
            `suggestions[${index}].claimIds`,
            "each suggestion must be anchored in at least one ride or history claim; limitations alone cannot support a suggestion",
          );
        }
      });
    }
  }

  // limitations: verbatim backfill only.
  if (!isStringArray(output.limitations)) {
    issue("FIELD_TYPE_INVALID", "limitations", "limitations must be an array of strings");
  } else {
    const outputLimitations = output.limitations;
    const inputLimitations = new Set(input.questions.flatMap((question) => question.limitations));
    for (const limitation of outputLimitations) {
      if (!inputLimitations.has(limitation)) {
        issue(
          "LIMITATION_NOT_FROM_INPUT",
          "limitations",
          `limitation "${limitation}" does not exist verbatim in the delivered input`,
        );
      }
    }
    if (Array.isArray(output.dimensions)) {
      output.dimensions.forEach((dimension, index) => {
        if (!isRecord(dimension)) return;
        const question = questionsByDimension.get(String(dimension.dimensionId));
        if (!question) return;
        for (const limitation of question.limitations) {
          if (!outputLimitations.includes(limitation)) {
            issue(
              "LIMITATION_BACKFILL_MISSING",
              `dimensions[${index}]`,
              `limitation "${limitation}" of dimension "${question.dimensionId}" must be backfilled verbatim`,
            );
          }
        }
      });
    }
  }

  return issues.length ? { status: "fail", issues } : { status: "pass" };
}
