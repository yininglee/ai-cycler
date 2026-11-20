# L0–L6 数据处理过程摘要

源文件：`1be0d1c0-63ef-476b-9103-61c1c04efba4.fit`（rideId=`local-preview`）
profile：FTP=200W，maxHR=200bpm，体重=74kg

## L0 原始输入
- 解析器版本：fit-parser-v0.4
- 设备：dabuziduo / G N12
- 记录点数：23702
- 关键会话指标：distanceM=161831.22m，elapsedTimeS=25297s，movingTimeS=23997s，elevationGainM=2924m，elevationLossM=2808m，avgSpeedMps=6.743810476309538m/s，maxSpeedMps=18.14m/s，avgPowerW=194W，maxPowerW=632W，avgCadenceRpm=75rpm，maxCadenceRpm=112rpm，activityEnergyKcal=4439kcal

## L1 标准化时序
- 已生成统一时间轴的 series（23702 点），单位统一为 m / s / m·s⁻¹ / W / bpm / rpm。
- 隐私边界已应用：`raw_track_excluded, precise_coordinates_excluded, source_filename_excluded, untrusted_free_text_excluded`（轨迹/精确坐标/文件名均排除）。

## L2 确定性指标（版本化纯函数，模型不可重算）
- 已记录指标：distanceM, elapsedTimeS, movingTimeS, elevationGainM, maxSpeedMps, avgPowerW, maxPowerW, avgCadenceRpm, maxCadenceRpm, activityEnergyKcal
- 派生指标：avgSpeedMps
- 估算指标：（无）
- 特征快照：12 条 feature（含功率/速度/海拔/爬坡/巡航/节奏稳定性等）

## L3 质量与解读门
- eligibility.eligible = true（status=eligible）
- 开放维度（allowedDimensionKeys）：pace, power, climbing, cadence
- 洞察来源：feature, advanced
- 上下文限制/不可用：heartRateSeriesMeanBpm:CAPABILITY_UNAVAILABLE；heartRateStdDevBpm:CAPABILITY_UNAVAILABLE；heartRateFirstLastDeltaBpm:CAPABILITY_UNAVAILABLE；cadenceSeriesMeanRpm:CAPABILITY_UNAVAILABLE；cadenceStdDevRpm:CAPABILITY_UNAVAILABLE；cadenceCoefficientOfVariation:CAPABILITY_UNAVAILABLE；cadenceFirstLastDeltaRpm:CAPABILITY_UNAVAILABLE；normalizedPowerRatio:METRIC_MISSING；heartRate:FIELD_MISSING；heartRateZones:DEPENDENCY_UNAVAILABLE；historyComparison:HISTORY_NOT_AVAILABLE；sameRouteComparison:HISTORY_NOT_AVAILABLE；trend:HISTORY_NOT_AVAILABLE；advanced.heartRate:sensor_quality_failed

## L4 分段/事件/关系特征
- 由确定性规则产生的 feature 与 advanced claim（见 pipeline-trace.json 的 L4/L5）。
- 本次无可比历史快照 => history_change 关闭（persistent_history_deferred）。

