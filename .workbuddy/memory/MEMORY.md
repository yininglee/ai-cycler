# 项目长期记忆 · AI 骑行伙伴

> 只记录跨会话仍有效的项目事实与约定，日常流水见同目录 `YYYY-MM-DD.md`。细节以 `doc_Agent/` 文档与日志为准。
> 压缩历史：2026-10-24 / 10-26 / 10-28。

## 主线：M7 对话 Agent 自主化（`doc_Agent/`，分支 `codex/m7-agent-autonomy`）

- **架构结论（不复议）**：**L1 扩工具面 + 训练监督单点升 L2**，不上 L3/L4。"自主" = 工具自主编排（已有）+ 主动性（新，属调度基础设施）。
- **七里程碑**：A 路由 v0.4 → B 只读工具面+循环 → C 生成层；E 影子轨+放行；D 上下文三层（前置 P8，可与 C 后半并行）→ F 训练规划+写路径（前置 P6）→ G 训练监督+主动性（前置 P3）。
- **进度（2026-10-28）**：**AGT-B `Done`（8/8）**；**AGT-H `In Progress` 2/7**（H0 `Done` 用户委托验收 / H1 `Review`，真实回归已过待验收）。**批次顺序锁定 H → R（去路由化 16→3）→ C 修订 → E/F**。三数据集冻结：编排集 v0.2 21 例 / 边界集 v0.1 38 例 / M3 v0.7 34 例。
- **⭐ AGT-H1 `Review`（2026-10-28）**：新增 `src/chat/chat-ride-ref.ts` = rideRef 合同/解析/候选/话术**唯一实现点**。`rideRef{date|ordinal|rideId}`（parse 强制恰好一键）；结局 `resolved/ambiguous(same_day_multiple)/need_reference/not_found`，后三者带 candidates（≤5·含 timeLabel 供同日区分·`hasPower/hasHeartRate` 是**可用性**判断非"有没有字段"）。四条硬事实：① **"不默认取最新"在工具层，"要不要默认"在编排层**（注入 `{ordinal:-1}` 才取最新，显式可观测）；② **同日多条不再取最晚** → ambiguous+候选（旧行为是"另一次问不到"的根因）；③ **`rideRef` 在 parse 层可缺省**，否则 `need_reference` 永远走不到；④ pending 是**结果不是错误**（`reference_pending` 回执 → 零模型候选话术 `TOOLS_REFERENCE_NEEDED`，不落 no_match）。`rideId` 裸参是迁移期糖，退役归 AGT-R。
  - **真实回归（2026-10-28 用户授权，17m51s）**：编排 **58/63**、边界 **103/114**（修评测时区缺陷后 **109/114**）。逐例定性：ORCH-11 既有波动（基线同为 2 次失败）；**ORCH-21 3/3→1/5 = 判分口径过僵**（模型改走 `get_ride_context` 答"有功率 230W 但标记无效"，内容正确且更完整；单变量 A/B 换回旧 catalog 也只 3/5 → 用例本身采样不稳），**待拍板改 `toolAnyOf`**；BND-A03/A05 = 评测时区缺陷（已修，复测 3/3）；K03/K04 单轮 `REPAIR_FAILED` = 采样波动；BND-R04 既有失败（"这次"无锚点本应澄清，期望却写 `tool_executed`）。
  - **口径提醒**：细规划"同日两条三路全部唯一定位"**逐字不成立**——点选 rideId 唯一 / 序数唯一 / 日期返回候选（不猜）。
