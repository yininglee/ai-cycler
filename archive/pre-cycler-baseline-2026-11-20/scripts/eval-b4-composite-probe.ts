// AGT-B4 §5.5 复合问法重审——真实模型判定探针（一次性判定材料，不入测试套件）。
//
// 判定目标：在**当前 catalog 裁剪表**下，复合问法的次诉求是否答漏，从而决定
// 维持单标签 / L1 扩 catalog / L3 升多标签。
// 用法：node --env-file=.env.local scripts/eval-b4-composite-probe.ts

import { readSiliconFlowChatProviderConfig, SiliconFlowChatProvider } from "../src/chat/siliconflow-chat-provider.ts";
import { runChatAgent } from "../src/chat/chat-agent.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import { makeChatDecision, type ChatRoute } from "../src/chat/chat-routing.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

function record(fixtureId: string, rideId: string, daysAgo: number): RideRecord {
  const fixture = getRideFixture(fixtureId);
  const r: RideRecord = {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
  r.activity.startTime = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return r;
}

const records = [
  record("l3-power-preview", "ride-new", 2),
  record("l3-fit-power", "ride-mid", 20),
  record("l2-fit-heart-rate", "ride-old", 60),
  record("l1-built-in-sample", "ride-oldest", 120),
];

const repository = {
  listRides: async () => records.map((r) => ({ record: r, storedAt: new Date().toISOString() })),
  getRide: async (_o: string, id: string) => records.find((r) => r.activity.rideId === id) ?? null,
  getProfile: async () => createUserProfile({ ftpWatts: 220, weightKg: 72, age: 28 }),
} as never;

const config = readSiliconFlowChatProviderConfig({
  ...process.env,
  CHAT_MODEL_ENABLED: "true",
});
if (!config) {
  console.error("CHAT_MODEL_ENABLED / SILICONFLOW_API_TOKEN 未就绪");
  process.exit(1);
}
const provider = new SiliconFlowChatProvider(config);

// 4 例明确复合 + 1 例弱复合（§5.5 判定材料要求）
const cases: Array<{ id: string; text: string; route: ChatRoute; reasonCode: string; primary: string; secondary: string }> = [
  { id: "C1", text: "我的 FTP 是多少？另外为什么要练区间？", route: "kb_qa", reasonCode: "KB_QA", primary: "知识（区间训练原理）", secondary: "个人数据（FTP）" },
  { id: "C2", text: "我最近练得多不多？这样安排合理吗？", route: "level_assessment", reasonCode: "LEVEL_ASSESSMENT", primary: "个人数据（训练负荷）", secondary: "知识（安排是否合理）" },
  { id: "C3", text: "什么是负分割？我这次骑行符合吗？", route: "kb_qa", reasonCode: "KB_QA", primary: "知识（负分割定义）", secondary: "个人数据（本次骑行）" },
  { id: "C4", text: "哪次骑行距离最远？那次的爬坡多吗？", route: "autonomous_tools", reasonCode: "AUTONOMOUS_TOOLS", primary: "个人数据（检索最远）", secondary: "个人数据（路线爬坡）" },
  { id: "C5", text: "为什么我的功率上不去？", route: "kb_qa", reasonCode: "KB_QA", primary: "知识（功率受限因素）", secondary: "弱复合：可能需个人数据（FTP/负荷）" },
];

for (const item of cases) {
  const decision = makeChatDecision(item.route, "none", item.reasonCode as never, item.text.length);
  const result = await runChatAgent({
    text: item.text,
    decision,
    provider,
    toolRunner: undefined,
    loopRunner: createChatToolLoopRunner(repository, "owner-a"),
    requestId: `probe-${item.id}`,
  });
  const steps = (result.loopTrace?.steps ?? []).map((step) => `${step.tool}:${step.status}`);
  console.log(`\n===== ${item.id} | route=${item.route} | ${item.text}`);
  console.log(`  主诉求=${item.primary} / 次诉求=${item.secondary}`);
  console.log(`  execution=${result.execution} fallback=${result.fallbackCode ?? "-"} tools=[${steps.join(" ")}]`);
  console.log(`  回复(${result.reply.length}字): ${result.reply}`);
}
