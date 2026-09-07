import assert from "node:assert/strict";
import test from "node:test";

import { buildChatHomeSnapshot, chatInitialMessage, chatQuickQuestions, replyToChatInput, replyToQuickQuestion } from "../src/chat/chat-home.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

function recordWithId(id: string, startTime: string, distanceM: number) {
  const fixture = getRideFixture("l3-power-preview");
  return {
    ...fixture,
    activity: { ...fixture.activity, rideId: id, startTime, metrics: { ...fixture.activity.metrics, distanceM: { ...fixture.activity.metrics.distanceM!, value: distanceM } } },
    series: { ...fixture.series, rideId: id },
  };
}

test("chat home snapshot exposes only aggregate facts and available capabilities", () => {
  const snapshot = buildChatHomeSnapshot([
    recordWithId("first", "2026-09-01T02:00:00.000Z", 12_500),
    recordWithId("second", "2026-08-20T02:00:00.000Z", 20_000),
  ], new Date("2026-09-04T12:00:00.000Z"));

  assert.deepEqual(snapshot, {
    version: "chat-home-v0.1",
    totalRideCount: 2,
    totalDistanceKm: 32.5,
    weekRideCount: 1,
    weekDistanceKm: 12.5,
    latestRideDateLabel: "9/1",
    capabilities: ["ride_summary", "heart_rate", "power", "cadence"],
  });
  assert.match(chatInitialMessage(snapshot), /累计骑行 2 次 · 总里程 32.5 km/);
});

test("chat quick questions and typed input return deterministic snapshot answers", () => {
  const snapshot = buildChatHomeSnapshot([recordWithId("first", "2026-09-01T02:00:00.000Z", 12_500)], new Date("2026-09-04T12:00:00.000Z"));
  assert.equal(chatQuickQuestions().length, 4);
  assert.equal(replyToQuickQuestion("total", snapshot), "目前已记录 1 次骑行，累计 12.5 km。");
  assert.match(replyToChatInput("这周骑了多少？", snapshot)!, /本周已记录 1 次骑行/);
  assert.match(replyToChatInput("现在有哪些数据？", snapshot)!, /当前可用的是/);
  assert.match(replyToChatInput("给我一份训练计划", snapshot)!, /尚未开放/);
  assert.equal(replyToChatInput("   ", snapshot), null);
});

test("chat home does not suggest missing data or unavailable capabilities for a new session", () => {
  const snapshot = buildChatHomeSnapshot([], new Date("2026-09-04T12:00:00.000Z"));
  assert.match(chatInitialMessage(snapshot), /导入一条骑行记录后/);
  assert.doesNotMatch(chatInitialMessage(snapshot), /数据不足/);
  assert.match(replyToQuickQuestion("capabilities", snapshot), /导入骑行记录后/);
});
