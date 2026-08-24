# AI 骑行伙伴当前状态

> 最后更新：2026-08-24  
> 当前阶段：v0.1 证据型Demo开发  
> 当前 Gate：G1「Demo核心价值」（G0已`GO`）  
> 总体状态：`READY_FOR_PREVIEW`
> 人工导航：[台账索引](index.md)

## 1. 当前目标

ITEM-V009至ITEM-V014均已完成用户确认。用户已接受`DEC-065`及`ITEM-T001` Service v1.5重冻结实施切片；已建立包含V014与T001实现的新本地Git冻结基线`78facde226a738ea0fefe660f38ddaada50a5393`，待用户预览。本轮未发布扣子、未接入API/UI、未运行54槽真实B2。

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
- T001的18条自动骑后上下文fixture已补齐；Service v1.5/特征规则v0.2的18个五变量输入、SHA-256、54槽v0.2 manifest/接收合同与新B0 `RUN-20260824-028`已完成，完整模型基准尚未运行。`RUN-20260823-022`保留为Service v1.4/特征规则v0.1历史B0。
- 本机无`.env.local`。v3.1.1历史冒烟/修复/B0见`RUN-20260823-018/019/020`；最终v3.1.2的L3、L1、L2分别归档为`RUN-20260824-023/024/025`。L1/L2截图只记录模型显示名、整数秒和总Token，精确模型ID、请求ID、毫秒延迟、Token拆分和成本仍未记录；本地合同回放不调用模型，不能补足这些字段。
- T001 Service v1.5重冻结实施已完成用户验收；新源码冻结提交为`78facde226a738ea0fefe660f38ddaada50a5393`，当前只等待本Git切片预览验收。真实B2继续暂停，B1/B2/B3仍为`NOT_RUN`。
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
- 完整决定及权衡以[决策日志](decision-log.md#dec-027确认运动消耗替代得分)为准；当前没有未确认的6.2/6.3/6.5方向性决定；
- `DEC-023 PROPOSED`保留为旧链路实现假设；V013只冻结合同，不自动接受该编排方案，留待下一工作项启动后基于新合同重新评估。

## 5. 当前工作项

### ITEM-T001｜新Git冻结基线切片

- 状态：`READY_FOR_PREVIEW`
- 目标：提交已验收V014与T001 Service v1.5重冻结实现，使未来B2可绑定不可变的40位`sourceCommit`。
- 前置：[ITEM-T001第14节](../reviews/ITEM-T001-eval-migration-review.md#14-用户验收service-v15重冻结实施切片)已记录用户验收；旧基线`8c1677834c8ab2d8e03035104b9c720ccdd44243`仅保留为历史。
- 已完成：源码冻结提交`78facde226a738ea0fefe660f38ddaada50a5393`包含58个V014/T001文件且无文件删除；无关的`findings.md / progress.md / task_plan.md`删除仍未纳入。
- 当前动作：请用户预览[ITEM-T001第15节](../reviews/ITEM-T001-eval-migration-review.md#15-新git冻结基线)并确认该Git切片。
- 排除：不发布扣子工作流、不接入API/UI、不调用模型、不创建B2结果、不进行质量评分或G1判断。
- 证据：[V014整体用户验收](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#32-用户验收item-v014整体)、[T001现有评审](../reviews/ITEM-T001-eval-migration-review.md#11-b2真实运行准备项)、[LOG-20260824-119](progress-ledger.md#log-20260824-119用户接受item-v014整体)。

## 6. 下一工作项

- `ITEM-T001 真实B2运行配置审查切片`（前置：用户验收新Git冻结基线）：确认扣子测试环境发布范围、精确模型ID/区域/参数与Token/成本记录来源；审查本身不运行54槽B2。

## 7. 当前版本矩阵

| app / schema / rules | parser / GPS quality | B0 / eval | AI runtime |
|---|---|---|---|
| visual-shell-v0.1 + `ride-detail-ui-v0.2`已验收；`RideActivity v0.2 / RideSeries v0.1 / UserProfile v0.1 / AtomicCapability v0.1 / RideFeatureSnapshot v0.1 / HistoricalComparisonSnapshot v0.1 / RideAnalysisContext v0.2 / AnalysisEligibility v0.1 / ride-analysis-output-v0.3`均已验收；当前特征规则`ride-feature-rules-v0.2` | FIT parser v0.2；GPX parser v0.3 / GPS质量v0.1；自动回归187/187、生产构建已通过 | 旧B0 `b0-template-v0.1` 14/14；历史T001 B0 `RUN-20260823-022` 18/18（Service v1.4/特征规则v0.1）；当前T001 B0 `RUN-20260824-028` 18/18，P50/P95=0.192/1.66ms（Service v1.5/特征规则v0.2）；B1/B2/B3 `NOT_RUN` | V014已接受Prompt v3.1.2 + Service v1.5 + Workflow dev.15 + Few-shot disabled；T001 v0.2 manifest固定18条输入摘要/54槽/新B0并要求`sourceCommit`，实施已验收；源码冻结基线`78facde226a738ea0fefe660f38ddaada50a5393`；RAG/Function Calling关闭 |
