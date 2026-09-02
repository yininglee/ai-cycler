import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const ROOT = resolve(".");
const SCHEMA_PATH = resolve(ROOT, "coze/ride-interpretation-output-v04-candidate-schema.json");
const EXAMPLE_PATH = resolve(ROOT, "coze/ride-interpretation-output-v04-candidate-example.json");
const NOW = "2026-09-01T00:00:00.000Z";

const fixture = getRideFixture("l3-power-preview");
const context = buildRideAnalysisContext(
  { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
  { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW) },
);
const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
const input = projectRideInterpretationInputV04Candidate(context, plan);
if (!input) throw new Error("l3-power-preview must produce a candidate input");
const output = buildRideInterpretationOutputV04CandidateFixture(input);

mkdirSync(dirname(SCHEMA_PATH), { recursive: true });
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "ride-interpretation-output-v0.4.1-candidate",
  title: "AI 骑后解读 v0.4.1 候选输出（离线）",
  description: "自然语言整体评价、多维度评价、表现高光和下一步建议；仅用于离线合同审查，不替换生产合同。",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "oneLineLabel", "overallAssessment", "dimensions", "highlights", "limitations", "nextAction"],
  properties: {
    schemaVersion: { const: "ride-interpretation-output-v0.4.1-candidate" },
    oneLineLabel: { $ref: "#/$defs/label" },
    overallAssessment: { $ref: "#/$defs/narrative" },
    dimensions: { type: "array", maxItems: 6, items: { $ref: "#/$defs/dimension" } },
    highlights: { type: "array", maxItems: 3, items: { $ref: "#/$defs/narrative" } },
    limitations: { type: "array", items: { $ref: "#/$defs/limitation" } },
    nextAction: { oneOf: [{ type: "null" }, { $ref: "#/$defs/groundedAction" }, { $ref: "#/$defs/generalAction" }] },
  },
  $defs: {
    dimensionId: { enum: ["route_pacing", "terrain_climb", "heart_rate", "power_output", "cadence", "pacing_stability"] },
    claimIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    narrative: {
      type: "object", additionalProperties: false, required: ["text", "claimIds", "visualRefIds"],
      properties: { text: { type: "string", minLength: 1, maxLength: 500 }, claimIds: { $ref: "#/$defs/claimIds" }, visualRefIds: { $ref: "#/$defs/claimIds" } },
    },
    dimension: { allOf: [{ $ref: "#/$defs/narrative" }, { type: "object", required: ["dimensionId"], properties: { dimensionId: { $ref: "#/$defs/dimensionId" } } }] },
    label: { type: "object", additionalProperties: false, required: ["text", "claimIds"], properties: { text: { type: "string", minLength: 1, maxLength: 40 }, claimIds: { $ref: "#/$defs/claimIds", minItems: 1 } } },
    limitation: { type: "object", additionalProperties: false, required: ["dimensionId", "claimIds"], properties: { dimensionId: { $ref: "#/$defs/dimensionId" }, claimIds: { $ref: "#/$defs/claimIds", minItems: 1 } } },
    groundedAction: { type: "object", additionalProperties: false, required: ["kind", "text", "basisClaimIds"], properties: { kind: { const: "grounded" }, text: { type: "string", minLength: 1 }, basisClaimIds: { $ref: "#/$defs/claimIds", minItems: 1 } } },
    generalAction: { type: "object", additionalProperties: false, required: ["kind", "text", "basisClaimIds"], properties: { kind: { const: "general" }, text: { type: "string", minLength: 1 }, basisClaimIds: { type: "array", maxItems: 0, items: false } } },
  },
} as Record<string, unknown>;
writeFileSync(SCHEMA_PATH, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
writeFileSync(EXAMPLE_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Exported candidate output schema: ${SCHEMA_PATH}`);
console.log(`Exported candidate output example: ${EXAMPLE_PATH}`);
