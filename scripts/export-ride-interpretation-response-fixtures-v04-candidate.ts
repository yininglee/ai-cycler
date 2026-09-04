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

const fullInput = inputFor("full");
const full = buildRideInterpretationOutputV04CandidateFixture(fullInput);
const partial = buildRideInterpretationOutputV04CandidateFixture(inputFor("partial"));
const unknownDimension = structuredClone(full);
unknownDimension.dimensions[0]!.dimensionId = "history_change" as typeof unknownDimension.dimensions[0]["dimensionId"];
const planDrift = structuredClone(full);
planDrift.oneLineLabel.claimIds = ["candidate:outside-plan"];
const unsupportedNumber = structuredClone(full);
unsupportedNumber.overallAssessment.text = "本次事实为 999。";
const traceableNumericLabel = structuredClone(full);
const labelFactCandidate = fullInput.overallAssessment.factClaimIds[0];
if (!labelFactCandidate) throw new Error("Expected a fact Claim for numeric label fixture");
const labelFactSourceId = fullInput.candidateClaims.find((claim) => claim.claimId === labelFactCandidate)?.sourceClaimIds[0];
const labelFactSource = fullInput.allowedClaims.find((claim) => claim.claimId === labelFactSourceId);
if (!labelFactSource?.displayValue || !labelFactSource.displayUnit) throw new Error("Expected a display value for numeric label fixture");
traceableNumericLabel.oneLineLabel = {
  text: `功率${labelFactSource.displayValue}${labelFactSource.displayUnit}`,
  claimIds: [labelFactCandidate],
};
const factOnlyEvaluationLabel = structuredClone(traceableNumericLabel);
factOnlyEvaluationLabel.oneLineLabel.text = "本次功率表现出色。";
const overlongLabel = structuredClone(full);
const distanceFactId = fullInput.candidateClaims.find((claim) => claim.dimensionId === "route_pacing" && claim.claimType === "fact")?.claimId;
if (!distanceFactId) throw new Error("Expected a distance fact Claim for length fixture");
overlongLabel.oneLineLabel.claimIds = [...overlongLabel.oneLineLabel.claimIds, distanceFactId];
overlongLabel.oneLineLabel.text = "45公里中长途稳定骑行表现";
const longTermCapability = structuredClone(full);
longTermCapability.overallAssessment.text = "你具备较强的长期骑行能力。";
const misplacedHighlight = structuredClone(full);
misplacedHighlight.highlights = [{
  text: "错误地使用了维度归属。",
  claimIds: [misplacedHighlight.dimensions[1]!.claimIds[0]!],
  visualRefIds: [],
  target: { kind: "dimension", dimensionId: misplacedHighlight.dimensions[0]!.dimensionId } as unknown as { kind: "overall" },
}];
const highlightClaimOutsideOverall = structuredClone(full);
highlightClaimOutsideOverall.highlights = [{
  text: "错误地引用整体评价以外的维度证据。",
  claimIds: [highlightClaimOutsideOverall.dimensions[1]!.claimIds[0]!],
  visualRefIds: [],
  target: { kind: "overall" },
}];
const highlightVisualOutsideOverall = structuredClone(full);
highlightVisualOutsideOverall.highlights = [{
  text: "错误地引用整体评价以外的图表。",
  claimIds: [highlightVisualOutsideOverall.overallAssessment.claimIds[0]!],
  visualRefIds: [highlightVisualOutsideOverall.dimensions[1]!.visualRefIds[0]!],
  target: { kind: "overall" },
}];
const highlightNumericUnsupported = structuredClone(full);
highlightNumericUnsupported.highlights = [{
  text: "本次值得回看的数值是999。",
  claimIds: [highlightNumericUnsupported.overallAssessment.claimIds[0]!],
  visualRefIds: [],
  target: { kind: "overall" },
}];
const overallClaimIds = new Set(full.overallAssessment.claimIds);
const highlightOnlyCandidate = fullInput.candidateClaims.find((candidate) => {
  if (overallClaimIds.has(candidate.claimId)) return false;
  return candidate.sourceClaimIds.some((sourceClaimId) => {
    const source = fullInput.allowedClaims.find((claim) => claim.claimId === sourceClaimId);
    return source?.displayValue !== undefined || source?.value !== undefined;
  });
});
if (!highlightOnlyCandidate) throw new Error("Expected a numeric Candidate Claim outside the overall assessment for fixture");
const highlightOnlySource = highlightOnlyCandidate.sourceClaimIds
  .map((sourceClaimId) => fullInput.allowedClaims.find((claim) => claim.claimId === sourceClaimId))
  .find((source): source is NonNullable<typeof source> => Boolean(source?.displayValue !== undefined || source?.value !== undefined));
