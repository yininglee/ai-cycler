import { CozeWorkflowError, type CozeWorkflowErrorCode, type ServerEnvironment } from "./coze-workflow-client.ts";
import type { RideInterpretationInputV04Candidate } from "./ride-interpretation-input-v04-candidate.ts";

export const COZE_INTERPRETATION_INPUT_VARIABLES = [
  "ride_interp_input",
  "repair_instruction",
  "previous_output",
] as const;

export interface RideInterpretationCozeConfigV04Candidate {
  apiUrl: string;
  workflowName: string;
  workflowId: string;
  workflowVersion: string;
  apiToken: string;
  modelId: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface RideInterpretationInvocationV04Candidate {
  requestId: string;
  input: RideInterpretationInputV04Candidate;
  repairInstruction?: string;
  previousOutput?: string;
  /** Maximum wall time for this Provider invocation. */
  timeoutMs?: number;
}

export interface RideInterpretationProviderResultV04Candidate {
  rawText: string;
  providerRequestId?: string;
  telemetry?: {
    logId?: string;
    executeId?: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
}

export interface RideInterpretationProviderV04Candidate {
  run(input: RideInterpretationInvocationV04Candidate): Promise<RideInterpretationProviderResultV04Candidate>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function readRideInterpretationCozeConfigV04Candidate(
  environment: ServerEnvironment = process.env,
): RideInterpretationCozeConfigV04Candidate | undefined {
  const apiUrl = environment.COZE_API_URL?.trim();
  const workflowName = environment.COZE_INTERPRETATION_WORKFLOW_NAME?.trim();
  const workflowId = environment.COZE_INTERPRETATION_WORKFLOW_ID?.trim();
  const workflowVersion = environment.COZE_INTERPRETATION_WORKFLOW_VERSION?.trim();
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
    modelId: environment.COZE_INTERPRETATION_MODEL_ID?.trim() || "unrecorded",
    timeoutMs: positiveInteger(environment.AI_ANALYSIS_TIMEOUT_MS, 25_000, 25_000),
    maxResponseBytes: positiveInteger(environment.AI_MAX_RESPONSE_BYTES, 262_144, 524_288),
  };
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractInterpretationText(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    return parsed === value ? value : extractInterpretationText(parsed, depth + 1);
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.schemaVersion === "string" && isRecord(value.oneLineLabel) && isRecord(value.overallAssessment)) {
    return JSON.stringify(value);
  }
  for (const key of ["interpretation_json", "interpretationJson", "analysis_json", "analysisJson", "output", "data"]) {
    if (value[key] !== undefined) {
      const nested = extractInterpretationText(value[key], depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function extractProviderRequestId(response: Response, envelope: Record<string, unknown>): string | undefined {
  const headerId = response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid");
  if (headerId) return headerId;
  const detail = isRecord(envelope.detail) ? envelope.detail : undefined;
  if (typeof detail?.logid === "string") return detail.logid;
  for (const key of ["request_id", "requestId", "logid"]) {
    if (typeof envelope[key] === "string") return envelope[key] as string;
  }
  return undefined;
}

function extractTelemetry(envelope: Record<string, unknown>): RideInterpretationProviderResultV04Candidate["telemetry"] {
  const detail = isRecord(envelope.detail) ? envelope.detail : undefined;
  const usageValue = isRecord(envelope.usage) ? envelope.usage : isRecord(detail?.usage) ? detail.usage : undefined;
  const inputCount = usageValue?.input_count;
  const outputCount = usageValue?.output_count;
  const tokenCount = usageValue?.token_count;
  const usage = Number.isInteger(inputCount) && Number.isInteger(outputCount) && Number.isInteger(tokenCount)
    ? { inputTokens: inputCount as number, outputTokens: outputCount as number, totalTokens: tokenCount as number }
    : undefined;
  const logId = typeof detail?.logid === "string" ? detail.logid : typeof envelope.logid === "string" ? envelope.logid : undefined;
  const executeId = typeof envelope.execute_id === "string" ? envelope.execute_id : typeof envelope.executeId === "string" ? envelope.executeId : undefined;
  if (!logId && !executeId && !usage) return undefined;
  return { ...(logId ? { logId } : {}), ...(executeId ? { executeId } : {}), ...(usage ? { usage } : {}) };
}

export class RideInterpretationCozeClientV04Candidate implements RideInterpretationProviderV04Candidate {
  private readonly config: RideInterpretationCozeConfigV04Candidate;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: RideInterpretationCozeConfigV04Candidate,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async run(input: RideInterpretationInvocationV04Candidate): Promise<RideInterpretationProviderResultV04Candidate> {
    const controller = new AbortController();
    const timeoutMs = Number.isInteger(input.timeoutMs) && input.timeoutMs! > 0
      ? Math.min(this.config.timeoutMs, input.timeoutMs!)
      : this.config.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
            ride_interp_input: JSON.stringify(input.input),
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
      const responseBytes = Buffer.byteLength(responseText, "utf8");
      if (responseBytes > this.config.maxResponseBytes) {
        throw new CozeWorkflowError("PROVIDER_RESPONSE_TOO_LARGE", "Provider response exceeded limit", {
          httpStatus: response.status,
          responseBytes,
        });
      }
      if (!response.ok) {
        throw new CozeWorkflowError("PROVIDER_HTTP_ERROR", `Provider returned HTTP ${response.status}`, {
          httpStatus: response.status,
          responseBytes,
        });
      }

      let envelopeValue: unknown;
      try {
        envelopeValue = JSON.parse(responseText);
      } catch {
        throw new CozeWorkflowError("PROVIDER_INVALID_RESPONSE", "Provider response was not JSON", {
          httpStatus: response.status,
          responseJson: false,
          responseBytes,
        });
      }
      if (!isRecord(envelopeValue)) {
        throw new CozeWorkflowError("PROVIDER_INVALID_RESPONSE", "Provider response envelope was invalid", {
          httpStatus: response.status,
          responseJson: true,
          responseBytes,
        });
      }
      if (typeof envelopeValue.code === "number" && envelopeValue.code !== 0) {
        throw new CozeWorkflowError("PROVIDER_REJECTED_REQUEST", `Provider rejected request with code ${envelopeValue.code}`, {
          httpStatus: response.status,
          businessCode: envelopeValue.code,
          responseJson: true,
          responseBytes,
        });
      }
      const rawText = extractInterpretationText(envelopeValue.data ?? envelopeValue);
      if (!rawText) {
        throw new CozeWorkflowError("PROVIDER_INVALID_RESPONSE", "Provider response did not contain candidate interpretation output", {
          httpStatus: response.status,
          responseJson: true,
          responseBytes,
        });
      }
      const providerRequestId = extractProviderRequestId(response, envelopeValue);
      const telemetry = extractTelemetry(envelopeValue);
      return { rawText, ...(providerRequestId ? { providerRequestId } : {}), ...(telemetry ? { telemetry } : {}) };
    } catch (error) {
      if (error instanceof CozeWorkflowError) throw error;
      if (controller.signal.aborted) throw new CozeWorkflowError("AI_TIMEOUT", "Provider request timed out");
      throw new CozeWorkflowError("PROVIDER_HTTP_ERROR", "Provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type RideInterpretationProviderErrorCodeV04Candidate = CozeWorkflowErrorCode;
