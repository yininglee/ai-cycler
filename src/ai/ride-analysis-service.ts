import {
  CozeWorkflowClient,
  CozeWorkflowError,
  readCozeWorkflowConfig,
  type RideAnalysisProvider,
  type ServerEnvironment,
} from "./coze-workflow-client.ts";
import {
  RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  validateRideAnalysisOutputV03,
  type RideAnalysisOutputV03,
} from "./ride-analysis-output-v03.ts";
import {
  RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION,
  RIDE_ANALYSIS_FEW_SHOT_VERSION,
  disabledRideAnalysisFewShots,
  selectRideAnalysisFewShots,
  type FewShotSelection,
} from "./ride-analysis-few-shot.ts";
import {
  buildAnalysisEligibility,
  type AnalysisEligibility,
} from "../domain/analysis-eligibility.ts";
import {
  buildRideAnalysisContext,
  type BuildRideAnalysisContextOptions,
  type RideAnalysisContext,
} from "../domain/ride-analysis-context.ts";
import {
  generateB0RideAnalysis,
  type B0RideAnalysis,
  type RideAnalysisOutput,
} from "../domain/ride-summary.ts";
import type { RideRecord } from "../domain/ride-schema.ts";

export const RIDE_ANALYSIS_SERVICE_VERSION = "ride-analysis-service-v1.5" as const;
export const RIDE_ANALYSIS_WORKFLOW_VERSION = "ride_analysis_v2-dev.15" as const;
export const RIDE_ANALYSIS_PROMPT_VERSION = "3.1.2" as const;

export type RideAnalysisFallbackCode =
  | "AI_DISABLED"
  | "AI_NOT_CONFIGURED"
  | "DATA_NOT_ELIGIBLE"
  | "SAFETY_STOP"
  | "AI_TIMEOUT"
  | "PROVIDER_ERROR"
  | "REPAIR_FAILED";

export interface PreparedRideAnalysis {
  b0: B0RideAnalysis;
  context: RideAnalysisContext;
  eligibility: AnalysisEligibility;
}

export interface SafetyStopOutput {
  headline: "请立即停止骑行";
  message: string;
  safetyLevel: "stop";
}

interface RuntimeVersions {
  service: typeof RIDE_ANALYSIS_SERVICE_VERSION;
  outputSchema: typeof RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION;
  prompt: typeof RIDE_ANALYSIS_PROMPT_VERSION;
  workflow: typeof RIDE_ANALYSIS_WORKFLOW_VERSION;
  modelId: string;
  context: string;
  contextRules: string;
  eligibility: string;
  eligibilityRules: string;
  fewShotLibrary: typeof RIDE_ANALYSIS_FEW_SHOT_VERSION;
  fewShotRouter: typeof RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION;
  fewShotMode: FewShotSelection["mode"];
  b0Template: string;
}

interface RuntimeResultBase {
  attempts: number;
  latencyMs: number;
  validationIssues: string[];
  providerRequestIds: string[];
  selectedExampleIds: string[];
  versions: RuntimeVersions;
}

export type RideAnalysisRuntimeResult =
  | (RuntimeResultBase & { source: "b2"; output: RideAnalysisOutputV03; fallbackCode?: never })
  | (RuntimeResultBase & { source: "b0"; output: RideAnalysisOutput; fallbackCode: Exclude<RideAnalysisFallbackCode, "SAFETY_STOP"> })
  | (RuntimeResultBase & { source: "safety_stop"; output: SafetyStopOutput; fallbackCode: "SAFETY_STOP" });

export interface RideAnalysisRuntimeOptions {
  enabled: boolean;
  provider?: RideAnalysisProvider;
  modelId?: string;
  requestId?: string;
  fewShotEnabled?: boolean;
}

