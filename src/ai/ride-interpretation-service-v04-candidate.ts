import { CozeWorkflowError } from "./coze-workflow-client.ts";
import type {
  RideInterpretationInvocationV04Candidate,
  RideInterpretationProviderV04Candidate,
} from "./ride-interpretation-coze-client-v04-candidate.ts";
import {
  normalizeRideInterpretationOutputV04Candidate,
  validateRideInterpretationOutputV04Candidate,
  type RideInterpretationOutputV04Candidate,
} from "./ride-interpretation-output-v04-candidate.ts";
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
  if (issues.some((issue) => issue === "OVERALL_ACTION_LANGUAGE_NOT_ALLOWED")) {
    actions.push("整体评价只能解释本次骑行，不得包含建议、应当、应该、下次、训练计划、恢复天数或可以尝试等行动措辞；删除该措辞，改为由 overallAssessment.claimIds 支持的事实或解释性表述。下一步建议只能写在 nextAction。");
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
    "不得新增或删减系统已选维度、事实、图表、限制或建议；可以只在输入计划已开放的 Candidate Claim 中替换或补齐 claimIds。不得创造新 Claim、数字或跨维度计算；只输出 ride-interpretation-output-v0.4.2-candidate JSON。",
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
  const firstValidation = validateRawOutput(firstRawText, input);
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
    const repairedValidation = validateRawOutput(repaired.rawText, input);
    if (repairedValidation.valid && repairedValidation.output) {
      return { source: "candidate", output: repairedValidation.output, attempts: 2, latencyMs: firstAttemptLatencyMs + repairLatencyMs, validationIssues: firstValidation.issues, providerRequestIds };
    }
    return { source: "b0", output: null, fallbackCode: "REPAIR_FAILED", attempts: 2, latencyMs: Date.now() - startedAt, validationIssues: [...new Set([...firstValidation.issues, ...repairedValidation.issues])], providerRequestIds };
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
