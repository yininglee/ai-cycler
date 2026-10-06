import assert from "node:assert/strict";
import test from "node:test";

import { getRideRecord } from "../src/imports/demo-ride-store.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import type { RideModelInputQuestionV2, RideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import type { V2AnalysisClaim } from "../src/domain/ride-analysis-evidence-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "../src/ai/ride-output-schema-v2.ts";
import type { RideModelOutputV2 } from "../src/ai/ride-output-schema-v2.ts";
import {
  RIDE_MODEL_PROVIDER_ID,
  RIDE_MODEL_PROVIDER_RULES_VERSION,
  RideModelErrorV2,
  type RideModelCallRecordV2,
  type RideModelInvocationV2,
} from "../src/ai/ride-model-provider-v2.ts";
import {
  RIDE_INTERPRETATION_SERVICE_V2_VERSION,
  runRideInterpretationV2,
  type RideModelCallerV2,
} from "../src/ai/ride-interpretation-service-v2.ts";

// The first-round prompt embeds the versioned input JSON verbatim at the end;
// the repair prompt re-embeds the same input under its own marker. The test
// doubles parse it back out so every scripted response is grounded in the
// exact input the service actually delivered.
const PROMPT_INPUT_MARKER = "【版本化输入 JSON】\n";

const ANCHOR_RIDE_ID = "l3-power-preview";

function anchorRecord(): RideRecord {
  const record = getRideRecord(ANCHOR_RIDE_ID);
  assert.ok(record, `fixture ${ANCHOR_RIDE_ID} must exist`);
  return record;
}

function inputFromPrompt(promptText: string): RideModelInputV2 {
  const index = promptText.indexOf(PROMPT_INPUT_MARKER);
  if (index >= 0) {
    return JSON.parse(promptText.slice(index + PROMPT_INPUT_MARKER.length)) as RideModelInputV2;
  }
  // Repair prompt: the input JSON is one line followed by the previous-output
  // section, so capture up to the first newline.
  const repairMatch = promptText.match(/【原始输入 JSON】\n(.+)/);
  assert.ok(repairMatch, "prompt must embed the versioned input JSON");
  return JSON.parse(repairMatch[1]) as RideModelInputV2;
}

function isAnchorClaim(claim: V2AnalysisClaim): boolean {
  return claim.confidence === "high" && claim.kind !== "limitation";
}

// A non-variance anchor claim keeps scripted "稳定" wording provably
// un-supported (STABILITY_WITHOUT_VARIANCE) in the broken-output scripts.
function nonVarianceAnchorClaim(input: RideModelInputV2): V2AnalysisClaim {
  const claim = input.claims
    .find((item) => isAnchorClaim(item) && !/coefficientOfVariation|lastMinusFirst|drift|variance/i.test(item.key));
  assert.ok(claim, "test setup: input must contain a high-confidence non-variance claim");
  return claim;
}

function dimensionClaim(input: RideModelInputV2, question: RideModelInputQuestionV2): V2AnalysisClaim {
  const questionClaims = question.claimIds
    .map((claimId) => input.claims.find((item) => item.claimId === claimId))
    .filter((item): item is V2AnalysisClaim => item !== undefined);
  const claim = questionClaims.find((item) => item.kind !== "limitation") ?? questionClaims[0];
  assert.ok(claim, `test setup: question ${question.dimensionId} must carry a claim`);
  return claim;
}

// Builds an output that satisfies every validator gate for the captured input:
// no fabricated citations, no numbers, no stability/history/plan/recovery
// wording, soft-quality disclosure where required, verbatim limitation
// backfill, and the data-limited disclosure when fewer than two questions
// are available.
function buildPassingOutput(input: RideModelInputV2): RideModelOutputV2 {
  const available = input.questions.filter((question) => question.eligibility === "available");
  assert.ok(available.length > 0, "test setup: input must contain available questions");
  const anchor = nonVarianceAnchorClaim(input);
  return {
    schemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
    label: {
      text: "本次骑行数据完整，表现处于预期范围。",
      conclusionType: "fact",
      claimIds: [anchor.claimId],
    },
    overallAssessment: {
      text: available.length < 2
        ? "本次骑行可用数据有限，整体表现为一次普通的训练记录。"
        : "本次骑行整体表现为一次普通的训练记录。",
      conclusionType: "fact",
      claimIds: [anchor.claimId],
    },
    dimensions: available.map((question) => ({
      dimensionId: question.dimensionId,
      assertions: [
        {
          text: question.qualityStatus === "soft"
            ? "该维度数据部分依赖估算，表现处于预期范围。"
            : "该维度表现处于预期范围。",
          conclusionType: "fact",
          claimIds: [dimensionClaim(input, question).claimId],
        },
      ],
    })),
    limitations: [...new Set(input.questions.flatMap((question) => question.limitations))],
  };
}

