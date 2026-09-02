import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { validateRideAnalysisOutputV03, type RideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function context(fixtureId = "l3-built-in-sample") {
  const fixture = getRideFixture(fixtureId);
  const ride: RideRecord = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  const analysisContext = buildRideAnalysisContext(ride);
  return { analysisContext, eligibility: buildAnalysisEligibility(analysisContext) };
}

function validOutput(): RideAnalysisOutputV03 {
  return {
    schemaVersion: "ride-analysis-output-v0.3",
    headline: "节奏出现变化，完成本次骑行",
    overallAssessment: {
      text: "本次骑行首段与末段四分之一的平均功率存在差异，说明功率输出在阶段之间有所变化。",
      claimIds: ["claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW"],
    },
    dimensions: [
      {
        key: "pace",
        text: "首段与末段四分之一的平均速度存在差异，说明后程配速出现变化。",
        claimIds: ["claim:ride-l3-built-in-sample:feature:speedFirstLastDeltaMps"],
        confidence: "high",
      },
      {
        key: "power",
        text: "首段与末段四分之一的平均功率存在差异，反映出阶段输出并不相同。",
        claimIds: ["claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW"],
        confidence: "high",
      },
    ],
    notableEvents: [],
    nextAction: null,
    limitations: ["本次解读只覆盖当前记录中可用的骑行指标。"],
    safetyLevel: "normal",
    shareCopy: ["完成本次骑行。", "本次骑行已完成。", "记录一次骑行。"],
  };
}

test("a grounded multi-dimensional output passes the v0.3 contract", () => {
  const { analysisContext, eligibility } = context();
  const result = validateRideAnalysisOutputV03(validOutput(), analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
  assert.equal(result.output?.schemaVersion, "ride-analysis-output-v0.3");
});

test("an output dimension not opened by AnalysisEligibility is rejected", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.dimensions = [{
    key: "power",
    text: "功率输出稳定。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedSeriesMeanMps"],
    confidence: "high",
  }];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("DIMENSION_NOT_ELIGIBLE"));
});

test("unknown claims and unsupported numeric assertions are rejected", () => {
  const { analysisContext, eligibility } = context();
  const output = validOutput();
  output.overallAssessment = {
    text: "本次骑行达到了999瓦的输出。",
    claimIds: ["claim:other-user:avgPowerW"],
  };
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("OVERALL_UNKNOWN_CLAIM"));
  assert.ok(result.issues.includes("OVERALL_UNSUPPORTED_NUMBER"));
});

test("grounded actions require evidence while general actions stay claim-free", () => {
  const { analysisContext, eligibility } = context();
  const grounded = validOutput();
  grounded.nextAction = { kind: "grounded", text: "继续保持。", basisClaimIds: [] };
  const groundedResult = validateRideAnalysisOutputV03(grounded, analysisContext, eligibility);
  assert.equal(groundedResult.valid, false);
  assert.ok(groundedResult.issues.includes("GROUNDED_ACTION_WITHOUT_CLAIM"));

  const general = validOutput();
  general.nextAction = { kind: "general", text: "记得补水和放松。", basisClaimIds: ["claim:ride-l3-built-in-sample:feature:powerCoefficientOfVariation"] };
  const generalResult = validateRideAnalysisOutputV03(general, analysisContext, eligibility);
  assert.equal(generalResult.valid, false);
  assert.ok(generalResult.issues.includes("GENERAL_ACTION_HAS_CLAIM"));
});

test("no notable event and a null next action are valid degradations", () => {
  const { analysisContext, eligibility } = context();
  const output = validOutput();
  output.notableEvents = [];
  output.nextAction = null;
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
});

test("model output is rejected whenever eligibility says not to call the model", () => {
  const noFeatureContext = buildRideAnalysisContext({
    activity: structuredClone(getRideFixture("l1-built-in-sample").activity),
    series: structuredClone(getRideFixture("l1-built-in-sample").series),
  });
  noFeatureContext.allowedClaims = noFeatureContext.allowedClaims.filter(
    (claim) => claim.kind !== "feature" && claim.kind !== "advanced",
  );
  noFeatureContext.featureSnapshot = { ...noFeatureContext.featureSnapshot, features: [] };
  const ineligible = buildAnalysisEligibility(noFeatureContext);
  assert.equal(ineligible.eligible, false);
  const result = validateRideAnalysisOutputV03(validOutput(), noFeatureContext, ineligible);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("ELIGIBILITY_BLOCKS_MODEL_OUTPUT"));
});

