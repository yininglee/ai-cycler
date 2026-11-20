# AI-Spec · 对话 Agent 能力规约（集中合同文档 · 骨架版）

> ⚠️ **已归档（2026-10-27）**：本文档为 v1（16 路由 + catalog 按路由裁剪口径），已被 **[AI-Spec v2](../AI-Spec_对话Agent能力规约_v2.md)**（三路由 + 交互合同 + rideRef）取代，移入 `archive/` 仅供追溯。v1 的工具合同表、Prompt 版本索引、评测资产索引仍被 v2 继承；路由/交互相关合同以 v2 为准。

> 建立日期：2026-10-23｜形态决策（2026-10-23 用户拍板）：骨架版——已定规约写实，未定部分留占位、随对应里程碑细规划定稿后递增（§11 增补记录）。
> 上游：[自主 Agent 改造需求分析](2026-10-23_骑行伙伴自主Agent改造_需求分析.md) §3/§4/§7｜[粗规划](开发规划/VIBE_CODING_Agent_开发规划.md)｜[AGT-A 细规划](开发规划/AGT-A_意图路由v0.4_工作项规划.md)｜[记忆调研](2026-10-23_会话上下文与记忆机制调研.md)。
>
> **事实源分工（D-A6 拍板，本文档最高原则）**：**Prompt 正文唯一事实源 = 代码库**（`src/chat/` prompt 模块版本化常量），本文档只做**版本索引**（§5），不内嵌、不复制 Prompt 正文。本文档承载的是：工具合同 schema、意图/路由映射、上下文 I/O 边界、生成约束、硬门规则、评测验收索引。代码与文档冲突时，以代码常量为 Prompt 事实源、以本文档为合同事实源，冲突本身视为缺陷须修复其一。

## 1. 文档定位

| 问题 | 答案 |
| --- | --- |
| 为什么需要本文档 | 需求分析 §4 与各里程碑细规划里的 AI 规约散落无统一索引；AGT-B 起每个新工具的合同 schema 需要中心化定义，避免每份细规划重复发明 |
| 什么时候更新 | 每个里程碑细规划定稿时，把该阶段 AI 规约（工具 schema、生成约束、硬门）并入本文档对应章节；执行进度不进本文档（进 [开发进度](开发规划/Agent改造开发进度.md)） |
| 不承载什么 | Prompt 正文（→ 代码库）；里程碑排期与工作项（→ 粗规划/细规划）；评测案例内容（→ `eval/` 冻结集与 manifest） |

## 2. 范式基线（引用结论，不复议）

- **层级 1 扩工具面为主体 + 训练监督单点层级 2（Plan-and-Execute）**；不上层级 3/4（需求分析 §3，粗规划 §1 锁定）。
- **派生指标计算由规则函数承担，LLM 只消费其输出叙事**（CTL/ATL/TSB、zone 时长、VI/EF 等走 `ride-pmc-load-v2`/`ride-zones`/`ride-derived-metrics-v21`）——任何阶段不得破坏。
- 输出校验根基：数字白名单 + claim 溯源（`chat-output-validation.ts`）+ 确定性收敛 → 唯一一次受限修复 → B0 硬降级三段链路——所有新任务簇复用，不另起炉灶。
- 渐进放行四阶段（影子 → 只读全自动 → 计划人机协作 → 监督自动化）作为产品放行骨架（需求分析 §9）。

## 3. 工具合同规约

### 3.0 合同模板（所有 chat 工具必须满足，对齐 `chat-tools-v0.1` 现行模式）

| 合同项 | 现值 / 约定 | 来源 |
| --- | --- | --- |
| schemaVersion | 每工具结果带 `schemaVersion` 常量，版本化演进 | `chat-tools-v0.1` |
| 超时 | `CHAT_TOOL_TIMEOUT_MS = 2000`；超时返回 `TIMEOUT` 错误码 | 现值 |
| 输入上限 | `CHAT_TOOL_MAX_INPUT_BYTES = 4KB` | 现值 |
| 结果上限 | `CHAT_TOOL_MAX_RESULT_BYTES = 32KB` | 现值 |
| 错误码 | `INVALID_INPUT / NOT_FOUND / TIMEOUT / TEMPORARY_UNAVAILABLE` 枚举 | 现值 |
| 返回投影 | 脱敏 **claim 投影**（claimId/kind/key/value/unit/displayValue/provenance/limitations），不回原始记录 | 现值 |
| 隐私投影 | 结果携带 `privacy` 排除声明数组（如 `precise_coordinates_excluded`），新工具逐一定义 | 现值 |
| 调用校验 | 白名单 + 参数 schema 校验 + 锚点合规 + 调用预算（`TOOLS_LOOP_*` 降级码） | L2b 循环 |
| 输入注入防护 | 工具结果回灌前视为不可信数据（沿用现有口径） | 现值 |
| **证据形态**（AGT-B 新增） | 每个工具结果声明 `evidence: {kind: "claims" \| "knowledge" \| "capabilities" \| "none", usable}` 与 `toolNumericEvidence(result)`；校验器按声明聚合，**不再按工具名分支** | [AGT-B 细规划](开发规划/AGT-B_只读工具面_工作项规划.md) §2 |
| **锚点类型**（AGT-B 新增） | **锚点工具**（`rideId` 必填或缺省锚点）与**全局工具**（无 `rideId`，无骑行记录也可用）两类；`TOOLS_NO_CURRENT_RIDE` 仅对锚点工具生效 | 同上 §2 G3 |

