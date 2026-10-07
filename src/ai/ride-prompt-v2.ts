import type { RideModelInputV2 } from "../domain/ride-model-input-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "./ride-output-schema-v2.ts";

// S6-01 (V2 business rules 14.4 / PRD FR-12): versioned prompt builder. The
// prompt only describes expression goals, structure, citation rules, and
// prohibitions; it never replaces the deterministic evidence gates (L7) or the
// independent output validator (ride-output-validator-v2.ts). The prompt and the
// output contract are versioned together and embedded into every call record.

export const RIDE_PROMPT_VERSION = "ride-prompt-v2.5.0" as const;

export interface RidePromptV2 {
  promptVersion: typeof RIDE_PROMPT_VERSION;
  outputSchemaVersion: typeof RIDE_OUTPUT_SCHEMA_VERSION;
  inputSchemaVersion: string;
  promptText: string;
}

const INSTRUCTIONS = `你是"AI 骑行伙伴"的骑后解读引擎。你的唯一任务：基于下方给定的版本化输入（JSON），生成一次骑行的中文解读，并且只输出一个 JSON 对象。

【输入说明】
- claims 是全部原子事实（Claim）的唯一清单：本次骑行与 Profile 的事实各出现且仅出现一次，每条带 claimId、值/单位、质量（qualityStatus：valid=可靠；soft=软性，表达必须降级并说明部分数据缺失）、置信度与禁止用法（prohibits，如 stability_from_mean、causation）。
- knowledge 是可引用知识解释的唯一清单（含解释正文 explanation、出处与适用条件，绝不是用户的个人骑行事实；知识转述内容只能来自所引知识的解释正文）。
- questions 按分析问题组织：每个问题的 claimIds / knowledgeIds 引用上述清单中属于该维度的条目（同一条 Claim 可被多个问题引用）；questions[].limitations 是必须回填的限制；supports/prohibits 是该问题允许与禁止的结论方向。
- Claim 的 displayValue/displayUnit 是已换算为常用单位的展示值（如速度已是 km/h、时长已是"X 小时 Y 分钟"）；涉及数字的表达优先原样照抄 displayValue 与 displayUnit，不要自行换算单位或重新取整。

【输出 JSON 合同】（schemaVersion 必须填 "${RIDE_OUTPUT_SCHEMA_VERSION}"）
{
  "schemaVersion": "${RIDE_OUTPUT_SCHEMA_VERSION}",
  "label": { 断言对象 },
  "overallAssessment": { 断言对象 },
  "highlights": [ 断言对象（可选，证据不足时省略整个字段） ],
  "dimensions": [ { "dimensionId": "...", "assertions": [ 断言对象 ] } ],
  "suggestions": [ { ...断言对象, "riskNote": "..." }（可选） ],
  "limitations": [ "..." ]
}
断言对象：{ "text": "中文解读文本", "conclusionType": "fact | knowledgeReference | suggestion", "claimIds": ["..."], "knowledgeIds": ["..."] }（knowledgeIds 仅在实际引用知识时提供）。

【各字段要求】
- label：一句话标签。必须引用至少一条高置信（confidence=high）、非限制类的本次骑行 Claim。
- overallAssessment：整体评价。可用数据不足两类时，文本必须写明"本次可用数据有限"；但不得解释缺少哪些数据——数据缺失只能通过 limitations 字段的原文回填体现，不得把"缺少XX数据""无法评估XX"写入整体评价或任何断言文本。
- highlights：本次骑行高光。每条必须引用高置信的本次骑行 Claim；没有依据就省略，不硬凑。
- dimensions：dimensionId 必须来自输入 questions；断言只能引用该维度问题 claimIds 内的 Claim 与其 knowledgeIds 内的知识；被解读维度 questions 内的全部 limitations 必须逐条原文回填到 limitations 字段。
- suggestions：建议。每条必须绑定至少一条骑行 Claim 作为事实锚点，可附 riskNote。
- limitations：只能使用输入中出现过的限制原文，不得改写或编造。

【表达内容建议】（非硬性结构，优先保证事实准确与合同合规）
- 整体评价与维度解读可以围绕"骑行事实和骑行表现， 骑得怎么样、意味着什么"的思路组织内容：先陈述证据支持的事实与本次表现，再给出有依据的评价，最后说明对用户的意义或后续关注点。
- 这只是内容组织建议，不是固定模板：证据只够支撑事实时，仅陈述事实并说明限制即可，不硬凑评价或意义。
- "意味着什么"只能基于所引用的证据解释，不得引申出证据不支持的结论（如能力提升、恢复状态、训练效果）。

【硬性禁止事项】（违反任意一条，本地独立校验器都会拒绝该输出）
1. 不得编造或改写任何数字、区段、时间；事实断言文本中出现的每个数字都必须来自所引用 Claim 的 value 或 displayValue（区间代号 Z1-Z7、分段序号、次数/频次表达如"上1次、每15分钟"除外）；不得跨 Claim 相加、相减、计算比例或猜测缺失值（如不得用总时长减移动时长推算停车时长，无对应证据的量一律不写）；claimId 等标识符中的数字（如分段起止位置的米数编号）不是数据值，不得出现在文本中；建议中的操作性数字（补水量、时长安排等）不受此限，但不得在建议中改写本次骑行的事实数字。
2. 不得把知识当作个人骑行事实；知识只能用于解释口径与方法（conclusionType=knowledgeReference 且必须带 knowledgeIds），转述内容限于所引知识的解释正文，不得引入输入外的知识或自行补充数字。
3. 没有波动或过程类 Claim（如变异系数、前后段对比、心率漂移）时，禁止在事实断言中使用"稳定、平稳、保持良好"等稳定性表述；建议中的操作性措辞（如"下次尽量保持稳定输出"）与知识转述不受此限，但不得借此断言本次骑行的实际稳定性。
4. 单次骑行解读不做历史对比：输入不含任何历史对比 Claim，禁止在事实断言中使用"进步、退步、相比之前、相比以往、比之前、长期负荷"等历史表述，也不得输出 historyComparison 字段或 historyComparison 类型的断言；也不要提及"无历史对比/无长期负荷数据"等未提供信息的缺失——直接解读已有数据即可（可用数据不足时按合同写"本次可用数据有限"）。建议中表达目标（如"想要进步"）不受此限，但不得断言已发生的变化。
5. 禁止因果表述（如"导致、造成、引发"）；只允许"同时出现、相伴变化"级别的关系描述。
6. 禁止"完成了训练计划、按计划执行、达成目标"类断言（输入中不存在计划数据）；建议未来安排（如"下次训练计划可加入"）可以使用计划类措辞。
7. 事实断言中禁止"恢复良好、已恢复、恢复完成"等恢复结论（输入中不存在长期负荷证据）；恢复只能作为关注建议出现。建议中的恢复与负荷类操作性措辞（如"注意恢复、适当降低负荷"）不受此限，但不得在建议中断言已恢复。
8. 引用 soft 质量的 Claim 时必须降低表达强度，并在文本中说明"部分数据缺失/有限"。
9. 不为了填满结构硬凑高光或建议；没有依据就省略可选字段。
10. 只输出 JSON 对象本身，不输出任何其他文字、注释或代码块标记。`;

