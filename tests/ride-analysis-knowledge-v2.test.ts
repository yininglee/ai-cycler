import assert from "node:assert/strict";
import test from "node:test";

import { validateRideAnalysisEvidenceV2 } from "../src/domain/ride-analysis-evidence-v2.ts";
import { buildRideAnalysisEvidencePacketsV2, getRideAnalysisEvidencePacketV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import {
  attachRideKnowledgeEvidenceV2,
  validateRideKnowledgeBaseV2,
  type KnowledgeBaseEntryV2,
} from "../src/domain/ride-analysis-knowledge-v2.ts";
import { buildRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

const START = "2026-10-05T06:00:00.000Z";

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

function baseContext() {
  const snapshot = buildRideProfileHistoryV2(ride(), {});
  return buildRideAnalysisEvidencePacketsV2(snapshot.capabilityClaims, {
    analysisRunId: "run-s3-02",
    userScope: "user-s3-02",
  });
}

function entry(overrides: Partial<KnowledgeBaseEntryV2> = {}): KnowledgeBaseEntryV2 {
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
    safetyBoundaries: [],
    forbiddenFactKeys: ["power.mean", "power.np", "power.peak"],
    explanation: "Normalized power reflects load above average power when output is variable.",
    ...overrides,
  };
}

test("S3-02 leaves knowledge unavailable and fabricates no citation when nothing applies", () => {
  const context = baseContext();
  const attached = attachRideKnowledgeEvidenceV2(context, { knowledgeBase: [], knowledgeBaseVersion: "kb-1", retrievedAt: START });
  assert.equal(attached.knowledgeEvidence.length, 0);
  const capability = attached.capabilities.find((item) => item.key === "knowledgeEvidence");
  assert.equal(capability?.status, "unavailable");
  assert.equal(capability?.unavailableReason, "NO_APPLICABLE_KNOWLEDGE");
  assert.equal(attached.sourceInventory.some((source) => source.kind === "knowledge"), false);
  for (const packet of attached.evidencePackets) assert.deepEqual(packet.knowledgeIds, []);
  assert.equal(validateRideAnalysisEvidenceV2(attached).length, 0);
});

test("S3-02 does not open a dimension that has no qualified packet", () => {
  const context = baseContext();
  assert.equal(getRideAnalysisEvidencePacketV2(context, "historicalPerformance"), undefined);
  const attached = attachRideKnowledgeEvidenceV2(context, {
    knowledgeBase: [entry({ knowledgeId: "kb-history", applicableDimensions: ["historicalPerformance"] })],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  assert.equal(attached.knowledgeEvidence.length, 0);
  assert.equal(attached.evidencePackets.some((packet) => packet.dimensionId === "historicalPerformance"), false);
  assert.equal(attached.capabilities.find((item) => item.key === "knowledgeEvidence")?.unavailableReason, "NO_APPLICABLE_KNOWLEDGE");
});

test("S3-02 attaches applicable knowledge with a full citation and traceable metadata", () => {
  const context = baseContext();
  const attached = attachRideKnowledgeEvidenceV2(context, {
    knowledgeBase: [entry()],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  assert.equal(attached.knowledgeEvidence.length, 1);
  const knowledge = attached.knowledgeEvidence[0];
  assert.equal(knowledge.knowledgeId, "kb-power-np");
  assert.ok(knowledge.citation.includes("Cycling Power Metrics Reference"));
  assert.ok(knowledge.citation.includes("Example Sports Science Institute"));
  assert.ok(knowledge.citation.includes("2026-03"));
  assert.ok(knowledge.citation.includes("Section 4.2"));
  assert.equal(knowledge.sourceRef.sourceId, "knowledge:kb-power-np");
  assert.equal(knowledge.sourceRef.version, "2026-03");
  assert.deepEqual(knowledge.applicableDimensions, ["powerOutput"]);
  assert.ok(knowledge.conditions.includes("applies to rides with a continuous power meter"));
  assert.ok(knowledge.conditions.includes("strength:moderate"));
  assert.equal(knowledge.retrievedAt, START);
  assert.equal(knowledge.knowledgeBaseVersion, "kb-1");
  assert.deepEqual(knowledge.forbiddenFactKeys, ["power.mean", "power.np", "power.peak"]);
  const source = attached.sourceInventory.find((item) => item.sourceId === "knowledge:kb-power-np");
  assert.equal(source?.kind, "knowledge");
  assert.equal(source?.status, "available");
  assert.equal(source?.authorized, true);
  const capability = attached.capabilities.find((item) => item.key === "knowledgeEvidence");
  assert.equal(capability?.status, "available");
  assert.deepEqual(capability?.evidenceIds, ["kb-power-np"]);
  assert.deepEqual(getRideAnalysisEvidencePacketV2(attached, "powerOutput")?.knowledgeIds, ["kb-power-np"]);
  assert.equal(validateRideAnalysisEvidenceV2(attached).length, 0);
});

test("S3-02 keeps only packet-covered dimensions when an entry spans available and unavailable dimensions", () => {
  const context = baseContext();
  const attached = attachRideKnowledgeEvidenceV2(context, {
    knowledgeBase: [entry({ applicableDimensions: ["powerOutput", "historicalPerformance"] })],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  assert.deepEqual(attached.knowledgeEvidence[0].applicableDimensions, ["powerOutput"]);
  assert.deepEqual(getRideAnalysisEvidencePacketV2(attached, "powerOutput")?.knowledgeIds, ["kb-power-np"]);
});

test("S3-02 keeps multiple applicable entries side by side without duplication", () => {
  const context = baseContext();
  const attached = attachRideKnowledgeEvidenceV2(context, {
    knowledgeBase: [
      entry(),
      entry({
        knowledgeId: "kb-power-standard",
        category: "cyclingDataStandard",
        title: "Power Data Recording Standard",
        publisher: "Example Standards Body",
        sourceType: "standard",
        version: "ISO-EXAMPLE-1",
        citationLocation: "Clause 6",
        applicableConditions: ["applies to power-meter equipped rides"],
      }),
    ],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  assert.equal(attached.knowledgeEvidence.length, 2);
  const knowledgeIds = getRideAnalysisEvidencePacketV2(attached, "powerOutput")?.knowledgeIds ?? [];
  assert.deepEqual(knowledgeIds, ["kb-power-np", "kb-power-standard"]);
  assert.equal(attached.sourceInventory.filter((source) => source.kind === "knowledge").length, 2);
});

test("S3-02 carries safety boundaries as usage conditions", () => {
  const context = baseContext();
  const attached = attachRideKnowledgeEvidenceV2(context, {
    knowledgeBase: [entry({ safetyBoundaries: ["do not output medical advice or recovery guarantees"] })],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  assert.ok(attached.knowledgeEvidence[0].conditions.includes("do not output medical advice or recovery guarantees"));
  assert.deepEqual(attached.knowledgeEvidence[0].safetyBoundaries, ["do not output medical advice or recovery guarantees"]);
});

test("S3-02 never adds, removes, or rewrites ride Claims", () => {
  const context = baseContext();
  const attached = attachRideKnowledgeEvidenceV2(context, {
    knowledgeBase: [entry()],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  assert.deepEqual(attached.allowedClaims.map((claim) => claim.claimId), context.allowedClaims.map((claim) => claim.claimId));
  const knowledge = attached.knowledgeEvidence[0];
  assert.equal(knowledge.forbiddenFactKeys?.includes("power.mean"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(knowledge, "value"), false);
});

test("S3-02 rejects malformed knowledge base entries before attaching", () => {
  const issues = validateRideKnowledgeBaseV2([
    entry(),
    entry({ knowledgeId: "kb-power-np", title: " " }),
  ]);
  assert.ok(issues.some((issue) => issue.code === "DUPLICATE_KNOWLEDGE_ID"));
  const blank = validateRideKnowledgeBaseV2([entry({ publisher: "" })]);
  assert.ok(blank.some((issue) => issue.code === "KNOWLEDGE_FIELDS_INVALID"));
  const badDimension = validateRideKnowledgeBaseV2([entry({ applicableDimensions: ["unknownDimension" as KnowledgeBaseEntryV2["applicableDimensions"][number]] })]);
  assert.ok(badDimension.some((issue) => issue.code === "KNOWLEDGE_DIMENSION_INVALID"));
  const noConditions = validateRideKnowledgeBaseV2([entry({ applicableConditions: [] })]);
  assert.ok(noConditions.some((issue) => issue.code === "KNOWLEDGE_CONDITIONS_MISSING"));
  const noForbiddenKeys = validateRideKnowledgeBaseV2([entry({ forbiddenFactKeys: [] })]);
  assert.ok(noForbiddenKeys.some((issue) => issue.code === "KNOWLEDGE_FORBIDDEN_FACT_KEYS_MISSING"));

  const context = baseContext();
  assert.throws(
    () => attachRideKnowledgeEvidenceV2(context, { knowledgeBase: [entry({ limitations: [] })], knowledgeBaseVersion: "kb-1", retrievedAt: START }),
    /KNOWLEDGE_LIMITATIONS_MISSING/,
  );
  assert.throws(
    () => attachRideKnowledgeEvidenceV2(context, { knowledgeBase: [entry()], knowledgeBaseVersion: " ", retrievedAt: START }),
    /requires knowledgeBaseVersion and retrievedAt/,
  );
});
