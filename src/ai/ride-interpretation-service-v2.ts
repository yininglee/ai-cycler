// S6-03: production V2 ride-interpretation orchestration. Wires the isolated
// V2 slices (S1 features -> S2 claims/packets -> S3 profile/knowledge -> L7
// input gate -> S6-01 prompt/schema/validator -> S6-02 repair orchestration
// -> S6-04 presentation) into one server-side run against real data sources.
// Safety contracts preserved end to end:
//   - input-gate failures block the model call and return a traceable b0;
//   - no provider config -> AI_NOT_CONFIGURED b0 (no network call);
//   - provider failures are classified (RideModelErrorV2.code), never retried;
//   - output validation runs the S6-02 pipeline: deterministic organize, at
//     most ONE model repair, full revalidation, otherwise b0 REPAIR_FAILED.
//
// S2-06 (user decision 2026-10-06): single-ride interpretation no longer
// builds historical-comparison or PMC (CTL/ATL/TSB) evidence. Both are
// trend-level readings that belong to a future multi-ride statistics feature,
// not to one ride's interpretation. The packet definitions and the PMC /
// history modules stay in the codebase for that future reuse.

import type { RideRecord } from "../domain/ride-schema.ts";
import type { UserProfile } from "../domain/user-profile.ts";
import { buildRideEventClimbSummary } from "../domain/ride-event-climbs.ts";
import { buildRideElevationSummary } from "../domain/ride-elevation.ts";
import { buildRideRouteShapeSummary } from "../domain/ride-route-shape.ts";
import { buildRideProfileHistoryV2 } from "../domain/ride-profile-history-v2.ts";
import {
  RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION,
  buildRideAnalysisEvidencePacketsV2,
} from "../domain/ride-analysis-evidence-packets-v2.ts";
import { RIDE_EVIDENCE_RULES_VERSION } from "../domain/ride-analysis-evidence-v2.ts";
import { attachRideKnowledgeEvidenceV2 } from "../domain/ride-analysis-knowledge-v2.ts";
import {
  RIDE_KNOWLEDGE_BASE_V21_VERSION,
  rideKnowledgeBaseV21,
} from "../domain/ride-knowledge-base-v21.ts";
import {
  buildRideModelInputV2,
  RIDE_MODEL_INPUT_SCHEMA_VERSION,
  type RideModelInputV2,
} from "../domain/ride-model-input-v2.ts";
import { buildRidePromptV2, RIDE_PROMPT_VERSION } from "./ride-prompt-v2.ts";
import { buildRideTemporalWindowsV2 } from "../domain/ride-temporal-windows-v2.ts";
import {
  RideModelErrorV2,
  type RideModelCallRecordV2,
  type RideModelInvocationV2,
} from "./ride-model-provider-v2.ts";
import {
  orchestrateRideOutputValidationV2,
  RIDE_OUTPUT_REPAIR_RULES_VERSION,
  type RideOutputOrchestrationStageV2,
  type RideOutputRepairCallerV2,
} from "./ride-output-repair-v2.ts";
import { validateRideModelOutputV2 } from "./ride-output-validator-v2.ts";
import { buildRideOutputPresentationV2, type RideOutputPresentationV2 } from "./ride-output-presentation-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION, type RideModelOutputV2 } from "./ride-output-schema-v2.ts";
import {
  buildSemanticExemptionPrompt,
  parseSemanticExemptionVerdict,
  SEMANTIC_EXEMPT_PROMPT_VERSION,
  type SemanticExemptionChecker,
} from "./ride-semantic-exemption-v2.ts";

export const RIDE_INTERPRETATION_SERVICE_V2_VERSION = "ride-interpretation-service-v2.3.0" as const;

// Adapts RideModelClientV2.run (or a test double) to the service. callRecord is
// optional so tests can inject minimal fakes; production always returns one.
export type RideModelCallerV2 = (
  invocation: RideModelInvocationV2,
) => Promise<{ rawText: string; callRecord?: RideModelCallRecordV2 }>;

