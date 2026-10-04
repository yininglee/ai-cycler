# AI 骑行伙伴 V2 重构技术方案

> 设计基线：[AI 解读证据体系与上下文重构 PRD](AI解读证据体系与上下文重构_PRD.md)、[AI 解读分析上下文业务规则说明](AI解读分析上下文业务规则说明.md)、[骑行数据导入与详情页产品规则说明](骑行数据导入与详情页产品规则说明.md)、V1 事实性 NO-GO 根因分析。
> 当前状态：四文档设计任务 `RIDE-AI-CONTEXT-01` 已获用户验收；`RIDE-AI-S0-01` 和 `RIDE-AI-S0-02` 已完成独立切片验收，V2 尚未切换生产链。
> 已完成前置项：`RIDE-REF-01` 已于 2026-10-02 验收；本方案不回退其详情页与旧分级清理结果。
> 方案日期：2026-10-03

## 1. 技术结论

V2 仍采用现有 Next.js App Router + TypeScript 模块化单体，不引入服务拆分。重构目标是让详情页事实、确定性分析和 AI 证据使用同一条可追溯数据链，同时保留各自的展示职责。

目标主链：

```text
FIT / GPX
  -> parser adapter
  -> RideRecord { activity, series }
  -> record validation + source inventory
  -> deterministic summaries (detail page rules)
  -> time/distance aligned features + events + relations
  -> atomic capabilities + atomic Claims + limitations
  -> one complete EvidencePacket per eligible analysis question
  -> L7 complete-input assembly and validation
  -> server-side model API with versioned Prompt
  -> independent output validation; conditional local cleanup / one model repair
  -> AI interpretation or existing B0/safety fallback
```

Profile、合格历史和运动科学知识不写入 `RideRecord`，而作为带版本的并列输入。第 7 节的 `TimingSummary`、`PowerSummary` 等运行时结果也不回写 `RideRecord`，而是转换为可追溯的 Claims、能力状态和限制。

本方案不把“完整证据”实现为原始点或所有 FIT 字段的无差别 Prompt dump。完整性指所有与分析问题相关、通过质量门的证据都能进入相应 EvidencePacket，并且任何排除都有明确原因。

## 2. 范围、非目标与假设

### 2.1 本次范围

- 以配速执行、爬坡表现、心率负荷、功率输出、骑行强度或训练负荷、踏频策略、跨传感器配合和相对历史为默认分析目录。
- 让详情页已使用且与表现分析相关的字段，能够追踪到 Claim、Feature、Capability、EvidencePacket、质量门、限制或明确排除原因。
- 重构时序特征、原子能力、原子 Claim、EvidencePacket、Profile/历史注入和知识证据；经同集评测后服务端直连模型 API，版本化 Prompt、独立校验输出并按准入条件至多一次模型修复。
- 保留当前 AI 不可用时的 `source: "b0"`、重试、反馈和观测合同。

### 2.2 非目标

- 本任务不重新设计 FIT/GPX 解析器支持范围，不承诺读取格式理论上的所有未映射字段。
- 不把第 7 节所有内部平滑点、校准中间状态或精确轨迹发送给模型。
- 不在本轮实现训练计划生成、医疗诊断、恢复完成判定、过度训练判定或能力因果证明。
- 不恢复 `dataLevel`、统一 basic/full 门或旧确定性 B0 页面模型。
- 四文档设计已验收不等于代码实现或线上解读已通过；实施切片逐项提交预览和验收。

### 2.3 关键假设

- `RideRecord` 的运行时合同继续为 `{ activity, series }`。
- 详情页第 7 节规则是确定性事实来源，具体字段和质量口径以 V2 产品规则说明为准。
- 有合格历史时系统默认自动使用；无合格历史时省略历史分析，不给用户增加“是否使用历史”的开关。
- 用户确认的 FTP 才能支撑 IF、TSS 和功率区间；Profile 估算值必须保留估算语义。

## 3. 当前仓库事实