if (!highlightOnlySource) throw new Error("Expected a numeric source Claim for outside-overall fixture");
const highlightNumber = highlightOnlySource.displayValue ?? String(highlightOnlySource.value);
const highlightNumericClaimOutsideOverall = structuredClone(full);
highlightNumericClaimOutsideOverall.highlights = [{
  text: `本次值得回看的数值是${highlightNumber}。`,
  claimIds: [highlightOnlyCandidate.claimId],
  visualRefIds: [],
  target: { kind: "overall" },
}];
const highlightNumericTraceable = structuredClone(full);
const numericOverallCandidate = fullInput.candidateClaims.find((candidate) => {
  if (!overallClaimIds.has(candidate.claimId)) return false;
  return candidate.sourceClaimIds.some((sourceClaimId) => {
    const source = fullInput.allowedClaims.find((claim) => claim.claimId === sourceClaimId);
    return source?.displayValue !== undefined || source?.value !== undefined;
  });
});
if (!numericOverallCandidate) throw new Error("Expected a numeric Candidate Claim inside the overall assessment for fixture");
const numericOverallSource = numericOverallCandidate.sourceClaimIds
  .map((sourceClaimId) => fullInput.allowedClaims.find((claim) => claim.claimId === sourceClaimId))
  .find((source): source is NonNullable<typeof source> => Boolean(source?.displayValue !== undefined || source?.value !== undefined));
if (!numericOverallSource) throw new Error("Expected a numeric source Claim for traceable highlight fixture");
const numericOverallValue = numericOverallSource.displayValue ?? String(numericOverallSource.value);
highlightNumericTraceable.highlights = [{
  text: `本次值得回看的数值是${numericOverallValue}。`,
  claimIds: [numericOverallCandidate.claimId],
  visualRefIds: [],
  target: { kind: "overall" },
}];

const fixtures = {
  schemaVersion: "ride-interpretation-response-fixtures-v0.1",
  description: "离线 v0.4 候选输出序列化 fixture；只验证 L8 接受/降级，不调用模型或生产 B0。",
  cases: [
    { id: "accepted-full", inputId: "full", output: full, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "accepted-partial-power", inputId: "partial", output: partial, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-schema-version", inputId: "full", output: { ...full, schemaVersion: "ride-interpretation-output-v0.3.2" }, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["INVALID_OUTPUT_SCHEMA_VERSION"] } },
    { id: "rejected-unknown-dimension", inputId: "full", output: unknownDimension, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["DIMENSION_PLAN_MISMATCH"] } },
    { id: "rejected-plan-claim", inputId: "full", output: planDrift, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["ONE_LINE_LABEL_CLAIM_INVALID"] } },
    { id: "accepted-traceable-numeric-label", inputId: "full", output: traceableNumericLabel, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-fact-only-evaluation-label", inputId: "full", output: factOnlyEvaluationLabel, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["ONE_LINE_LABEL_EVALUATION_WITHOUT_PERFORMANCE_EVIDENCE"] } },
    { id: "rejected-overlong-label", inputId: "full", output: overlongLabel, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["ONE_LINE_LABEL_TOO_LONG"] } },
    { id: "rejected-unsupported-number", inputId: "full", output: unsupportedNumber, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_UNSUPPORTED_NUMBER"] } },
    { id: "rejected-long-term-capability", inputId: "full", output: longTermCapability, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_LONG_TERM_CAPABILITY_LANGUAGE"] } },
    { id: "rejected-dimension-highlight-target", inputId: "full", output: misplacedHighlight, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_TARGET_INVALID"] } },
    { id: "rejected-highlight-claim-outside-overall", inputId: "full", output: highlightClaimOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET"] } },
    { id: "rejected-highlight-visual-outside-overall", inputId: "full", output: highlightVisualOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_VISUAL_OUTSIDE_TARGET"] } },
    { id: "rejected-highlight-numeric-without-claim", inputId: "full", output: highlightNumericUnsupported, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_UNSUPPORTED_NUMBER"] } },
    { id: "rejected-highlight-numeric-claim-outside-overall", inputId: "full", output: highlightNumericClaimOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET"] } },
    { id: "accepted-highlight-numeric-traceable-in-overall", inputId: "full", output: highlightNumericTraceable, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
  ],
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Exported candidate response fixtures: ${OUTPUT_PATH}`);
