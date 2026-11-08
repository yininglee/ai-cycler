import assert from "node:assert/strict";
import test from "node:test";

import {
  chatToolCatalogRouteOf,
  buildChatToolCatalog,
} from "../src/chat/chat-tool-orchestration.ts";
import { makeChatDecision } from "../src/chat/chat-routing.ts";
import { activeChatCapabilities } from "../src/chat/chat-capability-registry.ts";

test("ARCH-02：六个数据标签映射同一 catalog，未开放能力与边界不下发工具", () => {
  for (const route of ["current_ride", "capabilities", "history_compare", "autonomous_tools", "kb_qa", "level_assessment"] as const) {
    assert.equal(chatToolCatalogRouteOf(route), "autonomous_tools");
    assert.ok(buildChatToolCatalog("ride-1", chatToolCatalogRouteOf(route)).tools.length > 0, `${route} 应有工具`);
  }
  for (const route of ["training_plan", "training_supervision", "out_of_scope"]) {
    assert.equal(chatToolCatalogRouteOf(route), "none", `${route} 不应进工具循环`);
    assert.equal(buildChatToolCatalog("ride-1", chatToolCatalogRouteOf(route)).tools.length, 0);
  }
});

test("AGT-B4：kb_qa / level_assessment 的 decision 已是真链路（allowModel + tool_then_model）", () => {
  for (const [route, reasonCode] of [["kb_qa", "KB_QA"], ["level_assessment", "LEVEL_ASSESSMENT"]] as const) {
    const decision = makeChatDecision(route, "none", reasonCode, 12);
    assert.equal(decision.allowModel, true, route);
    assert.equal(decision.action, "tool_then_model", route);
  }
  // F/G 承接的两条仍是占位：零模型、确定性回复
  for (const [route, reasonCode] of [["training_plan", "TRAINING_PLAN"], ["training_supervision", "TRAINING_SUPERVISION"]] as const) {
    const decision = makeChatDecision(route, "none", reasonCode, 12);
    assert.equal(decision.allowModel, false, route);
    assert.equal(decision.action, "deterministic_reply", route);
  }
});

test("ARCH-02：模型目录覆盖已注册能力，每个工具都有用途和输入合同", () => {
  const catalog = buildChatToolCatalog("ride-1");
  assert.deepEqual(catalog.tools.map(({ tool }) => tool), activeChatCapabilities().map(({ tool }) => tool));
  for (const { tool, purpose, input } of catalog.tools) {
    assert.ok(purpose.trim(), `${tool} 缺少用途说明`);
    assert.ok(input, `${tool} 缺少输入合同`);
  }
});