- **⭐ AGT-H0 `Done`（2026-10-27 用户委托验收）**：新增 `src/chat/chat-interaction.ts` = 交互平面合同 v0.3 **唯一事实源**（choices ≤8·去重键 `kind+id`·`label/sublabel` ≤40/60；artifact 三 kind `ride_list|plan|goal_options`·payload ≤8KB·plan 形状留白归 F；quickActions ≤4 仅 `deepAnalysis`；**非法 = 字段级整体丢弃，不部分渲染**）。三条硬事实：① **"输出合同 v0.3" = 响应层合同，模型输出协议仍 `ride-chat-output-v0.2`**——三字段由编排层同源生成、模型不经手（parseOutput 仍只认 6 键）；② 摘要槽位加 `choice{kind,id}` 但 **storage key 仍是 `ai-ride-chat-session-v0.1`**（旧会话原样加载，不迁移）；③ 动作 7 值只放开**取值范围**，`makeChatDecision` 仍只产原 4 值（`select`/`produce_artifact` 归 H2、`confirm_write` 归 F）。D-H1 渲染密度建议值（最近 5 条 + 超出折叠）保留到 H2 前终拍。
- **AGT-C 细规划已产出**：[AGT-C_生成层_工作项规划.md](../../doc_Agent/开发规划/AGT-C_生成层_工作项规划.md) C0~C6，执行顺序已移到 AGT-R 之后。
- **"单次解读只支持最近一次"缺陷**（2026-10-26 查证）：[分析文档](../../doc_Agent/2026-10-26_单次骑行解读_任意记录选择_缺陷分析.md)，探针 `scripts/inspect-chat-ride-selection.ts`。三断点：路由合同无"记录选择"维度；规则层 `CAPABILITY_GAP` 的"那次"优先于 `CURRENT_RIDE` → 10/13 指定记录问法落 out_of_scope；`default_latest` 静默取最新且前端不显示当前解读对象。**反直觉事实：锚点层本身支持绝对日期，是路由没把话递过去。** H1 已落地其推荐方案核心（rideRef 通道）。
- **目录约定**：需求分析/调研留 `doc_Agent/` 根；粗规划、里程碑细规划、进度在 `doc_Agent/开发规划/`。执行事实源 = `开发规划/Agent改造开发进度.md`，验收汇报写在该工作项下。
- **⭐ 分层节点 IO 说明书（改任何一层前先查）**：[2026-10-27_对话Agent_分层节点IO说明书.md](../../doc_Agent/2026-10-27_对话Agent_分层节点IO说明书.md)——8 层 25 节点，逐节点列输入/输出/契约上限/失败码/代码位置。两个易错事实：① **`route`（L1）与 `rideAnchor`（L2）是两条独立通道**；② **模型能看到 `toolCatalog.anchorRideId` 真实 rideId**（刻意），靠 Prompt 禁令 + 输出层 `ride_id` 词表兜住。

## 关键教训（跨会话仍要遵守）

- **失败先分层归因**：先问"这是环境/评测/用例的问题吗"，再问"这是产品的问题吗"。B5 三次把环境问题误判成产品问题：①"服务波动"实为超时错配 ②"网络污染"同一原因 ③"V4.1-Flash 只有 77.8%"实为「缺事实 + 用例期望过僵 + 平台限流」叠加，修完 96.8%。H1 回归同理：5 例失败里 1 例是判分口径、6 次是评测时区缺陷、其余是既有波动。
- **评测脚本的时区口径必须与产品一致**（2026-10-28 踩坑）：摘要锚点曾用 `toISOString().slice(0,10)`（UTC 日期），而记录日期走 `rideAnchorDate`（Asia/Shanghai）。**UTC 16:00 之后差一天**，于是"2 天前那次"指向不存在的日期 → 稳定 clarify/date_not_found。三次 Run 都没暴露只因都跑在 UTC<16:00。**结论：跨天用例必须用产品函数生成日期，不要手写 `toISOString().slice`。**
- **只看通过总数无法归因**：61→58 是"同一批用例在抖"还是"新坏了"，必须按 caseId 逐例对（`scripts/diff-eval-runs.ts`）。n=3 的"3/3 通过"不足以证明稳定——ORCH-21 基线 3/3、复测 1/5。
- **`MODEL_TIMEOUT` ≠ 服务波动**：真因是偶发连接失败（`HTTP 000` + 固定 85.9s = TCP SYN 重试耗尽）与请求体积。provider 有 `onTiming`（headersMs/bodyMs/failurePhase），实测延迟 100% 在 headers 阶段。
- **不可比 ≠ 相同**：放开 `not_comparable` 给模型解释，它会答"完全一致"并编造"相同路线"。事实性解释一律**零模型话术**按 `reasonCodes` 映射。
- **判"是不是真问题"先看 cases 的期望与 `fixture`**：M3 v0.7 的 10 个失败全不是产品缺陷（6 项判分口径冲突、3 项 `tool` 期望应升 `toolAnyOf`、1 项计数漂移、2 项期望落后）。
- **写多记录场景用例禁用"这次/那回"**（踩三次），除非显式构造 `turns` 给锚点。
- **评测口径**：`windowDays` 越界应**钳制**并写 limitations；判分必须含"最终交付成功"（否则超时降级被判通过，24/63 假阳性）；换路径答对可放宽（`requiredAnyOf`/`toolAnyOf`）、答错记选择错误；**绝不拿评测失败倒推能力面**；真实模型连跑会限流；提示质量有延迟代价（catalog purpose 500 字 → p50 16s）。
- **验证期间别并行跑评测与单测**：计时敏感用例会假失败（H1 回归时 2 fail，干净复跑 811/811）。

