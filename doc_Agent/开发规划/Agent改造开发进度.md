# 骑行伙伴自主 Agent 改造 · 开发进度

> 本文件是 Agent 改造专项的**当前执行事实源**；所有开发项在用户明确验收前不得标记为 `Done`。
> 设计基线：[Agent 开发规划（粗）](VIBE_CODING_Agent_开发规划.md) · [AGT-A 工作项规划（细）](AGT-A_意图路由v0.4_工作项规划.md) · [需求分析](../2026-10-23_骑行伙伴自主Agent改造_需求分析.md)。
> 继承上下文：m6 工作树（V2.1 开发进度）。

## 维护规则

- 任务实施前读取本文件当前任务卡、对应细规划章节及必要的源码；发现范围/架构/风险变化时同步记录。
- 自检通过后进入 `Review`：**在本文件对应工作项下写验收汇报**（含验证证据、预览入口、用户检查清单），等待用户确认期间不开始下一项计划任务。
- 用户明确验收后追加 `Done` 完成记录并更新里程碑看板；沉默或自动化通过都不算用户验收。
- 状态值：`Backlog / Ready / In Progress / Review / Blocked / Done / Paused`。
- 评测制度：动评估资产或口径 → 全新 Run；真实模型调用须用户授权。

## 1. 当前快照

| 项目 | 当前值 |
|---|---|
| 当前里程碑 | **AGT-A 意图路由 v0.4 + Provider 迁移**（7 工作项 A0~A6，D-A1~A6 全部拍板） |
| 当前主任务 | `AGT-A0` Provider 迁移：**实施完成，`Review`（2026-10-23）**——等待用户验收 |
| 阻塞 | 无 |
| 唯一下一步 | 用户验收 `AGT-A0`（检查清单见任务卡）→ 启动 `AGT-A1` |

## 2. 里程碑看板

| 里程碑 | 状态 | 完成/总数 | 退出条件 | 证据 |
|---|---|---:|---|---|
| AGT-A 意图路由 v0.4 + Provider 迁移 | `Ready` | 0/7 | 标注集 v0.4 冻结 + 分类器 v0.4 + 对话链路迁硅基流动 + 全新 Run 全对 | 待启动 |
| AGT-B 只读工具面与循环扩展 | `Backlog` | 0/— | 粗规划 §4（细规划启动前产出） | — |
| AGT-C 生成层第一梯队 | `Backlog` | 0/— | 同上 | — |
| AGT-D 上下文与记忆三层 | `Backlog` | 0/— | 同上（前置 P8 隐私口径） | — |
| AGT-E 影子接入与阶段 1 放行 | `Backlog` | 0/— | 同上 | — |
| AGT-F 训练规划与写路径 | `Backlog` | 0/— | 同上（前置 P6） | — |
| AGT-G 训练监督与主动性 | `Backlog` | 0/— | 同上（前置 P3；依赖 F + D 第二层记忆） | — |

## 3. AGT-A 任务卡

### AGT-A0 · 对话链路 Provider 迁移：Coze → 硅基流动（D-A6）· `Review`（2026-10-23）

