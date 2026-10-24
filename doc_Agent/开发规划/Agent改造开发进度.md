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
| 当前主任务 | `AGT-A5` 全新 Run：**`Review`（2026-10-24）——83/83 全对达成**（Run `AEVAL-CLASSIFIER-20261023233648`，prompt v0.4.1）；验收期三处回归缺陷（前端兜底猜答案/超时 8s 过紧/aggregate 无口径答"不会猜测"）已修复并实证，见 A5 卡「验收期回归修复」。§A3/A4 已实施完成，`Blocked` 于 A5 同批验收 |
| 阻塞 | 无（等 A5 验收 → A6 收口） |
| 唯一下一步 | 用户验收 A5（浏览器实测三条：`我最近骑行数据怎么样？` / `上次我的骑行心率多少？` / 断网或超时场景看是否只回诚实降级）→ `AGT-A6` 收口 |

## 2. 里程碑看板

| 里程碑 | 状态 | 完成/总数 | 退出条件 | 证据 |
|---|---|---:|---|---|
| AGT-A 意图路由 v0.4 + Provider 迁移 | `In Progress` | 3/7 | 标注集 v0.4 冻结 + 分类器 v0.4 + 对话链路迁硅基流动 + 全新 Run 全对 | A0/A1/A2 Done（2026-10-23/24 用户验收）· A2 冻结哈希 `9a4c242f…` |
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

### AGT-A2 · 标注集 v0.4 编纂与冻结 · `Done`（2026-10-24 冻结通过）

- 目标：新增 ≥40 例（4 新意图各 ≥8 + companion ≥8，含边界对抗例）、旧例改标（水平评估例 + open_chat 闲聊例）、red-team 扩充 ≥2、manifest 重算冻结。
- 进入条件：A1 完成（已满足）。退出条件：schema 校验全过 + 用户批准冻结。
- **验收汇报（2026-10-23，供用户抽检）**：
  - **交付清单**：新增 `eval/ride-chat-classifier-v0.4/cases.json`（83 例）、`manifest.json`（SHA + 覆盖策略 + 难度轴 + 9 组对抗对 + 版本矩阵）、`README.md`（**用例说明文档**：三条轴、判定口径速查、对抗对清单、维护流程、已知局限）、`CHANGES.md`（**变更抽检清单**：改标 6 例、新增 45 例逐条边界说明、统计对照、3 处已知张力）；重写 `scripts/preflight-ride-chat-classifier-eval.ts` 指向 v0.4。
  - **难度轴 `kind`（2026-10-24 补入，冻结前）**：因"无法区分退化发生在边界判断还是常规问法"，给 83 例补 `kind` 三值——`positive` 53 / `boundary` 26（31.3%，下限 25%）/ `ambiguous` 4（与 `intent=unclear` 互为充要）；并把 9 组对抗对写入 `manifest.boundaryPairs`（两侧都有例 + 至少一条 boundary，preflight 机械校验）。**哈希因此重算：`414e0d31…` → `9a4c242f…`；例文与判定口径未变。**
  - **规模与分布**：83 例 = dev 13 / blind 60 / red-team 10；新增 45 例（含 red-team 4）；5 个新意图各 8 例（每意图 dev 1 + blind 7）；所有非红线意图 dev ≥1、blind ≥3；红线意图只落 red-team（safety 4 / privacy 2 / injection 4）。
  - **改标 6 例（D-A3/D-A4）**：`CLS-DEV-04`/`CLS-BLIND-10`/`-16`/`-17` capability_gap → level_assessment；`CLS-DEV-06`/`CLS-BLIND-18` open_chat → companion。正文未改，仅 `intent` 改标（供逐条确认）。
  - **收窄意图换例**：`capability_gap` 原 4 例已全部改标，补 4 例（Strava 同步 / 录像回放 / 三维地图 / Apple Health）；`open_chat` 闲聊 2 例迁出后补 2 例（极值检索 + 阈值筛选）。
  - **版本口径修正**：目录/内部 schemaVersion 统一到标注集 v0.4（旧目录名 v0.1 与内容 v0.3 交错的坑消除）；`mode: shadow` 字段随 D-A5 退役，改记 `runtimeMode: single_enabled`。
  - **验证结果**：`node scripts/preflight-ride-chat-classifier-eval.ts` → `preflight pass`（83 例 / sha256 `9a4c242f…` / 16 意图全覆盖 / 契约版本与源码一致 / kind 分组计数一致 / 9 组对抗对两侧齐备且各含 boundary 例 / 零模型调用）；新增跨 split 重复正文检测（dev 例会被 few-shot 使用，重复即泄漏）。tsc 通过；全量测试 702/702。
  - **口径偏差**：细规划估 ≈78 例，实际 83 例——差额来自两处必要修补（capability_gap 改标归零须补 4；open_chat dev 归零须补 2），"新增 ≥40 例"硬口径满足（45）。
  - **三处张力已裁决（2026-10-24 用户确认）**：`BLIND-26` → `level_assessment`（看落点不看词汇：比较词只修饰，落点是"体能在哪个阶段"）；`BLIND-45` → `training_supervision`（依据是既往执行，句中"调整安排"不算要新计划）；`BLIND-31` → `companion`（判据是"是否落在骑行话题内"，非严格问候/情绪白名单）。三条裁定与现有标注一致 → **数据集零改动，`casesSha256` 保持 `9a4c242f…`**；三条判据已回写进 Prompt 判断规则（第 2、4 条），smoke 复跑仍 8/8。
  - **复合问法口径已补（2026-10-24，冻结前）**：核查出本集有 **4 例明确复合问法**（`BLIND-45`/`BLIND-49` = 监督 + 计划，`RED-07`/`RED-09` = 红线 + 计划）+ 1 例弱复合（`BLIND-19`）。此前靠"红线优先/监督优先"隐式裁决、无成文规则 → A5 里会随机漂移。现已写成 Prompt 判断规则第 8 条：**仍单标签 + 主意图优先级（红线 > 监督 > 计划 > 数据 > 知识 > 闲聊 > 域外）+ 次诉求由回复层承接**；README §2.4 与 AI-Spec §4 同步。**现有标注已符合该优先级 → 数据集零改动、哈希仍 `9a4c242f…`**。多标签（`intents[]`）不采用，重审点挂 AGT-B。
  - **用户检查清单**：① 读 `README.md`（用例说明：三条轴、9 组对抗对判据、§2.4 复合问法、§7 已知局限）；② 抽检 `CHANGES.md` §3 改标 6 例与 §4 五类新增例的边界标注；③ **确认 9 组对抗对是否就是你认为的切线**（`manifest.boundaryPairs`，任一对判据不对都可改）；④ 对 §6 三处张力给出裁决（✅ 已于 2026-10-24 完成）；⑤ **批准冻结**（批准后 manifest 哈希锁定，任何改动须重算并重跑全新 Run）。
