# T001 B2固定集运行接收协议

## 1. 用途

本协议用于接收和复验18条自动骑后案例各3次的B2真实运行，共54个槽位。它只判断运行记录是否完整、版本是否冻结，以及原始输出经过当前服务端合同后会得到B2、一次受限修复、B0降级或安全停止中的哪一种结果。

导入成功不等于B2质量通过。导入产物固定写为：

- `validationStatus=PASS`：54个槽位和必需元数据完整，原始尝试可由服务端重放；
- `benchmarkStatus=NOT_SCORED`：尚未完成硬门汇总和两名评审的盲评，不形成G1结论。

## 2. 冻结范围

- 清单：[`t001-b2-benchmark-manifest.json`](t001-b2-benchmark-manifest.json)
- 案例：`RA-AUTO-001`至`RA-AUTO-018`
- 次数：每条3次
- B0对照：`RUN-20260824-028`（Service v1.5/特征规则v0.2同矩阵）
- Prompt：`3.1.2`
- Service：`ride-analysis-service-v1.5`
- 特征规则：`ride-feature-rules-v0.2`
- Workflow：`ride_analysis_v2-dev.15`
- Few-shot：`disabled`
- 输入集SHA-256：`5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671`

精确`modelId`、区域和模型参数必须由真实运行补充，不能使用`unrecorded`或营销系列名替代。

## 3. 原始批次结构

输入为一个JSON对象，`schemaVersion`固定为`t001-b2-raw-batch-v0.2`，包含：

- `batchId`：未使用过的`RUN-YYYYMMDD-NNN`；
- `plan`：固定`B2`；
- `versionMatrix`：清单中的固定版本和输入摘要，加精确`modelId`、`region`、非空`modelParameters`和40位小写Git `sourceCommit`；
- `records`：54条记录，每个`caseId + repetition`只能出现一次。

每条记录必须保存本地`requestId`、开始/结束时间、端到端延迟、输入/输出Token、成本，以及0至2次Provider尝试。可准入案例必须有模型尝试；服务端不准入案例必须是0次模型调用、0 Token、0模型成本。

每次Provider尝试记录：

- 顺序号`attempt`；
- `outcome=response / timeout / provider_error`；
- `providerRequestId`和该次延迟；
- 只有`response`保存完整`rawText`，错误尝试不得伪造模型输出。

## 4. 校验与落盘

```bash
pnpm benchmark:t001:b2:validate <raw-batch.json>
```

校验器会为每条记录重新构建冻结的`RideAnalysisContext`和`AnalysisEligibility`，再通过`runRideAnalysis`重放已记录尝试。只有54个槽位和所有必需元数据完整、没有额外或未消费的尝试时，才以`flag=wx`写入`eval/runs/<batchId>.json`；已有同名RUN不会被覆盖。

以下情况拒绝落盘：

- 模型ID、区域、参数、Token、成本或延迟未记录；
- 槽位缺失、重复，或request ID重复；
- 可准入案例没有模型尝试，或不可准入案例调用了模型；
- 首次有效后仍记录第二次调用，或修复所需的第二次响应缺失；
- 固定Schema、上下文/准入/特征规则、Prompt、Service、Workflow、Few-shot、B0或输入集摘要不一致；
- `sourceCommit`缺失或不是完整40位小写Git SHA。

## 5. 后续评分

合法导入后，先汇总Schema、事实/数字、能力、安全和降级硬门，再交由两名评审盲评事实忠实、洞察价值、行动性、易懂性、语气与不确定性。没有两名评审结果前，不能填写综合质量、相对B0洞察增量或G1结论。
