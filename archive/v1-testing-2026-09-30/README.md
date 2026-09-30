# V1 测试与评测证据归档

归档日期：2026-09-30

对应版本：V1 结束、V2 重构开始前

V1 文档归档提交：`8fc0074`（`docs: archive V1 project documents`）

## 归档原则

本目录保存 V1 已完成、已取消或已被后续方案取代的测试与 AI 评测证据。文件均从原位置原样迁移，不改写 Run 内容、评分结果、截图或用户验收记录。

以下资产继续保留在活跃目录，不属于本次归档：

- `tests/`：V2 必须继承的自动化回归安全网；
- `test-data/`：仍被测试和 Demo 使用的 FIT/GPX 样本；
- `eval/advanced-interpretation-v0.1/`：现有 preflight 仍读取的冻结固定集；
- `eval/ride-interpretation-v0.4-candidate/`：现有候选链测试、导出和 preflight 仍读取的 fixture、manifest 与稳定性计划；
- `eval/ride-chat-v0.1/`、`eval/ride-chat-classifier-v0.1/` 和 `eval/ride-chat-cases-v0.1.jsonl`：现有聊天固定集与分类器回归资产；
- `eval/ride-analysis-cases-v0.3-migration.json`：自动回归仍验证的迁移清单。

## 内容清单

| 归档内容 | 原路径 | 归档路径 | 说明 |
|---|---|---|---|
| 机器运行记录与截图 | `eval/runs/` | `eval/runs/` | V1 Run JSON、Smoke、Targeted、Formal、Chat、Classifier 和证据截图；只读，不续跑、不覆盖 |
| 人工评审材料 | `eval/human-review/` | `eval/human-review/` | T001/T002 匿名包、评分表、评分键和汇总结论 |
| 已取消用户测试 | `eval/user-testing/` | `eval/user-testing/` | T017 的观察表、评分表和运行记录模板；V1 已取消，不继续执行 |
| V1 评测长报告 | `eval/benchmark-report.md` | `eval/benchmark-report.md` | V1 基准、运行叙事与结论索引 |
| V1 混合评测来源集 | `eval/ai-cycling-eval-cases.jsonl` | `eval/ai-cycling-eval-cases.jsonl` | 30 条旧混合集合，仅作来源追溯 |
| T001 一次性计划与清单 | `eval/t001-*` | `eval/t001-*` | 已闭环的 B2、Prompt A/B 计划、协议与 manifest |
| T001 一次性脚本 | `scripts/*t001*` | `scripts/` | 生成或汇总历史人工评审包；脚本内旧路径反映 V1 当时结构，不再作为 V2 命令运行 |
| 临时候选审查说明 | 仓库根目录 | `superseded-plans/` | 已被正式 V1 文档和迁移门禁取代的临时审查材料 |

本次归档共迁移 196 个 V1 文件，其中机器运行记录 158 个、人工评审材料 25 个、用户测试材料 3 个；其余为 V1 报告、清单、一次性脚本和临时审查说明。连同本索引，归档目录当前共 197 个文件。

## V1 基线

归档前于 2026-09-30 执行：

```text
pnpm verify
typecheck: PASS
tests: 466/466 PASS
```

这表示归档发生前的工作树仍能通过 V1 的类型检查与全量自动化回归。该结果是工程自检证据，不代表新增的 V2 需求已经验收。

## V2 使用规则

1. 新的机器运行写入活跃的 `eval/runs/`，不得写入本归档。
2. 新的人工评审和用户测试分别写入活跃的 `eval/human-review/`、`eval/user-testing/`。
3. V2 如需复用 V1 Run，应只读引用本目录中的具体 Run ID；不得修改旧文件。
4. V2 建立替代测试前，不删除活跃 `tests/`、fixture、manifest 或固定集。
5. `doc_V1/` 内的旧相对链接记录的是 V1 当时目录结构；查找对应证据时，按本页映射在本归档下定位。

## 恢复与追溯

Git 会把大多数文件识别为重命名，文件历史可通过 `git log --follow -- <路径>` 追溯。若确需复现实验，优先从相关 Git 提交建立临时工作树，不要把归档证据直接移动回活跃目录或覆盖现有 V2 结果。
