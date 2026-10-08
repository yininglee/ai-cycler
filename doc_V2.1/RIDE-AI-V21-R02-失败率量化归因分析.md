# RIDE-AI-V21-R02 失败率量化归因分析

- Run：`EVAL-V21-R02-20261008`（4 样例 × 5 次 = 20 次真实调用，完整生产链首轮 + 语义豁免 + 确定性收敛 + 至多一次模型修复）
- 版本栈：Prompt `ride-prompt-v2.8.2` / 知识库 `ride-kb-2.1.0`（打开）/ 派生指标 v21 + 白名单投影 / 数字门范围语义 / **语义豁免器已启用**（`ride-semantic-exemption-v2`）
- 原始数据：`output/v21-eval/EVAL-V21-R02-20261008/`（`raw/*.json` 逐次 issue 全文 + 首轮输出原文、`summary.json`、`report.md`）

## 1. 结果总览

| 指标                         |          R01 |             R02 | 变化           |
| -------------------------- | -----------: | --------------: | ------------ |
| 最终降级率（repairFailed）        |  15.0%（3/20） | **15.0%（3/20）** | 持平，未达"个位数"目标 |
| 首轮通过率（firstPass）           |  10.0%（2/20） |      5.0%（1/20） | ↓            |
| 一次模型修复通过率（modelRepairPass） | 75.0%（15/20） |    80.0%（16/20） | ↑            |
| 确定性收敛通过                    |            0 |               0 | —            |
| 供应商错误                      |            0 |               0 | —            |

**结论**：语义豁免器**生效**（R01 的「稳定和耐力区间」类误拦截已不再降级），但降级率被**三类语义豁免器覆盖不到的新问题**接住，整体仍卡在 15%。三类新根因全部确定性可修，仍不构成 STOP/换模型依据，但需再做一轮修复（`V21-15`）后复测。

## 2. 三个降级的根因

### 2.1 `NUMBER_NOT_IN_CLAIMS("71")` — 私自对区间百分比求和（demo-07-22 #5，P0）

断言原文：「本次骑行以 Z1-Z3 为主（**合计 71%**），高强度区间（Z5-Z7）占 16%…」，绑 `power.zone.z1/z2/z3` + `power.zone.highIntensityCombined`。

- **机制**：数字门"不可计算"规则（跨 Claim 求和禁止）正确拦截了模型的私自求和——29+21+21=71，claim 里没有 71。
- **根因**：输入有 `power.zone.highIntensityCombined`（Z5–Z7 合计 16%，模型正确直取），**但没有 Z1–Z3 合计的预计算 claim**。知识库解读逻辑会引导模型说"以 Z1-Z3 为主"，模型想给合计数字却无处直取，只能自己加。
- **本质**：派生指标供给的**对称性缺口**——只预算了"高强度合计"，没预计算"耐力/低强度合计"。修复轮也没改掉（模型坚持写 71%）。

### 2.2 `NUMBER_NOT_IN_CLAIMS("8")` — 两套爬坡段数量口径混淆（upload-0312e501 #1，P0）

断言原文：「…包含 5 个代表性爬坡段（**共识别 8 个爬坡段**）…」，绑 `climb.representativeClimbCount` + `metric.elevationGainM/LossM` + `terrain.trendClimbDistanceM`。

- **机制**：数字 8 无出处被拦截（其余 904/414/5/24.7 均命中）。
- **根因（诊断脚本 `scripts/diagnose-r02-number-8.ts` 实测确认）**：输入里存在**两套语义重叠但数值不同的爬坡段数量口径**：
  - `climb.representativeClimbCount`（event-climb 识别）：`value=5`（totalClimbs），`displayValue="3/5"`（representativeClimbs=3）
  - `terrain.climbRunCount`（地形分类）：`value=8`
  - 模型在**同一条断言里混用两套口径**——"5 个代表性爬坡段"（把 totalClimbs=5 误当代表性数，实际代表性是 3）、"共识别 8 个爬坡段"（来自 terrain.climbRunCount=8），却只绑了 `representativeClimbCount`，漏绑 `terrain.climbRunCount` → 数字 8 无出处。
- **本质**：R01 P2「爬坡组 claim 分散漏绑」的**具体化**——不是简单漏绑，而是两个口径数值冲突，模型分不清哪个数字该绑哪个 claim。

### 2.3 `STABILITY_WITHOUT_VARIANCE` — 功率曲线"相对平稳"数据供给 gap（demo-07-22 #3，P1）

断言原文：「功率曲线显示 5 秒最大平均功率 588W…3600 秒 246W，短时爆发力突出，**长时耐力输出相对平稳**。」，绑 `power.curve.5s/60s/300s/1200s/3600s`。

- **机制**：`isAssertiveConclusion`（fact）+ "平稳"命中 `stabilityTextPattern`，但绑的 power.curve claim 不匹配 `varianceClaimKeyPattern`（coefficientOfVariation/lastMinusFirst/drift/variance）也不带 `_stability` support → 触发。
- **语义豁免器判定 exempt=false（正确）**："相对平稳"确属"对本次骑行表现的稳定性断言"，不是区间名，不豁免。
- **根因**：power.curve（多时长最大平均功率）**本身就是过程/波动数据**，足以支撑"平稳/衰减/梯度"的形态描述，但 `varianceSupported` 判定未把 power.curve 视作过程数据 → 数据供给 gap 误拦。修复轮也没改掉这句措辞。