### 3.1 工具面全表（9 只读，AGT-B 实装完成）

> 合同单一事实源 = `src/chat/chat-tools.ts`（`chatToolSpecs` + 各工具结果类型）；本节是**索引与要点**，改合同必须同步此处。
> `anchorMode`：`required` = 必须绑定某次骑行；`optional` = 可绑定可全局；`none` = 全局工具。

| # | 工具 | anchorMode | 输入（键集） | 输出关键字段 | 证据形态 | 窗口 | 关键约束 |
|---|---|---|---|---:|---|---|---|
| 1 | `get_ride_context` | required | `rideId?` / `dims[]` | `claims[]` / `limitations` | claims | — | 单次指标明细；问"这次/那次多少"用它 |
| 2 | `get_capabilities` | required | `rideId?` / `caps[]`（**≤18 即全集**） | `capabilities[]`（含 `available`）/ `claims[]` | claims | — | 能力可用性；每个能力一条 claim（value 1/0）。**caps 上限已由 8 放宽到全集**——旧上限让"有哪些数据可看"的正确请求被判非法 |
| 3 | `compare_rides` | required | `rideId?` / `metrics[]` / `windowDays?` | `claims[]`（含 `status` / `reasonCodes` / `baseline`）/ `comparability` | claims | **30 固定** | 跨期比较；**速度类 `routeSensitivity=high` → 跨路线不可比（`ROUTE_SCOPE_REQUIRED`）是正确判定**；不可比走零模型话术，不放给模型解释 |
| 4 | `find_ride` | required | `rideId?` / `metric`（**单选字符串，非数组**）/ `mode` / `threshold?` / `metrics[]?` / `windowDays?` | `status` / `matches[].claims[]` / `reasonCodes` | claims | 缺省 30 / **上限 365** | 跨记录检索/排名；**只做检索，不查单次明细与路线形状**（写进 catalog purpose） |
| 5 | `get_health_profile` | none | `fields[]` | `facts[]`（含 provenance）/ 缺失明示 | claims | — | P4 拍板：**仅现有 profile**（weightKg / maxHeartRate / ftp），不接外部健康数据；不投影病理性字段 |
| 6 | `get_training_load` | none | `anchorDate?`（YYYY-MM-DD 或 today） | `ctl`/`atl`/`tsb` / **`ridesWithoutTss[{reason,count}]`** / 四类 `unavailable` 原因 | claims | PMC 口径 | TSS 时长**严格只用 `movingTimeS`**；PMC 需 ≥42 天跨度 + ≥10 负荷日。**`ridesWithoutTss` 必须结构化**——只在 limitations 里写字符串会让模型"说 4 次"时撞数字红线 |
| 7 | `search_knowledge_base` | none | `query` / `dimensions[]?` | `items[]`（`knowledgeId` + topic + `excerpt≤600 字`）/ 未命中返回维度清单 | **knowledge** | — | `maxEntries≤3`；**引用的 ID 必须来自本轮结果**（合法率 100%） |
| 8 | `get_ride_history` | optional | `rideId?` / `windowDays?` / `metrics[]` | 汇总 `claims[]`（次数/里程/时长/爬升）+ `rows[]`（≤20，逐条带 claims）+ `limitations` | claims | 缺省 **90** / 上限 **365** | 长窗口聚合专属出口；**`numericFacts` 必须包含 `rows[].claims`**——只给总计会让模型列明细时撞数字红线 |
| 9 | `get_route_overview` | required | `rideId`（**必填**）/ `segments?`（1~5，缺省 3） | 爬坡/平路/下坡里程占比 + `climbs[]` + `longestClimb` | claims | — | 路线形状；**不可用时不返回任何里程字段**（给 0 会被读成"全是平路"）；精坐标排除 |

**证据形态说明**：`claims` = 可引用 Claim（数字白名单来源）；`knowledge` = 可引用知识条目。两类**各自非空、可同时存在**（输出合同 v0.2）。`capabilities` 这一旧形态已于 2026-10-26 废弃——它不产生可引用证据，导致工具"可调用但不可作答"。

**阶段（B0~B5）分工回顾**：B0 落地合同与证据链基建（`chat-tools-v0.2` / `ride-chat-output-v0.2` 双形态）；B1 实装三个全局工具（含新增 `src/domain/ride-training-stress.ts`，`ride-pmc-load-v2` 由此首次接线）；B2 实装 `get_ride_history` / `get_route_overview` 并完成窗口解冻（P7）；B3 做循环扩展（分片并行 / 四值预算 / catalog 按路由裁剪）；B4 打通路由可达性（`kb_qa` / `level_assessment` 升真链路）；B5 完成评测资产与达标验证。

### 3.2 窗口口径（AGT-B 落地 P7）

| 能力 | 口径 |
| --- | --- |
| `find_ride` 窗口上限 | **365**（缺省仍 30）——纯检索，不产生比较结论 |
| `compare_rides` 默认窗口 | **30 不变**——"进步/退步"结论的样本口径，不随检索宽度放大 |
| `get_ride_history` | 缺省 **90**、上限 **365**——长窗口聚合的专属出口 |
| 变更性质 | 窗口放开 = **口径变更**（P7）：M3 对话评测须**开新 Run**，旧结论标 `supersede`，不作背书 |

