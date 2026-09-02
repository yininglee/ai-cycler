# ITEM-T001｜原版 Prompt v3.1.2 运行时可靠性恢复预览

## 1. 状态

`READY_FOR_PREVIEW`：用户已接受4槽受限范围；投影层、等价性测试、真实扣子复测和合同回放均已完成，等待结果验收。

## 2. 最小充分审查卡

| 来源 | 定向范围 | 结论 |
|---|---|---|
| 项目台账 | `current-status.md`、`DEC-060/067/068`、`LOG-20260825-154` | 原版为当前Demo候选；平台不可观测字段仍为`NOT_OBSERVABLE`；本切片不判断G1 |
| PRD | §6.3、§7.8–7.9 | 模型只能解释确定性上下文；超时进入B0；Prompt/Workflow/Schema独立版本化 |
| 研发指南 | §6.2、§9.1、§10.7 | 扣子只接分析上下文；服务端负责合同校验、一次修复和B0；禁止用估算填充证据 |
| 路线图 | §5.3、§18 | 这是T1受限诊断实验，不是G1或生产放行 |

## 3. 诊断依据

原版 A `RUN-20260825-756`：B2 `7/21`、B0 `14/21`，P50/P95 `15002.545/20334.534ms`。B Compact Candidate：B2 `2/21`、B0 `19/21`，因此不作为修复方向。

超时案例呈聚集现象：`RA-AUTO-006`、`RA-AUTO-011`、`RA-AUTO-013`均出现3/3首轮超时。对应输入的`analysis_context`约`19,918`、`26,144`、`29,084`字符；这些上下文除`allowedClaims`外还包含重复的指标桶、完整`featureSnapshot`、能力对象和历史快照。该证据只支持“冗余载荷是可检验假设”，不证明因果。

## 4. proposed 传输投影

新增独立函数/模块，将发送给模型的`analysis_context`投影为语义保持的最小结构；不改变`RideAnalysisContext v0.2`本体和服务端领域合同。

必须保留：

- `schemaVersion`、`rulesVersion`、`contextType`、`rideId`、`userScope`；
- `allowedClaims`的完整数组及每个Claim的`claimId`、`kind`、`key`、数值/单位、来源/置信度、证据、公式和展示换算字段；
- `forbiddenClaims`、`limitations`、`safetyFlags`、`privacyFlags`；
- `analysis_elig`独立保持原值，不从投影Context重建。

默认移除：

- `recordedMetrics`、`derivedMetrics`、`estimatedMetrics`、`profileFacts`；
- 完整`featureSnapshot`（包括`input`和`unavailable`）；
- 完整`capabilities`对象；
- 完整`historicalComparison`快照。

只有在 Prompt/Workflow 实际读取且无法由`allowedClaims`、`analysis_elig`或限制字段表达时，才可为某字段提出例外；当前预览不假设例外。

## 5. 等价性硬门

对18条输入逐条比较原Context与投影Context：

1. Claim ID集合、顺序、kind/key、原始value/unit、displayValue/displayUnit/displayFormulaVersion、confidence、evidenceIds和formulaVersion完全一致；
2. `forbiddenClaims`、`limitations`、`safetyFlags`、`privacyFlags`、版本标识和骑行/用户范围完全一致；
3. `analysis_elig`字节级不变，允许维度、必需Claim和fallback完全一致；
4. 原始轨迹、精确坐标、文件名和自由文本仍不进入模型；
5. 投影前后输入摘要分别记录，不能覆盖旧输入摘要。

任一等价性失败，停止真实复测；不以“模型可能不需要该字段”放宽硬门。

## 6. 零调用验证

实现后先运行本地合同测试和零调用预检，记录每条案例的投影前后字符/字节数、SHA-256、Claim计数和差异字段。零调用预检必须显示：Prompt `3.1.2`、Workflow `7676429753852018707` / `v0.0.2`、模型保持不变、`timeoutMs=15000`、`externalCalls=0`。

## 7. 已接受的受限复测范围

不直接运行54槽或完整21槽。建议先用4条案例、每条1次，共4槽：

