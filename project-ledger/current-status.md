# AI 骑行伙伴当前状态

> 最后更新：2026-08-25
> 当前阶段：v0.1 证据型Demo开发  
> 当前 Gate：G1「Demo核心价值」（G0已`GO`）  
> 总体状态：`READY_FOR_PREVIEW`（25秒4槽复测已完成，等待结果验收）
> 人工导航：[台账索引](index.md)

## 1. 当前目标

`ITEM-T001 测试环境发布与计量预检`已完成并获用户接受；分层计量合同适配、54槽范围预览和v0.0.2受限复测均已完成。A/B后保留原版 Prompt v3.1.2；输入投影4槽复测未恢复两个15秒超时案例；25秒同四槽复测已将B2从1/4提升至3/4，但P95为`34591.961ms`。精确模型ID、计算区域、首Token延迟和成本来源记录为`NOT_OBSERVABLE`，性能与成本保持`NOT_SCORED`；25秒不是G1的8秒P95目标。

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
- B1/B3、真实上传、真实GPX/多设备、5人测试和线上部署均未验证；B2真实批次已运行但质量/性能 Gate 保持未评分，不得对外开放或宣称G1通过。
- T001的18条自动骑后上下文fixture已补齐；Service v1.5/特征规则v0.2的18个五变量输入、SHA-256、54槽v0.3 manifest/接收合同与新B0 `RUN-20260824-028`已完成；真实B2为`RUN-20260824-367`，B1/B3仍未运行。`RUN-20260823-022`保留为Service v1.4/特征规则v0.1历史B0。
- 本机已存在`.env.local`并配置扣子PAT；v3.1.1历史冒烟/修复/B0见`RUN-20260823-018/019/020`；最终v3.1.2的L3、L1、L2分别归档为`RUN-20260824-023/024/025`。L1/L2截图只记录模型显示名、整数秒和总Token，精确模型ID、请求ID、毫秒延迟、Token拆分和成本仍未记录；本地合同回放不调用模型，不能补足这些字段。
- v0.0.2 受限复测已形成 `RUN-20260825-756`：21/21 槽合同回放通过，B2 `7`、B0 `14`、安全停止 `0`，P50/P95=`15002.545/20334.534ms`，总 Token `101712`，成本仍不可观测；这不是完整54槽基准。
- T001 Service v1.5重冻结实施、新Git冻结基线及真实B2运行配置审查均已用户验收。扣子测试版本`v0.0.1`已发布，唯一预检可取得输入/输出/总Token拆分和LogId；精确模型ID、区域、成本来源和首Token仍不可观测。`RA-AUTO-001#1`已在`v0.0.1`预览中运行：`2026-08-24 17:55:45`，LogId `20260824175533C12F3708B030050D0659`，页面显示约`12s / 8408 Tokens`，输入/输出为`7667/741`；原始输出仍未完整导出，尚不能作为正式 raw batch 槽位。
- 项目在2026-08-24由用户确认建立首个本地Git基线；基线建立前`main`分支无commit、项目文件均未跟踪。后续真实RUN必须绑定该基线或其后续commit，保持源码、配置与评测证据可追溯。
- 首个Git基线为`8c1677834c8ab2d8e03035104b9c720ccdd44243`，但它早于后续已验收V014修复；真实B2前必须再建一个包含实际冻结实现的commit，不得把较旧基线冒充为实际源码版本。

## 4. 当前决定状态