### 3.3 写操作工具（AGT-F 引入，**全项目首个写路径**）

| 合同项 | 约定（AGT-F 细规划定稿后并入完整 schema） |
| --- | --- |
| 工具 | `get_training_plan`（读当前生效计划 + 执行进度）、`log_plan_execution`（打卡/偏差记录） |
| 确认机制 | 计划生效、强度调整等写操作**必须用户显式确认**，工具执行前带确认令牌 |
| 硬门 | 处方数值全部走 claim 等价类校验（`claimNumericVariants` 复用）+ 结构化 schema 硬门 + 周训练量增幅规则上限（规则硬门先行拒绝，LLM 不可越过；越界降级保守基线计划） |
| 降级 | 不过则降级"按保守基线"计划 + 说明（复用三段收敛链路） |

## 4. 意图与路由映射（16 → 16）

全景映射表以 [AGT-A 细规划 §2.1](开发规划/AGT-A_意图路由v0.4_工作项规划.md) 为准（本文档不复制表内容，防止双台账漂移）。要点：

- 意图 11 → 16（+5：`training_plan`/`training_supervision`/`level_assessment`/`kb_qa`/`companion`；收窄 2：`capability_gap`、`open_chat`）；路由 12 → 16（+4，companion 复用 `social`）。
- 新路由 AGT-A 阶段只到确定性占位模板（`deterministic_reply`，`allowModel=false`）；能力实装按 B/C/F/G 里程碑。
- 启用态失败分支：分类器失败/超时/限流统一"模型暂不可用"降级 + 事件码（D-A2：诚实失败优于错误猜测）；L0 快路径（红线/聚合/身份/问候）恒可用。
- `CHAT_CLASSIFIER_ENABLED=true` 即分类器接管，单一启用语义（D-A5），无灰度中间态。
- **复合问法（一句两意图）**：`intent` 始终是**单标签**（输出合同不允许数组）；一句含两个诉求时按主意图优先级取值——**红线 > 训练监督（存在可指涉计划/执行事实）> 训练计划 > 数据问答 > 知识解释 > 闲聊 > 域外**，次诉求由**回复层**承接（监督回复含调整建议 + 确认请求；计划回复先确认是否覆盖既有计划）。本集已含 4 例明确复合（`CLS-BLIND-45/49`、`CLS-RED-07/09`）。
- **复合问法重审的触发条件（2026-10-24 修订，原表述作废）**：旧口径"出现**必须两次工具编排**的问法"**不成立**——L2b 一次循环内就能多次调用（单轮并行 4、累计 5、provider 6 轮），"两次编排"不是障碍，按此去找永远找不到问题。真正的卡点是**路由级**的三件事：K1 catalog 按路由裁剪导致次诉求的工具不在场、K2 `outputRoute` 单一、K3 证据形态要求（已澄清为"各自非空、可同时存在"，故 K3 不构成阻碍）。**因此重审聚焦 K1**，判定口径 = 给定主标签单路由，次诉求是否"无事实也无知识支撑且只能以'另外问'收场"；处置三选一：L1 扩该路由 catalog 交集（首选）/ L2 回复层承接 / L3 升 `intents[]`（需动合同 v0.3 + 判分口径 + 全新 Run，**B 内不实施**）。执行细则见 [AGT-B 细规划 §5.5](开发规划/AGT-B_只读工具面_工作项规划.md)，结论在 `AGT-B4` 卡内成文。

## 5. LLM 调用管道与 Prompt 版本索引

**Provider（D-A6）**：对话链路（分类器 + 主对话）全迁硅基流动 OpenAI 兼容 API（`https://api.siliconflow.cn/v1`）；骑后解读链路维持 Coze 不动。**现行模型（2026-10-26 B5 收口）**：分类器 `deepseek-ai/DeepSeek-V4-Flash`、主对话 **`deepseek-ai/DeepSeek-V4.1-Flash`**（原 V3.2 已弃用：选型实测 Flash 版判断力不弱于 V3.2、优于 V4-Pro，且快 4~5 倍）。

> **版本索引漂移（AGT-C 细规划核对发现并修正，2026-10-26）**：本表原写主对话 `v0.2.3`，实测代码常量为 `v0.2.7`；归档副本 `prompts/ride-chat-workflow-v0.1.md` 头部版本行仍写 `v0.1.8`（正文已同步）。**代码常量为 Prompt 版本唯一事实源**，本表与归档头部行属登记项，须随每次同步更新——C1 把"头部版本行一致性"纳入单测（避免同一坑第三次复现）。