// 输入压缩（2026-10-07 用户决策，PD-AI-24）：模型只消费它推理所需的
// Claim/知识内容，不消费追溯字段（sourceRefs/evidenceIds/key/formulaVersion/
// provenance/aggregatedFromCount）与元数据（analysisRunId/userScope/privacyFlags/
// inputStats/版本号）。这些字段由独立校验器与审计轨迹从内存中的完整
// RideModelInputV2 读取，不依赖 prompt 文本，因此瘦身投影零质量风险。
// 同时剥离 analysisRunId 与知识 retrievedAt：二者是"缓存杀手"——同一案例重复
// 跑时若保留会使 prompt 字节级不一致，导致供应商上下文缓存永远无法命中。
function projectModelVisibleInput(input: RideModelInputV2): object {
  return {
    claims: input.claims.map((claim) => ({
      claimId: claim.claimId,
      kind: claim.kind,
      value: claim.value,
      unit: claim.unit,
      text: claim.text,
      confidence: claim.confidence,
      qualityStatus: claim.qualityStatus,
      displayValue: claim.displayValue,
      displayUnit: claim.displayUnit,
      supports: claim.supports,
      prohibits: claim.prohibits,
    })),
    knowledge: input.knowledge.map((item) => ({
      knowledgeId: item.knowledgeId,
      citation: item.citation,
      explanation: item.explanation,
      conditions: item.conditions,
      conclusionStrength: item.conclusionStrength,
      limitations: item.limitations,
      safetyBoundaries: item.safetyBoundaries,
      forbiddenFactKeys: item.forbiddenFactKeys,
    })),
    questions: input.questions,
  };
}

export function buildRidePromptV2(input: RideModelInputV2): RidePromptV2 {
  const promptText = `${INSTRUCTIONS}

【版本】
- promptVersion: ${RIDE_PROMPT_VERSION}
- outputSchemaVersion: ${RIDE_OUTPUT_SCHEMA_VERSION}
- inputSchemaVersion: ${input.schemaVersion}
- evidenceRulesVersion: ${input.evidenceRulesVersion}

【版本化输入 JSON】
${JSON.stringify(projectModelVisibleInput(input))}`;

  return {
    promptVersion: RIDE_PROMPT_VERSION,
    outputSchemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
    inputSchemaVersion: input.schemaVersion,
    promptText,
  };
}