function brokenOutputWithStabilityWording(input: RideModelInputV2): RideModelOutputV2 {
  const output = buildPassingOutput(input);
  return {
    ...output,
    overallAssessment: {
      text: "本次骑行整体输出稳定。",
      conclusionType: "fact",
      claimIds: [nonVarianceAnchorClaim(input).claimId],
    },
  };
}

function fakeCallRecord(invocation: RideModelInvocationV2): RideModelCallRecordV2 {
  return {
    provider: RIDE_MODEL_PROVIDER_ID,
    rulesVersion: RIDE_MODEL_PROVIDER_RULES_VERSION,
    model: "test-model",
    analysisRunId: invocation.analysisRunId,
    requestId: invocation.requestId,
    promptVersion: invocation.promptVersion,
    latencyMs: 1,
  };
}

interface CallerTracker {
  calls: number;
}

function scriptedCaller(
  tracker: CallerTracker,
  scripts: Array<(invocation: RideModelInvocationV2) => { rawText: string }>,
): RideModelCallerV2 {
  return async (invocation) => {
    const script = scripts[Math.min(tracker.calls, scripts.length - 1)];
    tracker.calls += 1;
    return { ...script(invocation), callRecord: fakeCallRecord(invocation) };
  };
}

function passingScript(tracker?: CallerTracker): (invocation: RideModelInvocationV2) => { rawText: string } {
  return (invocation) => ({ rawText: JSON.stringify(buildPassingOutput(inputFromPrompt(invocation.promptText))) });
}

function stabilityBrokenScript(): (invocation: RideModelInvocationV2) => { rawText: string } {
  return (invocation) => ({ rawText: JSON.stringify(brokenOutputWithStabilityWording(inputFromPrompt(invocation.promptText))) });
}

function baseOptions(caller?: RideModelCallerV2) {
  return {
    record: anchorRecord(),
    profile: null,
    analysisRunId: "run-s6-03-test",
    userScope: "user-s6-03-test",
    requestId: "req-s6-03-test",
    ...(caller ? { modelCaller: caller } : {}),
  };
}

test("S6-03 blocks the model call when the input gate rejects the ride (zero provider calls)", async () => {
  const record = getRideRecord("gpx-no-timestamps");
  assert.ok(record, "fixture gpx-no-timestamps must exist");
  const caller: RideModelCallerV2 = async () => {
    throw new Error("the model must never be called when the input gate blocks");
  };
  const result = await runRideInterpretationV2({
    ...baseOptions(caller),
    record,
  });
  assert.equal(result.source, "b0");
  assert.equal(result.stage, "blocked");
  assert.equal(result.fallbackCode, "DATA_NOT_ELIGIBLE");
  assert.deepEqual(result.callRecords, []);
});

test("S6-03 returns AI_NOT_CONFIGURED without any network call when no provider is configured", async () => {
  const result = await runRideInterpretationV2(baseOptions());
  assert.equal(result.source, "b0");
  assert.equal(result.stage, "notConfigured");
  assert.equal(result.fallbackCode, "AI_NOT_CONFIGURED");
  assert.deepEqual(result.callRecords, []);
});

