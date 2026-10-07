# STABILITY_WITHOUT_VARIANCE 归因诊断（demo-ride-2026-08-20）

> 日期：2026-10-07　样本：demo-ride-2026-08-20　模型：deepseek-ai/DeepSeek-V4-Flash
> 诊断脚本：`scripts/diagnose-stability-without-variance.ts`（5 次真实调用，只抓首轮）

## 一、结论摘要

demo-08-20 反复报 `STABILITY_WITHOUT_VARIANCE` 有**两个独立根因**，缺一不可、性质不同：

| 根因 | 性质 | 一句话 |
|---|---|---|
| 根因 1 | **校验器误报（纯 bug）** | 模型把踏频 zone 名 `steady` 译成「稳定 7%」，`stabilityTextPattern` 只豁免了「稳定区间/稳定踏频/稳定区」，漏了「稳定 + 数字%」这个变体，被误判成"稳定性断言" |
| 根因 2 | **供给侧缺口（证据缺失）** | 记录开头有 189 秒断档，触发 `CONTINUITY_GAP`，导致 `coefficientOfVariation`（变异系数）claim 全部没生成——模型想说"真正的稳定"也**没有 CV 证据可引** |

两条叠加的结果：模型既会因为「稳定 7%」被误拦（根因 1），又会因为想表达真稳定却无 CV claim 可用而失败（根因 2）。后者正是"这个骑行本可解读为稳定却报错"的深层原因。

## 二、方法

重跑 demo-08-20 5 次（只抓首轮，不触发修复），对每条 `STABILITY_WITHOUT_VARIANCE` 拉出断言原文、conclusionType、引用 claimIds 及其 key/supports。同时盘点输入里可供引用的 variance 类 claim（key 匹配 `coefficientOfVariation|lastMinusFirst|drift|variance` 或 supports 以 `_stability` 结尾）。

## 三、触发原文（5 次实测抓到 1 次）

```
dimensions[2].assertions[0]（cadenceStrategy 维度，conclusionType=fact）
原文：平均踏频 79rpm，踏频区间分布：零速 6%、低踏频 6%、稳定 7%、耐力 48%、高踏频 33%。
引用 claimIds：cadence.mean + cadence.zone.zero/low/steady/endurance/high（共 6 条，全是均值 + zone 占比）
```

其中「稳定 7%」就是 `cadence.zone.steady`（value=254，displayValue="7"，单位 "%"）的占比翻译。它是一条**区间占比报告，不是稳定性断言**，却被表达门当成了"稳定"。

## 四、根因 1：校验器漏了「稳定 N%」这个 zone 翻译变体

当前正则：

```
stabilityTextPattern = /稳定(?!区间|踏频|区)|平稳(?=\s*\d+\s*%)|保持良好/
```

- `稳定(?!区间|踏频|区)` 只豁免「稳定」后跟「区间 / 踏频 / 区」三种后缀；
- 模型这次把 `cadence.zone.steady` 译成了**裸「稳定」+「7%」**，后缀是空格 + 数字，不在豁免列表里，于是命中「稳定」分支 → 判定为稳定性断言 → 引用的 claim 里没有任何 variance claim → 报 `STABILITY_WITHOUT_VARIANCE`。

这与此前已修的三次误报是**同一类问题的新变体**（`稳定踏频占 7%`、`稳定区 7%`、`平稳 37%` 已豁免），只是模型又换了一种译法。实测正则行为：

| 文本 | 是否命中「稳定」分支 | 结果 |
|---|---|---|
| 稳定区间 / 稳定踏频 / 稳定区 | 否（已豁免） | ✅ 正确 |
| **稳定 7%** | **是** | ❌ 本次误报 |
| 稳定（裸，如"踏频稳定"） | 是 | ✅ 正确（真稳定性断言） |

### 附带发现：`平稳` 分支的 lookahead 方向写反了

`平稳(?=\s*\d+\s*%)` 是**正向** lookahead，效果是"平稳后跟数字% 才匹配"，即「平稳 37%」会被当作稳定性断言（误报），而裸「平稳」（如"输出平稳"）反而不会被识别（漏报）。这与注释"平稳+N% 应豁免为 zone 报告"的意图相反，属同类隐患。当前测试文件无「平稳」用例，故未暴露。

## 五、根因 2：开头 189 秒断档，导致 CV claim 未生成

### 5.1 供给侧盘点

demo-08-20 的 60 条 claim 里，variance 类 claim **只有 3 条 `lastMinusFirst`**（speed +3.64 km/h、heart_rate +26.2 bpm、cadence +14.3 rpm），**没有任何 `coefficientOfVariation`**。

### 5.2 为什么 CV 没生成

`buildRideTemporalFeaturesV2` 判定三个传感器（speed/heart_rate/cadence）的 `stability.eligible = false`，reason 均为 `CONTINUITY_GAP`：

