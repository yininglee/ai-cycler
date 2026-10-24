import assert from "node:assert/strict";
import test from "node:test";

import { aggregateOverviewReply, aggregateReply, buildChatHomeSnapshot, chatInitialMessage, chatQuickQuestions, classifyAggregateQuestion, replyToQuickQuestion } from "../src/chat/chat-home.ts";
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

test("chat quick questions return deterministic snapshot answers", () => {
  const snapshot = buildChatHomeSnapshot([recordWithId("first", "2026-09-01T02:00:00.000Z", 12_500)], new Date("2026-09-04T12:00:00.000Z"));
  assert.equal(chatQuickQuestions().length, 4);
  assert.equal(replyToQuickQuestion("total", snapshot), "目前已记录 1 次骑行，累计 12.5 km。");
  assert.match(replyToQuickQuestion("week", snapshot), /本周已记录 1 次骑行/);
  assert.match(replyToQuickQuestion("latest", snapshot), /9\/1/);
  assert.match(replyToQuickQuestion("capabilities", snapshot), /当前可用的是/);
});

// 2026-10-24 回归：前端曾用 replyToChatInput（本地正则）在服务端失败时兜底作答，
// 问「上次我的骑行心率多少？」被 /(最近|上次).*(骑行|记录)/ 命中答成"最近记录日期"。
// 该兜底已退役——业务答案只能来自服务端。此测试锁住"指标类问法不会被判成 latest/日期类"。
test("metric questions are never downgraded to a date answer", () => {
  for (const input of ["上次我的骑行心率多少？", "上次我的骑行心率怎么样？", "最近一次骑行功率多少？"]) {
    assert.equal(classifyAggregateQuestion(input), null, `${input} 必须交服务端单次记录链路，不得按"最近记录日期"作答`);
  }
});

test("aggregate route without a recognized kind gets a factual overview, not a refusal", () => {
  const records = [recordWithId("first", "2026-09-01T02:00:00.000Z", 12_500)];
  const now = new Date("2026-09-04T12:00:00.000Z");
  // 「我最近骑行数据怎么样」抽不出 total/week/latest 口径 —— 旧实现在这里回"我不会猜测骑行数据"
  assert.equal(classifyAggregateQuestion("我最近骑行数据怎么样？"), null);
  const overview = aggregateOverviewReply(records, now);
  assert.match(overview, /已记录 1 次骑行，累计 12\.5 km/);
  assert.match(overview, /本周 1 次、12\.5 km/);
  assert.match(overview, /最近一次是 9\/1/);
  assert.doesNotMatch(overview, /不会猜测/);
  // 无记录时给导入引导，而不是空口总览
  assert.match(aggregateOverviewReply([], now), /还没有可汇总的骑行记录/);
});

test("chat home does not suggest missing data or unavailable capabilities for a new session", () => {
  const snapshot = buildChatHomeSnapshot([], new Date("2026-09-04T12:00:00.000Z"));
  assert.match(chatInitialMessage(snapshot), /导入一条骑行记录后/);
  assert.doesNotMatch(chatInitialMessage(snapshot), /数据不足/);
  assert.match(replyToQuickQuestion("capabilities", snapshot), /导入骑行记录后/);
});

test("aggregate questions are classified and answered deterministically on the server side", () => {
  const records = [recordWithId("first", "2026-09-01T02:00:00.000Z", 12_500)];

  // CHAT-12 P1（G-AGGREGATE）：聚合问题服务端确定性作答，与 classifyChatInput 的 "aggregate" 路由口径一致
  assert.equal(classifyAggregateQuestion("我总共骑了多少"), "total");
  assert.equal(classifyAggregateQuestion("这周骑了多少？"), "week");
  assert.equal(classifyAggregateQuestion("我最近一次骑行是什么时候？"), "latest");
  // G-IDENTITY：骑行身份问题（“当次是哪一次”）归类为最近一次日期，与 RIDE_IDENTITY 路由口径一致
  assert.equal(classifyAggregateQuestion("当次是哪一次？"), "latest");
  assert.equal(classifyAggregateQuestion("单次是哪一次"), "latest");
  assert.equal(classifyAggregateQuestion("最近一次骑行是哪一次？"), "latest");
  assert.equal(classifyAggregateQuestion("本次是哪一次？"), "latest");
  assert.equal(classifyAggregateQuestion("你说的是哪次？"), "latest");
  assert.equal(classifyAggregateQuestion("   "), null);
  // 单次骑行范围与指标类问题不归类为聚合，继续走服务端模型链路
  assert.equal(classifyAggregateQuestion("本次骑行距离是多少公里？"), null);
  assert.equal(classifyAggregateQuestion("本次骑行一共骑了多远"), null);
  assert.equal(classifyAggregateQuestion("上次骑了多远？"), null);
  assert.equal(classifyAggregateQuestion("你好"), null);
  assert.equal(classifyAggregateQuestion("目前可以分析哪些数据？"), null);

  assert.match(aggregateReply("total", records, new Date("2026-09-04T12:00:00.000Z")), /累计 12.5 km/);
  assert.match(aggregateReply("week", records, new Date("2026-09-04T12:00:00.000Z")), /本周已记录 1 次骑行/);
  assert.match(aggregateReply("latest", records, new Date("2026-09-04T12:00:00.000Z")), /9\/1/);
});
