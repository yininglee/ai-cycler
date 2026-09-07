// CozeWorkflowError — extracted from the deprecated coze-workflow-client.ts
// (v2 producer of ride_analysis_v2, decommissioned 2026-09-07 along with the
// v2 output shape and COZE_WORKFLOW_* env vars). The v0.4 candidate service
// still classifies provider failures by error code / AI_TIMEOUT, so the
// class lives on as a stable shared type.
export type CozeWorkflowErrorCode =
  | "AI_TIMEOUT"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_REJECTED_REQUEST";

export interface CozeWorkflowErrorDetails {
  httpStatus?: number;
  businessCode?: number;
  responseJson?: boolean;
  responseBytes?: number;
}

export class CozeWorkflowError extends Error {
  readonly code: CozeWorkflowErrorCode;
  readonly details?: CozeWorkflowErrorDetails;

  constructor(code: CozeWorkflowErrorCode, message: string, details?: CozeWorkflowErrorDetails) {
    super(message);
    this.name = "CozeWorkflowError";
    this.code = code;
    this.details = details;
  }
}

// ServerEnvironment was previously exported from the v2 coze-workflow-client
// and is used by both v0.4 Coze clients to read process.env-shaped configs.
// Moved here in v2 deprecation batch 3.
export type ServerEnvironment = Readonly<Record<string, string | undefined>>;
