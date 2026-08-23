# `ride_analysis_v2` 扣子开发环境配置指南

> 状态：`DEVELOPMENT_CANDIDATE`  
> 输入合同：`ride-analysis-input-v0.2`  
> Prompt：`prompts/cycling-buddy-ride-analysis-v3.1.2.md` v3.1.2
> Few-shot：首轮联调关闭；样例库v0.1保留为待重写、待评审候选  
> 输出：`ride-analysis-output-v0.3`

## 1. 哪些不用改

- 继续使用单一 Workflow，不增加多 Agent、RAG、知识库、Function Calling或代码节点。
- 继续保留“开始 → 大模型 → 结束”三个节点；如果你的新版扣子画布没有单独结束节点，则直接使用大模型节点的结构化输出，不必额外补节点。
- 模型继续使用当前账号内中文与JSON稳定的非深度思考快速模型；不要因本项更换模型做质量结论。
- 服务端继续负责准入、事实/数字/claim/安全校验、一次修复和B0；扣子不复制这些规则。
- Token、Workflow ID和模型ID仍只放本机`.env.local`，不进入前端、截图或Git。

## 2. 必须新建v2而不是覆盖v1

旧`ride_analysis_v1`使用`RideContextSnapshot 1.0 + Prompt v1.2 + output-v0.2`，只保留为失败学习证据。请新建或复制为`ride_analysis_v2`，不要覆盖已记录的v1版本；这样才能重放旧结果并回滚。

## 3. 开始节点输入

配置5个必填`String`变量。所有变量名均不超过扣子的20字符限制：

| 变量 | 长度 | 内容 | 首轮是否为空 |
|---|---:|---|---|
| `analysis_context` | 16 | `RideAnalysisContext v0.2` JSON字符串 | 否 |
| `analysis_elig` | 13 | `AnalysisEligibility v0.1` JSON字符串 | 否 |
| `few_shot_json` | 13 | Few-shot模式元数据；当前固定`disabled`且`examples=[]` | 否 |
| `repair_instruction` | 18 | 服务端校验错误码与受限修复要求 | 是 |
| `previous_output` | 15 | 上一次原始模型输出 | 是 |

不要再创建`ride_snapshot`。不要在扣子调试区手改`analysis_context`中的数字、claim或允许维度。

### 3.1 在哪里取得这5个字符串

在项目根目录执行：

```bash
pnpm export:coze-inputs
```

默认会为内置 L1/L2/L3 样例生成：

- `output/coze-inputs/l1-built-in-sample.json`
- `output/coze-inputs/l2-built-in-sample.json`
- `output/coze-inputs/l3-built-in-sample.json`

每个文件都是一个对象，里面的5个值全部是“字符串”，不是需要再嵌套粘贴的对象：

```json
{
  "analysis_context": "{...}",
  "analysis_elig": "{...}",
  "few_shot_json": "{\"mode\":\"disabled\",...}",
  "repair_instruction": "",
  "previous_output": ""
}
```

在扣子开始节点调试时，打开其中一个样例文件，把5个键对应的值分别复制到同名输入变量。不要复制最外层键名，也不要把`analysis_context`里的JSON再次手动格式化或修改。若要生成其他已存在的Fixture，可执行：

```bash
pnpm export:coze-inputs -- gpx-no-timestamps
```

当前`few_shot_json`应为以下结构，里面没有任何示例`text`：

```json
{"mode":"disabled","reason":"baseline_no_few_shot","libraryVersion":"ride-analysis-few-shot-v0.1","routerVersion":"few-shot-router-v0.1","exampleIds":[],"examples":[]}
```

## 4. 大模型节点

1. 选择支持JSON结构化输出的中文快速模型，关闭深度思考。
2. 先选择“精确模式”预设；若修改最大回复长度或深度思考后界面显示“自定义”，属于正常状态。记录最终参数组合，不只记录模式名。
3. 最大回复长度先设约`1200`，因为v0.3包含整体评价、多维分析和3条分享文案；后续用真实运行的截断率、延迟和成本调整。
4. 若界面没有temperature，记录`NOT_CONFIGURED`，不用寻找隐藏配置或增加节点。
5. 将`prompts/cycling-buddy-ride-analysis-v3.1.2.md` v3.1.2的`System Prompt`代码块完整放入系统提示词。v3.1.1、v3.1原文保持不变，不要覆盖历史Prompt。
6. 将同文件的`User Prompt`代码块放入用户提示词，并把5个占位符分别绑定到开始节点同名变量。运行时数据放在用户提示词更合适，系统提示词只维护稳定角色、事实、安全和输出规则。