function versions(prepared: PreparedRideAnalysis, modelId: string, selection: FewShotSelection): RuntimeVersions {
  return {
    service: RIDE_ANALYSIS_SERVICE_VERSION,
    outputSchema: RIDE_ANALYSIS_OUTPUT_SCHEMA_VERSION,
    prompt: RIDE_ANALYSIS_PROMPT_VERSION,
    workflow: RIDE_ANALYSIS_WORKFLOW_VERSION,
    modelId,
    context: prepared.context.schemaVersion,
    contextRules: prepared.context.rulesVersion,
    eligibility: prepared.eligibility.schemaVersion,
    eligibilityRules: prepared.eligibility.rulesVersion,
    fewShotLibrary: RIDE_ANALYSIS_FEW_SHOT_VERSION,
    fewShotRouter: RIDE_ANALYSIS_FEW_SHOT_ROUTER_VERSION,
    fewShotMode: selection.mode,
    b0Template: prepared.b0.templateVersion,
  };
}

function fallback(
  prepared: PreparedRideAnalysis,
  code: Exclude<RideAnalysisFallbackCode, "SAFETY_STOP">,
  startedAt: number,
  attempts: number,
  validationIssues: string[],
  providerRequestIds: string[],
  selection: FewShotSelection,
  modelId: string,
): RideAnalysisRuntimeResult {
  return {
    source: "b0",
    output: prepared.b0.output,
    fallbackCode: code,
    attempts,
    latencyMs: Date.now() - startedAt,
    validationIssues: [...new Set(validationIssues)],
    providerRequestIds,
    selectedExampleIds: selection.exampleIds,
    versions: versions(prepared, modelId, selection),
  };
}

function safetyStop(prepared: PreparedRideAnalysis, startedAt: number, modelId: string): RideAnalysisRuntimeResult {
  const selection = disabledRideAnalysisFewShots();
  return {
    source: "safety_stop",
    output: {
      headline: "请立即停止骑行",
      message: "请优先确保人身安全；如有胸痛、呼吸困难、晕厥、意识异常或严重外伤，请立即联系当地急救或尽快就医。",
      safetyLevel: "stop",
    },
    fallbackCode: "SAFETY_STOP",
    attempts: 0,
    latencyMs: Date.now() - startedAt,
    validationIssues: [],
    providerRequestIds: [],
    selectedExampleIds: [],
    versions: versions(prepared, modelId, selection),
  };
}

function providerFallbackCode(error: unknown): Exclude<RideAnalysisFallbackCode, "SAFETY_STOP"> {
  return error instanceof CozeWorkflowError && error.code === "AI_TIMEOUT"
    ? "AI_TIMEOUT"
    : "PROVIDER_ERROR";
}

function repairInstruction(issues: string[]): string {
  return [
    "上一输出未通过服务端校验。只修正JSON结构、claim引用、数字或越权维度；不得新增事实、数字、claim、维度或建议。",
    `错误码：${[...new Set(issues)].join(",")}`,
    "仍只能使用analysis_context.allowedClaims和analysis_elig允许的维度，并只输出ride-analysis-output-v0.3 JSON。",
  ].join("\n");
}

function parseOutput(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    return undefined;
  }
}

export function prepareRideAnalysis(
  record: RideRecord,
  userScope = "local-demo",
  contextOptions: Omit<BuildRideAnalysisContextOptions, "userScope"> = {},
): PreparedRideAnalysis {
  const context = buildRideAnalysisContext(record, { ...contextOptions, userScope });
  return {
    b0: generateB0RideAnalysis(record.activity, userScope),
    context,
    eligibility: buildAnalysisEligibility(context),
  };
}

