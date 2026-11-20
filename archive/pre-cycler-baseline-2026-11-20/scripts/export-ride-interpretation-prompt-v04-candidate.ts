import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";
const OUTPUT_PATH = resolve("output/ride-interpretation-v0.4-candidate/prompt-input-l3.json");

const fixture = getRideFixture("l3-power-preview");
const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
const context = buildRideAnalysisContext(record, { profile });
const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
const input = projectRideInterpretationInputV04Candidate(context, plan);
if (!input) throw new Error("l3-power-preview must create a candidate prompt input");

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify({ ride_interp_input: input }, null, 2)}\n`, "utf8");
console.log(`Exported candidate prompt input: ${OUTPUT_PATH}`);
