# 项目长期记忆 · AI 骑行伙伴

> 仅记录跨会话仍有效的项目事实与约定。日常流水见同目录 `YYYY-MM-DD.md`。

## 当前主线：M7 对话 Agent 自主化（`doc_Agent/`，分支 `codex/m7-agent-autonomy`）

- **需求结论**：✅ 优先引入 AI，但正确落地 = **L1 扩工具面 + 训练监督单点升 L2**，不上 L3/L4。`src/chat/` CHAT-17 L2b 已是受限单 Agent，改造是扩面非范式革命；"自主"的真实需求 = 工具自主编排（已有）+ 主动性（新，属调度基础设施）。六任务簇：问答/分析/水平评估/训练规划/训练监督/情绪价值。
- 训练规划+监督 = 中低容错 P0：处方数值走 `claimNumericVariants` 等价类硬门 + 计划确认制 + `safety_stop`；放行四阶段（影子→只读全自动→计划人机协作→监督自动化）。
- 新工具映射：`get_health_profile`(user-profile) / `get_training_load`(ride-pmc-load-v2 的 CTL/ATL/TSB) / `search_knowledge_base`(ride-knowledge-base-v21) / `get_ride_history`（**需放开 30 天冻结窗口**，须开新 Run）/ `get_route_overview`；计划实体+打卡为全新（第一个写操作工具）。派生指标仍由规则函数算、LLM 只叙事。
- **目录约定**：需求分析与调研留 `doc_Agent/` 根；粗规划、各里程碑细规划、进度统一放 `doc_Agent/开发规划/`。执行事实源 = `开发规划/Agent改造开发进度.md`，**验收汇报直接写在进度文档对应工作项下**（区别于 V2.1 写规划文档的惯例）。
- 粗规划 `VIBE_CODING_Agent_开发规划.md`：前缀 **`AGT`**，七里程碑 A（意图路由 v0.4）→ B（只读工具面 + L2b 扩展、放开 30 天窗口）→ C（生成层：分析/评估/KB问答 RAG/陪伴）→ E（影子轨 + 阶段1 放行）；D（上下文与记忆三层，前置隐私口径）可与 C 后半并行 → F（训练规划 + 写路径，阶段2）→ G（训练监督 + 主动性，阶段3）。
- **P1/P2/P5 已拍板（10-23）**：地图录像 = 轨迹回放纯前端渲染（不进本期工具面）、定位 = 个人 demo + portfolio、skills = 领域工具面（不做通用注册框架）。
- AGT-A 细规划：**7 工作项 A0~A6**（A5 全新 Run 需用户授权）。意图 11→**16**、路由 12→16（+4 新路由，`companion` 复用 `social`）；边界迁移：训练计划 `out_of_scope`→`training_plan`、水平评估 `capability_gap`→`level_assessment`（收窄保留）、新增 `training_supervision`/`kb_qa`、**open_chat 拆出 companion**（闲聊→social，open_chat 收窄为跨记录检索）。新路由在 A 阶段只到确定性占位模板、分类器未启用态规则基线。
- **D-A1~D-A6 已全部拍板（10-23）；AGT-A0 已 Done（用户验收 10-23，commits f769abe+50ed2c1，全量 705/705 + L2b 端到端验证；含 prompt v0.1.7 修复：DeepSeek-V3.2 会把 catalog 枚举候选照抄成数组，L2b 规则加单选枚举标量澄清）；AGT-A1 已启动（10-23 In Progress）**。D-A1 = v0.3 待授权 Run 合并进 v0.4 Run（一次授权）；D-A3 = 旧 capability_gap 水平评估例改标 level_assessment；D-A4 = open_chat v0.4 顺手拆。**D-A2 = 移除启用态 P1 业务正则兜底**（用户修订）：分类器失败/超时/限流统一"模型暂不可用"降级模板 + 事件码；L0 快路径（红线/聚合/身份/问候）保留为零模型正常路径；CHAT-12"不劣于规则基线"承诺修订为"诚实失败优于错误猜测"。**D-A5 = 取消 shadow/active 双模式**（用户提出"无线上概念"）：`CHAT_CLASSIFIER_MODE` 退役，`CHAT_CLASSIFIER_ENABLED=true` 即分类器接管（单一启用语义）；未启用 = 规则基线（P1 业务正则保留为其主路径）；A5 全对后启用、无灰度中间态；原 AGT-E"切 active"步骤消失（**AGT-E 影子轨仅指新工具 trace 观测，另一层概念**）。**D-A6 = 对话链路 LLM provider 全迁硅基流动（Coze 退役）**：分类器 + 主对话走 OpenAI 兼容 API（`https://api.siliconflow.cn/v1`），**Prompt 迁入代码库为单一事实源**（新增前置工作项 AGT-A0：客户端 + prompt v0.3/v0.1 原样搬运 + env 切 `SILICONFLOW_*`）；骑后解读链路**维持 Coze 不动**（V2.1 冻结结论继续有效，迁移须独立立项重跑验证门）；模型 = 分类器 `deepseek-ai/DeepSeek-V4-Flash`、主对话 `deepseek-ai/DeepSeek-V3.2`（推荐制，实施时以硅基流动可用列表锁定）；主对话换模型 → M3 固定集 v0.5 历史结论（27/27）不再适用新链路，重验挂 AGT-C 评测新 Run。
- 12 路由 11 意图**全部保留、无删除项**；远期重审点：`history_compare` 与通用循环分工、`aggregate` 窗口口径（均 AGT-B）、`capabilities` 清单（AGT-B/C）。
- 标注集 v0.4 总量 ≈**78** 例（"各新意图 ≥8 + companion ≥8"硬口径压倒"~50 例"表述）；签收 = 全量全对，gate 0.95 只是底线。
- 坑：`prompts/ride-chat-classifier-v0.1.md` 文件名按 schema 版本、内容是 prompt-v0.3，两套版本号并存。
- **文档体系补缺已拍板（10-23）**：① 业务交互 PRD **挂 AGT-F 细规划前置产出**（A~E 阶段无新前端交互面不提前写；F/G 的计划确认/打卡/推送交互在进入 F 细规划时作前置输入，与 P6 同步）；② **AI-Spec 骨架版已建** = `doc_Agent/AI-Spec_对话Agent能力规约.md`（集中合同：工具合同 schema/生成约束/硬门/评测索引 + §11 按里程碑增补记录）。**最高原则：Prompt 正文唯一事实源 = 代码库**（D-A6），AI-Spec 只做版本索引不内嵌 Prompt；各里程碑细规划定稿后把规约并入 AI-Spec 对应章节。

