// S6-03: production V2 ride-interpretation orchestration. Wires the isolated
// V2 slices (S1 features -> S2 claims/packets -> S3 profile/history/knowledge
// -> PMC-01 -> L7 input gate -> S6-01 prompt/schema/validator -> S6-02 repair
// orchestration -> S6-04 presentation) into one server-side run against real
// data sources. Safety contracts preserved end to end:
//   - input-gate failures block the model call and return a traceable b0;
//   - no provider config -> AI_NOT_CONFIGURED b0 (no network call);
//   - provider failures are classified (RideModelErrorV2.code), never retried;
//   - output validation runs the S6-02 pipeline: deterministic organize, at
//     most ONE model repair, full revalidation, otherwise b0 REPAIR_FAILED.

import type { RideRecord } from "../domain/ride-schema.ts";
import type { UserProfile } from "../domain/user-profile.ts";
import { buildHistoricalComparisonSnapshot, type HistoricalRide } from "../domain/historical-comparison.ts";
import { buildRideCapabilityClaimsV2 } from "../domain/ride-capability-claims-v2.ts";
import { buildRidePmcLoadV2, type RidePmcDailyLoadInput, type RidePmcLoadSnapshotV2 } from "../domain/ride-pmc-load-v2.ts";
import { buildRideProfileHistoryV2 } from "../domain/ride-profile-history-v2.ts";
import {
  RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION,
  buildRideAnalysisEvidencePacketsV2,
} from "../domain/ride-analysis-evidence-packets-v2.ts";
import { RIDE_EVIDENCE_RULES_VERSION } from "../domain/ride-analysis-evidence-v2.ts";
import { attachRideKnowledgeEvidenceV2 } from "../domain/ride-analysis-knowledge-v2.ts";
import {
  RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
  rideKnowledgeBaseBatch1V2,
} from "../domain/ride-knowledge-base-batch1-v2.ts";
import {
  buildRideModelInputV2,
  RIDE_MODEL_INPUT_SCHEMA_VERSION,
  type RideModelInputV2,
} from "../domain/ride-model-input-v2.ts";
import { buildRidePromptV2, RIDE_PROMPT_VERSION } from "./ride-prompt-v2.ts";
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
import { buildRideOutputPresentationV2, type RideOutputPresentationV2 } from "./ride-output-presentation-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION, type RideModelOutputV2 } from "./ride-output-schema-v2.ts";

export const RIDE_INTERPRETATION_SERVICE_V2_VERSION = "ride-interpretation-service-v2.0.0" as const;

// Adapts RideModelClientV2.run (or a test double) to the service. callRecord is
// optional so tests can inject minimal fakes; production always returns one.
export type RideModelCallerV2 = (
  invocation: RideModelInvocationV2,
) => Promise<{ rawText: string; callRecord?: RideModelCallRecordV2 }>;

export interface RideInterpretationV2Options {
  record: RideRecord;
  profile?: UserProfile | null;
  // Prior rides for the "relative to the past" question and PMC daily loads.
  // The anchor ride itself is filtered by the comparison builder; PMC loads
  // additionally include the current ride's own TSS.
  historyRides?: HistoricalRide[];
  analysisRunId: string;
  userScope: string;
  requestId: string;
  // Undefined means "no provider configured" -> AI_NOT_CONFIGURED b0.
  modelCaller?: RideModelCallerV2;
  allowModelRepair?: boolean;
  now?: Date;
}

export interface RideInterpretationV2Versions {
  service: typeof RIDE_INTERPRETATION_SERVICE_V2_VERSION;
  evidenceRules: typeof RIDE_EVIDENCE_RULES_VERSION;
  packetRules: typeof RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION;
  knowledgeBase: typeof RIDE_KNOWLEDGE_BASE_BATCH1_VERSION;
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

const TSS_CLAIM_KEY = "power.trainingStressScore";

const KNOWLEDGE_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  rideKnowledgeBaseBatch1V2.map((entry) => [entry.knowledgeId, entry.title]),
);

function baseVersions(): RideInterpretationV2Versions {
  return {
    service: RIDE_INTERPRETATION_SERVICE_V2_VERSION,
    evidenceRules: RIDE_EVIDENCE_RULES_VERSION,
    packetRules: RIDE_EVIDENCE_PACKET_BUILDER_RULES_VERSION,
    knowledgeBase: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
    inputSchema: RIDE_MODEL_INPUT_SCHEMA_VERSION,
    prompt: RIDE_PROMPT_VERSION,
    outputSchema: RIDE_OUTPUT_SCHEMA_VERSION,
    repairRules: RIDE_OUTPUT_REPAIR_RULES_VERSION,
  };
}

function rideDate(record: RideRecord): string | undefined {
  const startTime = record.activity.startTime;
  return startTime ? startTime.slice(0, 10) : undefined;
}

// Single source of truth for a ride's TSS: the S2-01 capability snapshot
// (same formula version as the claims the model cites).
function dailyLoadFromRecord(historyId: string, record: RideRecord, profile?: UserProfile | null): RidePmcDailyLoadInput | undefined {
  const date = rideDate(record);
  if (!date) return undefined;
  const snapshot = buildRideCapabilityClaimsV2(record, { profile: profile ?? undefined });
  const tssClaim = snapshot.claims.find((claim) => claim.key === TSS_CLAIM_KEY);
  if (!tssClaim || typeof tssClaim.value !== "number") return undefined;
  return { historyId, date, tss: tssClaim.value };
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
  const versions = baseVersions();
  const callRecords: RideModelCallRecordV2[] = [];
  const historyRides = options.historyRides ?? [];
  const anchorRide: HistoricalRide = { metadata: { historyId: record.activity.rideId }, record };
  const anchorDate = rideDate(record);

  // S3-01: comparable-history snapshot (same defaults as the fixed samples).
  const comparison = anchorDate && historyRides.length
    ? buildHistoricalComparisonSnapshot(anchorRide, historyRides)
    : undefined;

  // PMC-01: daily TSS from history plus the anchor ride itself. The snapshot
  // carries its own availability; closed gates simply keep the packet closed.
  let pmcLoad: RidePmcLoadSnapshotV2 | undefined;
  if (anchorDate) {
    const dailyLoads = [
      ...historyRides.map((ride) => dailyLoadFromRecord(ride.metadata.historyId, ride.record, options.profile)),
      dailyLoadFromRecord(anchorRide.metadata.historyId, record, options.profile),
    ].filter((load): load is RidePmcDailyLoadInput => load !== undefined);
    pmcLoad = buildRidePmcLoadV2({
      rideId: record.activity.rideId,
      anchorDate,
      ftpConfirmed: options.profile?.ftp?.trustStatus === "user_confirmed",
      dailyLoads,
    });
  }

  const profileHistory = buildRideProfileHistoryV2(record, {
    profile: options.profile ?? undefined,
    ...(comparison ? { historicalComparison: comparison } : {}),
    ...(pmcLoad ? { pmcLoad } : {}),
  });

  // S2-02: full evidence packets, then S3-02 knowledge attachment.
  const packetsContext = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId,
    userScope,
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packetsContext, {
    knowledgeBase: rideKnowledgeBaseBatch1V2,
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
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

  const orchestration = await orchestrateRideOutputValidationV2({
    input,
    firstOutput: firstParsed,
    requestId,
    repairCaller,
    allowModelRepair: options.allowModelRepair,
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
