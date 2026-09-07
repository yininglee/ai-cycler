import assert from "node:assert/strict";
import test from "node:test";

import { publicChatAgentResult, runChatAgent, type ChatProvider } from "../src/chat/chat-agent.ts";
import {
  CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES,
  ChatToolOrchestrationError,
  createChatToolRunner,
} from "../src/chat/chat-tool-orchestration.ts";
import { classifyChatInput } from "../src/chat/chat-routing.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";

function privateRecord(fixtureId: string, rideId: string) {
  const fixture = getRideFixture(fixtureId);
  return {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

function repositoryFor(records: Record<string, ReturnType<typeof privateRecord>>, latestRideId: string) {
  const calls: Array<{ ownerId: string; rideId: string }> = [];
  const repository = {
    listRides: async (ownerId: string) => ownerId === "owner-a" ? [{ record: records[latestRideId]!, storedAt: "2026-09-05T00:00:00.000Z" }] : [],
    getRide: async (ownerId: string, rideId: string) => {
      calls.push({ ownerId, rideId });
      return ownerId === "owner-a" ? records[rideId] ?? null : null;
    },
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
  return { repository, calls };
}

class RecordingProvider implements ChatProvider {
  calls: Parameters<ChatProvider["run"]>[0][] = [];

  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    return { rawText: "must not run" };
  }
}

class SequenceProvider implements ChatProvider {
  calls: Parameters<ChatProvider["run"]>[0][] = [];
  private index = 0;
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    return { rawText: this.responses[Math.min(this.index++, this.responses.length - 1)]! };
  }
}

class ToolAnswerProvider implements ChatProvider {
  calls: Parameters<ChatProvider["run"]>[0][] = [];

  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    return {
      rawText: JSON.stringify({
        schemaVersion: "ride-chat-output-v0.1",
        route: "current_ride",
        reply: "本次平均功率是 205 W。",
        claimIds: ["claim:context:1"],
        capabilityKeys: [],
      }),
    };
  }
}

test("tool orchestration selects one minimal current-ride tool call for the newest owner record", async () => {
  const records = {
    "older-ride": privateRecord("l2-fit-heart-rate", "older-ride"),
    "latest-ride": privateRecord("l3-fit-power", "latest-ride"),
  };
  const { repository, calls } = repositoryFor(records, "latest-ride");
  const runner = createChatToolRunner(repository, "owner-a");
  const decision = classifyChatInput("本次骑行平均功率是多少？");
  const result = await runner.run({ text: "本次骑行平均功率是多少？", decision });

  assert.deepEqual(calls, [{ ownerId: "owner-a", rideId: "latest-ride" }]);
  assert.deepEqual(result.trace, { tool: "get_ride_context", status: "completed", dimensions: ["power"], summarySlots: 0 });
  assert.equal(result.context.toolResult.tool, "get_ride_context");
  assert.deepEqual(result.context.recentSummaries, []);
  assert.ok(result.context.recentSummaries.length <= CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES);
});

test("capability orchestration selects a bounded capability scope once", async () => {
  const records = { "latest-ride": privateRecord("l1-built-in-sample", "latest-ride") };
  const { repository, calls } = repositoryFor(records, "latest-ride");
  const runner = createChatToolRunner(repository, "owner-a");
  const decision = classifyChatInput("我可以分析哪些数据？");
  const result = await runner.run({ text: "我可以分析哪些数据？", decision });

  assert.equal(calls.length, 1);
  assert.deepEqual(result.trace.capabilityScope, ["distance", "timing", "speed", "elevation", "heartRate", "power", "cadence", "route"]);
  assert.equal(result.context.toolResult.tool, "get_capabilities");
});

