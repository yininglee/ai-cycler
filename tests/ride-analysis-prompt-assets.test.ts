import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prompt = readFileSync(new URL("../prompts/cycling-buddy-ride-analysis-v3.1.2.md", import.meta.url), "utf8");

test("Prompt v3.1.2 contains the five runtime variables and the accepted contract versions", () => {
  for (const name of ["analysis_context", "analysis_elig", "few_shot_json", "repair_instruction", "previous_output"]) {
    assert.match(prompt, new RegExp(`\\{\\{${name}\\}\\}`));
    assert.ok(name.length <= 20);
  }
  assert.match(prompt, /RideAnalysisContext v0\.2/);
  assert.match(prompt, /AnalysisEligibility v0\.1/);
  assert.match(prompt, /ride-analysis-output-v0\.3/);
});

test("the Coze input export guide points to copyable generated fixture files", () => {
  const guide = readFileSync(new URL("../coze/ride_analysis_v2-配置指南.md", import.meta.url), "utf8");
  assert.match(guide, /pnpm export:coze-inputs/);
  assert.match(guide, /output\/coze-inputs\/l1-built-in-sample\.json/);
  assert.match(guide, /全部是“字符串”/);
});

test("Prompt v3.1.2 preserves product boundaries and never uses legacy levels as gates", () => {
  assert.match(prompt, /不评价数据是否完整/);
  assert.match(prompt, /静默只分析本次/);
  assert.match(prompt, /few_shot_json必须是mode=disabled、examples=\[\]/);
  assert.match(prompt, /没有版本化分类Claim时/);
  assert.match(prompt, /不得在headline、overallAssessment、dimensions、nextAction或limitations中评价本次骑行轻松/);
  assert.match(prompt, /不得改写为“前半程\/后半程”/);
  assert.match(prompt, /对用户可见的距离、时间、速度、爬升/);
  assert.match(prompt, /只可引用analysis_context\.allowedClaims/);
  assert.match(prompt, /首次骑行或历史不可比时/);
  assert.match(prompt, /今天、昨日、周末/);
  assert.match(prompt, /schemaVersion固定为"ride-analysis-output-v0\.3"/);
  assert.match(prompt, /notableEvents最多3项/);
  assert.match(prompt, /shareCopy必须正好3条/);
  assert.match(prompt, /准确罗列事实或省略/);
  assert.match(prompt, /dimensions 是 PRD 6\.3 的业务分析维度/);
  assert.match(prompt, /基础事实 Claim 可以参与已开放的产品维度/);
  assert.match(prompt, /不得因为某个 Claim 存在就创造/);
  assert.match(prompt, /同一维度的相关Claim应合并/);
  assert.match(prompt, /endurance：只有 allowedDimensionKeys 包含 endurance 时/);
  assert.match(prompt, /limitations只说明/);
  assert.match(prompt, /允许说明缺少心率、功率、踏频/);
  assert.match(prompt, /历史记录不足或无法进行历史对比/);
  assert.match(prompt, /低风险的主观社交表达/);
  assert.match(prompt, /pace优先把平均速度与首末分段差值组织为“事实 \+ 直接意义”/);
  assert.match(prompt, /最能改变整体判断/);
  assert.match(prompt, /速度、心率、功率、踏频或可比历史/);
  assert.match(prompt, /不得写成“功率全程没有变化”/);
  assert.match(prompt, /不得写成“功率保持一致”/);
  assert.match(prompt, /没有版本化分类Claim时（关系Claim同理）/);
  assert.match(prompt, /原始统计值保留在详细数据Tab|详细数据Tab可以保留/);
  assert.match(prompt, /nextAction最多一条/);
  assert.match(prompt, /kind="grounded"时必须绑定直接相关的basisClaimIds/);
  assert.match(prompt, /kind="general"且basisClaimIds=\[\]/);
  assert.match(prompt, /证据不足则返回null/);
  assert.match(prompt, /有可靠且有意义的特征时，不能退化为只复述/);
  assert.match(prompt, /没有安全、直接的解释价值时，允许准确罗列事实/);
  assert.match(prompt, /行动建议可以是通用建议，但必须通过`kind="general"`/);
  assert.match(prompt, /overallAssessment只整合对“这次骑得怎么样”结论必要的1—3组维度/);
  assert.doesNotMatch(prompt, /L1|L2|L3/);
  assert.doesNotMatch(prompt, /ride_snapshot/);
});

test("the archived v3.1 Coze prompt preserves the confirmed 20 boundaries", () => {
  const archived = readFileSync(new URL("../prompts/cycling-buddy-ride-analysis-v3.1.md", import.meta.url), "utf8");
  assert.match(archived, /Prompt v3\.1/);
  assert.match(archived, /优先级：安全 > 事实和证据 > 完成骑后解读 > 表达风格/);
  assert.match(archived, /2a\. 对用户可见的距离/);
  assert.match(archived, /事实映射为解释是你的职责/);
  assert.match(archived, /17\. overallAssessment和dimensions优先完成/);
  assert.match(archived, /18\. 反例与正例/);
  assert.match(archived, /19\. 没有版本化分类Claim时/);
  assert.match(archived, /20\. 不要用“基础骑行数据特征”/);
  assert.match(archived, /【输出合同】/);
  assert.match(archived, /## User Prompt/);
});

test("the Coze schema example exposes the nextAction object fields", () => {
  const example = JSON.parse(readFileSync(new URL("../coze/ride-analysis-output-example.json", import.meta.url), "utf8"));
  assert.equal(example.nextAction.kind, "general");
  assert.deepEqual(example.nextAction.basisClaimIds, []);
});