| 案例 | 目的 |
|---|---|
| `RA-AUTO-001` | L1成功对照，验证投影不损失基本事实/特征 |
| `RA-AUTO-006` | 多维心率/踏频和较高体量超时样本 |
| `RA-AUTO-011` | L3高体量、全维度、首轮超时样本 |
| `RA-AUTO-018` | 不准入路径，必须0 Provider调用并走B0 |

每个可调用槽最多首次生成+一次受限修复；任何Prompt/Workflow/模型/超时/输入投影摘要漂移、证据无法保存、`RA-AUTO-018`发生Provider调用或安全停止，立即停止剩余槽位。复测只比较B2成功/超时/修复/B0和合同Claim完整性；不做人评、不算性能/成本、不判断G1。

## 8. 用户确认

用户于2026-08-25接受上述4槽范围和停止条件，授权在等价性验证通过后执行真实扣子复测。

## 9. 实现与零调用预检

- 新增独立投影版本`ride-analysis-model-context-projection-v0.1`；领域`RideAnalysisContext v0.2`本体不变。
- 18条冻结输入逐条验证Claim、限制、安全、隐私、版本与`analysis_elig`等价；本地全量`201/201 PASS`。
- 18条`analysis_context`由`292091`字节降至`116999`字节，减少`59.94%`；本次4条由`69181`降至`29141`字节，减少`57.88%`。
- 最终零调用预检固定Prompt `3.1.2`、Workflow `ride_analysis_v2 / 7676429753852018707 / v0.0.2`、`15000ms`、4案例×1次和源码提交`68e1f70ac6fefa998ab540618c64b4239aba0ba5`；`externalCalls=0`。

证据：[零调用投影摘要](../eval/runs/T001-original-prompt-projection-preflight-v0.1.json)。

## 10. 真实复测结果

原始批次[`RUN-20260825-918-raw`](../eval/runs/RUN-20260825-918-raw.json)及回放[`RUN-20260825-918`](../eval/runs/RUN-20260825-918.json)均已保存，回放`validationStatus=PASS`、`benchmarkStatus=NOT_SCORED`。

| 槽位 | 结果 | 调用/耗时 | 合同结论 |
|---|---|---|---|
| `RA-AUTO-001#1` | B2 | 1次 / `14457.543ms` | 首轮通过；未知Claim 0，主题Claim覆盖通过 |
| `RA-AUTO-006#1` | B0 / `AI_TIMEOUT` | 1次 / `15008.052ms` | 超时后直接降级，无修复调用 |
| `RA-AUTO-011#1` | B0 / `AI_TIMEOUT` | 1次 / `15009.600ms` | 超时后直接降级，无修复调用 |
| `RA-AUTO-018#1` | B0 / `DATA_NOT_ELIGIBLE` | 0次 / `1ms` | 零Provider调用约束通过 |

汇总为4/4槽合同回放通过，B2 `1`、B0 `3`、超时`2`、修复`0`、安全停止`0`、Provider调用`3`、可观测Token `6099`。平台不可观测字段继续为`NOT_OBSERVABLE`。

## 11. 前后比较与结论

与投影前`RUN-20260825-756`中的同一4个`#1`槽位相比，B2/B0=`1/3`、超时=`2`、修复=`0`、Provider调用=`3`均未变化；成功槽位的可观测Token由`8585`降至`6099`。新B2输出通过Claim硬合同，`overallAssessment`引用5条Claim、dimensions合计8条唯一Claim；未发现未知Claim或主题Claim缺失。

结论：传输投影能在不破坏合同的情况下显著减小输入，并应保留为运行时边界优化；但本次4槽诊断没有恢复`RA-AUTO-006/011`的15秒B2可靠性，不能将超时主要归因于被移除的重复领域字段，也没有证据支持扩大复测。人工可读性按已接受范围未运行。

比较证据：[投影前后比较](../eval/runs/T001-original-prompt-projection-comparison-v0.1.json)。下一步应单独预览15秒同步调用策略，而不是继续削减Prompt或立即扩大扣子批次。
