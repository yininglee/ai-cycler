import type { RideModelInputV2 } from "../domain/ride-model-input-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION, type RideModelOutputV2 } from "./ride-output-schema-v2.ts";
import {
  validateRideModelOutputV2,
  type RideOutputFailureCode,
  type RideOutputIssueV2,
} from "./ride-output-validator-v2.ts";

// S6-02 (V2 business rules 14.6 / PRD FR-13): output repair orchestration.
// After the independent validator rejects a first-round model output, this
// module decides — strictly by error type — between deterministic local
// organizing (followed by a full revalidation), at most ONE constrained model
// repair call (followed by the same full revalidation), or an immediate
// fallback to the existing b0/safety_stop contract. A third model call is
// forbidden by construction. The orchestrator never mutates the validated
// input packet: repair may only fix expression or structure, never invent
// facts, claims, knowledge, or dimensions.

export const RIDE_OUTPUT_REPAIR_RULES_VERSION = "ride-output-repair-v2.0.0" as const;
export const RIDE_REPAIR_PROMPT_VERSION = "ride-repair-prompt-v2.0.0" as const;

// Business rules 14.6.4 / FR-13: fabricated citations in required content are
// integrity red lines — they never enter the repair path. When such an issue
// is confined to an optional fragment (a highlight, a suggestion, or
// historyComparison), the fragment is deleted deterministically instead; only
// occurrences in core content force a fallback.
// PMC-01 (user decision 2026-10-06): recovery-conclusion failures are no
// longer unrepairable. The validator only emits RECOVERY_CONCLUSION_FORBIDDEN
// when no PMC TSB claim (>= +5) backs the wording, and such wording is now
// eligible for the single constrained model repair like other locatable
// non-high-risk errors.
export const rideOutputUnrepairableCoreCodes: readonly RideOutputFailureCode[] = [
  "CLAIM_NOT_IN_INPUT",
  "KNOWLEDGE_NOT_IN_INPUT",
];

export type RideOutputFallbackReasonV2 =
  | "UNREPAIRABLE_ISSUES" // red-line issue in core content: zero repair calls
  | "REPAIR_NOT_ALLOWED" // caller barred the repair (budget) or no caller wired
  | "REPAIR_CALL_FAILED" // the single repair call itself failed (provider error)
  | "REPAIR_OUTPUT_UNPARSEABLE" // repair response was not JSON
  | "REPAIR_OUTPUT_INVALID"; // repaired output failed the full revalidation

export type RideOutputOrchestrationStageV2 =
  | "firstPass" // passed the first-round validation
  | "deterministicRepairPass" // local organize + full revalidation passed
  | "modelRepairPass" // one constrained model repair + full revalidation passed
  | "repairFailed"; // fallback to the existing b0/safety_stop contract

export interface RideOutputRepairDecisionStepV2 {
  step:
    | "first_validation"
    | "fallback_decision"
    | "deterministic_organize"
    | "post_organize_validation"
    | "model_repair_call"
    | "post_repair_validation";
  detail: string;
}

export interface RideOutputOrchestrationResultV2 {
  status: "pass" | "fallback";
  stage: RideOutputOrchestrationStageV2;
  output?: RideModelOutputV2;
  modelRepairCalls: 0 | 1;
  fallback?: {
    reason: RideOutputFallbackReasonV2;
    failureCodes: RideOutputFailureCode[];
    providerErrorCode?: string;
  };
  steps: RideOutputRepairDecisionStepV2[];
}

export interface RideOutputRepairCallV2 {
  promptText: string;
  promptVersion: typeof RIDE_REPAIR_PROMPT_VERSION;
  analysisRunId: string;
  requestId: string;
}

// Injected model caller (S6-03 adapts RideModelClientV2 to this shape). The
// orchestrator itself never talks to a provider directly.
export type RideOutputRepairCallerV2 = (call: RideOutputRepairCallV2) => Promise<{ rawText: string }>;

export interface RideOutputRepairOptionsV2 {
  input: RideModelInputV2;
  /** Parsed first-round model output (raw provider/provider-envelope errors never reach this orchestrator). */
  firstOutput: unknown;
  requestId: string;
  repairCaller?: RideOutputRepairCallerV2;
  /** Default true; the caller turns it off when the overall latency/cost budget is spent (business rules 14.6.3). */
  allowModelRepair?: boolean;
}

