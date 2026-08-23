# AI 骑行伙伴当前状态

> 最后更新：2026-08-24  
> 当前阶段：v0.1 证据型Demo开发  
> 当前 Gate：G1「Demo核心价值」（G0已`GO`）  
> 总体状态：`IN_PROGRESS`  
> 人工导航：[台账索引](index.md)

## 1. 当前目标

ITEM-V009至ITEM-V014的约定范围已完成用户确认；V014的真实模型冒烟、一次受限修复和二次失败转B0均已留存，但这些不是完整T1基准或G1证据。当前进入`ITEM-T001`：迁移新合同自动骑后评测集并完成B0/B1/B2/B3基准准备。

## 2. 当前基线与证据

- G0放行证据：[ITEM-G0-002复审](../reviews/ITEM-G0-002-g0-reaudit-review.md)、[T0.4 / RUN-20260818-001](../eval/benchmark-report.md#11-t04g0新矩阵重新审计2026-08-18)、[DEC-022](decision-log.md#dec-022确认g0允许开发环境模型接入)；
- GPS质量门已验收：[ITEM-G0-FIX-001](../reviews/ITEM-G0-FIX-001-gps-quality-review.md)、[DEC-020](decision-log.md#dec-020确认gpx-gps跳点确定性质量规则)；
- 研发与发布基线：[Demo与Agent研发指南](../AI骑行伙伴-Demo搭建与Agent研发指南.md)、[版本路线图与放行机制](../AI骑行伙伴-版本路线图与上线放行机制.md)。
- 骑后体验文档基线已验收：[ITEM-DOC-002](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#12-用户验收)。
- 无AI详情事实合同已验收：[ITEM-V006](../reviews/ITEM-V006-ride-data-contract-v02-review.md#6-用户验收)。
- 无AI详情三Tab已验收：[ITEM-V007](../reviews/ITEM-V007-ride-detail-visuals-review.md#17-用户验收)，最终基线`ride-detail-ui-v0.2`。
- ITEM-V008依据审计：[评审记录](../reviews/ITEM-V008-profile-review.md#2-依据审计与冲突)。
- ITEM-V010用户验收：[评审记录](../reviews/ITEM-V010-ride-feature-snapshot-review.md)、T0.21。

## 3. 当前未完成与阻塞

- Prompt v1.2单条L1已完成一次受限修复并通过硬合同，但用户明确判定其骑后洞察价值不足；该结果只保留为失败学习证据，不继续作为产品方向。
- `ride-detail-ui-v0.2`已完成用户验收；历史事实合同和新AI合同已经实现并验收，但尚未接入模型运行链路与UI，因此用户界面继续静默隐藏相应内容。
- ITEM-V008已验收，边界保持冻结：Demo使用localStorage适配`UserProfile v0.1`，Alpha再切换PostgreSQL；用户保存的FTP为`user_provided + user_confirmed`，不称为实测、不自动估算、不在本项启用IF/TSS/功率区间/训练负荷。
- 旧`RideContextSnapshot v1.0`及旧B2链路仍作为历史兼容代码存在并含`dataLevel`；新链路已迁移到不含等级字段的`RideAnalysisContext v0.2`与V013合同，后续不得重新使用旧等级作为业务门。
- B1/B2/B3、真实上传、真实GPX/多设备、5人测试和线上部署均未验证，不得对外开放或宣称G1通过。
- T001的18条自动骑后上下文fixture已补齐并通过合同测试；`RUN-20260823-022`已完成18条新合同B0基线，18个五变量扣子输入也已导出；B2的54槽冻结清单、真实原始结果接收协议和服务端回放校验器已完成，完整模型基准尚未运行。
- 本机无`.env.local`，用户已在扣子`ride_analysis_v2`完成V014三能力冒烟；服务端真实模型调用、精确模型ID和成本仍`NOT_RUN`，B0降级路径已由`RUN-20260823-020`验证，T001新合同B0基线见`RUN-20260823-022`。
- 项目在2026-08-24由用户确认建立首个本地Git基线；基线建立前`main`分支无commit、项目文件均未跟踪。后续真实RUN必须绑定该基线或其后续commit，保持源码、配置与评测证据可追溯。

## 4. 当前决定状态

- `DEC-027`至`DEC-039`已确认无AI详情、骑后AI、原子能力、历史/数据边界和Few-shot工程化候选；`DEC-059`将当前联调基线改为无Few-shot并把现有样例降为草稿；`DEC-050`恢复已接受的模块×版本矩阵及v0.1个人资料/Fixture历史/Few-shot评测范围；`DEC-058`确认工作项采用最小充分来源审查和变更触发全文复查；`DEC-063`确认T001保留旧30条混合集合并分离自动骑后与对话评测；
- `DEC-040`至`DEC-049`已确认对话产品边界、首屏、快捷问题、历史不足、能力引导、安全、记忆、工具、输出降级和版本子Gate；`DEC-060`已确认自动骑后允许事实驱动的合理定性，并允许在limitations展示历史限制但不生成history维度；
- `DEC-051`已确认单次骑行详情三个用户可见Tab命名为`摘要 / 分析 / 数据`；具体内容归属与字段边界继续逐项确认；
- `DEC-052`已确认整体AI/历史结论归入摘要、分维度AI/趋势归入分析，数据Tab仅保留本次骑行详细事实；
- `DEC-053`已确认骑行轨迹只在摘要展示，当前保持相对SVG，真实地图底图维持`v1.x`候选；
- `DEC-054`已确认数据Tab采用参考图的13组长期结构，并按实际可靠字段动态隐藏空分组；
- `DEC-055`已确认ITEM-V007沿用现有Schema重组字段，并在摘要有可靠值时增加运动消耗；其余参考字段进入后续规划；
- `DEC-056`已确认V008 Demo使用localStorage、Alpha切换PostgreSQL；`DEC-057`已确认用户保存FTP的可信语义；
- 完整决定及权衡以[决策日志](decision-log.md#dec-027确认运动消耗替代得分)为准；当前没有未确认的6.2/6.3/6.5方向性决定；
- `DEC-023 PROPOSED`保留为旧链路实现假设；V013只冻结合同，不自动接受该编排方案，留待下一工作项启动后基于新合同重新评估。

## 5. 当前工作项

### ITEM-T001｜新合同B1/B2/B3基准测试与评测迁移

- 状态：`IN_PROGRESS`
- 目标：在冻结的18条自动骑后固定集上建立可重复、可追溯的B0/B1/B2/B3比较证据，为G1判断模型是否相对B0产生真实用户价值增量。
- 已完成：18条新合同上下文、12条独立对话集、18条B0基线`RUN-20260823-022`、18个扣子五变量输入，以及B2的18条×3次运行清单、原始结果接收协议和服务端回放校验器；Prompt固定`3.1.2`，Few-shot固定`disabled`。
- 当前动作：提交B2运行准备项给用户预览和验收；验收后取得冻结的真实模型配置与计量来源，执行54槽B2真实运行。
- 排除：准备项没有调用模型、没有生成质量分、没有运行B1/B3、没有进行5人测试或G1放行。
- 证据：[ITEM-T001评审](../reviews/ITEM-T001-eval-migration-review.md)、[B2运行接收协议](../eval/t001-b2-run-protocol.md)、[RUN-20260823-022](../eval/runs/RUN-20260823-022.json)、[T1 B0基线与B2准备](../eval/benchmark-report.md)。

## 6. 下一工作项

- `ITEM-T001 B2真实固定集运行`：用户验收运行准备项并取得冻结的精确模型ID、区域、模型参数和Token/成本记录来源后，按18条×3次执行B2并保留首次输出、一次受限修复及B0降级；B2完成前不运行B1/B3、不推进G1。

## 7. 当前版本矩阵

| app / schema / rules | parser / GPS quality | B0 / eval | AI runtime |
|---|---|---|---|
| visual-shell-v0.1 + `ride-detail-ui-v0.2`已验收；`RideActivity v0.2 / RideSeries v0.1 / UserProfile v0.1 / AtomicCapability v0.1 / RideFeatureSnapshot v0.1 / HistoricalComparisonSnapshot v0.1 / RideAnalysisContext v0.2 / AnalysisEligibility v0.1 / ride-analysis-output-v0.3`均已验收 | FIT parser v0.2；GPX parser v0.3 / GPS质量v0.1；自动回归173/173、生产构建和交付系统校验已通过 | 旧B0 `b0-template-v0.1` 14/14；T001新合同B0 `RUN-20260823-022` 18/18，P50/P95=0.188/1.684ms；B1/B2/B3 `NOT_RUN` | Prompt v3.1.2 + `ride-analysis-service-v1.4` + `ride_analysis_v2-dev.15` + `fewShotMode=disabled`已作为V014联调基线；T001 B2 54槽清单与导入校验已完成，待用户验收和冻结真实模型配置后执行；RAG/Function Calling关闭 |
