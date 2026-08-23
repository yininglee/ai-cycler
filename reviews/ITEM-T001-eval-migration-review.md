# ITEM-T001｜新合同评测迁移审查

## 1. 状态

`IN_PROGRESS`

本项启动于 2026-08-23。目标是把旧的混合评测资产迁移到 `ride-analysis-output-v0.3` 自动骑后合同，并建立 B0/B1/B2/B3 可重复执行记录。新合同上下文和 B0 确定性基线已完成；真实模型基准尚未运行。

## 2. 来源审查

| 来源 | 本项采用的要求 |
|---|---|
| PRD 6.3 | 自动骑后回答整体表现、主要依据、用户意义；按实际能力选择业务维度；下一步可为证据相关建议、低风险通用建议或 `null`。 |
| PRD 7.11 | 先硬门槛，再质量 Rubric，再产品验证；B2 综合质量至少 4.2/5，洞察价值相对 B0 至少提升 1 分。 |
| 研发指南 13–14 | B0 为确定性模板；B1 无白名单/后校验；B2 为规则事实+白名单+严格 JSON+后校验；B3 只替换模型；B1/B2/B3 每条运行 3 次并保留失败与重试。 |
| 路线图 G1 / W4 | 新合同固定集完成迁移后才执行 B1/B2/B3；P95、成本、降级率和硬门槛必须记录；未测不得宣称 G1。 |
| DEC-059 / DEC-060 / DEC-061 | Few-shot 固定关闭；允许事实驱动合理定性；历史限制只在 limitations 展示且不生成 history；同一 Claim 的有限换算可校验。 |

## 3. 旧资产审计

`eval/ai-cycling-eval-cases.jsonl` 共 30 条：18 条与自动骑后或其边界相关，7 条属于安全/注入/工具/RAG 对话场景，5 条混合了主动用户问题与旧 L1/L2/L3 合同。旧文件保留为历史来源，不直接作为新合同基准。

主要不兼容点：旧用例要求“样本不足”或“无历史”必须展示，但当前自动骑后允许只在 `limitations` 说明历史记录不足且不生成 `history`；旧用例使用不存在的 fixture 名称；旧用例预期字段型能力/旧层级，不对应 v0.3 业务维度和 `AnalysisEligibility`。

## 4. 迁移结果

迁移清单见 [`eval/ride-analysis-cases-v0.3-migration.json`](../eval/ride-analysis-cases-v0.3-migration.json)。

- 18 条自动骑后候选已分配 `RA-AUTO-*` ID、目标业务维度和上下文边界。
- 18 个条目现在都可使用固定 fixture 运行；其中 `short-fit-ride` 覆盖两条短活动边界，新增 7 个补充上下文 fixture 覆盖历史、室内模式、估算来源和 FTP 不足。
- 12 条安全、注入、工具和 RAG 来源用例延后到独立对话集，避免将自动骑后 v0.3 与对话合同混测。

## 5. B0/B1/B2/B3 状态

| 方案 | 状态 | 说明 |
|---|---|---|
| B0 | `RUN` | 使用 `b0-template-v0.1` 和当前 fixtures；结果追加到 benchmark report。 |
| B1 | `NOT_RUN` | 本机没有冻结的直接 LLM 运行配置；不能伪造结果。 |
| B2 | `NOT_RUN` | 扣子真实服务尚未按 T001 固定集逐条运行；V014 单条冒烟不等同基准。 |
| B3 | `NOT_RUN` | 没有同条件替代模型的真实运行配置。 |

## 6. 本项验收标准

- [x] 旧 30 条文件保留，自动骑后与对话边界被显式记录。
- [x] 新合同迁移清单包含稳定 ID、fixture 状态、目标业务维度和不可推断边界。
- [x] B0 当前确定性基线已执行并追加报告。
- [x] 18 条自动骑后集全部拥有可运行的新合同上下文；每条均可生成 `RideAnalysisContext v0.2` 和 `AnalysisEligibility v0.1`。
- [ ] B1/B2/B3 每条 3 次，保留失败/修复/降级和版本矩阵。
- [ ] 两名评审完成盲评，B2 综合质量和相对 B0 洞察门槛可计算。

## 7. 当前结论

T001 尚未完成；上下文、B0、扣子输入和B2运行准备已经完成，当前进入用户验收门。验收后只允许执行冻结的真实B2固定集，不能据此宣称 B1/B2/B3 通过、G1 通过或产品质量达标。