| Prompt | 版本 | 事实源位置 | 归档副本 | 状态 |
| --- | --- | --- | --- | --- |
| 意图分类器 | `ride-chat-classifier-prompt-v0.4.1` | `src/chat/chat-classifier-prompt.ts`（`CHAT_CLASSIFIER_SYSTEM_PROMPT` 常量，随请求直发硅基流动） | `prompts/ride-chat-classifier-v0.2.md`（归档副本，单测断言逐字一致） | ✅ AGT-A5 定版（83/83） |
| 主对话 | `ride-chat-prompt-v0.2.7` | `src/chat/chat-workflow-prompt.ts` | `prompts/ride-chat-workflow-v0.1.md`（`npm run prompt:workflow:sync` 对齐，单测断言逐字一致） | **B0~B5 累计**：v0.1.8 输出六字段（`knowledgeIds`）+ 数字等价类；v0.1.9 预算 4/5；v0.2.0 能力清单；v0.2.1 复合问题分别取数 + 检索类参数约束；v0.2.2 kb_qa 强制先检索；v0.2.3 清单补"支持分析哪些数据"；v0.2.5 删分工表（体积治理）；v0.2.6 数字规则补聚合条款（禁代算）；v0.2.7 跨调用依赖必须分轮。**AGT-C1 起升 v0.3.0 并拆为 base + 任务簇段（本表随之改为"模块清单 + 组装规则"）** |
| 分析叙事 / 水平评估 / KB 问答 / 陪伴 | 待定 | 待定（AGT-C 落地，按任务簇分模板） | — | AGT-C 并入 |
| 训练计划生成 | 待定 | 待定（AGT-F，附结构化输出格式约束 + few-shot 计划样例） | — | AGT-F 并入 |
| 监督反馈 | 待定 | 待定（AGT-G，两档输出：安全自动 / 需确认） | — | AGT-G 并入 |

> ⚠️ 已知坑（AGT-A3 已消除）：旧文件 `prompts/ride-chat-classifier-v0.1.md` 文件名按 schema 版本、内容是 prompt-v0.3，两套版本号并存。v0.4 起：代码常量为唯一事实源，归档副本 `prompts/ride-chat-classifier-v0.2.md` 只承载 prompt 版本，一致性由 `tests/chat-classifier.test.ts` 断言、`npm run prompt:classifier:sync` 一键对齐。
> 评测纪律（AGT-A3 新增）：few-shot 只取标注集 `dev` split；意图定义中的示例一律用泛化说法，不照抄任何 `blind`/`red-team` 原句（有机械断言），避免 blind 通过率因"见过原句"虚高。

## 6. 上下文输入规约（I/O 之 I）

| 上下文源 | 格式与限额 | 约束 |
| --- | --- | --- |
| 用户消息 | ≤1200 字符（`CHAT_INPUT_MAX_CHARS`） | 注入防护 `injection_stop` 沿用 |
| 会话上下文 | 分层混合：近 2~3 轮原文 + 更早轮白名单摘要 | **AGT-D 定稿后并入细则**；P8 隐私口径（assistant 原文上服务端）未拍板前维持纯摘要 |
| 长期记忆 | 三层（会话短期 / 领域结构化长期带 provenance+validFrom/validTo / 显式偏好——第三层视 P9 延后） | 按任务簇选择性注入；不引入外部记忆框架 |
| 工具 catalog + 结果 | 首轮 catalog 随行，后续脱敏 claim 投影；结果 ≤32KB | catalog 精简控 token（AGT-B 重标定预算） |
| 健康档案 | profile 字段白名单投影 | **绝对不给**：非运动健康信息、身份信息 |
| KB 检索结果 | 条目 ID + 内容片段 | 引用必须可校验回条目；未命中明示"知识库未覆盖" |
| 训练计划与执行状态 | 结构化计划 + 偏差摘要 | 仅监督场景注入（AGT-G） |

## 7. 生成任务簇输出约束（I/O 之 O）

| 任务簇 | 格式 | 必须满足 | 评测门 |
| --- | --- | --- | --- |
| 问答/分析/评估 | 自然语言 + 数字溯源 | 所有数字可溯源到 claim 投影（数字白名单）；评估结论限定规则派生事实叙事包装，推测进 limitations | 溯源通过率 ≥98% |
| KB 问答 | 自然语言 + 条目引用 | 引用 ID 合法性校验；未覆盖明示，禁止编造 | KB 引用命中率 ≥90% |
| 训练计划 | 结构化 schema（周/课表：日期×课型×强度区间×时长）+ 叙事 | 强度数值走 claim 等价类硬门；周量增幅受规则上限；确认制 | 计划专项冻结集 ≥15×3；采纳率 ≥60%；处方硬门违规 0 |
| 监督反馈 | 偏差陈述 + 调整建议 + 确认请求 | 两档：安全自动 / 需确认；**强度调整永远需确认** | 时序情景案例 ≥8 例 + 盲评 |
| 情绪陪伴 | 自然语言 | 非医疗/心理诊断声明话术边界 | red-team 安全路由触发 100% |

**幻觉约束统一原则**：无法回答 → "数据未记录/知识库未覆盖/超出我的能力范围"模板，禁止编造数字与 KB 条目（与骑后解读失败模板同构）。

**校验层口径（2026-10-24 定，AGT-B §2.1）**：线上输出门禁 = **纯确定性规则，零模型**，五层（schema → route → 长度 → 措辞词表 → 证据溯源）。**不引入在线 LLM 语义判官**——理由是延迟翻倍、判官错向"放行幻觉"、失败不可归因到规则、且治不了误拦根因。放宽的边界有两条红线：① 等价类只放宽**表达形式**（舍入/换单位/比例），事实来源仍必须溯源到本轮工具结果；② 语境豁免只覆盖**否定/声明短语**，词表内的危险断言照拦。**词表已知局限（2026-10-24 拍板，延后至 AGT-C）**："你患有 / 建议服用"类断言词不在 SAFETY_TERMS 内，输出层对这类越线句式不设防——输出层是**纵深**而非主防线（健康类问法在路由层被 `safety_stop` 拦，red-team 10/10）；词表校准与扩充由 C 的离线语义判官用真实样本驱动（含条件句安全话术"如果你患有…请就医"的豁免口径）。**"语义正确但被拒"的样本标注（离线语义判官）同样归 AGT-C 评测层**，不进线上门禁。

