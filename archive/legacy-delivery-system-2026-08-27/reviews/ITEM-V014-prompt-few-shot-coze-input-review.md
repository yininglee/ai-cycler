# ITEM-V014｜新骑后 Prompt/Few-shot/扣子输入联调评审

> 日期：2026-08-21  
> 状态：`ACCEPTED`
> 当前阶段：v0.1 证据型Demo / G1「Demo核心价值」  
> 边界：完成新Prompt、Few-shot模式和服务端扣子输入的静态联调；当前真实联调不注入Few-shot，模型运行须在用户配置v2 Workflow后执行。

## 1. 目标与依据审计

目标是把已验收的`RideAnalysisContext v0.2 + AnalysisEligibility v0.1 + ride-analysis-output-v0.3`接入一条可维护、可回放、可校验的骑后AI运行链，替代旧`RideContextSnapshot 1.0 + Prompt v1.2 + output-v0.2`。

已按`DEC-058`定向核对PRD 6.3、7.6.1、7.8–7.11，研发指南6–8/11/13–14，路线图v0.1/G1，V012/V013合同及相关决策。结论一致：规则先于模型、L1/L2/L3不得作为业务门、历史首次/不可比静默省略、自动骑后不使用RAG或Function Calling、最多一次受限修复。未发现需用户确认的产品冲突。

## 2. 本次实现

### 2.1 Prompt v2.3