test("high-risk claims and unknown fields are rejected", () => {
  const { analysisContext, eligibility } = context();
  const output = validOutput() as RideAnalysisOutputV03 & { debug?: string };
  output.debug = "leak";
  output.overallAssessment.text = "保证提升体能，训练后恢复时间很短。";
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("OUTPUT_UNKNOWN_FIELD"));
  assert.ok(result.issues.includes("FORBIDDEN_HIGH_RISK_TOPIC"));
});

test("history limitation is allowed while unsupported scope and safety labels remain rejected", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "完成25公里轻松休闲骑行";
  output.overallAssessment = {
    text: "后半程速度下降，整体节奏稳定，符合长距离骑行的体能变化规律。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  output.dimensions = [{
    key: "climbing",
    text: "本次地势相对平缓，整体路线起伏不大。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:elevationRangeM"],
    confidence: "high",
  }];
  output.nextAction = { kind: "general", text: "骑后补水和放松。", basisClaimIds: [] };
  output.limitations = ["无可用历史数据做对比分析"];
  output.shareCopy = ["轻松完成25公里骑行。", "畅快骑行。", "完成本次骑行。"];

  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(!result.issues.includes("VISIBLE_HISTORY_GAP"));
  assert.ok(result.issues.includes("UNSUPPORTED_DISTANCE_CLASSIFICATION"));
  assert.ok(result.issues.includes("UNSUPPORTED_ROUTE_CLASSIFICATION"));
  assert.ok(result.issues.includes("UNSUPPORTED_EFFORT_CLASSIFICATION"));
  assert.ok(result.issues.includes("UNSUPPORTED_PHYSIOLOGICAL_CAUSALITY"));
  assert.ok(!result.issues.includes("UNCALIBRATED_FEATURE_CLASSIFICATION"));
  assert.ok(result.issues.includes("UNSUPPORTED_SEGMENT_LABEL"));
});

test("unsupported time and scene labels are rejected when no such claims exist", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "周末晨骑25公里";
  output.overallAssessment = {
    text: "本次骑行完成25公里。",
    claimIds: ["claim:ride-l1-built-in-sample:distanceM"],
  };
  output.dimensions = [];
  output.nextAction = null;
  output.limitations = ["本次解读只覆盖当前记录中可用的骑行指标。"];
  output.shareCopy = ["周末晨骑25公里，享受在路上的感觉。", "完成今天的骑行。", "记录一次骑行。"];

  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("UNSUPPORTED_CONTEXT_LABEL"));
  assert.ok(!result.issues.includes("UNSUPPORTED_SUBJECTIVE_EXPERIENCE"));
});

test("segment calculations may use natural user-facing wording but not half-ride wording", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "结束阶段平均速度低于开始阶段，说明后程配速有所回落。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  output.dimensions = [];
  output.nextAction = null;
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));

  output.overallAssessment.text = "后半程平均速度低于前半程。";
  const halfResult = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(halfResult.valid, false);
  assert.ok(halfResult.issues.includes("UNSUPPORTED_SEGMENT_LABEL"));
});

test("unsupported current-day and plan references are rejected", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "数据记录完成";
  output.overallAssessment = {
    text: "本次骑行完成25公里。",
    claimIds: ["claim:ride-l1-built-in-sample:distanceM"],
  };
  output.dimensions = [];
  output.nextAction = null;
  output.shareCopy = ["今日骑行计划顺利完成。", "今天完成一次骑行。", "记录本次骑行。"];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("DATA_COMPLETENESS_EVALUATION"));
  assert.ok(result.issues.includes("UNSUPPORTED_CONTEXT_LABEL"));
  assert.ok(result.issues.includes("UNSUPPORTED_PLAN_REFERENCE"));
});

