# ITEM-T001｜新合同评测迁移审查

## 1. 状态

`IN_PROGRESS`（Service v1.5版本矩阵重冻结审查切片`READY_FOR_PREVIEW`）

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

T001 尚未完成；上下文、历史B0、扣子输入和Service v1.4时点的B2运行准备已完成。V014验收后，现有准备资产需按第12节重冻结到Service v1.5/特征规则v0.2；在方案与实施分别验收前不执行真实B2，也不宣称B1/B2/B3或G1通过。

## 8. 下一步

历史B0已按18条新合同案例完成，证据见`RUN-20260823-022`。当前下一步是用户确认第12节Service v1.5重冻结方案；确认后先实施新manifest/批次合同、输入摘要和同矩阵B0，不直接运行B2。

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

本节记录的是Service v1.4时点准备资产。V014已验收Service v1.5/特征规则v0.2，因此不再从本节直接进入真实B2；先按第12节完成重冻结方案和实施验收。没有精确模型ID、区域、参数、Token/成本来源和完整`sourceCommit`时，不创建运行结果、不评分、不推进B1/B3或G1。

项目在2026-08-24由用户确认建立首个本地Git基线。基线建立前`main`分支没有commit且项目文件均未跟踪；后续真实B2必须记录所用commit，使RUN可以对应到不可变的源码、Prompt和服务配置。

## 12. Service v1.5版本矩阵重冻结审查

### 12.1 来源与范围

2026-08-24按PRD 6.3/7.11、研发指南6/13/14、路线图v0.1/G1及`DEC-058/059/060/061/062/063/064`完成定向复审，未发现产品行为或Gate冲突。本切片只审查并形成重冻结方案；不改写冻结manifest，不发布扣子工作流，不接入API/UI，不调用模型，不创建B2结果或G1结论。

### 12.2 可观测差异

| 对象 | 当前事实 | 影响 |
|---|---|---|
| Service | 已验收运行基线为`ride-analysis-service-v1.5`；manifest、接收协议、导入器冻结常量和测试仍为`v1.4` | 当前54槽清单不能接收v1.5真实批次 |
| 特征规则/输入 | V014将`ride-feature-rules-v0.1`修复为`v0.2`，18个五变量输入的CV单位和展示值随之变化 | 不是单纯Service标签变更；必须重冻结输入集 |
| B0对照 | `RUN-20260823-022`记录的是Service v1.4/特征规则v0.1时点的18条基线 | 应保留为历史证据，但不能作为v1.5新输入矩阵的直接B0对照 |
| Git | 首个本地基线为`8c1677834c8ab2d8e03035104b9c720ccdd44243`，但它早于后续已验收V014修复；当前工作树仍有未提交变更 | 真实B2不能把该首个基线冒充为实际源码版本 |
| 五变量合同 | 当前18/18文件均只含`analysis_context / analysis_elig / few_shot_json / repair_instruction / previous_output`，Schema和Few-shot状态合法 | 不需要向扣子输入新增第六个元数据变量 |

### 12.3 建议的最小实施方案

1. 将T001 B2 manifest、raw batch和evaluated run合同升为`v0.2`，明确表达这是一次新的冻结，不静默改写旧`v0.1`语义。
2. 新矩阵固定Prompt `3.1.2`、Service `ride-analysis-service-v1.5`、Workflow `ride_analysis_v2-dev.15`、`ride-feature-rules-v0.2`、Few-shot `disabled`及现有Schema/准入/上下文/B0版本。
3. 从当前生成器重新导出18个五变量文件，对按caseId排序的文件记录SHA-256摘要；摘要只放在manifest/运行元数据，不改扣子五变量合同。
4. 在同一v1.5/特征规则v0.2输入集上重跑一次不调模型的B0，使新manifest引用新B0 RUN；`RUN-20260823-022`原样保留为历史基线。
5. 真实B2 raw batch必须新增完整`sourceCommit`，并继续要求精确`modelId`、区域、非空模型参数、请求ID、延迟、Token和成本。真实运行前先建立一个包含已验收V014及重冻结实现的新本地commit；不使用较旧`8c16778...`代替。
6. 导入器同时校验Service、特征规则、输入摘要和`sourceCommit`的完整性，保留现有54槽、最多两次Provider尝试、不准入0调用/0 Token/0成本、`NOT_SCORED`和禁止覆盖RUN的规则。

### 12.4 本轮明确不采用

- 只将manifest和协议中的`v1.4`字符串替换为`v1.5`；
- 把`RUN-20260823-022`的历史版本字段改写为v1.5，或将其当作新输入集的同矩阵B0；
- 在未提交当前已验收修复时，把首个Git基线`8c16778...`写成未来B2的`sourceCommit`；
- 为记录版本而改变扣子五变量输入合同，或在本切片发布/调用模型。

### 12.5 本切片验证与验收请求

- 18/18现有输入通过五变量、`RideAnalysisContext v0.2`、`AnalysisEligibility v0.1`和Few-shot disabled静态检查；
- 已确认首个本地Git基线为`8c1677834c8ab2d8e03035104b9c720ccdd44243`，并确认当前存在其后未提交变更；
- 本轮没有执行模型、B1/B2/B3、质量评分或G1判断。

