import type { AnalysisEligibility } from "../domain/analysis-eligibility.ts";
import type { RideAnalysisContext } from "../domain/ride-analysis-context.ts";
import type { FewShotSelection } from "./ride-analysis-few-shot.ts";
import { projectRideAnalysisContextForModel } from "./ride-analysis-context-projection.ts";

export const COZE_WORKFLOW_ADAPTER_VERSION = "coze-workflow-adapter-v0.3" as const;
export const COZE_INPUT_CONTRACT_VERSION = "ride-analysis-input-v0.2" as const;
export const COZE_INPUT_VARIABLES = [
  "analysis_context",
  "analysis_elig",
  "few_shot_json",
  "repair_instruction",
  "previous_output",
] as const;

export type CozeWorkflowErrorCode =
  | "AI_TIMEOUT"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REJECTED_REQUEST";

export class CozeWorkflowError extends Error {
  readonly code: CozeWorkflowErrorCode;

  constructor(code: CozeWorkflowErrorCode, message: string) {
    super(message);
    this.name = "CozeWorkflowError";
    this.code = code;
  }
}

export interface CozeWorkflowConfig {
  apiUrl: string;
  workflowName: string;
  workflowId: string;
  workflowVersion: string;
  apiToken: string;
  modelId: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface RideAnalysisInvocation {
  requestId: string;
  analysisContext: RideAnalysisContext;
  eligibility: AnalysisEligibility;
  fewShotSelection: FewShotSelection;
  repairInstruction?: string;
  previousOutput?: string;
}

export interface RideAnalysisProviderResult {
  rawText: string;
  providerRequestId?: string;
  telemetry?: {
    logId?: string;
    executeId?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
}

export interface RideAnalysisProvider {
  run(input: RideAnalysisInvocation): Promise<RideAnalysisProviderResult>;
}

export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function readCozeWorkflowConfig(
  environment: ServerEnvironment = process.env,
): CozeWorkflowConfig | undefined {
  const apiUrl = environment.COZE_API_URL?.trim();
  const workflowName = environment.COZE_WORKFLOW_NAME?.trim();
  const workflowId = environment.COZE_WORKFLOW_ID?.trim();
  const workflowVersion = environment.COZE_WORKFLOW_VERSION?.trim();
  const apiToken = environment.COZE_API_TOKEN?.trim();
  if (!apiUrl || !workflowName || !workflowId || !workflowVersion || !apiToken) return undefined;

  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("COZE_API_URL must use HTTPS unless it targets localhost");
  }

