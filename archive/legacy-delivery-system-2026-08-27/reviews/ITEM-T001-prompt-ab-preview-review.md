# ITEM-T001｜Prompt v3.1.2 与 Compact Candidate A/B 范围预览

## 1. 状态

`ACCEPTED`：A/B 真实批次、合同回放和两名匿名人工评审均已完成。用户已决定保留原版 Prompt v3.1.2；Compact Candidate 归档为失败学习证据。

## 2. 最小充分审查卡

| 来源 | 定向范围 | 结论 |
|---|---|---|
| 项目台账 | `current-status.md` 当前工作项、`DEC-060/061/062/067` | 允许事实驱动的合理解读；不可观测平台字段不估算；不以本实验判断 G1 |
| 研发指南 | Prompt/评测/模型选择章节（8、13、14） | Prompt、模型、Workflow和输入必须独立版本化；同条件比较，先过硬门再看质量与稳定性 |
| 路线图 | T1/B2、G1/W4和回滚条款 | 这是受限诊断实验，不是发布或G1 Gate；人工质量评分必须独立盲评 |
| A 运行证据 | `RUN-20260825-756` | 7案例×3次、21槽，B2 7、B0 14，已完成合同回放，不重复运行 |
| 候选 Prompt | `cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md`、候选审查第3–5节 | 只验证压缩后的表达约束是否改善运行可靠性；不覆盖 v3.1.2、不修改输出 Schema |

## 3. 冻结 A/B 条件

| 条件 | A | B |
|---|---|---|
| Prompt 资产 | `prompts/cycling-buddy-ride-analysis-v3.1.2.md` | `prompts/cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md` |
| 扣子版本 | `v0.0.2`，复用 `RUN-20260825-756` | `ride_analysis_v2_Cam_Candidate` / `7677880281836503082` / `v0.0.1` |
| 案例/重复 | 同一 7 条案例，各 3 次 | 同一 7 条案例，各 3 次 |
| 输入摘要 | `5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671` | 必须相同 |
| 模型/超时 | 同一模型（平台 ID 不可观测）/ `15000ms` | 必须相同 |
| Few-shot/调用序列 | disabled；串行；每槽最多首次+1次修复 | 必须相同 |
| `RA-AUTO-018` | 严格 0 Provider 调用并走 B0 | 严格 0 Provider 调用并走 B0 |

机器可读合同：[eval/t001-prompt-ab-manifest-v0.1.json](../eval/t001-prompt-ab-manifest-v0.1.json)。

## 4. 比较指标

自动汇总：B2成功率、首轮合同成功率、超时槽位率、修复触发率、修复成功率、B0降级率、Provider调用次数和Token数。

Claim完整性先分为可自动核验的合同/引用指标：合同通过率、未知Claim引用数、未使用的允许Claim数、overall平均引用Claim数。它们不能替代人工判断“是否引用了对整体结论真正必要的证据”。人工可读性、洞察价值和行动区分保持 `NOT_SCORED`，B 组完成后生成匿名 A/B 盲评包，由两名评审评分。

比较脚本：[scripts/compare-t001-prompt-ab.ts](../scripts/compare-t001-prompt-ab.ts)。

## 5. 执行入口与安全约束

A 只允许显式绑定 `ride_analysis_v2 / 7676429753852018707 / v0.0.2`；B 必须显式传入新 Workflow 名称、ID和平台版本：

```text
pnpm benchmark:t001:b2:coze -- --preflight --scope=restricted --arm=B \
  --workflow-name=<B工作流名称> --workflow-id=<B工作流ID> --workflow-version=<B平台版本>
```

预检必须显示 `arm=B`、候选 Prompt 资产、同一输入摘要、`timeoutMs=15000` 和 `externalCalls=0`。预检通过后，仍需用户单独确认才运行 B 的 21 槽真实批次。执行器拒绝把 B 指向 A 的三元组，拒绝超出15秒上限，并在原始批次写入实验臂元数据。本轮执行器/比较器冻结提交为 `535234d`；A 历史运行仍保留其原始 `sourceCommit`，不回写旧证据。

停止条件：Prompt/Workflow/输入摘要/模型或超时预算漂移；任意安全停止或敏感信息泄露；证据无法逐槽保存；`RA-AUTO-018`发生 Provider 调用；或误触生产环境。停止后保留已完成槽位，不补跑或混入其他批次。

## 6. 未完成与用户操作