- 目标：分类器 + 主对话改用硅基流动 OpenAI 兼容 API（新客户端，沿用 `ChatProviderError` 错误码体系）；**Prompt v0.3/v0.1 原样迁入代码库为单一事实源**（语义变更留 A3）；env 切 `SILICONFLOW_*`（分类器默认 `deepseek-ai/DeepSeek-V4-Flash`、主对话默认 `deepseek-ai/DeepSeek-V3.2`）；骑后解读链路 `COZE_*` 不动。
- 进入条件：用户提供硅基流动 API key。退出条件：typecheck + provider 单测（全错误码路径）+ 启用态 smoke + 骑后链路零回归。
- **验收汇报（2026-10-23，供用户检查）**：
  - **变更清单**：新增 `src/chat/siliconflow-chat-provider.ts`（主对话直连）、`src/chat/chat-classifier-prompt.ts`（分类器 Prompt v0.3 迁入）、`src/chat/chat-workflow-prompt.ts`（主对话 Prompt v0.1.6 迁入）、`tests/siliconflow-chat-provider.test.ts`、`scripts/smoke-siliconflow-chat.ts`（可复现 smoke）；改造 `src/chat/chat-classifier.ts`（`CozeChatClassifierClient` → `SiliconFlowClassifierClient`，shadow/active 机制与全部导出签名不变）、`src/chat/chat-agent.ts`（`createChatProvider` 默认分派 siliconflow，`coze_workflow` 分支删除）、`tests/chat-classifier.test.ts`、`tests/chat-route.test.ts`、`tests/chat-agent.test.ts`、`scripts/eval-classifier-accuracy.ts`；删除 `src/chat/coze-chat-workflow.ts`、`tests/coze-chat-workflow.test.ts`；`.env.local` 切换（`CHAT_PROVIDER_KIND=siliconflow`、`COZE_CHAT_*` 注释归档、`SILICONFLOW_CHAT_MODEL_ID`/`SILICONFLOW_CLASSIFIER_MODEL_ID` 增配）。
  - **验证结果**：`tsc --noEmit` 通过；全量测试 **705/705 零回归**（含骑后解读链路全部测试——`COZE_*` 未动）；真实 smoke（`scripts/smoke-siliconflow-chat.ts`）：主对话 → 合法 `ride-chat-output-v0.1`；`FORCE_CLASSIFIER=1` 分类器 → "我总共骑了多少公里？" 正确判 `aggregate`。
  - **口径变化（需知悉）**：① demo 站对话模型从 Coze 豆包·2.0·lite 换为 DeepSeek-V3.2（回复风格差异属预期；M3 固定集 v0.5 历史结论不再适用新链路，重验挂 AGT-C）；② **A0~A5 中间态分类器回规则基线**（`CHAT_CLASSIFIER_ENABLED=false`——v0.3 prompt + 新模型组合未经评测，A5 全对后按 D-A5 启用），线上路由行为 = 规则层；③ 骑后解读链路实为早已硅基流动直连（`ride-model-provider-v2.ts`），本次零改动。
  - **用户检查清单**：本地起 dev（端口 3002）发一条骑行数据问题看回复质量；确认 `.env.local` 中分类器中间态安排（或要求保持启用）。
- 用户验收：（待确认）

### AGT-A1 · 路由与分类器合同扩展 · `Backlog`

- 目标：`ChatRoute` 12→16、分类器意图 11→16（4 任务簇 + **companion 拆分**，D-A4）、schema 双升级（routing v0.2 / classifier v0.2）、4 新路由占位模板、companion → 既有 `social` 路由；**移除启用态 P1 业务正则兜底（D-A2）**：分类器失败 → "模型暂不可用"降级模板 + 事件码，L0 快路径保留；**取消 shadow/active 双模式（D-A5）**：`CHAT_CLASSIFIER_MODE` 退役，启用即接管；未启用态规则基线零变化。
- 进入条件：细规划评审通过（D-A1~A5 已全部拍板）。退出条件：typecheck + 定向单测（含启用态失败分支）+ 全量零回归。
- 验收汇报：（进入 Review 后填写）

### AGT-A2 · 标注集 v0.4 编纂与冻结 · `Backlog`

- 目标：新增 ≥40 例（4 新意图各 ≥8 + companion ≥8，含边界对抗例）、旧例改标（水平评估例 + open_chat 闲聊例）、red-team 扩充 ≥2、manifest 重算冻结。
- 进入条件：A1 完成。退出条件：schema 校验全过 + 用户批准冻结。
- 验收汇报：（进入 Review 后填写）

### AGT-A3 · 分类器 Prompt v0.4 · `Backlog`

- 目标：意图定义与判断规则按边界迁移重写 + 5 个新意图 few-shot + Coze workflow 更新 + 本地副本同步。
- 进入条件：A2 冻结。退出条件：Coze 试运行符合 v0.2 schema、本地副本与线上逐字一致。
- 验收汇报：（进入 Review 后填写）

### AGT-A4 · 评测脚本适配 · `Backlog`

- 目标：`eval-classifier-accuracy.ts` / `preflight` 指向 v0.4 数据集，意图集从代码导入防漂移。
- 进入条件：A1 + A2 完成。退出条件：preflight 四项检查通过。
- 验收汇报：（进入 Review 后填写）

### AGT-A5 · 全新 Run 重评 · `Backlog`（需用户授权）

- 目标：v0.4 全量 ~78 例真实模型调用，bad case 回流循环直至全对；按 D-A1 与 v0.3 待授权 Run 合并。
- 进入条件：A3 + A4 完成 + 用户授权。退出条件：全量全对（硬门 ≥0.95 + red-team 零失误为底线）+ run 报告归档。
- 验收汇报：（进入 Review 后填写）

### AGT-A6 · 里程碑收口 · `Backlog`

- 目标：重评报告归档 `doc_Agent/`、粗规划状态更新、里程碑计数、验收汇报收口。
- 进入条件：A1~A5 全部 Done。退出条件：用户验收 AGT-A 全部工作项。
- 验收汇报：（进入 Review 后填写）

## 4. 已完成里程碑

（暂无）
