import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationOutputV04CandidateFixture } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const OUTPUT_PATH = resolve("eval/ride-interpretation-v0.4-candidate/response-fixtures.json");
const NOW = "2026-09-01T00:00:00.000Z";

function inputFor(inputId: "full" | "partial") {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  if (inputId === "partial") record.series.points = record.series.points.filter((_, index) => index < 100 || index >= 125);
  const context = buildRideAnalysisContext(
    record,
    { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW) },
  );
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  if (!input) throw new Error(`Expected ${inputId} candidate input`);
  return input;
}

const full = buildRideInterpretationOutputV04CandidateFixture(inputFor("full"));
const partial = buildRideInterpretationOutputV04CandidateFixture(inputFor("partial"));
const unknownDimension = structuredClone(full);
unknownDimension.dimensions[0]!.dimensionId = "history_change" as typeof unknownDimension.dimensions[0]["dimensionId"];
const planDrift = structuredClone(full);
planDrift.oneLineLabel.claimIds = ["candidate:outside-plan"];
const unsupportedNumber = structuredClone(full);
unsupportedNumber.overallAssessment.text = "本次事实为 999。";
const longTermCapability = structuredClone(full);
longTermCapability.overallAssessment.text = "你具备较强的长期骑行能力。";

const fixtures = {
  schemaVersion: "ride-interpretation-response-fixtures-v0.1",
  description: "离线 v0.4 候选输出序列化 fixture；只验证 L8 接受/降级，不调用模型或生产 B0。",
  cases: [
    { id: "accepted-full", inputId: "full", output: full, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "accepted-partial-power", inputId: "partial", output: partial, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-schema-version", inputId: "full", output: { ...full, schemaVersion: "ride-interpretation-output-v0.3.2" }, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["INVALID_OUTPUT_SCHEMA_VERSION"] } },
    { id: "rejected-unknown-dimension", inputId: "full", output: unknownDimension, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["DIMENSION_PLAN_MISMATCH"] } },
    { id: "rejected-plan-claim", inputId: "full", output: planDrift, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["ONE_LINE_LABEL_CLAIM_INVALID"] } },
    { id: "rejected-unsupported-number", inputId: "full", output: unsupportedNumber, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_UNSUPPORTED_NUMBER"] } },
    { id: "rejected-long-term-capability", inputId: "full", output: longTermCapability, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_LONG_TERM_CAPABILITY_LANGUAGE"] } },
  ],
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Exported candidate response fixtures: ${OUTPUT_PATH}`);
