# AI Cycler 基线索引

**当前项目代码基线为 `d8bc8bfdd7c695b3eb089136843703725bc79488`**，所属分支 `m7-main`，登记于 2026-11-21。该提交包含提示词优化、相应工具与校验逻辑，以及回归用例。[上下文工程与工具设计](AI_Cycler_上下文工程与工具设计.md)

## 本版验证与运行配置

- **工程验证。** `pnpm verify` 通过类型检查及全部 939 项自动化测试，`pnpm build` 完成生产构建。本轮使用测试数据和模拟提供方检查真实代码路径，线上模型效果与 Coze 发布内容未实测。[项目命令](../package.json) · [同步用例](../tests/onelap-sync.test.ts) · [训练计划用例](../tests/scn04-training-plan.test.ts) · [解读用例](../tests/ride-output-validator-v2.test.ts)
- **聊天与训练计划。** 主提示词为 `ride-chat-prompt-v0.7.0`，边界分类器为 `ride-chat-classifier-prompt-v0.5.0`，首次排期为 `training-plan-generation-v1.1`。主对话与首版计划生成默认使用的硅基流动模型是 `deepseek-ai/DeepSeek-V3.2`，分类器默认模型为 `deepseek-ai/DeepSeek-V4-Flash`。可按环境配置覆盖；实际模型调用会记录所选模型及提示词标识。[主提示词](../src/chat/chat-workflow-prompt.ts) · [分类器](../src/chat/chat-classifier.ts) · [首版计划生成](../src/training/plan-generation.ts) · [配置示例](../.env.example)
- **骑后深度解读。** 默认走 V1 Coze 工作流。仓库示例为 `ride_analysis_v3 / v0.0.11`、提示词 `v0.4.14`，实际请求采用部署配置。V2 使用 `ride-prompt-v2.9.0` 和修复提示词 `ride-repair-prompt-v2.3.0`，两者共用数据有限时的写作规则。[引擎选择与版本](../app/api/ride-analysis/route.ts) · [V2 版本信息](../src/ai/ride-interpretation-service-v2.ts)
- **骑行接入。** 支持 FIT／GPX 文件导入；顽鹿真实手动同步由试点配置和当前账号共同决定。其他账号和平台展示对应模拟入口。[同步能力判断](../src/sync/onelap-access.ts) · [同步技术方案](Cycler_第三方骑行自动同步技术方案.md)

## 历史代码基线

2026-11-20 选定的代码起点为 `823c63f65479e6feaafae18a2df6be6b6b416c8d`，当时通过 936 项自动化测试。此条保留供历史版本对照。

## 建立首轮测评基线

先根据当前功能确定用例、预期行为和评分规则，再在基线提交上运行。将用例及规则版本、实际运行配置、逐项结果和已知失败随 Run 一起记录。后续版本用同一口径复测。调整评分规则或用例后，可在原代码提交上重跑以建立同口径对照。[新测评目录](../eval/README.md)

历史测评保留了当时的用例、判分和结果，可用于查找已知失败、挑选待重新标注的用例，以及复查当时的表现。[历史测评索引](../archive/pre-cycler-baseline-2026-11-20/README.md)