| 传感器 | mean | CV（已算出） | stability | stageComparison |
|---|---:|---:|---|---|
| speed | 7.91 m/s | 0.186（18.6%） | ❌ CONTINUITY_GAP | ✅ lastMinusFirst=3.64 km/h |
| heart_rate | 168 bpm | 0.092（9.2%） | ❌ CONTINUITY_GAP | ✅ lastMinusFirst=26.2 bpm |
| cadence | 78.9 rpm | 0.297（29.7%） | ❌ CONTINUITY_GAP | ✅ lastMinusFirst=14.3 rpm |

关键证据：**CV 值其实已经算出来了**（statistics 里 `coefficientOfVariation` 有值），只是被 `CONTINUITY_GAP` 门拦在 claim 生成之外（`addSeriesClaims` 里 `if (feature.stability.eligible)` 才生成 CV claim）。而 stage 对比（lastMinusFirst）不受 gap 影响、正常生成了。

### 5.3 gap 的性质

```
gaps = [{ startElapsedTimeS: 0, endElapsedTimeS: 189, durationS: 189 }]
第 0 点：elapsed=0, dist=0, speed=0, hr=97, cad=0
第 1 点：elapsed=189, dist=412.8, speed=1.6, hr=140, cad=61
```

189 秒内无采样点，但距离从 0 走到 412.8 米（约 7.85 km/h）——说明这 189 秒**人一直在移动，只是设备没记录**（FIT 记录起始断档），而非"静止等待"。它位于骑行最开头，之后 1861 个点连续记录了 3769 秒（189→3958）。

判定链：`gap.end - gap.start = 189 > MAX_CONTINUOUS_INTERVAL_S(10s)` → `gaps.length > 0` → stability 门 `CONTINUITY_GAP` → CV claim 不生成。

### 5.4 结论

**一个开头的 189 秒记录断档，关掉了整条 CV claim**。变异系数（CV = std/mean）本身**不依赖时间连续性**——只要采样量够、覆盖够，开头断档不影响 CV 的可信度；`CONTINUITY_GAP` 一刀切拦掉 CV，属过严。

## 六、数据佐证：这个骑行确实可以解读为稳定

- **心率 CV = 9.2%**（相当稳定），stages 均值 [150, 176, 176]——中后段心率稳在 176 bpm；
- 巡航段踏频 82→88→87 rpm，速度 29.97→27.96→29.23 km/h，配速相当平稳；
- 用户判断"本可解读为稳定"是对的，只是（根因 2）心率/配速的稳定性证据（CV）被开头 gap 拦掉了。

## 七、修复（已落地 2026-10-07）

| 项 | 动作 | 消除 | 状态 |
|---|---|---|---|
| **P0** | 校验器补「稳定 N%」豁免 + 修正「平稳」lookahead 方向 | 根因 1（含同类隐患） | ✅ 已落地 |
| **P1** | 供给侧：开头/尾部断档不触发 `CONTINUITY_GAP` | 根因 2 | ✅ 已落地 |

### 7.1 P0 落地（`src/ai/ride-output-validator-v2.ts`）

```diff
- const stabilityTextPattern = /稳定(?!区间|踏频|区)|平稳(?=\s*\d+\s*%)|保持良好/;
+ const stabilityTextPattern = /稳定(?!区间|踏频|区|\s*\d+\s*%)|平稳(?!\s*\d+\s*%)|保持良好/;
```

- 「稳定」分支补 `|\s*\d+\s*%`：豁免「稳定 7%」这种裸 zone 名 + 百分比（模型把 `cadence.zone.steady` 译成不带「踏频/区」后缀的写法）。
- 「平稳」分支由正向 lookahead 改为**负向** lookahead：原 `平稳(?=\s*\d+\s*%)` 把「平稳 37%」（zone 占比）误判为断言、裸「平稳」（真断言）漏报，方向反了；改后「平稳 N%」豁免、裸「平稳」仍拦截。

### 7.2 P1 落地（`src/domain/ride-temporal-features-v2.ts`）

新增骑行主体区间判定：以第一个/最后一个 moving 采样（`moving===true && !gap`）界定骑行主体，只有**主体内部的 gap**（`gap.endElapsedTimeS > firstMovingS && gap.startElapsedTimeS < lastMovingS`）才触发 `CONTINUITY_GAP`。开头/尾部的记录断档不再关掉 CV claim——CV（std/mean）不依赖时间连续性，采样量/覆盖率门槛（`INSUFFICIENT_SAMPLES`/`INSUFFICIENT_COVERAGE`）已经兜底。

验证：demo-08-20 三个传感器 `stability.eligible` 全部 `true`，CV claim 可生成（speed 18.6% / hr 9.2% / cadence 29.7%）；中间 gap 仍触发 `CONTINUITY_GAP`（原测试行为保留）。

### 7.3 回归测试

- `tests/ride-output-validator-v2.test.ts` 新增 2 用例：①「稳定 N%」豁免；②「平稳 N%」豁免 + 裸「平稳」仍拦截。
- `tests/ride-temporal-features-v2.test.ts` 新增 2 用例：开头 gap / 尾部 gap 不触发 CONTINUITY_GAP，CV 正常生成。
- 相关定向测试 65/65 通过；typecheck 通过；全量测试通过。
