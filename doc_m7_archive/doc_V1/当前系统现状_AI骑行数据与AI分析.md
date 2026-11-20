# 当前系统现状：AI 骑行数据与 AI 分析

> 更新日期：2026-08-28  
> 作用：记录当前代码已经实现的数据、指标、规则、AI 原子能力、特征、Claim 与模型数据处理边界。  
> 关联规划：[骑行高阶指标与可视化规则草案.md](骑行高阶指标与可视化规则草案.md)

本文件只描述当前代码已经解析、存储、计算或展示的事实；它不是高阶指标的目标清单。高阶指标必须在规划草案中逐项确认和实现，不能因原始文件中可能存在某个字段而默认可用。

## 1. 当前可接收的数据

| 数据层 | 当前数据 | 说明与边界 |
|---|---|---|
| 导入 | 单个 FIT 或 GPX 文件 | 本机临时导入；记录仅在当前 Node 进程内存保存，不是持久历史。 |
| 活动聚合 | 距离、总时间、骑行时间、累计爬升、平均/最高速度、平均/最高心率、平均/最大功率、设备提供的标准化功率、平均/最大踏频、运动消耗 | 每一项都有单位、来源、质量状态和证据 ID；字段缺失时不创建聚合值。设备提供的 `normalized_power` 当前可保留，但尚未由本地时序算法复算。 |
| 时序 | 距离、海拔、速度、心率、功率、踏频，以及隐私处理后的相对轨迹与经过时间 | 仅保留可用序列；原始经纬度不进入页面或 AI 上下文。无可信时间戳的 GPX 不产生经过时间、速度或其派生数据。 |
| 个人资料 | 年龄、身高、体重、最大心率、FTP | 最大心率可按 `220 - 年龄` 估算或被用户覆盖，并保留来源/更新时间/公式版本；FTP 仅用户确认值可作为可信基线。 |

## 2. 当前已展示的指标与页面

| 页面位置 | 已实现内容 | 当前缺口 |
|---|---|---|
| 摘要 Tab | 相对轨迹、日期，以及距离、骑行时间、平均速度、累计爬升、可用运动消耗；B0 始终可用 | 尚未展示路线形态、停歇、移动均速、区间分布、功率负荷或分段。 |
| 分析 Tab | 速度、海拔、心率、功率、踏频的基础时序曲线；有对应数据才显示 | 没有坡度序列、区间分布、停歇/巡航标记、赛事爬坡分级或曲线联动。 |
| 数据 Tab | 速度、里程、计时、心率、功率、设备提供的标准化功率、踏频、累计爬升、运动消耗的动态分组 | 只有基础聚合明细；缺少本反馈中列出的高阶指标和分组结构。 |

## 3. 当前已实现的质量与产品规则

| 已实现规则 | 当前行为 |
|---|---|
| 输入与聚合质量 | FIT/GPX 解析保留字段来源；对数值边界、距离/时长/均速一致性、最高/平均速度关系和传感器覆盖进行确定性校验。 |
| 无时间戳 GPX | 允许保留可靠轨迹、距离和海拔；不展示、不计算时长、速度、运动消耗、训练负荷或相关 AI 结论。 |
| 传感器降级 | 心率、功率、踏频各自独立按质量可用；缺失或不可靠时隐藏该维度，不以 0 补齐。 |
| 个人资料边界 | 一次骑行中的最高心率不自动写回最大心率；功率记录不自动生成可信 FTP。 |
| AI 边界 | 规则计算事实，AI 只解释有 Claim 的白名单事实；AI 失效时保留 B0。现阶段没有高阶分段、区间和负荷事实可供 AI 使用。 |

## 4. 已预留、但尚未实现的能力

原子能力模型已预留 `heartRateZones`、`powerZones` 和 `trainingLoad`，但当前均返回 `RULE_NOT_IMPLEMENTED`。当前没有停歇、巡航、坡度、路线形态、赛事爬坡分级、踏频区间、本地 NP、功体比、IF、TSS 或峰值平均功率的领域规则、质量门、页面展示和 AI Claim。

## 5. 当前 AI 原子能力全量清单与缺口

原子能力用于确定“这条记录允许分析什么”，不是直接给模型阅读的自然语言事实。每项能力记录可用状态、来源、质量、依赖、证据和不可用原因。当前共有 18 项：

