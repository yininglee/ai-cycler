import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateRideInterpretationOutputV04Candidate } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const schema = JSON.parse(readFileSync(resolve("coze/ride-interpretation-output-v04-candidate-schema.json"), "utf8")) as {
  $schema?: string;
  $id?: string;
  required?: string[];
  properties?: Record<string, { const?: string }>;
  $defs?: Record<string, unknown>;
};
const example = JSON.parse(readFileSync(resolve("coze/ride-interpretation-output-v04-candidate-example.json"), "utf8"));

assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.$id, "ride-interpretation-output-v0.4.2-candidate");
assert.deepEqual(schema.properties?.schemaVersion, { const: "ride-interpretation-output-v0.4.2-candidate" });
for (const field of ["schemaVersion", "oneLineLabel", "overallAssessment", "dimensions", "highlights", "limitations", "nextAction"]) {
  assert.ok(schema.required?.includes(field), `schema required field missing: ${field}`);
}
assert.ok(schema.$defs?.narrative);
assert.deepEqual(schema.$defs?.dimension, {
  allOf: [
    { $ref: "#/$defs/narrative" },
    { type: "object", required: ["dimensionId"], properties: { dimensionId: { $ref: "#/$defs/dimensionId" } } },
  ],
});
assert.ok(schema.$defs?.groundedAction);
assert.ok(schema.$defs?.generalAction);
assert.ok(schema.$defs?.highlight);
assert.equal(example.schemaVersion, "ride-interpretation-output-v0.4.2-candidate");
assert.ok(Array.isArray(example.highlights));
assert.ok(example.highlights.every((highlight: { target?: { kind?: string } }) => highlight.target?.kind === "overall"));

const fixture = getRideFixture("l3-power-preview");
const context = buildRideAnalysisContext(
  { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
  { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z") },
);
const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
const input = projectRideInterpretationInputV04Candidate(context, plan);
assert.ok(input);
assert.deepEqual(validateRideInterpretationOutputV04Candidate(example, input), { valid: true, issues: [] });

const invalidVersion = { ...example, schemaVersion: "ride-interpretation-output-v0.3.2" };
assert.notEqual(invalidVersion.schemaVersion, schema.properties?.schemaVersion?.const);
console.log("PASS candidate-output-schema-metadata");
console.log("PASS candidate-output-example-contract");
console.log("PASS candidate-output-invalid-version-fixture");
console.log("Ride interpretation candidate output schema preflight passed: 3 checks, no model calls.");
