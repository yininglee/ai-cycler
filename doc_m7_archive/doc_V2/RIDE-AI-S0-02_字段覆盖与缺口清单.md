# RIDE-AI-S0-02 字段覆盖与缺口清单

> 状态：V2 目标映射，已于 2026-10-04 获用户验收；面向用户的验收汇报见[开发规划的 S0-02 工作项](VIBE_CODING_开发规划.md#ride-ai-s0-02-验收汇报已通过)。此文件不是当前模型输入清单，也不证明骑后解读已改善。
> 对照：`src/domain/ride-schema.ts`、`ride-timing.ts`、`ride-elevation.ts`、`ride-route-shape.ts`、`ride-event-climbs.ts`、`ride-zones.ts`、`ride-power.ts` 的实际接口，以及详情页 ViewModel。可由类型检查核对的每个字段与目标路径见 `src/domain/ride-analysis-coverage-v2.ts`。

## 1. 如何阅读这条链

一个字段的目标去向是：标准化来源或确定性结果 → 过程特征/质量条件 → 能力资格 → 独立 Claim 或限制 → 对应问题的完整 EvidencePacket。例如 `activity.metrics.elevationLossM` → 下降/地形事实及来源质量门 → `elevation/terrain` → 独立 metric Claim 或不可用限制 → 爬坡表现、配速执行或合格历史比较。**当前代码尚未执行这条 V2 链。**

“进入质量门”不是把质量数字都写进用户文案：它决定能否说、应说得多强。来源身份和版本只负责追溯，不能单独证明骑行表现。一个结果可对应多个问题，但只有在该问题资格、同一骑行、授权、时序对齐和质量均通过时才入包；缺失值不填 0。多个来源测得同一名称时分别保留，不用设备值静默覆盖重算值。

字段清单中的 `metric/feature/advanced/limitation/none` 是目标产物类别，不是目前已生成的 Claim。`quality` 路径需由后续 builder 以**具体传感器和问题**限定，不能因功率缺口一概否定踏频分析；有子字段的数组必须逐项处理，不能只登记容器字段。历史、Profile 和知识不属于 RideRecord 或详情规则第 7 节，本项仅标出依赖，接入分别在 S3-01/S3-02。

## 2. RideRecord 来源逐项去向

- 身份和来源：`activity.schemaVersion/rideId/sport/startTime`、`series.schemaVersion/rideId` 定位骑行、场景与时间基准；`activity.source.kind/parserVersion/formatVersion/deviceManufacturer/deviceProduct` 与 `series.source.kind/parserVersion` 用于来源版本和历史可比性。`source.fileName` 排除。`activity.sourceIssues.code/severity/field` 决定拒绝、降级或字段限制；不转发未受信任的 `message` 原文。
- 15 项标准化指标均登记：`distanceM` → 距离/配速/爬坡；`elapsedTimeS/movingTimeS` → 时间、停歇和负荷依赖；`elevationGainM/elevationLossM` → 上升与下降的地形事实；`avgSpeedMps/maxSpeedMps` → 配速水平/峰值；`avgHeartRateBpm/maxHeartRateBpm` → 心率水平/峰值（后者**不是**用户最大心率区间基线）；`avgPowerW/maxPowerW/normalizedPowerW` → 功率及强度依赖；`avgCadenceRpm/maxCadenceRpm` → 踏频水平/峰值；`activityEnergyKcal` → 活动消耗背景，不能冒充 TSS 或恢复。峰值须过异常值门，设备 NP 与规则 NP 分别溯源。
- 每项 `Metric` 的 `value/unit/provenance/confidence/evidenceId/sourceField/sourceUnit/qualityStatus/recordedAt/formulaVersion` 随所对应事实或限制一起验收；不是十条额外骑行结论。`sensorQuality` 的 gps/heart_rate/power/cadence 四种质量及其 `coverage/sampleCount/invalidSampleCount` 分别约束对应维度。
- 时序资格：`series.coordinateSpace/privacy` 固定为相对空间及精确坐标排除门；`availableSeries` 的 route/distance/elevation/speed/heart_rate/power/cadence 各有目标；`seriesMetadata.sourceField/unit/qualityStatus/sampleCount`、`timeBasis.kind/startTime` 决定可否加权、比较和对齐。无时间轴则不凭点数作时间稳定性、区间和负荷结论。
- `points.sequence/elapsedTimeS/distanceM` 构成顺序、时间或距离轴与缺口/窗口；`points.route.x/y` 仅用于相对路线签名，不输出原始点或精确坐标；`elevationM` 进入平滑海拔/地形；`speedMps` 进入移动阶段、巡航及波动；`heartRateBpm` 进入心率水平、区间、共同窗口；`powerW` 进入连续功率、峰值、NP 和配对；`cadenceRpm` 进入踏频区间/阶段和配对。原始 `points[]` 及图表 SVG 路径不发给模型，保留派生事实、覆盖和限制。

## 3. 第 7 节结果逐项去向

- `TimingSummary`：`rulesVersion/source` 随来源追溯；elapsed/moving/stopped time 和总/移动均速分别成事实；`stops[]` 的起止、时长与类型逐段进入停歇证据；`cruiseSegments[]` 的时间/距离边界、时长、距离、均速、速度 CV、长巡航标志逐段进入配速问题。汇总可以另算，但不替代全部区段。
- `ElevationSummary`：gain/loss/min/max/range 分别成事实；gain/loss 来源、设备与计算差、`needsReview`、平滑点/段和异常隔离用于来源、质量或地形特征。内部平滑点不作为原始数组发送；两套口径不无来源合并。
- `RouteShapeSummary`：局部与长趋势的上坡/平路/下坡距离、moving/classified distance 和 trendClassifiedDistance 分别留证据；`gradeSegments/displayGradeSegments/segments/trendSegments` 的窗口与边界生成可引用区段特征，不发全部坡度点；`isAvailable/coverageRatio/needsCoverageNotice` 约束覆盖不足时的说法。
- `EventClimbSummary`：`climbs[]` 每一段的 id、类别、起止距离、长度、净爬升、平均坡度、难度、时间、移动均速、心率、功率分别保留（id 用于关联，不单独评表现）。规则版本、`powerQuality` 和 summary/单段的 `unavailableReasons` 进入来源和限制；没有某个传感器子项不删除整段可用爬坡。
- 心率和踏频 `ZoneDistribution`：每个 `bins[]` 的 key、时长、占比为事实；label 为展示称谓；riding/valid/missing/stopped duration、coverage、unavailableReason 为质量条件。心率的 `baseline.maxHeartRateBpm/source` 独立追溯；估算基线不能冒充用户确认值。踏频全零占位不能硬解释为骑行全程 0 rpm。
- `PowerSummary`：平均/最大功率、NP、IF、TSS、FTP、平均/NP 功体比、功率区间及所有 10/20/30 秒连续峰值分别处理；峰值窗口起止与规则版本必须可追溯。`qualityLevel`、riding/valid/interpolated duration、coverage、longestGapS、gapCount 和全部 unavailableReasons 是负荷/稳定性资格门。IF/TSS/功率区间需要已确认 FTP，W/kg 需要体重；NP 的连续窗口口径须在后续算法项确认。

详情页 `factCards/detailSections`、巡航标签、海拔与坡度图、路线图、爬坡标签、区间图及数据质量提示是上述来源的展示格式；格式化文字、展示抽样点和图表路径不额外生成骑行事实。`rideMeta` 的日期/来源属于身份，`fixtureDescription` 和演示说明不进入骑行结论。详情页可见不等于模型已收到。

## 4. 当前 V1 缺口和回归样例

1. **下降被排除**：当前 AI 上下文显式排除 `elevationLossM`。目标是来源/质量合格时进入地形事实，失败时给出限制；S2-01 生成及 S6-03 接入后回放“有下降的活动”，检查其 Claim 和相关完整包。
2. **区段被截断**：当前高级 Claim 最多保留排序后的 3 个巡航和 3 个爬坡，且代表性爬坡把多个数值压进一条复合文本。目标样例为 4 段合格爬坡/巡航，4 段均以独立字段留在问题包，展示仍可只选高光；S2-01/S2-02 验证。
3. **过程与关系证据不足**：当前特征按采样点等权，没有统一的移动窗口、停歇/缺口和共同传感器覆盖。目标用不等间隔、停歇和错位传感器反例，不能仅靠均速说“稳定”、不能无共同窗口说配合；S1-01/S1-02 验证。
4. **功率连续性**：现有 PowerSummary 的 NP 秒列表可能拼接不连续有效片段，30 秒窗口跨缺口/停歇；峰值却逐连续片段计算。目标用缺口边界样例校准 NP 口径，禁止不合格 NP 支持 IF/TSS；S1-02/S2-01 验证。
5. **资料与历史未入请求**：现有骑后 API 调用 `buildRideAnalysisContext(record)`，无 Profile/历史；HR 区间、确认 FTP/IF/TSS、可比历史不能因为详情页可见就声称 AI 已知。目标分别用确认与未确认 FTP、可比与不可比历史、多活动与单活动窗口测试；S3-01/S6-03 验证。
6. **即便生成 Claim 也可能被丢**：当前 L6 `.find()` 首项选择，L7 仅保留候选引用的 Claim。目标同时保留同主题的水平、过程、质量/限制等多条证据；S2-02/S4-01/S6-03 分别验证包、模型输入、实际请求和新 Run 盲评。

本项仅落实**目标登记与防漏检查**，不完成上述六项修复，也未改变当前骑后解读。新增实际字段时类型检查必须提示登记；运行测试检查目标 Claim/问题包、隐私排除和映射键一致。后续 builder 仍须用真实数据、字段级质量及证据 ID 验证“已登记 → 已生成 → 已入包 → 已送达模型 → 已正确表达”，不能用这张清单代替实现验收。
