import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prompt = readFileSync(new URL("../prompts/cycling-buddy-ride-interpretation-v0.4-candidate.md", import.meta.url), "utf8");

test("v0.4 candidate prompt is isolated from the production Coze prompt and fixes the four semantic layers", () => {
  assert.match(prompt, /状态：`OFFLINE_CANDIDATE`/);
  assert.match(prompt, /ride-interpretation-input-v0\.4-candidate/);
  assert.match(prompt, /ride-interpretation-output-v0\.4\.1-candidate/);
  assert.match(prompt, /自然语言/);
  assert.match(prompt, /highlights/);
  assert.match(prompt, /用户输入提示词/);
  assert.match(prompt, /事实 → 本次骑行表现 → 本次体现的能力 → 用户意义/);
  assert.match(prompt, /不要把事实、表现、能力体现和用户意义拆成字段或标题/);
  assert.match(prompt, /不要添加“事实：”/);
  assert.match(prompt, /不替换 `cycling-buddy-ride-analysis-v3\.1\.6\.md`/);
  assert.match(prompt, /不导入 Coze/);
});

test("v0.4 candidate prompt retains Claim, numeric, visual, history, and action boundaries", () => {
  for (const expected of [
    "candidateClaims[].claimId",
    "不得跨 Claim 相加、相减、计算比例、重算指标或猜测缺失值",
    "不得创建图表、视觉 ID、坐标范围、颜色、事件或关系",
    "不得提及历史、上次、进步、退步、排名、百分位或骑行水平",
    "general 必须 basisClaimIds=[]",
    "grounded 必须只绑定 performance 或 capability_evidence Claim",
  ]) {
    assert.ok(prompt.includes(expected), `Prompt must contain: ${expected}`);
  }
});
