# ITEM-T001｜Prompt v3.1.2 Compact Candidate 审查

## 1. 状态

`ARCHIVED_NOT_SELECTED`：候选曾以独立测试 Workflow 完成同条件 A/B；用户决定继续使用原版 v3.1.2。候选不覆盖 v3.1.2、不再作为接入候选，保留其资产和运行结果作为失败学习证据。

## 2. 最小充分审查卡

| 来源 | 定向范围 | 结论 |
|---|---|---|
| 当前 Prompt | `prompts/cycling-buddy-ride-analysis-v3.1.2.md` 全部 System/User Prompt | 结构、输出合同和四条解读质量规则保持为基线 |
| 输出合同 | `src/ai/ride-analysis-output-v03.ts` | 字段、Claim校验、数字换算、文本长度和降级规则不改 |
| 真实运行 | `RUN-20260825-756` 7个成功B2槽 | 结构回放无失败；输出主要存在可接受的事实/Claim重复，未发现需要改Schema的缺陷 |
| 项目边界 | `DEC-060/067`、T001 B2协议 | 不改变历史限制、强度/体能边界、平台不可观测字段或评分边界 |

## 3. 压缩范围与长度结果

候选文件：[cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md](../prompts/cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md)。

| 项目 | v3.1.2 基线 | Compact Candidate | 变化 |
|---|---:|---:|---:|
| 字节数 | 14,147 | 8,394 | -5,753（约 -40.7%） |
| 行数 | 92 | 82 | -10 |
| System Prompt结构 | 角色/可信边界/四条规则/生成方法/安全/输出合同 | 保持相同顺序 | 不变 |
| 输出Schema | `ride-analysis-output-v0.3` | `ride-analysis-output-v0.3` | 不变 |
| 模型、变量、Few-shot、Workflow | 不变 | 未接入 | 不变 |

主要合并的是：事实与解释边界、历史不可比规则、强度/体能/分类禁区、统计量解释、首末口径、limitations、日期/场景和shareCopy边界。删除的是重复表述，不是安全约束。

## 4. 输出优化评估

### 4.1 当前输出没有必要改Schema

`RUN-20260825-756` 的 21/21 槽合同回放通过；7个成功B2输出均保留合法字段、维度和Claim引用。`shareCopy`固定3条、`nextAction`对象、`dimensions`结构和Claim追溯仍是产品合同的一部分，不建议通过删字段来节省输出。

### 4.2 可优化的生成行为

1. `overallAssessment`与`dimensions`可以共享事实，但overall只保留对整体结论必要的1—3组Claim；候选Prompt明确要求每个字段使用最小支撑Claim集合。
2. 每个dimension尽量一句话，overall控制在1—2句话；这减少重复事实和修复触发，不改变中文表达目标。
3. limitations只保留影响本次理解的边界；通用行动继续保留`general`，不伪装为个性化建议。
4. 输出长度限制显式对齐现有校验器：headline 20、overall 240、dimension 160、event 120、action 120、limitation 120、shareCopy 50字以内。

### 4.3 真实样本观察

- 7个成功B2输出的 JSON 平均约 `1,390` 字符；overall 文本平均 `81` 字，dimension文本合计平均 `109` 字。
- overall平均引用约 `4.9` 个Claim；这是最有希望通过“最小支撑Claim集合”减少的部分，但不能为了短而漏掉整体评价实际提及的主题。
- 9次模型响应（含修复前响应）的输出Token平均约 `877`；这只是本次小样本观察，不外推到模型延迟或成本。
- 现有输出没有出现必须通过Schema变更解决的结构问题；是否更短、更易读，需要候选Prompt的同条件模型对照运行才能确认。

## 5. 验证与接入边界

- 本次只生成候选和审查记录；没有修改 `prompts/cycling-buddy-ride-analysis-v3.1.2.md`，没有修改运行时 Prompt 版本，也没有更新扣子 v0.0.2。
- 候选接入前必须完成：本地 Prompt 资产/合同检查、至少一组 L1/L2/L3 同输入对照、Claim完整性和人工可读性比较；不能仅凭字节数减少就替换生产候选。
- 实际验证与归档：同一 7 个受限案例的 A/B 已完成。Compact Candidate 的 B2 成功率为 `2/21`，低于原版 A 的 `7/21`；B0 降级为 `19/21`，高于 A 的 `14/21`；人工洞察价值也未提高。详见 [A/B 结果评审](ITEM-T001-prompt-ab-preview-review.md)；后续不再发布或接入此候选。