用户已提供 B 的扣子配置截图：模型显示名“豆包·2.0-lite”、Chat API、重复语句惩罚 `0.00`、最大回复长度 `2400`、深度思考关闭；Workflow 为 `ride_analysis_v2_Cam_Candidate` / `7677880281836503082` / `v0.0.1`。B 零调用预检已通过：输入摘要一致、候选 Prompt 文件存在、超时 `15000ms`、`externalCalls=0`。截图可证明显示配置与 A 一致，但精确模型 ID仍为 `NOT_OBSERVABLE`。

## 7. 真实 B 批次与机器比较

- B 原始批次：[RUN-20260825-960-raw.json](../eval/runs/RUN-20260825-960-raw.json)；回放：[RUN-20260825-960.json](../eval/runs/RUN-20260825-960.json)。
- 回放：`validationStatus=PASS`、`benchmarkStatus=NOT_SCORED`；21/21槽，安全停止0；`RA-AUTO-018#1..#3`严格0调用。
- B 结果：B2 `2/21 (9.52%)`、B0 `19/21 (90.48%)`、首轮合同成功 `0/21`、修复触发 `8/21`、修复成功 `2/8`、Provider调用 `26`、总Token `111825`、P50/P95=`15008.962/24975.913ms`、成本 `NOT_OBSERVABLE`。
- A/B比较：[T001-PROMPT-AB-comparison-v0.1.json](../eval/runs/T001-PROMPT-AB-comparison-v0.1.json)。相对 A，B2 成功率 `-23.81` 个百分点，超时槽位率 `+4.76` 个百分点，修复触发率 `+23.81` 个百分点，B0降级率 `+23.81` 个百分点，调用 `+5`，Token `+10113`。
- Claim引用层：两组合同有效B2输出均无未知Claim引用；B平均overall引用5.00个Claim，A为4.86个。该统计不等同于语义完整性结论。

## 8. 匿名人工评审

已按同一案例、同一重复次数生成 A/B 匿名配对包，每包21个样本，变体顺序按评审人独立打乱；不暴露 Workflow、RUN、案例来源或 A/B 标签。两名评审分别使用：

- [评审A匿名包](../eval/human-review/T001-PROMPT-AB-blind-reviewer-A-v0.1.json) / [评审A评分表](../eval/human-review/T001-PROMPT-AB-blind-score-sheet-A-v0.1.md)
- [评审B匿名包](../eval/human-review/T001-PROMPT-AB-blind-reviewer-B-v0.1.json) / [评审B评分表](../eval/human-review/T001-PROMPT-AB-blind-score-sheet-B-v0.1.md)

## 9. 人工评审结果

结果：[T001-PROMPT-AB-human-review-result-v0.1.md](../eval/human-review/T001-PROMPT-AB-human-review-result-v0.1.md) / [JSON](../eval/human-review/T001-PROMPT-AB-human-review-result-v0.1.json)。两名评审均完成 `21/21`；硬门备注 `0`；分数分歧达到2分的项目 `3` 项。

| 维度 | A | B | A-B |
|---|---:|---:|---:|
| 事实忠实 | 4.405 | 4.310 | +0.095 |
| 洞察价值 | 2.214 | 2.000 | +0.214 |
| 行动性 | 3.000 | 3.000 | 0 |
| 易懂性 | 3.976 | 4.000 | -0.024 |
| 语气 | 4.000 | 4.000 | 0 |
| 不确定性 | 4.071 | 4.071 | 0 |

更易读偏好票：A `7`、B `5`、相同 `30`。评审意见与机器结果方向一致：B 在多维可用特征场景更容易退化为事实罗列；同时 B 的 B2 成功率和降级率显著恶化。由于样本中大量槽位最终输出相同或接近的 B0，偏好票差异有限，不能把人工均值外推为总体质量提升。

## 10. 结论与归档

Compact Candidate 不满足继续作为 A 的替换候选：机器可靠性明显下降，人工洞察价值也略低于 A。用户已决定保留 A（Prompt v3.1.2 + 扣子 v0.0.2）作为当前 Demo 候选；B 作为失败学习证据归档，不发布、不接入、不替换 A、不判断 G1。后续回到原 T001 链路，优先处理原版在 15 秒预算下的超时/降级问题，不继续压缩 Prompt。

## 11. 验收边界

本切片完成不代表 A 已达到 B2 或 G1 门槛，也不修改输出 Schema、A 历史结果或生产配置。`DEC-068`只确定当前 Demo Prompt 候选，后续对运行时可靠性的任何修复均须独立冻结、验证和预览。