## 8. 输出校验与硬门（复用资产索引）

| 机制 | 代码资产 | 复用方式 |
| --- | --- | --- |
| 数字白名单 + claim 溯源 | `src/chat/chat-output-validation.ts` | 所有新任务簇直接接入；AGT-D 扩展白名单来源（provenance 标 `conversation`）；**AGT-B 起匹配口径由字面量相等升为等价类**（现 chat 层比骑后解读更严，属资产未接） |
| claim 数值等价类 | `src/ai/ride-interpretation-output-v04-candidate.ts`（`claimNumericVariants`） | 训练处方硬门直接复用（可换单位可舍入不可计算）；**AGT-B 也用它给 chat 输出校验做数字匹配** |
| 措辞类规则（注入/隐私/安全） | `chat-output-validation.ts` 三组正则 | **AGT-B 改造**：拆为"危险断言短语" + 窄范围否定/声明语境豁免（现规则会拦"不能做诊断""不会访问其他用户的数据"等安全声明，实测 2026-10-24） |
| 拒绝原因观测 | `outputValidation.code` + render trace | **AGT-B 补**：`validationCode` × 轮次 × 路由入 trace，用于量化误拦率（现只落 `fallbackCode=REPAIR_FAILED`，原因未聚合） |
| 四段校验器架构 | 解析归一 → 结构硬门 → 数值忠实 → 语言越界 | AGT-F 计划专项校验器复用此方法论 |
| 降级码体系 | `TOOLS_LOOP_*`（预算耗尽/非法调用）+ 新增不可用事件码 | 全链路沿用 |
| **输出合同 v0.2**（AGT-B） | `ride-chat-output-v0.2`：新增可选 `knowledgeIds[]`（≤6，`^kb-[a-z0-9-]+$`）；`claimIds` 与 `knowledgeIds` **按证据类型各自非空、可同时存在**（非互斥——复合回答"既给数据结论又给知识解释"是合法形态，见 §4 复合问法 K3 澄清）；两者皆空仍拒 | B0 实装；**动机**：`v0.1` 强制 `claimIds` 非空，KB 问答（知识无个人事实）在旧合同下必被拒 → 永远走 `REPAIR_FAILED` |
| 安全路由 | `safety_stop`（健康异常强制拒答转就医）、`privacy_boundary`、`injection_stop` | 红线零改动，新任务簇自动继承 |

## 9. 边界与安全兜底（P0 条款）

| 场景 | 兜底 | 状态 |
| --- | --- | --- |
| 训练强度越界（周量增幅超上限 / 强度超 CTL 支撑） | 规则硬门先行拒绝 → 降级保守基线计划 | AGT-F 实装 |
| 健康边界问询（胸闷/伤病/恢复异常） | `safety_stop` 拒答 + 免责话术 + 建议就医 | 现役 |
| 工具预算耗尽 / 非法调用 | 降级码 + 模板回复 | 现役 |
| KB 超范围 | 明示未覆盖，禁止编造 | AGT-C 实装（引用校验） |
| 写操作 | 确认令牌 + 用户显式确认 | AGT-F 实装 |
| 主动推送打扰 | 频控 + 免打扰时段 + 一键暂停监督 | AGT-G 实装 |

## 10. 评测资产与验收索引

以 [粗规划 §5 里程碑 × 评测资产 × 放行门对照表](开发规划/VIBE_CODING_Agent_开发规划.md) 为准。评测制度要点：动评估资产/口径 → 全新 Run、旧结论 supersede、不续跑历史 Run；bad case 回流 → 版本递增 → 新 Run。评测口径对外陈述前必查项目 MEMORY.md「评测口径」表（两个 81 槽不可混讲等历史坑）。

分类器标注集口径（三条轴 split/intent/kind、9 组对抗对、维护流程、已知局限）见 [`eval/ride-chat-classifier-v0.4/README.md`](../../../archive/pre-cycler-baseline-2026-11-20/eval/ride-chat-classifier-v0.4/README.md)；变更登记见同目录 `CHANGES.md`。**`kind` 只用于错误归因，不得用于放宽门槛**。

**AGT-B 三套对话评测资产（2026-10-26 全部冻结，preflight 锁结构与 SHA）**：

| 资产 | 规模 | 判分口径 | 状态与基线 |
|---|---|---|---|
| `eval/ride-chat-tool-orchestration-v0.2/`（AEVAL-TOOL-ORCHESTRATION） | 21 例（regression 13 / boundary 6 / negative 2）× 3 | **五项**：必需工具齐全 + `requiredAnyOf` 命中 + 无禁止工具 + 无拒调用 + **最终交付成功**（负例允许 `template` 且无 fallbackCode）。**不测路由**（route 给定，路由归 M3 集） | **已冻结 2026-10-26**（SHA `121c4b2f…`）；基线 **61/63 = 96.8%**（V4.1-Flash）。v0.1 标 `superseded`（ORCH-17 期望过僵） |
| `eval/ride-chat-boundary-v0.1/`（AEVAL-CHAT-BOUNDARY） | **38 例 / 10 组**（含 `anchor_deixis` 指代对照、`multi_turn` 多轮继承、写拒绝 3 例）× 3 | 单一口径 `behavior`：tool_executed / graceful_unavailable / safety_stop / reject_write / clarify / **no_write_refusal** | **已冻结 2026-10-26**；基线 **110/114 = 96.5%**（V4.1-Flash） |
| `eval/ride-chat-v0.7/`（AEVAL-M3-CHAT v0.7） | 34 例（继承 v0.6 cases，仅升能力面声明） | 沿用 M3 既有口径 | **已冻结 2026-10-24**（标 `supersedes: v0.6`）；Run 归 B6 |

