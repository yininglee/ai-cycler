import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  projectRideAnalysisContextForModel,
  RIDE_ANALYSIS_MODEL_CONTEXT_PROJECTION_VERSION,
} from "../src/ai/ride-analysis-context-projection.ts";
import type { RideAnalysisContext } from "../src/domain/ride-analysis-context.ts";

const inputDir = new URL("../output/coze-inputs/", import.meta.url);

function loadContexts(): Array<{ caseId: string; context: RideAnalysisContext }> {
  return readdirSync(inputDir)
    .filter((file) => /^t001-RA-AUTO-\d{3}\.json$/.test(file))
    .sort()
    .map((file) => {
      const input = JSON.parse(readFileSync(new URL(file, inputDir), "utf8")) as { analysis_context: string };
      const context = JSON.parse(input.analysis_context) as RideAnalysisContext;
      return { caseId: file.slice("t001-".length, -".json".length), context };
    });
}

test("model context projection keeps all evidence-bearing fields and removes duplicate domain payloads", () => {
  const contexts = loadContexts();
  assert.equal(contexts.length, 18);
  for (const { caseId, context } of contexts) {
    const projected = projectRideAnalysisContextForModel(context);
    assert.equal(projected.schemaVersion, context.schemaVersion, caseId);
    assert.equal(projected.rulesVersion, context.rulesVersion, caseId);
    assert.equal(projected.contextType, context.contextType, caseId);
    assert.equal(projected.rideId, context.rideId, caseId);
    assert.equal(projected.userScope, context.userScope, caseId);
    assert.deepEqual(projected.allowedClaims, context.allowedClaims, caseId);
    assert.deepEqual(projected.forbiddenClaims, context.forbiddenClaims, caseId);
    assert.deepEqual(projected.limitations, context.limitations, caseId);
    assert.deepEqual(projected.safetyFlags, context.safetyFlags, caseId);
    assert.deepEqual(projected.privacyFlags, context.privacyFlags, caseId);
    assert.equal("recordedMetrics" in projected, false, caseId);
    assert.equal("derivedMetrics" in projected, false, caseId);
    assert.equal("estimatedMetrics" in projected, false, caseId);
    assert.equal("featureSnapshot" in projected, false, caseId);
    assert.equal("capabilities" in projected, false, caseId);
    assert.equal("historicalComparison" in projected, false, caseId);
    assert.equal("profileFacts" in projected, false, caseId);
  }
});

test("model context projection reduces every frozen T001 input", () => {
  for (const { caseId, context } of loadContexts()) {
    const before = JSON.stringify(context);
    const after = JSON.stringify(projectRideAnalysisContextForModel(context));
    assert.ok(after.length < before.length, `${caseId}: projection did not reduce input`);
  }
});

test("projection version is explicit and independent from the domain context version", () => {
  assert.equal(RIDE_ANALYSIS_MODEL_CONTEXT_PROJECTION_VERSION, "ride-analysis-model-context-projection-v0.1");
});