从旧候选升级到v3.1.2时，只替换大模型节点的System Prompt，并重新导入服务端导出的5个输入字符串；User Prompt、五个开始节点输入变量、结构化输出Schema和结束节点映射均不变。v3.1.2以v3.1的整体评价逻辑为基线：`dimensions`使用PRD业务维度，不是字段清单；基础事实可以作为已开放业务维度的证据，但不得创造`distance/time/avgSpeed`等字段型维度。整体评价要回答“这次骑得怎么样、主要依据是什么、对用户意味着什么”，应从业务维度中选择最能改变整体判断的证据；速度、心率、功率、踏频或可比历史共同影响判断时，需合并进整体评价并补齐对应Claim，不要求机械重复所有维度。若依据的是首段/末段Claim，只能写首末阶段结论，不得扩展为“功率全程没有变化”等全程结论，除非有全程统计Claim直接支持。模型应优先使用`allowedClaims`中的`displayValue/displayUnit`；允许对同一Claim做常见单位或比例展示换算并合理四舍五入，服务端会校验换算，不能跨Claim运算或创造新指标；有直接证据且有用户意义时解释，没有有意义证据时允许准确事实罗列或省略维度；允许基于事实做适度、符合常识的定性解读，但不得把单次结果升级为骑行水平、体能、训练负荷或生理因果结论；pace优先表达“事实 + 直接意义”；变异系数和标准化功率比在事实能支持清晰用户意义时可以解释，没有明确用户价值时不在AI文案中展示，原始值保留在数据Tab，不强行补充统计定义或分类；limitations可以说明缺失心率/功率/踏频及其解读限制，也可以说明历史记录不足/无法进行历史对比，但首次/不可比时不得生成history维度；shareCopy可以有低风险主观社交表达，但不得添加未经Claim支持的数字、事实、健康或训练结论；不得添加证据不支持的强程度分类、日期/计划或前半程/后半程标签。整体评价提到心率、功率、踏频等主题时，必须在`overallAssessment.claimIds`中引用对应Claim。

`nextAction`需要优先生成一条低风险建议：有直接Claim依据时使用`grounded`并绑定相关`basisClaimIds`；没有个性化依据时使用`general`并保持空数组，内容限于拉伸、补水、记录体感等通用骑后整理；没有安全且有帮助的建议时才使用`null`。不得使用旧合同的`kind=tip`，也不得因为缺少心率/功率而推荐购买设备。

**重要核对：**运行结果必须是`schemaVersion="ride-analysis-output-v0.3"`、`safetyLevel`为`normal/caution/stop`、`notableEvents`为对象数组、`nextAction.kind`为`grounded/general`、`shareCopy`正好3条。若出现`schemaVersion=0.2`、`safetyLevel=safe`、`kind=tip`或只有1条分享文案，说明仍在使用旧Prompt或旧结构化输出约束，不要把该结果当作v3.1.2质量结果。

## 5. 结构化输出

推荐用`coze/ride-analysis-output-example.json`让当前扣子界面生成根字段与嵌套类型，然后逐项核对：

- 根字段必须正好9个：`schemaVersion/headline/overallAssessment/dimensions/notableEvents/nextAction/limitations/safetyLevel/shareCopy`；
- `dimensions`、`notableEvents`、`limitations`、`shareCopy`为数组；
- `overallAssessment`为对象；`nextAction`运行时为对象或`null`，但导入示例使用完整对象以便扣子生成嵌套字段；
- `shareCopy`正好3条；
- `schemaVersion`固定为`ride-analysis-output-v0.3`。

`coze/ride-analysis-output-schema.json`是标准JSON Schema和服务端/人工核对事实源。若扣子的“导入JSON”会把`$schema/$id/type/properties`识别成业务字段，不要导入Schema文件，改用示例文件。

如果当前大模型节点已经直接产生结构化根字段，结束节点无需二次拼装或将对象转字符串。服务端兼容根对象及常见`analysis_json/output/data`包装。

## 6. 首轮人工联调步骤

1. 保存v2 Workflow，但先不要发布到生产。
2. 在开始节点填入服务端测试产生的5个字符串；首次运行时`repair_instruction`和`previous_output`填空字符串。
3. 运行后确认根字段完整、`schemaVersion`正确，且没有Markdown代码围栏。
4. 将输出原样交回服务端校验；不要人工修正文案后冒充模型通过。
5. 若首轮校验失败，由服务端发起唯一一次修复调用；确认修复输入包含错误码和前次输出，同时`few_shot_json.examples`仍为空。
6. 再失败、超时或供应商错误必须返回B0；不能在扣子内无限重试。

联调通过的最低证据：内置三种能力组合各1条首轮运行，至少1条故意错误触发修复，记录`request_id/model_id/workflow_version/prompt_version/few_shot_mode/latency/token/fallback`。当前每条运行的`few_shot_mode`都必须是`disabled`。这只是冒烟证据，不等于B2质量基准通过。

## 7. 服务端环境变量

```dotenv
AI_ANALYSIS_ENABLED=true
AI_FEW_SHOT_ENABLED=false
COZE_API_URL=https://api.coze.cn/v1/workflow/run
COZE_WORKFLOW_ID=新版v2工作流ID
COZE_API_TOKEN=仅保存在本机的开发Token
COZE_MODEL_ID=控制台中实际模型ID
AI_ANALYSIS_TIMEOUT_MS=8000
AI_MAX_RESPONSE_BYTES=262144
```

本仓库没有`.env.local`时，真实扣子冒烟保持`NOT_RUN`；页面和API会继续使用B0，不应据此判断扣子故障。

不要在当前联调中把`AI_FEW_SHOT_ENABLED`改为`true`。后续只有在样例逐条优化、状态改为`approved_for_experiment`，并冻结无Few-shot对照结果后，才建立独立实验开启。