**模型与基础设施（2026-10-26 B5 收口新增）**：
- **主对话模型 = `deepseek-ai/DeepSeek-V4.1-Flash`**。选型实测：V3.2 7/8 @26.0s、V4.1-Flash 7/8 @4.4s、V4-Pro 6/8 @9.0s（4 个工具选择用例 × 2 次）——**Flash 版判断力不弱于 V3.2、优于 Pro**。
- **provider 分阶段计时**（`onTiming` 回传 `headersMs` / `bodyMs` / `failurePhase` / `errorCode`）：**这是「网络 vs 平台 vs 我方」归因的唯一可靠依据**。判失败必须看 `totalMs` 是否恰等于 timeout 值（= 误杀）还是 85s 级固定值（= TCP 超时）；只看 `failurePhase` 分不出这三者。
- **限流退避重试**：`MODEL_RATE_LIMITED` 时按 8s / 16s / 24s 退避（最多 3 次），评测间隔需 **≥4s**。**注意：退避分支尚未被实测触发**（sleep=0 极限测试未见限流），仅经代码审查。

**判分口径的演进说明（比 D-B8 原定义多了两项，B5 实测驱动）**：① `requiredAnyOf`——同一诉求存在多条合法路径（都能答对）时不再写死单一工具（ORCH-09：`get_capabilities` 与 `get_ride_context` 任一）；② **最终交付成功**——只看"工具调没调"会把超时降级判成通过（第三轮 24/63 假阳性的来源）。`ChatOutputValidationPublic` 已补 `referencedKnowledgeCount`（B6 的 KB 引用统计前置）。

**用例编写纪律（B5 踩坑三次固化）**：多记录场景的用例**禁用"这次/那回"**（会触发 `TOOLS_ANCHOR_CLARIFY`，把系统正确行为记成失败），除非显式构造 `turns` 提供可继承锚点。

## 11. 增补记录（本文档按里程碑递增）

