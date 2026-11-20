# AI Cycler 基线前归档

2026-11-20 将此前仍位于工作目录的测评和项目资料归档。历史文件沿用原来的目录布局，方便按旧报告中的路径查找。

## 历史测评与项目资料

- [旧测评目录](eval/)包含方案、固定集、fixture、人工评审、用户测试材料和 [85 份 Run JSON](eval/runs/)。
- [旧测评脚本](scripts/)包含各阶段的 preflight、真实模型 runner、导出与诊断脚本。[旧版解读 Prompt](prompts/)保留候选迭代过程。[一次性输出](output/)包含诊断、Coze 样例、冻结清单引用的 L3 输入，以及与脚本配套的 V2.1 原始结果。[L0–L6 运行产物](L0-L6-运行产物/)记录一次本地数据处理过程。
- [早期产品规划](ai-cycling-amateur-plan.md)、[项目笔记和截图](notes/)、[旧回归报告](reviews/)、[交付 Skill 源码](skill-source/orchestrate-ai-product-delivery/SKILL.md)和 [WorkBuddy 历史记录](.workbuddy/)保留早期设计与交付证据。
- [V1 测评归档](../v1-testing-2026-09-30/README.md)保留此前已归档的 V1 数据和证据。[V1 到 Agent 的项目文档](../../doc_m7_archive/)包含阶段规划、技术方案和进度记录。

## 历史对照与失败归因

- AGT-A 分类器重评保留[首轮](eval/runs/AEVAL-CLASSIFIER-20261023233337.json)与[当时的放行 Run](eval/runs/AEVAL-CLASSIFIER-20261023233648.json)。[分类器重评报告](../../doc_m7_archive/doc_Agent/archive/AGT-A_意图路由v0.4_重评报告.md)
- AGT-B 保留[工具编排正式对照](eval/runs/AEVAL-TOOL-ORCH-2026-10-26T1405.json)、[边界集正式对照](eval/runs/AEVAL-CHAT-BOUNDARY-2026-10-26T1416.json)与 [M3 对话固定集补跑](eval/runs/AEVAL-M3-CHAT-20261026-001.json)。[工具面评测报告](../../doc_m7_archive/doc_Agent/archive/AGT-B_只读工具面_评测报告.md)
- 骑行解读保留 [V2.1 R01 报告](output/v21-eval/EVAL-V21-R01-20261008/report.md)与 [R02 报告](output/v21-eval/EVAL-V21-R02-20261008/report.md)，含失败归因和逐次原始记录。[R02 归因分析](../../doc_m7_archive/doc_V2.1/RIDE-AI-V21-R02-失败率量化归因分析.md)

## 复现旧命令

旧脚本使用当时的仓库根目录布局。需要复查命令时，从仓库根目录将归档前提交导出到独立目录，再在该目录安装锁定依赖。

```bash
replay_dir=$(mktemp -d)
git archive 823c63f65479e6feaafae18a2df6be6b6b416c8d | tar -x -C "$replay_dir"
cd "$replay_dir"
pnpm install --frozen-lockfile
```

例如在该目录运行 `node scripts/eval-v21-repair-failure-rate.ts --report`，可从已有 R02 原始结果重新生成报告。涉及真实模型或骑行记录的旧命令还需要相应环境配置和数据。

骑行解读候选迁移清单中的 Prompt 和 Coze 指南哈希在归档前提交上已与同名文件有出入。清单和历史 Run 保留原值，复查时按该次 Run 的版本记录定位材料。[候选迁移清单](eval/ride-interpretation-v0.4-candidate/manifest.json)

[AI Cycler 当前基线](../../doc_m7_main/AI_Cycler_基线索引.md)
