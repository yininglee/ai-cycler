# AI 骑行伙伴 V2 重构技术方案

> 依据：[V2 第一步 PRD](骑后解读重构第一步_PRD.md)、[骑行数据导入与详情页产品规则说明](骑行数据导入与详情页产品规则说明.md)、当前源码与测试。  
> 状态：`RIDE-REF-01` 已通过用户验收（2026-10-02）。  
> 日期：2026-10-01

## 1. 技术结论

本次重构不迁移框架、不引入服务拆分，而是在现有 Next.js App Router + TypeScript 模块化单体中，清除与当前页面事实模型冲突的旧领域摘要/等级路径。标准化 `RideRecord`、确定性领域规则、详情 ViewModel、AI 分析 API 各自保持边界。

详情事实主链：

```text
FIT / GPX
  -> format parser + adapter
  -> RideRecord { activity, series }
  -> validateRideRecord(activity + series)
  -> domain summaries (timing / elevation / route / power / zones)
  -> RidePageViewModel
  -> summary / analysis / data tabs
```

AI 是并列消费端：

```text
RideRecord -> AnalysisContext -> atomic facts / eligibility -> AI provider
                                                     -> validated output
                                                     -> source="b0" on AI fallback
```

`source: "b0"` 是解释请求结果状态，不参与骑行事实生产。AI fallback 不能回写、覆盖或隐藏详情页记录。

## 2. 已验证的仓库事实与待完成验证

- Web：Next.js 16 App Router、React 19、TypeScript；Node 要求 `>=22.6`，包管理器 pnpm。
- 解析器：FIT 使用 `fit-file-parser`，GPX 使用 `fast-xml-parser`；项目只把支持范围内字段适配到统一记录合同。
- 领域层：`src/domain/ride-schema.ts` 定义 `RideActivity`、`RideSeries` 与 `RideRecord`；计时、海拔、路线、爬坡、功率、区间、历史比较等由领域函数生成。
- 页面层：`src/ui/ride-view-model.ts` 组织确定性详情视图；`app/rides/[id]/page.tsx` 渲染摘要/分析/数据页和 AI 解读入口。
- API/存储：导入 API 进入 demo ride repository；骑行分析 API 调用 analysis context/eligibility/AI candidate chain，并持久化 run 与演示观测事件。
- 测试：`pnpm test` 使用 Node test runner；`pnpm typecheck` 使用 `tsc --noEmit`；`pnpm build` 为生产构建。
- 当前工作树有本轮重构改动，且 `next-env.d.ts` 有既存修改，必须保留；完整验证结果以 V2 进度账本实际输出为准。

## 3. 模块边界

| 模块 | 输入与输出 | 重构边界 |
|---|---|---|
| parser adapters | FIT/GPX 输入 -> `RideRecord` | 不把详情 UI/AI 资格逻辑塞入解析器；不改变本任务以外字段口径 |
| schema 与 validation | activity、series -> 合法/错误及问题列表 | 以整条记录的 error 判定拒绝态；warning 留作质量提示，不自动拒绝 |
| deterministic domain rules | 标准化记录、Profile -> 版本化 summaries | 保留各模块独立输入、阈值和 unavailable reason；不再套 DataLevel 总开关 |
| ride view model | 记录 + 派生规则 -> 页面事实/图表展示模型 | 字段存在且记录有效才组装；短记录不设统一 basic/full 门 |
| AI context/eligibility | 记录 -> 原子事实、能力状态、解读资格 | 不进入普通详情数据源；`dataLevel` validator 可继续拒绝旧输入字段 |
| interpretation route/UI | AI 响应 -> AI 内容或 B0 降级状态 | 保留 fallback、重试、反馈、事件；解读响应不得决定事实页存在性 |
| demo routes/components | 固定预览数据与 UI | 删除旧摘要卡、旧分享预览以及无其他消费者的专属组件 |

## 4. 标准数据合同与规则责任

### 4.1 `RideRecord`

- 顶层合同 `{ activity, series }`；`activity` 描述一项骑行的身份、来源、开始时间、稀疏聚合指标、传感器质量与 parser issues。
- `series` 描述有序时序采样、相对路线、可用序列、来源/单位/样本数/质量 metadata 和时间基准。
- 缺失数据不写为 0；指标保留 `provenance`、`confidence`、`sourceField`、`sourceUnit`、`evidenceId`、`qualityStatus`，派生值保留 `formulaVersion`。
- 该合同是运行时领域模型，不被宣称为 AI L0-L8 中某一层。字段映射、来源和用户可见语义以 V2 产品规则说明为准。

### 4.2 校验和质量

- `validateRideRecord` 聚合 Activity 与 Series 校验；error 使整条记录无效。详情 ViewModel 对无效记录生成拒绝态并不组装摘要事实或图表。
- warning 不等于拒绝。传感器质量通用门包含 coverage `>=0.80` 与 invalid ratio `<=0.02`；派生模块可定义不同时间覆盖、窗口和缺口规则。
- 不得因移除 DataLevel 而移除 `isRideSensorUsable`、series metadata 校验、AI 的 atomic capability/eligibility 或任何单项分析质量规则。
- 页面中的普通设备汇总行、图表、区间分布、功率派生项可能采用不同门槛；规则差异如实记录，不因本次清理统一阈值。

## 5. 实施约束

