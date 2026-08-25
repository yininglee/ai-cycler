import type { RideAnalysisContext } from "../domain/ride-analysis-context.ts";

export const RIDE_ANALYSIS_MODEL_CONTEXT_PROJECTION_VERSION = "ride-analysis-model-context-projection-v0.1" as const;

/**
 * The model-facing context keeps only fields referenced by the Prompt contract.
 * The full domain context remains available to deterministic validation and B0.
 */
export interface RideAnalysisModelContext {
  schemaVersion: RideAnalysisContext["schemaVersion"];
  rulesVersion: RideAnalysisContext["rulesVersion"];
  contextType: RideAnalysisContext["contextType"];
  rideId: string;
  userScope: string;
  allowedClaims: RideAnalysisContext["allowedClaims"];
  forbiddenClaims: string[];
  limitations: string[];
  safetyFlags: string[];
  privacyFlags: string[];
}

export function projectRideAnalysisContextForModel(
  context: RideAnalysisContext,
): RideAnalysisModelContext {
  return {
    schemaVersion: context.schemaVersion,
    rulesVersion: context.rulesVersion,
    contextType: context.contextType,
    rideId: context.rideId,
    userScope: context.userScope,
    allowedClaims: context.allowedClaims.map((claim) => ({
      ...claim,
      evidenceIds: [...claim.evidenceIds],
    })),
    forbiddenClaims: [...context.forbiddenClaims],
    limitations: [...context.limitations],
    safetyFlags: [...context.safetyFlags],
    privacyFlags: [...context.privacyFlags],
  };
}
