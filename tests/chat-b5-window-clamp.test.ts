// AGT-B5：窗口越界钳制（首轮编排 Run 暴露的真缺陷）。
//
// 模型会把"三年前"算成 windowDays=1095 传进来。旧行为：超上限 → INVALID_TOOL_CALL →
// 整轮失败（用户拿到"这个查询请求不在允许范围内"）。新行为：**钳制到上限**，工具照常
// 返回"最近 365 天"的数据。
//
// 边界必须分清：越界（> 上限，整数）→ 钳制；真·非法（0 / 负数 / 非整数 / 非数字）→ 仍拒绝。

import assert from "node:assert/strict";
import test from "node:test";

import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";

function emptyRepository(): ApplicationRepository {
  return {
    listRides: async () => [],
    getRide: async () => null,
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
}

test("AGT-B5：windowDays 越界被钳制到上限，而不是判非法（整轮不再失败）", async () => {
  const runner = createChatToolLoopRunner(emptyRepository(), "owner-a");

  // find_ride：三年前 → 1095 天，钳到 365
  const findReceipt = await runner.executeLoopCalls({
    // find_ride 的 rideId 是"可选、缺省用锚点"（不接受显式 null，那是 get_ride_history 的语义）
    calls: [{ tool: "find_ride", input: { metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 1095 } }],
    anchorRideId: "anchor",
    allowedRideIds: ["anchor"],
  });
  assert.notEqual(findReceipt[0]?.status, "rejected", `越界应钳制而非拒绝，实际：${JSON.stringify(findReceipt[0])}`);

  // get_ride_history：同样钳到 365
  const historyReceipt = await runner.executeLoopCalls({
    calls: [{ tool: "get_ride_history", input: { rideId: null, windowDays: 2000, metrics: ["distanceM"] } }],
    anchorRideId: "anchor",
    allowedRideIds: ["anchor"],
  });
  assert.notEqual(historyReceipt[0]?.status, "rejected", "get_ride_history 越界应钳制");

  // 钳制后工具仍能正常执行（空仓库返回 no_match，而不是 INVALID_TOOL_CALL）
  const completed = historyReceipt[0];
  assert.equal(completed?.status, "completed");
  if (completed?.status === "completed" && completed.result.tool === "get_ride_history") {
    assert.equal(completed.result.windowDays, 365, "结果里的 windowDays 应是钳制后的上限，模型据此说明范围");
  }
});

test("AGT-B5：真·非法窗口仍拒绝（0 / 负数 / 非整数），不做猜测性钳制", async () => {
  const runner = createChatToolLoopRunner(emptyRepository(), "owner-a");
  for (const bad of [0, -5, 1.5]) {
    const receipts = await runner.executeLoopCalls({
      calls: [{ tool: "get_ride_history", input: { rideId: null, windowDays: bad, metrics: ["distanceM"] } }],
      anchorRideId: "anchor",
      allowedRideIds: ["anchor"],
    });
    assert.equal(receipts[0]?.status, "rejected", `windowDays=${bad} 应判非法`);
  }
});
