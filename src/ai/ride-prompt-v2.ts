import type { RideModelInputV2 } from "../domain/ride-model-input-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "./ride-output-schema-v2.ts";

// S6-01 (V2 business rules 14.4 / PRD FR-12): versioned prompt builder. The
// prompt only describes expression goals, structure, citation rules, and
// prohibitions; it never replaces the deterministic evidence gates (L7) or the
// independent output validator (ride-output-validator-v2.ts). The prompt and the
// output contract are versioned together and embedded into every call record.

export const RIDE_PROMPT_VERSION = "ride-prompt-v2.0.0" as const;

export interface RidePromptV2 {
  promptVersion: typeof RIDE_PROMPT_VERSION;
  outputSchemaVersion: typeof RIDE_OUTPUT_SCHEMA_VERSION;
  inputSchemaVersion: string;
  promptText: string;
}

const INSTRUCTIONS = `你是"AI 骑行伙伴"的骑后解读引擎。你的唯一任务：基于下方给定的版本化问题包（JSON），生成一次骑行的中文解读，并且只输出一个 JSON 对象。

【输入说明】
- 输入按分析问题组织：questions[].claims 是本次骑行、Profile 与可比历史的原子事实（Claim）；questions[].knowledge 是可引用的知识解释（仅含出处与适用条件，绝不是用户的个人骑行事实）；questions[].limitations 是必须回填的限制；supports/prohibits 是该问题允许与禁止的结论方向。
- 每条 Claim 带 claimId、值/单位、质量（qualityStatus：valid=可靠；soft=软性，表达必须降级并说明部分数据缺失）、置信度与禁止用法（prohibits，如 stability_from_mean、causation）。

【输出 JSON 合同】（schemaVersion 必须填 "${RIDE_OUTPUT_SCHEMA_VERSION}"）
{
  "schemaVersion": "${RIDE_OUTPUT_SCHEMA_VERSION}",
  "label": { 断言对象 },
  "overallAssessment": { 断言对象 },
  "highlights": [ 断言对象（可选，证据不足时省略整个字段） ],
  "dimensions": [ { "dimensionId": "...", "assertions": [ 断言对象 ] } ],
  "historyComparison": { 断言对象（可选） },
  "suggestions": [ { ...断言对象, "riskNote": "..." }（可选） ],
  "limitations": [ "..." ]
}
断言对象：{ "text": "中文解读文本", "conclusionType": "fact | historyComparison | knowledgeReference | suggestion", "claimIds": ["..."], "knowledgeIds": ["..."] }（knowledgeIds 仅在实际引用知识时提供）。

【各字段要求】
- label：一句话标签。必须引用至少一条高置信（confidence=high）、非限制类的本次骑行 Claim。
- overallAssessment：整体评价。可用数据不足两类时，文本必须写明"本次可用数据有限"。
- highlights：本次骑行高光。每条必须引用高置信的本次骑行 Claim；没有依据就省略，不硬凑。
- dimensions：dimensionId 必须来自输入 questions；断言只能引用该维度问题包内的 Claim 与知识；被解读维度 questions 内的全部 limitations 必须逐条原文回填到 limitations 字段。
- historyComparison：只有引用了 kind=history 的可比历史 Claim 时才允许输出。
- suggestions：建议。每条必须绑定至少一条骑行或历史 Claim 作为事实锚点，可附 riskNote。
- limitations：只能使用输入中出现过的限制原文，不得改写或编造。

【硬性禁止事项】（违反任意一条，本地独立校验器都会拒绝该输出）
1. 不得编造或改写任何数字、区段、时间；事实断言文本中出现的每个数字都必须来自所引用 Claim 的 value 或 displayValue（区间代号 Z1-Z7、分段序号、次数/频次表达如"上1次、每15分钟"除外）；建议中的操作性数字（补水量、时长安排等）不受此限，但不得在建议中改写本次骑行的事实数字。
2. 不得把知识当作个人骑行事实；知识只能用于解释口径与方法（conclusionType=knowledgeReference 且必须带 knowledgeIds）。
3. 没有波动或过程类 Claim（如变异系数、前后段对比、心率漂移）时，禁止在事实断言中使用"稳定、平稳、保持良好"等稳定性表述；建议中的操作性措辞（如"下次尽量保持稳定输出"）与知识转述不受此限，但不得借此断言本次骑行的实际稳定性。
4. 没有可比历史 Claim 时，禁止在事实断言中使用"进步、退步、相比之前、长期负荷"等历史表述，且不得输出 historyComparison 字段；建议中表达目标（如"想要进步"）不受此限，但不得断言已发生的变化。
5. 禁止因果表述（如"导致、造成、引发"）；只允许"同时出现、相伴变化"级别的关系描述。
6. 禁止"完成了训练计划、按计划执行、达成目标"类断言（输入中不存在计划数据）；建议未来安排（如"下次训练计划可加入"）可以使用计划类措辞。
7. 禁止"恢复良好、已恢复、恢复完成"等恢复结论；恢复只能作为关注建议出现。
8. 引用 soft 质量的 Claim 时必须降低表达强度，并在文本中说明"部分数据缺失/有限"。
9. 不为了填满结构硬凑高光、历史比较或建议；没有依据就省略可选字段。
10. 只输出 JSON 对象本身，不输出任何其他文字、注释或代码块标记。`;

export function buildRidePromptV2(input: RideModelInputV2): RidePromptV2 {
  const promptText = `${INSTRUCTIONS}

【版本】
- promptVersion: ${RIDE_PROMPT_VERSION}
- outputSchemaVersion: ${RIDE_OUTPUT_SCHEMA_VERSION}
- inputSchemaVersion: ${input.schemaVersion}
- evidenceRulesVersion: ${input.evidenceRulesVersion}

【版本化输入 JSON】
${JSON.stringify(input)}`;

  return {
    promptVersion: RIDE_PROMPT_VERSION,
    outputSchemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
    inputSchemaVersion: input.schemaVersion,
    promptText,
  };
}