| 日期 | 里程碑 | 增补内容 | 状态 |
| --- | --- | --- | --- |
| 2026-10-23 | — | 骨架版建立：合同模板/现役工具索引/Prompt 版本索引/P0 条款；3.2/3.3/5/6 留占位 | ✅ |
| 2026-10-23 | AGT-A2 | 标注集 v0.4：83 例（dev 13 / blind 60 / red-team 10，16 意图全覆盖，SHA `9a4c242f…` 冻结候选）；覆盖策略 + **难度轴 `kind`（positive 53 / boundary 26 / ambiguous 4）** + **9 组对抗对**写入 manifest；`eval:classifier:preflight` 重写为 v0.4（含跨 split 防泄漏、kind 耦合、对抗对覆盖三重新增校验）；新增 `eval/ride-chat-classifier-v0.4/README.md` 用例说明 | ✅（冻结待用户批准） |
| 2026-10-23 | AGT-A3 | 分类器 Prompt v0.4 写入代码常量（16 意图定义 + 顺序判断规则 + 13 条 dev-only few-shot）；归档副本 `prompts/ride-chat-classifier-v0.2.md` + 同步脚本 + 一致性/防泄漏单测 | ✅ |
| 2026-10-24 | AGT-A2 | 三处边界张力经用户裁决（level_assessment BLIND-26 / training_supervision BLIND-45 / companion BLIND-31），与现有标注一致 → 数据集零改动、哈希不变；三条判据回写进 Prompt 判断规则第 2、4 条；**复合问法口径成文**（第 8 条：单标签 + 主意图优先级 + 次诉求由回复层承接；本集 4 例明确复合） | ✅ |
| 2026-10-24 | AGT-A4 | 评测脚本指向 v0.4：kind 分组归因（只诊断不放宽门槛）、kind 冻结一致性校验、run 记录升 v0.2（`runtimeMode`/`contracts`/`signOffReady`） | ✅ |
| 2026-10-24 | AGT-A5 | 两轮全新 Run（数据集冻结不变）：Run 1 `82/83`（`CLS-BLIND-01` 因"表现"一词误判 history_compare）→ prompt **v0.4.1** 给 history_compare 加"必须有对比参照或变化词"硬条件 → Run 2 **`83/83` 全对**（dev 13/13 · blind 60/60 · red-team 10/10；kind positive/boundary/ambiguous 全满）。分类器按 D-A5 启用（`.env.local`） | ✅ |
| 2026-10-24 | AGT-A5（回归） | 分类器之外三处缺陷（用户实测暴露，判定全对）：**R1** 前端本地正则兜底会猜答案（问心率答日期）→ 删除 `replyToChatInput`，失败统一诚实降级（落地 D-A2）；**R2** 主对话超时 8s→15s（实测 8.17s 成功样本）、分类器 8s→12s；**R3** `aggregate` 抽不出口径时答"我不会猜测骑行数据" → 新增 `aggregateOverviewReply` 只陈述已确定事实 | ✅ |
| 2026-10-24 | AGT-A6 | 里程碑收口：重评报告归档 `doc_Agent/AGT-A_意图路由v0.4_重评报告.md`（8 章，含 §6 六条口径局限）；粗规划 AGT-A 标 `Done` 并登记三条执行期偏离；A0~A5 全部 `Done`。**线上 `.env.production` 仍规则基线，启用分类器待用户决定** | ✅ **AGT-A 里程碑 `Done`（7/7，2026-10-24 用户验收）** |
| 2026-10-26 | **AGT-B7** | 里程碑收口：§3.1 骨架 → **9 工具完整合同表**（含新增四条「事实必须可引用」约束）；§3.2 窗口口径保留；§10 三套资产全部冻结（编排集 v0.2 / 边界集 v0.1 / M3 v0.7）并登记交付基线（**编排 96.8% / 边界 96.5%**）；新增模型选型、分阶段计时、限流退避三项基础设施说明；评测报告归档 `doc_Agent/AGT-B_只读工具面_评测报告.md`；粗规划 AGT-B 标 `Done` | ✅ **AGT-B 里程碑 `Done`（8/8，2026-10-26）** |
| 2026-10-24 | AGT-B（细规划） | **§3.2 骨架 → 定稿口径**：5 新工具合同要点（锚点类型/证据形态/隐私声明）+ §3.2.1 窗口口径（P7：`find_ride` 365、`compare_rides` 仍 30、`get_ride_history` 90/365，口径变更须开新 Run）；**§3.0 增补两项合同项**：`evidence` 声明 + 锚点两类；**§8 新增输出合同 `v0.2`**（`knowledgeIds` + 证据形态二选一）。细规划同时核对出**五个合同缺口**（列为 B0 前置），其中 G1/G4 是"新工具接进来也跑不通"的硬阻断 | ✅ 细规划已产出（**待用户评审 + D-B1~D-B8 拍板**；实装归 B0~B2） |
| 2026-10-24 | AGT-B（校验层实测） | **新增缺口 G6 + §7 校验层口径**：实测 8 探针 6 拒 2 过——数字严格字面量导致"大约 30 公里"（工具 30.4）、"50%"（0.5 ratio）误拦；三组措辞正则导致 `"不能做诊断"`/`"不会访问其他用户的数据"`/`"不会提供 api key"` 三类**安全声明被自身规则拦死**（会直接废掉 C 的非医疗诊断话术）；反向"三十公里"漏检。**定调：线上不加 LLM 语义判官**，B0 做等价类 + 语境豁免 + 拒绝原因观测，离线语义判官归 C | ✅ 决策已定（**D-B9**）；实装归 B0 |
| 2026-10-24 | AGT-B（复合问法） | **§4 重审触发条件修订**：旧表述"出现必须两次工具编排的问法"作废——L2b 一次循环内即可多次调用（单轮并行 4/累计 5/provider 6 轮），该条件永不触发。改为**路由级三卡点**（K1 catalog 裁剪 / K2 `outputRoute` 单一 / K3 证据形态），其中 K3 经澄清"各自非空、可同时存在"后不再是阻碍，**重审收敛为 K1**；处置阶梯 L1 扩 catalog（首选）→ L2 回复层承接 → L3 升 `intents[]`（B 内不实施）。执行细则见 [AGT-B 细规划 §5.5](开发规划/AGT-B_只读工具面_工作项规划.md) | ✅ 口径已修订（结论待 `AGT-B4` 出） |
| 2026-10-24 | AGT-B0 | **合同基建落地**：① `chat-tools-v0.2`（9 工具 + `chatToolSpecs` 证据声明 + 锚点两类）；② `ride-chat-output-v0.2`（`knowledgeIds`；双版本解析兼容 v0.1；证据"至少一种，仅知识证据时必须引知识条目"）；③ 数字匹配升等价类（`src/chat/chat-numeric-evidence.ts`，与 `claimNumericVariants` 有一致性单测）；④ 措辞三组正则改"未否定命中"判定（安全声明放行、危险断言照拦）；⑤ `ChatToolLoopTrace.validationRejections` 拒绝原因入 trace；⑥ 主对话 Prompt **v0.1.8** + `prompt:workflow:sync` + 归档副本一致性单测。验证：tsc 0 error、全量 **723/723**、新增 19 项正反例单测 | ✅ 已实施（`Review`，待用户验收） |
| 2026-10-24 | AGT-B0（审查收口） | **G6 处置拍板**：SAFETY_TERMS 词表校准与扩充延后至 **AGT-C**（用户选 (b)，13:31）——输出层词表是纵深（主防线在路由层 `safety_stop`），"你患有"类断言词的扩充与条件句豁免口径由离线判官用真实样本驱动；§7 校验层口径同步改写（原句"危险断言照拦"不准确，已改为"**词表内**的危险断言照拦"+ 已知局限）。**B1 范围修正**：TSS 输入链路为新增工作（`ride-pmc-load-v2` 全库零调用方、TSS 计算函数仅有 spec 公式无实现）；**B5 顺手项登记**：`ChatOutputValidationPublic` + `referencedKnowledgeCount` | ✅ 已落地 |
| 2026-10-24 | AGT-B1 | **三个全局工具实装 + TSS 链路补齐**：① 新增 `src/domain/ride-training-stress.ts`（`TSS = (NP/FTP)² × 时长(h) × 100`，moving 优先、四类 unavailable 不估算）——`ride-pmc-load-v2` 由此**首次接线**；② `get_health_profile` 按 D-B6 只投影三项 + `system_estimated` 原样透出；③ `search_knowledge_base` 规则检索（维度命中优先 → 关键词 → KB 原序；excerpt ≤600 字；未命中回可用维度）；④ `get_training_load` 组装 `dailyLoads`（Asia/Shanghai 日聚合）+ `ftpConfirmed` 门 + claimId `claim:training-load:v2:*`。验证：tsc 0 error、全量 **739/739**、16 项单测（四种 unavailable + KB 三态 + 32KB 上限） | ✅ 已实施（`Review`） |
| 2026-10-24 | AGT-B1（验收） | **验收修正**：TSS 时长口径严格对齐 V2.1 spec——`intensity.tss` 的 `dependencies` 只含 `timing.movingTimeS`，初版的"缺失退回 `elapsedTimeS`"会把通勤骑停歇算进负荷、系统性高估 TSS；已删除退回（`RIDE_TSS_RULES_VERSION` → `ride-tss-v1.1`），movingTimeS 缺失即 `DURATION_MISSING`。探针实测：demo profile 三项投影正确、KB 摘要 445 字完整句、"乳酸阈"命中为 KB 真实内容 | ✅ `Done`（用户委托验收，修正后 739/739） |
| 2026-10-24 | AGT-B2 | **窗口工具组实装 + `find_ride` 解冻**：① `get_ride_history`（Asia/Shanghai 日历日窗口、锚定日作窗口终点、汇总 claims 用领域指标键以支持 km/小时呈现、逐条行 ≤20 且截断写 `rows_truncated`、统计按全量算）；② `get_route_overview`（`buildRideElevationSummary` → `buildRideRouteShapeSummary`、`climbs[]` 按里程降序 + `segments` 截断、里程取整到米、**不可用不给任何里程字段**）；③ `find_ride` 上限 30→**365**（缺省仍 30）。验证：tsc 0 error、全量 **750/750**、12 项边界单测。⚠️ **P7**：窗口能力面变更已生效，M3 集在 B5 升 v0.7 开新 Run 前不得引用任何窗口相关旧结论 | ✅ 已实施（`Review`） |
| 2026-10-24 | AGT-B4 | **路由可达性 + 能力面收口**：① `kb_qa`/`level_assessment` 移出 `deterministicOnly` → `allowModel` + `tool_then_model`，`startLoop` 允许三路由，`training_plan`/`training_supervision` 仍占位；② capabilities 补**功能范围固定清单**（9 项含"支持分析哪些数据"，机械比对单测锁定）；`LEVEL_ASSESSMENT`/`KB_QA`/`CAPABILITY_GAP` 降级文案改写（不再说"规划中"）；③ **§5.5 复合问法重审结论 = L1**（扩 catalog），**否决 L3**（多标签不解决实测四类根因：catalog 缺口/说明不清/编排不足/锚点澄清/单轮超时）；④ 派生修复：catalog 类型说明（数组 vs 字符串）、Prompt 强制先检索与分别取数、**主对话单轮超时 15s→20s**。验证：tsc 0 error、全量 **765/765**、真实模型探针 C1/C4/C5 修补后 validated | ✅ 已实施（`Review`） |
| 2026-10-26 | AGT-C（细规划） | **细规划产出 + 三处核对修正**：① **§5 版本索引漂移修正**（主对话实为 `v0.2.7`，原写 v0.2.3；归档头部行写 v0.1.8）+ provider 模型更正为 `V4.1-Flash`；② 细规划新增两项错误码提案 **`OUTPUT_ASSESSMENT_OVERREACH`**（评估越界，仅 `level_assessment` 生效、完整短语匹配）与 **`CRISIS_REFERRAL`**（危机转介，走 L0 零模型）——定稿随 C3/C4 并入 §8；③ 生成约束按任务簇拆段（`base` + 8 段）与 KB 引用命中率口径（条目级 recall@3、边界组 ≥50% 权重、`graceful_uncovered` 不计入）待 D-C1/D-C2 拍板后并入 §7。**核查结论**：M3 v0.7 的 10 个失败全为判分口径/观测问题（0 产品缺陷），且该集无 kb/评估/陪伴用例 | 🔶 细规划已产出（待评审 + D-C1~D-C7）+ 版本漂移已修 |
| 待补 | AGT-C | 4 生成任务簇 prompt 版本索引、KB 引用校验规则细则、**离线语义判官（误拦样本标注）**、**SAFETY_TERMS 词表校准（G6 延后项）** | 占位（细规划已产出，定稿随 C1/C2/C3/C4 分批并入） |
| 待补 | AGT-D | 分层混合上下文细则、校验器白名单扩展口径（P8 拍板后） | 占位 |
| 待补 | AGT-F | 计划 schema、`log_plan_execution` 写路径合同、处方硬门规则、确认令牌机制 | 占位 |
| 待补 | AGT-G | 监督反馈两档输出 schema、推送频控参数、暂停机制 | 占位 |
