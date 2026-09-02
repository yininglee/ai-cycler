# ITEM-V012｜RideAnalysisContext 新 AI 上下文合同评审

> 日期：2026-08-21  
> 状态：`ACCEPTED`  
> 当前阶段：v0.1 证据型 Demo / G1「Demo核心价值」  
> 边界：只建立服务端模型上下文合同，不接入新 Prompt、扣子 Workflow、模型输出 Schema 或 UI。

## 1. 工作项目标

将旧`RideContextSnapshot v1.0`迁移为不带L1/L2/L3业务等级的`RideAnalysisContext v0.2`，把已验收的原子能力、当前骑行事实、单次特征、必要个人基线和历史比较事实组装为模型最小白名单上下文。

## 2. 依据审计

### 2.1 已核对来源

- PRD 7.5.1–7.5.4：原始FIT/GPX、时序、核心指标、个人档案和历史聚合不向量化为事实源；上下文必须包含能力、记录/计算/估算值、质量、允许claim、禁止结论、安全和隐私边界；模型不得重选历史或重算变化。
- PRD 7.6.1：骑后Workflow先确定性计算原子能力、特征、历史Snapshot，再生成模型最小上下文；无可解释特征时不调用模型。
- 研发指南 5.1–5.4、8.1：原始轨迹/时序不直接发模型；新Context必须冻结后才建立新Prompt；旧Prompt只作失败学习证据。
- 路线图 v0.1：V012是V011历史事实合同后的P0前置切片；本项完成后才进入新输出Schema、Prompt/Few-shot和扣子联调。
- DEC-030/031/033/034/050：原子能力替代L1/L2/L3业务门；历史数值来自确定性Snapshot；FTP与功率分离；最大心率来源/时间/公式保留；新合同按已接受模块矩阵推进。

### 2.2 冲突结论

未发现需要用户确认的产品方向冲突。PRD仍使用旧`RideContextSnapshot`名称描述最小契约，路线图和研发指南已将新版本定义为`RideAnalysisContext v0.2`；本项将其作为兼容性迁移，不修改PRD的产品行为。

## 3. 冻结的 v0.2 合同

### 3.1 顶层字段

- `schemaVersion=0.2`、`rulesVersion=ride-analysis-context-rules-v0.1`、`contextType=ride_analysis`、`rideId`、`userScope`；
- `capabilities[]`：完整18项原子能力，不包含`dataLevel`；若提供历史Snapshot，则确定性提升`historyComparison`/`sameRouteComparison`能力，`trend`仍因规则未实现而关闭；
- `recordedMetrics`、`derivedMetrics`、`estimatedMetrics`：仅保留质量有效且有限的当前骑行指标，保留来源字段、单位、证据、记录时间和公式版本；
- `featureSnapshot`：已校验的`RideFeatureSnapshot v0.1`，包含可用特征及不可用原因；
- `historicalComparison`：可选的、已校验的`HistoricalComparisonSnapshot v0.1`，模型只能解释其结果；
- `profileFacts`：显式字段白名单，默认不注入个人资料；可按调用方选择年龄、身高、体重、最大心率和FTP，并保留来源、更新时间、公式/可信状态；
- `allowedClaims[]`：当前指标、特征和历史结论的稳定claim/evidence索引；
- `forbiddenClaims[]`、`limitations[]`、`safetyFlags[]`、`privacyFlags[]`：确定性边界和降级信息。

### 3.2 隐私与事实边界

- 不包含`dataLevel`、原始时序点、精确坐标、源文件名、完整轨迹或不可信自由文本；
- 个人资料只有被显式列入`profileFieldKeys`时才进入上下文；
- 历史数值、基线、变化率和可比性完全来自`HistoricalComparisonSnapshot`，模型不得自行查询、重选样本或计算变化；
- 估算值与记录值分桶，不覆盖彼此；缺失或低质量值不生成claim。

## 4. 实现与验证证据

- [上下文合同实现](../src/domain/ride-analysis-context.ts)
- [V012专项测试](../tests/ride-analysis-context.test.ts)
- V010/V011的原子能力、特征和历史合同测试继续作为前置回归。

| 检查 | 结果 |
|---|---:|
| `pnpm typecheck` | PASS |
| `pnpm test` | 120/120 PASS（V012新增5条） |
| `pnpm build` | PASS |
| 交付系统校验 | PASS；0 error / 0 warning |
| Prompt/扣子/模型输出/RAG/Function Calling/UI | `NOT_RUN`；不属于本项 |

## 5. 验收标准

- 同一输入和规则版本生成稳定上下文；
- 新上下文不含`dataLevel`，不泄露原始轨迹、精确坐标、源文件名或未请求个人资料；
- 当前指标、单次特征、原子能力、历史Snapshot和claim/evidence可被校验；
- 历史Snapshot与锚点骑行不匹配或违反合同必须拒绝组装；
- 有历史Snapshot时只开放可比的历史能力，长期`trend`仍关闭；
- 不修改旧Prompt、扣子Workflow、模型输出Schema或UI。

## 6. 用户预览

请审阅以下范围：

1. 是否接受`RideAnalysisContext v0.2`作为后续Prompt/扣子输入的唯一模型上下文合同；
2. 是否接受个人资料默认不注入、只有调用方显式白名单才进入；
3. 是否接受历史比较只通过已校验Snapshot进入，模型不直接拿原始历史数据；
4. 是否接受本项不启动Prompt、扣子、模型输出Schema和UI联调。

请明确回复`接受 ITEM-V012`或提出修改意见。验收后下一项为新骑后输出Schema与`AnalysisEligibility`组合合同。

## 7. 用户验收

用户于2026-08-21明确回复“接受 ITEM-V012”，验收`RideAnalysisContext v0.2`、显式个人资料白名单、历史/特征跨合同校验、无`dataLevel`迁移结果及隐私边界。

本次验收不代表新骑后输出Schema、`AnalysisEligibility`、Prompt、扣子Workflow、模型、RAG、Function Calling或UI已放行。

下一工作项：`ITEM-V013｜新骑后输出Schema与AnalysisEligibility组合合同`。
