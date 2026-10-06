import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RIDE_MODEL_INPUT_MAX_CHARACTERS,
  RIDE_MODEL_INPUT_RULES_VERSION,
  RIDE_MODEL_INPUT_SCHEMA_VERSION,
  buildRideModelInputV2,
  getRideModelInputQuestionV2,
} from "../src/domain/ride-model-input-v2.ts";
import {
  RIDE_EVIDENCE_RULES_VERSION,
  RIDE_EVIDENCE_SCHEMA_VERSION,
  evidenceCapabilityKeys,
  type RideAnalysisEvidenceV2,
} from "../src/domain/ride-analysis-evidence-v2.ts";
import { buildRideAnalysisEvidencePacketsV2, getRideAnalysisEvidencePacketV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import {
  attachRideKnowledgeEvidenceV2,
  type KnowledgeBaseEntryV2,
} from "../src/domain/ride-analysis-knowledge-v2.ts";
import { buildRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

const START = "2026-10-05T06:00:00.000Z";
const RUN = "run-s4-01";
const SCOPE = "user-s4-01";

function ride(): RideRecord {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  record.activity.rideId = "current";
  record.series.rideId = "current";
  record.activity.startTime = START;
  record.series.timeBasis = record.series.timeBasis.kind === "elapsed_from_start"
    ? { kind: "elapsed_from_start", startTime: START }
    : record.series.timeBasis;
  return record;
}

function knowledgeEntry(overrides: Partial<KnowledgeBaseEntryV2> = {}): KnowledgeBaseEntryV2 {
  return {
    knowledgeId: "kb-power-np",
    category: "cyclingSportsScience",
    topic: "normalized power interpretation",
    title: "Cycling Power Metrics Reference",
    publisher: "Example Sports Science Institute",
    sourceType: "review",
    version: "2026-03",
    citationLocation: "Section 4.2",
    applicableDimensions: ["powerOutput"],
    applicableConditions: ["applies to rides with a continuous power meter"],
    conclusionStrength: "moderate",
    limitations: ["population-level findings, not an individual diagnosis"],
    safetyBoundaries: ["do not output medical advice or recovery guarantees"],
    forbiddenFactKeys: ["power.mean", "power.np", "power.peak"],
    explanation: "Normalized power reflects load above average power when output is variable.",
    ...overrides,
  };
}

function context(knowledgeBase: KnowledgeBaseEntryV2[] = [knowledgeEntry()]): RideAnalysisEvidenceV2 {
  const snapshot = buildRideProfileHistoryV2(ride(), {});
  const packets = buildRideAnalysisEvidencePacketsV2(snapshot.capabilityClaims, {
    analysisRunId: RUN,
    userScope: SCOPE,
  });
  return attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase,
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
}

function emptyContext(): RideAnalysisEvidenceV2 {
  return {
    schemaVersion: RIDE_EVIDENCE_SCHEMA_VERSION,
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    rideId: "ride-empty",
    analysisRunId: RUN,
    userScope: SCOPE,
    sourceInventory: [],
    capabilities: evidenceCapabilityKeys.map((key) => ({
      key,
      status: "unavailable" as const,
      qualityStatus: "unavailable" as const,
      dependencyKeys: [],
      sourceIds: [],
      evidenceIds: [],
      rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
      supports: [],
      prohibits: [],
      unavailableReason: "NOT_PROVIDED",
    })),
    allowedClaims: [],
    knowledgeEvidence: [],
    evidencePackets: [],
    privacyFlags: [
      "raw_track_excluded", "precise_coordinates_excluded",
      "source_filename_excluded", "untrusted_free_text_excluded",
    ],
  };
}

test("S4-01 assembles every packet claim into a versioned model input", () => {
  const attached = context();
  const result = buildRideModelInputV2(attached, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  const { input } = result;
  assert.equal(input.schemaVersion, RIDE_MODEL_INPUT_SCHEMA_VERSION);
  assert.equal(input.rulesVersion, RIDE_MODEL_INPUT_RULES_VERSION);
  assert.equal(input.evidenceRulesVersion, attached.rulesVersion);
  assert.equal(input.rideId, attached.rideId);
  assert.equal(input.analysisRunId, RUN);
  assert.equal(input.userScope, SCOPE);
  assert.deepEqual(input.privacyFlags, attached.privacyFlags);

  assert.equal(input.questions.length, attached.evidencePackets.length);
  const uniqueClaimIds = new Set<string>();
  for (const packet of attached.evidencePackets) {
    const question = getRideModelInputQuestionV2(input, packet.dimensionId);
    assert.ok(question, `missing question for ${packet.dimensionId}`);
    assert.equal(question.question, packet.question);
    assert.equal(question.eligibility, packet.eligibility);
    assert.equal(question.qualityStatus, packet.qualityStatus);
    assert.deepEqual(question.claimIds, packet.claimIds);
    assert.deepEqual(question.limitations, packet.limitations);
    assert.deepEqual(question.supports, packet.supports);
    assert.deepEqual(question.prohibits, packet.prohibits);
    assert.deepEqual(question.recommendationAnchorClaimIds, packet.recommendationAnchorClaimIds);
    for (const claimId of packet.claimIds) uniqueClaimIds.add(claimId);
  }
  // S2-06: claims are serialized once at the top level; every packet claim is
  // resolvable there and no id is duplicated in the unique list.
  assert.equal(input.claims.length, uniqueClaimIds.size);
  assert.equal(new Set(input.claims.map((claim) => claim.claimId)).size, input.claims.length);
  for (const claim of input.claims) {
    const original = attached.allowedClaims.find((item) => item.claimId === claim.claimId);
    assert.ok(original);
    assert.deepEqual(claim, original);
  }
  assert.equal(input.inputStats.claimCount, uniqueClaimIds.size);
  assert.ok(input.inputStats.totalCharacters > 0);
  assert.ok(input.inputStats.totalCharacters <= DEFAULT_RIDE_MODEL_INPUT_MAX_CHARACTERS);
  assert.equal(input.inputStats.maxInputCharacters, DEFAULT_RIDE_MODEL_INPUT_MAX_CHARACTERS);
});

test("S2-06 serializes a fanned-out claim once and references it by id from every packet", () => {
  // Real fan-out shape: the same power facts feed several dimensions (e.g.
  // powerOutput and intensityAndTrainingLoad). The committed fixture only
  // emits the powerOutput packet, so a second packet is derived from it —
  // same claimIds, another dimension — which is exactly what the production
  // packet builder emits when one claim supports multiple dimensions.
  const attached = context();
  const powerPacket = attached.evidencePackets.find((packet) => packet.dimensionId === "powerOutput");
  assert.ok(powerPacket, "test setup: fixture must produce the powerOutput packet");
  attached.evidencePackets.push({
    ...structuredClone(powerPacket),
    dimensionId: "intensityAndTrainingLoad",
    question: "What intensity and single-ride training-load facts are supported?",
    knowledgeIds: [],
  });

  const result = buildRideModelInputV2(attached, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const modelInput = result.input;

  const serialized = JSON.stringify(modelInput);
  const power = getRideModelInputQuestionV2(modelInput, "powerOutput");
  const intensity = getRideModelInputQuestionV2(modelInput, "intensityAndTrainingLoad");
  assert.ok(power && intensity);
  for (const claimId of power.claimIds) {
    // Exactly one serialized copy in the top-level claim list; both questions
    // reference the id without re-serializing the claim object.
    const occurrences = serialized.split(`"claimId":"${claimId}"`).length - 1;
    assert.equal(occurrences, 1, `fanned-out claim ${claimId} must be serialized exactly once`);
    assert.ok(intensity.claimIds.includes(claimId), `intensityAndTrainingLoad must reference ${claimId}`);
  }
  assert.equal(modelInput.claims.length, new Set(power.claimIds).size);
  assert.equal(modelInput.inputStats.claimCount, modelInput.claims.length);
});

test("S4-01 keeps knowledge layered beside facts with citation and safety boundaries", () => {
  const attached = context();
  const result = buildRideModelInputV2(attached, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  const power = getRideModelInputQuestionV2(result.input, "powerOutput");
  const packet = getRideAnalysisEvidencePacketV2(attached, "powerOutput");
  assert.ok(power && packet);
  assert.deepEqual(power.knowledgeIds, packet.knowledgeIds);
  assert.equal(power.knowledgeIds.length, 1);
  const knowledge = result.input.knowledge.find((item) => item.knowledgeId === "kb-power-np");
  assert.ok(knowledge);
  assert.ok(knowledge.citation.includes("Cycling Power Metrics Reference"));
  assert.ok(knowledge.citation.includes("Example Sports Science Institute"));
  assert.ok(knowledge.conditions.includes("strength:moderate"));
  assert.ok(knowledge.conditions.includes("do not output medical advice or recovery guarantees"));
  assert.deepEqual(knowledge.forbiddenFactKeys, ["power.mean", "power.np", "power.peak"]);
  assert.equal(knowledge.knowledgeBaseVersion, "kb-1");
  assert.equal(knowledge.retrievedAt, START);
  // PMC-01 follow-up: the self-written explanation travels with the citation
  // contract so knowledge transcription can only quote this text.
  assert.equal(knowledge.explanation, "Normalized power reflects load above average power when output is variable.");
  // Knowledge stays outside the claim list: it must never appear as a ride fact.
  assert.equal(result.input.claims.some((claim) => claim.claimId === "kb-power-np"), false);
  assert.equal(result.input.inputStats.knowledgeCount, 1);

  // Without applicable knowledge no citation is fabricated.
  const bare = buildRideModelInputV2(context([]), { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(bare.status, "ready");
  if (bare.status !== "ready") return;
  for (const question of bare.input.questions) assert.deepEqual(question.knowledgeIds, []);
  assert.deepEqual(bare.input.knowledge, []);
  assert.equal(bare.input.inputStats.knowledgeCount, 0);
});

test("S4-01 blocks the model call when run or user scope does not match the evidence context", () => {
  const attached = context();
  const wrongRun = buildRideModelInputV2(attached, { analysisRunId: "run-other", userScope: SCOPE });
  assert.equal(wrongRun.status, "blocked");
  assert.equal(wrongRun.status === "blocked" ? wrongRun.failureCode : "", "RUN_SCOPE_MISMATCH");
  const wrongScope = buildRideModelInputV2(attached, { analysisRunId: RUN, userScope: "user-other" });
  assert.equal(wrongScope.status === "blocked" ? wrongScope.failureCode : "", "RUN_SCOPE_MISMATCH");
  const blank = buildRideModelInputV2(attached, { analysisRunId: " ", userScope: SCOPE });
  assert.equal(blank.status === "blocked" ? blank.failureCode : "", "OPTIONS_INVALID");
});

test("S4-01 blocks invalid or privacy-violating evidence contexts without trimming", () => {
  const attached = context();

  const privacyStripped = { ...attached, privacyFlags: attached.privacyFlags.slice(0, 2) };
  const missingFlags = buildRideModelInputV2(privacyStripped, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(missingFlags.status === "blocked" ? missingFlags.failureCode : "", "EVIDENCE_CONTEXT_INVALID");

  const withPrivateField = structuredClone(attached);
  (withPrivateField.allowedClaims[0] as unknown as Record<string, unknown>).filename = "ride.fit";
  const privateField = buildRideModelInputV2(withPrivateField, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(privateField.status === "blocked" ? privateField.failureCode : "", "EVIDENCE_CONTEXT_INVALID");
  assert.match(privateField.status === "blocked" ? privateField.reason : "", /PRIVATE_FIELD_PRESENT/);

  const tamperedClaim = structuredClone(attached);
  tamperedClaim.allowedClaims[0].rideId = "another-ride";
  const tampered = buildRideModelInputV2(tamperedClaim, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(tampered.status === "blocked" ? tampered.failureCode : "", "EVIDENCE_CONTEXT_INVALID");
});

test("S4-01 reports budget overflow with undeliverable questions instead of trimming claims", () => {
  const attached = context();
  const result = buildRideModelInputV2(attached, { analysisRunId: RUN, userScope: SCOPE, maxInputCharacters: 10 });
  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  assert.equal(result.failureCode, "INPUT_BUDGET_EXCEEDED");
  assert.match(result.reason, /no claim is trimmed/);
  assert.equal(result.undeliverableDimensions?.length, attached.evidencePackets.length);
  const dimensionIds = result.undeliverableDimensions?.map((item) => item.dimensionId) ?? [];
  for (const packet of attached.evidencePackets) assert.ok(dimensionIds.includes(packet.dimensionId));
  for (const item of result.undeliverableDimensions ?? []) assert.ok(item.characters > 0);

  // A budget between the minimum question size and the full input still blocks:
  // partial delivery with removed claims must never happen.
  const sizes = result.undeliverableDimensions ?? [];
  const middleBudget = sizes[sizes.length - 1].characters + 1;
  const partial = buildRideModelInputV2(attached, { analysisRunId: RUN, userScope: SCOPE, maxInputCharacters: middleBudget });
  assert.equal(partial.status === "blocked" ? partial.failureCode : "", "INPUT_BUDGET_EXCEEDED");
});

test("S4-01 blocks assembly when no analysis question has a qualified packet", () => {
  const result = buildRideModelInputV2(emptyContext(), { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(result.status, "blocked");
  assert.equal(result.status === "blocked" ? result.failureCode : "", "NO_DELIVERABLE_QUESTIONS");
});