| 原子能力 | 当前授予条件 | 当前缺口 |
|---|---|---|
| `route` | 相对轨迹序列有效 | 只表达“有轨迹”；没有路线形态、路线匹配或分段能力。 |
| `distance` | 有效总距离；可附带距离时序 | 没有上坡/平路/下坡距离或分段距离。 |
| `timing` | 总时间或骑行时间有效，且时序具备可信时间基准 | 没有统一的停歇识别、移动区段和采样缺口规则。 |
| `speed` | `timing` 可用，且平均或最高速度有效 | 没有巡航、移动均速、速度区段或情境化速度能力。 |
| `elevation` | 累计爬升或海拔时序有效 | 没有坡度、累计下降、路线形态和赛事爬坡分级能力。 |
| `heartRate` | 心率聚合或时序存在，且传感器质量通过 | 只支持基础统计特征；没有区间分布或坡段/功率关联。 |
| `maxHeartRateBaseline` | 上下文收到个人资料中的最大心率 | 支持用户值或系统估算值，但当前真实 Demo API 未注入个人资料。 |
| `heartRateZones` | 设计依赖 `heartRate + maxHeartRateBaseline` | 已占位；规则尚未实现，固定返回 `RULE_NOT_IMPLEMENTED` 或依赖不可用。 |
| `power` | 功率聚合或时序存在，且传感器质量通过 | 只支持基础统计；没有区间、功体比、峰值窗口或完整时序质量门。 |
| `normalizedPower` | 功率可用，且文件中已有有效 `normalizedPowerW` | 当前依赖设备提供值；没有从功率时序本地复算 NP。 |
| `verifiedFtp` | 上下文收到用户确认的 FTP | 不自动估算符合既有决策；当前真实 Demo API 未注入个人资料。 |
| `powerZones` | 设计依赖 `power + verifiedFtp` | 已占位；规则尚未实现。 |
| `trainingLoad` | 设计依赖 `power + verifiedFtp` | 已占位；NP/IF/TSS 规则和质量门尚未实现。 |
| `cadence` | 踏频聚合或时序存在，且传感器质量通过 | 只有基础统计特征；没有描述性区间、滑行/缺失区分或场景关联。 |
| `userProfile` | 上下文收到至少一项年龄、身高、体重、最大心率或 FTP | 前端已有 localStorage 资料合同，但真实 AI API 没有把资料传给服务端上下文。 |
| `historyComparison` | 可选历史快照中至少一个指标通过可比性规则 | 领域与评测支持；真实 Demo API 没有持久历史，也不注入历史快照。 |
| `sameRouteComparison` | 可选历史快照中至少一个同路线指标可比 | 只有领域/Fixture 能力；真实导入没有稳定路线键和持久历史。 |
| `trend` | 设计依赖历史比较 | 未实现；即使传入历史快照仍标记 `RULE_NOT_IMPLEMENTED`。 |

实际页面请求只向 `/api/ride-analysis` 提交 `rideId`，服务端当前调用 `analyzeRideRecord(record)`，没有传入 `profile`、`profileFieldKeys` 或 `historicalComparison`。因此当前真实 Demo 中，`userProfile`、`maxHeartRateBaseline`、`verifiedFtp`、三项区间/负荷能力和三项历史能力均不会成为可用能力；它们目前只在领域合同或评测 Fixture 中可被注入验证。

## 6. 当前 AI 骑行特征全量清单与缺口

`RideFeatureSnapshot v0.1 / ride-feature-rules-v0.2` 当前最多生成 20 个特征。基础统计要求对应时序有效且至少 5 个有限样本；首尾变化要求至少 8 个样本。每个成功特征都会生成独立 Feature Claim；失败项记录不可用原因，不交给模型猜测。

| 维度 | 当前特征键（全量） | 当前算法 | 对应缺口 |
|---|---|---|---|
| 速度 | `speedSeriesMeanMps`、`speedStdDevMps`、`speedCoefficientOfVariation`、`speedFirstLastDeltaMps` | 时序均值、总体标准差、标准差/均值、末 1/4 样本均值减首 1/4 样本均值 | 按采样点而非按时间加权；没有停歇剔除、巡航、分段、坡度情境或异常区段。 |
| 心率 | `heartRateSeriesMeanBpm`、`heartRateStdDevBpm`、`heartRateFirstLastDeltaBpm` | 时序均值、总体标准差、首尾 1/4 样本均值差 | 没有 `%HRmax` 区间、心率漂移、停歇处理或与坡度/功率的关系特征。 |
| 功率 | `powerSeriesMeanW`、`powerStdDevW`、`powerCoefficientOfVariation`、`powerFirstLastDeltaW`、`normalizedPowerRatio` | 时序均值、总体标准差、变异系数、首尾 1/4 样本均值差；设备 NP / 平均功率 | 没有本地 NP、功率区间、W/kg、IF、TSS、10/20/30 秒峰值窗口；NP 比值依赖设备已有 NP。 |
| 踏频 | `cadenceSeriesMeanRpm`、`cadenceStdDevRpm`、`cadenceCoefficientOfVariation`、`cadenceFirstLastDeltaRpm` | 时序均值、总体标准差、变异系数、首尾 1/4 样本均值差 | 没有描述性区间、零踏频/缺失区分，也没有平路/爬坡情境。 |
| 海拔 | `elevationMinM`、`elevationMaxM`、`elevationRangeM`、`elevationPositiveGainM` | 时序最小/最大/范围；使用有效累计爬升聚合值 | 只能说明海拔范围和总爬升，不能说明坡度、爬升发生在哪里、赛事爬坡分级或路线形态。 |

