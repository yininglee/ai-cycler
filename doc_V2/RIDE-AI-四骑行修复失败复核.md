# 四骑行修复失败复核（2026-10-08）

> 症状：f95e / demo-08-20 / demo-07-22 / 965aa12e 四条骑行分别报
> `NO_DELIVERABLE_QUESTIONS` / `SOFT_QUALITY_NOT_DISCLOSED` / `STABILITY_WITHOUT_VARIANCE` / `NUMBER_NOT_IN_CLAIMS`。

## 一、结论摘要

四条报错分两类，**不需要重跑量化**（量化测失败率，这里是具体案例报错，应针对性定位）：

- **三条是旧代码**（dev server 未重启到最新提交），重启即消失；
- **两个是真问题**（`SOFT_QUALITY_NOT_DISCLOSED`、`NUMBER_NOT_IN_CLAIMS`），本轮已修复。

## 二、四条最终结论

| 骑行 | 报错 | 最新代码下实测 | 结论 |
|---|---|---|---|
| demo-07-22 | STABILITY_WITHOUT_VARIANCE | **PASS（0 issue）** | 旧代码，重启 server |
| 965aa12e | NUMBER_NOT_IN_CLAIMS | **PASS（0 issue）** | 旧代码，重启 server |
| f95e | NO_DELIVERABLE_QUESTIONS | input `ready`（4 问题包） | 旧代码（stationaryGap 修复未生效），重启 server |
| demo-08-20 | SOFT_QUALITY_NOT_DISCLOSED | 仍报 | **真问题**，已修复 |
| f95e（重启后）| NUMBER_NOT_IN_CLAIMS | 仍报（2 个变体） | **真问题**，已修复 |

## 三、真问题 1：SOFT_QUALITY_NOT_DISCLOSED（demo-08-20）

**根因**：校验器与 Prompt 的 soft 语义错位。

- 校验器 L513 判**问题包级 soft**：`pacingExecution` 因 `sensorContinuity`（开头 189s 断档）被标 `qualityStatus=soft`，要求整个维度文本写「部分/缺失/有限」；
- Prompt 规则 8 只写了**claim 级 soft**：「引用 soft 的 Claim 时才披露」。而 pacingExecution 里 `softClaims=0`（全是 valid claim），模型按 claim 级理解就不披露；
- `question.qualityStatus` / `eligibility` 字段其实**已经传给模型**，只是 Prompt 没引导它用。

**修复**（PD-AI-33，Prompt v2.7.3 / repair v2.2.4）：
- 输入说明补 `questions[].qualityStatus / eligibility` 的含义；
- 规则 8 扩展为「question 标 soft/partial 时（即使引用都是 valid Claim）也必须披露」。

**验证**：demo-08-20 复测 **PASS（0 issue）**。

## 四、真问题 2：NUMBER_NOT_IN_CLAIMS（f95e，两个变体）

### 变体 A：自算占比「占比接近 100%」

- 原文：「平路里程 30.4 公里，占比接近 100%」，引用 `terrain.trendFlatDistanceM`（只有距离，没有占比）。
- 根因：模型自行估算单个占比（规则 1 已禁「计算比例」，但模型没意识到「接近 100%」也算）。
- 修复（PD-AI-33）：规则 1 补反例「claim 无占比数据时，『占比接近 100%』→『几乎全平路』」，repair Prompt + few-shot 同步。

### 变体 B：段序号「第 N 个巡航段」

- 原文：「第 5 个巡航段（3 分钟）平均速度 31.16 km/h」，引用 `cruise-4-1461.span / speed.mean`。
- 根因：`structuralNumberPattern` 的 `第X段` 分支只匹配「第N段」（以「段」结尾），模型连续换措辞——「第 5 段」（带空格）→「第 5 个巡航段」（换名词），序号 5 被当数据数字查出处，失败。
- 修复：`第X段` 分支改为**通用剥离「第 N」前缀**（`第\s*[一二三四五六七八九十\d]+`，不依赖后面的名词），中文里「第 X」几乎总是序号。剥后剩的「段」由裸段分支的 digit/point/unit 负向排除继续保护真实数据（「第二段 27.96」→「段 27.96」→ 27.96 存活）。

**验证**：f95e 复测 **7 个 issue → 1 个 issue**（序号剥离生效）。

## 五、遗留：f95e 剩 1 个「170」造数（P3 类）

- 原文：「后半段心率维持在 170 bpm 以上」，引用 `cruise-0-42(158) / cruise-4-1461(180) / cruise-7-2111(171)` 的心率均值。
- 根因：**模型造数**——claim 里心率均值是 158/171/180/173/179，没有 170；「170 bpm 以上」是模型自造的阈值数字。
- 归类：P3（Prompt 约束「不写 claim 外阈值」），此前 `RIDE-AI-EVAL-01_NUMBER_NOT_IN_CLAIMS归因诊断.md` 已列为待办，本轮未实施。

## 六、判断

这已是「修 Prompt → 模型换措辞造新数」的循环：f95e 连续 4 次复测分别暴露「占比造数 → 序号空格 → 序号换名词 → 阈值造数」，每次修复都让 issue 下降，但模型对「数字必须出自 claim」合同的遵守度低是根本问题。**建议重跑 EVAL-01 失败率量化**，用整体降级率判断修完这批 Prompt/校验器后，还需要继续打地鼠还是换模型。
