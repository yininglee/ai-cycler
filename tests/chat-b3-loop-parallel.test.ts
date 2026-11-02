// AGT-B3：循环扩展（并行 / 预算拆分 / catalog 按路由裁剪）单测。
//
// 归口细规划 §7 AGT-B3 退出条件：并发正确性（并行总耗时 < 串行下界之和、被拒调用整体不执行）、
// 预算边界（第 5 次允许 / 第 6 次拒绝 / 45s 时限）、catalog 裁剪快照、
// `claim:loop:N` 编号在并行下按请求顺序稳定。

import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND,
  CHAT_TOOL_LOOP_MAX_PROVIDER_CALLS,
  CHAT_TOOL_LOOP_MAX_TOOL_CALLS,
  CHAT_TOOL_LOOP_TIMEOUT_MS,
  buildChatToolCatalog,
  createChatToolLoopRunner,
  parseChatToolCallRequest,
  type ChatToolCatalogRoute,
} from "../src/chat/chat-tool-orchestration.ts";
import type { ChatToolName } from "../src/chat/chat-tools.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

function record(fixtureId: string, rideId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  return {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

/** 按 rideId 注入执行延迟的仓库：用来观察"并行 vs 串行"的真实耗时差异。 */
function delayedRepository(records: Record<string, RideRecord>, delays: Record<string, number>) {
  const state = { getRideCalls: 0 };
  const repository = {
    listRides: async (ownerId: string) => ownerId === "owner-a"
      ? Object.values(records).map((item) => ({ record: item, storedAt: "2026-09-05T00:00:00.000Z" }))
      : [],
    getRide: async (ownerId: string, rideId: string) => {
      state.getRideCalls += 1;
      await sleep(delays[rideId] ?? 0);
      return ownerId === "owner-a" ? records[rideId] ?? null : null;
    },
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
  return { repository, state };
}

test("AGT-B3 预算：D-B5 四个值落地，且单轮上限与累计预算已拆分", () => {
  assert.equal(CHAT_TOOL_LOOP_MAX_TOOL_CALLS, 5);
  assert.equal(CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND, 4);
  assert.equal(CHAT_TOOL_LOOP_MAX_PROVIDER_CALLS, 6);
  // AGT-B5 预期变更（2026-10-25 用户拍板）：45s → 60s（单次 25s×2 轮不再被整轮截断）
  // AGT-B5（2026-10-26）：60s → 90s——单次超时提到 35s 后复合问法需要 2~3 次调用，
  // 60s 会先撞循环预算。改这一行属于预期变更，依据见 provider 超时上限注释。
  assert.equal(CHAT_TOOL_LOOP_TIMEOUT_MS, 90_000);
  // 拆分后的独立性：单轮上限必须 ≤ 累计预算，否则"一轮就超预算"。
  assert.ok(CHAT_TOOL_LOOP_MAX_CALLS_PER_ROUND <= CHAT_TOOL_LOOP_MAX_TOOL_CALLS);
});

test("AGT-B3 协议：单轮 calls 上限 4（第 5 个请求整条被拒，不是截断执行）", () => {
  const four = JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
  ] });
  assert.equal(parseChatToolCallRequest(four)?.calls.length, 4);

  const five = JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
    { tool: "get_ride_context", input: {} },
  ] });
  // 超过单轮上限时整条请求判非法（模型改成分两轮），不做静默截断——截断会让模型
  // 以为 5 个调用都执行了，从而引用不存在的结果。
  assert.equal(parseChatToolCallRequest(five), undefined);
});

