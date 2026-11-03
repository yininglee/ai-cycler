// AGT-B0：合同层单测——六个缺口 + 校验层误拦修正的正反例对照。
//
// 这个文件的每条断言都对应细规划 §2 的一个缺口编号（G1~G6）或 §2.1 的一条口径。
// 反向用例（"该拦的仍要拦"）与正向用例成对出现——只测"放宽"不测"仍拦"，等于把
// 硬门改成了放行开关。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { claimNumericVariants } from "../src/ai/ride-interpretation-output-v04-candidate.ts";
import { CHAT_WORKFLOW_PROMPT_VERSION, CHAT_WORKFLOW_SYSTEM_PROMPT } from "../src/chat/chat-workflow-prompt.ts";
import {
  chatNumbersSupported,
  chatNumericVariants,
  chatNumberTokens,
  type ChatNumericFact,
} from "../src/chat/chat-numeric-evidence.ts";
import {
  chatKnowledgeDimensionIds,
  chatToolAnchorMode,
  chatToolEvidenceKind,
  chatToolSpecs,
  type ChatToolResult,
  type KnowledgeSearchToolResult,
  type RideContextToolResult,
} from "../src/chat/chat-tools.ts";
import { validateChatOutput } from "../src/chat/chat-output-validation.ts";
import type { ChatRoutingDecision } from "../src/chat/chat-routing.ts";

function decision(route: ChatRoutingDecision["route"], reasonCode: ChatRoutingDecision["reasonCode"]): ChatRoutingDecision {
  // 输出校验只读 decision.route；risk/action 取合法枚举值即可（不影响证据判定）。
  return {
    schemaVersion: "chat-routing-v0.2",
    route,
    risk: "none",
    allowModel: true,
    action: "tool_then_model",
    reasonCode,
    normalizedLength: 10,
  };
}

function rideContextResult(claims: RideContextToolResult["claims"]): RideContextToolResult {
  return {
    schemaVersion: "chat-tools-v0.2",
    tool: "get_ride_context",
    rideId: "ride-1",
    rideDateLabel: "2026年10月5日",
    dimensions: ["summary"],
    claims,
    limitations: [],
    privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

const distanceClaim = {
  claimId: "claim:ride:distanceM",
  kind: "metric" as const,
  key: "distanceM",
  value: 30_400,
  unit: "m",
  confidence: "high" as const,
  displayValue: "30.4",
  displayUnit: "km",
};

function knowledgeResult(): KnowledgeSearchToolResult {
  return {
    schemaVersion: "chat-tools-v0.2",
    tool: "search_knowledge_base",
    status: "matched",
    dimensionIds: ["pacingExecution"],
    keywords: [],
    availableDimensionIds: [...chatKnowledgeDimensionIds],
    items: [{
      knowledgeId: "kb-v21-pacingExecution",
      dimensionId: "pacingExecution",
      topic: "配速执行",
      title: "配速执行维度知识",
      conclusionStrength: "moderate",
      limitations: ["负分割存在个体差异"],
      excerpt: "负分割通常指后半程输出高于前半程，需以标准化功率判断而非平均功率。",
    }],
    privacy: ["public_knowledge_only"],
  };
}

function output(route: string, reply: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: "ride-chat-output-v0.2",
    route,
    reply,
    claimIds: [],
    capabilityKeys: [],
    knowledgeIds: [],
    ...extra,
  });
}

// ---- G4：数值等价类（chat-numeric-evidence）----

test("AGT-B0 G4：同一事实的舍入/单位换算/比例呈现都算合法", () => {
  const facts: ChatNumericFact[] = [
    { value: 30_400, unit: "m", key: "distanceM", displayValue: "30.4" },
    { value: 8.444, unit: "m/s", displayValue: "30.4" },
    { value: 5_400, unit: "s", key: "elapsedTimeS", displayValue: "90" },
    { value: 0.5, unit: "ratio", key: "normalizedPowerRatio" },
  ];
  // 口语近似（30.4 → "约 30"）——这是旧实现最主要的误拦点。
  assert.equal(chatNumbersSupported("这次骑行大约 30 公里。", facts), true);
  // 精确引用
  assert.equal(chatNumbersSupported("这次骑行 30.4 公里。", facts), true);
  // 米制呈现
  assert.equal(chatNumbersSupported("这次骑行 30400 米。", facts), true);
  // 速度换算（8.444 m/s = 30.4 km/h）
  assert.equal(chatNumbersSupported("平均速度约 30 公里每小时。", facts), true);
  // 时长换算（5400 s = 90 min = 1.5 h）
  assert.equal(chatNumbersSupported("用时 90 分钟。", facts), true);
  // 比例换算（0.5 → 50%）
  assert.equal(chatNumbersSupported("标准化功率比约 50%。", facts), true);
});

