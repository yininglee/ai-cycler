import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { projectRideInterpretationInputV04Candidate, validateRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const NOW = "2026-09-01T00:00:00.000Z";
const prompt = readFileSync(new URL("../prompts/cycling-buddy-ride-interpretation-v0.4.14-candidate.md", import.meta.url), "utf8");
const fixture = getRideFixture("l3-power-preview");
const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
const profile = createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, NOW);
const context = buildRideAnalysisContext(record, { profile });
const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
const input = projectRideInterpretationInputV04Candidate(context, plan);
assert.ok(input);

assert.deepEqual(validateRideInterpretationInputV04Candidate(input), { valid: true, issues: [] });
assert.equal(JSON.stringify(input).includes("rawSamples"), false);
assert.equal(JSON.stringify(input).includes("sourceFileName"), false);
assert.equal(JSON.stringify(input).includes("latitude"), false);
assert.equal(input.dimensionInterpretations.some((unit) => unit.dimensionId === "history_change"), false);
for (const expected of [
  "自然语言", "整体评价", "重点维度", "highlights", "用户输入提示词",
  "同一扣子大模型入口最多调用两次", "首轮使用 `ride_interp_input`",
  "repair_instruction", "previous_output", "禁止第三次调用", "立即 B0", "不得增删、跳过、重排或替换", "target",
  "performance 或 relation Claim", "事实性描述", "每条 `target` 必须严格为 `{ \"kind\": \"overall\" }`",
  "最多 12 个可见字符", "先决定文字，再同步填写该对象的 claimIds，最后检查数字",
  "映射同一数值的计划内 Candidate Claim", "补齐或替换 `claimIds`", "不得增删、跳过、重排或替换",
    "先写一个 2—6 个字、不含数字的表现结论", "节奏连贯", "若无法从当前 performance 或 relation Claim 写出可靠的短表现结论", "只有存在直接支持定性表现的 Claim 时",
    "高光文字中的每个数字", "不得只删除高光 Claim ID 而保留数字", "完整证据链",
    "整体评价和任何维度解读中不得出现任何行动建议、行动引导或行动清单",
    "所有建议只能写在 nextAction",
    "失败反例 1",
    "合规样例 1",
    "事实→本次骑行表现→体现/反映的骑行能力",
    "不得在整体评价或任何维度解读中写“数据完整、记录完整",
]) {
  assert.ok(prompt.includes(expected), `Prompt must contain: ${expected}`);
}
assert.match(prompt, /L8 失败才允许一次修复/);
assert.match(prompt, /`repair_instruction`、`previous_output` 为空/);
assert.match(prompt, /固定给一条下一步建议/);
assert.ok(prompt.includes("ride_interp_input`（17）"));
assert.match(prompt, /不得输出 `dimension`、`dimensionId` 或其他 target kind/);
assert.equal("ride_interp_input".length <= 20, true);
console.log(`PASS candidate-prompt-minimal-input (${input.candidateClaims.length} candidate claims)`);
assert.equal(prompt.includes("用户意义"), false);
console.log("PASS candidate-prompt-three-layer-contract");
console.log("PASS candidate-prompt-one-constrained-repair");
console.log("Ride interpretation prompt preflight passed: 3 scenarios, no model calls.");
