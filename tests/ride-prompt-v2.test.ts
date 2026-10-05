import assert from "node:assert/strict";
import test from "node:test";

import {
  RIDE_MODEL_INPUT_RULES_VERSION,
  RIDE_MODEL_INPUT_SCHEMA_VERSION,
  buildRideModelInputV2,
} from "../src/domain/ride-model-input-v2.ts";
import type { RideAnalysisEvidenceV2 } from "../src/domain/ride-analysis-evidence-v2.ts";
import { buildRideAnalysisEvidencePacketsV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import {
  attachRideKnowledgeEvidenceV2,
  type KnowledgeBaseEntryV2,
} from "../src/domain/ride-analysis-knowledge-v2.ts";
import { buildRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { RIDE_PROMPT_VERSION, buildRidePromptV2 } from "../src/ai/ride-prompt-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "../src/ai/ride-output-schema-v2.ts";

const START = "2026-10-05T06:00:00.000Z";
const RUN = "run-s6-01";
const SCOPE = "user-s6-01";

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

function knowledgeEntry(): KnowledgeBaseEntryV2 {
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
  };
}

function readyInput() {
  const snapshot = buildRideProfileHistoryV2(ride(), {});
  const packets = buildRideAnalysisEvidencePacketsV2(snapshot.capabilityClaims, {
    analysisRunId: RUN,
    userScope: SCOPE,
  });
  const context: RideAnalysisEvidenceV2 = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: [knowledgeEntry()],
    knowledgeBaseVersion: "kb-1",
    retrievedAt: START,
  });
  const result = buildRideModelInputV2(context, { analysisRunId: RUN, userScope: SCOPE });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error("unreachable");
  return result.input;
}

test("S6-01 builds a versioned prompt bound to the schema and output contract versions", () => {
  const input = readyInput();
  const prompt = buildRidePromptV2(input);
  assert.equal(prompt.promptVersion, RIDE_PROMPT_VERSION);
  assert.equal(prompt.outputSchemaVersion, RIDE_OUTPUT_SCHEMA_VERSION);
  assert.equal(prompt.inputSchemaVersion, RIDE_MODEL_INPUT_SCHEMA_VERSION);
  assert.equal(prompt.promptVersion, "ride-prompt-v2.1.0");
});

test("S6-01 prompt embeds the delivered input snapshot with claims and knowledge", () => {
  const input = readyInput();
  const { promptText } = buildRidePromptV2(input);
  const firstClaimId = input.questions[0].claims[0].claimId;
  assert.ok(promptText.includes(`"${firstClaimId}"`), "prompt must embed the serialized claim IDs");
  assert.ok(promptText.includes("kb-power-np"), "prompt must embed the knowledge ID");
  assert.ok(promptText.includes('"analysisRunId"'), "prompt must embed the versioned input JSON");
  assert.ok(promptText.includes(input.questions[0].dimensionId));
  assert.ok(promptText.includes(RIDE_MODEL_INPUT_RULES_VERSION) || promptText.includes(input.evidenceRulesVersion));
});

test("S6-01 prompt states the output contract, citation rules, and prohibitions", () => {
  const { promptText } = buildRidePromptV2(readyInput());
  for (const field of ['"label"', '"overallAssessment"', '"highlights"', '"dimensions"', '"historyComparison"', '"suggestions"', '"limitations"', '"conclusionType"', '"claimIds"', '"knowledgeIds"']) {
    assert.ok(promptText.includes(field), `prompt must describe output field ${field}`);
  }
  // Expression prohibitions from business rules section 15 / PRD FR-12.
  assert.ok(promptText.includes("只输出"));
  assert.ok(promptText.includes("稳定、平稳、保持良好"));
  assert.ok(promptText.includes("恢复良好"));
  assert.ok(promptText.includes("导致、造成"));
  assert.ok(promptText.includes("训练计划"));
  assert.ok(promptText.includes("进步、退步"));
});

test("S6-01 prompt construction is deterministic for the same input", () => {
  const input = readyInput();
  assert.equal(buildRidePromptV2(input).promptText, buildRidePromptV2(input).promptText);
});
