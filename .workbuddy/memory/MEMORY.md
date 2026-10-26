# 项目长期记忆 · AI 骑行伙伴

> 仅记录跨会话仍有效的项目事实与约定。日常流水见同目录 `YYYY-MM-DD.md`。
> 2026-10-24 做过一次压缩合并（原文 21.7KB → 现文），过程细节以日志为准。

## 主线：M7 对话 Agent 自主化（`doc_Agent/`，分支 `codex/m7-agent-autonomy`）

- **架构结论（不复议）**：正确落地 = **L1 扩工具面 + 训练监督单点升 L2**，不上 L3/L4。CHAT-17 L2b 已是受限单 Agent；"自主"真实需求 = 工具自主编排（已有）+ 主动性（新，属调度基础设施）。
- **七里程碑**（`AGT`）：A 意图路由 v0.4 → B 只读工具面 + 循环扩展 → C 生成层（分析/评估/KB/陪伴）→ E 影子轨 + 阶段1 放行；D 上下文记忆三层（前置 P8）可与 C 后半并行 → F 训练规划 + 写路径（前置 P6）→ G 训练监督 + 主动性（前置 P3）。
- **进度（2026-10-26 12:0x）**：AGT-B `In Progress` 5/8；**B5 `In Progress`，边界集已达标**。最终基线（含网络校正）：**编排集 46/63=73.0% → 校正 55/63=87.3%**（9 次 headers 失败）、**边界集 104/114=91.2% → 校正 110/114=96.5% ✅ 达标**。全量 **773/773**。全失败例只剩 ORCH-19（负例误用工具）+ ORCH-20（注入）。**取基线必须同时看 `timingSummary.failByPhase`**——网络失败三轮 0 → 18 → 9+6，原始分数会被压低 10~14pt。
- **⭐ 关键教训（2026-10-26）：`MODEL_TIMEOUT` 不等于"服务波动"**。五组测量证明服务 6/6 次正常（1.6~5.1s），真因是①偶发连接失败（`HTTP 000` + **固定 85.9s** = TCP SYN 重试耗尽）②请求体积。已给 provider 加**分阶段计时**（`onTiming`：headersMs/bodyMs/failurePhase，不改 run 合同），实测**延迟 100% 在 headers 阶段（p50 6.0s）、body p50 0ms**。
- **⭐ 关键教训（2026-10-26）：不可比 ≠ 相同**。曾让 `not_comparable` 的 claim 可引用 + Prompt 解释，模型答成「完全一致，没有变化」并**编造"相同路线"**（幻觉方向），还破坏 CHAT-13「首骑不可比无 claimId」契约 → 全撤回。改为**零模型话术**按 `reasonCodes` 映射说明——事实性解释不该交给模型。
- **B5 关键教训**：① **写多记录场景用例禁用"这次/那回"**（踩三次：ORCH-01~13 改造、BND-A01、ORCH-21），除非显式构造 `turns` 给锚点。② `windowDays` 越界应**钳制**而非判非法。③ **判分必须含"最终交付成功"**——只看工具齐不齐会把超时降级判成通过（24/63 假阳性）。④ 换路径仍答对可放宽（requiredAnyOf），换路径答错须记为选择错误。⑤ **绝不拿评测失败倒推能力面**（ORCH-08 曾被误判为白名单缺失）；修选错工具靠 catalog `purpose` + Prompt 分工表。⑥ **提升提示质量有延迟代价**：catalog purpose(+500字)+分工表(5906字) 把 p50 推到 16s。⑦ 评测仓库记录太少会让 `NO_MATCH` 反映 fixture 不足而非真实不可用。
- **目录约定**：需求分析/调研留 `doc_Agent/` 根；粗规划、里程碑细规划、进度在 `doc_Agent/开发规划/`。执行事实源 = `开发规划/Agent改造开发进度.md`，验收汇报直接写在该工作项下。

## 已拍板决策

