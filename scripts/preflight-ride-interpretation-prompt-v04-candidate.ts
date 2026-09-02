import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { projectRideInterpretationInputV04Candidate, validateRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";
const prompt = readFileSync(new URL("../prompts/cycling-buddy-ride-interpretation-v0.4-candidate.md", import.meta.url), "utf8");
const fixture = getRideFixture("l3-power-preview");
const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
const context = buildRideAnalysisContext(record, { profile });
const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
const input = projectRideInterpretationInputV04Candidate(context, plan);
assert.ok(input);

assert.deepEqual(validateRideInterpretationInputV04Candidate(input), { valid: true, issues: [] });
assert.equal(JSON.stringify(input).includes("rawSamples"), false);
assert.equal(JSON.stringify(input).includes("sourceFileName"), false);
assert.equal(JSON.stringify(input).includes("latitude"), false);
assert.equal(input.dimensionInterpretations.some((unit) => unit.dimensionId === "history_change"), false);
for (const expected of ["自然语言", "整体评价", "重点维度", "highlights", "用户输入提示词"]) {
  assert.ok(prompt.includes(expected), `Prompt must contain: ${expected}`);
}
console.log(`PASS candidate-prompt-minimal-input (${input.candidateClaims.length} candidate claims)`);
console.log("PASS candidate-prompt-four-layer-contract");
console.log("Ride interpretation prompt preflight passed: 2 scenarios, no model calls.");
