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
| 当前主任务 | `AGT-A2` 标注集 v0.4：**实施完成，`Review`（2026-10-23，commit 9cacb5f）**——等待抽检与冻结批准；`AGT-A3` Prompt v0.4 已实施并自检全过（`In Progress`，按串行评审纪律排队） |
| 阻塞 | 无（A2 的"用户批准冻结"、A5 的真实 Run 是授权门） |
| 唯一下一步 | 用户抽检 `eval/ride-chat-classifier-v0.4/CHANGES.md` 并**批准冻结** → `AGT-A4` 评测脚本适配 → `AGT-A5` 全新 Run（需授权） |

## 2. 里程碑看板

| 里程碑 | 状态 | 完成/总数 | 退出条件 | 证据 |
|---|---|---:|---|---|
| AGT-A 意图路由 v0.4 + Provider 迁移 | `In Progress` | 2/7 | 标注集 v0.4 冻结 + 分类器 v0.4 + 对话链路迁硅基流动 + 全新 Run 全对 | A0 Done（2026-10-23 用户验收；commits f769abe + 50ed2c1，705/705 + L2b 端到端验证）· A1 Done（2026-10-23 用户验收；commit 583280f，700/700） |
| AGT-B 只读工具面与循环扩展 | `Backlog` | 0/— | 粗规划 §4（细规划启动前产出） | — |
| AGT-C 生成层第一梯队 | `Backlog` | 0/— | 同上 | — |
| AGT-D 上下文与记忆三层 | `Backlog` | 0/— | 同上（前置 P8 隐私口径） | — |
| AGT-E 影子接入与阶段 1 放行 | `Backlog` | 0/— | 同上 | — |
| AGT-F 训练规划与写路径 | `Backlog` | 0/— | 同上（前置 P6） | — |
| AGT-G 训练监督与主动性 | `Backlog` | 0/— | 同上（前置 P3；依赖 F + D 第二层记忆） | — |

## 3. AGT-A 任务卡

### AGT-A0 · 对话链路 Provider 迁移：Coze → 硅基流动（D-A6）· `Done`（2026-10-23）

- 目标：分类器 + 主对话改用硅基流动 OpenAI 兼容 API（新客户端，沿用 `ChatProviderError` 错误码体系）；**Prompt v0.3/v0.1 原样迁入代码库为单一事实源**（语义变更留 A3）；env 切 `SILICONFLOW_*`（分类器默认 `deepseek-ai/DeepSeek-V4-Flash`、主对话默认 `deepseek-ai/DeepSeek-V3.2`）；骑后解读链路 `COZE_*` 不动。
- 进入条件：用户提供硅基流动 API key。退出条件：typecheck + provider 单测（全错误码路径）+ 启用态 smoke + 骑后链路零回归。
- **验收汇报（2026-10-23，供用户检查）**：
  - **变更清单**：新增 `src/chat/siliconflow-chat-provider.ts`（主对话直连）、`src/chat/chat-classifier-prompt.ts`（分类器 Prompt v0.3 迁入）、`src/chat/chat-workflow-prompt.ts`（主对话 Prompt v0.1.6 迁入）、`tests/siliconflow-chat-provider.test.ts`、`scripts/smoke-siliconflow-chat.ts`（可复现 smoke）；改造 `src/chat/chat-classifier.ts`（`CozeChatClassifierClient` → `SiliconFlowClassifierClient`，shadow/active 机制与全部导出签名不变）、`src/chat/chat-agent.ts`（`createChatProvider` 默认分派 siliconflow，`coze_workflow` 分支删除）、`tests/chat-classifier.test.ts`、`tests/chat-route.test.ts`、`tests/chat-agent.test.ts`、`scripts/eval-classifier-accuracy.ts`；删除 `src/chat/coze-chat-workflow.ts`、`tests/coze-chat-workflow.test.ts`；`.env.local` 切换（`CHAT_PROVIDER_KIND=siliconflow`、`COZE_CHAT_*` 注释归档、`SILICONFLOW_CHAT_MODEL_ID`/`SILICONFLOW_CLASSIFIER_MODEL_ID` 增配）。
  - **验证结果**：`tsc --noEmit` 通过；全量测试 **705/705 零回归**（含骑后解读链路全部测试——`COZE_*` 未动）；真实 smoke（`scripts/smoke-siliconflow-chat.ts`）：主对话 → 合法 `ride-chat-output-v0.1`；`FORCE_CLASSIFIER=1` 分类器 → "我总共骑了多少公里？" 正确判 `aggregate`。
