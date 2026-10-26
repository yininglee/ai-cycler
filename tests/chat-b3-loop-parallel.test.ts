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
  assert.equal(CHAT_TOOL_LOOP_TIMEOUT_MS, 60_000);
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

test("AGT-B3 catalog：四类路由的工具集是固定快照", () => {
  const toolsOf = (route: ChatToolCatalogRoute): ChatToolName[] =>
    buildChatToolCatalog("ride-1", route).tools.map((entry) => entry.tool);

  assert.deepEqual(toolsOf("autonomous_tools"), [
    "get_ride_context", "get_capabilities", "compare_rides", "find_ride",
    "get_health_profile", "get_training_load", "search_knowledge_base",
    "get_ride_history", "get_route_overview",
  ]);
  // AGT-B4 预期变更（§5.5 的 L1 处置）：kb_qa 补 get_health_profile、level_assessment 补
  // search_knowledge_base——真实探针证明"知识问题夹个人基线""评估问题夹合理性解释"都会答漏。
  assert.deepEqual(toolsOf("kb_qa"), ["search_knowledge_base", "get_ride_context", "get_health_profile"]);
  assert.deepEqual(toolsOf("level_assessment"), [
    "get_health_profile", "get_training_load", "get_ride_history", "get_route_overview", "search_knowledge_base",
  ]);
  assert.deepEqual(toolsOf("none"), []);
});

test("AGT-B3 catalog：裁剪真实生效（kb_qa 看不到历史/路线，评估看不到检索类）", () => {
  const kbTools = buildChatToolCatalog("ride-1", "kb_qa").tools.map((entry) => entry.tool);
  assert.equal(kbTools.includes("get_ride_history"), false);
  assert.equal(kbTools.includes("get_route_overview"), false);

  const assessTools = buildChatToolCatalog("ride-1", "level_assessment").tools.map((entry) => entry.tool);
  // AGT-B4：评估现在也要 KB（次诉求是"合理性解释"），但仍不给检索/比较类工具
  assert.equal(assessTools.includes("search_knowledge_base"), true);
  assert.equal(assessTools.includes("find_ride"), false);
  assert.equal(assessTools.includes("compare_rides"), false);

  // 每个下发的工具都必须有输入说明（否则模型无法构造调用）
  for (const route of ["autonomous_tools", "kb_qa", "level_assessment"] as const) {
    for (const entry of buildChatToolCatalog("ride-1", route).tools) {
      assert.ok(Object.keys(entry.input).length > 0, `${entry.tool} 缺输入说明`);
    }
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
