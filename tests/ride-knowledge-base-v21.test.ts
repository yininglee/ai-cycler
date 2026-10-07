import test from "node:test";
import assert from "node:assert/strict";
import { validateRideKnowledgeBaseV2 } from "../src/domain/ride-analysis-knowledge-v2.ts";
import { analysisDimensionIds } from "../src/domain/ride-analysis-evidence-v2.ts";
import {
  RIDE_KNOWLEDGE_BASE_V21_VERSION,
  rideKnowledgeBaseV21,
} from "../src/domain/ride-knowledge-base-v21.ts";

// V2.1 单次骑行解读的 7 个维度（前 7 个 analysisDimensionIds，历史/长期负荷维度不属单次解读）。
const singleRideDimensionIds = analysisDimensionIds.slice(0, 7);

test("V21 knowledge base passes the S3-02 knowledge contract with zero issues", () => {
  const issues = validateRideKnowledgeBaseV2(rideKnowledgeBaseV21);
  assert.deepEqual(issues, []);
});

test("V21 knowledge base has 7 entries, one per single-ride dimension (1:1 mapping)", () => {
  assert.equal(rideKnowledgeBaseV21.length, 7);
  const ids = rideKnowledgeBaseV21.map((entry) => entry.knowledgeId);
  assert.equal(new Set(ids).size, 7);
  const dimensions = rideKnowledgeBaseV21.map((entry) => entry.dimensionId);
  assert.deepEqual([...dimensions].sort(), [...singleRideDimensionIds].sort());
});

test("V21 knowledge ids follow the kb-v21-<dimensionId> convention", () => {
  for (const entry of rideKnowledgeBaseV21) {
    assert.equal(entry.knowledgeId, `kb-v21-${entry.dimensionId}`);
  }
});

test("V21 four-section structure: explanation carries benchmarks + science, signals carry good/bad", () => {
  for (const entry of rideKnowledgeBaseV21) {
    assert.ok(entry.explanation.length > 200, `${entry.knowledgeId} explanation too short`);
    assert.ok(entry.interpretationSignals.good.length > 0, `${entry.knowledgeId} missing good signals`);
    assert.ok(entry.interpretationSignals.bad.length > 0, `${entry.knowledgeId} missing bad signals`);
    assert.ok(entry.applicableDimensions.length === 1, `${entry.knowledgeId} must be single-dimension`);
    assert.equal(entry.applicableDimensions[0], entry.dimensionId);
  }
});

test("V21 knowledge never claims ride facts: every entry forbids its own fact keys", () => {
  for (const entry of rideKnowledgeBaseV21) {
    assert.ok(entry.forbiddenFactKeys.length > 0, `${entry.knowledgeId} must forbid fact keys`);
  }
});

test("V21 knowledge version is frozen and recorded", () => {
  assert.match(RIDE_KNOWLEDGE_BASE_V21_VERSION, /^ride-kb-2\.1\.0$/);
});