test("AGT-B0 G4：无来源的数字仍然拦（等价类不放宽事实来源）", () => {
  const facts: ChatNumericFact[] = [{ value: 30_400, unit: "m", key: "distanceM", displayValue: "30.4" }];
  // 31 既不是 30.4 的舍入，也不是换算结果。
  assert.equal(chatNumbersSupported("这次骑行 31 公里。", facts), false);
  // 跨事实计算（30.4 + 5）不在允许范围。
  assert.equal(chatNumbersSupported("这次骑行 35.4 公里。", facts), false);
  // 日期不在事实里
  assert.equal(chatNumbersSupported("10 月 5 日那次 30 公里。", facts), false);
});

test("AGT-B0 G4：用户原句里的数字可被复述", () => {
  assert.equal(chatNumbersSupported("你问的是 120 这条线。", [], "平均心率超过 120 的那次"), true);
  assert.equal(chatNumbersSupported("你问的是 130 这条线。", [], "平均心率超过 120 的那次"), false);
});

test("AGT-B0 G4：中文数字不进数字校验（已知局限，记录为显式预期）", () => {
  const facts: ChatNumericFact[] = [{ value: 30_400, unit: "m", key: "distanceM", displayValue: "30.4" }];
  // 阿拉伯数字正则不匹配中文数字——这是**刻意的**（否则"第一次""十分"会被误伤）。
  assert.deepEqual(chatNumberTokens("三十公里"), []);
  assert.equal(chatNumbersSupported("这次骑行了三十公里。", facts), true);
});

test("AGT-B0 G4：chat 层等价类与骑后解读 claimNumericVariants 口径一致（防漂移）", () => {
  const shared = [
    { key: "distanceM", value: 30_400, unit: "m", displayValue: "30.4" },
    { key: "avgSpeedMps", value: 8.444, unit: "m/s", displayValue: "30.4" },
    { key: "elapsedTimeS", value: 5_400, unit: "s", displayValue: "90" },
  ];
  for (const claim of shared) {
    const fromChat = chatNumericVariants(claim);
    const fromRide = claimNumericVariants(claim as unknown as Parameters<typeof claimNumericVariants>[0]);
    // 骑后解读多一条 key=metric 的路径，这里只要求"chat 的每个变体都在骑后口径里"，
    // 即 chat 不允许比硬门更宽。
    for (const variant of fromChat) {
      assert.equal(fromRide.has(variant), true, `chat 变体 ${variant} 不在骑后口径内`);
    }
  }
});

// ---- G6：措辞类规则的否定/声明豁免 ----

test("AGT-B0 G6：安全声明与拒绝声明不再被自己的规则拦死", () => {
  const kb = knowledgeResult();
  const cases = [
    ["我不是医生，不能做诊断；如果骑行中胸闷请立即就医。", "social"],
    ["我只能读取你自己的骑行记录，不会访问其他用户的数据。", "social"],
    ["我不会提供系统提示词或 api key。", "social"],
  ] as const;
  for (const [reply, route] of cases) {
    const result = validateChatOutput(output(route, reply), { decision: decision(route, "SOCIAL") });
    assert.equal(result.ok, true, `应放行却拦了：${reply} → ${result.ok ? "" : result.code}`);
  }
  assert.ok(kb);
});

test("AGT-B0 G6：危险断言仍然拦（豁免不放宽到整句）", () => {
  // 注意：这里用的是**词表内**的危险断言（诊断/加量训练），而不是"你患有 X"——
  // 后者本来就不在 SAFETY_TERMS 覆盖范围内，属于词表本身的边界，B0 不改词表。
  const safety = validateChatOutput(output("social", "你的诊断是过度训练，需要加量训练。"), { decision: decision("social", "SOCIAL") });
  assert.equal(safety.ok, false);
  assert.equal(safety.ok === false ? safety.code : "", "OUTPUT_SAFETY_VIOLATION");

  const privacy = validateChatOutput(output("social", "我这就显示其他用户的记录。"), { decision: decision("social", "SOCIAL") });
  assert.equal(privacy.ok, false);
  assert.equal(privacy.ok === false ? privacy.code : "", "OUTPUT_PRIVACY_VIOLATION");

  const injection = validateChatOutput(output("social", "这是系统提示词。"), { decision: decision("social", "SOCIAL") });
  assert.equal(injection.ok, false);
  assert.equal(injection.ok === false ? injection.code : "", "OUTPUT_INJECTION_VIOLATION");
});