请用户确认或修改本节12.3方案。确认后才实施manifest/协议/导入器/测试与新B0冻结；实施验收后才决定是否建立新commit并发布测试环境执行真实B2。

## 13. Service v1.5重冻结实施

### 13.1 用户授权

2026-08-24用户明确接受`DEC-065`，授权实施第12.3节方案。本切片仍不包括扣子发布、API/UI接入、真实B2或G1判断。

### 13.2 实施结果

| 对象 | 结果 |
|---|---|
| manifest | 升级为`t001-b2-benchmark-manifest-v0.2`，保留18条×3次/54槽，B0引用改为`RUN-20260824-028` |
| 批次/结果合同 | 升级为`t001-b2-raw-batch-v0.2 / t001-b2-evaluated-run-v0.2` |
| 固定矩阵 | Prompt `3.1.2`、Service `ride-analysis-service-v1.5`、Workflow `ride_analysis_v2-dev.15`、`ride-feature-rules-v0.2`、Few-shot `disabled` |
| 输入集 | 18/18重新导出；五变量合同不变；逐文件SHA-256及聚合摘要`5333b4cd...2c7671`写入manifest |
| Git追溯 | 真实B2批次必须提供40位小写`sourceCommit`；当前尚未创建包含本实施的新commit |
| 确定性B0 | 新增`RUN-20260824-028`；Service v1.5/特征规则v0.2/同输入摘要，18/18 PASS，模型调用/Token/成本为0 |
| 历史证据 | `RUN-20260823-022`和其Service v1.4/特征规则v0.1元数据未改写 |

### 13.3 验证

| 检查 | 结果 | 边界 |
|---|---:|---|
| T001聚焦测试 | 7/7 PASS | 含18文件摘要、聚合摘要、RUN-028、54槽、一次修复与二次失败B0 |
| 全量回归 | 187/187 PASS | `pnpm verify` |
| 生产构建 | PASS | Next.js 16.3.1 |
| 真实B2 | `NOT_RUN` | 本轮无模型调用、真实Token/成本或语义评分 |

### 13.4 待验收边界

本切片证明Service v1.5的评测输入、确定性B0和批次接收合同已重新对齐，不证明B2模型质量、稳定性、延迟、成本或G1通过。请用户预览并确认本实施切片；验收后下一项才是建立包含已验收V014与T001重冻结实现的新本地Git commit。

## 14. 用户验收Service v1.5重冻结实施切片

2026-08-24用户明确回复“接受 ITEM-T001 Service v1.5重冻结实施切片。进入下一项”，本切片状态更新为`ACCEPTED`。验收范围包含v0.2 manifest/批次合同、18个五变量输入及SHA-256、`sourceCommit`接收门和`RUN-20260824-028`确定性B0；不包含扣子发布、API/UI接入、真实B2、人工评分或G1判断。

下一切片只建立包含已验收V014与T001实现的新本地Git冻结基线，不扩大到模型运行。

## 15. 新Git冻结基线

### 15.1 来源审查与范围

定向复审PRD 6.3/7.11、研发指南13.5/14、路线图v0.1/G1及`DEC-065`，未发现实质冲突。本切片只固化已验收的V014与T001资产；不发布扣子、不调用模型、不接入API/UI、不生成B1/B2/B3或G1结论。

### 15.2 冻结结果

| 对象 | 结果 |
|---|---|
| 源码冻结提交 | `78facde226a738ea0fefe660f38ddaada50a5393` |
| 提交摘要 | `feat: freeze V014 and T001 service v1.5 baseline` |
| 文件集 | 58个V014/T001代码、测试、输入、RUN、评审与台账文件 |
| 删除控制 | 提交中0个文件删除；工作区原有`findings.md / progress.md / task_plan.md`删除明确排除 |
| 未来B2 | raw batch可使用该40位提交号作为`sourceCommit`；实际运行时仍必须复核HEAD与冻结输入摘要 |

### 15.3 复核

- 提交前`git diff --cached --check`通过；
- 交付系统校验`0 error / 0 warning`；
- 提交后`git show --name-status`无删除项；
- 本切片没有重复运行模型或改写`RUN-20260824-023`至`028`。

该冻结基线待用户预览验收；验收后下一项只审查真实B2所需的扣子测试环境发布范围、精确模型配置和Token/成本记录来源，不直接运行54槽。

## 16. 用户验收新Git冻结基线切片

2026-08-24用户明确回复“接受 ITEM-T001 新Git冻结基线切片。先不进行下一项”，本切片状态更新为`ACCEPTED`。源码冻结提交`78facde226a738ea0fefe660f38ddaada50a5393`及其排除三个无关删除的边界正式纳入当前基线。

用户同时要求暂不进入下一项。因此真实B2运行配置审查仅作为待选下一项保留，未启动；扣子发布、API/UI接入、B1/B2/B3、人工双评和G1判断均无新变化。