## 3. 隐性成本：`FIELD_TYPE_INVALID`（空维度）高频且消耗修复轮配额

- **现象**：`dimensions[5].assertions`（`crossSensorCoordination` 维度）几乎每次首轮都报 `FIELD_TYPE_INVALID: dimension assertions must be a non-empty array`。根因是模型对缺心率数据的跨传感器维度直接输出 `assertions: []`。
- **这是 P1（Prompt v2.8.2）修复的副作用**：v2.8.2 引导"数据缺失维度只能进 limitations 回填"，模型理解成"这个维度不用写断言了，给空数组"——从 R01 的"写空 claimIds 断言"退化成了"空 assertions 数组"。两者都错。
- **正确行为**：校验器**不要求维度全覆盖**（无"缺维度"检查），数据缺失维度应**从 `dimensions` 输出中省略该维度**，而非输出空数组。
- **为什么是隐性成本**：FIELD_TYPE_INVALID 本身能被修复轮救回，但它与数字门/稳定性门 issue 叠加时，**唯一一次修复轮要同时处理 2 个 issue**，往往只救回 FIELD_TYPE_INVALID、漏掉真正该修的数字门/稳定性门——3 个降级里 2 个（#5、#1）正是"数字门 + FIELD_TYPE_INVALID"组合。

## 4. 语义豁免器验证结论（正面 + 边界）

- ✅ **生效（区间名豁免）**：`upload-0312e501 run3` 首轮报「踏频分布以**平稳区（42%）**&#x548C;耐力区（35%）为主」，语义豁免器判定 exempt=true 撤销该 issue（callRecords 可见 2 次 255/259 token 的小调用），首轮校验只剩 FIELD_TYPE_INVALID → 修复轮一次救回。对照 R01 的「稳定和耐力区间」降级，此场景已消除。
- ✅ **正确拒绝豁免（真稳定性断言）**：demo-07-22 #3 的「长时耐力输出相对平稳」判 exempt=false，符合"只豁免区间名、不豁免真稳定性断言"的设计。
- ❌ **射程边界（设计如此）**：数字门（`NUMBER_NOT_IN_CLAIMS`）是确定性集合运算，永不进语义复核，故 §2.1/§2.2 两个数字门降级无法被语义豁免器接住。

## 5. 可修清单（按优先级）

| 优先级      | 问题                          | 修复方向                                                                                                                                                                                                  | 预期收益                     |
| -------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **P0-A** | 私自求和（Z1-Z3 合计无 claim）       | 补 `power.zone.enduranceCombined`（Z1–Z3 合计）预计算 claim，与 `highIntensityCombined` 对称；Prompt 无需再改（已有"不得自行求和"引导，缺的是供给）                                                                                      | 消 1/3 降级                 |
| **P0-B** | 两套爬坡段数量口径混淆                 | ① 供给消歧：`climb.representativeClimbCount` 与 `terrain.climbRunCount` 的 text/displayValue 明确标注口径（event-climb vs terrain 分类）；② Prompt 加"爬坡段数量有两个口径，写数字须绑对应 claim，不得混用"。。。。R01 P2「爬坡组 claim 分散漏绑」的**具体化--** | 消 1/3 降级                 |
| **P1**   | 空维度 `FIELD_TYPE_INVALID` 高频 | Prompt v2.8.3：数据缺失维度**从 dimensions 省略**（不输出空 assertions），缺失信息统一进 limitations；不动校验规则（校验器本就不要求维度全覆盖）                                                                                                    | 消除最高频伴随 issue，间接降低修复轮失手率 |
| **P2**   | 功率曲线"相对平稳"数据供给 gap          | `varianceSupported` 判定补 `power.curve.*`（多时长最大平均功率 = 过程数据），或语义豁免 stability 门增"功率曲线梯度/衰减形态描述"豁免场景                                                                                                       | 消 1/3 降级                 |

## 6. 结论与下一步

1. **R02 结论**：降级率 15%（与 R01 持平），语义豁免器生效但三类新根因接住了降级——两处数字门（私自求和、两套口径混淆）+ 一处稳定性门数据供给 gap，另有一处 P1 修复副作用（空维度）作隐性放大器。全部确定性可修，**不做 STOP**，再修一轮（`V21-15`）后复测 `EVAL-V21-R03`。
2. **下一步**：① P0-A（补 Z1-Z3 合计 claim）+ P0-B（爬坡段口径消歧）+ P1（空维度省略引导）+ P2（power.curve 过程数据）落地为 `V21-15`；② 用同一 4 样例复测（开新 Run `EVAL-V21-R03`，不续跑 R02）；③ 复测仍 >15% 再考虑校验器射程调整或 few-shot。
3. 正式放量仍走 `V21-12` 完整盲评 Run（冻结样例 + 四项指标 + 发布门），R02 只作 demo 阶段决策依据。