- `DEC-027`至`DEC-039`已确认无AI详情、骑后AI、原子能力、历史/数据边界和Few-shot工程化候选；`DEC-059`将当前联调基线改为无Few-shot并把现有样例降为草稿；`DEC-050`恢复已接受的模块×版本矩阵及v0.1个人资料/Fixture历史/Few-shot评测范围；`DEC-058`确认工作项采用最小充分来源审查和变更触发全文复查；`DEC-063`确认T001保留旧30条混合集合并分离自动骑后与对话评测；
- `DEC-040`至`DEC-049`已确认对话产品边界、首屏、快捷问题、历史不足、能力引导、安全、记忆、工具、输出降级和版本子Gate；`DEC-060`已确认自动骑后允许事实驱动的合理定性，并允许在limitations展示历史限制但不生成history维度；
- `DEC-051`已确认单次骑行详情三个用户可见Tab命名为`摘要 / 分析 / 数据`；具体内容归属与字段边界继续逐项确认；
- `DEC-052`已确认整体AI/历史结论归入摘要、分维度AI/趋势归入分析，数据Tab仅保留本次骑行详细事实；
- `DEC-053`已确认骑行轨迹只在摘要展示，当前保持相对SVG，真实地图底图维持`v1.x`候选；
- `DEC-054`已确认数据Tab采用参考图的13组长期结构，并按实际可靠字段动态隐藏空分组；
- `DEC-055`已确认ITEM-V007沿用现有Schema重组字段，并在摘要有可靠值时增加运动消耗；其余参考字段进入后续规划；
- `DEC-056`已确认V008 Demo使用localStorage、Alpha切换PostgreSQL；`DEC-057`已确认用户保存FTP的可信语义；
- `DEC-065`已确认T001 Service v1.5版本矩阵重冻结方案，实施切片也已用户验收；
- `DEC-066`已确认真实B2采用测试环境冻结发布、API批次运行和先计量预检后54槽的方案；发布和模型调用仍需分别授权；
- `DEC-067`已接受：Demo阶段继续使用扣子验证质量/结构/可靠性，对平台不可观测字段记录`NOT_OBSERVABLE`，性能/成本保持`NOT_SCORED`；不代表G1或生产放行；
- `DEC-069`已接受：Demo服务端同步等待上限改为`25000ms`；历史`15000ms`证据不改写；25秒不是G1的8秒P95目标；本轮4槽结果见`RUN-20260825-510`，不外推完整批次；
- 完整决定及权衡以[决策日志](decision-log.md#dec-027确认运动消耗替代得分)为准；当前没有未确认的6.2/6.3/6.5方向性决定；
- `DEC-023 PROPOSED`保留为旧链路实现假设；V013只冻结合同，不自动接受该编排方案，留待下一工作项启动后基于新合同重新评估。

## 5. 当前工作项

### ITEM-T001｜25秒同步等待受限可靠性复测

- 状态：`READY_FOR_PREVIEW`
- 目标：在保留原版 Prompt `v3.1.2`、模型和Workflow不变的前提下，验证25秒同步等待能否降低已知15秒超时样本的B0降级。
- 已完成：冻结提交、零调用预检、4槽真实复测和合同回放；4/4回放PASS，B2/B0=`3/1`，`006/011`各经一次修复成功，`018`保持0调用。
- 结论：相同四槽中B2由15秒的`1/4`提升到25秒的`3/4`，但修复后的P95为`34591.961ms`，仅作可靠性诊断，不作性能或G1结论。
- 冻结边界：Prompt、Schema、模型、扣子Workflow、Few-shot、Claim/能力/历史/安全规则均未改变；历史`15000ms`证据不改写；人工可读性未运行。
- 证据：[RUN-20260825-510](../eval/runs/RUN-20260825-510.json)、[原始批次](../eval/runs/RUN-20260825-510-raw.json)、[复测评审](../reviews/ITEM-T001-B2-25s-reliability-preview.md)、[LOG-20260825-158](progress-ledger.md#log-20260825-158t00125秒同步等待受限可靠性复测完成)。

## 6. 下一工作项

- `ITEM-T001 25秒复测结果验收与下一步决策`：用户预览`RUN-20260825-510`逐槽输出和25秒对15秒的可靠性变化，决定保持当前Demo边界或是否进入更大样本/异步性能专项；不自动扩大到21/54槽。

## 7. 当前版本矩阵

| app / schema / rules | parser / GPS quality | B0 / eval | AI runtime |
|---|---|---|---|
| visual-shell-v0.1 + `ride-detail-ui-v0.2`已验收；`RideActivity v0.2 / RideSeries v0.1 / UserProfile v0.1 / AtomicCapability v0.1 / RideFeatureSnapshot v0.1 / HistoricalComparisonSnapshot v0.1 / RideAnalysisContext v0.2 / AnalysisEligibility v0.1 / ride-analysis-output-v0.3`均已验收；当前特征规则`ride-feature-rules-v0.2` | FIT parser v0.2；GPX parser v0.3 / GPS质量v0.1；自动回归201/201通过 | 旧B0 `b0-template-v0.1` 14/14；A `RUN-20260825-756` 21/21 PASS，B `RUN-20260825-960` 21/21 PASS；投影复测`RUN-20260825-918` 4/4 PASS、B2=1/B0=3；benchmarkStatus=`NOT_SCORED` | A active：Prompt v3.1.2 + 扣子`v0.0.2`；模型传输投影v0.1；B archived：Compact Candidate；Service v1.5 + Workflow内部标签dev.15 + Few-shot disabled；四项计量字段不可观测；RAG/Function Calling关闭 |