- 建立过独立候选Prompt，稳定角色/事实/安全/输出规则放System Prompt，5个运行时变量放User Prompt；当前可复制候选以[`cycling-buddy-ride-analysis-v3.1.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.1.md)为准。
- 整体评价必须解释本次骑行及其意义，不评价数据完整度，不只平铺概要数字；
- 维度按`AnalysisEligibility`动态开放，心率/功率/踏频互不绑定；
- 首次、无历史或历史不可比时静默只分析本次骑行；
- `few_shot_json.mode=disabled`且`examples=[]`；若出现非空样例，Prompt明确要求忽略；
- 修复模式只能删除或纠正违规内容，不得新增事实、claim、维度或建议。
- L1真实冒烟后新增确定性语义边界：无分类claim不得生成长短距离、路线平缓、强度/体感或稳定性评级；首末四分之一不得改写为前后半程。
- 事实到解释仍由模型负责，但必须基于claim直接支持的关系和可能意义；指标原始值与用户展示值由服务端同时提供，模型优先使用displayValue/displayUnit。

### 2.2 Few-shot v0.1（草稿、未启用）

- 新建独立机器可读库[`ride-analysis-few-shot-v0.1.json`](../prompts/ride-analysis-few-shot-v0.1.json)；
- 用户审查发现部分`text`在解释系统证据结构而非用户骑行表现，部分建议不可行动；当前样例不能作为模型模仿目标；
- 10类合成样例统一降为`draft_needs_review`，不再称为“已评审”；
- 默认`AI_FEW_SHOT_ENABLED=false`，初次生成与修复均传空样例；即使误开开关，路由也只允许`approved_for_experiment`样例，因此当前草稿仍不会注入；
- 后续先取得无Few-shot基线，再决定是否逐条优化并做同模型、同Prompt、同用例对照。

### 2.3 扣子输入与服务端运行链

新`ride-analysis-input-v0.2`固定5个String输入，均不超过20字符：

| 变量 | 长度 | 作用 |
|---|---:|---|
| `analysis_context` | 16 | 新骑后最小事实上下文 |
| `analysis_elig` | 13 | 模型准入和允许维度 |
| `few_shot_json` | 13 | 当前只传`mode=disabled`与空`examples` |
| `repair_instruction` | 18 | 唯一一次受限修复说明 |
| `previous_output` | 15 | 首轮原始输出 |

- API改为传完整`RideRecord`，由服务端计算时序特征后再形成模型上下文；原始点不传给扣子；
- `AnalysisEligibility`在模型前执行；不准入直接B0，critical safety直接固定安全停止；
- B2只接受`ride-analysis-output-v0.3`，未知claim/数字/维度/高风险内容不展示；
- 首轮失败仅修复一次；再次失败、超时或供应商错误转B0；
- 版本矩阵记录service、context/rules、eligibility/rules、Prompt、Few-shot库/路由/模式、Workflow、Schema、model和B0模板；
- 标准Schema和扣子示例均已更新为v0.3；新版操作见[`ride_analysis_v2-配置指南.md`](../coze/ride_analysis_v2-配置指南.md)。

## 3. 验证证据

| 检查 | 结果 |
|---|---:|
| `pnpm typecheck` | PASS |
| `pnpm test` | 150/150 PASS；新增真实冒烟语义回归门 |
| `pnpm build` | PASS；Next.js 16.3.1 |
| 交付系统严格校验 | PASS；0 error / 0 warning |
| `pnpm build` | PASS；Next.js 16.3.1 |
| Prompt资产 | PASS；版本、5变量、静默历史、非等级门、合成示例隔离均有测试 |
| Few-shot模式 | PASS；默认和修复均0条；10/10草稿不可注入，显式误开仍为0条 |
| 扣子输入 | PASS；5/5变量≤20字符，序列化与响应提取测试通过 |
| 准入/修复/兜底 | PASS；不准入0调用、安全停止0调用、普通失败最多2调用 |
| 真实扣子调用 | L1首轮已运行；约13秒/6097 Tokens，结构通过、语义失败 |
| 模型质量/延迟/Token/成本 | L1质量`FAIL`；精确模型ID、请求ID与成本未记录 |
| RAG/Function Calling/UI | `NOT_RUN`；不属于V014 |

原静态实现见[T0.27](../eval/benchmark-report.md#34t027item-v014-promptfew-shot扣子输入静态联调2026-08-21)；用户反馈后的无Few-shot基线见[T0.28](../eval/benchmark-report.md#35t028item-v014无few-shot联调基线修订2026-08-21)。

L1真实结果见[RUN-20260821-007](../eval/runs/RUN-20260821-007.json)与[T0.29](../eval/benchmark-report.md#36t029item-v014无few-shot-l1首次真实冒烟2026-08-21)。该结果违反首次历史静默、确定性阈值和事实边界，因此形成Prompt v2.2及服务端语义拒绝门；随后用户确认展示值合同和样例口径修订，当前待用Prompt v2.3同输入复测。

## 4. 已知边界

- 旧Prompt v1.2、output-v0.2及其测试作为历史失败/兼容证据保留，但新运行服务不再引用旧校验器；
- 当前API可返回B2 v0.3或B0旧页面结构，调用方必须按`source`区分；AI UI接入属于后续工作项；
- 当前Few-shot文本存在已识别的洞察与行动价值问题，全库仅为草稿；是否继续使用必须由后续对照实验决定；
- 最大回复长度`1200`是首轮联调控制值，后续按真实截断、延迟和成本证据调整；temperature未暴露时继续记录`NOT_CONFIGURED`；
- 本项不证明AI解读比原始数据更有价值，不放行B1/B2/B3、G1或生产。

## 5. 用户预览与下一步

L1首次冒烟后，请按以下方式同步Prompt v2.3并复测；5变量与输出Schema不用重建：

1. 复制或新建`ride_analysis_v2`，不覆盖v1；
2. 配置5个String输入；
3. 将Prompt v2.3的System Prompt完整替换到系统提示词；User Prompt、开始节点和结束节点保持不变；
4. `few_shot_json`使用指南给出的`disabled + examples=[]`内容；
5. 用v0.3示例生成并核对结构化输出。

配置完成后回复`已配置v2五个输入`并提供画面，我将继续指导首条真实冒烟。真实样例、一次修复和B0降级证据完成前，ITEM-V014不做最终验收；全部完成后再请你明确回复`接受 ITEM-V014`。

## 6. RUN-20260822-010复测结论

- 状态：`CHANGES_REQUESTED`，不能验收。
- 通过：v0.3结构、服务端展示值、首末四分之一口径、海拔事实和整体评价边界。
- 失败：`limitations`仍暴露历史不可比；`shareCopy`仍包含无强度依据的“轻松”，并新增无Claim支持的“周末晨骑”和主观“享受在路上的感觉”。
- 受限修复：Prompt升级至v3.1；把headline、overallAssessment和dimensions的“事实 + 意义”设为生成要求，保留日期/计划、记录状态和未经校准分类边界；Workflow候选升级为`ride_analysis_v2-dev.12`。输入变量、Schema、Few-shot关闭状态和节点结构不变。
- 下一步：替换System Prompt v3.1后用同一L1输入复测；通过后才执行一次故意错误修复、第二次失败转B0和L2/L3冒烟。

## 7. RUN-20260822-013之后的质量门修订

用户进一步指出：headline不能只是“结束阶段速度有所降低”这类事实陈述，`overallAssessment`和`dimensions`也不能把距离、速度、爬升和阶段差值重新排列。该意见属于已确认的AI骑后价值要求，不改变“模型负责事实到解释”的职责边界。

本轮把质量要求具体化为两层：

1. Prompt层：标题必须是整体评价或对用户有意义的突出特点；整体评价和保留维度必须完成“事实 + 意义”，并用“说明/意味着/体现/反映/表现为”等自然解释桥接；没有安全含义的维度应省略。正反例明确禁止用事实罗列满足要求。
2. 服务端层：增加`HEADLINE_NOT_EVALUATIVE`、`OVERALL_INTERPRETATION_MISSING`、`DIMENSION_INTERPRETATION_MISSING`。这些是表达质量门，不是固定结论门：只检查是否有解释桥接，不要求模型输出预设的训练等级、体感或路线难度。

自动验证结果：`pnpm verify` 152/152通过。仍需在扣子用同一L1输入进行真实复测；本轮不启动L2/L3，不做V014验收。

## 8. RUN-20260822-014复测结论

本轮真实输出已从事实罗列改善为有解释桥接的表达，但仍为`semantic_fail`。失败集中在未校准程度词、路线分类和limitations设备缺失清单；详见[RUN-20260822-014](../eval/runs/RUN-20260822-014.json)。

已补充服务端拒绝码`MISSING_INPUT_LISTING`、`LOW_VALUE_META_LANGUAGE`并扩展`UNCALIBRATED_FEATURE_CLASSIFICATION`，Prompt明确要求使用中性直接关系，不使用“明显/大幅/小幅/稳定/起伏不大”等未经分类Claim支持的程度词，也不使用“基础数据特征”等空泛元话术。自动验证为154/154，构建通过。

## 9. RUN-20260822-015复测结论

本轮事实关系和解释桥接继续通过，但仍为`semantic_fail`：海拔被表述为“变化不大/变化幅度较小”，limitations暴露“本次评价不包含历史对比分析”，shareCopy使用无时间Claim支持的“今日”。详见[RUN-20260822-015](../eval/runs/RUN-20260822-015.json)。

已扩展历史静默拒绝门覆盖“不包含历史对比分析”等变体，并在Prompt中明确禁止该类limitations表达。自动验证为155/155，构建通过。

## 10. 用户确认：无安全意义时允许事实罗列

用户确认：没有意义的解读不要强行生成，暂时准确罗列事实也可以。由此，AI输出的最低放行标准调整为：事实正确、Claim可追溯、无越权或错误程度判断；解释属于价值增强项，不再是每个整体/维度的硬性必填项。

已移除`OVERALL_INTERPRETATION_MISSING`和`DIMENSION_INTERPRETATION_MISSING`硬门。保留标题质量、事实数字、历史静默、时间/计划、强度/体感、未校准程度、数据完整度、设备缺失清单和空泛元话术规则。新增负差值自然表达的数值合同，例如负差值可在“低4.49”中使用其绝对值表达。

分类Claim不在本轮随意增加。只有在原始特征稳定、需求反复、阈值/公式/适用范围/质量门/反例明确，并通过离线基准和用户价值评测后，才进入独立版本化变更。

## 11. RUN-20260822-016前的Prompt压缩与合同核对

用户反馈最新输出质量退化。用户提供的扣子运行日志已确认旧版包含20条可信边界（含`2a`）；此前本地恢复的17条版本已保留为修改前快照。该日志顶部的结构示例仍是历史格式，真实结果也使用了旧合同形态：`schemaVersion=0.2`、`safetyLevel=safe`、`nextAction.kind=tip`、字符串事件和单条分享文案。这不是单纯的文案质量问题，首先必须确认扣子是否仍在使用旧Prompt或旧结构化输出约束。

本次建立Prompt v3.2 Compact和Workflow候选`ride_analysis_v2-dev.13`：将规则收缩为事实来源、解释边界、历史/时间/分享、v0.3输出合同、安全、修复六个区块；事实优先、解释可选；明确v0.3字段对象结构和精确枚举值。输入变量、Few-shot关闭模式和业务边界不变。

下一步先做合同核对，再运行同一L1输入。若仍返回旧v0.2结构，不记录为模型质量结果，先修正扣子System Prompt/结构化输出配置。

实际新运行已登记为[RUN-20260822-016](../eval/runs/RUN-20260822-016.json)：观察到的`schemaVersion=0.2`、`safe`、`tip`、字符串事件和单条分享文案均属于旧合同。当前结论是`contract_mismatch`，不是语义质量评分。

## 12. Prompt归档与nextAction合同补强

用户要求旧Prompt不能被覆盖，并指出`ride-analysis-output-v0.3`需要明确下一步建议。已完成以下调整：

- 扣子旧版 v3.1 已按用户提供的运行日志恢复为20条可信边界的独立文件[`cycling-buddy-ride-analysis-v3.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.md)，并保留17条版本快照[`cycling-buddy-ride-analysis-v3.1.recovered-17-boundaries.backup.md`](../prompts/cycling-buddy-ride-analysis-v3.1.recovered-17-boundaries.backup.md)。该旧日志的Schema仅作历史证据，当前候选改为独立文件[`cycling-buddy-ride-analysis-v3.1.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.1.md)；后续版本必须新建独立文件。
- v3.2未恢复冗余规则，而是补充`nextAction`生成优先级：有直接证据时使用`grounded`，无个性化依据时使用低风险`general`，没有安全且有帮助的建议时才使用`null`；禁止旧`tip`类型、设备购买建议、训练处方和医疗建议。
- 用户随后提供同一L1输入的v3.2与v3.1对照：v3.2将基础概要和特征拆成`distance/time/avgSpeed/elevation/speedChange/elevationRange`字段型维度，且暴露历史不足、无Claim支持的时间/体感分享；v3.1按`pace`/`climbing`合并语义维度。该结果证明Compact压缩遗漏了维度选择合同，属于Prompt回归。
- 已建立v3.2.1候选：补回“维度不是字段清单”“基础概要默认进入overallAssessment”“同一语义维度合并Claim”“无认知增量省略”“历史静默和分享逐条审查”规则；修改前备份为[`cycling-buddy-ride-analysis-v2.compact-pre-dimension-fix.backup.md`](../prompts/cycling-buddy-ride-analysis-v2.compact-pre-dimension-fix.backup.md)。服务端Prompt版本同步为`3.2.1`。
- 扣子结构化输出示例由`nextAction:null`改为完整`general`对象，以便控制台生成`kind/text/basisClaimIds`嵌套字段；运行时合同仍允许`null`，不改变V013/PRD 6.3的可省略边界。
- 当前用户提供的`RUN-20260822-016`仍是`schemaVersion=0.2`等旧合同，先修正扣子输出合同，再评价下一步建议的语义质量。

## 13. 用户要求：依据PRD重新设计维度合同（v3.3候选）

用户指出v3.2.1仍然把基础Claim默认排除出`dimensions`，要求重新审查PRD、版本路线图和Demo/Agent研发指南后设计Prompt。该意见确认了一个重要区分：基础事实可以成为产品分析维度的证据，但不能按`distance/time/avgSpeed/elevation`等字段型key拆卡；模型也不能在服务端未开放能力时自行创造`endurance`或分类结论。

### 13.1 依据与冲突处理

- PRD 6.3要求从“骑行规模/耐力、速度/节奏、爬升、心率反应、功率输出/负荷、踏频、历史变化”等业务维度按实际能力选择，不要求每次全部覆盖；规模/时间/距离可参与规模/耐力维度，但不能机械拆字段。
- 路线图与研发指南要求`AnalysisEligibility`先于模型调用，规则生成事实和关系，模型负责语言解释；分类Claim、骑行水平和长期趋势后置。
- 当前代码的`AnalysisEligibility v0.1`尚未由基础距离/时间Claim开放`endurance`。本次不擅自修改代码合同，v3.3明确“只有allowedDimensionKeys包含endurance时才能输出该维度”；后续是否新增确定性endurance特征/Claim，作为后续产品/合同工作确认。

### 13.2 本次实现

- 修改前备份：[`cycling-buddy-ride-analysis-v3.2.1.pre-v3.3.backup.md`](../prompts/cycling-buddy-ride-analysis-v3.2.1.pre-v3.3.backup.md)。v3.1完整20条归档和v3.2.1备份均未覆盖。
- 当时的v3.3候选未保留为当前文件；当前候选见第14节的[`cycling-buddy-ride-analysis-v3.1.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.1.md)，服务端`RIDE_ANALYSIS_PROMPT_VERSION=3.1.1`。
- Prompt新增“产品维度合同”：先按`allowedDimensionKeys`选业务维度，再合并该维度相关基础/关系/分类/历史Claim；无认知增量时允许事实罗列或省略；明确`endurance`未开放时不能由模型从距离/时间推断耐力。
- Prompt继续保持无Few-shot基线、v0.3输出合同、历史静默、分享中性表达、一次受限修复和B0边界。

