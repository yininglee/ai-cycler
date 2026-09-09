import assert from "node:assert/strict";
import test from "node:test";

import { publicChatAgentResult, runChatAgent, type ChatProvider } from "../src/chat/chat-agent.ts";
import {
  CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES,
  ChatToolOrchestrationError,
  createChatToolRunner,
} from "../src/chat/chat-tool-orchestration.ts";
import { chatComparisonMetricKeys } from "../src/chat/chat-tools.ts";
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

// CHAT-13：比较测试记录——覆盖出发时间与距离（均速同比例缩放保持 INCONSISTENT_AVG_SPEED 口径一致）。
function comparisonRecord(fixtureId: string, rideId: string, startTime: string, distanceKm: number) {
  const record = privateRecord(fixtureId, rideId);
  const originalDistanceM = record.activity.metrics.distanceM!.value;
  const avgSpeed = record.activity.metrics.avgSpeedMps;
  record.activity.startTime = startTime;
  record.activity.metrics.distanceM = { ...record.activity.metrics.distanceM!, value: distanceKm * 1_000 };
  if (avgSpeed) {
    record.activity.metrics.avgSpeedMps = { ...avgSpeed, value: (avgSpeed.value * distanceKm * 1_000) / originalDistanceM };
  }
  return record;
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
  // CHAT-14：显式序数（“最近一次”）锚定最新记录；裸“本次”指涉现在会触发锚点澄清（见 chat-ride-anchor 测试）。
  const decision = classifyChatInput("最近一次骑行平均功率是多少？");
  const result = await runner.run({ text: "最近一次骑行平均功率是多少？", decision });

  assert.deepEqual(calls, [{ ownerId: "owner-a", rideId: "latest-ride" }]);
  assert.deepEqual(result.trace, { tool: "get_ride_context", status: "completed", dimensions: ["power"], summarySlots: 0 });
  assert.equal(result.context.toolResult.tool, "get_ride_context");
  assert.deepEqual(result.context.sessionSummaries, []);
  assert.ok(result.context.sessionSummaries.length <= CHAT_TOOL_ORCHESTRATION_MAX_SUMMARIES);
});

// CHAT-15（真实链路采样发现）：「当前骑行」应取出发时间最新的记录，
// 而非最近导入（storedAt 序）——补导旧文件不改变“最近一次骑行”语义（与 /chat 首页口径一致）。
test("anchor selection uses latest startTime, not most recent import (CHAT-15)", async () => {
  const reimportedOld = comparisonRecord("l1-built-in-sample", "reimported-old", "2026-07-22T02:10:17.000Z", 50);
  const newerRide = comparisonRecord("l1-built-in-sample", "newer-ride", "2026-08-19T22:26:26.000Z", 42);
  const calls: Array<{ ownerId: string; rideId: string }> = [];
  const repository = {
    // storedAt 倒序：最近导入的是 startTime 较旧的记录（复现真实数据形态）。
    listRides: async (ownerId: string) => ownerId === "owner-a"
      ? [{ record: reimportedOld, storedAt: "2026-09-08T00:00:00.000Z" }, { record: newerRide, storedAt: "2026-09-01T00:00:00.000Z" }]
      : [],
    getRide: async (ownerId: string, rideId: string) => {
      calls.push({ ownerId, rideId });
      return ownerId === "owner-a" ? (rideId === "reimported-old" ? reimportedOld : rideId === "newer-ride" ? newerRide : null) : null;
    },
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
  const runner = createChatToolRunner(repository, "owner-a");

  const text = "最近一次骑行平均功率是多少？";
  await runner.run({ text, decision: classifyChatInput(text) });
  assert.deepEqual(calls, [{ ownerId: "owner-a", rideId: "newer-ride" }]);
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

// CHAT-13：历史比较编排——锚点为最新一条本人记录，窗口冻结 30 天，
// 比较问法映射到指标白名单子集，未提及指标时取全量白名单。

test("history_compare orchestration anchors the newest ride on the frozen 30-day window (CHAT-13)", async () => {
  const records = {
    "history-older": comparisonRecord("l1-built-in-sample", "history-older", "2026-08-10T08:00:00Z", 30),
    "history-recent": comparisonRecord("l1-built-in-sample", "history-recent", "2026-08-15T08:00:00Z", 36),
    "anchor-ride": comparisonRecord("l1-built-in-sample", "anchor-ride", "2026-08-20T08:00:00Z", 42),
  };
  const rideIds = ["anchor-ride", "history-recent", "history-older"] as const;
  const repository = {
    listRides: async (ownerId: string) => ownerId === "owner-a"
      ? rideIds.map((rideId) => ({ record: records[rideId], storedAt: "2026-09-05T00:00:00.000Z" }))
      : [],
    getRide: async (ownerId: string, rideId: string) => ownerId === "owner-a" ? records[rideId as keyof typeof records] ?? null : null,
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
  const runner = createChatToolRunner(repository, "owner-a");

  const text = "最近一次骑行比上次骑得远吗？";
  const result = await runner.run({ text, decision: classifyChatInput(text) });
  assert.deepEqual(result.trace, { tool: "compare_rides", status: "completed", comparisonMetrics: ["distanceM"], summarySlots: 0 });
  assert.equal(result.context.toolResult.tool, "compare_rides");
  if (result.context.toolResult.tool !== "compare_rides") return;
  assert.equal(result.context.toolResult.windowDays, 30);
  assert.equal(result.context.toolResult.comparability.status, "comparable");
  const claim = result.context.toolResult.claims.find((item) => item.metricKey === "distanceM" && item.scope === "all");
  assert.equal(claim?.anchor?.displayValue, "42.0");
  assert.equal(claim?.baseline?.displayValue, "33.0");

  const broadText = "我最近的骑行有进步吗？";
  const broad = await runner.run({ text: broadText, decision: classifyChatInput(broadText) });
  assert.deepEqual(broad.trace.comparisonMetrics, [...chatComparisonMetricKeys]);
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
  const text = "最近一次骑行平均功率是多少？";
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
  const text = "最近一次骑行平均功率是多少？";
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
  const text = "最近一次骑行平均功率是多少？";
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