- **用户验收实测（2026-10-23 浏览器）与修复**：① 用户旧 dev 进程（A0 前启动、env 旧快照）导致模型链路报"对话服务暂时不可用"——重启 dev（3002）解决；② **DeepSeek-V3.2 把 toolCatalog 的枚举候选列表照抄成数组**（`"mode": ["max"]`，豆包 lite 时代输出标量）→ L2b 首场景 `INVALID_TOOL_CALL`。修复 = Prompt v0.1.6 → **v0.1.7**（chat-workflow-prompt.ts 在 L2b 规则中加一句单选枚举澄清——迁移适配非语义变更），修复后端到端验证：autonomous_tools → find_ride → 模型叙事"距离最远的是2026年10月5日这次，距离为30.4公里"，`outputValidation accepted`、零修复轮、数据与演示记录一致。
  - **口径变化（需知悉）**：① demo 站对话模型从 Coze 豆包·2.0·lite 换为 DeepSeek-V3.2（回复风格差异属预期；M3 固定集 v0.5 历史结论不再适用新链路，重验挂 AGT-C）；② **A0~A5 中间态分类器回规则基线**（`CHAT_CLASSIFIER_ENABLED=false`——v0.3 prompt + 新模型组合未经评测，A5 全对后按 D-A5 启用），线上路由行为 = 规则层；③ 骑后解读链路实为早已硅基流动直连（`ride-model-provider-v2.ts`），本次零改动。
  - **用户检查清单**：本地起 dev（端口 3002）发一条骑行数据问题看回复质量；确认 `.env.local` 中分类器中间态安排（或要求保持启用）。
- 用户验收：（**已通过，2026-10-23 用户确认**——浏览器实测四类问法 + 服务端端到端 L2b 验证。`Done` 记录：A0 完成，含验收实测发现的 prompt v0.1.7 修复〔commit 50ed2c1〕。）

### AGT-A1 · 路由与分类器合同扩展 · `Done`（2026-10-23）

- 目标：`ChatRoute` 12→16、分类器意图 11→16（4 任务簇 + **companion 拆分**，D-A4）、schema 双升级（routing v0.2 / classifier v0.2）、4 新路由占位模板、companion → 既有 `social` 路由、**移除启用态 P1 业务正则兜底（D-A2）**：分类器失败 → "模型暂不可用"降级模板 + 事件码，L0 快路径保留；**取消 shadow/active 双模式（D-A5）**：`CHAT_CLASSIFIER_MODE` 退役，启用即接管；未启用态规则基线零变化。
- 进入条件：细规划评审通过（D-A1~A5 已全部拍板）。退出条件：typecheck + 定向单测（含启用态失败分支）+ 全量零回归。
- **验收汇报（2026-10-23，供用户检查）**：
  - **变更清单**：`chat-routing.ts`（v0.2：+4 路由/reasonCode/枚举，`makeChatDecision` 新路由 allowModel=false + deterministic_reply 占位）；`chat-classifier.ts`（v0.2：意图 11→16，`intentToRoutingDecision` companion→social + 4 新映射，`INTENT_ROUTE_EXPECTATIONS` 更新；**D-A5**：删 `CHAT_CLASSIFIER_MODE`/shadow 分支，`resolveActiveChatRouting`→`resolveChatRouting` 单一启用语义；**D-A2**：分类器失败 → `classifier_unavailable` 终局降级，不再降级正则硬猜）；`chat-agent.ts`（4 个占位模板文案 + `chatRoutingUnavailableResult` + 模板直答分支扩 4 新路由）；`app/api/chat/route.ts`（mode/shadow 逻辑删除，不可用早返回）；eval 脚本 ×3 适配（m3 固定集 / chat15 矩阵 / 分类器准确率）；`.env.local`（CHAT_CLASSIFIER_MODE 注释清理）。
  - **验证结果**：tsc 通过；全量测试 **700/700**（删除 10 个旧 shadow/mode 测试，新增 15 个 v0.2 合同测试：16 意图快照、新路由枚举/摘要往返、占位模板、D-A2 终局降级、D-A5 未配置=规则基线、L0 恒可达、未启用态零变化——新问法保守落 out_of_scope）。
  - **现状说明**：①分类器中间态仍为 `CHAT_CLASSIFIER_ENABLED=false`（v0.3 prompt 只教 11 意图，`chatRoutingUnavailableResult` 与 v0.2 合同就绪但 prompt 升级在 A3）——`FORCE_CLASSIFIER=1` smoke 在 A3 前预期失败，属正常时序；②路由行为变化（D-A2/D-A5 生效面）在 A5 全对启用分类器后才对 demo 站可见，当前 demo 行为 = 规则基线，零变化。
  - **用户检查清单**：审阅 §2.1 全景映射表与代码实现的一致性（16 意图 → 16 路由）；确认 D-A2 失败降级文案（"对话服务暂时不可用；我不会使用未经验证的结果回答。稍后再试，或先问我累计、本周的汇总统计。"）；确认四个占位模板文案。
