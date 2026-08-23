import assert from "node:assert/strict";
import test from "node:test";

import {
  B2_OUTPUT_SCHEMA_VERSION,
  parseAndValidateRideAnalysisOutput,
} from "../src/ai/ride-analysis-contract.ts";
import { generateB0RideAnalysis } from "../src/domain/ride-summary.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function analysis(fixtureId: string) {
  return generateB0RideAnalysis(getRideFixture(fixtureId).activity);
}

test("B2 contract accepts the shared camelCase output contract", () => {
  assert.equal(B2_OUTPUT_SCHEMA_VERSION, "ride-analysis-output-v0.2");
  for (const fixtureId of ["l1-built-in-sample", "l2-built-in-sample", "l3-built-in-sample"]) {
    const b0 = analysis(fixtureId);
    const result = parseAndValidateRideAnalysisOutput(JSON.stringify(b0.output), b0.snapshot);
    assert.equal(result.valid, true, `${fixtureId}: ${result.issues.join(",")}`);
  }
});

test("B2 v0.2 accepts the 49-character RUN-20260818-004 summary", () => {
  const b0 = analysis("l1-built-in-sample");
  const output = structuredClone(b0.output);
  output.summary = "这是一次数据完整的休闲骑行，总共骑行25公里，用时1小时，平均速度25km/h，累计爬升260米。";

  const result = parseAndValidateRideAnalysisOutput(JSON.stringify(output), b0.snapshot);
  assert.equal(output.summary.length, 49);
  assert.equal(result.valid, true, result.issues.join(","));
});

test("B2 v0.2 still rejects empty and over-120-character summaries", () => {
  const b0 = analysis("l1-built-in-sample");

  for (const summary of ["", "摘要".repeat(61)]) {
    const output = structuredClone(b0.output);
    output.summary = summary;
    const result = parseAndValidateRideAnalysisOutput(JSON.stringify(output), b0.snapshot);
    assert.equal(result.valid, false);
    assert.ok(
      result.issues.includes("INVALID_SUMMARY_TYPE") || result.issues.includes("INVALID_SUMMARY_LENGTH"),
      result.issues.join(","),
    );
  }
});

test("B2 contract rejects unknown claims and numbers outside the whitelist", () => {
  const b0 = analysis("l1-built-in-sample");
  const output = structuredClone(b0.output);
  output.highlights[0] = {
    text: "本次距离 99 km",
    claimIds: ["claim:other-user:distanceM"],
    confidence: "high",
  };

  const result = parseAndValidateRideAnalysisOutput(JSON.stringify(output), b0.snapshot);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("UNKNOWN_HIGHLIGHT_CLAIM"));
  assert.ok(result.issues.includes("UNSUPPORTED_NUMBER"));
});

test("B2 contract rejects a metric topic without a matching referenced claim", () => {
  const b0 = analysis("l1-built-in-sample");
  const output = structuredClone(b0.output);
  output.highlights[0] = {
    ...output.highlights[0]!,
    text: "心率表现很稳定",
  };

  const result = parseAndValidateRideAnalysisOutput(JSON.stringify(output), b0.snapshot);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("HEART_RATE_TOPIC_WITHOUT_CLAIM"));
});

test("B2 contract rejects snake_case or extra fields instead of silently translating them", () => {
  const b0 = analysis("l2-built-in-sample");
  const value = {
    ...b0.output,
    next_action: b0.output.nextAction,
  };
  delete (value as Partial<typeof value>).nextAction;

  const result = parseAndValidateRideAnalysisOutput(JSON.stringify(value), b0.snapshot);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("OUTPUT_UNKNOWN_FIELD"));
  assert.ok(result.issues.includes("INVALID_NEXT_ACTION_TYPE"));
});

test("B2 contract rejects fenced or otherwise non-JSON model output", () => {
  const b0 = analysis("l3-built-in-sample");
  const result = parseAndValidateRideAnalysisOutput(`\`\`\`json\n${JSON.stringify(b0.output)}\n\`\`\``, b0.snapshot);
  assert.deepEqual(result.issues, ["INVALID_JSON"]);
});