test("grounded fact-only headline and prose remain valid when meaning is unsafe", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "后程速度出现变化";
  output.overallAssessment = {
    text: "本次骑行完成25公里，用时1小时，平均速度25km/h，累计爬升260米，结束阶段速度比开始阶段低4.49km/h。",
    claimIds: [
      "claim:ride-l1-built-in-sample:distanceM",
      "claim:ride-l1-built-in-sample:movingTimeS",
      "claim:ride-l1-built-in-sample:avgSpeedMps",
      "claim:ride-l1-built-in-sample:feature:elevationPositiveGainM",
      "claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps",
    ],
  };
  output.dimensions = [{
    key: "pace",
    text: "本次骑行平均速度为25km/h，结束阶段速度低于开始阶段。",
    claimIds: [
      "claim:ride-l1-built-in-sample:avgSpeedMps",
      "claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps",
    ],
    confidence: "high",
  }];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
});

test("fact-only output remains valid when no meaningful feature evidence is available", () => {
  const { analysisContext } = context("l1-built-in-sample");
  analysisContext.featureSnapshot = {
    ...analysisContext.featureSnapshot,
    features: analysisContext.featureSnapshot.features.filter(
      (feature) => feature.dimension === "elevation" || feature.key === "speedSeriesMeanMps",
    ),
  };
  analysisContext.allowedClaims = analysisContext.allowedClaims.filter(
    (claim) => claim.kind !== "feature" || claim.key.startsWith("elevation") || claim.key === "speedSeriesMeanMps",
  );
  const eligibility = buildAnalysisEligibility(analysisContext);
  const output = validOutput();
  output.headline = "平均配速与累计爬升";
  output.overallAssessment = {
    text: "本次骑行完成25公里，用时1小时，平均速度25km/h，累计爬升260米。",
    claimIds: [
      "claim:ride-l1-built-in-sample:distanceM",
      "claim:ride-l1-built-in-sample:movingTimeS",
      "claim:ride-l1-built-in-sample:avgSpeedMps",
      "claim:ride-l1-built-in-sample:elevationGainM",
    ],
  };
  output.dimensions = [
    {
      key: "pace",
      text: "平均速度25km/h。",
      claimIds: ["claim:ride-l1-built-in-sample:avgSpeedMps"],
      confidence: "high",
    },
    {
      key: "climbing",
      text: "累计爬升260米。",
      claimIds: ["claim:ride-l1-built-in-sample:elevationGainM"],
      confidence: "high",
    },
  ];
  output.nextAction = null;
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
  assert.equal(result.qualityWarnings, undefined);
});

test("base-fact output is quality-warned when meaningful feature evidence is available", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "平均配速25km/h，记录完成";
  output.overallAssessment = {
    text: "本次骑行完成25公里，用时1小时，平均速度25km/h，累计爬升260米。",
    claimIds: [
      "claim:ride-l1-built-in-sample:distanceM",
      "claim:ride-l1-built-in-sample:movingTimeS",
      "claim:ride-l1-built-in-sample:avgSpeedMps",
      "claim:ride-l1-built-in-sample:elevationGainM",
    ],
  };
  output.dimensions = [
    { key: "pace", text: "平均速度25km/h。", claimIds: ["claim:ride-l1-built-in-sample:avgSpeedMps"], confidence: "high" },
    { key: "climbing", text: "累计爬升260米。", claimIds: ["claim:ride-l1-built-in-sample:elevationGainM"], confidence: "high" },
  ];
  output.nextAction = null;
  const factOnly = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(factOnly.valid, true, factOnly.issues.join(","));
  assert.deepEqual(factOnly.qualityWarnings, ["FEATURE_EVIDENCE_AVAILABLE_NOT_USED"]);

  output.overallAssessment = {
    text: "本次骑行平均速度25km/h，结束阶段速度低于开始阶段，说明后程配速出现回落。",
    claimIds: [
      "claim:ride-l1-built-in-sample:avgSpeedMps",
      "claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps",
    ],
  };
  output.dimensions = [{
    key: "pace",
    text: "结束阶段速度低于开始阶段，说明后程配速出现回落。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
    confidence: "high",
  }];
  const featureBacked = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(featureBacked.valid, true, featureBacked.issues.join(","));
  assert.equal(featureBacked.qualityWarnings, undefined);
});