- 用户验收：（**已通过，2026-10-24 用户批准冻结**。`Done` 记录：83 例冻结，`casesSha256` = `9a4c242f…` 锁定，`manifest.frozenAt = 2026-10-24`；commits 9cacb5f（初版）+ 0b4c7f6（kind 轴 + README）+ b279d89（三处张力裁决）+ e3617e6（复合问法口径）。此后任何用例改动须新版本目录 v0.5 + 重算哈希 + 全新 Run。）

### AGT-A3 · 分类器 Prompt v0.4 → v0.4.1 · `Blocked`（2026-10-23/24｜实施与自检已完成，随 A5 同批验收）

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

### AGT-A4 · 评测脚本适配 · `Blocked`（2026-10-24｜实施与自检已完成，随 A5 同批验收）

- 目标：`eval-classifier-accuracy.ts` / `preflight` 指向 v0.4 数据集，意图集从代码导入防漂移。
- 进入条件：A1 + A2 完成。退出条件：preflight 四项检查通过。
- **验收汇报（2026-10-24，汇报先行）**：
  - **变更清单**：`scripts/eval-classifier-accuracy.ts` 重定向到 `eval/ride-chat-classifier-v0.4/`，并新增三项——
    ① **kind 分组归因**（positive/boundary/ambiguous 各自 correct/total，写进 run 记录 `result.kinds`，只归因不放宽门槛）；
    ② **kind 冻结一致性校验**（cases 实际分组数与 manifest `kindCounts` 不符则直接报错，防"资产已改却按旧统计归因"）；
    ③ run 记录升 `ride-chat-classifier-run-v0.2`（`mode` → `runtimeMode: single_enabled`，补 `datasetVersion`/`casesSha256`/`contracts`/`signOffReady`）；
    `scripts/preflight-ride-chat-classifier-eval.ts` 已在 A2 重写为 v0.4 版（哈希/结构/意图覆盖/kind/对抗对/防泄漏）。
  - **验证结果**：`tsc` 0 error；`eval:classifier:preflight` pass（83 例 / 9 组对抗对 / 零模型调用）；`eval-classifier-accuracy.ts` 在 `CHAT_CLASSIFIER_ENABLED=false` 下正确 **exit 2 并拒绝执行**（`CLASSIFIER_NOT_CONFIGURED`，零模型调用——守门有效）；全量测试 702/702。
  - **未做（属 A5 范围）**：真实全量 Run。需用户授权 + 先把 `CHAT_CLASSIFIER_ENABLED` 置 `true`（或运行期临时注入）。
  - **用户检查清单**：确认归因口径（kind 分组只是诊断，不参与 PASS/FAIL 判定；`signOffReady` 才是签收信号）。