## 可复用资产：四级交付流水线 skill（2026-10-23 建，用户级）

- `~/.workbuddy/skills/requirement-to-delivery-pipeline/`，已注册。四级 = 需求分析 → 粗规划 → 里程碑细规划 → 进度文档，5 道交接门，附四份模板 + 一致性校验脚本。
- 用法：`python3 <skill>/scripts/check_delivery_docs.py <项目根> --docs-dir doc_Agent`，0 FAIL 才算自洽。
- 与 `ai-requirement-analysis`（阶段1 主体）、`plan-vibe-coding-project`、`orchestrate-ai-product-delivery`（英文三文档）的分工写在 SKILL.md；同时使用时**以本流水线的进度文档为唯一事实源，禁止双台账**。

## 评测口径（对外陈述前必看）

| 链路 | 数据集 | 案例数 | 每例重复 | 槽位 |
|---|---|---:|---:|---:|
| 骑后解读 · 基础合同 | `RA-AUTO-001~018` | 18 | 3 | 54 |
| 骑后解读 · 正式稳定性门 | `F01–F09` | 9 | 9 | 81 |
| 高阶解读 · A/B 冻结集 | `ADV-*` | 15（12 例 A/B 双臂 + 3 例对抗仅 B 臂） | 3 | 81 |
| 对话 Agent · M3 固定集 | `AEVAL-M3-CHAT` | 27（v0.5）／现 34（v0.6） | 1 | 27／34 |
| 意图分类器 · 标注集 | v0.3 | 38（含 red-team 6） | 1 | 38 |