- 解析器和适配器位于导入域，统一输出 `src/domain/ride-schema.ts` 定义的 `RideRecord`。
- 计时、海拔、路线形状、爬坡、区间、功率和历史比较分别由 `src/domain/ride-*.ts` 规则模块生成。
- 详情 ViewModel 位于 `src/ui/ride-view-model.ts`，页面入口为 `app/rides/[id]/page.tsx`。
- AI 上下文入口为 `src/domain/ride-analysis-context.ts`；能力画像为 `src/domain/atomic-capabilities.ts`；高级 Claim 为 `src/domain/ride-advanced-claims.ts`。
- 当前候选 AI 输入、解读计划和输出校验分别位于 `src/ai/ride-interpretation-input-v04-candidate.ts`、`src/ai/ride-interpretation-plan.ts` 和对应 output/service 文件。
- 骑后 API 为 `app/api/ride-analysis/route.ts`，当前实际调用 `buildRideAnalysisContext(record)`，没有显式传入 Profile 和历史快照。
- 当前 `ride-interpretation-plan` 使用 `.find()` 选择首个匹配事实或特征；输入投影还会把未被候选引用的 Claim 视为错误。这是 V1 NO-GO 中证据丢失的主要迁移对象。
- 当前代码已有 Node test runner、`pnpm typecheck`、`pnpm build` 和 `pnpm verify` 入口。S0-01 新增隔离 V2 证据合同和测试，不把合同样例通过等同于生产链或 V2 目标通过。

## 4. 架构边界

| 模块 | 输入 | 输出 | V2 责任 |
|---|---|---|---|
| parser adapters | FIT/GPX 文件 | `RideRecord` | 只负责格式解析、字段来源和标准化，不负责 AI 资格 |
| record validation | `activity + series` | error/warning 与字段质量 | 判断记录是否可消费；不设统一数据等级 |
| deterministic domain rules | `RideRecord`、必要 Profile | 第 7 节版本化 Summary | 生成详情页确定性事实，保留质量、来源和不可用原因 |
| feature extraction | `series`、Summary、时间/距离轴 | 阶段、窗口、事件、对齐和关系特征 | 以时间或距离加权，区分移动/停歇，记录覆盖和缺口 |
| capability catalog | source inventory、features、Profile、history | 完整原子能力状态 | 回答“这个分析问题能否严谨回答”，并声明依赖 |
| Claim builder | 所有合格来源 | 原子 metric/feature/advanced/history/relation/quality/limitation Claim | 负责来源、公式、证据和质量语义，不做展示排序 |
| EvidencePacket builder | 分析问题目录、Claims、能力 | 每个问题一个完整证据包 | 不按首项选择，不因高光展示限制而丢弃合格证据 |
| model input builder / validator (L7) | 当前完整问题包、知识证据、限制、授权与隐私规则 | 版本化模型输入或可追溯失败原因 | 校验完整性、引用、来源版本、问题归属、授权与隐私；不得反向删除包内合格 Claim，失败时不调用模型 |
| model API adapter | 经校验的输入、版本化 Prompt、服务端配置和预算 | 结构化响应或可追踪 Provider 错误 | 同集比较后冻结渠道；密钥、超时、成本和数据处理边界仅在服务端；Coze 不作为 V2 依赖 |
| output validator | 模型输出、已交付证据包与限制 | 合格输出或 `safety_stop`/fallback | 在模型生成后独立核对每种表达的证据支撑，阻止无证据数字、稳定性、恢复、因果和计划断言 |
| conditional repair | 校验错误码、原输入与预算 | 本地整理/一次模型修复或降级 | 仅可定位非高风险输出错误进入模型修复；修复后同一全量校验，不改证据 |
| detail view model | RideRecord、Summary | 详情页展示模型 | 与 AI 复用事实来源，但不把 UI 文案当作 AI 合同 |

## 5. 目标数据流与合同

本节是 PRD 第 4.3 节工作流的技术落图：PRD 定义用户可见的业务阶段，本方案定义每阶段的模块边界、输入输出和迁移顺序；上下文业务规则文档定义各节点的证据质量与表达限制。

### 5.1 标准记录边界

`RideRecord` 只包含：

