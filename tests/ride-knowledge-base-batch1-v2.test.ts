import test from "node:test";
import assert from "node:assert/strict";
import { validateRideKnowledgeBaseV2 } from "../src/domain/ride-analysis-knowledge-v2.ts";
import {
  RIDE_KNOWLEDGE_BASE_BATCH1_VERSION,
  rideKnowledgeBaseBatch1V2,
} from "../src/domain/ride-knowledge-base-batch1-v2.ts";

test("KB-01 batch1 passes the S3-02 knowledge contract with zero issues", () => {
  const issues = validateRideKnowledgeBaseV2(rideKnowledgeBaseBatch1V2);
  assert.deepEqual(issues, []);
});

test("KB-01 batch1 has 8 entries with unique ids across 5 themes", () => {
  assert.equal(rideKnowledgeBaseBatch1V2.length, 8);
  const ids = rideKnowledgeBaseBatch1V2.map((entry) => entry.knowledgeId);
  assert.equal(new Set(ids).size, 8);
  const themes = [
    "kb-b1-tss",
    "kb-b1-ftp",
    "kb-b1-power-zones",
    "kb-b1-pmc",
    "kb-b1-load-fitness-fatigue",
    "kb-b1-recovery",
    "kb-b1-hr-drift",
    "kb-b1-overtraining",
  ];
  assert.deepEqual([...ids].sort(), [...themes].sort());
});

test("KB-01 batch1 metric definitions anchor to the TP glossary baseline (single-definition rule)", () => {
  const tss = rideKnowledgeBaseBatch1V2.find((entry) => entry.knowledgeId === "kb-b1-tss");
  assert.equal(tss?.publisher, "TrainingPeaks");
  const ftp = rideKnowledgeBaseBatch1V2.find((entry) => entry.knowledgeId === "kb-b1-ftp");
  assert.equal(ftp?.publisher, "TrainingPeaks");
});

test("KB-01 batch1 medical-adjacent entries carry safety boundaries", () => {
  const recovery = rideKnowledgeBaseBatch1V2.find((entry) => entry.knowledgeId === "kb-b1-recovery");
  assert.ok(recovery && recovery.safetyBoundaries.length > 0);
  const overtraining = rideKnowledgeBaseBatch1V2.find((entry) => entry.knowledgeId === "kb-b1-overtraining");
  assert.ok(overtraining && overtraining.safetyBoundaries.length > 0);
});

test("KB-01 batch1 knowledge never claims ride facts: every entry forbids its own fact keys", () => {
  for (const entry of rideKnowledgeBaseBatch1V2) {
    assert.ok(entry.forbiddenFactKeys.length > 0, `${entry.knowledgeId} must forbid fact keys`);
    // Explanations must state that user values come from ride records (fact/knowledge isolation).
    assert.ok(entry.explanation.length > 40, `${entry.knowledgeId} explanation too short`);
  }
});

test("KB-01 batch1 version is frozen and recorded", () => {
  assert.match(RIDE_KNOWLEDGE_BASE_BATCH1_VERSION, /^ride-kb-batch1-1\.0\.0$/);
});
