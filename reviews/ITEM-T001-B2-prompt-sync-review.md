# ITEM-T001-B2｜Prompt 同步与受限复测范围预览

## 1. 状态

`ACCEPTED`：扣子 v0.0.2 受限复测的原始批次和本地回放均通过。用户已确认原版 Prompt v3.1.2 保持为当前 Demo 候选；该运行作为后续可靠性修复的对照基线。

## 2. 最小充分审查卡

| 来源 | 定向章节/证据 | 结论 |
|---|---|---|
| 项目台账 | `current-status.md` 当前 ITEM、版本矩阵；`DEC-066/067` | Demo 继续用扣子测试环境验证；平台不可观测字段记为 `NOT_OBSERVABLE`，性能/成本保持 `NOT_SCORED` |
| 评测合同 | `eval/t001-b2-run-protocol.md`、`t001-b2-benchmark-manifest.json` | 原始批次合同仍是 v0.3；每槽保存请求、延迟、Token、尝试和降级证据 |
| Prompt/修复证据 | `ITEM-T001-B2-runtime-remediation-review.md` 第6.1–6.5节、扣子发布截图 | v0.0.2 包含四条新增解读质量规则；v0.0.1 只作历史控制 |
| 实现/验证 | `scripts/run-t001-b2-coze-api.ts`、`pnpm verify`、`pnpm build` | 执行器已校验 v0.0.2；本地 196/196、构建、交付校验均通过 |

## 3. 冻结配置与预检证据

- Workflow：`ride_analysis_v2` / `7676429753852018707` / 扣子平台测试版本 `v0.0.2`。
- 内部标签：`ride_analysis_v2-dev.15`；Prompt `3.1.2`；Service `ride-analysis-service-v1.5`；Few-shot `disabled`。
- 输入集摘要：`5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671`。
- 源码提交：`c3e8c34afd7ce298446f36ff8cb4fc825a673f9f`；超时上限 `15000ms`。
- PAT：已配置但只记录 `PRESENT_REDACTED`；模型 ID、区域、首 Token 延迟和成本来源仍为 `NOT_OBSERVABLE`。
- 零调用预检：`PASS`，外部调用 `0`；随后真实受限批次独立记录为 `RUN-20260825-756`。

## 4. 推荐受限复测范围

保持每个案例 3 次，合计 `7 × 3 = 21` 个槽位；不执行其余 33 个槽位。

| 案例 | 覆盖目的 | 预期调用边界 |
|---|---|---|
| `RA-AUTO-001` | L1 基线；速度 CV、首末变化、爬升事实与无传感器限制 | 3 次可调用 |
| `RA-AUTO-006` | L2 心率/踏频；多维整体评价与通用行动区分 | 3 次可调用 |
| `RA-AUTO-011` | L3 全维度；整体评价只整合必要维度，避免纯事实清单 | 3 次可调用 |
| `RA-AUTO-005` | 历史不可比；允许 limitations 说明历史不足，不生成 history 维度 | 3 次可调用 |
| `RA-AUTO-013` | 历史样本不足；验证首次/不足历史静默处理 | 3 次可调用 |
| `RA-AUTO-010` | 室内仅心率；验证 B0 能力修复后不再因无距离整体 rejected | 3 次可调用 |
| `RA-AUTO-018` | 不一致记录；验证不准入时严格 0 模型调用并走 B0 | 0 次调用，3 个 B0 槽 |

每个可调用槽最多首次生成加一次受限修复；超时或修复失败立即 B0，不允许第三次调用。所有平台未暴露字段写 `NOT_OBSERVABLE`，不得估算。

## 5. 停止条件与非目标

出现 Workflow/Prompt/输入摘要漂移、权限或配额异常、请求/Token/尝试证据无法保存、非预期生产调用，立即停止剩余槽位。此复测不运行 B1/B3，不做人评，不计算性能/成本 Gate，不判断 G1；合法导入也只表示 `validationStatus=PASS / benchmarkStatus=NOT_SCORED`。

## 6. 实际运行与回放

- 原始批次：[RUN-20260825-756-raw.json](../eval/runs/RUN-20260825-756-raw.json)；回放结果：[RUN-20260825-756.json](../eval/runs/RUN-20260825-756.json)。
- 21/21 槽接收通过，`validationStatus=PASS`、`benchmarkStatus=NOT_SCORED`；B2 `7`、B0 `14`、安全停止 `0`。
- Provider 调用 `21`，总 Token `101712`，P50/P95 `15002.545ms / 20334.534ms`，成本 `NOT_OBSERVABLE`；`RA-AUTO-018#1..#3` 为严格 0 调用。
- 结果只说明 v0.0.2 在受限样本上的真实运行和合同回放可追溯；不外推完整54槽降级率、不判断 Prompt 质量、性能/成本 Gate 或 G1。

## 7. 归档边界

本运行证明受限样本可按合同回放，不代表可靠性、性能或 G1 通过。后续只在原版 v3.1.2 上处理 15 秒超时与 B0 降级问题；不以 Compact Candidate 替代本基线。