```ts
type RideRecord = {
  activity: RideActivity;
  series: RideSeries;
};
```

`activity` 保存身份、来源、标准化汇总指标、传感器质量和解析问题；`series` 保存有序时序点、可用序列、metadata 和时间基准。缺失值不补零，原始值、计算值和估算值保留 provenance、quality、evidenceId 与 formulaVersion。

### 5.2 分析上下文边界

目标 `RideAnalysisContext` 至少包含：

- `rideId`、`analysisRunId`、schema/rules 版本和 user scope；
- `sourceInventory`：Activity、Series、Profile、history、deterministic summaries 和 knowledge 的来源、覆盖、版本及缺失原因；
- `featureSnapshot`：时间或距离加权的窗口、阶段、事件、峰值、连续性、跨传感器关系和不可用项；
- `capabilityProfile`：每项能力的 available/partial/unavailable、来源、质量、依赖、evidenceIds 和原因；
- `claims`/`allowedClaims`：全量去重索引，不能作为第二道裁剪器；
- `evidencePackets`：按分析问题分组的完整证据；
- `profileFacts`、`historyEvidence`、`knowledgeEvidence` 和统一 limitations；
- privacy、dependency、unsupported-claim 和 output policy。

### 5.3 EvidencePacket

每个可回答的问题生成一个包，至少包含：问题键、资格状态、必需/可选证据覆盖、全部合格 Claims、数据质量、缺口、可支持结论、禁止结论、知识检索主题和版本。

“最多 3 个代表性爬坡/巡航段”只属于展示高光排序；内部 EvidencePacket 必须保留全部合格区段和事件，并能逐项回溯到起止、距离、时间、传感器覆盖和规则版本。

S0-01 的 `ride-analysis-evidence-v2.ts` 是与 V1 `ride-analysis-context.ts` 隔离的类型化合同及内部一致性验证器，固定样例证明同主题多 Claim、索引/分组/来源引用和禁止字段键的边界。它不解析不可信 JSON，不证明任一源字段已完整转成 Claim，也不单凭隐私标志证明自由文本安全。S0-02 覆盖矩阵、后续 builder 与 L7 输入快照须分别验证这些缺口；S0-01 不用于生产调用。

## 6. 核心实现设计

### 6.1 Source inventory 与覆盖矩阵

第一步将所有输入注册为 `SourceRef`，每个 Ref 带 `sourceType`、路径/字段、单位、时间或距离基准、qualityStatus、provenance、版本和 `evidenceId`。随后生成覆盖矩阵：

```text
source field
  -> feature or deterministic result
  -> capability
  -> atomic Claim
  -> analysis dimension / EvidencePacket
  -> output section or explicit exclusion
```

覆盖矩阵是验收和回放索引，不是发送给模型的文本。任何详情页相关字段都必须有一条链路，或记录排除理由。

### 6.2 时序特征与事件

特征提取不能继续只按数组样本等权计算。实现应先规范时间/距离轴、移动状态、停歇和缺口，再按分析问题产生：

- 前、中、后阶段以及移动窗口的均值、分布、波动和变化；
- 巡航、停歇、爬坡等全部合格事件；
- 功率 10/20/30 秒峰值、NP 连续性、缺口和插值质量；
- HR、功率、踏频在同一时间/距离窗口或区段的对齐关系；
- 覆盖不足、传感器全零、最长缺口和跨段不可比原因。

停歇不进入移动表现统计，但停歇本身是配速证据。插值只能在规则允许的连续区间使用，并标记估算时长和公式版本。没有共同窗口时不生成跨传感器关系 Claim。

### 6.3 能力目录

基础输入能力（distance、timing、speed、elevation、heartRate、power、cadence、verifiedFtp 等）要扩展为能支撑产品问题的原子能力，例如 `pacingExecution`、`climbPerformance`、`heartRateLoad`、`powerStability`、`powerPeaks`、`intensity`、`trainingLoad`、`crossSensorAlignment`、`longTermLoad` 和 `recoverySignal`。