- **P 系列**：P1 地图录像=轨迹回放纯前端 / P2 个人 demo+portfolio / P5 skills=领域工具面（10-23）；**P4 健康数据=仅现有 profile（maxHR/FTP/体重），不接外部** / **P7 窗口放开=口径变更，M3 须开新 Run，旧结论不背书**（10-24）。待定：P3（主动性边界，G 前）、P6（计划自由度，F 前）、P8（assistant 原文上服务端，D 前）、P9（显式偏好层，建议延后）。
- **D-A1~A6**：A1 v0.3 Run 合并进 v0.4；A2 移除启用态 P1 业务正则兜底（失败统一"模型暂不可用"，L0 快路径保留）；A3 水平评估例改标 level_assessment；A4 open_chat 拆出 companion（复用 `social`）；A5 取消 shadow/active 双模式（`CHAT_CLASSIFIER_MODE` 退役，`CHAT_CLASSIFIER_ENABLED=true` 即接管）；A6 对话链路 Coze→硅基流动全迁 + Prompt 迁入代码库为唯一事实源（**骑后解读链路维持 Coze 不动**）。
- **D-B**：B1 窗口职责分离 / B4 kb_qa+level_assessment 在 B 升级真链路 / B6 健康档案只投影 weightKg/maxHeartRate/ftp **已确认**；B3/B7/B9 按默认执行；B2/B5/B8 待对应工作项前确认。
- **12 路由 11 意图全部保留、无删除**。

## 多轮上下文机制（2026-10-24 核对代码，跨会话有效）

- **意图识别只看当前这一句**：`resolveChatRouting({text: result.text})` 只传本轮文本；分类器输入合同 `ride-chat-classifier-input-v0.1` 只有 `text` 一个变量（`chat-classifier.ts` 头注释明写"输入仅当前问题文本"）。**摘要不参与路由**。
- **上下文只在路由之后用**，两条独立通道：① **锚点解析**（`chat-ride-anchor.ts`，CHAT-14）——次序 = 显式日期 → 显式序数 → 上下文继承（摘要里最近一条 `rideAnchor`）→ 澄清；锚点存**日期字符串**而非"最新"指针，导入新记录不偷换锚点；生效路由 `current_ride`/`capabilities`/`history_compare`/`autonomous_tools`。② **表达层摘要**（主对话 Prompt 的 `sessionSummaries`）——只用于理解指代与话题延续。
- **摘要槽位白名单**（`chat-session.ts` / `chat-routing.ts` 网关）：≤6 条、`question` ≤120 字、该轮 `route`、可选 `rideAnchor`；**不含 assistant 回复正文**；非法整体静默丢弃退回无上下文基线（事件 `summariesDropped`）。历史问题里的数字/日期**不是事实来源**，Prompt 明文禁止引用。
- **确认轮是特例**：上一轮工具路由触发锚点澄清（摘要挂起且 `rideAnchor` 空）+ 本轮是纯确认语（是的/最近一次/日期）→ `detectAnchorConfirmation` 用摘要识别 → 用**挂起的原问题**重跑规则路由（`classifyChatInput`，非 L1 分类器）+ `anchorOverride` 重答；日期无匹配则零模型确定性回复。
- **设计代价（被追问要认）**：分类器无状态 → 可复现可评测（M3 固定集每例 1 次才有意义），但**纯指代追问单句判不出**（"那这个呢？"→ unclear → 澄清）；"这次"在 4 条记录下触发 `TOOLS_ANCHOR_CLARIFY`（B5 首轮 15 次"编排失败"的真因）。**已知缺口**：摘要无 assistant 正文，回指"你上面说的第二点"接不住（P8 未决）。

## 对话链路与 Prompt 事实源

- Provider：硅基流动 OpenAI 兼容（`https://api.siliconflow.cn/v1`）；分类器 `deepseek-ai/DeepSeek-V4-Flash`、主对话 `deepseek-ai/DeepSeek-V3.2`。
- **Prompt 正文唯一事实源 = 代码库**（`src/chat/*-prompt.ts` 版本化常量），`prompts/*.md` 是归档副本；改完跑 `npm run prompt:classifier:sync` / `npm run prompt:workflow:sync`，一致性有单测兜。AI-Spec 只做版本索引 + 合同。
- **防泄漏纪律**：few-shot 只取标注集 `dev` split；意图定义里的示例一律泛化，**不照抄任何 blind/red-team 原句**（机械断言 + preflight 跨 split 重复正文检测）。
- **超时现值**：主对话单轮 20s（B4 由 15s 上调，kb_qa 变"检索+生成"两轮后 15s 必超时）、分类器 12s、整轮 45s 兜底。
- 当前 Prompt 版本：分类器 `ride-chat-classifier-prompt-v0.4.1`；主对话 `ride-chat-prompt-v0.2.3`。

## 分类器 v0.4 要点