1. 删除旧 `DataLevel/dataLevel` 领域类型/计算器、旧 `analysisMode` basic/full 门、旧按档位生成的 B0 摘要及其仅由该路径消费的合同/测试/基准。
2. 不做全仓关键词机械替换。样例 fixture ID、历史评测 tier、AI L0-L8 设计层名和聊天 L0/L1/L2b 命名各有用途；逐项确认运行时归属后再清理。
3. 详情拒绝态从整条 RideRecord validation 派生，确保 Series invalid 也不落入“空页面但不解释”的状态。
4. Home 移除旧摘要入口；分享 preview route 与专用 UI/事件组件删除。分享能力仍留在 backlog。
5. 确认 API `source: "b0"`、fallback codes、分析重试、用户反馈、`b0_visible` 的结构/持久化/回归测试保持不变。
6. 保留 `ride-analysis-context` 对旧 `dataLevel` 字段的拒绝式校验，以防旧上下文回流；这不是生产业务分级。

## 6. 代码落点

| 路径 | 所属职责 |
|---|---|
| `src/domain/ride-schema.ts` | 标准记录结构 |
| `src/domain/ride-rules.ts`、`src/domain/ride-series.ts` | 活动/序列/记录校验 |
| `src/domain/ride-timing.ts`、`ride-elevation.ts`、`ride-route-shape.ts`、`ride-event-climbs.ts` | 确定性时序/地形派生 |
| `src/domain/ride-power.ts`、`ride-zones.ts`、`historical-comparison.ts` | 传感器派生分析 |
| `src/ui/ride-view-model.ts`、`ride-series-view-model.ts` | 页面值与图表 view model |
| `app/rides/[id]/page.tsx` | 详情页组件组合与拒绝 UI |
| `app/api/ride-analysis/route.ts`、`src/ai/*` | AI 分析和降级链；本任务保持合同 |
| `src/observability/demo-events.ts`、`app/components/interpretation-view.tsx` | AI 状态事件、重试与反馈 |
| `app/page.tsx`、`app/share/[id]/page.tsx`、share-only components | 旧演示 UI 退役范围 |

## 7. 测试与验收策略

- **领域回归**：FIT/GPX parser、activity/series 校验、metrics 与 SensorQuality、短记录、损坏记录。
- **页面模型**：有效记录事实集、短骑行不过旧 full 门、无时间 GPX 不造速度/时间、任一 record validation error 时 facts/charts 清空并拒绝。
- **接口回归**：Ride Analysis 仍返回已有响应 schema；AI 未配置/不合格输出 fallback 仍为 `source: "b0"` 和既有原因码。
- **事件回归**：`b0_visible`、AI 请求/降级、反馈事件字段和隐私白名单保持。
- **静态检查**：生产源码无旧 DataLevel 运行时入口；剩余命中逐项归类为 validator/test fixture/historical eval/AI layer/chat subsystem。
- **工程门禁**：`pnpm verify`、`pnpm build`。
- **手工预览**：`/`、`/import`、`/rides/l3-built-in-sample`、`/rides/gpx-no-timestamps`、`/rides/fit-truncated-file`、`/rides/l1-built-in-sample?ai=b0`。

## 8. 安全、隐私与可靠性

- FIT/GPX 原始位置只在解析和派生路线时消费；标准序列只保存相对归一化路线，不保留精确坐标。
- 本次不放宽导入大小、XML 安全、GPS 跳点、session 所属校验或 AI Context 隐私规则。
- AI 不可用、超时或输出被拒绝时显示降级态并允许重试；错误不能清除或污染标准化骑行记录。
- 删除页面只移除演示入口，不影响骑行记录 repository、删除动作或 AI 运行持久化。

## 9. 风险与回退

| 风险 | 影响 | 控制与发现方式 |
|---|---|---|
| 同名 B0 误删 | AI 降级/观测被破坏 | 将确定性旧摘要 B0 与 `source: "b0"` 明确分开；API、UI、事件回归 |
| 过度移除 L1/L2/L3 字符串 | 破坏 fixture 或历史评测语义 | 依赖搜索只用于发现；按调用关系判定；保持测试和评测命名兼容 |
| 只校验 activity | 损坏 series 造成不一致详情 | 用 `validateRideRecord` 聚合 error，并对拒绝态写回归测试 |
| 原型退役被误读为分享上线 | 产品能力和 PRD 状态失真 | 分享保持 Backlog，开发规划单独记录进入条件 |
| 历史规则说明未跟代码同步 | 产品验收依赖错误数据 | V2 规则文档作为本次字段/页面行为索引，标记实现差异与待确认问题 |

若出现阻断回归，以 Git diff 中对应源码/测试为回退边界；不重置或清除用户其他工作树改动。

## 10. 架构决策

| ID | 决策 | 复审条件 |
|---|---|---|
| ADR-V2-01 | 详情数据主合同为 `RideRecord { activity, series }`，由确定性 view model 投影；不另造 B0 页面模型 | 当持久化 schema 或多终端 API 需要版本化展示合同 |
| ADR-V2-02 | 记录有效性按完整 activity+series 校验；分析可用性由字段/模块质量规则决定，不设统一数据等级 | 新业务确需整体资格态且能证明其不同于字段质量/AI eligibility |
| ADR-V2-03 | AI `source: "b0"` 是解读降级，不是骑行数据层级；独立于详情事实页 | 只有经单独产品决策替换 AI fallback contract 时 |
| ADR-V2-04 | 以模块化单体承载当前产品，不因旧原型清理引入基础设施 | 出现独立扩展/隔离需求并有测量证据时 |