## 8. 下一步

补齐工作已完成；B0已按18条新合同案例完成运行，证据见`RUN-20260823-022`。下一步是在同一版本矩阵下取得冻结的模型 ID、运行 ID、延迟、Token 和成本，按每条3次协议执行B2，再运行B1/B3对照。

## 9. RUN-20260823-022｜18条新合同B0基线

### 9.1 结果

| 检查项 | 结果 | 证据边界 |
|---|---:|---|
| `RideAnalysisContext v0.2`合同 | 18/18 PASS | 18条`RA-AUTO-*`固定上下文 |
| `AnalysisEligibility v0.1`合同 | 18/18 PASS | 含不可比历史、室内和质量降级边界 |
| 预期关注维度有可用证据 | 18/18 PASS | `expectedDimensionKeys`按关注子集检查 |
| B0确定性输出 | 18/18 PASS | `b0-template-v0.1`，旧`RideContextSnapshot v1.0`路径 |
| P50 / P95 | 0.188ms / 1.684ms | 本机进程内，不是端到端SLO |
| 模型调用 / Token / 成本 | 0 / 0 / ¥0 | B0不调用模型 |

### 9.2 清单更正

`RA-AUTO-014`原先把`climbing`列为预期维度，但其fixture没有海拔事实；已修正为`pace`、`heartRate`。这属于评测清单与fixture的可观测边界修正，不是模型结果或产品能力扩展。

### 9.3 结论

B0基线通过，只说明固定输入、上下文合同和确定性兜底可重复执行；B1/B2/B3、人工质量评分、成本、端到端P95和G1仍为`NOT_RUN`。

## 10. T001扣子输入资产

- 新增命令：`export:coze:t001`。
- 产物：`output/coze-inputs/t001-RA-AUTO-001.json`至`t001-RA-AUTO-018.json`。
- 每个文件包含五个短变量：`analysis_context`、`analysis_elig`、`few_shot_json`、`repair_instruction`、`previous_output`；导出前逐条通过上下文与准入合同校验。
- 当前`few_shot_json.mode=disabled`且`examples=[]`，不代表B2模型已运行。

## 11. B2真实运行准备项

### 11.1 已完成

- 冻结清单：[`eval/t001-b2-benchmark-manifest.json`](../eval/t001-b2-benchmark-manifest.json)，固定18条案例、每条3次、共54个唯一槽位，并引用B0对照`RUN-20260823-022`。
- 接收协议：[`eval/t001-b2-run-protocol.md`](../eval/t001-b2-run-protocol.md)，要求精确模型ID、区域、非空模型参数、时间、延迟、Token、成本、本地/Provider请求ID和最多两次完整尝试。
- 导入校验：`benchmark:t001:b2:validate`拒绝缺失/重复槽位、版本漂移、不可追溯计量、不准入案例模型调用或成本，以及畸形嵌套JSON；合法批次通过实际`runRideAnalysis`链路重放首次输出、一次受限修复和B0降级。
- 防误判：产物只记录`validationStatus=PASS/FAIL`和`benchmarkStatus=NOT_SCORED`；导入成功不等于B2质量通过，已有RUN文件使用`wx`禁止覆盖。

### 11.2 验证

| 检查项 | 结果 | 证据边界 |
|---|---:|---|
| 聚焦测试 | 6/6 PASS | 含54槽完整回放、畸形输入、不可准入成本、一次修复和二次失败降级 |
| 全量回归 | 173/173 PASS | `pnpm verify` |
| 生产构建 | PASS | `pnpm build` |
| 交付系统 | 0 error / 0 warning | `validate_delivery_system.py .` |
| 真实B2模型运行 | `NOT_RUN` | 测试中的51次B2成功与3次B0仅为合成Provider回放，不是模型证据 |

### 11.3 验收门

本准备项等待用户预览和确认。确认后下一步才是使用冻结的精确模型配置执行18条×3次真实B2；没有真实模型ID、区域、参数和Token/成本来源时，不创建运行结果、不评分、不推进B1/B3或G1。

项目在2026-08-24由用户确认建立首个本地Git基线。基线建立前`main`分支没有commit且项目文件均未跟踪；后续真实B2必须记录所用commit，使RUN可以对应到不可变的源码、Prompt和服务配置。
