import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prompt = readFileSync(new URL("../prompts/cycling-buddy-ride-interpretation-v0.4.12-candidate.md", import.meta.url), "utf8");

test("v0.4 candidate prompt is isolated from the production Coze prompt and fixes the four semantic layers", () => {
  assert.match(prompt, /状态：`OFFLINE_CANDIDATE`/);
  assert.match(prompt, /ride-interpretation-input-v0\.4-candidate/);
  assert.match(prompt, /ride-interpretation-output-v0\.4\.2-candidate/);
  assert.match(prompt, /自然语言/);
  assert.match(prompt, /highlights/);
  assert.match(prompt, /一次受限修复与用户输入提示词/);
  assert.match(prompt, /事实→本次骑行表现→体现\/反映的骑行能力→用户意义/);
  assert.match(prompt, /同一扣子大模型入口最多调用两次/);
  assert.match(prompt, /首轮使用 `ride_interp_input`/);
  assert.match(prompt, /L8 失败才允许一次修复/);
  assert.match(prompt, /禁止第三次调用/);
  assert.match(prompt, /再次失败立即 B0/);
  assert.match(prompt, /ride_interp_input`（17）/);
  assert.match(prompt, /不得增删、跳过、重排或替换维度/);
  assert.match(prompt, /最多 12 个可见字符/);
  assert.match(prompt, /performance 或 relation Claim/);
  assert.match(prompt, /先写一个 2—6 个字、不含数字的表现结论/);
  assert.match(prompt, /若无法从当前 performance 或 relation Claim 写出可靠的短表现结论/);
  assert.match(prompt, /只有存在直接支持定性表现的 Claim 时/);
  assert.match(prompt, /target/);
  assert.match(prompt, /`target` 必须严格为 `\{ "kind": "overall" \}`/);
  assert.match(prompt, /不得输出 `dimension`、`dimensionId` 或其他 target kind/);
  assert.match(prompt, /高光文字中的每个数字/);
  assert.match(prompt, /不得只删除高光 Claim ID 而保留数字/);
  assert.equal("ride_interp_input".length, 17);
});

test("v0.4 candidate prompt retains Claim, numeric, visual, history, and action boundaries", () => {
  for (const expected of [
    "input.candidateClaims[].claimId",
    "不得跨 Claim 相加、相减、计算比例或猜测缺失值",
    "不得创建图表、视觉 ID、坐标、颜色、事件或关系",
    "不得提及历史、上次、进步、退步、排名、百分位或骑行水平",
    "<repair_instruction>",
    "<previous_output>",
    "repair_instruction`、`previous_output` 为空",
    "固定给一条下一步建议",
    "高光仍可概括某个维度，但统一挂在整体评价下",
  ]) {
    assert.ok(prompt.includes(expected), `Prompt must contain: ${expected}`);
  }
  assert.match(prompt, /grounded.*performance\/capability_evidence/);
  assert.match(prompt, /general、basisClaimIds=\[\]/);
});