test("general and grounded actions remain structurally distinct", () => {
  const { analysisContext, eligibility } = context();
  const general = validOutput();
  general.nextAction = {
    kind: "general",
    text: "骑行后做好拉伸放松，及时补充水分。",
    basisClaimIds: [],
  };
  const generalResult = validateRideAnalysisOutputV03(general, analysisContext, eligibility);
  assert.equal(generalResult.valid, true, generalResult.issues.join(","));

  const grounded = validOutput();
  grounded.nextAction = {
    kind: "grounded",
    text: "根据结束阶段速度回落，下一次可关注结束阶段配速。",
    basisClaimIds: ["claim:ride-l3-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  const groundedResult = validateRideAnalysisOutputV03(grounded, analysisContext, eligibility);
  assert.equal(groundedResult.valid, true, groundedResult.issues.join(","));
});

test("overall assessment integrates only necessary dimensions with topic-complete claims", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const output = validOutput();
  output.headline = "后程配速回落，功率首末阶段一致";
  output.overallAssessment = {
    text: "结束阶段速度低于开始阶段，说明后程配速出现回落；功率首末阶段没有变化。",
    claimIds: [
      "claim:ride-l3-built-in-sample:feature:speedFirstLastDeltaMps",
      "claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW",
    ],
  };
  output.dimensions = [];
  output.nextAction = null;
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
  assert.equal(result.qualityWarnings, undefined);
});

test("reasonable statistical interpretation is allowed when sensor limitation has an impact", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "后程配速出现变化";
  output.overallAssessment = {
    text: "结束阶段速度明显回落，整体速度保持得比较稳定。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  output.dimensions = [{
    key: "pace",
    text: "速度波动幅度较小，说明全程配速没有大幅变化。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedStdDevMps"],
    confidence: "high",
  }];
  output.limitations = ["缺少心率、功率、踏频数据，因此本次解读不涉及运动强度、发力和踩踏节奏。"];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
  assert.ok(!result.issues.includes("UNCALIBRATED_FEATURE_CLASSIFICATION"));
});

test("approved same-claim conversions are accepted and arbitrary percentages are rejected", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const ratioClaim = analysisContext.allowedClaims.find((claim) => claim.key === "normalizedPowerRatio");
  assert.ok(ratioClaim, "fixture should expose normalized power ratio");
  const output = validOutput();
  output.overallAssessment = {
    text: "标准化功率比平均功率高约7%。",
    claimIds: [ratioClaim.claimId],
  };
  output.dimensions = [];
  let result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));

  output.overallAssessment.text = "标准化功率比平均功率高约99%。";
  result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("OVERALL_UNSUPPORTED_NUMBER"));
});

test("reasonable same-claim rounding is accepted while unrelated rounded numbers are rejected", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "平均心率约152bpm，结束阶段心率比开始阶段低约10bpm。",
    claimIds: [
      "claim:ride-l3-built-in-sample:feature:heartRateSeriesMeanBpm",
      "claim:ride-l3-built-in-sample:feature:heartRateFirstLastDeltaBpm",
    ],
  };
  output.dimensions = [];
  let result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));

  output.overallAssessment.text = "平均心率约160bpm。";
  result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("OVERALL_UNSUPPORTED_NUMBER"));
});

test("overall assessment must cite claims for every metric topic it states", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "心率、踏频波动小，功率输出相对稳定。",
    claimIds: ["claim:ride-l3-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  const missing = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(missing.valid, false);
  assert.ok(missing.issues.includes("OVERALL_TOPIC_WITHOUT_CLAIM"));

  output.overallAssessment.claimIds = [
    "claim:ride-l3-built-in-sample:feature:heartRateFirstLastDeltaBpm",
    "claim:ride-l3-built-in-sample:feature:cadenceFirstLastDeltaRpm",
    "claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW",
  ];
  const complete = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(complete.valid, true, complete.issues.join(","));
});

test("sensor limitations with an explicit impact and low-risk share copy are valid", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.headline = "后程配速出现回落";
  output.overallAssessment = {
    text: "平均速度为25km/h，结束阶段速度比开始阶段低4.49km/h，说明后程配速出现回落。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedSeriesMeanMps", "claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  output.dimensions = [{
    key: "pace",
    text: "平均速度为25km/h，结束阶段速度比开始阶段低4.49km/h，说明后程配速出现回落。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedSeriesMeanMps", "claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
    confidence: "high",
  }];
  output.limitations = ["无心率、功率和踏频数据，因此本次解读不涉及运动强度、发力和踩踏节奏。"];
  output.shareCopy = ["完成本次骑行，享受骑行的日常~", "记录这次骑行。", "完成本次骑行。"];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
});

