# EVAL-V21-R01-20261008 失败率量化报告

- 生成时间：2026-10-08T01:47:50.715Z
- 总调用：20 次（4 样例 × 5 次，实际落盘 20）
- **最终降级率（repairFailed）：15.0%**（3/20）——阈值三档：≤5% 良好 / 5–15% 定方案 / >15% STOP

## 状态分布

| 状态 | 次数 | 占比 |
|---|---:|---:|
| repairFailed | 3 | 15.0% |
| modelRepairPass | 15 | 75.0% |
| firstPass | 2 | 10.0% |

## 分样例

| 样例 | firstPass | deterministicRepairPass | modelRepairPass | repairFailed | providerError |
|---|---:|---:|---:|---:|---:|
| 长骑行全传感器 | 0 | 0 | 3 | 2 | 0 |
| 通勤缺功率 | 1 | 0 | 3 | 1 | 0 |
| 真实上传 A | 0 | 0 | 5 | 0 | 0 |
| 真实上传 B | 1 | 0 | 4 | 0 | 0 |

## 首轮 issue 归因标签分布（共 33 条）

| 标签 | 次数 | 说明 |
|---|---:|---|
| structure | 14 | 结构/JSON 解析问题 |
| other | 8 | 其他 |
| number-unbound | 7 | 写了数字未绑对应 claim |
| expression-gate | 3 | 稳定/历史/恢复/计划表达门 |
| cross-dimension | 1 | 跨维度引用共享指标 |

## 最终降级的 failureCodes 分布

| 错误码 | 次数 |
|---|---:|
| STABILITY_WITHOUT_VARIANCE | 2 |
| SOFT_QUALITY_NOT_DISCLOSED | 1 |

## 逐次明细（失败与修复线索）

- ❌ 长骑行全传感器 #1: **repairFailed** (REPAIR_FAILED)，首轮 issue 2 条
  - expression-gate ×1
  - structure ×1
  - `STABILITY_WITHOUT_VARIANCE` @ dimensions[4].assertions[1]："踏频区间分布：低踏频占 7%，稳定踏频占 37%，耐力踏频占 44%，高踏频占 11%，踏频主要集中在稳定和耐力区间。"
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："本次骑行心率数据缺失，跨传感器分析无法进行，部分数据缺失。"
- 🔁 长骑行全传感器 #2: **modelRepairPass**，首轮 issue 2 条
  - other ×1
  - structure ×1
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："本次骑行部分数据缺失，跨传感器配合分析受限，无法进行完整的功率-心率解耦分析。"
- ❌ 长骑行全传感器 #3: **repairFailed** (REPAIR_FAILED)，首轮 issue 2 条
  - expression-gate ×1
  - structure ×1
  - `STABILITY_WITHOUT_VARIANCE` @ dimensions[4].assertions[1]："踏频区间分布：零踏频占 0%，低踏频占 7%，稳定踏频占 37%，耐力踏频占 44%，高踏频占 11%，极高踏频占 0%。大部分时间踏频处于稳定和耐力区间。"
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："由于心率数据缺失，本次无法进行跨传感器配合分析，部分数据缺失。"
- 🔁 长骑行全传感器 #4: **modelRepairPass**，首轮 issue 3 条
  - number-unbound ×1
  - other ×1
  - structure ×1
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[3].assertions[0].text："强度因子 0.9，属于节奏/Tempo 区间，训练压力分 529.1，属于极高负荷（>450）。"
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："本次骑行部分数据缺失，无法进行完整的跨传感器分析。"
- 🔁 长骑行全传感器 #5: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："本次骑行部分数据缺失，跨传感器分析受限，无法进行完整的有氧解耦分析。"
- 🔁 通勤缺功率 #1: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："本次骑行功率数据缺失，无法进行跨传感器配合分析，部分数据缺失。"
- 🔁 通勤缺功率 #2: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："本次骑行跨传感器数据有限，无法进行有效的同窗口关系分析。"
- ❌ 通勤缺功率 #3: **repairFailed** (REPAIR_FAILED)，首轮 issue 2 条
  - other ×2
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[0].assertions
  - `INTERPRETATION_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："本次可用数据有限，跨传感器配合维度缺少功率数据，无法进行有氧解耦或效率因子分析。"
- ✅ 通勤缺功率 #4: firstPass
- 🔁 通勤缺功率 #5: **modelRepairPass**，首轮 issue 2 条
  - number-unbound ×1
  - structure ×1
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[1].assertions[1].text："本次骑行高强度心率区间（Z4-Z5）占比高达 87%，平均心率 168 bpm，接近最大心率的 87.5%，表明骑行强度较高，心血管负荷较大。心率末段比初段高 "
  - `FACT_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："由于功率数据缺失，本次可用数据有限，无法进行有氧解耦和效率因子分析。"