- **「27 × 3 = 81」不存在**：27 是 M3 固定集 v0.5 全量、每例 1 次；两处 81 槽分别来自 `9×9` 与 `15 例 A/B`。
- 重复次数的统一表述：「把二值通过变成可观测失败率，按随机性敏感度定」。**不要说"避免概率事件"**（n=3 在 p=20% 时检出率仅 48.8%，会被反证）。
- v0.5（27 例，SHA `789c713f…`）已升 v0.6（34 例，SHA `9a837ccc…`），**v0.6 真实模型 Run 未执行**；`27/27` 属 v0.5 历史结论，须主动交代。简历口径以 `AI岗位简历改写建议_2026-09-13.md` 为准。
- **A/B 是上游事实输入的对照，不是两版 Prompt/模型**：A 臂剥离 `kind:"advanced"` 高阶 Claim（仅留基础），B 臂完整输入；同案例、同 Prompt/模型/重复次数，唯一变量 = 上游是否提供高阶事实。槽位 = 12×(A3+B3) + 3×B3 = 81。对抗案例只在 B 臂跑。该批次 D 硬门 **FAILED**（`-892`，合同通过 22/81 = 27.2%），失败聚类推动「确定性收口」路线，最终骑后 `FORMAL-08`（`AEVAL-RUN-20260906-955`）81/81 零降级首过门。⚠️ **两个 81 槽不可混讲**。
- **claim `kind` 实际只用 3 种**（demo-ride-2026-07-22 实测 107 条：`advanced` 94 / `feature` 9 / `relation` 4）。`metric` 是枚举遗留（`claim()` 默认 feature，从未显式写 metric）；`limitation` 改由 `questions[].limitations` 表达；`history` 被 S2-06 移出。**记录/计算/估算靠 `provenance`（recorded/calculated/estimated），不是 `kind`**。
- 一级分层轴是 **`split`**：`dev → regression → blind → red-team → product`。「常规/边界/对抗」不是项目词汇，是难度-覆盖轴的口语化描述；案例文件只有 `split`，没有 `tier`/`difficulty`。
- **硬门校验不叫"正则验证"**：四段 = 解析归一 → 合同硬门（约 35 校验点/50 错误码，全为集合运算）→ 数值忠实（正则仅分词，判定用 `claimNumericVariants` 等价类：舍入、`m/s↔km/h`、`s↔min/h`、`ratio↔%`；可换单位可舍入但**不可计算**）→ 语言越界（9 组 22 条正则）。处置链：确定性收敛优先 → 唯一一次受限修复（每槽 ≤2 次）→ B0 硬降级。`81/81 零降级` = 首轮 75 + 修复 6 + B0 0，**首次通过率 92.6%，"零降级"≠"无抖动"**；也不等于"模型自身引用正确率 100%"（收敛吸收了部分引用错误）。
- **盲评分歧处置**：分三类——锚点歧义（改指南锚点示例）／案例歧义（改文·改标·替换，必须重跑）／样本级真实分歧（取更贴近 Rubric 的口径 + 稳健性检验）。动了评估资产或产品资产**就必须全新 Run、不续跑历史 Run、旧结论标 `supersede`**；只有"仅改指南锚点且产品与数据集未变"才可只修不重跑（**项目从未执行过**）。时效：T002-V04 的 10 项锚点差异只记录未回炉；NO-GO 后修复→复评循环 2026-09-07 置 `Paused`；**唯一走通的完整重评闭环是意图分类器**（v0.2 `CHAT-13` 38/38；v0.3 `CHAT-17` 待授权）。
- **已知短板（被追问主动认领）**：① 稳定性门 9 案例与盲评样本同源，不是两条独立证据；② 盲评集内无 red-team，安全兜底全由机器硬门承担；③ 测评计划 §5.1 把用途轴与难度轴写在同一张表；④ 第三视角仲裁条款为"或"关系，实际两轮盲评均由维护者裁定。

## V2.1 指标规范化（M6，设计定稿未实施）

- 目的：明确各维度指标 + 换用维度化知识库。三条要求：模型输入以新 KB 关键指标为准（直取或规则计算）；旧库 batch1 换 `doc_V2.1/cycling_science_knowledge_base.md`；其余原则不变。
- 新 KB 7 维度 = V2 `analysisDimensionIds` 前 7 个，一一对应；V2 缺约 20 个派生指标（VI/EF/VAM/爬坡 Wkg/Pw:Hr 解耦/负分割/RS/踏频 CV 等），共享指标 VI/EF 只算一次。
- 两处口径冲突已定：心率区间对齐为「LTHR 优先、maxHR 降级、provenance 标注」；输入准绳由「详情页字段覆盖矩阵」切为「KB 关键指标覆盖矩阵」（字段矩阵降级为审计索引、不回退）。
- 架构增量：`ride-derived-metric-spec-v21.ts` + `ride-derived-metrics-v21.ts` + `ride-knowledge-base-v21.ts`（`ride-kb-2.1.0` 替换 `ride-kb-batch1-1.0.0`）。交付在 `doc_V2.1/`，任务前缀 `V21`。
- 口径：心率恢复指标"有停表后数据才算、无则进 limitation、不新开开关"；V2.1 评测须在 V2 发布门评测之后开新 Run。