test("S6-03 classifies provider failures and never retries", async () => {
  const tracker: CallerTracker = { calls: 0 };
  const caller = scriptedCaller(tracker, [
    () => {
      throw new RideModelErrorV2(
        "AI_TIMEOUT",
        "model request timed out",
        {
          provider: RIDE_MODEL_PROVIDER_ID,
          rulesVersion: RIDE_MODEL_PROVIDER_RULES_VERSION,
          model: "test-model",
          analysisRunId: "run-s6-03-test",
          requestId: "req-s6-03-test",
          promptVersion: "test",
          latencyMs: 30_000,
          errorCode: "AI_TIMEOUT",
        },
      );
    },
  ]);
  const result = await runRideInterpretationV2(baseOptions(caller));
  assert.equal(result.source, "b0");
  assert.equal(result.stage, "providerError");
  assert.equal(result.fallbackCode, "AI_TIMEOUT");
  assert.equal(tracker.calls, 1);
  assert.equal(result.callRecords.length, 1);
  assert.equal(result.callRecords[0].errorCode, "AI_TIMEOUT");
});

test("S6-03 passes a valid first-round output straight through with a presentation", async () => {
  const tracker: CallerTracker = { calls: 0 };
  const result = await runRideInterpretationV2(baseOptions(scriptedCaller(tracker, [passingScript()])));
  assert.equal(result.source, "v2");
  assert.equal(result.stage, "firstPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(tracker.calls, 1);
  assert.equal(result.callRecords.length, 1);
  assert.equal(result.versions.service, RIDE_INTERPRETATION_SERVICE_V2_VERSION);
  assert.equal(result.versions.model, "test-model");
  assert.ok(result.presentation.dimensions.length > 0);
  assert.equal(result.presentation.repairOutcomeLabel, null);
});

test("S6-03 deterministically organizes a fixable output with no extra model call", async () => {
  const tracker: CallerTracker = { calls: 0 };
  const caller = scriptedCaller(tracker, [
    (invocation) => {
      const output = buildPassingOutput(inputFromPrompt(invocation.promptText));
      return {
        rawText: JSON.stringify({ ...output, schemaVersion: "ride-output-v1.0.0", limitations: [] }),
      };
    },
  ]);
  const result = await runRideInterpretationV2(baseOptions(caller));
  assert.equal(result.source, "v2");
  assert.equal(result.stage, "deterministicRepairPass");
  assert.equal(result.modelRepairCalls, 0);
  assert.equal(tracker.calls, 1);
  assert.equal(result.presentation.repairOutcomeLabel, "本地整理后通过");
});

test("S6-03 performs exactly one model repair and revalidates the repaired output", async () => {
  const tracker: CallerTracker = { calls: 0 };
  const result = await runRideInterpretationV2(
    baseOptions(scriptedCaller(tracker, [stabilityBrokenScript(), passingScript()])),
  );
  assert.equal(result.source, "v2");
  assert.equal(result.stage, "modelRepairPass");
  assert.equal(result.modelRepairCalls, 1);
  // First call + single repair call — never a third attempt.
  assert.equal(tracker.calls, 2);
  assert.equal(result.callRecords.length, 2);
  assert.equal(result.presentation.repairOutcomeLabel, "模型修复后通过");
});

test("S6-03 degrades to b0 REPAIR_FAILED when the single repair still fails", async () => {
  const tracker: CallerTracker = { calls: 0 };
  const result = await runRideInterpretationV2(
    baseOptions(scriptedCaller(tracker, [stabilityBrokenScript(), stabilityBrokenScript()])),
  );
  assert.equal(result.source, "b0");
  assert.equal(result.stage, "repairFailed");
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.ok(result.failureCodes?.includes("STABILITY_WITHOUT_VARIANCE"));
  assert.equal(tracker.calls, 2);
  assert.equal(result.callRecords.length, 2);
});

test("S6-03 parses fenced JSON model responses", async () => {
  const tracker: CallerTracker = { calls: 0 };
  const caller = scriptedCaller(tracker, [
    (invocation) => ({
      rawText: "```json\n" + JSON.stringify(buildPassingOutput(inputFromPrompt(invocation.promptText))) + "\n```",
    }),
  ]);
  const result = await runRideInterpretationV2(baseOptions(caller));
  assert.equal(result.source, "v2");
  assert.equal(result.stage, "firstPass");
});