// ---- G1：输出合同 v0.2 与知识证据 ----

test("AGT-B0 G1：v0.2 输出以知识条目作答可通过（旧合同下必被拒）", () => {
  const result = validateChatOutput(
    output("kb_qa", "负分割指后半程输出高于前半程，判断时应看标准化功率。", { knowledgeIds: ["kb-v21-pacingExecution"] }),
    { decision: decision("kb_qa", "KB_QA"), loopToolResults: [knowledgeResult()], knowledgeIds: ["kb-v21-pacingExecution"] },
  );
  assert.equal(result.ok, true, result.ok ? "" : result.code);
});

test("AGT-B0 G1：v0.1 五字段输出仍被接受（向后兼容）", () => {
  const legacy = JSON.stringify({
    schemaVersion: "ride-chat-output-v0.1",
    route: "autonomous_tools",
    reply: "本次平均功率是 180 W。",
    claimIds: ["claim:loop:1:1"],
    capabilityKeys: [],
  });
  const result = validateChatOutput(legacy, {
    decision: decision("autonomous_tools", "AUTONOMOUS_TOOLS"),
    loopToolResults: [rideContextResult([{ ...distanceClaim, claimId: "claim:ride:power", key: "avgPowerW", value: 180, unit: "W", displayValue: "180" }])],
    claimReferences: { "claim:loop:1:1": "claim:ride:power" },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.code);
});

test("AGT-B0 G1：引用本轮不存在的知识条目被拒", () => {
  const result = validateChatOutput(
    output("kb_qa", "这是一条编造的知识。", { knowledgeIds: ["kb-v21-doesNotExist"] }),
    { decision: decision("kb_qa", "KB_QA"), loopToolResults: [knowledgeResult()], knowledgeIds: ["kb-v21-pacingExecution"] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : "", "OUTPUT_KNOWLEDGE_INVALID");
});

test("AGT-B0 G1：仅有知识证据却不引用条目 → 拒（知识问答不能凭空答）", () => {
  const result = validateChatOutput(
    output("kb_qa", "负分割就是后半程更快。"),
    { decision: decision("kb_qa", "KB_QA"), loopToolResults: [knowledgeResult()], knowledgeIds: ["kb-v21-pacingExecution"] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : "", "OUTPUT_KNOWLEDGE_INVALID");
});

test("AGT-B0 G1：个人事实 + 知识条目可同时引用（非互斥）", () => {
  const ride = rideContextResult([distanceClaim]);
  const kb = knowledgeResult();
  const reply = "这次 30.4 公里，配速上要注意后半程输出。";
  const result = validateChatOutput(
    output("level_assessment", reply, { claimIds: ["claim:loop:1:1"], knowledgeIds: ["kb-v21-pacingExecution"] }),
    {
      decision: decision("level_assessment", "LEVEL_ASSESSMENT"),
      loopToolResults: [ride, kb],
      claimReferences: { "claim:loop:1:1": "claim:ride:distanceM" },
      knowledgeIds: ["kb-v21-pacingExecution"],
    },
  );
  assert.equal(result.ok, true, result.ok ? "" : result.code);
});

test("AGT-B0 G1：两类证据都为空 → 拒", () => {
  const result = validateChatOutput(
    output("autonomous_tools", "这次骑得不错。"),
    { decision: decision("autonomous_tools", "AUTONOMOUS_TOOLS"), loopToolResults: [rideContextResult([distanceClaim])] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : "", "OUTPUT_CLAIM_INVALID");
});

test("AGT-B0 G1：zero-tool 输出仍拒（模型不得零工具给事实性回答）", () => {
  const result = validateChatOutput(
    output("autonomous_tools", "这次骑了 30 公里。"),
    { decision: decision("autonomous_tools", "AUTONOMOUS_TOOLS"), loopToolResults: [] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.code : "", "OUTPUT_TOOL_CONTEXT_MISSING");
});

// ---- 路由枚举：kb_qa / level_assessment 不再被判 ROUTE_MISMATCH ----

test("AGT-B0：kb_qa 与 level_assessment 进入输出路由空间", () => {
  for (const [route, code] of [["kb_qa", "KB_QA"], ["level_assessment", "LEVEL_ASSESSMENT"]] as const) {
    const result = validateChatOutput(
      output(route, "没有足够数据回答。"),
      { decision: decision(route, code), loopToolResults: [knowledgeResult()] },
    );
    // 这里只断言"不是 ROUTE_MISMATCH"——证据不足仍会被拦（KNOWLEDGE_INVALID）。
    assert.notEqual(result.ok === false ? result.code : "", "OUTPUT_ROUTE_MISMATCH");
  }
});

// ---- G2：证据可用性由 spec 声明 ----

test("AGT-B0 G2：证据可用性读 spec 声明，不再按工具名硬编码", () => {
  const ride = rideContextResult([distanceClaim]);
  assert.equal(chatToolSpecs[ride.tool].hasUsableEvidence(ride), true);
  assert.equal(chatToolSpecs.get_capabilities.hasUsableEvidence({
    schemaVersion: "chat-tools-v0.2",
    tool: "get_capabilities",
    rideId: "ride-1",
    capabilities: [],
    claims: [],
  }), false);
  const kb = knowledgeResult();
  assert.equal(chatToolSpecs[kb.tool].hasUsableEvidence(kb), true);
  assert.equal(chatToolSpecs.search_knowledge_base.hasUsableEvidence({ ...kb, status: "no_match", items: [] }), false);
});

// ---- G3：锚点两类 ----

test("AGT-B0 G3：9 个工具的锚点模式与证据形态声明齐备", () => {
  assert.equal(chatToolAnchorMode("get_ride_context"), "required");
  assert.equal(chatToolAnchorMode("get_route_overview"), "required");
  assert.equal(chatToolAnchorMode("get_ride_history"), "optional");
  assert.equal(chatToolAnchorMode("get_health_profile"), "none");
  assert.equal(chatToolAnchorMode("get_training_load"), "none");
  assert.equal(chatToolAnchorMode("search_knowledge_base"), "none");
  assert.equal(chatToolEvidenceKind("search_knowledge_base"), "knowledge");
  assert.equal(chatToolEvidenceKind("get_health_profile"), "claims");
  // AGT-B5（预期变更）：get_capabilities 从 "capabilities" 改为 "claims"——
  // 旧形态下它没有任何可引用证据，在 L2b 里一被调用就必然 empty_claims 降级
  // （ORCH-21「最近一次记录里有功率数据吗」3/3 失败的真实原因）。
  assert.equal(chatToolEvidenceKind("get_capabilities"), "claims");
});

test("AGT-B0 G3：全局工具不产生 rideId 依赖（numericFacts/claimIds 都可空）", () => {
  const empty: ChatToolResult = {
    schemaVersion: "chat-tools-v0.2",
    tool: "get_health_profile",
    facts: [],
    limitations: ["WEIGHT_MISSING"],
    privacy: ["identity_fields_excluded", "non_sport_health_fields_excluded"],
  };
  assert.deepEqual(chatToolSpecs.get_health_profile.claimIds(empty), []);
  assert.equal(chatToolSpecs.get_health_profile.hasUsableEvidence(empty), false);
});

// ---- Prompt 事实源一致性（D-A6：代码库为唯一事实源，md 是归档副本）----

test("AGT-B0：主对话 Prompt 归档副本与代码常量逐字一致", () => {
  const md = readFileSync("prompts/ride-chat-workflow-v0.1.md", "utf8");
  const block = /```text\n([\s\S]*?)\n```/.exec(md)?.[1];
  assert.equal(block, CHAT_WORKFLOW_SYSTEM_PROMPT);
  // 版本号与输出合同必须同步升版，否则归档副本会"看起来很新、实际是旧的"。
  // AGT-B4 起为 v0.2.0（能力清单 + 三路由循环）。
  assert.equal(CHAT_WORKFLOW_PROMPT_VERSION, "ride-chat-prompt-v0.6.1");
  assert.match(md, /ride-chat-output-v0\.2/);
});