test("AGT-B3 并发：3 次调用并行执行，总耗时明显低于串行下界之和", async () => {
  const records = {
    "slow-a": record("l3-fit-power", "slow-a"),
    "slow-b": record("l3-fit-power", "slow-b"),
    "slow-c": record("l3-fit-power", "slow-c"),
  };
  const delay = 120;
  const { repository } = delayedRepository(records, { "slow-a": delay, "slow-b": delay, "slow-c": delay });
  const runner = createChatToolLoopRunner(repository, "owner-a");

  const startedAt = Date.now();
  const receipts = await runner.executeLoopCalls({
    calls: ["slow-a", "slow-b", "slow-c"].map((rideId) => ({ tool: "get_ride_context", input: { rideId, dims: ["summary"] } })),
    anchorRideId: "slow-a",
    allowedRideIds: ["slow-a", "slow-b", "slow-c"],
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(receipts.length, 3);
  assert.ok(receipts.every((receipt) => receipt.status === "completed"), "三次调用都应成功");
  // 串行下界 = 3 × 120ms = 360ms；并行应在 1 个 delay 量级（留足 CI 抖动余量）。
  assert.ok(elapsed < delay * 2.5, `并行耗时 ${elapsed}ms 应显著低于串行下界 ${delay * 3}ms`);
});

test("AGT-B3 并发：reports 顺序按请求顺序而非完成顺序（claim:loop:N 编号稳定前提）", async () => {
  const records = {
    "ride-slow": record("l3-fit-power", "ride-slow"),
    "ride-fast": record("l3-fit-power", "ride-fast"),
  };
  // 第 1 个请求慢、第 2 个快：并行下 fast 先完成，但 receipts[0] 必须仍是 slow。
  const { repository } = delayedRepository(records, { "ride-slow": 100, "ride-fast": 5 });
  const runner = createChatToolLoopRunner(repository, "owner-a");

  const receipts = await runner.executeLoopCalls({
    calls: [
      { tool: "get_ride_context", input: { rideId: "ride-slow", dims: ["summary"] } },
      { tool: "get_ride_context", input: { rideId: "ride-fast", dims: ["summary"] } },
    ],
    anchorRideId: "ride-slow",
    allowedRideIds: ["ride-slow", "ride-fast"],
  });

  assert.equal(receipts.length, 2);
  const first = receipts[0];
  const second = receipts[1];
  assert.equal(first?.status === "completed" ? first.result.tool : "", "get_ride_context");
  assert.deepEqual(
    receipts.map((receipt) => (receipt.status === "completed" && "rideId" in receipt.result ? receipt.result.rideId : undefined)),
    ["ride-slow", "ride-fast"],
  );
  assert.ok(second);
});

test("AGT-B3 先校验后执行：任一调用非法则整轮一次都不执行", async () => {
  const records = { "ride-a": record("l3-fit-power", "ride-a") };
  const { repository, state } = delayedRepository(records, {});
  const runner = createChatToolLoopRunner(repository, "owner-a");

  const receipts = await runner.executeLoopCalls({
    calls: [
      { tool: "get_ride_context", input: { rideId: "ride-a", dims: ["summary"] } },
      // 非法：白名单外工具（第二个位置才非法——旧串行实现会先执行第一个）
      { tool: "delete_ride", input: {} },
    ],
    anchorRideId: "ride-a",
    allowedRideIds: ["ride-a"],
  });

  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.status, "rejected");
  // 关键断言：合法的第一个调用**没有被执行**（先全量校验再执行的语义）
  assert.equal(state.getRideCalls, 0, "整轮被拒时不应对任何记录发起读取");
});

test("AGT-B3 越权锚点：并行路径同样拦截（allowedRideIds 之外）", async () => {
  const records = { "mine": record("l3-fit-power", "mine"), "theirs": record("l3-fit-power", "theirs") };
  const { repository } = delayedRepository(records, {});
  const runner = createChatToolLoopRunner(repository, "owner-a");

  const receipts = await runner.executeLoopCalls({
    calls: [{ tool: "get_ride_context", input: { rideId: "theirs", dims: ["summary"] } }],
    anchorRideId: "mine",
    allowedRideIds: ["mine"],
  });
  assert.equal(receipts[0]?.status, "rejected");
  assert.equal(receipts[0]?.status === "rejected" ? receipts[0].errorCode : "", "RIDE_NOT_ALLOWED");
});

// ---- catalog 按路由裁剪（§5.3 快照）----

test("ARCH-02 catalog: old data labels share the full implemented registry", () => {
  const tools = buildChatToolCatalog("ride-1").tools;
  assert.equal(tools.length, 14);
  for (const route of ["autonomous_tools", "kb_qa", "level_assessment"] as const) {
    assert.deepEqual(buildChatToolCatalog("ride-1", route).tools, tools);
  }
  assert.deepEqual(buildChatToolCatalog("ride-1", "none").tools, []);
});

test("ARCH-02 catalog: compound queries can access data, comparison and knowledge together", () => {
  for (const route of ["kb_qa", "level_assessment"] as const) {
    const catalog = buildChatToolCatalog("ride-1", route);
    for (const tool of ["get_ride_history", "get_route_overview", "find_ride", "compare_rides", "search_knowledge_base"]) {
      assert.ok(catalog.tools.some(entry => entry.tool === tool));
    }
    assert.ok(catalog.tools.every(entry => typeof entry.input === "object" && entry.purpose.length));
  }
});

test("AGT-B3 catalog：全局工具（无锚点）的输入说明里不含 rideId", () => {
  const catalog = buildChatToolCatalog("ride-1", "autonomous_tools");
  for (const tool of ["get_health_profile", "get_training_load", "search_knowledge_base"] as const) {
    const entry = catalog.tools.find((item) => item.tool === tool);
    assert.ok(entry, `catalog 缺 ${tool}`);
    assert.equal("rideId" in (entry?.input ?? {}), false, `${tool} 不应有 rideId 参数`);
  }
});