### 13.3 自动验证与待办

`pnpm verify`：157/157 PASS（TypeScript检查与全量测试）。这只证明本地资产、合同和服务端回归通过，不证明真实模型质量。

下一步改为：在扣子完整替换System Prompt v3.1.1，保持五个输入变量、`ride-analysis-output-v0.3`结构化输出和`fewShotMode=disabled`不变，用同一L1输入复测；重点观察`dimensions`是否保持`pace`/`climbing`等业务维度、pace是否出现直接意义、limitations是否说明传感器缺失影响、shareCopy是否只使用低风险主观表达，以及事实降级是否准确。真实复测、受限修复和B0降级完成前不验收V014、不启动L2/L3。

## 14. 用户确认后的 v3.1.1 定向修订

用户确认继续以 v3.1 的 `overallAssessment` 整体逻辑为基线，并补充四项产品规则：

- `limitations`允许说明缺少心率、功率、踏频等数据，但必须同时说明这些缺失如何限制本次解读；历史无数据或不可比仍静默，不向用户展示内部准入原因。
- `shareCopy`允许低风险主观社交表达，供用户复制后自行编辑；仍禁止新增未经Claim支持的数字、事实、排名、健康或训练效果结论。核心解读字段继续严格限制主观体验和强度判断。
- 没有直接、清晰且对用户有帮助的意义时，准确事实罗列或省略维度均为合法降级，不强迫模型填充解释。
- `pace`及其他维度有直接关系时优先输出“事实 + 直接意义”，例如“平均速度为25km/h，结束阶段速度比开始阶段低4.49km/h，说明后程配速出现回落”；不得补充未经Claim支持的疲劳、体能或程度判断。

