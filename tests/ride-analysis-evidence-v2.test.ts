import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_EVIDENCE_RULES_VERSION, RIDE_EVIDENCE_SCHEMA_VERSION,
  evidenceCapabilityKeys, validateRideAnalysisEvidenceV2,
  type RideAnalysisEvidenceV2,
} from "../src/domain/ride-analysis-evidence-v2.ts";

function sample(): RideAnalysisEvidenceV2 {
  const context: RideAnalysisEvidenceV2 = {
    schemaVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    rideId: "ride-1",
    analysisRunId: "run-1",
    userScope: "user-1",
    sourceInventory: [
      { sourceId: "activity-1", kind: "activity", version: "ride-record-v1", rideId: "ride-1", status: "available", authorized: true, evidenceIds: ["ev-average"] },
      { sourceId: "series-1", kind: "series", version: "series-v1", rideId: "ride-1", status: "available", authorized: true, evidenceIds: ["ev-variation"] },
      { sourceId: "knowledge-1", kind: "knowledge", version: "knowledge-v1", status: "available", authorized: true, evidenceIds: ["ev-citation"] },
    ],
    capabilities: evidenceCapabilityKeys.map((key) => ({
      key,
      status: key === "speed" ? "available" as const : "unavailable" as const,
      qualityStatus: key === "speed" ? "valid" as const : "unavailable" as const,
      dependencyKeys: [],
      sourceIds: key === "speed" ? ["activity-1"] : [],
      evidenceIds: key === "speed" ? ["ev-average"] : [],
      rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
      supports: key === "speed" ? ["speed_level"] : [],
      prohibits: [],
      ...(key === "speed" ? {} : { unavailableReason: "NOT_IMPLEMENTED" }),
    })),
    allowedClaims: [
      {
        claimId: "claim:ride-1:average", rideId: "ride-1", kind: "metric", key: "avgSpeedMps",
        value: 7, unit: "m/s", confidence: "high", provenance: "recorded", qualityStatus: "valid",
        sourceRefs: [{ sourceId: "activity-1", version: "ride-record-v1", evidenceIds: ["ev-average"] }],
        evidenceIds: ["ev-average"], supports: ["speed_level"], prohibits: ["speed_stability"],
      },
      {
        claimId: "claim:ride-1:variation", rideId: "ride-1", kind: "feature", key: "speedVariation",
        value: 0.2, unit: "ratio", confidence: "medium", provenance: "calculated", qualityStatus: "soft",
        formulaVersion: "speed-variation-v1",
        sourceRefs: [{ sourceId: "series-1", version: "series-v1", evidenceIds: ["ev-variation"] }],
        evidenceIds: ["ev-variation"], supports: ["speed_variation"], prohibits: [],
      },
    ],
    knowledgeEvidence: [{
      knowledgeId: "knowledge-speed", sourceRef: { sourceId: "knowledge-1", version: "knowledge-v1", evidenceIds: ["ev-citation"] },
      citation: "Example reference, section 1", explanation: "Speed variation reflects how evenly effort is distributed.",
      applicableDimensions: ["pacingExecution"], conditions: ["outdoor cycling"],
    }],
    evidencePackets: [{
      packetVersion: RIDE_EVIDENCE_SCHEMA_VERSION, rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
      rideId: "ride-1", dimensionId: "pacingExecution", question: "What happened to pacing?",
      eligibility: "partial", requiredEvidence: [{ capabilityKey: "speed", status: "fulfilled" }],
      optionalEvidence: [{ capabilityKey: "speedStability", status: "missing", reason: "NOT_IMPLEMENTED" }],
      claimIds: ["claim:ride-1:average", "claim:ride-1:variation"],
      claimGroups: { recorded: ["claim:ride-1:average"], calculated: ["claim:ride-1:variation"], estimated: [], history: [], relation: [], limitation: [] },
      qualityStatus: "soft", limitations: ["Stability not yet assessed"],
      supports: ["speed_level", "speed_variation"], prohibits: ["speed_stability"],
      knowledgeIds: ["knowledge-speed"], recommendationAnchorClaimIds: ["claim:ride-1:average"],
    }],
    privacyFlags: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded", "untrusted_free_text_excluded"],
  };
  return context;
}

