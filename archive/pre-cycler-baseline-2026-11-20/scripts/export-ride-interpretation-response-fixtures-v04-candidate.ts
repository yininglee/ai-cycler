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

function inputForFormalFixture(fixtureId: "l1-gpx-normal" | "l2-built-in-sample" | "l2-fit-heart-rate" | "fit-power-dropout-with-heart-rate") {
  const fixture = getRideFixture(fixtureId);
  const context = buildRideAnalysisContext(
    { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
    { profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW) },
  );
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  if (!input) throw new Error(`Expected ${fixtureId} candidate input`);
  return input;
}

function numericCandidateOutsideOverall(input: ReturnType<typeof inputFor>, output: ReturnType<typeof buildRideInterpretationOutputV04CandidateFixture>) {
  const overallClaimIds = new Set(output.overallAssessment.claimIds);
  const candidate = input.candidateClaims.find((item) => !overallClaimIds.has(item.claimId) && item.claimType !== "limitation" && item.sourceClaimIds.some((sourceClaimId) => {
    const source = input.allowedClaims.find((claim) => claim.claimId === sourceClaimId);
    return source?.displayValue !== undefined || source?.value !== undefined;
  }));
  if (!candidate) throw new Error("Expected a numeric Candidate Claim outside the overall assessment");
  const source = candidate.sourceClaimIds
    .map((sourceClaimId) => input.allowedClaims.find((claim) => claim.claimId === sourceClaimId))
    .find((item): item is NonNullable<typeof item> => Boolean(item?.displayValue !== undefined || item?.value !== undefined));
  if (!source) throw new Error("Expected a numeric source Claim outside the overall assessment");
  return { candidate, displayValue: source.displayValue ?? String(source.value) };
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
const cautiousLongTermReference = structuredClone(full);
cautiousLongTermReference.overallAssessment.text = "本次可作为后续骑行能力观察的一次参考。";
const actionOrientedOverall = structuredClone(full);
actionOrientedOverall.overallAssessment.text = "建议下次继续记录本次体感变化。";
const actionOrientedDimension = structuredClone(full);
actionOrientedDimension.dimensions[0]!.text = "建议下次继续观察这一维度的变化。";
const unsafeActionOrientedOverall = structuredClone(full);
unsafeActionOrientedOverall.overallAssessment.text = "建议下次增加高强度训练安排。";
const implicitUnsafeActionOrientedOverall = structuredClone(full);
implicitUnsafeActionOrientedOverall.overallAssessment.text = "安排间歇训练以提升能力。";
const longTermReferenceInHighlight = structuredClone(full);
longTermReferenceInHighlight.highlights = [{
  text: "可作为后续骑行能力观察的一次参考。",
  claimIds: [longTermReferenceInHighlight.overallAssessment.claimIds[0]!],
  visualRefIds: [],
  target: { kind: "overall" },
}];
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

const formalF04Input = inputForFormalFixture("l2-built-in-sample");
const formalF04MissingOverallEvidence = buildRideInterpretationOutputV04CandidateFixture(formalF04Input);
const formalF04Evidence = numericCandidateOutsideOverall(formalF04Input, formalF04MissingOverallEvidence);
formalF04MissingOverallEvidence.overallAssessment.text = `整体记录包含${formalF04Evidence.displayValue}。`;
const formalF04TraceableOverallEvidence = structuredClone(formalF04MissingOverallEvidence);
formalF04TraceableOverallEvidence.overallAssessment.claimIds.push(formalF04Evidence.candidate.claimId);
const formalF04ActionLanguage = buildRideInterpretationOutputV04CandidateFixture(formalF04Input);
const formalF04HeartRate = formalF04ActionLanguage.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
if (!formalF04HeartRate) throw new Error("Expected a heart-rate dimension for formal F04 fixture");
formalF04HeartRate.text = `${formalF04HeartRate.text}建议下次增加高强度训练安排。`;
formalF04ActionLanguage.highlights = [{
  text: "建议下次增加高强度训练。",
  claimIds: [formalF04ActionLanguage.overallAssessment.claimIds[0]!],
  visualRefIds: [],
  target: { kind: "overall" },
}];

const formalF02Input = inputForFormalFixture("l1-gpx-normal");
const formalF02NumericEvidenceChain = buildRideInterpretationOutputV04CandidateFixture(formalF02Input);
const formalF02Evidence = numericCandidateOutsideOverall(formalF02Input, formalF02NumericEvidenceChain);
formalF02NumericEvidenceChain.overallAssessment.text = `整体记录包含${formalF02Evidence.displayValue}。`;
formalF02NumericEvidenceChain.highlights = [{
  text: `该数值${formalF02Evidence.displayValue}值得回看。`,
  claimIds: [formalF02Evidence.candidate.claimId],
  visualRefIds: [],
  target: { kind: "overall" },
}];

const formalF05Input = inputForFormalFixture("l2-fit-heart-rate");
function formalF05ActionCombination(options: { overall: boolean; dimension: boolean; highlight: boolean }) {
  const output = buildRideInterpretationOutputV04CandidateFixture(formalF05Input);
  const heartRate = output.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
  if (!heartRate) throw new Error("Expected a heart-rate dimension for formal F05 fixture");
  if (options.overall) output.overallAssessment.text = `${output.overallAssessment.text}建议下次增加高强度训练安排。`;
  if (options.dimension) heartRate.text = `${heartRate.text}建议下次增加高强度训练安排。`;
  if (options.highlight) {
    output.highlights = [{
      text: "建议下次增加高强度训练。",
      claimIds: [output.overallAssessment.claimIds[0]!],
      visualRefIds: [],
      target: { kind: "overall" },
    }];
  }
  return output;
}
const formalF05R5ActionLanguage = formalF05ActionCombination({ overall: true, dimension: true, highlight: true });
const formalF05R6ActionLanguage = formalF05ActionCombination({ overall: false, dimension: true, highlight: true });
const formalF05R7ActionLanguage = formalF05ActionCombination({ overall: true, dimension: true, highlight: false });
const formalF05ImperativeActionTail = buildRideInterpretationOutputV04CandidateFixture(formalF05Input);
const formalF05ImperativeHeartRate = formalF05ImperativeActionTail.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
if (!formalF05ImperativeHeartRate) throw new Error("Expected a heart-rate dimension for formal F05 imperative fixture");
formalF05ImperativeActionTail.overallAssessment.text = `${formalF05ImperativeActionTail.overallAssessment.text.replace(/[。！？!?]+$/, "")}，安排间歇训练以提升能力。`;
formalF05ImperativeHeartRate.text = `${formalF05ImperativeHeartRate.text.replace(/[。！？!?]+$/, "")}；进行高强度训练安排。`;

const formalF09Input = inputForFormalFixture("fit-power-dropout-with-heart-rate");
const formalF09HighlightOutsideOverall = buildRideInterpretationOutputV04CandidateFixture(formalF09Input);
const formalF09Evidence = numericCandidateOutsideOverall(formalF09Input, formalF09HighlightOutsideOverall);
formalF09HighlightOutsideOverall.highlights = [{
  text: `该数值${formalF09Evidence.displayValue}值得回看。`,
  claimIds: [formalF09Evidence.candidate.claimId],
  visualRefIds: [],
  target: { kind: "overall" },
}];
const formalF09TraceableHighlight = structuredClone(formalF09HighlightOutsideOverall);
formalF09TraceableHighlight.overallAssessment.claimIds.push(formalF09Evidence.candidate.claimId);
const formalF09HighlightNumericAndVisualOutsideOverall = structuredClone(formalF09HighlightOutsideOverall);
const formalF09OutsideVisual = formalF09HighlightNumericAndVisualOutsideOverall.dimensions
  .flatMap((dimension) => dimension.visualRefIds)
  .find((visualRefId) => !formalF09HighlightNumericAndVisualOutsideOverall.overallAssessment.visualRefIds.includes(visualRefId));
if (!formalF09OutsideVisual) throw new Error("Expected a formal F09 visual outside the overall assessment");
formalF09HighlightNumericAndVisualOutsideOverall.highlights[0]!.visualRefIds = [formalF09OutsideVisual];
const formalF09VisualAndActionLanguage = buildRideInterpretationOutputV04CandidateFixture(formalF09Input);
const formalF09HeartRate = formalF09VisualAndActionLanguage.dimensions.find((dimension) => dimension.dimensionId === "heart_rate");
if (!formalF09HeartRate) throw new Error("Expected a heart-rate dimension for formal F09 fixture");
formalF09VisualAndActionLanguage.overallAssessment.visualRefIds = [];
formalF09HeartRate.text = `${formalF09HeartRate.text}建议下次增加高强度训练安排。`;
const formalF09UnsupportedNumericChain = buildRideInterpretationOutputV04CandidateFixture(formalF09Input);
formalF09UnsupportedNumericChain.overallAssessment.text = "整体记录包含999。";
formalF09UnsupportedNumericChain.highlights = [{
  text: "本次值得回看的数值是999。",
  claimIds: [formalF09UnsupportedNumericChain.overallAssessment.claimIds[0]!],
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
    { id: "accepted-cautious-long-term-reference", inputId: "full", output: cautiousLongTermReference, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-action-oriented-overall", inputId: "full", output: actionOrientedOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-action-oriented-dimension", inputId: "full", output: actionOrientedDimension, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["DIMENSION_power_output_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-unsafe-action-oriented-overall", inputId: "full", output: unsafeActionOrientedOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-implicit-unsafe-action-oriented-overall", inputId: "full", output: implicitUnsafeActionOrientedOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-long-term-reference-in-highlight", inputId: "full", output: longTermReferenceInHighlight, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_LONG_TERM_CAPABILITY_LANGUAGE"] } },
    { id: "rejected-dimension-highlight-target", inputId: "full", output: misplacedHighlight, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_TARGET_INVALID"] } },
    { id: "rejected-highlight-claim-outside-overall", inputId: "full", output: highlightClaimOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET"] } },
    { id: "rejected-highlight-visual-outside-overall", inputId: "full", output: highlightVisualOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_VISUAL_OUTSIDE_TARGET"] } },
    { id: "rejected-highlight-numeric-without-claim", inputId: "full", output: highlightNumericUnsupported, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_UNSUPPORTED_NUMBER"] } },
    { id: "rejected-highlight-numeric-claim-outside-overall", inputId: "full", output: highlightNumericClaimOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET"] } },
    { id: "accepted-highlight-numeric-traceable-in-overall", inputId: "full", output: highlightNumericTraceable, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-formal-f02-numeric-highlight-chain", inputId: "formal-f02", output: formalF02NumericEvidenceChain, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET", "OVERALL_UNSUPPORTED_NUMBER"] } },
    { id: "rejected-formal-f04-overall-number-without-own-claim", inputId: "formal-f04", output: formalF04MissingOverallEvidence, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_UNSUPPORTED_NUMBER"] } },
    { id: "accepted-formal-f04-overall-number-with-own-claim", inputId: "formal-f04", output: formalF04TraceableOverallEvidence, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-formal-f04-dimension-and-highlight-action", inputId: "formal-f04", output: formalF04ActionLanguage, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["DIMENSION_heart_rate_ACTION_LANGUAGE_NOT_ALLOWED", "HIGHLIGHT_0_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-formal-f05-r5-action-combination", inputId: "formal-f05", output: formalF05R5ActionLanguage, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_ACTION_LANGUAGE_NOT_ALLOWED", "DIMENSION_heart_rate_ACTION_LANGUAGE_NOT_ALLOWED", "HIGHLIGHT_0_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-formal-f05-r6-action-combination", inputId: "formal-f05", output: formalF05R6ActionLanguage, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["DIMENSION_heart_rate_ACTION_LANGUAGE_NOT_ALLOWED", "HIGHLIGHT_0_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-formal-f05-r7-action-combination", inputId: "formal-f05", output: formalF05R7ActionLanguage, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_ACTION_LANGUAGE_NOT_ALLOWED", "DIMENSION_heart_rate_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-formal-f05-imperative-action-tail", inputId: "formal-f05", output: formalF05ImperativeActionTail, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_ACTION_LANGUAGE_NOT_ALLOWED", "DIMENSION_heart_rate_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-formal-f09-highlight-claim-outside-overall", inputId: "formal-f09", output: formalF09HighlightOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET"] } },
    { id: "rejected-formal-f09-highlight-numeric-and-visual-outside-overall", inputId: "formal-f09", output: formalF09HighlightNumericAndVisualOutsideOverall, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_CLAIM_OUTSIDE_TARGET", "HIGHLIGHT_0_VISUAL_OUTSIDE_TARGET"] } },
    { id: "accepted-formal-f09-highlight-claim-in-overall", inputId: "formal-f09", output: formalF09TraceableHighlight, expected: { validationStatus: "accepted", fallbackLevel: "none", issueCodes: [] } },
    { id: "rejected-formal-f09-visual-and-dimension-action", inputId: "formal-f09", output: formalF09VisualAndActionLanguage, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["OVERALL_VISUAL_MISMATCH", "DIMENSION_heart_rate_ACTION_LANGUAGE_NOT_ALLOWED"] } },
    { id: "rejected-formal-f09-unsupported-numeric-chain", inputId: "formal-f09", output: formalF09UnsupportedNumericChain, expected: { validationStatus: "rejected", fallbackLevel: "b0", issueCodes: ["HIGHLIGHT_0_UNSUPPORTED_NUMBER", "OVERALL_UNSUPPORTED_NUMBER"] } },
  ],
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Exported candidate response fixtures: ${OUTPUT_PATH}`);
