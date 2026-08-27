# AI 骑行伙伴当前状态

> 最后更新：2026-08-27
> 当前阶段：v0.1 证据型Demo开发  
> 当前 Gate：G1「Demo核心价值」（G0已`GO`）  
> 总体状态：`READY`（ITEM-V018 已验收；ITEM-V017 用户测试待执行）
> 人工导航：[台账索引](index.md)

## 1. 当前目标

执行 `ITEM-V017｜Demo 用户测试与 G1 证据准备`：用 5 名业余骑行者验证“导入/选择记录 → 看懂 B0 与 AI 解读 → 找到依据 → 反馈”的核心路径。当前只准备启动 `P01`，不在用户测试中修改 Prompt、Workflow、Schema、模型或超时，也不把单场或 5 人结果直接写成 G1 通过。

## 2. 当前基线与证据

- G0放行证据：[ITEM-G0-002复审](../reviews/ITEM-G0-002-g0-reaudit-review.md)、[T0.4 / RUN-20260818-001](../eval/benchmark-report.md#11-t04g0新矩阵重新审计2026-08-18)、[DEC-022](decision-log.md#dec-022确认g0允许开发环境模型接入)；
- GPS质量门已验收：[ITEM-G0-FIX-001](../reviews/ITEM-G0-FIX-001-gps-quality-review.md)、[DEC-020](decision-log.md#dec-020确认gpx-gps跳点确定性质量规则)；
- 研发与发布基线：[Demo与Agent研发指南](../AI骑行伙伴-Demo搭建与Agent研发指南.md)、[版本路线图与放行机制](../AI骑行伙伴-版本路线图与上线放行机制.md)。
- 骑后体验文档基线已验收：[ITEM-DOC-002](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#12-用户验收)。
- 产品与事实合同：无AI详情事实合同 [ITEM-V006](../reviews/ITEM-V006-ride-data-contract-v02-review.md#6-用户验收)、三 Tab 详情基线 [ITEM-V007](../reviews/ITEM-V007-ride-detail-visuals-review.md#17-用户验收)、个人资料合同 [ITEM-V008](../reviews/ITEM-V008-profile-review.md#7-用户预览验收)、特征快照 [ITEM-V010](../reviews/ITEM-V010-ride-feature-snapshot-review.md) 均已验收。
- 页面与导入：V016 已冻结 B0 首屏、点击触发 AI、失败保留 B0 和数据 Tab 隔离；V018 已验收本机 50 MB 以内 FIT/GPX 临时导入、可靠字段展示、移动时间均速口径和 GPS 占位点过滤。
- AI 运行基线：原版 Prompt `v3.1.2`、扣子 `v0.0.2`、模型传输投影 `v0.1`、Few-shot disabled、同步等待上限 `25000ms`；25 秒 4 槽复测为 B2/B0=`3/1`，P95=`34591.961ms`。平台精确模型 ID、区域、首 Token 延迟和成本来源仍为 `NOT_OBSERVABLE`，性能与成本为 `NOT_SCORED`。
- 详细历史运行、修复和 Git 冻结证据保留在 [进度台账](progress-ledger.md)、[评测报告](../eval/benchmark-report.md)及对应 ITEM 评审中，不在本快照重复展开。

## 3. 当前未完成、阻塞与技术债

### G1 未完成项

- `ITEM-V017` 尚未运行：5 名参与者证据为 `0/5`；至少 3 名使用自有非敏感 FIT/GPX、其中 FIT 不少于 2 名的目标尚未满足。
- 真实 FIT/GPX 尚未形成正式的多设备兼容矩阵和成功率；V018 只证明当前本机样本与已修复边界，不能外推设备兼容性。
- B1/B3 尚未运行；B2 虽已有完整 54 槽和受限复测证据，但质量、性能和成本 Gate 仍为 `NOT_SCORED`。当前 25 秒同步方案不满足 G1 端到端 P95 `8s` 目标。
- 因此 G1、生产发布和对外开放均未放行。

### 当前阻塞

- 没有已知工程问题阻止 `P01` 按当前 Demo 边界启动。
- G1 评审仍受上述用户证据、兼容矩阵和评测 Gate 缺口阻塞；平台不可观测计量字段不得用估算值补齐。

### 延期技术债与阶段边界

- 旧 `RideContextSnapshot v1.0` / 旧 B2 兼容链路仍含 `dataLevel`；新业务链路已使用不含等级业务门的 `RideAnalysisContext v0.2`。旧链路清理不阻塞 V017，但后续不得重新把 L1/L2/L3 用作用户等级或业务硬门。
- Demo 导入记录仅保存在当前 Node 进程内存，尚无持久化、多用户归属和生产删除/保留机制；这些是 Alpha/生产阶段边界，不是当前 V017 的工程阻塞。

## 4. 当前决定状态

- 用户体验：详情页保持 `摘要 / 分析 / 数据`；轨迹只在摘要，整体 AI 结论归摘要、分维度分析归分析页，数据页只展示可靠事实；空字段和不具备的能力动态隐藏（`DEC-051`–`DEC-055`）。
- 事实与解读：允许模型基于可引用事实作常识性合理定性；历史不足可写入 limitations，但首次或不可比记录不生成历史维度；Claim、能力、安全和隐私边界继续有效（`DEC-027`–`DEC-039`、`DEC-060`）。
- 用户资料：Demo 使用 localStorage；手动保存 FTP 为 `user_provided + user_confirmed`，不称为实测、不自动估算训练负荷；Alpha 再迁移 PostgreSQL（`DEC-056`、`DEC-057`）。
- AI 运行：保留 Prompt `v3.1.2`、扣子 `v0.0.2`、输入投影 `v0.1`、Few-shot disabled 和 `25000ms` 同步等待；不扩大复测、不启动异步性能专项，不把不可观测字段估算成 Gate 证据（`DEC-067`、`DEC-069`、`DEC-070`）。
- 项目治理：每个 ITEM 使用最小充分来源审查，只有阶段、架构、安全、数据边界、方向、巡检或 Gate/发布变化时全文复查三份主文档（`DEC-058`）。
- 当前没有阻止 V017 启动的方向性待决；完整历史决定、权衡和重新评估条件以[决策日志](decision-log.md)为准。

## 5. 当前工作项

### ITEM-V017｜Demo 用户测试与 G1 证据准备

- 状态：`READY_FOR_RUN`
- 目标：用 5 名业余骑行者验证“导入/选择记录 → 看懂 B0 与 AI 解读 → 找到依据 → 反馈”的任务路径。
- 已具备：V018 已验收本机 FIT/GPX 临时导入；测试要求至少 3 名参与者使用自己的非敏感 FIT/GPX，且 FIT 不少于 2 名，其余可使用内置样例。
- 边界：尚未招募或运行，不把计划材料视为用户证据；小样本不能单独证明 G1、生产稳定性或多设备兼容率。
- 证据：[ITEM-V017 用户测试准备](../reviews/ITEM-V017-demo-user-test-preparation.md)、[ITEM-V018 验收](../reviews/ITEM-V018-fit-gpx-import-ai-preview.md#8-用户验收2026-08-27)。

## 6. 下一工作项

- 安排并执行 `P01` 第一场受控用户测试；开始前确认参与者同意本机临时数据处理边界，并记录使用自有 FIT/GPX 还是内置样例。未开始前不改 Prompt、Workflow、Schema、模型或超时。

## 7. 当前版本矩阵

| app / schema / rules | parser / GPS quality | B0 / eval | AI runtime |
|---|---|---|---|
| visual-shell-v0.1 + `ride-detail-ui-v0.2`已验收；`RideActivity v0.2 / RideSeries v0.1 / UserProfile v0.1 / AtomicCapability v0.1 / RideFeatureSnapshot v0.1 / HistoricalComparisonSnapshot v0.1 / RideAnalysisContext v0.2 / AnalysisEligibility v0.1 / ride-analysis-output-v0.3`均已验收；当前特征规则`ride-feature-rules-v0.2` | FIT parser v0.2；GPX parser v0.3 / GPS质量v0.1；本机临时 FIT/GPX 上传 50 MB；自动回归209/209通过；全零心率占位安全忽略；展示均速按距离/移动时间计算；`(0,0)` GPS占位点过滤 | 旧B0 `b0-template-v0.1` 14/14；A `RUN-20260825-756` 21/21 PASS，B `RUN-20260825-960` 21/21 PASS；投影复测`RUN-20260825-918` 4/4 PASS、B2=1/B0=3；benchmarkStatus=`NOT_SCORED` | A active：Prompt v3.1.2 + 扣子`v0.0.2`；模型传输投影v0.1；B archived：Compact Candidate；Service v1.5 + Workflow内部标签dev.15 + Few-shot disabled；四项计量字段不可观测；RAG/Function Calling关闭 |