export interface RideInterpretationV2Options {
  record: RideRecord;
  profile?: UserProfile | null;
  analysisRunId: string;
  userScope: string;
  requestId: string;
  // Undefined means "no provider configured" -> AI_NOT_CONFIGURED b0.
  modelCaller?: RideModelCallerV2;
  allowModelRepair?: boolean;
  // V2.1-F: semantic exemption checker for the stability/causality/soft-disclosure
  // gates. `undefined` = build one from modelCaller (production default);
  // `null` = disable (plain regex hard gate, used by tests and fallback paths).
  semanticChecker?: SemanticExemptionChecker | null;
  // V2.1-F: model override for the semantic-exemption re-check (a lite/cheaper
  // model). `undefined` = reuse the main interpretation model. The parameter
  // slimming (maxOutputTokens + short timeout) always applies regardless.
  semanticModelId?: string;
  // DEMO-VALIDATION-BYPASS (user decision 2026-10-14): demo-only switch. When
  // true, the first-round output is displayed as-is: the validator still runs
  // once and its issues are RECORDED (never enforced) so demo usage doubles
  // as a live failure-rate probe, but there is no deterministic organize, no
  // model repair, no semantic exemption, no b0 fallback on validation grounds.
  // The switch lives in this service layer ONLY — the validator, the repair
  // orchestrator and the semantic-exemption layer are untouched, and the eval
  // scripts never set it (V21-12 / R03 always run the pristine chain, so a
  // bypassed demo can never back a release gate).
  demoValidationBypass?: boolean;
  now?: Date;
}

export interface RideInterpretationV2Versions {
  service: typeof RIDE_INTERPRETATION_SERVICE_V2_VERSION;
  evidenceRules: typeof RIDE_EVIDENCE_RULES_VERSION;
  packetRules: typeof RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION;
  knowledgeBase: typeof RIDE_KNOWLEDGE_BASE_V21_VERSION;
  inputSchema: typeof RIDE_MODEL_INPUT_SCHEMA_VERSION;
  prompt: typeof RIDE_PROMPT_VERSION;
  outputSchema: typeof RIDE_OUTPUT_SCHEMA_VERSION;
  repairRules: typeof RIDE_OUTPUT_REPAIR_RULES_VERSION;
  model?: string;
}

export type RideInterpretationV2Result =
  | {
      source: "v2";
      stage: RideOutputOrchestrationStageV2;
      modelRepairCalls: 0 | 1;
      output: RideModelOutputV2;
      presentation: RideOutputPresentationV2;
      callRecords: RideModelCallRecordV2[];
      versions: RideInterpretationV2Versions;
      // Present only when demoValidationBypass was on: the shown output was
      // NOT validation-enforced. bypassedIssueCodes records what the (still
      // executed) validator found on the first-round output.
      demoValidationBypass?: true;
      bypassedIssueCount?: number;
      bypassedIssueCodes?: string[];
    }
  | {
      source: "b0";
      // "blocked" = input gate, "notConfigured" = missing provider,
      // "providerError" = classified model-call failure, "repairFailed" = S6-02 fallback.
      stage: "blocked" | "notConfigured" | "providerError" | "repairFailed";
      fallbackCode: string;
      failureCodes?: string[];
      callRecords: RideModelCallRecordV2[];
      versions: RideInterpretationV2Versions;
    };

const KNOWLEDGE_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  rideKnowledgeBaseV21.map((entry) => [entry.knowledgeId, entry.title]),
);

export function getRideInterpretationV2Versions(): RideInterpretationV2Versions {
  return {
    service: RIDE_INTERPRETATION_SERVICE_V2_VERSION,
    evidenceRules: RIDE_EVIDENCE_RULES_VERSION,
    packetRules: RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION,
    knowledgeBase: RIDE_KNOWLEDGE_BASE_V21_VERSION,
    inputSchema: RIDE_MODEL_INPUT_SCHEMA_VERSION,
    prompt: RIDE_PROMPT_VERSION,
    outputSchema: RIDE_OUTPUT_SCHEMA_VERSION,
    repairRules: RIDE_OUTPUT_REPAIR_RULES_VERSION,
  };
}

// Best-effort JSON extraction: plain JSON first, then a fenced ```json block.
function parseModelJsonText(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    // fall through to fenced extraction
  }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// L7 failure codes that reuse an existing user-facing fallback code; every