- 用户验收：（待确认）

### AGT-A5 · 全新 Run 重评 · `Review`（2026-10-24，两轮 Run，83/83 全对）

- 目标：v0.4 全量 **83 例**真实模型调用，bad case 回流循环直至全对；按 D-A1 与 v0.3 待授权 Run 合并。
- 进入条件：A3 + A4 完成 + 用户授权。退出条件：全量全对（硬门 ≥0.95 + red-team 零失误为底线）+ run 报告归档。
- **成本与耗时实测（2026-10-24，`scripts/measure-classifier-token-usage.ts` 3 例真实调用）**：单次 prompt **2,157 tokens**（其中 system prompt 约 2,100，占绝对主导）、completion **36 tokens**；全量 83 例 = 输入 **179,031** / 输出 **2,988** tokens。
  - 按硅基流动 `DeepSeek-V4-Flash` 现价（分时段）：**2:00–8:00 时段** 输入 ¥1.5/M、输出 ¥4.5/M → **约 ¥0.28**（若 system prompt 命中前缀缓存，可降至 **¥0.05 左右**）；**其他时段** 输入 ¥3/M、输出 ¥9/M → **约 ¥0.56**。
  - 耗时：83 × (约 1s 调用 + 500ms 间隔) ≈ **2.5 分钟**；`AEVAL_CLASSIFIER_DELAY_MS` 可调。
  - 结论：单次全量成本 **不到 6 毛**，重跑 5 轮也在 ¥2 内，成本不构成约束。
- **验收汇报（2026-10-24，两轮 Run）**：
  - **Run 1**（`eval/runs/AEVAL-CLASSIFIER-20261023233337.json`，prompt v0.4）：**82/83 = 98.8%**，PASS 门槛但未达签收线。唯一 MISS：`CLS-BLIND-01`「上次骑行我的心率表现怎么样？」`ride_summary` → 判成 `history_compare`。
    - **归因（`scripts/probe-classifier-texts.ts` 5 条探针验证）**：触发词是"**表现**"——`上次骑行的心率怎么样`→ride_summary ✓、`这次骑行的表现如何`→ride_summary ✓，但只要"表现"与"上次/最近一次"共现就漂到 history_compare（`最近一次骑行的整体表现怎么样`同样判错）；带真实参照的 `我上次骑行的表现比之前好吗`→history_compare ✓。根因 = history_compare 定义里写了"整体表现作比较"，把"表现"这个词当成了比较信号。
    - **注意分层面**：**26 条 boundary 全过、53 条 positive 错 1** —— 正是 `kind` 轴要区分的情形（**正例错 = 定义有漏洞**，不是切线问题）。
  - **修法（prompt v0.4 → v0.4.1，语义变更故升版）**：① history_compare 增加硬条件"**必须存在对比参照或变化词**（比/和/与/相比/对比/之前/上次/上个月/趋势/进步/退步/变快/变慢），只有'表现'字样没有参照不算比较"；② ride_summary 明确"**'表现/整体表现'本身不是比较词**"；③ 判断规则第 4 条同步。改后探针 4/4 归位。
  - **Run 2**（`eval/runs/AEVAL-CLASSIFIER-20261023233648.json`，prompt v0.4.1）：**83/83 = 100%**，`signOffReady = true`，**全量全对达成**。
    - dev 13/13 · blind **60/60** · red-team **10/10**（红线零失误）
    - by kind：positive 53/53 · boundary 26/26 · ambiguous 4/4
    - 16 意图全部满分；数据集哈希未变（`9a4c242f…`，只改 Prompt）
  - **启用手册（D-A5）**：`.env.local` 已置 `CHAT_CLASSIFIER_ENABLED=true`（**需重启 dev/prod 进程生效**，端口 3002）；回退即改 `false`。线上 `.env.production` 未动——是否随下次重部署一起启用由用户决定（启用后对话路由 = 分类器，四个新占位模板与"模型暂不可用"降级同时可见）。
  - **成本/耗时实测**：Run 1/2 各约 1m55s–2m00s（`AEVAL_CLASSIFIER_DELAY_MS=400`），每轮 ≈¥0.28（2–8 点档），两轮合计 ≈¥0.6。
  - **口径交代（不得省略）**：本轮属于"看 blind 结果 → 改 Prompt → 重跑"的 bad case 回流，符合项目制度，但也意味着 **blind 已不是完全未见的样本**；这一层限制度已在 README §7 披露。真正的独立证据要等 AGT-C 的生成层新 Run 或真实流量抽样。
  - **用户检查清单**：① 看 `eval/runs/` 两份记录（逐例 PASS/MISS 明细）；② 确认 prompt v0.4.1 那条硬条件是否接受（这会影响后续所有"表现"类问法的归属）；③ 重启 dev（3002）实测一条 `上次骑行我的心率表现怎么样？` 看是否走 `ride_summary`；④ 决定线上是否同步启用分类器。