- 标注集 `eval/ride-chat-classifier-v0.4/`：83 例（dev 13 / blind 60 / red-team 10），三轴 `split`/`intent`/`kind`（positive 53 / boundary 26 / ambiguous 4），9 组 `boundaryPairs`；**口径看该目录 `README.md`，变更看 `CHANGES.md`**。
- 签收 = **全量全对**（gate 0.95 只是底线）；定版 Run `AEVAL-CLASSIFIER-20261023233648`（83/83）。唯一 MISS 归因：**"表现/整体表现"不是比较词**——`history_compare` 必须有对比参照或变化词（v0.4.1 换来）。
- 复合问法：**单标签 + 主意图优先级**（红线 > 监督 > 计划 > 数据 > 知识 > 闲聊 > 域外），次诉求由回复层承接。
- 成本：单次 2157 tokens、全量 ≈¥0.28–0.56、≈2 分钟。**不构成约束**。线上 `.env.production` **仍为规则基线**，是否启用待用户决定。

## AGT-B 事实（工具面与循环）

- 工具面 **4 → 9**：`get_ride_context`/`get_capabilities`/`compare_rides`/`find_ride` + `get_health_profile`/`get_training_load`/`search_knowledge_base`/`get_ride_history`/`get_route_overview`。
- **30 天冻结只在 chat 层**（领域层 `historical-comparison.ts` 早已 1..365）。B2 = 解冻 + 口径定义：`find_ride` 上限 365（**缺省仍 30**，由 `normalizeLoopCall` 注入，有行为级测试）、`compare_rides` 默认 30 **不放大**（可比性口径）、`get_ride_history` 缺省 90/上限 365。
- **预算四值**：累计工具 **5** / 单轮 **4**（=并发）/ provider **6** / 整轮 **45s**。并行 = 分片（片内并行、片间串行）+ receipts 按请求顺序落位（`claim:loop:N` 稳定前提）+ **先全量校验再执行**（任一被拒整轮不执行）。
- **catalog 按路由裁剪**（`CHAT_TOOL_CATALOG_SCOPE`）：autonomous_tools 9 全量 / kb_qa = KB+get_ride_context（B4 起 + get_health_profile）/ level_assessment 四件 + KB / none 空；`CHAT_TOOL_CATALOG_INPUTS` 是输入说明单一事实源，**必须写类型**（模型会把数组字段填成字符串 → 调用被拒 → 整轮失败，最隐蔽的坑）。catalog 实测 9 工具 2404B。
- **证据合同 `chat-tools-v0.2` / `ride-chat-output-v0.2`**：`claimIds` 与 `knowledgeIds` **按证据类型各自非空、可同时存在（非互斥）**；双版本解析兼容 v0.1（704 项零回归的关键）。`chatToolSpecs` 是工具合同单一事实源（anchorMode/evidenceKind/numericFacts/hasUsableEvidence）。
- **数字硬门**：等价类（`chat-numeric-evidence.ts`，复用 `claimNumericVariants`）+ 否定语境豁免（`hasUnnegatedHit`，前 14 字窗口）+ 拒绝原因入 `loopTrace.validationRejections`。**线上不加 LLM 语义判官**（延迟翻倍/判官错向即放行幻觉/不可归因）。中文数字不受数字校验约束（刻意）。
- **`get_training_load` 链路**：`src/domain/ride-training-stress.ts` 的 `computeRideTss`（`(NP/FTP)²×movingTimeS(h)×100`，**只用 movingTimeS**）是 `ride-pmc-load-v2` 唯一接线点。PMC 要 ≥42 天跨度 + ≥10 个负荷日 → **演示 4 条记录必然 `INSUFFICIENT_LOAD_DAYS`**（正确行为，B5 边界集覆盖）。
- `get_route_overview` 不可用时**不给任何里程字段**（给 0 会被说成"全是平路"）；现有 fixture 无真实爬坡轨迹，真实 FIT 归 B5。
- **B4 的两条边界**：① AGT-D 范围**不含**锚点/指代消解（锚点是 CHAT-14 现役能力），kb_qa 的"这次"澄清属**路由级交互策略 → 归 AGT-C**。② §5.5 结论 = **L1 扩 catalog，否决 L3**（复合问法答漏根因是 catalog 缺口/输入说明不清/模型不继续调/锚点澄清/单轮超时四类混杂，多标签一个都解决不了）。
- **B5 教训**：编排集**不测路由**（route 统一给定），路由归 M3 集；`windowDays` 越界应**钳制到上限 + limitations 注明**而非判 `INVALID_TOOL_CALL`；真实模型**连跑会限流**（5 例连跑 3 例超时），评测须控速并记录延迟分布。

## 评测口径（对外陈述前必看）