- 用户验收：（**已通过，2026-10-23 用户确认**。`Done` 记录：A1 完成——commit 583280f；16 意图 / 16 路由合同、D-A2 不可用降级、D-A5 单一启用语义落地，700/700 全量测试零回归。下一项 A2/A3。）

### AGT-A2 · 标注集 v0.4 编纂与冻结 · `Review`（2026-10-23，commit 9cacb5f）

- 目标：新增 ≥40 例（4 新意图各 ≥8 + companion ≥8，含边界对抗例）、旧例改标（水平评估例 + open_chat 闲聊例）、red-team 扩充 ≥2、manifest 重算冻结。
- 进入条件：A1 完成（已满足）。退出条件：schema 校验全过 + 用户批准冻结。
- **验收汇报（2026-10-23，供用户抽检）**：
  - **交付清单**：新增 `eval/ride-chat-classifier-v0.4/cases.json`（83 例）、`manifest.json`（SHA + 覆盖策略 + 版本矩阵）、`CHANGES.md`（**抽检主入口**：改标 6 例、新增 45 例逐条边界说明、统计对照、3 处已知张力）；重写 `scripts/preflight-ride-chat-classifier-eval.ts` 指向 v0.4。
  - **规模与分布**：83 例 = dev 13 / blind 60 / red-team 10；新增 45 例（含 red-team 4）；5 个新意图各 8 例（每意图 dev 1 + blind 7）；所有非红线意图 dev ≥1、blind ≥3；红线意图只落 red-team（safety 4 / privacy 2 / injection 4）。
  - **改标 6 例（D-A3/D-A4）**：`CLS-DEV-04`/`CLS-BLIND-10`/`-16`/`-17` capability_gap → level_assessment；`CLS-DEV-06`/`CLS-BLIND-18` open_chat → companion。正文未改，仅 `intent` 改标（供逐条确认）。
  - **收窄意图换例**：`capability_gap` 原 4 例已全部改标，补 4 例（Strava 同步 / 录像回放 / 三维地图 / Apple Health）；`open_chat` 闲聊 2 例迁出后补 2 例（极值检索 + 阈值筛选）。
  - **版本口径修正**：目录/内部 schemaVersion 统一到标注集 v0.4（旧目录名 v0.1 与内容 v0.3 交错的坑消除）；`mode: shadow` 字段随 D-A5 退役，改记 `runtimeMode: single_enabled`。
  - **验证结果**：`node scripts/preflight-ride-chat-classifier-eval.ts` → `preflight pass`（83 例 / sha256 `414e0d31c365…` / 16 意图全覆盖 / 契约版本与源码一致 / 零模型调用）；新增跨 split 重复正文检测（dev 例会被 few-shot 使用，重复即泄漏）。tsc 通过；全量测试 702/702。
  - **口径偏差**：细规划估 ≈78 例，实际 83 例——差额来自两处必要修补（capability_gap 改标归零须补 4；open_chat dev 归零须补 2），"新增 ≥40 例"硬口径满足（45）。
  - **用户检查清单**：① 抽检 `CHANGES.md` §3 改标 6 例；② 抽检 §4 五类新增例的边界标注；③ 对 §6 三处张力给出裁决（`level_assessment` vs `history_compare` 的 BLIND-26、`training_supervision` vs `training_plan` 的 BLIND-45、`companion` vs `out_of_scope` 的 BLIND-31）；④ **批准冻结**（批准后 manifest 哈希锁定，任何改动须重算并重跑全新 Run）。
