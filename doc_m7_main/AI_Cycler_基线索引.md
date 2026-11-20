# AI Cycler 基线索引

2026-11-20 选定提交 `823c63f65479e6feaafae18a2df6be6b6b416c8d`（`m7-main`）作为 AI Cycler 后续功能和测评迭代的代码起点。新方案下的首轮测评待建立。

## 代码与运行配置

- 技术入口。产品代码在 `app/` 和 `src/`，自动化测试通过 `pnpm verify` 运行，测试样例在 `tests/fixtures/` 和 `test-data/`。归档后类型检查通过，936 项自动化测试全部通过。[项目命令](../package.json)
- 对话。代码内的主 Prompt 为 `ride-chat-prompt-v0.6.3`，分类器 Prompt 为 `ride-chat-classifier-prompt-v0.5.0`。首轮测评应记录实际启用的提供方和模型。[主 Prompt](../src/chat/chat-workflow-prompt.ts) · [分类器 Prompt](../src/chat/chat-classifier-prompt.ts) · [配置示例](../.env.example)
- 骑行解读。API 在未配置引擎且请求未指定引擎时默认使用 V1 Coze 链路。V2 使用 `ride-prompt-v2.8.4`。测评时记录实际走的引擎、工作流或模型版本。[解读路由](../app/api/ride-analysis/route.ts) · [V2 Prompt](../src/ai/ride-prompt-v2.ts)
- 骑行同步。当前实现包含默认关闭的顽鹿手动同步试验。同步场景的测评应注明实际使用的模拟或真实路径。[同步技术方案](Cycler_第三方骑行自动同步技术方案.md)

## 建立首轮测评基线

先根据当前功能确定用例、预期行为和评分规则，再在基线提交上运行。将用例及规则版本、实际运行配置、逐项结果和已知失败随 Run 一起记录。后续版本用同一口径复测。调整评分规则或用例后，可在原代码提交上重跑以建立同口径对照。[新测评目录](../eval/README.md)

历史测评保留了当时的用例、判分和结果，可用于查找已知失败、挑选待重新标注的用例，以及复查当时的表现。[历史测评索引](../archive/pre-cycler-baseline-2026-11-20/README.md)