- **验收期回归修复（2026-10-24，用户实测三张截图暴露，与分类器判分无关）**：三处缺陷都发生在**分类器之外**——分类器判定全部正确，问题在前后端与超时配置。
  - **R1｜前端兜底会"猜答案"（图3「上次我的骑行心率多少？」答成日期）**
    - 根因：`app/components/chat-home.tsx` 在服务端失败时回退到 `replyToChatInput`（M1 时代本地正则），`/(最近|上次).*(骑行|记录)/` 命中即答"最近一次可用骑行记录的日期是 10/5。"；服务端本可正确回答心率（同一句无后缀时返回 `ride_summary` + 168/184 bpm）。
    - 定性：**违反 D-A2「诚实失败优于错误猜测」**——服务端早已改为诚实降级，前端仍保留正则硬猜，等于把"答非所问"伪装成正常回答。
    - 修复：删除 `replyToChatInput` / `classifyInput`（`src/chat/chat-home.ts`，原地留退役说明防复活）；`chat-home.tsx` 失败/空回复统一回 `CHAT_UNAVAILABLE_REPLY =「对话服务暂时不可用；我不会使用未经验证的结果回答。」`，任何业务答案只能来自服务端。
  - **R2｜主对话超时阈值过紧（图1/图2「对话服务暂时不可用」）**
    - 根因：主链路走硅基流动，`SILICONFLOW_CHAT_TIMEOUT_MS` 默认 **8s**；实测单项耗时 4.5 / 5.3 / 7.4 / **8.17s**，9.2s 那次直接 `MODEL_TIMEOUT`。用户侧表现 = 同一问题连问三次才成功。
    - 修复：**8s → 15s**（`siliconflow-chat-provider.ts`，上限 25s 不变；`CHAT_PROVIDER_TIMEOUT_MS` 同步 8s→15s 保持一致，该常量只作用于已退役的通用 HTTP provider）。分类器超时同步 **8s → 12s**（实测 0.78–4.2s，且分类器失败是终局降级、无规则兜底，代价高于主对话重试）。
    - **实证**：修复后同一问法 `provider.run #1 OK | duration=8170ms | validation=ACCEPTED` —— 8170ms 在旧阈值下必失败。
  - **R3｜aggregate 抽不出口径时答"我不会猜测骑行数据"（图1「我最近骑行数据怎么样？」）**
    - 根因：`route=aggregate` + `classifyAggregateQuestion` 返回 null（该问法无"累计/本周/最近一次+时间"关键词）→ 旧实现回落 `templateReply` 的 `default` 分支，输出「当前请求需要先取得已授权的只读工具结果…我不会猜测骑行数据」。**手里有 4 条记录却说没有**。
    - 修复：新增 `aggregateOverviewReply`（`src/chat/chat-home.ts`），只陈述服务端已确定事实（次数/总里程/本周/最近日期）+ 一句收窄引导；`chat-agent.ts` aggregate 分支 null 时改走它，日志 `kind=none` → `kind=overview`。
    - **实证**：`已记录 4 次骑行，累计 279.3 km。本周 0 次、0 km。最近一次是 10/5。想看某次的具体指标（心率、功率、踏频），或某次与历史的对比，可以直接问我。`
  - **验证**：`tsc` 0 error；全量 **704/704**（702 + 新增 2 条回归测试：指标问法不得降级为日期回答、aggregate 无口径须给总览而非拒绝）；三条真实请求分别验证 R3（总览）、R1 服务端侧（心率 168/184 bpm，`execution=validated`）、R2（8170ms 成功）；`history_compare` 路由未被 v0.4.1 硬条件误伤（无上下文时按口径澄清"你说的这次是指哪一次"）。
  - **分类器判分不受影响**：本次三处修复均未触发 Prompt/数据集变更，A5 的 **83/83** 结论继续有效，无需重跑。

### AGT-A6 · 里程碑收口 · `Backlog`

- 目标：重评报告归档 `doc_Agent/`、粗规划状态更新、里程碑计数、验收汇报收口。
- 进入条件：A1~A5 全部 Done。退出条件：用户验收 AGT-A 全部工作项。
- 验收汇报：（进入 Review 后填写）

## 4. 已完成里程碑

（暂无）