每项能力都必须返回状态、依赖、证据、质量和不可用原因。某项能力不可用不阻断其他独立问题；例如无 FTP 只能阻断 IF/TSS/功率区间，不能阻断功率均值或峰值分析。

### 6.4 Profile、历史与知识适配器

- `ProfileProvider` 返回本次分析授权的版本化快照；FTP 只有 `user_confirmed` 才能用于 IF/TSS，体重用于 W/kg，最大心率基线记录填写或估算来源。
- `HistoryProvider` 查询规定窗口的历史骑行并先完成可比性判断；有至少一个合格比较快照时自动生成历史包，没有则不生成历史 Claim。长期负荷/恢复要求多个活动、完整窗口、统一口径和足够覆盖。
- `KnowledgeRetriever` 按分析问题检索骑行运动科学、骑行数据标准和运动科学条目。知识条目必须有来源、版本或日期、适用条件、证据强度、限制和检索 ID，不能创造骑行事实或 Profile 数值。

三类适配器都必须能返回“无数据/不可比/未授权/过期”的结构化原因，不能用空数组掩盖缺口。

### 6.5 L6/L7 迁移边界

保留 L6/L7 作为迁移术语，但改变职责：

- L6 只编排分析问题、能力资格、证据分组、排序、限制和知识检索主题；禁止 `.find()` 首项选择和证据白名单裁剪。
- L7 将当前问题完整 EvidencePacket、必要限制、禁止结论和适用知识组装为版本化模型输入；校验必需证据、去重、引用、来源版本、问题归属、授权与隐私。问题归属不符时返回失败原因，不再筛选合格 Claim；不按“模型默认不展示”删除证据。
- `allowedClaims` 改为 EvidencePacket 全量 Claim 的去重索引；若包内 Claim 未出现在索引中、禁止字段泄漏或体积预算不足，阻止模型调用并返回可追溯原因，由编排方执行既有降级合同，不静默丢弃。
- 模型输出校验为独立的后置职责：基于已交付 Claim、知识和限制核对生成文本，拒绝或降级无支撑表达；确定性修复后须重新校验通过才展示，不得替代 L7 输入校验或修改 EvidencePacket。

### 6.6 直连模型、Prompt 与输出修复

- 同一固定样例和反例集对硅基流动及备选渠道比较首轮事实忠实、中文表达、合同通过率、隐私/数据处理条款、时延、可用性和费用；评测与预算确认后才固定模型 ID、地址、认证和结构化输出模式。供应商返回结构化 JSON 不替代本地校验。
- Prompt、输入和输出 Schema 分别版本化。输出中的数字、区段、定性结论和建议需要问题归属、结论类型及 Claim ID；引用知识时另附知识 ID 和条件。文本断言须与引用逐项吻合；无事实锚点或适用知识不能强填建议。
- 先对实际交付输入快照做独立输出校验，针对稳定性、长期负荷/恢复、训练计划、因果和高风险建议建立反例。只对可安全确定的格式/可选片段做本地整理并重验；原输入无效、隐私或高风险失败、Provider 超时/错误不走模型修复。
- 对仍不合格但可定位的低风险结构或措辞错误，在整次预算允许时至多一次受限模型修复；使用原输入及服务端错误码，原输出须先经脱敏和字段白名单处理，否则仅用原输入重新生成。修复结果仍做同一全量校验，再失败立即降级。保存首轮/本地整理/模型修复的独立指标，不以修复后通过率掩盖首轮错误。

## 7. API、存储与隐私

### 7.1 骑后 API

`app/api/ride-analysis/route.ts` 目标流程：

1. 根据 `rideId` 读取并校验 `RideRecord`；
2. 读取本次授权的 Profile 快照；
3. 查询历史并执行可比性、长期负荷和恢复资格判断；
4. 运行确定性 Summary、特征、能力和 Claim 构建；
5. 检索版本化知识证据；
6. 生成完整 EvidencePackets；L7 组装并校验模型输入，失败时记录原因并降级，不调用模型 API；
7. 输入通过后调用 Provider，执行独立输出校验，失败时拒绝或降级；
8. 持久化 `analysisRunId`、输入版本、证据引用、结果或 fallback 状态。