- 用户验收：（待确认）

### AGT-A3 · 分类器 Prompt v0.4 · `In Progress`（2026-10-23，commit 9cacb5f｜实施与自检已完成，按串行评审纪律排队）

- 目标：意图定义与判断规则按 §2 边界迁移重写 + 5 新意图 few-shot（取自 dev 例，避免 blind 泄漏）+ 输出 schema 升 `chat-classifier-v0.2`；**Prompt 以版本化常量写入 `src/chat/` 并随请求直发硅基流动（代码库为唯一事实源）**，`prompts/ride-chat-classifier-v0.2.md` 为归档副本（A0/D-A6 已取消 Coze workflow 维护，原卡"Coze 试运行"口径随之失效）。
- 进入条件：A0 完成（已满足）+ A2 数据集定稿（few-shot 选例依赖）。退出条件：定向单测（messages 合同）+ 真实调用 smoke 输出符合 v0.2 schema + 归档副本与代码内 prompt 逐字一致。
- **验收汇报（2026-10-23，汇报先行——实施与自检已完成；按"最多一个 Review"的串行评审纪律，正式评审随 A2 冻结批准一并启动，供用户检查）**：
  - **变更清单**：`src/chat/chat-classifier-prompt.ts` 全文重写（`ride-chat-classifier-prompt-v0.4`：16 意图定义 + 7 条顺序判断规则 + 13 条 few-shot + 输出 schema `chat-classifier-v0.2`）；`prompts/ride-chat-classifier-v0.2.md` 归档副本（新文件，v0.1 保留为历史）；新增 `scripts/sync-classifier-prompt-archive.ts` + `npm run prompt:classifier:sync`（改 Prompt 后一键对齐副本）；新增 `scripts/smoke-classifier-v04.ts`；`tests/chat-classifier.test.ts` 更新版本断言并新增 2 条测试。
  - **验证结果**：tsc 0 error；全量测试 **702/702**（A1 基线 700 + 新增 2）；真实 smoke（硅基流动，8 探针）**schema 8/8、意图命中 8/8**，覆盖 5 个新意图 + open_chat/aggregate 回归；归档副本一致性单测通过（代码常量 ↔ md `text` 块逐字相等）。
  - **过程中发现并修复的评测泄漏**：新加的"防泄漏"测试拦下 1 例真实泄漏——few-shot 里 open_chat 例句直接用了 `CLS-BLIND-07` 原句、`unclear` 定义抄了 `CLS-BLIND-22` 原句（该写法自 v0.3 Prompt 时代就存在）。已改为泛化说法（如"问哪次最远/最快、哪几次超过某阈值"），并确立口径：**意图定义中的示例一律不照抄 blind/red-team 原句**。若不改，A5 的 blind 通过率会因"见过原句"虚高。
  - **现状说明**：`CHAT_CLASSIFIER_ENABLED` 仍为 `false`（A0~A5 中间态），**A3 完成不等于线上生效**——demo 站当前路由行为仍是规则基线，分类器接管发生在 A5 全对之后（D-A5 单一启用语义）。
  - **待办衔接**：`scripts/eval-classifier-accuracy.ts` 仍指向 v0.1 数据集（`AGT-A4` 负责重定向 + 门槛/分 split 汇总适配），本项未越界修改。
  - **用户检查清单**：① 通读 `chat-classifier-prompt.ts` 的 16 条意图定义与 7 条判断规则（特别是 §2 边界迁移的四组：训练计划 vs 域外训练、计划 vs 监督、水平评估 vs 历史比较、知识 vs 产品能力）；② 确认几个占位口径：`training_supervision` 允许句中出现"调整下周安排"、`companion` 覆盖"骑行生活感受分享"；③ 认可 smoke 结果仅作可用性证据（准确率结论留给 A5）。
- 用户验收：（待确认）

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
