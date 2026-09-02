# ITEM-V013｜新骑后输出 Schema 与 AnalysisEligibility 组合合同评审

> 日期：2026-08-21  
> 状态：`ACCEPTED`  
> 当前阶段：v0.1 证据型 Demo / G1「Demo核心价值」  
> 边界：只冻结模型调用准入和骑后解读输出合同，不接入新 Prompt、扣子 Workflow、模型配置、RAG、Function Calling、UI或旧输出链路。

## 1. 工作项目标

在已验收的 `RideAnalysisContext v0.2` 之上冻结两个确定性合同：

1. `AnalysisEligibility v0.1`：由服务端规则判断是否值得调用大模型、开放哪些解读维度及使用哪条兜底路径；模型不得参与这个判断。
2. `ride-analysis-output-v0.3`：约束模型骑后解读的结构、维度、claim/evidence引用、建议类型、分享文案和安全边界。

## 2. 依据审计

### 2.1 已核对来源

- PRD 6.3：AI评价本次骑行及其意义，不评价数据完整度；根据实际可用能力动态生成速度/心率/功率/踏频/海拔/历史等维度；首次骑行或历史不可比时静默省略历史，不向用户展示“没有足够历史”。
- PRD 7.5.1–7.5.4：模型只解释确定性事实、`RideFeatureSnapshot`和`HistoricalComparisonSnapshot`；输出必须引用稳定claim，原始轨迹、历史原始记录和不可用能力不得进入模型结论。
- PRD 7.6.1、7.8、7.9、7.11：先计算能力与特征，再决定是否调用模型；输出必须经过Schema、数字、能力和安全校验；失败时保留B0确定性价值并可固定安全停止。
- 研发指南 5.1、5.2、6.3、6.4、7.8：规则负责事实和边界，模型负责解释；新合同独立版本化；一次受约束修复后仍失败必须降级，不得无限重试。
- 版本路线图：V013是进入新Prompt/Few-shot/扣子联调前的P0前置合同；B1/B2/B3在新合同链路完成前继续 `NOT_RUN`。
- DEC-029至DEC-039、DEC-050：不使用L1/L2/L3作为业务门；动态原子能力、确定性历史Snapshot、无历史静默省略、亮点事件规则化、grounded/general建议边界均已确认。

### 2.2 冲突结论

未发现需要用户确认的产品方向冲突。PRD的旧输出描述与路线图中的新合同属于版本迁移关系；V013不修改PRD产品行为，只把已接受的能力和证据边界落成可校验合同。

## 3. `AnalysisEligibility v0.1` 合同

### 3.1 字段

- `schemaVersion=0.1`、`rulesVersion=analysis-eligibility-rules-v0.1`；
- `eligible/status`：`eligible`、`not_eligible`、`blocked`；
- `reasonCodes`：上下文无效、记录拒绝、无合法claim、无洞察来源、特征可用、历史可比、安全阻断；
- `insightSources`：`feature`、`history`；
- `allowedDimensionKeys`：`pace`、`heartRate`、`power`、`cadence`、`climbing`、`history`等实际开放维度；不包含L1/L2/L3；
- `requiredClaimIds`：确定性上下文中允许模型引用的特征/历史claim索引；
- `fallback`：普通降级`b0`，安全阻断`safety_stop`。

### 3.2 准入规则

1. 上下文合同无效 → `blocked / CONTEXT_INVALID`。
2. `stop_generation`或`critical_safety` → `blocked / SAFETY_BLOCK / safety_stop`。
3. 全部原子能力因`RECORD_INVALID`关闭 → `blocked / RECORD_REJECTED`。
4. 没有合法当前指标 → `not_eligible / NO_ALLOWED_CLAIMS`。
5. 只有概要指标、没有可解释特征或可比历史 → `not_eligible / NO_INSIGHT_SOURCE`，直接使用B0，不调用模型。
6. 存在可用单次特征时，按特征键开放对应维度；可靠踏频、海拔等能力独立判断，不因缺时间戳被连带关闭。
7. 存在可比历史claim且历史能力可用时开放`history`；长期`trend`规则尚未实现，不能因有Snapshot自动开放。
8. 首次骑行/历史不可比不产生历史维度，也不向用户展示历史不足提示。

## 4. `ride-analysis-output-v0.3` 合同

模型只能返回严格 JSON：

- `headline`：≤20字；
- `overallAssessment`：总结本次骑行及意义，必须有claim；
- `dimensions[]`：每项为允许维度，必须有相关claim和置信度，最多6项；
- `notableEvents[]`：只接受确定性规则产生的事件，最多3项；没有事件时为空数组；
- `nextAction`：可为`null`；`grounded`必须绑定相关claim，`general`不得绑定claim；
- `limitations[]`：最多5条；
- `safetyLevel`：`normal/caution/stop`；若上下文存在安全停止标记，必须为`stop`；
- `shareCopy`：正好3条，每条≤50字。

服务端拒绝：未知字段/Schema、未授权维度、未知或重复claim、未被证据支持的数字、grounded/general建议绑定错误、医疗诊断/保证提升/恢复时间/体能提升或提示词/密钥泄露等高风险文案。任何合同失败都不把模型文本直接展示给用户。

## 5. 实现与验证证据

- [准入合同实现](../src/domain/analysis-eligibility.ts)
- [输出合同实现](../src/ai/ride-analysis-output-v03.ts)
- [准入测试](../tests/analysis-eligibility.test.ts)
- [输出测试](../tests/ride-analysis-output-v03.test.ts)
- V009–V012既有能力、特征、历史和上下文测试继续作为前置回归。

| 检查 | 结果 |
|---|---:|
| `pnpm typecheck` | PASS |
| `pnpm test` | 136/136 PASS（新增16条V013专项测试） |
| `pnpm build` | PASS |
| 交付系统校验 | PASS；0 error / 0 warning |
| Prompt/Few-shot | `NOT_RUN`；下一项实现 |
| 扣子 Workflow/模型/RAG/Function Calling/UI | `NOT_RUN`；不属于本项 |

## 6. 明确不在本项实现

- 不创建或替换System Prompt，不配置temperature/最大Token等模型参数；
- 不接入扣子节点、真实模型、一次修复分支或前端展示；
- 不把历史数值交给RAG，不增加Function Calling；
- 不修改旧`RideContextSnapshot v1.0`、旧B2链路或旧Prompt为新合同的唯一实现；
- 不宣称已证明AI洞察价值、延迟、成本、模型质量或G1通过。

## 7. 用户预览与验收

请审阅：

1. 是否接受由确定性代码先判断`AnalysisEligibility`，无洞察来源时直接B0；
2. 是否接受`ride-analysis-output-v0.3`的多维输出、claim引用、事件空数组、建议类型和安全校验；
3. 是否接受首次/不可比历史静默省略，长期trend继续关闭；
4. 是否接受本项不启动Prompt、Few-shot、扣子、模型和UI联调。

请明确回复：`接受 ITEM-V013` 或提出修改意见。

验收后下一项：`新骑后 Prompt/Few-shot/扣子输入联调`。

## 8. 用户验收

用户于2026-08-21明确回复“接受 ITEM-V013”，验收`AnalysisEligibility v0.1`、`ride-analysis-output-v0.3`、动态维度门、claim/evidence校验、首次/不可比历史静默规则和安全/兜底边界。

本次验收不代表Prompt、Few-shot、扣子Workflow、模型、RAG、Function Calling、UI或G1价值门已放行。

下一工作项：`新骑后 Prompt/Few-shot/扣子输入联调`。