  return {
    apiUrl: parsedUrl.toString(),
    workflowName,
    workflowId,
    workflowVersion,
    apiToken,
    modelId: environment.COZE_MODEL_ID?.trim() || "unrecorded",
    timeoutMs: positiveInteger(environment.AI_ANALYSIS_TIMEOUT_MS, 8_000, 15_000),
    maxResponseBytes: positiveInteger(environment.AI_MAX_RESPONSE_BYTES, 262_144, 524_288),
  };
}

function extractProviderRequestId(
  response: Response,
  envelope: Record<string, unknown>,
): string | undefined {
  const fromHeader = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid");
  if (fromHeader) return fromHeader;
  const detail = isRecord(envelope.detail) ? envelope.detail : undefined;
  if (detail && typeof detail.logid === "string") return detail.logid;
  for (const key of ["request_id", "requestId", "logid"]) {
    if (typeof envelope[key] === "string") return envelope[key] as string;
  }
  return undefined;
}

function extractTelemetry(envelope: Record<string, unknown>): {
  logId?: string;
  executeId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
} {
  const detail = isRecord(envelope.detail) ? envelope.detail : undefined;
  const logId = detail && typeof detail.logid === "string"
    ? detail.logid
    : typeof envelope.logid === "string" ? envelope.logid : undefined;
  const executeId = typeof envelope.execute_id === "string"
    ? envelope.execute_id
    : typeof envelope.executeId === "string" ? envelope.executeId : undefined;
  const usageValue = isRecord(envelope.usage)
    ? envelope.usage
    : detail && isRecord(detail.usage) ? detail.usage : undefined;
  const inputCount = usageValue?.input_count;
  const outputCount = usageValue?.output_count;
  const tokenCount = usageValue?.token_count;
  const usage = Number.isInteger(inputCount) && Number.isInteger(outputCount) && Number.isInteger(tokenCount)
    ? { inputTokens: inputCount as number, outputTokens: outputCount as number, totalTokens: tokenCount as number }
    : undefined;
  return {
    ...(logId ? { logId } : {}),
    ...(executeId ? { executeId } : {}),
    ...(usage ? { usage } : {}),
  };
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractAnalysisText(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    return parsed === value ? value : extractAnalysisText(parsed, depth + 1);
  }
  const record = isRecord(value) ? value : undefined;
  if (!record) return undefined;
  if (typeof record.headline === "string" && isRecord(record.overallAssessment)) {
    return JSON.stringify(record);
  }
  for (const key of ["analysis_json", "analysisJson", "output", "data"]) {
    if (record[key] !== undefined) {
      const nested = extractAnalysisText(record[key], depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

export class CozeWorkflowClient implements RideAnalysisProvider {
  private readonly config: CozeWorkflowConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: CozeWorkflowConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async run(input: RideAnalysisInvocation): Promise<RideAnalysisProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const modelContext = projectRideAnalysisContextForModel(input.analysisContext);
    try {
      const response = await this.fetchImpl(this.config.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": input.requestId,
        },
        body: JSON.stringify({
          workflow_id: this.config.workflowId,
          workflow_version: this.config.workflowVersion,
          is_async: false,
          parameters: {
            analysis_context: JSON.stringify(modelContext),
            analysis_elig: JSON.stringify(input.eligibility),
            few_shot_json: JSON.stringify(input.fewShotSelection),
            repair_instruction: input.repairInstruction ?? "",
            previous_output: input.previousOutput ?? "",
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.config.maxResponseBytes) {
        throw new CozeWorkflowError("PROVIDER_RESPONSE_TOO_LARGE", "Provider response exceeded limit");
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > this.config.maxResponseBytes) {
        throw new CozeWorkflowError("PROVIDER_RESPONSE_TOO_LARGE", "Provider response exceeded limit");
      }
      if (!response.ok) {
        throw new CozeWorkflowError("PROVIDER_HTTP_ERROR", `Provider returned HTTP ${response.status}`);
      }

      let envelopeValue: unknown;
      try {
        envelopeValue = JSON.parse(responseText);
      } catch {
        throw new CozeWorkflowError("PROVIDER_INVALID_RESPONSE", "Provider response was not JSON");
      }
      const envelope = isRecord(envelopeValue) ? envelopeValue : undefined;
      if (!envelope) {
        throw new CozeWorkflowError("PROVIDER_INVALID_RESPONSE", "Provider response envelope was invalid");
      }
      if (typeof envelope.code === "number" && envelope.code !== 0) {
        throw new CozeWorkflowError("PROVIDER_REJECTED_REQUEST", `Provider rejected request with code ${envelope.code}`);
      }
      const rawText = extractAnalysisText(envelope.data ?? envelope);
      if (!rawText) {
        throw new CozeWorkflowError("PROVIDER_INVALID_RESPONSE", "Provider response did not contain analysis_json");
      }
      const providerRequestId = extractProviderRequestId(response, envelope);
      const telemetry = extractTelemetry(envelope);
      return {
        rawText,
        ...(providerRequestId ? { providerRequestId } : {}),
        ...(Object.keys(telemetry).length > 0 ? { telemetry } : {}),
      };
    } catch (error) {
      if (error instanceof CozeWorkflowError) throw error;
      if (controller.signal.aborted) {
        throw new CozeWorkflowError("AI_TIMEOUT", "Provider request timed out");
      }
      throw new CozeWorkflowError("PROVIDER_HTTP_ERROR", "Provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