## L5 原子 Claim（源事实，逐条单一结论）
- `claim:local-preview:distanceM` [metric] distanceM = 161.8km (conf=high)
- `claim:local-preview:elapsedTimeS` [metric] elapsedTimeS = 7 小时 2 分钟duration (conf=high)
- `claim:local-preview:movingTimeS` [metric] movingTimeS = 6 小时 40 分钟duration (conf=high)
- `claim:local-preview:elevationGainM` [metric] elevationGainM = 2924m (conf=high)
- `claim:local-preview:avgSpeedMps` [metric] avgSpeedMps = 24.3km/h (conf=high)
- `claim:local-preview:maxSpeedMps` [metric] maxSpeedMps = 65.3km/h (conf=high)
- `claim:local-preview:avgPowerW` [metric] avgPowerW = 194W (conf=high)
- `claim:local-preview:maxPowerW` [metric] maxPowerW = 632W (conf=high)
- `claim:local-preview:avgCadenceRpm` [metric] avgCadenceRpm = 75rpm (conf=high)
- `claim:local-preview:maxCadenceRpm` [metric] maxCadenceRpm = 112rpm (conf=high)
- `claim:local-preview:activityEnergyKcal` [metric] activityEnergyKcal = 4439kcal (conf=high)
- `claim:local-preview:feature:speedSeriesMeanMps` [feature] speedSeriesMeanMps = 24.11km/h (conf=high)
- `claim:local-preview:feature:speedStdDevMps` [feature] speedStdDevMps = 11.9km/h (conf=high)
- `claim:local-preview:feature:speedCoefficientOfVariation` [feature] speedCoefficientOfVariation = 0.49ratio (conf=high)
- `claim:local-preview:feature:speedFirstLastDeltaMps` [feature] speedFirstLastDeltaMps = 1.95km/h (conf=high)
- `claim:local-preview:feature:powerSeriesMeanW` [feature] powerSeriesMeanW = 150.16W (conf=high)
- `claim:local-preview:feature:powerStdDevW` [feature] powerStdDevW = 99.54W (conf=high)
- `claim:local-preview:feature:powerCoefficientOfVariation` [feature] powerCoefficientOfVariation = 0.66ratio (conf=high)
- `claim:local-preview:feature:powerFirstLastDeltaW` [feature] powerFirstLastDeltaW = -43.48W (conf=high)
- `claim:local-preview:feature:elevationPositiveGainM` [feature] elevationPositiveGainM = 2924m (conf=high)
- `claim:local-preview:feature:elevationMinM` [feature] elevationMinM = 486m (conf=high)
- `claim:local-preview:feature:elevationMaxM` [feature] elevationMaxM = 1565m (conf=high)
- `claim:local-preview:feature:elevationRangeM` [feature] elevationRangeM = 1079m (conf=high)
- `claim:local-preview:advanced:timing.elapsedAverageSpeedMps` [advanced] timing.elapsedAverageSpeedMps = 23km/h (conf=high)
- `claim:local-preview:advanced:timing.movingAverageSpeedMps` [advanced] timing.movingAverageSpeedMps = 24.3km/h (conf=high)
- `claim:local-preview:advanced:timing.stoppedTimeS` [advanced] timing.stoppedTimeS = 22 分钟duration (conf=high)
- `claim:local-preview:advanced:cruise.totalDurationS` [advanced] cruise.totalDurationS = 4 分钟duration (conf=high)
- `claim:local-preview:advanced:cruise.representative.1` [advanced] cruise.representative.1 = 2 分钟duration (conf=high)
- `claim:local-preview:advanced:cruise.representative.2` [advanced] cruise.representative.2 = 2 分钟duration (conf=high)
- `claim:local-preview:advanced:route.trendClimbDistanceM` [advanced] route.trendClimbDistanceM = 70.2km (conf=high)
- `claim:local-preview:advanced:route.trendFlatDistanceM` [advanced] route.trendFlatDistanceM = 16.1km (conf=high)
- `claim:local-preview:advanced:route.trendDescentDistanceM` [advanced] route.trendDescentDistanceM = 73.3km (conf=high)
- `claim:local-preview:advanced:elevation.minM` [advanced] elevation.minM = 486m (conf=high)
- `claim:local-preview:advanced:elevation.maxM` [advanced] elevation.maxM = 1565m (conf=high)
- `claim:local-preview:advanced:elevation.rangeM` [advanced] elevation.rangeM = 1079m (conf=high)
- `claim:local-preview:advanced:climb.representative.1` [advanced] climb.representative.1 = 4.2km (conf=high)
- `claim:local-preview:advanced:climb.representative.2` [advanced] climb.representative.2 = 8.1km (conf=high)
- `claim:local-preview:advanced:climb.representative.3` [advanced] climb.representative.3 = 5.6km (conf=high)
- `claim:local-preview:advanced:cadence.coverage` [advanced] cadence.coverage = 77% (conf=high)
- `claim:local-preview:advanced:cadence.zone.zero` [advanced] cadence.zone.zero = 0 分钟duration (conf=high)
- `claim:local-preview:advanced:cadence.zone.low` [advanced] cadence.zone.low = 22 分钟duration (conf=high)
- `claim:local-preview:advanced:cadence.zone.steady` [advanced] cadence.zone.steady = 1 小时 54 分钟duration (conf=high)
- `claim:local-preview:advanced:cadence.zone.endurance` [advanced] cadence.zone.endurance = 2 小时 16 分钟duration (conf=high)
- `claim:local-preview:advanced:cadence.zone.high` [advanced] cadence.zone.high = 33 分钟duration (conf=high)
- `claim:local-preview:advanced:cadence.zone.very-high` [advanced] cadence.zone.very-high = 1 分钟duration (conf=high)
- `claim:local-preview:advanced:power.quality` [advanced] power.quality (conf=high)
- `claim:local-preview:advanced:power.averageW` [advanced] power.averageW = 194W (conf=high)
- `claim:local-preview:advanced:power.normalizedW` [advanced] power.normalizedW = 197.9W (conf=high)
- `claim:local-preview:advanced:power.intensityFactor` [advanced] power.intensityFactor = 0.99ratio (conf=high)
- `claim:local-preview:advanced:power.trainingStressScore` [advanced] power.trainingStressScore = 652.7score (conf=high)
- `claim:local-preview:advanced:power.averageWkg` [advanced] power.averageWkg = 2.6W/kg (conf=high)
- `claim:local-preview:advanced:power.normalizedWkg` [advanced] power.normalizedWkg = 2.7W/kg (conf=high)
- `claim:local-preview:advanced:power.coverage` [advanced] power.coverage = 99% (conf=high)
- `claim:local-preview:advanced:power.zone.z1` [advanced] power.zone.z1 = 1 小时 47 分钟duration (conf=high)
- `claim:local-preview:advanced:power.zone.z2` [advanced] power.zone.z2 = 56 分钟duration (conf=high)
- `claim:local-preview:advanced:power.zone.z3` [advanced] power.zone.z3 = 1 小时 11 分钟duration (conf=high)
- `claim:local-preview:advanced:power.zone.z4` [advanced] power.zone.z4 = 1 小时 6 分钟duration (conf=high)
- `claim:local-preview:advanced:power.zone.z5` [advanced] power.zone.z5 = 38 分钟duration (conf=high)
- `claim:local-preview:advanced:power.zone.z6` [advanced] power.zone.z6 = 36 分钟duration (conf=high)
- `claim:local-preview:advanced:power.zone.z7` [advanced] power.zone.z7 = 21 分钟duration (conf=high)
- `claim:local-preview:advanced:power.peakAverage.10s` [advanced] power.peakAverage.10s = 566W (conf=high)
- `claim:local-preview:advanced:power.peakAverage.20s` [advanced] power.peakAverage.20s = 538W (conf=high)
- `claim:local-preview:advanced:power.peakAverage.30s` [advanced] power.peakAverage.30s = 516W (conf=high)

## L6 解读计划（L7 输入投影）
- 模式：default
- 维度可用性 / 优先级：
- `power_output`：可用性=available，优先级=90 ★重点
- `route_pacing`：可用性=available，优先级=70 ★重点
- `terrain_climb`：可用性=available，优先级=65 ★重点
- `pacing_stability`：可用性=available，优先级=60 
- `cadence`：可用性=available，优先级=55 
- 排除：history_change:persistent_history_deferred；heart_rate:eligibility_not_open
- 候选 Claim 数：9
- 投影到模型的 allowedClaims：6（已按焦点维度裁剪，小于上下文总数 63）
- 视觉注册：visual:series:power(trend)，visual:series:speed(trend)，visual:series:elevation(trend)

## 最终送大模型的内容
见 `LLM_INPUT.md`（系统提示词 + 用户输入模板），模型实际载荷见 `ride_interp_input.json`。