## 分支与工作树

- 主目录 `AI骑行伙伴-指导版_0827`（`main`）+ m2~m7 平级目录：m2 prd-ai-riding-partner、m3 prd-ai-riding-partner、m4 refactor-agent-capabilities、m5 m3-optimization、m6 m4-optimization（V2.1）、**m7 agent-autonomy（基于 m6，10-23 建）**。
- 命名：目录 `AI骑行伙伴-指导版_0827-m<N>-<主题>`，分支 `codex/m<N>-<主题>`。
- worktree 不共享未跟踪文件：新树须从源树拷 `.env.local`、`.env.production`、`.local-data`，再 `npm install`（**本机 pnpm 不可用**）+ `NODE_DISABLE_COMPILE_CACHE=1 npx tsc --noEmit`（不加该变量会被沙箱拦编译缓存删除，报假错）。拉新树前源分支必须先提交干净。
- 端口：3000 = m4，3001 = m6，m7 用 3002。

## 环境故障：safe-delete 守卫死锁（10-23 实踩）

- 症状：任何删除/覆盖都报 `[safe-delete][SAFE_DELETE_BULK_GUARD_ERROR] state lock timeout`，连带 `git add/commit` 报 `index.lock: File exists`；`mv`、`os.rename`、`git update-ref` 同样被拦。
- 根因：守卫目录下 `.lock` 变成了**空目录**，且 `state.json` 只剩 `.tmp` 版。**重启客户端无效**（坏的是磁盘状态）。
- 修法：到系统终端 `rm -rf` 守卫 hash 目录让它重建，再清各树的 `index.lock`/`HEAD.lock`/`refs/heads/*.lock`。见 `SAFE_DELETE_BULK_GUARD_ERROR` 就不要再在会话内试删除或找 git 绕行，直接请用户去终端。

## 演示与发布

- 演示记录四条（`test-data/demo-imported-rides/*.fit`，按骑行时间倒序）：`demo-ride-2026-10-05`(30.4km 心率) / `08-20`(31.1km 通勤) / `07-22`(161.8km 长途功率) / `07-18`(56km 起伏功率)。R03 脚本须用 demo-ride id。
- **校验旁路开关（仅 demo）**：`.env.local` 置 `DEMO_VALIDATION_BYPASS=on` → 首轮输出直接展示（校验器仍跑并记 issue，前端显示演示角标，**演示即失败率探针**）。缺省 off 与正式链路逐字节一致；**评测脚本永不读此开关**。背景：R02 firstPass 仅 5%、95% 靠修复轮（60–142s）。
- 线上 `https://ai-cycling-buddy.app.workbuddy.host/`。重部署要点：`domainPrefix="ai-cycling-buddy"` 必填（复用 app、链接不变）、`startCmd="npm run build && npm start"`（`.next` 被排除上传，build 必须并入）、部署前移出 `.local-data` 部署后还原；`.env.production` 含全部密钥 + `DEMO_VALIDATION_BYPASS=on`（与 `.env.local` 双份，local 优先）。云端是临时文件存储，重新发布清空线上数据（每会话 seed 基线）。
- 个人资料演示基线：`/api/profile` 在无资料时 seed 28 岁/175cm/72kg/192bpm/FTP 220，时间戳固定 `2026-10-08T04:37:10.707Z`；关闭用 `DEMO_PROFILE_SEED=off`。这是演示默认值，非产品行为，不覆盖已有真实资料。

## 文档约定

- 图示统一 Mermaid 代码块，不嵌截图；补充图表只输出图形本身。
- 任务相关提示词与原始需求归档到项目文件夹。
- `doc_V2/*.pdf`（25–52MB 外部文献）不入库，自产 md 正常跟踪。
