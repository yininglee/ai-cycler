# EVAL-V21-R02-20261008 失败率量化报告

- 生成时间：2026-10-08T05:08:32.716Z
- 总调用：20 次（4 样例 × 5 次，实际落盘 20）
- **最终降级率（repairFailed）：15.0%**（3/20）——阈值三档：≤5% 良好 / 5–15% 定方案 / >15% STOP

## 状态分布

| 状态 | 次数 | 占比 |
|---|---:|---:|
| modelRepairPass | 16 | 80.0% |
| repairFailed | 3 | 15.0% |
| firstPass | 1 | 5.0% |

## 分样例

| 样例 | firstPass | deterministicRepairPass | modelRepairPass | repairFailed | providerError |
|---|---:|---:|---:|---:|---:|
| 长骑行全传感器 | 0 | 0 | 3 | 2 | 0 |
| 通勤缺功率 | 1 | 0 | 4 | 0 | 0 |
| 真实上传 A | 0 | 0 | 4 | 1 | 0 |
| 真实上传 B | 0 | 0 | 5 | 0 | 0 |

## 首轮 issue 归因标签分布（共 25 条）

| 标签 | 次数 | 说明 |
|---|---:|---|
| other | 20 | 其他 |
| expression-gate | 2 | 稳定/历史/恢复/计划表达门 |
| number-unbound | 2 | 写了数字未绑对应 claim |
| cross-dimension | 1 | 跨维度引用共享指标 |

## 最终降级的 failureCodes 分布

| 错误码 | 次数 |
|---|---:|
| NUMBER_NOT_IN_CLAIMS | 2 |
| STABILITY_WITHOUT_VARIANCE | 1 |

## 逐次明细（失败与修复线索）

- 🔁 长骑行全传感器 #1: **modelRepairPass**，首轮 issue 2 条
  - other ×2
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 长骑行全传感器 #2: **modelRepairPass**，首轮 issue 2 条
  - other ×2
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- ❌ 长骑行全传感器 #3: **repairFailed** (REPAIR_FAILED)，首轮 issue 1 条
  - expression-gate ×1
  - `STABILITY_WITHOUT_VARIANCE` @ dimensions[2].assertions[2]："功率曲线显示 5 秒最大平均功率 588W，60 秒 403W，300 秒 309W，1200 秒 283W，3600 秒 246W，短时爆发力突出，长时耐力输"
- 🔁 长骑行全传感器 #4: **modelRepairPass**，首轮 issue 2 条
  - other ×2
  - `SOFT_QUALITY_NOT_DISCLOSED` @ dimensions[4].assertions
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- ❌ 长骑行全传感器 #5: **repairFailed** (REPAIR_FAILED)，首轮 issue 2 条
  - number-unbound ×1
  - other ×1
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[3].assertions[2].text："本次骑行以 Z1-Z3 为主（合计 71%），高强度区间（Z5-Z7）占 16%，强度分布偏向耐力基础。"
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 通勤缺功率 #1: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- 🔁 通勤缺功率 #2: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- ✅ 通勤缺功率 #3: firstPass
- 🔁 通勤缺功率 #4: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- 🔁 通勤缺功率 #5: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- ❌ 真实上传 A #1: **repairFailed** (REPAIR_FAILED)，首轮 issue 2 条
  - number-unbound ×1
  - other ×1
  - `NUMBER_NOT_IN_CLAIMS` @ dimensions[1].assertions[0].text："本次骑行累计爬升 904 米，累计下降 414 米，包含 5 个代表性爬坡段（共识别 8 个爬坡段），爬坡里程 24.7 公里，爬坡占比高，属于典型的起伏路线。"
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 真实上传 A #2: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 真实上传 A #3: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 真实上传 A #4: **modelRepairPass**，首轮 issue 2 条
  - expression-gate ×1
  - other ×1
  - `STABILITY_WITHOUT_VARIANCE` @ dimensions[4].assertions[0]："平均踏频 70 rpm，踏频分布以平稳区（42%）和耐力区（35%）为主，低踏频区占 19%，高踏频区占 4%。"
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 真实上传 A #5: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[5].assertions
- 🔁 真实上传 B #1: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- 🔁 真实上传 B #2: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- 🔁 真实上传 B #3: **modelRepairPass**，首轮 issue 1 条
  - cross-dimension ×1
  - `CLAIM_NOT_IN_DIMENSION` @ dimensions[3].assertions[0].claimIds
- 🔁 真实上传 B #4: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions
- 🔁 真实上传 B #5: **modelRepairPass**，首轮 issue 1 条
  - other ×1
  - `FIELD_TYPE_INVALID` @ dimensions[3].assertions