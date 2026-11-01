/**
 * 探针：对话链路对"指定某一次骑行"的支持度（2026-10-26 缺陷分析用）。
 *
 * 背景：用户反馈"骑行解读只会解读最近一次，应该支持选择任意一次骑行"。
 * 本脚本不修改任何代码，只把三处行为打印出来，用于判断问题出在
 *   ① 规则路由（classifyChatInput） ② 锚点解析（resolveRideAnchor） ③ L1 分类器（可选，联网）
 * 的哪一层——避免"凭感觉改正则"。
 *
 * 用法：
 *   node scripts/inspect-chat-ride-selection.ts              # 只跑确定性部分（零网络、零成本）
 *   node scripts/inspect-chat-ride-selection.ts --classifier # 额外跑 L1 分类器（读 .env.local，约 ¥0.02）
 */
import { readFileSync } from "node:fs";

import { classifyChatInput } from "../src/chat/chat-routing.ts";
import { resolveRideAnchor } from "../src/chat/chat-ride-anchor.ts";
import type { ChatRoute, ChatSessionSummary } from "../src/chat/chat-routing.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

// ---- 固定样例：模拟"四条记录 + 会话里已有一条锚点"的两种上下文 ----
function record(rideId: string, startTime: string): RideRecord {
  return {
    activity: {
      schemaVersion: "0.2",
      rideId,
      sport: "cycling",
      source: { kind: "fit", parserVersion: "probe" },
      startTime,
      metrics: {},
      sensorQuality: {},
      sourceIssues: [],
    },
    series: {
      schemaVersion: "0.1",
      rideId,
      source: { kind: "fit", parserVersion: "probe" },
      coordinateSpace: "relative_normalized",
      privacy: { ruleVersion: "relative-route-v0.1", preciseCoordinatesExcluded: true },
      availableSeries: [],
      seriesMetadata: {},
      timeBasis: { kind: "none" },
      points: [],
    },
  };
}

// 与 test-data/demo-imported-rides 的四条演示记录同日期（10-05 / 08-20 / 07-22 / 07-18），
// 这样探针结果与用户实际能复现的现象一致。
const ENTRIES = [
  { record: record("r-0718", "2026-07-18T07:00:00+08:00") },
  { record: record("r-0722", "2026-07-22T06:30:00+08:00") },
  { record: record("r-0820", "2026-08-20T07:30:00+08:00") },
  { record: record("r-1005", "2026-10-05T09:00:00+08:00") },
];
const NOW = new Date("2026-10-26T12:00:00+08:00");

// 覆盖五类指涉方式：绝对日期 / 相对日期 / 显式序数 / 指示代词 / 裸"解读"
const UTTERANCES = [
  "骑行解读",
  "帮我解读一下这次的骑行",
  "帮我解读 8月20日那次骑行",
  "帮我解读一下 7 月 18 日那次",
  "8月20日的骑行数据怎么样",
  "8月20日骑得怎么样",
  "上次骑行怎么样",
  "那次骑行我骑得如何",
  "7月22日那次的平均功率是多少",
  "昨天那次骑行心率多少",
  "解读一下我的第二次骑行",
  "帮我分析一下上个月的骑行",
  "最近一次骑行怎么样",
];

console.log("== ① 规则路由（未启用分类器时的基线 / dev 兜底）==");
for (const text of UTTERANCES) {
  const decision = classifyChatInput(text);
  console.log(`  ${text.padEnd(26)} → ${decision.route.padEnd(16)} ${decision.reasonCode.padEnd(18)} ${decision.action}`);
}

console.log("\n== ② 锚点解析（假设已路由到 current_ride / autonomous_tools）==");
const ANCHOR_CASES: Array<{ text: string; route: ChatRoute; summaries: ChatSessionSummary[] }> = [
  ...UTTERANCES.slice(2).map((text) => ({ text, route: "current_ride" as ChatRoute, summaries: [] })),
  // 已有锚点（上一轮问的是 7 月 22 日）：检查"未识别的指涉"会不会静默沿用旧锚点
  { text: "第二次骑行怎么样", route: "current_ride", summaries: [{ kind: "session_turn", question: "7月22日的心率", route: "current_ride", rideAnchor: "2026-07-22" }] },
  { text: "那次骑行我骑得如何", route: "current_ride", summaries: [{ kind: "session_turn", question: "7月22日的心率", route: "current_ride", rideAnchor: "2026-07-22" }] },
  // L2b 循环路由：无任何指涉时是否澄清
  { text: "第二次骑行怎么样", route: "autonomous_tools", summaries: [] },
  { text: "帮我解读一下我的骑行", route: "autonomous_tools", summaries: [] },
];
for (const item of ANCHOR_CASES) {
  const resolution = resolveRideAnchor({ text: item.text, route: item.route, summaries: item.summaries, entries: ENTRIES, now: NOW });
  const outcome = resolution.status === "resolved"
    ? `${resolution.record.activity.rideId} src=${resolution.source}`
    : `CLARIFY`;
  const context = item.summaries.length ? `（会话已有锚点 ${item.summaries[0]!.rideAnchor}）` : "";
  console.log(`  [${item.route}] ${(item.text + context).padEnd(44)} → ${outcome}`);
}

if (process.argv.includes("--classifier")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
  const { createChatClassifier } = await import("../src/chat/chat-classifier.ts");
  const classifier = createChatClassifier();
  if (!classifier) {
    console.log("\n== ③ L1 分类器：未配置（CHAT_CLASSIFIER_ENABLED / SILICONFLOW_API_TOKEN）==");
  } else {
    console.log("\n== ③ L1 分类器（线上真实路由依据）==");
    for (const text of UTTERANCES) {
      try {
        const result = await classifier.classify({ requestId: crypto.randomUUID(), text });
        console.log(`  ${text.padEnd(26)} → ${result.intent.padEnd(20)} clarify=${result.needsClarification}`);
      } catch (error) {
        console.log(`  ${text.padEnd(26)} → ERROR ${(error as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