接口仍保留现有 fallback、重试、反馈和观测字段；AI 失败不能修改或隐藏详情事实。

### 7.2 持久化与回放

一次分析必须能够通过 `analysisRunId` 回放：RideRecord 版本、Summary 规则版本、Profile/history/knowledge 快照、Claims、EvidencePackets、模型输入摘要、输出校验结果和 fallback 原因。保存的是相对路线/区段特征，不保存精确经纬度给模型。

### 7.3 隐私边界

模型输入禁止文件名、精确坐标、原始轨迹、未授权 Profile、未受信任自由文本和与当前问题无关的敏感历史。知识和 Profile 的来源语义不能被压缩成设备实测；估算、软质量和不可用限制要原样保留。

## 8. 代码落点与迁移阶段

| 阶段 | 主要代码落点 | 结果 |
|---|---|---|
| S0 合同与覆盖 | 新增隔离 V2 schema/fixtures；随后覆盖矩阵 | `S0-01` 冻结合同/样例，`S0-02` 追踪字段覆盖；V1 `ride-analysis-context.ts` 暂不迁移 |
| S1 特征与事件 | `src/domain/ride-features.ts`、timing/route/climb/power 模块 | 时间/距离对齐、窗口、事件、关系和质量 |
| S2 能力与 Claim | `src/domain/atomic-capabilities.ts`、`ride-advanced-claims.ts` | 原子能力目录、关系 Claim、全部第 7 节结果映射 |
| S3 完整包输入组装与校验 | `src/ai/ride-interpretation-plan.ts`、`ride-interpretation-input-v04-candidate.ts` | 去除首项选择和硬裁剪，按问题组装完整包；校验失败阻止模型调用并记录原因 |
| S4 Profile/历史 | `src/domain/user-profile.ts`、`historical-comparison.ts`、`app/api/ride-analysis/route.ts` | 默认注入合格 Profile/历史，支持长期负荷/恢复限制 |
| S5 知识层 | 新增 knowledge adapter/retriever 与运行记录引用 | 知识独立、可追溯、按问题检索 |
| S5 模型渠道与直连 | 服务端模型适配、同集评测和调用追踪 | 先比较硅基流动及可选渠道，再冻结供应商/模型；V2 不依赖 Coze Workflow |
| S6 Prompt、校验、修复与评测 | 版本化 Prompt、独立输出校验、受限修复、API 集成与新 Run | 首轮/本地整理/模型修复分别统计；至多一次模型修复，全量重验和反例门通过 |

具体文件名可在 S0 合同冻结时微调，但不得改变本方案的数据边界和验收链路。每个阶段都必须独立测试、预览并进入 `Review`，未经用户验收不自动开始下一阶段。

## 9. 测试与验收策略

- **Schema/覆盖测试**：每个详情页相关字段和第 7 节输出都能追踪到 Claim、Feature、Capability、EvidencePacket、limitation 或排除理由。
- **特征测试**：时间/距离加权、停歇排除、窗口边界、缺口、插值、全部事件、跨传感器共同覆盖和峰值连续性。
- **能力/依赖测试**：缺 FTP、体重、最大心率、历史或知识时只禁用相关问题，不影响独立问题；状态、原因和证据一致。
- **完整包回归**：构造多个同主题 Claim，验证不会因 `.find()` 或候选排序而丢弃后续 Claim；`allowedClaims` 与包不一致必须失败。
- **输入边界与失败路径测试**：来源版本、引用、问题归属、授权、隐私或体积预算不满足时，不调用 Provider，记录失败原因并按既有合同降级；合格 Claim 不因排序或篇幅被删。
- **API 集成测试**：有/无 Profile、合格/不合格历史、知识检索命中/未命中和 provider fallback；历史有则自动纳入，无则不生成历史推断。
- **输出校验测试**：无波动不说稳定，无历史不说进步/恢复，无确认 FTP 不说 IF/TSS，无计划不说完成，相关不升级因果。
- **隐私快照**：模型输入不含原始轨迹、精确坐标、文件名和未授权 Profile。
- **工程门禁**：每个实现切片运行相关 Node tests、`pnpm typecheck`；阶段完成再运行 `pnpm verify`、`pnpm build` 和新的自动评测/盲评。