test("missing current ride and orchestration timeout have stable public errors", async () => {
  const noRideRepository = { listRides: async () => [] } as unknown as ApplicationRepository;
  const decision = classifyChatInput("本次骑行平均功率是多少？");
  await assert.rejects(
    () => createChatToolRunner(noRideRepository, "owner-a").run({ text: "本次骑行平均功率是多少？", decision }),
    (error: unknown) => error instanceof ChatToolOrchestrationError && error.code === "TOOLS_NO_CURRENT_RIDE",
  );

  const slowRepository = { listRides: async () => await new Promise<never>(() => {}) } as unknown as ApplicationRepository;
  await assert.rejects(
    () => createChatToolRunner(slowRepository, "owner-a").run({ text: "本次骑行平均功率是多少？", decision }),
    (error: unknown) => error instanceof ChatToolOrchestrationError && error.code === "TOOLS_TIMEOUT",
  );
});

test("invalid tool-route output is rejected without exposing the private tool context", async () => {
  const records = { "latest-ride": privateRecord("l3-fit-power", "latest-ride") };
  const { repository } = repositoryFor(records, "latest-ride");
  const provider = new RecordingProvider();
  const text = "本次骑行平均功率是多少？";
  const result = await runChatAgent({
    text,
    decision: classifyChatInput(text),
    provider,
    toolRunner: createChatToolRunner(repository, "owner-a"),
  });

  assert.equal(result.execution, "template");
  assert.equal(result.modelInvoked, true);
  assert.equal(result.fallbackCode, "REPAIR_FAILED");
  assert.equal(result.outputValidation?.code, "OUTPUT_INVALID_JSON");
  assert.equal(result.repairAttempts, 1);
  assert.equal(provider.calls.length, 2);
  const publicResult = publicChatAgentResult(result);
  assert.equal("toolContext" in publicResult, false);
  assert.equal(JSON.stringify(publicResult).includes("latest-ride"), false);
  assert.equal(JSON.stringify(publicResult).includes("avgPowerW"), false);
});

test("CHAT-07 passes only a de-identified tool projection to the provider and validates its answer", async () => {
  const records = { "latest-ride": privateRecord("l3-fit-power", "latest-ride") };
  const { repository } = repositoryFor(records, "latest-ride");
  const provider = new ToolAnswerProvider();
  const text = "本次骑行平均功率是多少？";
  const result = await runChatAgent({
    text,
    decision: classifyChatInput(text),
    provider,
    toolRunner: createChatToolRunner(repository, "owner-a"),
  });

  assert.equal(result.execution, "validated");
  assert.equal(result.reply, "本次平均功率是 205 W。");
  assert.equal(result.outputValidation?.status, "accepted");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.route, "current_ride");
  assert.equal(provider.calls[0]?.toolContext?.tool, "get_ride_context");
  assert.doesNotMatch(JSON.stringify(provider.calls[0]?.toolContext), /latest-ride|rideId|owner-a/);
  assert.equal("toolContext" in publicChatAgentResult(result), false);
});

test("CHAT-08 repairs a tool answer once while preserving private context boundaries", async () => {
  const records = { "latest-ride": privateRecord("l3-fit-power", "latest-ride") };
  const { repository } = repositoryFor(records, "latest-ride");
  const provider = new SequenceProvider([
    "invalid output with latest-ride",
    JSON.stringify({
      schemaVersion: "ride-chat-output-v0.1",
      route: "current_ride",
      reply: "本次平均功率是 205 W。",
      claimIds: ["claim:context:1"],
      capabilityKeys: [],
    }),
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "current_ride", reply: "third call", claimIds: ["claim:context:1"], capabilityKeys: [] }),
  ]);
  const text = "本次骑行平均功率是多少？";
  const result = await runChatAgent({
    text,
    decision: classifyChatInput(text),
    provider,
    toolRunner: createChatToolRunner(repository, "owner-a"),
  });

  assert.equal(result.execution, "repaired");
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.reply, "本次平均功率是 205 W。");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[1]?.repairInstruction?.includes("OUTPUT_INVALID_JSON"), true);
  assert.doesNotMatch(JSON.stringify(provider.calls[1]?.toolContext), /latest-ride|owner-a|rideId/);
  assert.doesNotMatch(JSON.stringify(publicChatAgentResult(result)), /latest-ride|owner-a|avgPowerW/);
});
