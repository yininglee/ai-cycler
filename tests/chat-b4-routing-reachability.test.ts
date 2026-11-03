// AGT-B4：路由可达性与能力面收口单测。
//
// 归口细规划 §7 AGT-B4 退出条件：两路由端到端可达（catalog 与 decision 双侧）、
// training_plan/training_supervision 仍占位、capabilities 文案与 9 工具一致（机械比对）。

import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_WORKFLOW_SYSTEM_PROMPT } from "../src/chat/chat-workflow-prompt.ts";
import {
  CHAT_TOOL_CATALOG_SCOPE,
  chatToolCatalogRouteOf,
  buildChatToolCatalog,
} from "../src/chat/chat-tool-orchestration.ts";
import { makeChatDecision } from "../src/chat/chat-routing.ts";
import type { ChatToolName } from "../src/chat/chat-tools.ts";

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

// capabilities 文案与 9 工具的一致性：每个工具对应一句"用户可感知的能力表述"，
// Prompt 的固定清单里必须出现——防止"工具加了但'我能做什么'还是旧话术"。
const TOOL_CAPABILITY_PHRASES: Record<ChatToolName, string> = {
  get_training_execution: "今日训练与已有评估",
  prepare_training_record_link: "骑行记录确认关联",
  assess_training_execution: "训练执行评估",
  get_training_plan_context: "训练计划上下文",
  prepare_training_plan: "计划信息补充",
  propose_training_plan: "训练计划草案",
  prepare_ride_import: "骑行同步与文件导入入口",
  get_user_context: "个人资料查看",
  show_onboarding: "首次使用引导",
  prepare_profile_proposal: "资料核对提案",
  get_ride_context: "单次骑行数据解读",
  get_capabilities: "支持分析哪些数据",
  compare_rides: "与最近 30 天历史的比较",
  find_ride: "跨记录的条件检索与排名",
  get_health_profile: "身体基线",
  get_training_load: "训练负荷趋势",
  search_knowledge_base: "骑行科学知识问答",
  get_ride_history: "最近 90 天到 1 年的骑行统计",
  get_route_overview: "单次路线爬坡概要",
};

test("AGT-B4：capabilities 清单覆盖当前全部工具（机械比对）", () => {
  const tools = CHAT_TOOL_CATALOG_SCOPE.autonomous_tools;
  assert.equal(tools.length, 19);
  for (const tool of tools) {
    const phrase = TOOL_CAPABILITY_PHRASES[tool];
    assert.ok(phrase, `${tool} 缺能力表述映射`);
    assert.ok(
      CHAT_WORKFLOW_SYSTEM_PROMPT.includes(phrase),
      `Prompt 能力清单缺「${phrase}」（对应工具 ${tool}）——能力面与工具面不一致`,
    );
  }
  // 未开放的两项必须明说，防止模型自己编"训练计划已支持"
  assert.ok(CHAT_WORKFLOW_SYSTEM_PROMPT.includes("不自动关联记录"));
});