test("history-limit wording is allowed in limitations without opening a history dimension", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "结束阶段速度低于开始阶段，说明后程配速出现回落。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
  };
  output.dimensions = [{
    key: "pace",
    text: "结束阶段速度低于开始阶段，说明后程配速出现回落。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
    confidence: "high",
  }];
  output.limitations = ["本次评价不包含历史对比分析"];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
  assert.ok(!result.issues.includes("VISIBLE_HISTORY_GAP"));
});

test("first or non-comparable history never opens a history dimension", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.dimensions = [{
    key: "history",
    text: "历史表现出现变化。",
    claimIds: ["claim:ride-l1-built-in-sample:feature:speedFirstLastDeltaMps"],
    confidence: "high",
  }];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("DIMENSION_NOT_ELIGIBLE"));
});

test("empty meta-language does not count as an interpretation", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.overallAssessment.text = "累计爬升260米，是本次骑行的基础骑行数据特征。";
  output.overallAssessment.claimIds = ["claim:ride-l1-built-in-sample:feature:elevationPositiveGainM"];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("LOW_VALUE_META_LANGUAGE"));
});

test("first/last segment claims cannot be expanded into a whole-ride conclusion", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "开始和结束阶段功率没有变化，功率全程没有变化。",
    claimIds: ["claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW"],
  };
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("OVERBROAD_SERIES_CONCLUSION"));
});

test("unscoped consistency wording is rejected for first/last-only evidence", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "功率保持一致。",
    claimIds: ["claim:ride-l3-built-in-sample:feature:powerFirstLastDeltaW"],
  };
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("UNSCOPED_CONSISTENCY_CONCLUSION"));

  output.overallAssessment.text = "首末阶段功率保持一致。";
  const scopedResult = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(scopedResult.valid, true, scopedResult.issues.join(","));
});

test("safety output must reflect a stop-generation or critical-safety flag", () => {
  const { analysisContext, eligibility } = context();
  const unsafeEligibility = { ...eligibility, eligible: true, status: "eligible" as const };
  const unsafeContext = { ...analysisContext, safetyFlags: ["critical_safety"] };
  const output = validOutput();
  output.safetyLevel = "normal";
  const result = validateRideAnalysisOutputV03(output, unsafeContext, unsafeEligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("SAFETY_LEVEL_MISMATCH"));
});

test("unbound text cannot combine numbers from multiple claims", () => {
  const { analysisContext, eligibility } = context("l3-built-in-sample");
  const output = validOutput();
  output.headline = "平均速度25.7km/h，平均心率150bpm";
  let result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("UNBOUND_TEXT_CROSS_CLAIM_NUMBER"));

  output.headline = "平均速度25.7km/h";
  result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));
});

test("time, scene, and route context labels each require their own claim category", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.overallAssessment = {
    text: "本次骑行完成25公里。",
    claimIds: ["claim:ride-l1-built-in-sample:distanceM"],
  };
  output.dimensions = [];
  output.headline = "今天骑行";
  output.shareCopy = ["完成本次骑行。", "记录这次骑行。", "完成本次骑行。"];
  let result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("UNSUPPORTED_CONTEXT_LABEL"));

  const dateClaim = { ...analysisContext.allowedClaims[0]!, claimId: "claim:ride-l1-built-in-sample:context:date", key: "context.date" };
  analysisContext.allowedClaims.push(dateClaim);
  result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, true, result.issues.join(","));

  output.headline = "晨骑";
  result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("UNSUPPORTED_CONTEXT_LABEL"));
});

test("field names cannot be used as business dimension keys", () => {
  const { analysisContext, eligibility } = context("l1-built-in-sample");
  const output = validOutput();
  output.dimensions = [{
    key: "distance" as never,
    text: "本次骑行完成25公里。",
    claimIds: ["claim:ride-l1-built-in-sample:distanceM"],
    confidence: "high",
  }];
  const result = validateRideAnalysisOutputV03(output, analysisContext, eligibility);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("DIMENSION_FIELD_LABEL"));
});