## 已拍板决策

- **P 系列**：P1 地图录像=轨迹回放纯前端 / P2 个人 demo+portfolio / P5 skills=领域工具面（10-23）；**P4 健康数据=仅现有 profile（maxHR/FTP/体重）** / **P7 窗口放开=口径变更，须开新 Run，旧结论不背书**（10-24）。待定：P3（主动性边界，G 前）、P6（计划自由度，F 前）、P8（assistant 原文上服务端，D 前）、P9（显式偏好层，建议延后）。
- **D-A1~A6**：A2 移除启用态 P1 业务正则兜底；A4 open_chat 拆出 companion（复用 `social`）；A5 取消 shadow/active（`CHAT_CLASSIFIER_MODE` 退役，`CHAT_CLASSIFIER_ENABLED=true` 即接管）；A6 Coze→硅基流动全迁 + Prompt 迁入代码库为唯一事实源（**骑后解读链路维持 Coze 不动**）；A1/A3 已并入 v0.4。
- **D-B**：B1 窗口职责分离 / B4 kb_qa+level_assessment 升真链路 / B6 健康档案只投影 weightKg·maxHeartRate·ftp **已确认**；B2/B3/B5/B7/B8/B9 按默认或待各工作项前确认。
- **模型选择**：主对话 `deepseek-ai/DeepSeek-V4.1-Flash`（10-26；V3.2 7/8@26.0s、Flash 7/8@4.4s、V4-Pro 6/8@9.0s）。**B5 交付基线：编排 61/63=96.8%、边界 110/114=96.5%，headers p50 1.98s**（V3.2 同口径 90.5%/93.0% @8.3s）。
- **路由口径变更（2026-10-27，非否定 AGT-A）**：原"12 路由 11 意图全保留"→ **16→3（`stop`/`deterministic`/`agent_loop`）**，意图不再作执行分派器；A 的意图体系/标注集/重评闭环保留为资产，开新 Run 并把旧结论标 `supersede`。归 **AGT-R（批次 2）**，H 阶段仍跑 16 路由。

## 多轮上下文机制（核对代码）

- **意图识别只看当前这一句**（分类器输入只有 `text`）。**摘要不参与路由**。
- 上下文在路由之后用，两条独立通道：① **锚点解析**（`chat-ride-anchor.ts`）——次序 = 显式日期 → 显式序数 → 上下文继承 → 澄清；锚点存**日期字符串**而非"最新"指针；生效路由 `current_ride`/`capabilities`/`history_compare`/`autonomous_tools`。② **表达层摘要**（`sessionSummaries`）只用于指代与话题延续。
- **摘要槽位白名单**：≤6 条、`question` ≤120 字、该轮 `route`、可选 `rideAnchor` / `choice{kind,id}`；**不含 assistant 正文**；非法整体静默丢弃（`summariesDropped`）。历史问题里的数字/日期**不是事实来源**。
- **确认轮是特例**：上一轮工具路由触发澄清（摘要挂起且 `rideAnchor` 空）+ 本轮纯确认语 → `detectAnchorConfirmation` → 用**挂起的原问题**重跑**规则路由**（`classifyChatInput`，非分类器）+ `anchorOverride` 重答。`pending.route ∈ RIDE_ANCHOR_TOOL_ROUTES`，`clarification` 不在其中。
- **设计代价（被追问要认）**：分类器无状态 → 可复现可评测，但纯指代追问单句判不出；"这次"在 4 条记录下触发 `TOOLS_ANCHOR_CLARIFY`。**已知缺口**：摘要无 assistant 正文。

## 对话链路与 Prompt