这些特征能支持“波动、首尾变化、海拔范围”等有限描述，但不能支持“哪一段爬得好”“停歇后节奏如何”“主要处于哪个区间”或“本次训练负荷如何”。当前 `endurance` 虽然是 AI 输出允许的维度键，但没有任何特征映射到它；现有特征只会开放 `pace / climbing / heartRate / power / cadence`，历史快照可额外开放 `history`。

## 7. 当前 AI Claim 全量清单与缺口

模型可引用的事实统一进入 `allowedClaims`，每条包含 `claimId`、类型、键、数值/单位、置信度、证据 ID、可选公式版本和展示值。当前有三类 Claim：

| Claim 类型 | 当前可生成的键（全量） | ID 形式 | 当前实际情况与缺口 |
|---|---|---|---|
| Metric Claim | `distanceM`、`elapsedTimeS`、`movingTimeS`、`elevationGainM`、`avgSpeedMps`、`maxSpeedMps`、`avgHeartRateBpm`、`maxHeartRateBpm`、`avgPowerW`、`maxPowerW`、`normalizedPowerW`、`avgCadenceRpm`、`maxCadenceRpm`、`activityEnergyKcal` | `claim:{rideId}:{metricKey}` | 14 个聚合键中，只有本条记录存在、数值有限且质量为 `valid` 的项进入 Claim。缺少所有新增高阶聚合指标。 |
| Feature Claim | 第 6 节列出的全部 20 个特征键 | `claim:{rideId}:feature:{featureKey}` | 只有通过对应原子能力、时序质量和最小样本数的特征进入 Claim；缺少分段、区间、跨维度关系和事件 Claim。 |
| History Claim | 比较矩阵支持上述 14 个 Metric 键和 20 个 Feature 键，分别可做全窗口或同路线比较 | `claim:{rideId}:history:{all|same_route}:{key}` | 仅可比状态通过且存在锚点/基线时生成；真实 Demo API 当前不传历史快照，因此实际为 0 条。当前 Claim 只携带绝对变化值，没有面向模型的完整基线、相对变化和比较口径文本。 |

原子能力本身不是 Claim。不可用能力会转成 `forbiddenClaims`，不可用特征和能力原因会转成 `limitations`。当前没有以下 Claim：停歇、移动均速、巡航、坡度、上坡/平路/下坡距离、赛事爬坡分级、心率/踏频/功率区间、W/kg、本地 NP、FTP 基线、IF、TSS、峰值平均功率及它们之间的关系或亮点事件。

## 8. 数据经过怎样的处理后被 AI 使用

```text
FIT / GPX
  → 解析与标准化：RideActivity 聚合值 + RideSeries 时序
  → 确定性质量校验：数值边界、时间/距离/速度一致性、传感器覆盖、异常与占位值
  → 原子能力：逐项判断可用性、依赖、来源、证据和不可用原因
  → 特征快照：只从合格时序计算版本化统计特征，并生成 Feature Claim
  → 可选资料/历史：只有调用方显式注入且规则通过才生成相关能力或 History Claim
  → AI 上下文：把所有有效聚合值变成 Metric Claim，与 Feature/History Claim 去重；同时生成禁止项和局限
  → AI 准入：必须至少有 Metric Claim，并且存在 Feature 或可比 History 作为洞察来源；否则直接返回 B0
  → 模型投影（RideAnalysisContext v0.3 / ride-analysis-context-rules-v0.3）：只发送 allowedClaims、forbiddenClaims、limitations、安全标记和隐私标记；另发允许维度（AnalysisEligibility v0.1）
  → 输出校验：检查 JSON Schema、Claim 引用、数字、维度、安全和越界表达；最多一次受限修复
  → 仍失败、超时或不可用：返回确定性 B0，不影响无 AI 详情
```

领域上下文内部虽然保留原子能力、记录/派生/估算指标桶、完整特征快照、可选历史快照和资料事实，但当前模型投影**不直接发送**这些对象，也不发送原始 FIT/GPX、原始时序、相对轨迹、精确坐标或源文件名。模型只看得到经过规则批准的 Claim 及边界标记，不能访问或重新计算曲线。

这一链路的优势是数值和结论可追溯；当前限制是 Claim 本身过于基础，缺少分段、区间、事件与跨维度关系，所以 AI 即使合规，也容易把已有统计换一种说法。A--C 批的目标就是先产生并验收这些确定性高阶事实，D 批再决定哪些事实升级为 AI Claim，并通过专项 AI 测评验证是否真正增加用户价值。
