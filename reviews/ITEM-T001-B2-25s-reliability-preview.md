# ITEM-T001｜25秒同步等待受限可靠性复测范围预览

## 1. 状态

`READY_FOR_PREVIEW`：已完成25秒运行时适配和本地验证；尚未执行扣子零调用预检或真实调用，等待用户确认本受限范围。

## 2. 最小充分审查卡

| 来源 | 定向范围 | 结论 |
|---|---|---|
| 项目台账 | `current-status.md`、`DEC-069`、`LOG-20260825-156` | Demo当前同步等待为`25000ms`；历史15秒证据不改写；不判断G1 |
| 运行时合同 | `eval/t001-b2-run-protocol.md`、`src/eval/t001-b2-benchmark.ts` | 受限批次必须显式`executionScope`，逐槽保留请求、尝试、Token、延迟和原始输出 |
| 既有复测 | `RUN-20260825-918`、`ITEM-T001-B2-original-prompt-reliability-preview.md` | 同一4槽是已验证的最小诊断范围；`006/011`为15秒超时样本，`018`为严格零调用样本 |
| 实现 | `src/ai/coze-workflow-client.ts`、`scripts/run-t001-b2-coze-api.ts` | 上限支持25秒；历史15秒默认仍可复现；25秒批次不写入Prompt A/B实验字段 |

## 3. 冻结配置

- Prompt：原版 `v3.1.2`，不修改。
- Workflow：`ride_analysis_v2` / `7676429753852018707` / 当前扣子测试版本 `v0.0.2`。
- Service：`ride-analysis-service-v1.5`；输入投影：`ride-analysis-model-context-projection-v0.1`。
- Few-shot：`disabled`；输出：`ride-analysis-output-v0.3`。
- 输入集摘要：`5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671`。
- 同步等待：`25000ms`；精确模型ID、区域、首Token延迟和成本来源继续为`NOT_OBSERVABLE`。

## 4. 受限范围

共 `4` 槽，每个案例执行 `1` 次：

| 案例 | 目的 | 调用边界 |
|---|---|---|
| `RA-AUTO-001` | L1成功对照，确认25秒配置不损失基础事实和特征表达 | 最多首次生成+一次受限修复 |
| `RA-AUTO-006` | 15秒超时样本，观察延长等待是否恢复B2或进入修复 | 最多首次生成+一次受限修复 |
| `RA-AUTO-011` | 高体量多维样本，观察长尾等待下的可完成性 | 最多首次生成+一次受限修复 |
| `RA-AUTO-018` | 不准入路径回归 | 必须0 Provider调用并返回B0 |

## 5. 停止条件与非目标

出现 Prompt/Workflow/模型/输入摘要漂移、权限或配额异常、请求/Token/尝试证据无法保存、`RA-AUTO-018`发生Provider调用或任一安全停止，立即停止剩余槽位。每个可调用槽最多两次调用，不允许第三次调用。

本复测只比较 B2/B0、超时、修复、调用次数和 Claim 合同完整性；不扩大到21或54槽，不做人评，不计算性能/成本 Gate，不判断G1，不改写历史15秒结果。

## 6. 执行前置

1. 用户确认以上4槽范围和停止条件。
2. 将当前冻结实现提交到本地Git，使执行器的运行时文件提交门通过。
3. 使用 `--arm=A --scope=restricted --timeout-ms=25000 --preflight` 执行零调用预检；预检通过后再单独确认真实调用。
4. 真实批次使用同一命令去掉 `--preflight`，产生新的 `RUN-*` raw batch，再本地回放并更新评审记录。

## 7. 当前结论

25秒只是Demo同步等待预算，不是G1的8秒P95目标，也不代表生产就绪。该预览不改变Prompt方向，只验证延长等待是否能降低已知超时样本的B0降级。