function codes(value: RideAnalysisEvidenceV2): string[] {
  return validateRideAnalysisEvidenceV2(value).map((issue) => issue.code);
}

test("V2 packet retains all same-question claims while knowledge remains a separate citation", () => {
  const context = sample();
  assert.deepEqual(codes(context), []);
  assert.deepEqual(context.evidencePackets[0].claimIds, context.allowedClaims.map((claim) => claim.claimId));
  assert.equal(context.knowledgeEvidence[0].knowledgeId, context.evidencePackets[0].knowledgeIds[0]);
  assert.equal(JSON.stringify(context).includes('"points"'), false);
});

test("V2 rejects dropped, unknown, duplicate and incorrectly grouped claims", () => {
  const dropped = sample();
  dropped.evidencePackets[0].claimIds.pop();
  dropped.evidencePackets[0].claimGroups.calculated.pop();
  assert.ok(codes(dropped).includes("CLAIM_INDEX_MISMATCH"));

  const unknown = sample();
  unknown.evidencePackets[0].claimIds.push("claim:missing");
  assert.ok(codes(unknown).includes("PACKET_CLAIM_NOT_INDEXED"));

  const duplicate = sample();
  duplicate.allowedClaims.push(structuredClone(duplicate.allowedClaims[0]));
  assert.ok(codes(duplicate).includes("DUPLICATE_CLAIM"));

  const grouped = sample();
  grouped.evidencePackets[0].claimGroups.recorded.push("claim:ride-1:variation");
  assert.ok(codes(grouped).includes("CLAIM_GROUP_INVALID"));
});

test("V2 rejects missing or unauthorized evidence, stale versions and cross-ride facts", () => {
  const mismatched = sample();
  mismatched.allowedClaims[0].rideId = "another-ride";
  assert.ok(codes(mismatched).includes("CLAIM_RIDE_OR_ID_INVALID"));

  const stale = sample();
  stale.allowedClaims[0].sourceRefs[0].version = "old-version";
  assert.ok(codes(stale).includes("SOURCE_REF_INVALID"));

  const unauthorized = sample();
  unauthorized.sourceInventory[0].authorized = false;
  assert.ok(codes(unauthorized).includes("SOURCE_NOT_AUTHORIZED"));

  const missing = sample();
  missing.allowedClaims[0].evidenceIds = [];
  assert.ok(codes(missing).includes("CLAIM_EVIDENCE_INVALID"));

  const nonFinite = sample();
  nonFinite.allowedClaims[0].value = Number.NaN;
  assert.ok(codes(nonFinite).includes("NON_FINITE_CLAIM_VALUE"));
});

test("V2 blocks undeclared privacy boundaries and forbidden input fields", () => {
  const context = sample();
  context.privacyFlags.pop();
  (context as RideAnalysisEvidenceV2 & { coordinates: number[] }).coordinates = [30, 120];
  assert.ok(codes(context).includes("PRIVACY_FLAG_MISSING"));
  assert.ok(codes(context).includes("PRIVATE_FIELD_PRESENT"));
});

test("V2 unimplemented capability stays unavailable and cannot qualify a required question", () => {
  const context = sample();
  context.evidencePackets[0].requiredEvidence.push({ capabilityKey: "speedStability", status: "fulfilled" });
  assert.ok(codes(context).includes("PACKET_REQUIRED_EVIDENCE_MISSING"));
  context.capabilities.find((item) => item.key === "speedStability")!.status = "available";
  assert.ok(codes(context).includes("AVAILABLE_CAPABILITY_UNSUPPORTED"));
});

test("V2 rejects stale packet versions, unsupported conclusions and inapplicable knowledge", () => {
  const context = sample();
  context.evidencePackets[0].rulesVersion = "stale" as typeof RIDE_EVIDENCE_RULES_VERSION;
  context.evidencePackets[0].supports.push("recovered");
  context.knowledgeEvidence[0].applicableDimensions = ["climbPerformance"];
  assert.ok(codes(context).includes("PACKET_VERSION_MISMATCH"));
  assert.ok(codes(context).includes("PACKET_SUPPORT_UNBACKED"));
  assert.ok(codes(context).includes("PACKET_KNOWLEDGE_INVALID"));
});