- Provider：硅基流动 OpenAI 兼容（`https://api.siliconflow.cn/v1`）；分类器 `DeepSeek-V4-Flash`、主对话 `DeepSeek-V4.1-Flash`。
- **Prompt 正文唯一事实源 = 代码库**（`src/chat/*-prompt.ts` 版本化常量），`prompts/*.md` 是归档副本；改完跑 `npm run prompt:classifier:sync` / `prompt:workflow:sync`。**判版本一律以代码常量为准**（曾三方漂移）。
- **防泄漏**：few-shot 只取标注集 `dev` split；意图示例一律泛化；有机械断言 + preflight 跨 split 重复检测。
- **超时现值**：主对话单轮 20s（评测设 `SILICONFLOW_CHAT_TIMEOUT_MS=35000`）、分类器 12s、L2b 整轮 90s（单次 35s）。

## 分类器 v0.4（冻结，资产保留）

- 标注集 `eval/ride-chat-classifier-v0.4/`：83 例（dev 13 / blind 60 / red-team 10），三轴 `split`/`intent`/`kind` + 9 组 `boundaryPairs`。签收 = **全量全对**，定版 `AEVAL-CLASSIFIER-20261023233648`（83/83）。唯一 MISS 归因：**"表现/整体表现"不是比较词**。
- 复合问法 = **单标签 + 主意图优先级**（红线 > 监督 > 计划 > 数据 > 知识 > 闲聊 > 域外）。成本 ≈¥0.3/全量，不构成约束。

## AGT-B 事实（工具面与循环）

- 工具面 **4 → 9**：`get_ride_context`/`get_capabilities`/`compare_rides`/`find_ride` + `get_health_profile`/`get_training_load`/`search_knowledge_base`/`get_ride_history`/`get_route_overview`。
- **30 天冻结只在 chat 层**（领域层 1..365）：`find_ride` 上限 365（**缺省 30**）、`compare_rides` 默认 30 **不放大**、`get_ride_history` 缺省 90/上限 365。
- **预算四值**：累计工具 **5** / 单轮 **4**（=并发）/ provider **6** / 整轮 **90s**。并行 = 分片（片内并行片间串行）+ receipts 按请求顺序落位 + **先全量校验再执行**（任一被拒整轮不执行）。
- **catalog 按路由裁剪**：autonomous_tools 9 全量 / kb_qa = KB+context+health / level_assessment = 档案·负荷·历史·路线+KB / none 空。`CHAT_TOOL_CATALOG_INPUTS` 是输入说明单一事实源，**必须写类型**（数组填成字符串 → 调用被拒 → 整轮失败）。
- **证据合同 `chat-tools-v0.2` / `ride-chat-output-v0.2`**：`claimIds` 与 `knowledgeIds` 按证据类型各自非空、可并存；双版本解析兼容 v0.1。`chatToolSpecs` 是工具合同单一事实源（anchorMode/evidenceKind/numericFacts/hasUsableEvidence）。
- **数字硬门**：等价类（`chat-numeric-evidence.ts`）+ 否定语境豁免（`hasUnnegatedHit`，前 14 字）+ 拒绝原因入 `loopTrace.validationRejections`。**线上不加 LLM 语义判官**。中文数字不受数字校验约束（刻意）。
- **`get_training_load`**：`computeRideTss`（`(NP/FTP)²×movingTimeS(h)×100`，**只用 movingTimeS**）是 `ride-pmc-load-v2` 唯一接线点。PMC 要 ≥42 天跨度 + ≥10 负荷日 → **演示 4 条必然 `INSUFFICIENT_LOAD_DAYS`**（正确行为）。
- `get_route_overview` 不可用时**不给任何里程字段**（给 0 会被说成"全是平路"）。
- **B4 边界**：AGT-D 范围**不含**锚点/指代消解；kb_qa 的"这次"澄清属路由级交互策略 → 归 AGT-C。
- **B5**：编排集**不测路由**（route 统一给定），路由归 M3 集。

## 评测口径（对外陈述前必看）

| 链路 | 数据集 | 案例数 | 每例重复 | 槽位 |
|---|---|---:|---:|---:|
| 骑后解读 · 基础合同 | `RA-AUTO-001~018` | 18 | 3 | 54 |
| 骑后解读 · 正式稳定性门 | `F01–F09` | 9 | 9 | 81 |
| 高阶解读 · A/B 冻结集 | `ADV-*` | 15（12 双臂 + 3 仅 B 臂） | 3 | 81 |
| 对话 Agent · 编排集 | `AEVAL-TOOL-ORCHESTRATION` v0.2 | 21 | 3 | 63 |
| 对话 Agent · 边界集 | `AEVAL-CHAT-BOUNDARY` v0.1 | 38 | 3 | 114 |
| 对话 Agent · M3 固定集 | `AEVAL-M3-CHAT` | 34（v0.6/v0.7） | 1 | 34 |
| 意图分类器 · 标注集 | v0.4（冻结） | 83 | 1 | 83 |

