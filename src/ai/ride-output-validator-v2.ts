import type { RideModelInputQuestionV2, RideModelInputV2 } from "../domain/ride-model-input-v2.ts";
import type { V2AnalysisClaim } from "../domain/ride-analysis-evidence-v2.ts";
import {
  RIDE_OUTPUT_SCHEMA_VERSION,
  rideOutputConclusionTypes,
  type RideOutputConclusionType,
} from "./ride-output-schema-v2.ts";

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
  dimensionId: string;
}

const stabilityTextPattern = /稳定|平稳|保持良好/;
const historyTextPattern = /进步|退步|相比之前|相比以往|比之前|长期负荷/;
const causalTextPattern = /导致|造成|引发/;
// Plan wording is only forbidden as an assertion ("completed the plan"); goal-
// oriented suggestions ("add intervals to your next plan") stay legal.
const planAssertionTextPattern = /完成了?(训练)?计划|按计划(完成|执行|达成)|完成(了)?(训练)?目标|符合(训练)?计划|达成(训练)?目标/;
const recoveryTextPattern = /恢复良好|已恢复|恢复完成|完全恢复/;
const dataLimitedDisclosurePattern = /有限|不足/;
const softDisclosurePattern = /部分|缺失|有限/;
const varianceClaimKeyPattern = /coefficientOfVariation|lastMinusFirst|drift|variance/i;
// Zone labels (Z1-Z7), ordinal segment markers, and occurrence/frequency
// wording ("上1次"、"这2次"、"每15分钟") are structural, not data values.
const structuralNumberPattern = /Z[1-7]|第[一二三四五六七八九十\d]+|上\d+次|这\d+次|近\d+次|前\d+次|每\d+(分钟|小时|天|次|公里|km)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function extractNumbers(text: string): number[] {
  const stripped = text.replace(structuralNumberPattern, " ");
  return [...stripped.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function claimAllowsNumber(claim: V2AnalysisClaim, number: number): boolean {
  if (typeof claim.value === "number" && claim.value === number) return true;
  const sources = [claim.displayValue ?? "", claim.text ?? ""];
  return sources.some((source) =>
    extractNumbers(String(source)).some((allowed) => allowed === number),
  );
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

  // Input indexes used by every assertion check.
  const claimsById = new Map<string, ClaimBinding>();
  const knowledgeDimensionsById = new Map<string, string>();
  const questionsByDimension = new Map<string, RideModelInputQuestionV2>();
  for (const question of input.questions) {
    questionsByDimension.set(question.dimensionId, question);
    for (const claim of question.claims) {
      claimsById.set(claim.claimId, { claim, dimensionId: question.dimensionId });
    }
    for (const knowledge of question.knowledge) {
      knowledgeDimensionsById.set(knowledge.knowledgeId, question.dimensionId);
    }
  }
  const inputHasHistoryClaims = [...claimsById.values()].some(
    (binding) => binding.claim.kind === "history",
  );

  const resolveClaims = (path: string, claimIds: string[], dimensionId?: string): V2AnalysisClaim[] => {
    const claims: V2AnalysisClaim[] = [];
    for (const claimId of claimIds) {
      const binding = claimsById.get(claimId);
      if (!binding) {
        issue("CLAIM_NOT_IN_INPUT", path, `claimId "${claimId}" does not exist in the delivered input`);
        continue;
      }
      if (dimensionId && binding.dimensionId !== dimensionId) {
        issue(
          "CLAIM_NOT_IN_DIMENSION",
          path,
          `claimId "${claimId}" belongs to dimension "${binding.dimensionId}", not "${dimensionId}"`,
        );
        continue;
      }
      claims.push(binding.claim);
    }
    return claims;
  };

  const checkKnowledgeIds = (path: string, knowledgeIds: string[], dimensionId?: string) => {
    for (const knowledgeId of knowledgeIds) {
      const boundDimension = knowledgeDimensionsById.get(knowledgeId);
      if (!boundDimension) {
        issue("KNOWLEDGE_NOT_IN_INPUT", path, `knowledgeId "${knowledgeId}" does not exist in the delivered input`);
      } else if (dimensionId && boundDimension !== dimensionId) {
        issue(
          "KNOWLEDGE_NOT_IN_DIMENSION",
          path,
          `knowledgeId "${knowledgeId}" is attached to dimension "${boundDimension}", not "${dimensionId}"`,
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
    // number inside the referenced knowledge citation/conditions). Suggestions
    // are exempt: operational numbers there (补水量、时长安排) are legitimate
    // and their factual basis is already guaranteed by the anchor gate.
    if (view.conclusionType !== "suggestion") {
      for (const number of extractNumbers(text)) {
        const claimHit = claims.some((claim) => claimAllowsNumber(claim, number));
        if (claimHit) continue;
        const knowledgeHit = knowledgeIds.some((knowledgeId) => {
          const knowledge = input.questions
            .flatMap((question) => question.knowledge)
            .find((item) => item.knowledgeId === knowledgeId);
          if (!knowledge) return false;
          return [...extractNumbers(knowledge.citation), ...knowledge.conditions.flatMap(extractNumbers)]
            .some((allowed) => allowed === number);
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

    // Expression gates (business rules 14.5 / 15). Stability, history, and plan
    // gates only apply to assertions (fact / historyComparison): operational
    // wording inside suggestions ("保持稳定输出"、"想要进步"、"下次计划加入")
    // and methodology wording in knowledge references are not claims about the
    // ride itself. Causality and recovery stay global: they are red lines.
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
    if (recoveryTextPattern.test(text)) {
      issue(
        "RECOVERY_CONCLUSION_FORBIDDEN",
        path,
        "recovery-completion conclusions are forbidden; recovery may only appear as a watch-out suggestion",
      );
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