已建立独立候选[`cycling-buddy-ride-analysis-v3.1.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.1.md)，原 v3.1 文件保持不变。服务端同步为 `Prompt 3.1.1 / ride-analysis-service-v1.2 / ride_analysis_v2-dev.14`；输出校验按字段分层，传感器缺失限制需有影响说明，shareCopy的低风险主观表达不再触发核心解读越界门。

本轮尚未进行真实扣子复测，V014仍为 `CHANGES_REQUESTED`；下一步是用户完整替换 v3.1.1 System Prompt，用同一 L1 输入复测，再执行一次受限修复、二次失败转 B0 和三能力组合冒烟，不启动 L2/L3。

## 15. RUN-20260823-018｜v3.1.1 三能力组合真实冒烟

证据：[RUN-20260823-018](../eval/runs/RUN-20260823-018.json)。本轮由用户提供 L1、L2、L3 三条扣子运行结果，Few-shot 为 `disabled`；原始结果已单独归档，不覆盖任何历史运行。

| 样例 | 判定 | 说明 |
|---|---|---|
| L1 | `PASS` | `pace/climbing`业务维度、pace事实+直接意义、传感器限制说明和事实降级均符合；分享文案主观表达仍需保持低风险 |
| L2 | `CONDITIONAL_PASS` | 核心维度和限制说明正确；shareCopy出现未提供时间Claim支持的“今日”，且“充实的一天”存在弱场景暗示 |
| L3 | `FAIL` | 由踏频CV推导“整体变化小/保持稳定”；把首末阶段功率差值扩大为“全程没有变化”；暴露历史不可比原因；shareCopy出现“今日” |

本轮确认 v3.1.1 已稳定解决字段型维度和 pace 解释问题，但仍不能放行以下表达：

- `cadenceCoefficientOfVariation`只能作为统计事实，不能自行分类为稳定或变化小；
- `powerFirstLastDeltaW`只能支持首段/末段比较，不能扩展为全程结论；
- 历史首次或不可比时必须静默；
- shareCopy仍不能添加未提供的日期或场景标签。

按一次受限修复规则，下一步只修正 L3 原输出中的越权表达，不添加新 Claim、数字、阈值、历史结论或维度。受限修复验证通过后，再验证二次失败是否转 B0；V014仍不验收。

为让该修复可被服务端确定性触发，新增拒绝码 `OVERBROAD_SERIES_CONCLUSION`：首末阶段 Claim 不得扩展为“全程没有变化/整个过程保持不变”。这只收紧校验与修复指令，不改变 Prompt 版本或产品输出合同。

## 16. RUN-20260823-019｜L3一次受限修复结果

证据：[RUN-20260823-019](../eval/runs/RUN-20260823-019.json)。修复已删除未校准的“稳定/变化小”、历史准入说明和全程功率结论，且移除了“今日”。因此硬边界修复通过。

人工质量仍为 `CONDITIONAL_PASS`：`cadenceCoefficientOfVariation=0.06` 和 `normalizedPowerRatio=1.07` 仍被直接罗列，没有解释对本次骑行的意义；分享文案的“一天”仍需继续观察。该结果不能作为 V014 最终通过证据。下一步执行二次失败转 B0 验证。

## 17. RUN-20260823-020｜二次校验失败后的 B0 降级

证据：[RUN-20260823-020](../eval/runs/RUN-20260823-020.json)。使用 L3 内置样例和 `fewShotMode=disabled`，故意让首次生成与唯一一次修复都返回非法 JSON。

验证结果：服务端记录第一次 `OUTPUT_NOT_OBJECT`，只发起一次带 `repairInstruction` 的修复；第二次仍校验失败后返回 `source=b0`、`fallbackCode=REPAIR_FAILED`、`attempts=2`，没有第三次 Provider 调用。B0 使用 `b0-template-v0.1` 确定性输出，包含可追溯 Claim 和低风险 `nextAction`。

该结果验证了失败兜底和重试上限，不改变 RUN-20260823-018/019 的语义判定。V014 仍为 `CHANGES_REQUESTED`，待解决原始统计量缺少用户意义解释后再进行最终验收。

## 18. v3.1.2 统计量意义修订

依据 PRD 6.3 的功率、踏频解读要求，以及研发指南对“规则负责公式、LLM负责解释”的职责划分，本轮没有新增稳定性、强度、训练负荷或骑行水平分类 Claim。修订目标仅是阻止模型把内部统计量裸露给用户，并要求保留可验证的统计含义：

- `cadenceCoefficientOfVariation` / `powerCoefficientOfVariation`：若被引用，必须说明其用于表示相对平均值的变化程度；不得改写为稳定、波动大小或评级。
- `normalizedPowerRatio`：若被引用，必须说明标准化功率与平均功率的相对关系；可以表达标准化功率高于平均功率，但不得推断运动强度、训练负荷或骑行水平。

本轮新增服务端校验码 `*_STATISTIC_WITHOUT_MEANING`，覆盖整体评价、业务维度、事件和下一步建议中的相关 Claim 引用。Prompt 与服务端独立升版为 `v3.1.2 / ride-analysis-service-v1.3 / ride_analysis_v2-dev.15`；旧 `v3.1.1` 原文件保留，未被覆盖。

自动回归新增两组正反例，当前 `pnpm verify` 为 `161/161`。真实扣子复测尚未执行；V014仍为 `CHANGES_REQUESTED`，下一步使用同一 L3 输入替换 v3.1.2 后复测，重点核对统计量意义、业务维度、首末分段边界和历史静默。

## 19. 用户修订后的 v3.1.2 统计量降级规则

用户确认：没有分类 Claim 时，不能把“相对平均值的变化程度”这种统计定义强行当作用户解读；标准化功率与平均功率的关系也不必在当前阶段强制解释。此前第18节的“必须附带统计意义”要求过严，现已在同一 v3.1.2 上修订：内部统计量没有明确用户价值时不出现在 AI 文案中，原始值保留在“数据”Tab；服务端不再因缺少统计意义句而拒绝输出。

已撤销 `*_STATISTIC_WITHOUT_MEANING` 强制校验及对应正反例，保留通用 Claim、数字、安全、越权和维度校验。Prompt、配置指南、研发指南、路线图和当前状态已同步；v3.1.1 与 v3.1.2 文件均保留，未创建新 Prompt 版本。后续仍需用同一 L3 输入复测真实扣子输出。

## 20. 用户确认：允许事实驱动的合理定性与自动骑后历史限制

用户进一步修订当前阶段规则：没有版本化分类/关系Claim时，模型可以基于已验证事实做适度、符合常识且对本次骑行有帮助的定性分析；如果没有清晰用户意义，事实罗列或省略维度仍然合法。该规则不授权模型生成骑行水平、体能、训练负荷、运动强度或医疗/生理因果结论，也不放宽数字白名单、首末阶段不得扩展为全程、日期/场景和安全边界。

自动骑后在首次骑行或历史不可比时仍不生成`history`维度、不生成历史结论，但`limitations`允许说明“历史记录不足”或“无法进行历史对比”。对话模块的历史提示规则不随本次自动解读调整而改变。

实现同步：正式`v3.1.2`已更新生成方法和历史限制条款；服务端移除未校准统计定性的硬拒绝，并仅对非limitations文本保留历史缺口拒绝；距离/路线/强度分类、首末阶段外推、Claim/数字/安全校验继续保留。原始`RUN-20260823-018/019/020`不修改，真实扣子复测仍待用户使用完整Prompt执行。

## 21. 同一Claim展示换算与整体评价Claim覆盖

用户补充两项要求：允许模型对同一Claim做合理展示数字换算，但服务端必须校验换算正确；解决`overallAssessment.claimIds`未覆盖文本中全部指标主题的问题。用户同时询问shareCopy出现“今日”是否因为Prompt过长。

处理结论：单次“今日”失败不能证明Prompt过长是根因，因为同一输出已遵守多项中间规则；更可能是低优先级分享文案的常见社交模式覆盖了日期边界。Prompt v3.1.2保留完整结构，并在输出合同末尾增加最终检查；服务端继续用`UNSUPPORTED_CONTEXT_LABEL`兜底。

实现：

- `ride-analysis-service-v1.4`数字校验保留原始值/展示值，并增加受限的m/s↔km/h、距离、时长和比例/百分比换算及合理舍入；跨Claim运算和任意派生指标仍失败。
- 新增`OVERALL_TOPIC_WITHOUT_CLAIM`，按距离、时间、速度、心率、功率、踏频、爬升/海拔、运动消耗检查整体评价主题是否由`claimIds`覆盖。
- Prompt、研发指南、扣子配置指南、路线图和台账已同步；旧Prompt文件未覆盖、Few-shot仍关闭。

自动验证：`tests/ride-analysis-output-v03.test.ts` 21/21通过；全量`pnpm verify`待复跑。真实扣子复测和V014验收仍未完成。

## 22. 整体评价的跨维度选择

用户提供的最新L3输出中，`dimensions`已覆盖`pace`、`heartRate`、`power`、`cadence`和`climbing`，但`overallAssessment`只总结距离、时长、爬升和pace。该结果的Claim引用对已生成文本本身是完整的，却没有履行PRD 6.3中“回答这次骑得怎么样、主要依据是什么、对用户意味着什么”的整体评价职责。

已修订Prompt v3.1.2生成方法：整体评价从业务维度中选择最能改变整体判断的1—3组证据；当速度、心率、功率、踏频或可比历史共同影响判断时，应合并这些关系并补齐Claim；没有整体认知增量的孤立维度可以只留在`dimensions`，不要求机械重复所有维度。旧Prompt和备份不变。

## 23. 最新L3结果：整体引用改善但首末功率被扩展为全程

最新输出已将速度、心率、功率和踏频相关Claim纳入`overallAssessment.claimIds`，解决了上一轮整体评价只引用pace的问题。但`powerFirstLastDeltaW`只支持首段与末段功率差值为0，不能支持“功率全程没有变化”。服务端的`OVERBROAD_SERIES_CONCLUSION`会拒绝该输出；Prompt v3.1.2已增加明确反例，要求改写为“功率首末阶段没有变化”，除非上下文存在全程统计Claim。

本轮进一步发现“功率保持一致”虽未出现“全程”字样，仍缺少范围限定。服务端新增`UNSCOPED_CONSISTENCY_CONCLUSION`，仅允许带有“首末/开始/结束/阶段”限定的一致性表达；不重新收紧已允许的统计量合理定性。

## 24. RUN-20260824-023｜v3.1.2 L3试运行归档与合同修复复验

用户提供的最终Prompt v3.1.2单条L3扣子输出已原样归档为[`RUN-20260824-023`](../eval/runs/RUN-20260824-023.json)。精确模型ID、模型参数、请求ID、运行角色、延迟、Token与成本均未出现在原日志中，因此全部保留为`NOT_RECORDED`；本地复验没有调用模型，也不能补足这些运行证据。

原始输入属于`ride-feature-rules-v0.1 / ride-analysis-service-v1.4`。首次合同回放返回`DIMENSION_UNSUPPORTED_NUMBER`和`TEXT_UNSUPPORTED_NUMBER`，定位到两项确定性合同缺陷，而不是模型计算错误：

- speed/power/cadence的变异系数被错误标成`m/s / W / rpm`，实际应是无量纲`ratio`；模型写“约11%”“约6%”的换算正确。
- 数字白名单只允许换算结果舍入，却没有允许同一Claim原值合理舍入，因而误拒`151.73→约152`、`-9.77→约10`和`-8.33→约8.3`。

修复后矩阵为`ride-feature-rules-v0.2 / ride-analysis-service-v1.5`，Prompt仍为`3.1.2`、Workflow仍为`ride_analysis_v2-dev.15`、Few-shot仍为`disabled`。原始输出未改写；使用修复后的同一L3 fixture重建上下文后，合同回放为`PASS`。L3导出上下文中的三项CV均为`unit=ratio / displayUnit=ratio`，均值、标准差和首末差继续保留物理单位。

验证证据：聚焦回归36/36通过；`pnpm verify` 176/176通过；`pnpm build`通过；交付系统校验0 error / 0 warning。该证据只证明这条L3原始输出可被修复后的确定性合同正确验证，不证明模型质量稳定、首次/修复角色、延迟、Token、成本或V014整体完成。

本切片状态：`READY_FOR_PREVIEW`。`ITEM-V014`整体仍未验收；用户接受本切片后，下一项才是使用最终v3.1.2补跑L1/L2，再复验最终版本的一次受限修复与B0路径。

## 25. 用户验收：L3归档与合同修复切片

2026-08-24，用户明确回复接受“L3归档与合同修复”切片。该验收覆盖`RUN-20260824-023`的原始输出归档、`ride-feature-rules-v0.2 / ride-analysis-service-v1.5`确定性修复、修复后本地合同回放及其证据边界。

本次验收不等于`ITEM-V014`整体完成，也不补足原扣子运行中未记录的模型ID、请求ID、首次/修复角色、延迟、Token或成本。下一验证切片固定为最终Prompt v3.1.2的L1/L2扣子试运行；L1/L2通过后仍需复验最终版本的一次受限修复与B0路径。

## 26. RUN-20260824-024/025｜最终v3.1.2 L1/L2扣子试运行

用户使用当前L1/L2五变量输入完成两次扣子试运行，原始JSON分别归档为[`RUN-20260824-024`](../eval/runs/RUN-20260824-024.json)和[`RUN-20260824-025`](../eval/runs/RUN-20260824-025.json)，截图归档在`eval/runs/evidence/`。两次运行均使用Prompt v3.1.2、Workflow dev.15、Few-shot disabled输入；本地按`ride-feature-rules-v0.2 / ride-analysis-service-v1.5`重建对应fixture并回放，结果均为`PASS / 0 issue`。

截图只支持以下运行元数据：模型界面显示名为“豆包·2.0-lite”；L1工作流显示11秒、模型节点10秒、8583 Tokens；L2工作流显示16秒、模型节点15秒、11092 Tokens。精确Provider `model_id`、请求ID、精确毫秒延迟、输入/输出Token拆分和成本没有显示，继续记为`NOT_RECORDED`，不得用界面显示名或整数秒替代。

### 26.1 L1质量审查

- `pace/climbing`保持业务维度，没有退化成字段卡；pace完成“事实 + 直接意义”，climbing在无可靠分类时使用事实降级。
- headline突出后程配速回落和速度波动；overallAssessment引用了文本中的速度、爬升与海拔主题，Claim覆盖完整。
- limitations说明历史、传感器和判断边界；`nextAction`为无Claim绑定的低风险通用建议；shareCopy使用已允许的可编辑主观表达。
- 非阻断备注：直接展示“变异系数0.11”仍偏专业；overallAssessment末句重复了limitations中的强度/体能边界。

### 26.2 L2质量审查

- `pace/heartRate/cadence/climbing`与当前准入能力一致；没有生成power或history维度。
- overallAssessment把距离、时间、平均速度与速度/心率/踏频首末变化合并为整体判断，没有机械重复全部维度；主题Claim覆盖完整。
- 心率区间、功率缺口和历史限制表达准确，通用建议与分享文案符合当前边界。
- 非阻断备注：心率和踏频维度同时引用活动聚合均值与序列均值，证据略冗余但没有事实冲突；climbing保持事实罗列是合法降级。

验证：新增RUN回放与截图元数据测试4/4通过；含已接受L3的聚焦证据测试6/6通过；`pnpm verify` 180/180通过。本轮未修改Prompt、输出Schema或产品规则，也未执行受限修复/B0路径。

本L1/L2试运行切片状态：`READY_FOR_PREVIEW`。两条均通过硬合同和Agent质量审查，非阻断备注不要求修改Prompt；是否接受该切片仍由用户决定。

## 27. 用户验收：最终v3.1.2 L1/L2试运行切片

2026-08-24，用户明确接受“最终Prompt v3.1.2 L1/L2试运行”切片。该验收覆盖`RUN-20260824-024/025`原始输出与截图归档、Service v1.5合同回放、Agent质量审查，以及精确模型ID、请求ID、毫秒延迟、Token拆分和成本均未记录的证据边界。

本次验收不等于`ITEM-V014`整体完成，也不证明稳定性基准、T001或G1通过。下一验证切片固定为最终Prompt v3.1.2的一次受限修复与二次失败转B0路径复验；旧v3.1.1的`RUN-20260823-019/020`只作为历史证据，不替代最终版本验证。

## 28. 最终v3.1.2受限修复输入准备

已生成[`l3-built-in-sample-repair-v3.1.2.json`](../output/coze-inputs/l3-built-in-sample-repair-v3.1.2.json)，严格保留`analysis_context / analysis_elig / few_shot_json / repair_instruction / previous_output`五个扣子输入。输入使用已验收的`RUN-20260824-023` L3原始输出作为基底，只在人为构造的`previous_output.overallAssessment`末尾增加“本次骑行达到999W”并引用未知`claim:other-ride:avgPowerW`，用于稳定触发`OVERALL_UNKNOWN_CLAIM / OVERALL_UNSUPPORTED_NUMBER / TEXT_UNSUPPORTED_NUMBER`。

`repair_instruction`由Service v1.5实际校验结果生成，不是手工猜测错误码；Few-shot保持`disabled`且`examples=[]`。扣子真实修复应只删除或纠正上述未知Claim和无依据数字，不新增事实、数字、Claim、维度或建议，并保持其余已验收内容不被无关改写。

验证：输入导出聚焦测试2/2通过；`pnpm verify` 182/182通过；`git diff --check`通过；交付系统校验0 error / 0 warning。本节只证明修复输入可复现且合同正确，尚未调用扣子模型，也没有修复后的原始输出、请求元数据或质量结论。

真实运行步骤：在当前Prompt v3.1.2、Workflow dev.15、Few-shot disabled配置中，把该JSON五个值原样填入同名输入后运行一次；保留未经人工修改的输出JSON和包含模型显示名、时长、Token的运行截图，再交由Service v1.5回放与人工审查。

## 29. RUN-20260824-026/027｜最终v3.1.2受限修复与B0路径复验

用户使用第28节五变量输入完成真实扣子受限修复，原始输出与截图归档为[`RUN-20260824-026`](../eval/runs/RUN-20260824-026.json)。修复结果删除了未知`claim:other-ride:avgPowerW`与无依据`999W`，Service v1.5回放为`PASS / 0 issue`；输出与已验收的`RUN-20260824-023`完全一致，未新增或无关改写事实、数字、Claim、维度或建议。

截图显示模型名“豆包·2.0-lite”、工作流19秒、模型节点18秒、总计14543 Tokens。精确Provider `model_id`、请求ID、毫秒延迟、Token拆分和成本仍未显示并保持`NOT_RECORDED`；界面显示名和整数秒不替代这些字段。

最终二次失败路径归档为[`RUN-20260824-027`](../eval/runs/RUN-20260824-027.json)。该项使用确定性测试Provider连续返回`not-json / still-not-json`，不调用真实模型。Service v1.5观察结果为`source=b0 / fallbackCode=REPAIR_FAILED / attempts=2`，Provider调用数2、无第三次调用，Few-shot disabled，`b0-template-v0.1`输出通过确定性合同；测试Provider的模型Token与成本均为0。

验证：本切片聚焦证据测试6/6通过；`pnpm verify` 186/186通过；Prompt、Few-shot、输出Schema和产品规则均未修改。该证据证明最终`Prompt v3.1.2 / Service v1.5 / Workflow dev.15 / Few-shot disabled`候选的一次真实受限修复与服务端二次失败B0路径可工作，不证明18条×3次稳定性、真实端到端B0触发率、精确模型成本、T001或G1通过。

本最终链路切片状态：`READY_FOR_PREVIEW`。用户接受后再进行`ITEM-V014`整体验收判断；T001真实B2仍暂停。

## 30. 用户验收：最终v3.1.2受限修复与B0路径切片

2026-08-24，用户明确接受“最终v3.1.2受限修复与B0路径”切片。该验收覆盖`RUN-20260824-026`真实受限修复、`RUN-20260824-027`确定性二次失败转B0，以及两条证据各自的运行元数据边界。

本次验收不补足RUN-026未记录的精确模型ID、请求ID、毫秒延迟、Token拆分和成本，也不把RUN-027的确定性测试Provider称为真实模型运行；不代表T001、18条稳定性基准或G1通过。

## 31. ITEM-V014整体验收审计

| 验收面 | 证据 | 结论 |
|---|---|---:|
| 最终Prompt与旧版保留 | Prompt v3.1.2独立文件；v3.1/v3.1.1及其他候选未覆盖 | PASS |
| 五变量扣子输入 | `analysis_context / analysis_elig / few_shot_json / repair_instruction / previous_output` | PASS |
| Few-shot基线 | `disabled`、`examples=[]`，误开也不注入草稿 | PASS |
| 输出与服务端合同 | output-v0.3；Service v1.5校验Schema、Claim、数字/换算、能力和安全 | PASS |
| 最终真实样例 | L3 `RUN-023`、L1 `RUN-024`、L2 `RUN-025`；三个切片均已用户验收 | PASS |
| 一次受限修复 | `RUN-026`只删除注入的未知Claim与`999W`，恢复已验收L3输出 | PASS |
| 二次失败转B0 | `RUN-027`两次调用后`REPAIR_FAILED + B0`，无第三次调用 | PASS |
| 自动回归 | `pnpm verify` 186/186；聚焦修复/B0证据6/6 | PASS |
| 交付文档一致性 | `git diff --check`通过；交付系统0 error / 0 warning | PASS |

审计结论：`ITEM-V014`目标与第5节约定的最终真实样例、一次修复和B0降级证据均已完成，当前具备整体验收条件，状态为`READY_FOR_PREVIEW`。V014只证明开发候选联调链路成立，不证明B2相对B0的价值增量、18条×3次稳定性、精确模型成本/P95、UI接入或G1通过。

请求用户明确确认：`接受 ITEM-V014`。在该确认前不把工作项标记为`ACCEPTED`，也不启动T001真实B2。

## 32. 用户验收：ITEM-V014整体

2026-08-24，用户明确回复`接受 ITEM-V014`。本项最终验收范围为`Prompt v3.1.2 + ride-analysis-service-v1.5 + ride_analysis_v2-dev.15 + Few-shot disabled + ride-analysis-output-v0.3`的开发联调候选，以及第31节列出的真实样例、一次受限修复、二次失败B0和自动回归证据。

`ITEM-V014`状态更新为`ACCEPTED`。该验收不发布扣子工作流、不接入API或UI、不补足精确模型计量，也不代表T001、B1/B2/B3、G1或生产放行。下一工作项仅审查并重冻结T001的Service v1.5版本矩阵；完成预览与确认前不运行54槽真实B2。