- **「27 × 3 = 81」不存在**：27 是 M3 v0.5 全量每例 1 次；两处 81 来自 `9×9` 与 `15 例 A/B`。重复次数表述：「把二值通过变成可观测失败率，按随机性敏感度定」，**不要说"避免概率事件"**（n=3 在 p=20% 检出率仅 48.8%）。
- **M3 v0.5 的 27/27 属历史结论**（Coze 时代），主对话已换模型 → 重验挂 C。**A/B 是上游事实输入的对照**（A 臂剥离高阶 Claim），不是两版 Prompt/模型。
- **制度**：动了评估资产或口径 → **全新 Run、不续跑、旧结论标 `supersede`**。
- **M3 三簇零覆盖**：`kb_qa`/`level_assessment`/`companion` 各 0 例；**具体日期 0 例、序数 0 例**。给生成层或"记录选择"打分前必须建新集。
- **已知短板**：稳定性门 9 例与盲评同源；盲评集无 red-team；第三视角仲裁实为维护者裁定。

## 环境与运维

- **分支/工作树**：主目录 `AI骑行伙伴-指导版_0827`（`main`）+ m2~m7 平级。工作树不共享未跟踪文件：拷 `.env.local`、`.env.production`、`.local-data` 再 `npm install`（**pnpm 本机不可用**）+ `NODE_DISABLE_COMPILE_CACHE=1 npx tsc --noEmit`。端口 3000=m4 / 3001=m6 / **m7=3002**。
- **safe-delete 守卫死锁**：`SAFE_DELETE_BULK_GUARD_ERROR state lock timeout` + git `index.lock`；须到系统终端 `rm -rf` 守卫 hash 目录重建。
- **本机验 API 两坑**：`curl POST /api/chat` 必须带签名会话 cookie（DEV_SECRET 在 `src/auth/session.ts`）；**必须加 `--noproxy '*'`**，否则 502 误判。
- **本地 env**：`.env.local` = `CHAT_MODEL_ENABLED=true` + `CHAT_PROVIDER_KIND=siliconflow` + `CHAT_CLASSIFIER_ENABLED=true`（本地分类器开启）；`.env.production` 仍写 `coze_workflow`（陈旧，重部署需核对）。API key 变量名是 **`SILICONFLOW_API_TOKEN`**（不是 `_API_KEY`）。
- **演示数据**：`test-data/demo-imported-rides/*.fit` 四条——`2026-10-05`(30.4km 心率) / `08-20`(31.1km 通勤) / `07-22`(161.8km 长途功率) / `07-18`(56km 起伏功率)。`DEMO_VALIDATION_BYPASS=on` 仅 demo；无资料时 seed 28 岁/175cm/72kg/192bpm/FTP 220。
- **线上** `https://ai-cycling-buddy.app.workbuddy.host/`；重部署须 `domainPrefix="ai-cycling-buddy"`、`startCmd="npm run build && npm start"`、部署前移出 `.local-data`。云端临时存储，重发布清空数据。

## 其他

- **V2.1 指标规范化（M6，定稿未实施）**：新 KB 7 维度 = V2 `analysisDimensionIds` 前 7；口径「LTHR 优先、maxHR 降级、provenance 标注」；KB 单条 ≈3KB → 工具投影必须裁 `excerpt≤600 字`、`maxEntries≤3`。
- **可复用流水线 skill**：`~/.workbuddy/skills/requirement-to-delivery-pipeline/`，校验 `python3 <skill>/scripts/check_delivery_docs.py <项目根> --docs-dir doc_Agent`，**0 FAIL 才自洽**；禁止双台账。
- **文档约定**：图示统一 Mermaid、不嵌截图；提示词与原始需求归档进项目文件夹；`doc_V2/*.pdf` 外部文献不入库。**给用户的决策文档正文用产品语言（体验问题 + 规则表 + 一句话总结），技术参数收进"开发口径"引用块**（2026-10-27 用户明确要求）。
- **骑后解读 ≠ 对话解读**：`/rides/[id]` 的 AI 解读由 URL `rideId` 驱动（任意单次）；对话里的单次解读走 `current_ride` + 锚点。
