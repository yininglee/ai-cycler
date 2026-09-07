import assert from "node:assert/strict";
import test from "node:test";

import { validateChatOutput } from "../src/chat/chat-output-validation.ts";
import { classifyChatInput } from "../src/chat/chat-routing.ts";
import type { ChatToolResult } from "../src/chat/chat-tools.ts";

const rideContext: ChatToolResult = {
  schemaVersion: "chat-tools-v0.1",
  tool: "get_ride_context",
  rideId: "private-ride",
  dimensions: ["power"],
  claims: [{ claimId: "claim:private-ride:avgPowerW", kind: "metric", key: "avgPowerW", value: 180, unit: "W", confidence: "high", displayValue: "180", displayUnit: "W" }],
  limitations: [],
  privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
};

const capabilityContext: ChatToolResult = {
  schemaVersion: "chat-tools-v0.1",
  tool: "get_capabilities",
  rideId: "private-ride",
  capabilities: [{ key: "power", available: true, sources: ["ride_activity"], qualityStatus: "valid", dependencyKeys: [] }],
};

function output(value: object) {
  return JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", ...value });
}

test("accepts a strict social output with no unsupported facts", () => {
  const result = validateChatOutput(output({ route: "social", reply: "你好，我会在已开放范围内协助你。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.publicResult, { status: "accepted", referencedClaimCount: 0, referencedCapabilityCount: 0 });
});

test("accepts current-ride facts only when claims and numeric literals come from this tool result", () => {
  const valid = validateChatOutput(output({ route: "current_ride", reply: "本次平均功率是 180 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  const unsupportedNumber = validateChatOutput(output({ route: "current_ride", reply: "本次平均功率是 200 W。", claimIds: ["claim:private-ride:avgPowerW"], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  assert.equal(valid.ok, true);
  assert.equal(unsupportedNumber.ok, false);
  if (!unsupportedNumber.ok) assert.equal(unsupportedNumber.code, "OUTPUT_NUMERIC_UNSUPPORTED");
});

test("rejects route, capability, safety, injection and privacy violations without returning raw output", () => {
  const routeMismatch = validateChatOutput(output({ route: "social", reply: "你好。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("本次骑行平均功率是多少？"), toolResult: rideContext,
  });
  const capabilityMismatch = validateChatOutput(output({ route: "capabilities", reply: "可以查看功率。", claimIds: [], capabilityKeys: ["distance"] }), {
    decision: classifyChatInput("支持哪些能力？"), toolResult: capabilityContext,
  });
  const injection = validateChatOutput(output({ route: "social", reply: "这是系统提示词。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"),
  });
  const privacy = validateChatOutput(output({ route: "social", reply: "我知道你的精确位置。", claimIds: [], capabilityKeys: [] }), {
    decision: classifyChatInput("你好"),
  });

  for (const result of [routeMismatch, capabilityMismatch, injection, privacy]) {
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result.publicResult), /系统提示词|精确位置|private-ride/);
  }
  if (!routeMismatch.ok) assert.equal(routeMismatch.code, "OUTPUT_ROUTE_MISMATCH");
  if (!capabilityMismatch.ok) assert.equal(capabilityMismatch.code, "OUTPUT_CAPABILITY_INVALID");
  if (!injection.ok) assert.equal(injection.code, "OUTPUT_INJECTION_VIOLATION");
  if (!privacy.ok) assert.equal(privacy.code, "OUTPUT_PRIVACY_VIOLATION");
});