本设计阶段的验证只包括文档一致性和 Git diff 检查，不把现有测试通过误写为 V2 目标通过。

## 10. 风险与回退

| 风险 | 控制 | 回退边界 |
|---|---|---|
| 完整包造成上下文过长 | 按问题分包、设置体积预算、只发送结构化证据而不发原始点 | 当前问题包仍超预算时记录失败并降级，不做丢失 Claim 的摘要或首项静默裁剪 |
| 特征算法仍误判稳定/漂移 | 固定样例、覆盖/缺口门、反例评测 | 关闭对应能力并输出 limitation，不降低到无证据结论 |
| Profile/FTP 过期或未确认 | 快照版本、trustStatus 和依赖校验 | 禁用 IF/TSS/W/kg/区间，保留独立功率事实 |
| 历史不可比 | 先比对设备、场景、路线、指标和质量 | 只保留 limitation，不生成长期负荷或恢复推断 |
| 知识库过期或不适用 | 受控来源、版本和引用审计 | 无适用知识时降低建议强度，不用模型常识补齐 |
| L6/L7 或直连模型迁移破坏现有 AI | 保留 fallback/事件合同，隔离 V2 实现并用新 Run 验证 | 关闭 V2 入口并保留既有降级/详情事实；旧 Coze 仅属 V1 遗留路径，不是 V2 回退供应商或达标证据 |

## 11. 架构决策记录

| ID | 决策 | 复审条件 |
|---|---|---|
| ADR-V2-01 | 详情主合同为 `RideRecord { activity, series }`，第 7 节结果运行时生成 | 持久化或多端展示合同改变时 |
| ADR-V2-02 | 不恢复统一 DataLevel/basic/full 门；按记录校验和字段/模块质量决定可用性 | 有独立业务价值且不重复现有质量规则时 |
| ADR-V2-03 | `source: "b0"` 是 AI 降级状态，不是骑行数据层级 | 单独批准新的 fallback 合同时 |
| ADR-V2-04 | 继续使用模块化单体，不因证据重构引入服务拆分 | 体积、吞吐或权限边界出现测量证据时 |
| ADR-V2-05 | L6 编排问题，完整 EvidencePacket 是模型事实边界；L7 不以展示重点裁剪合格证据 | 新的模型协议需要不同证据合同并完成迁移评测时 |
| ADR-V2-06 | 合格历史默认自动纳入；无历史时省略，不增加用户开关 | 用户研究证明需要显式隐私/使用选择时 |
| ADR-V2-07 | 知识作为独立、带来源版本的 `knowledgeEvidence`，不与骑行事实合并 | 知识治理、版权或权限要求变化时 |
| ADR-V2-08 | L7 负责完整问题包的输入组装与边界校验，失败不调用模型；生成后的事实与表达由独立输出校验负责 | 用户评审证据合同或模型协议变化时 |
| ADR-V2-09 | V2 经同集评测后服务端直连模型 API，不依赖 Coze Workflow；Prompt/输出 Schema 版本化、独立校验，受限模型修复最多一次 | 供应商评测、数据处理条款或预算结果变化时 |

## 12. 方案完成门

`RIDE-AI-CONTEXT-01` 四文档设计任务已获用户验收。下列设计一致性要求继续作为后续实现的核对基线，不代表生产链已满足这些要求：

1. 都使用同一 `RideRecord`、第 7 节 Summary、Profile、历史、知识和 EvidencePacket 边界；
2. 都明确“详情页字段已显示”不等于“AI 已消费”，并给出覆盖矩阵和迁移差距；
3. 都包含 FTP/NP/IF/TSS、长期负荷/恢复、历史自动纳入和知识证据规则；
4. 都把 L6/L7 的首项选择和硬裁剪列为当前缺口，而非 V2 目标；
5. 明确标注已验收、待验收及各实现切片的实际状态，不把隔离合同或设计目标写成生产链已实现。