// other code is surfaced verbatim for traceability.
function mapInputFailureCode(failureCode: string): string {
  return failureCode === "NO_DELIVERABLE_QUESTIONS" ? "DATA_NOT_ELIGIBLE" : failureCode;
}

export async function runRideInterpretationV2(options: RideInterpretationV2Options): Promise<RideInterpretationV2Result> {
  const { record, analysisRunId, userScope, requestId } = options;
  const versions = getRideInterpretationV2Versions();
  const callRecords: RideModelCallRecordV2[] = [];

  // S2-05: feed the climb events and terrain segments — the same deterministic
  // summaries the detail page renders (elevation -> route shape -> climbs) —
  // into the temporal windows. Without this wiring the climb and terrain
  // capabilities stay closed even when the ride has full elevation data.
  const elevationSummary = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record);
  const windows = buildRideTemporalWindowsV2(record, { climbs: eventClimbs, routeShape });

  // S2-06: no historical comparison and no PMC loads are built for a
  // single-ride interpretation (user decision 2026-10-06) — the corresponding
  // packets simply stay closed because their capabilities are unavailable.
  const profileHistory = buildRideProfileHistoryV2(record, {
    profile: options.profile ?? undefined,
    windows,
  });

  // Knowledge input (user decision 2026-10-07, PD-AI-25, soft-off; reopened in
  // V21-08 with the four-section V2.1 knowledge base). V2.1 knowledge carries
  // benchmarks + science (explanation) and structured interpretation signals
  // for Prompt soft-guidance. Flip to false to restore the soft-off (one-line).
  const KNOWLEDGE_INPUT_ENABLED = true;

  // S2-02: full evidence packets, then S3-02 knowledge attachment.
  const packetsContext = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId,
    userScope,
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packetsContext, {
    knowledgeBase: KNOWLEDGE_INPUT_ENABLED ? rideKnowledgeBaseV21 : [],
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_V21_VERSION,
    retrievedAt: (options.now ?? new Date()).toISOString(),
  });

  // L7 gate: any failure blocks the model call with a traceable code.
  const inputResult = buildRideModelInputV2(knowledgeContext, { analysisRunId, userScope });
  if (inputResult.status === "blocked") {
    return {
      source: "b0",
      stage: "blocked",
      fallbackCode: mapInputFailureCode(inputResult.failureCode),
      failureCodes: [inputResult.failureCode],
      callRecords,
      versions,
    };
  }
  const input: RideModelInputV2 = inputResult.input;

  if (!options.modelCaller) {
    return { source: "b0", stage: "notConfigured", fallbackCode: "AI_NOT_CONFIGURED", callRecords, versions };
  }
  const modelCaller = options.modelCaller;

  const prompt = buildRidePromptV2(input);
  let firstParsed: unknown;
  try {
    const first = await modelCaller({
      analysisRunId,
      requestId,
      promptText: prompt.promptText,
      promptVersion: prompt.promptVersion,
      jsonMode: true,
    });
    if (first.callRecord) callRecords.push(first.callRecord);
    firstParsed = parseModelJsonText(first.rawText);
  } catch (error) {
    if (error instanceof RideModelErrorV2) {
      callRecords.push(error.callRecord);
      return { source: "b0", stage: "providerError", fallbackCode: error.code, callRecords, versions };
    }
    throw error;
  }

  // S6-02 pipeline: deterministic organize -> at most one model repair ->
  // full revalidation -> pass or b0 fallback. Never a third model call.
  const repairCaller: RideOutputRepairCallerV2 = async (call) => {
    const result = await modelCaller({
      analysisRunId: call.analysisRunId,
      requestId: call.requestId,
      promptText: call.promptText,
      promptVersion: call.promptVersion,
      jsonMode: true,
    });
    if (result.callRecord) callRecords.push(result.callRecord);
    return { rawText: result.rawText };
  };

  // DEMO-VALIDATION-BYPASS: record-only validation, zero repair pipeline. An
  // unparseable first round (firstParsed undefined) still falls through to the
  // normal pipeline — there is nothing to display, and the repair call may yet
  // save it. The input gate (L7) is NOT bypassed: a ride without deliverable
  // questions has nothing to interpret either way.
  if (options.demoValidationBypass && firstParsed !== undefined) {
    const validation = validateRideModelOutputV2(input, firstParsed);
    const bypassedIssues = validation.status === "fail" ? validation.issues : [];
    const bypassedIssueCodes = [...new Set(bypassedIssues.map((issue) => issue.code))];
    const presentation = buildRideOutputPresentationV2(firstParsed as RideModelOutputV2, {
      knowledgeTitles: KNOWLEDGE_TITLES,
      demoBypassNotice: bypassedIssues.length > 0
        ? `演示模式：校验旁路——首轮输出直接展示，未拦截 ${bypassedIssues.length} 项校验 issue（${bypassedIssueCodes.join(", ")}）`
        : "演示模式：校验旁路——首轮输出直接展示（本轮零 issue）",
    });
    return {
      source: "v2",
      stage: "firstPass",
      modelRepairCalls: 0,
      output: firstParsed as RideModelOutputV2,
      presentation,
      callRecords,
      versions: { ...versions, model: callRecords[0]?.model },
      demoValidationBypass: true,
      bypassedIssueCount: bypassedIssues.length,
      bypassedIssueCodes,
    };
  }

  // V2.1-F: semantic exemption checker. Reuses the same model caller to re-check
  // the three exemptable regex gates (stability / causality / soft-disclosure).
  // Fail-closed: an unparseable or errored semantic verdict keeps the regex
  // issue (never a pass). Absent a model caller, this stays undefined and the
  // regex hard gate behaves exactly as before.
  // Cost control: the verdict is a tiny {"exempt":bool,"reason":"..."} — cap
  // output tokens and shorten the timeout; optionally route to a lite model
  // via semanticModelId (RIDE_MODEL_V2_SEMANTIC_MODEL_ID) while the main
  // interpretation stays on the configured model.
  const defaultSemanticChecker: SemanticExemptionChecker | undefined = modelCaller
    ? async (request) => {
        const promptText = buildSemanticExemptionPrompt(request);
        const result = await modelCaller({
          analysisRunId,
          requestId: `${requestId}:semantic`,
          promptText,
          promptVersion: SEMANTIC_EXEMPT_PROMPT_VERSION,
          jsonMode: true,
          maxOutputTokens: 128,
          timeoutMs: 10_000,
          ...(options.semanticModelId ? { modelId: options.semanticModelId } : {}),
        });
        if (result.callRecord) callRecords.push(result.callRecord);
        return (
          parseSemanticExemptionVerdict(result.rawText) ?? {
            exempt: false,
            reason: "unparseable verdict (fail-closed)",
          }
        );
      }
    : undefined;
  const semanticChecker: SemanticExemptionChecker | undefined =
    options.semanticChecker === null
      ? undefined
      : (options.semanticChecker ?? defaultSemanticChecker);

  const orchestration = await orchestrateRideOutputValidationV2({
    input,
    firstOutput: firstParsed,
    requestId,
    repairCaller,
    allowModelRepair: options.allowModelRepair,
    semanticChecker: semanticChecker,
  });

  if (orchestration.status === "fallback") {
    return {
      source: "b0",
      stage: "repairFailed",
      fallbackCode: "REPAIR_FAILED",
      failureCodes: orchestration.fallback?.failureCodes,
      callRecords,
      versions: { ...versions, model: callRecords[0]?.model },
    };
  }

  const repairOutcomeLabel =
    orchestration.stage === "deterministicRepairPass" ? "本地整理后通过"
    : orchestration.stage === "modelRepairPass" ? "模型修复后通过"
    : undefined;
  const presentation = buildRideOutputPresentationV2(orchestration.output!, {
    knowledgeTitles: KNOWLEDGE_TITLES,
    ...(repairOutcomeLabel ? { repairOutcomeLabel } : {}),
  });

  return {
    source: "v2",
    stage: orchestration.stage,
    modelRepairCalls: orchestration.modelRepairCalls,
    output: orchestration.output!,
    presentation,
    callRecords,
    versions: { ...versions, model: callRecords[0]?.model },
  };
}