| 链路 | 数据集 | 案例数 | 每例重复 | 槽位 |
|---|---|---:|---:|---:|
| 骑后解读 · 基础合同 | `RA-AUTO-001~018` | 18 | 3 | 54 |
| 骑后解读 · 正式稳定性门 | `F01–F09` | 9 | 9 | 81 |
| 高阶解读 · A/B 冻结集 | `ADV-*` | 15（12 双臂 + 3 仅 B 臂） | 3 | 81 |
| 对话 Agent · M3 固定集 | `AEVAL-M3-CHAT` | 34（v0.6/v0.7） | 1 | 34 |
| 意图分类器 · 标注集 | v0.4（冻结） | **83** | 1 | 83 |

- **「27 × 3 = 81」不存在**：27 是 M3 v0.5 全量、每例 1 次；两处 81 来自 `9×9` 与 `15 例 A/B`，不可混讲。
- 重复次数表述：「把二值通过变成可观测失败率，按随机性敏感度定」。**不要说"避免概率事件"**（n=3 在 p=20% 检出率仅 48.8%）。
- **M3 v0.5 的 27/27 属历史结论**（Coze 时代）；主对话已换模型 → 重验挂 C。
- **A/B 是上游事实输入的对照**（A 臂剥离高阶 Claim），不是两版 Prompt/模型。硬门三段：解析归一 → 合同硬门 → 数值忠实 → 语言越界（9 组 22 条）。`81/81 零降级` = 首轮 75 + 修复 6 + B0 0（首过率 92.6%）。
- **制度**：动了评估资产或口径 → **全新 Run、不续跑、旧结论标 `supersede`**。
- **已知短板**：① 稳定性门 9 例与盲评同源；② 盲评集无 red-team；③ 测评计划 §5.1 混表；④ 第三视角仲裁实为维护者裁定；⑤ **blind 已非完全未见样本**（A5 回流）。

## 环境与运维

- **分支/工作树**：主目录 `AI骑行伙伴-指导版_0827`（`main`）+ m2~m7 平级；命名 `..._m<N>-<主题>` / `codex/m<N>-<主题>`。工作树不共享未跟踪文件：须拷 `.env.local`、`.env.production`、`.local-data` 再 `npm install`（**pnpm 本机不可用**）+ `NODE_DISABLE_COMPILE_CACHE=1 npx tsc --noEmit`。端口：3000=m4、3001=m6、**m7=3002**。
- **safe-delete 守卫死锁**（10-23 实踩）：报 `SAFE_DELETE_BULK_GUARD_ERROR state lock timeout`，连带 git `index.lock`；重启客户端无效，须到系统终端 `rm -rf` 守卫 hash 目录重建。
- **本机验 API 两坑**：`curl POST /api/chat` 必须带签名会话 cookie（DEV_SECRET 在 `src/auth/session.ts`），否则 404；**必须加 `--noproxy '*'`**，否则 502 易误判服务未起。
- **演示数据**：`test-data/demo-imported-rides/*.fit` 四条——`demo-ride-2026-10-05`(30.4km 心率) / `08-20`(31.1km 通勤) / `07-22`(161.8km 长途功率) / `07-18`(56km 起伏功率)。`DEMO_VALIDATION_BYPASS=on` 仅 demo（评测脚本永不读）；无资料时 seed 28 岁/175cm/72kg/192bpm/FTP 220（`DEMO_PROFILE_SEED=off` 关闭）。
- **线上** `https://ai-cycling-buddy.app.workbuddy.host/`；重部署须 `domainPrefix="ai-cycling-buddy"`、`startCmd="npm run build && npm start"`、部署前移出 `.local-data`。云端临时存储，重发布清空数据。

## 其他

- **V2.1 指标规范化（M6，定稿未实施）**：新 KB 7 维度 = V2 `analysisDimensionIds` 前 7；口径「LTHR 优先、maxHR 降级、provenance 标注」；KB 现状 7 条 / 23.6KB / 单条 explanation ≈3KB → 工具投影必须裁 `excerpt≤600 字`、`maxEntries≤3`。
- **可复用流水线 skill**：`~/.workbuddy/skills/requirement-to-delivery-pipeline/`，校验 `python3 <skill>/scripts/check_delivery_docs.py <项目根> --docs-dir doc_Agent`，**0 FAIL 才自洽**；同时用其他规划 skill 时以本流水线进度文档为唯一事实源，**禁止双台账**。
- **文档约定**：图示统一 Mermaid 代码块、不嵌截图；任务相关提示词与原始需求归档进项目文件夹；`doc_V2/*.pdf` 外部文献不入库。
