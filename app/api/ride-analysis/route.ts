import { buildRideAnalysisContext } from "../../../src/domain/ride-analysis-context.ts";
import { buildAnalysisEligibility } from "../../../src/domain/analysis-eligibility.ts";
import { buildRideInterpretationPlan } from "../../../src/ai/ride-interpretation-plan.ts";
import { projectRideInterpretationInputV04Candidate } from "../../../src/ai/ride-interpretation-input-v04-candidate.ts";
import { runRideInterpretationV04Candidate } from "../../../src/ai/ride-interpretation-service-v04-candidate.ts";
import { assembleRideInterpretationPresentationV04Candidate } from "../../../src/ai/ride-interpretation-presentation-v04-candidate.ts";
import { buildRideInterpretationPresentationViewModelV04Candidate } from "../../../src/ai/ride-interpretation-presentation-view-model-v04-candidate.ts";
import {
  readRideInterpretationCozeConfigV04Candidate,
  RideInterpretationCozeClientV04Candidate,
} from "../../../src/ai/ride-interpretation-coze-client-v04-candidate.ts";
import type { RideInterpretationOutputV04Candidate } from "../../../src/ai/ride-interpretation-output-v04-candidate.ts";
import { getRideRecord } from "../../../src/imports/demo-ride-store.ts";

export const runtime = "nodejs";

/**
 * Production ride interpretation entry migrated to the v0.4 candidate chain
 * (ride_analysis_v3 v0.0.11 / Prompt v0.4.14, including the FIX-018
 * deterministic action-language fallback). The response keeps the legacy
 * `/api/ride-analysis` contract so the existing client component renders
 * without structural changes; rollback = restore the previous route revision.
 */
export const RIDE_INTERPRETATION_ROUTE_VERSION = "ride-interpretation-route-v0.4-candidate" as const;
export const RIDE_INTERPRETATION_ROUTE_VERSION_MATRIX = {
  workflowName: "ride_analysis_v3",
  workflowVersion: "v0.0.11",
  promptVersion: "v0.4.14",
} as const;

const MAX_REQUEST_BYTES = 1_024;

const SAFETY_STOP_MESSAGE =
  "请优先确保人身安全；如有胸痛、呼吸困难、晕厥、意识异常或严重外伤，请立即联系当地急救或尽快就医。";

const DIMENSION_LABELS: Record<string, string> = {
  route_pacing: "沿途节奏",
  terrain_climb: "地形与爬坡",
  heart_rate: "心率负荷",
  power_output: "功率输出",
  cadence: "踩踏表现",
  pacing_stability: "节奏稳定性",
};

function noStoreJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return noStoreJson({ error: "REQUEST_TOO_LARGE" }, 413);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
      return noStoreJson({ error: "REQUEST_TOO_LARGE" }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return noStoreJson({ error: "INVALID_JSON" }, 400);
  }

  const rideId = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).rideId
    : undefined;
  if (typeof rideId !== "string") {
    return noStoreJson({ error: "UNKNOWN_RIDE" }, 400);
  }
  // L6 plan runs in expanded mode (all eligible dimensions) on every call —
  // the drawer decides how many to *display* (top 3 by default, all when
  // expanded). Running expanded once keeps a single Provider call per open /
  // refresh, regardless of which view the user toggles. The legacy "mode"
  // body field is accepted but ignored for backward compatibility.
  const record = getRideRecord(rideId);
  if (!record) return noStoreJson({ error: "UNKNOWN_RIDE" }, 400);

  const context = buildRideAnalysisContext(record);
  const eligibility = buildAnalysisEligibility(context);

  const versions = { route: RIDE_INTERPRETATION_ROUTE_VERSION, ...RIDE_INTERPRETATION_ROUTE_VERSION_MATRIX };

  if (eligibility.fallback === "safety_stop") {
    return noStoreJson({
      rideId,
      source: "safety_stop",
      output: null,
      fallbackCode: "SAFETY_STOP",
      versions,
    });
  }

  const plan = buildRideInterpretationPlan(context, eligibility, "expanded");
  const input = plan.candidate ? projectRideInterpretationInputV04Candidate(context, plan) : undefined;
  if (!input) {
    return noStoreJson({ rideId, source: "b0", output: null, fallbackCode: "DATA_NOT_ELIGIBLE", versions });
  }

  if (process.env.AI_ANALYSIS_ENABLED !== "true") {
    return noStoreJson({ rideId, source: "b0", output: null, fallbackCode: "AI_DISABLED", versions });
  }

  const config = readRideInterpretationCozeConfigV04Candidate(process.env);
  const provider = config ? new RideInterpretationCozeClientV04Candidate(config) : undefined;
  const result = await runRideInterpretationV04Candidate(input, provider);

  if (result.source === "b0") {
    return noStoreJson({
      rideId,
      source: "b0",
      output: null,
      fallbackCode: result.fallbackCode,
      attempts: result.attempts,
      validationIssues: result.validationIssues,
      versions,
    });
  }

  const presentation = assembleRideInterpretationPresentationV04Candidate(result.output, input);
  const viewModel = buildRideInterpretationPresentationViewModelV04Candidate(record, presentation, {
    mode: "expanded",
    eligibleDimensionIds: plan.eligibleDimensionIds,
  });

  return noStoreJson({
    rideId,
    source: "b2",
    output: null,
    v04Candidate: {
      output: result.output,
      presentation,
      viewModel,
    },
    attempts: result.attempts,
    validationIssues: result.validationIssues,
    versions,
  });
}