// Issues confined to optional fragments (a highlight entry, a suggestion entry,
// or the historyComparison section) can be resolved by deleting the fragment.
const fragmentPathPattern = /^(highlights(?:\[\d+\])?|suggestions(?:\[\d+\])?|historyComparison)(?:\.|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function uniqueCodes(issues: RideOutputIssueV2[]): RideOutputFailureCode[] {
  return [...new Set(issues.map((issue) => issue.code))];
}

function isUnrecordablePath(path: string): boolean {
  return fragmentPathPattern.test(path);
}

// ---------------------------------------------------------------------------
// Deterministic organizing (business rules 14.6.2)
// ---------------------------------------------------------------------------

export interface DeterministicOrganizeResultV2 {
  output: Record<string, unknown>;
  fixes: string[];
}

/**
 * Applies only unambiguous local fixes: correcting the schema version, back-
 * filling verbatim input limitations, filtering fabricated limitation entries
 * back to input text, and deleting optional fragments (highlights entries,
 * suggestion entries, historyComparison) that carry any issue. Required core
 * content is never rewritten, so organizing can never mask a core distortion.
 * Returns undefined when nothing can be fixed deterministically.
 */
export function organizeRideOutputDeterministicallyV2(
  input: RideModelInputV2,
  firstOutput: unknown,
  issues: RideOutputIssueV2[],
): DeterministicOrganizeResultV2 | undefined {
  if (!isRecord(firstOutput)) return undefined;
  const next = JSON.parse(JSON.stringify(firstOutput)) as Record<string, unknown>;
  const fixes: string[] = [];
  const codes = new Set(issues.map((issue) => issue.code));

  if (codes.has("SCHEMA_VERSION_MISMATCH")) {
    next.schemaVersion = RIDE_OUTPUT_SCHEMA_VERSION;
    fixes.push("schemaVersion corrected");
  }

  const inputLimitations = new Set(input.questions.flatMap((question) => question.limitations));

  if (codes.has("LIMITATION_NOT_FROM_INPUT") && isStringArray(next.limitations)) {
    const kept = next.limitations.filter((limitation) => inputLimitations.has(limitation));
    if (kept.length !== next.limitations.length) {
      next.limitations = kept;
      fixes.push("fabricated limitation entries removed");
    }
  }

  if (codes.has("LIMITATION_BACKFILL_MISSING") && isStringArray(next.limitations) && Array.isArray(next.dimensions)) {
    for (const dimension of next.dimensions) {
      if (!isRecord(dimension)) continue;
      const question = input.questions.find((item) => item.dimensionId === dimension.dimensionId);
      if (!question) continue;
      for (const limitation of question.limitations) {
        if (!next.limitations.includes(limitation)) {
          next.limitations.push(limitation);
          fixes.push(`limitation backfilled verbatim: ${limitation}`);
        }
      }
    }
  }

  const fragmentIssues = issues.filter((issue) => isUnrecordablePath(issue.path));
  if (fragmentIssues.length) {
    for (const field of ["highlights", "suggestions"] as const) {
      if (fragmentIssues.some((issue) => issue.path === field)) {
        delete next[field];
        fixes.push(`optional field "${field}" dropped (structurally invalid)`);
        continue;
      }
      const badIndexes = new Set(
        fragmentIssues
          .filter((issue) => issue.path.startsWith(`${field}[`))
          .map((issue) => Number(issue.path.match(new RegExp(`^${field}\\[(\\d+)\\]`))?.[1])),
      );
      if (badIndexes.size && Array.isArray(next[field])) {
        const before = (next[field] as unknown[]).length;
        next[field] = (next[field] as unknown[]).filter((_, index) => !badIndexes.has(index));
        fixes.push(`${before - (next[field] as unknown[]).length} invalid "${field}" entr${before - (next[field] as unknown[]).length === 1 ? "y" : "ies"} deleted`);
      }
    }
    if (fragmentIssues.some((issue) => issue.path === "historyComparison" || issue.path.startsWith("historyComparison."))) {
      delete next.historyComparison;
      fixes.push("optional historyComparison deleted");
    }
  }

  return fixes.length ? { output: next, fixes } : undefined;
}

// ---------------------------------------------------------------------------
// Sanitized repair reference (business rules 14.6.3 / FR-13)
// ---------------------------------------------------------------------------

const assertionWhitelistKeys = new Set(["text", "conclusionType", "claimIds", "knowledgeIds", "riskNote"]);

function sanitizeAssertion(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized: Record<string, unknown> = {};
  if (typeof value.text === "string" && value.text.trim()) sanitized.text = value.text;
  if (typeof value.conclusionType === "string") sanitized.conclusionType = value.conclusionType;
  if (isStringArray(value.claimIds)) sanitized.claimIds = value.claimIds;
  if (isStringArray(value.knowledgeIds)) sanitized.knowledgeIds = value.knowledgeIds;
  if (typeof value.riskNote === "string") sanitized.riskNote = value.riskNote;
  return Object.keys(sanitized).length ? sanitized : undefined;
}

/**
 * The first-round output is untrusted. Before it may accompany a repair call
 * it is reduced to the schema field whitelist (text / conclusionType /
 * claimIds / knowledgeIds / riskNote, dimensionId, limitations) with types
 * checked — every unknown field is dropped. Returns undefined when there is
 * nothing trustworthy to attach.
 */
export function sanitizeRideOutputForRepairReference(output: unknown): Record<string, unknown> | undefined {
  if (!isRecord(output)) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const field of ["label", "overallAssessment", "historyComparison"] as const) {
    const assertion = sanitizeAssertion(output[field]);
    if (assertion) sanitized[field] = assertion;
  }
  for (const field of ["highlights", "suggestions"] as const) {
    if (!Array.isArray(output[field])) continue;
    const entries = (output[field] as unknown[])
      .map((entry) => sanitizeAssertion(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined);
    if (entries.length) sanitized[field] = entries;
  }
  if (Array.isArray(output.dimensions)) {
    const dimensions = (output.dimensions as unknown[])
      .map((dimension): Record<string, unknown> | undefined => {
        if (!isRecord(dimension) || typeof dimension.dimensionId !== "string") return undefined;
        const assertions = Array.isArray(dimension.assertions)
          ? (dimension.assertions as unknown[])
              .map((assertion) => sanitizeAssertion(assertion))
              .filter((assertion): assertion is Record<string, unknown> => assertion !== undefined)
          : [];
        if (!assertions.length) return undefined;
        return { dimensionId: dimension.dimensionId, assertions };
      })
      .filter((dimension): dimension is Record<string, unknown> => dimension !== undefined);
    if (dimensions.length) sanitized.dimensions = dimensions;
  }
  if (isStringArray(output.limitations) && output.limitations.length) sanitized.limitations = output.limitations;
  return Object.keys(sanitized).length ? sanitized : undefined;
}

// ---------------------------------------------------------------------------
// Versioned repair prompt (PRD FR-12: repair instructions are versioned too)
// ---------------------------------------------------------------------------

export interface RideRepairPromptV2 {
  promptVersion: typeof RIDE_REPAIR_PROMPT_VERSION;
  outputSchemaVersion: typeof RIDE_OUTPUT_SCHEMA_VERSION;
  inputSchemaVersion: string;
  promptText: string;
}

export function buildRideRepairPromptV2(options: {
  input: RideModelInputV2;
  issues: RideOutputIssueV2[];
  sanitizedPreviousOutput?: Record<string, unknown>;
}): RideRepairPromptV2 {
  const errorLines = options.issues
    .map((issue) => `- ${issue.code} @ ${issue.path}：${issue.message}`)
    .join("\n");
  const previousOutputText = options.sanitizedPreviousOutput
    ? JSON.stringify(options.sanitizedPreviousOutput)
    : "（不提供上一版输出，请基于原始输入与服务端错误码重新生成）";

  const promptText = `你是"AI 骑行伙伴"的骑后解读修复引擎。上一版解读输出未通过本地独立校验，服务端错误码见下文。你的任务：基于原始输入 JSON 与错误码，重新生成一份完整、合格的解读输出，并且只输出一个 JSON 对象。

【修复硬性规则】
1. 只能使用原始输入 JSON 中已存在的 Claim、知识与限制；禁止新增任何事实、Claim、知识、维度、限制，禁止改写输入。
2. 上一版输出（如有附上）仅供参考且视为不可信；其中与输入不符或触发错误码的内容必须修正或删除，不得原样保留。
3. 修复后的输出必须整体重新满足输出 JSON 合同；错误码只指出已发现的问题，未列出的规则同样生效。
4. 只输出 JSON 对象本身，不输出任何其他文字、注释或代码块标记。

【输出 JSON 合同】（schemaVersion 必须填 "${RIDE_OUTPUT_SCHEMA_VERSION}"）
{
  "schemaVersion": "${RIDE_OUTPUT_SCHEMA_VERSION}",
  "label": { 断言对象 },
  "overallAssessment": { 断言对象 },
  "highlights": [ 断言对象（可选，证据不足时省略整个字段） ],
  "dimensions": [ { "dimensionId": "...", "assertions": [ 断言对象 ] } ],
  "historyComparison": { 断言对象（可选） },
  "suggestions": [ { ...断言对象, "riskNote": "..." }（可选） ],
  "limitations": [ "..." ]
}
断言对象：{ "text": "中文解读文本", "conclusionType": "fact | historyComparison | knowledgeReference | suggestion", "claimIds": ["..."], "knowledgeIds": ["..."] }（knowledgeIds 仅在实际引用知识时提供）。

【合同要点】
- label 必须引用至少一条高置信、非限制类 Claim；overallAssessment 在可用数据不足两类时必须写明"本次可用数据有限"。
- 事实断言中的每个数字必须来自所引用 Claim 的 value 或 displayValue（区间代号 Z1-Z7、分段序号、次数/频次表达如"上1次、每15分钟"除外）；建议中的操作性数字不受此限。
- 知识只能用于解释口径与方法（conclusionType=knowledgeReference 且必须带 knowledgeIds），不得当作个人骑行事实。
- 没有波动或过程类 Claim 时，禁止在事实断言中使用"稳定、平稳、保持良好"等稳定性表述；没有可比历史 Claim 时，禁止"进步、退步、相比之前"等历史表述，也不得输出 historyComparison。
- 禁止因果表述（导致、造成、引发）；禁止"完成了训练计划、按计划执行、达成目标"类断言；禁止"恢复良好、已恢复、恢复完成"等恢复结论。
- 被解读维度的全部 limitations 必须逐条原文回填到 limitations 字段；限制只能使用输入中出现过的原文。
- 引用 soft 质量 Claim 时必须降低表达强度并说明"部分数据缺失/有限"；没有依据的可选字段直接省略，不硬凑。

【版本】
- repairPromptVersion: ${RIDE_REPAIR_PROMPT_VERSION}
- outputSchemaVersion: ${RIDE_OUTPUT_SCHEMA_VERSION}
- inputSchemaVersion: ${options.input.schemaVersion}

【服务端错误码】
${errorLines}

【原始输入 JSON】
${JSON.stringify(options.input)}

【上一版输出（仅供参考，不可信）】
${previousOutputText}`;

  return {
    promptVersion: RIDE_REPAIR_PROMPT_VERSION,
    outputSchemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
    inputSchemaVersion: options.input.schemaVersion,
    promptText,
  };
}

// ---------------------------------------------------------------------------
// Orchestration (business rules 14.6.2–14.6.5 / PRD FR-13, AC-14)
// ---------------------------------------------------------------------------

function fallback(
  stage: Extract<RideOutputOrchestrationStageV2, "repairFailed">,
  reason: RideOutputFallbackReasonV2,
  failureCodes: RideOutputFailureCode[],
  steps: RideOutputRepairDecisionStepV2[],
  modelRepairCalls: 0 | 1,
  providerErrorCode?: string,
): RideOutputOrchestrationResultV2 {
  return {
    status: "fallback",
    stage,
    modelRepairCalls,
    fallback: { reason, failureCodes, ...(providerErrorCode ? { providerErrorCode } : {}) },
    steps,
  };
}

/**
 * Full repair orchestration for one first-round model output:
 * validate → classify (red lines / deterministic / model-repair-eligible) →
 * deterministic organize + full revalidation → at most one constrained model
 * repair + full revalidation → pass or fallback. Never a third model call.
 */
export async function orchestrateRideOutputValidationV2(
  options: RideOutputRepairOptionsV2,
): Promise<RideOutputOrchestrationResultV2> {
  const steps: RideOutputRepairDecisionStepV2[] = [];
  const { input, firstOutput } = options;

  const first = validateRideModelOutputV2(input, firstOutput);
  if (first.status === "pass") {
    steps.push({ step: "first_validation", detail: "passed" });
    return { status: "pass", stage: "firstPass", output: firstOutput as RideModelOutputV2, modelRepairCalls: 0, steps };
  }
  steps.push({ step: "first_validation", detail: `failed: ${uniqueCodes(first.issues).join(",")}` });

  // Red lines in core content: no repair gambling, zero extra model calls.
  // Red-line issues confined to optional fragments are handled by deletion
  // below instead of forcing a fallback.
  const coreUnrepairable = first.issues.filter(
    (issue) => !isUnrecordablePath(issue.path) && (rideOutputUnrepairableCoreCodes as readonly string[]).includes(issue.code),
  );
  if (coreUnrepairable.length) {
    steps.push({
      step: "fallback_decision",
      detail: `unrepairable core issues, no repair attempted: ${uniqueCodes(coreUnrepairable).join(",")}`,
    });
    return fallback("repairFailed", "UNREPAIRABLE_ISSUES", uniqueCodes(coreUnrepairable), steps, 0);
  }

  // Deterministic organizing + full revalidation (business rules 14.6.2).
  let currentIssues = first.issues;
  let currentOutput: unknown = firstOutput;
  const organized = organizeRideOutputDeterministicallyV2(input, firstOutput, first.issues);
  if (organized) {
    steps.push({ step: "deterministic_organize", detail: organized.fixes.join("; ") });
    const revalidation = validateRideModelOutputV2(input, organized.output);
    steps.push({
      step: "post_organize_validation",
      detail: revalidation.status === "pass" ? "passed" : `failed: ${uniqueCodes(revalidation.issues).join(",")}`,
    });
    if (revalidation.status === "pass") {
      return {
        status: "pass",
        stage: "deterministicRepairPass",
        output: organized.output as unknown as RideModelOutputV2,
        modelRepairCalls: 0,
        steps,
      };
    }
    currentIssues = revalidation.issues;
    currentOutput = organized.output;
  }

  // Defensive re-check: organizing must never surface (or mask) a red line.
  const coreUnrepairableNow = currentIssues.filter(
    (issue) => !isUnrecordablePath(issue.path) && (rideOutputUnrepairableCoreCodes as readonly string[]).includes(issue.code),
  );
  if (coreUnrepairableNow.length) {
    steps.push({
      step: "fallback_decision",
      detail: `unrepairable core issues after organizing: ${uniqueCodes(coreUnrepairableNow).join(",")}`,
    });
    return fallback("repairFailed", "UNREPAIRABLE_ISSUES", uniqueCodes(coreUnrepairableNow), steps, 0);
  }

  // Model repair admission (business rules 14.6.3): the remaining issues are
  // locatable and non-high-risk by construction; the caller owns the overall
  // latency/cost budget through allowModelRepair.
  if (options.allowModelRepair === false || !options.repairCaller) {
    steps.push({
      step: "fallback_decision",
      detail: "model repair not allowed (budget barred or no repair caller wired)",
    });
    return fallback("repairFailed", "REPAIR_NOT_ALLOWED", uniqueCodes(currentIssues), steps, 0);
  }

  const sanitized = sanitizeRideOutputForRepairReference(currentOutput);
  const repairPrompt = buildRideRepairPromptV2({
    input,
    issues: currentIssues,
    ...(sanitized ? { sanitizedPreviousOutput: sanitized } : {}),
  });
  steps.push({
    step: "model_repair_call",
    detail: `one constrained repair call with ${uniqueCodes(currentIssues).length} error codes, prompt ${RIDE_REPAIR_PROMPT_VERSION}`,
  });

  try {
    const repairResult = await options.repairCaller({
      promptText: repairPrompt.promptText,
      promptVersion: RIDE_REPAIR_PROMPT_VERSION,
      analysisRunId: input.analysisRunId,
      requestId: options.requestId,
    });
    let repaired: unknown;
    try {
      repaired = JSON.parse(repairResult.rawText);
    } catch {
      steps.push({ step: "post_repair_validation", detail: "repair response was not JSON" });
      return fallback("repairFailed", "REPAIR_OUTPUT_UNPARSEABLE", uniqueCodes(currentIssues), steps, 1);
    }
    const final = validateRideModelOutputV2(input, repaired);
    steps.push({
      step: "post_repair_validation",
      detail: final.status === "pass" ? "passed" : `failed: ${uniqueCodes(final.issues).join(",")}`,
    });
    if (final.status === "pass") {
      return { status: "pass", stage: "modelRepairPass", output: repaired as RideModelOutputV2, modelRepairCalls: 1, steps };
    }
    // Second failure: degrade immediately, no third call (business rules 14.6.5).
    return fallback("repairFailed", "REPAIR_OUTPUT_INVALID", uniqueCodes(final.issues), steps, 1);
  } catch (error) {
    const providerErrorCode = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
    steps.push({
      step: "post_repair_validation",
      detail: `repair call failed${providerErrorCode ? ` (${providerErrorCode})` : ""}`,
    });
    return fallback("repairFailed", "REPAIR_CALL_FAILED", uniqueCodes(currentIssues), steps, 1, providerErrorCode);
  }
}