- 🔁 真实上传 A #1: **modelRepairPass**，首轮 issue 7 条
  - number-unbound ×5
  - other ×1
  - structure ×1
  - `NUMBER_NOT_IN_CLAIMS` @ highlights[0].text："本次骑行累计爬升 904 米，包含 5 个代表性爬坡段，其中最具挑战的爬坡段平均坡度 11.1%，平均功率 256W。"
  - `NUMBER_NOT_IN_CLAIMS` @ highlights[0].text："本次骑行累计爬升 904 米，包含 5 个代表性爬坡段，其中最具挑战的爬坡段平均坡度 11.1%，平均功率 256W。"
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[1].assertions[1].text："最具挑战的爬坡段平均坡度 11.1%，平均功率 256W，平均踏频 66rpm，属于陡坡低踏频爬坡。"
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[1].assertions[1].text："最具挑战的爬坡段平均坡度 11.1%，平均功率 256W，平均踏频 66rpm，属于陡坡低踏频爬坡。"
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[1].assertions[1].text："最具挑战的爬坡段平均坡度 11.1%，平均功率 256W，平均踏频 66rpm，属于陡坡低踏频爬坡。"
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - …共 7 条
- 🔁 真实上传 A #2: **modelRepairPass**，首轮 issue 2 条
  - other ×1
  - structure ×1
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："本次骑行部分数据缺失，跨传感器分析受限，无法进行完整的有氧解耦评估。"
- 🔁 真实上传 A #3: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："本次骑行心率数据缺失，跨传感器分析无法进行，仅能基于功率与踏频的有限数据观察。"
- 🔁 真实上传 A #4: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："由于心率数据缺失，本次无法进行跨传感器配合分析，部分数据缺失。"
- 🔁 真实上传 A #5: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[5].assertions[0]："由于心率数据缺失，跨传感器分析无法进行，本次可用数据有限。"
- ✅ 真实上传 B #1: firstPass
- 🔁 真实上传 B #2: **modelRepairPass**，首轮 issue 2 条
  - expression-gate ×1
  - cross-dimension ×1
  - `STABILITY_WITHOUT_VARIANCE` @ highlights[0]："全程几乎全平路，地形分类覆盖率达 100%，骑行节奏平稳。"
  - `CLAIM_NOT_IN_DIMENSION` @ dimensions[3].assertions[0].claimIds
- 🔁 真实上传 B #3: **modelRepairPass**，首轮 issue 1 条
  - structure ×1
  - `FACT_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："本次骑行功率数据缺失，跨传感器分析受限，无法进行功率-心率解耦等分析。"
- 🔁 真实上传 B #4: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `INTERPRETATION_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："本次跨传感器分析数据有限，功率数据缺失，无法进行功率-心率解耦分析。"
- 🔁 真实上传 B #5: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `INTERPRETATION_WITHOUT_CLAIM` @ dimensions[3].assertions[0]："本次骑行功率数据缺失，跨传感器分析无法进行，仅能基于速度与心率的关系做有限解读。"