export async function runRideAnalysis(
  prepared: PreparedRideAnalysis,
  options: RideAnalysisRuntimeOptions,
): Promise<RideAnalysisRuntimeResult> {
  const startedAt = Date.now();
  const requestId = options.requestId ?? crypto.randomUUID();
  const modelId = options.modelId ?? "unrecorded";
  const providerRequestIds: string[] = [];
  const disabledSelection = disabledRideAnalysisFewShots();
  if (prepared.eligibility.fallback === "safety_stop") return safetyStop(prepared, startedAt, modelId);
  if (!prepared.eligibility.eligible) {
    return fallback(prepared, "DATA_NOT_ELIGIBLE", startedAt, 0, [], [], disabledRideAnalysisFewShots("not_eligible"), modelId);
  }
  if (!options.enabled) return fallback(prepared, "AI_DISABLED", startedAt, 0, [], [], disabledSelection, modelId);
  if (!options.provider) return fallback(prepared, "AI_NOT_CONFIGURED", startedAt, 0, [], [], disabledSelection, modelId);

  const initialSelection = options.fewShotEnabled === true
    ? selectRideAnalysisFewShots(prepared.context, prepared.eligibility, "generate")
    : disabledSelection;
  let firstRawText: string;
  try {
    const first = await options.provider.run({
      requestId,
      analysisContext: prepared.context,
      eligibility: prepared.eligibility,
      fewShotSelection: initialSelection,
    });
    firstRawText = first.rawText;
    if (first.providerRequestId) providerRequestIds.push(first.providerRequestId);
  } catch (error) {
    return fallback(prepared, providerFallbackCode(error), startedAt, 1, [], providerRequestIds, initialSelection, modelId);
  }

  const firstValidation = validateRideAnalysisOutputV03(parseOutput(firstRawText), prepared.context, prepared.eligibility);
  if (firstValidation.valid && firstValidation.output) {
    return {
      source: "b2",
      output: firstValidation.output,
      attempts: 1,
      latencyMs: Date.now() - startedAt,
      validationIssues: [],
      providerRequestIds,
      selectedExampleIds: initialSelection.exampleIds,
      versions: versions(prepared, modelId, initialSelection),
    };
  }

  const repairSelection = options.fewShotEnabled === true
    ? selectRideAnalysisFewShots(prepared.context, prepared.eligibility, "repair")
    : disabledSelection;
  try {
    const repaired = await options.provider.run({
      requestId: `${requestId}:repair`,
      analysisContext: prepared.context,
      eligibility: prepared.eligibility,
      fewShotSelection: repairSelection,
      repairInstruction: repairInstruction(firstValidation.issues),
      previousOutput: firstRawText,
    });
    if (repaired.providerRequestId) providerRequestIds.push(repaired.providerRequestId);
    const repairedValidation = validateRideAnalysisOutputV03(parseOutput(repaired.rawText), prepared.context, prepared.eligibility);
    if (repairedValidation.valid && repairedValidation.output) {
      return {
        source: "b2",
        output: repairedValidation.output,
        attempts: 2,
        latencyMs: Date.now() - startedAt,
        validationIssues: firstValidation.issues,
        providerRequestIds,
        selectedExampleIds: repairSelection.exampleIds,
        versions: versions(prepared, modelId, repairSelection),
      };
    }
    return fallback(
      prepared,
      "REPAIR_FAILED",
      startedAt,
      2,
      [...firstValidation.issues, ...repairedValidation.issues],
      providerRequestIds,
      repairSelection,
      modelId,
    );
  } catch (error) {
    return fallback(
      prepared,
      providerFallbackCode(error) === "AI_TIMEOUT" ? "AI_TIMEOUT" : "REPAIR_FAILED",
      startedAt,
      2,
      firstValidation.issues,
      providerRequestIds,
      repairSelection,
      modelId,
    );
  }
}

export async function analyzeRideRecord(
  record: RideRecord,
  userScope = "local-demo",
  environment: ServerEnvironment = process.env,
  contextOptions: Omit<BuildRideAnalysisContextOptions, "userScope"> = {},
): Promise<RideAnalysisRuntimeResult> {
  const prepared = prepareRideAnalysis(record, userScope, contextOptions);
  const enabled = environment.AI_ANALYSIS_ENABLED === "true";
  if (!enabled) return runRideAnalysis(prepared, { enabled: false });

  let config;
  try {
    config = readCozeWorkflowConfig(environment);
  } catch {
    return runRideAnalysis(prepared, { enabled: true });
  }
  return runRideAnalysis(prepared, {
    enabled: true,
    fewShotEnabled: environment.AI_FEW_SHOT_ENABLED === "true",
    ...(config ? { provider: new CozeWorkflowClient(config), modelId: config.modelId } : {}),
  });
}
