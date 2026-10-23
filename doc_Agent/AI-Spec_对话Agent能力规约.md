# AI-Spec · 对话 Agent 能力规约（集中合同文档 · 骨架版）

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

### 3.1 现役工具（4 只读，索引）

`get_ride_context` / `get_capabilities` / `compare_rides` / `find_ride`——合同实现见 `src/chat/chat-tools.ts`，窗口冻结 30 天（AGT-B 放开后 `get_ride_history` 承接长窗口）。

### 3.2 AGT-B 新增工具（5 只读，schema 于 AGT-B 细规划定稿后并入）

| 工具 | 数据源 | 输出投影要点 | 隐私边界 | 状态 |
| --- | --- | --- | --- | --- |
| `get_health_profile` | `user-profile.ts` | 年龄/身高/体重/maxHR/FTP + provenance | 仅运动相关字段白名单；非运动健康信息、身份信息**绝对不给** | 骨架 |
| `get_training_load` | `ride-pmc-load-v2.ts` | CTL/ATL/TSB + 趋势 | 无敏感项 | 骨架 |
| `search_knowledge_base` | `ride-knowledge-base-v21.ts` | KB 条目 ID + 7 维度内容片段 | 公开知识无隐私；**引用 ID 必须可校验回条目** | 骨架 |
| `get_ride_history` | `ride-series.ts` + `persistent-history.ts` | 跨记录窗口统计（**新窗口口径，突破 30 天冻结**） | 聚合投影沿用 | 骨架；窗口口径变更按 P7 开新 Run |
| `get_route_overview` | `ride-route-shape.ts` | 路线形状/爬坡分段概要 | 精坐标仍排除（`precise_coordinates_excluded`） | 骨架 |

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
- **复合问法（一句两意图）**：`intent` 始终是**单标签**（输出合同不允许数组）；一句含两个诉求时按主意图优先级取值——**红线 > 训练监督（存在可指涉计划/执行事实）> 训练计划 > 数据问答 > 知识解释 > 闲聊 > 域外**，次诉求由**回复层**承接（监督回复含调整建议 + 确认请求；计划回复先确认是否覆盖既有计划）。本集已含 4 例明确复合（`CLS-BLIND-45/49`、`CLS-RED-07/09`）。改 `intents[]` 需动合同 v0.3 + 判分口径 + 重跑，**重审触发点挂在 AGT-B**（工具面落地后若出现必须两次编排的复合问法）。

## 5. LLM 调用管道与 Prompt 版本索引

**Provider（D-A6）**：对话链路（分类器 + 主对话）全迁硅基流动 OpenAI 兼容 API（`https://api.siliconflow.cn/v1`）；骑后解读链路维持 Coze 不动。模型选型推荐制：分类器 `deepseek-ai/DeepSeek-V4-Flash`、主对话 `deepseek-ai/DeepSeek-V3.2`，实施以硅基流动可用列表锁定。

| Prompt | 版本 | 事实源位置 | 归档副本 | 状态 |
| --- | --- | --- | --- | --- |
| 意图分类器 | `ride-chat-classifier-prompt-v0.4` | `src/chat/chat-classifier-prompt.ts`（`CHAT_CLASSIFIER_SYSTEM_PROMPT` 常量，AGT-A3 已写入，随请求直发硅基流动） | `prompts/ride-chat-classifier-v0.2.md`（归档副本，单测断言逐字一致） | ✅ AGT-A3 交付 |
| 主对话 | `ride-chat-workflow` v0.1 → 硅基流动版 | `src/chat/`（AGT-A0 原样搬运，语义演进挂 AGT-C） | `prompts/ride-chat-workflow-v0.1.md` | AGT-A0 搬运 |
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

## 8. 输出校验与硬门（复用资产索引）

| 机制 | 代码资产 | 复用方式 |
| --- | --- | --- |
| 数字白名单 + claim 溯源 | `src/chat/chat-output-validation.ts` | 所有新任务簇直接接入；AGT-D 扩展白名单来源（provenance 标 `conversation`） |
| claim 数值等价类 | `src/ai/ride-interpretation-output-v04-candidate.ts`（`claimNumericVariants`） | 训练处方硬门直接复用（可换单位可舍入不可计算） |
| 四段校验器架构 | 解析归一 → 结构硬门 → 数值忠实 → 语言越界 | AGT-F 计划专项校验器复用此方法论 |
| 降级码体系 | `TOOLS_LOOP_*`（预算耗尽/非法调用）+ 新增不可用事件码 | 全链路沿用 |
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

分类器标注集口径（三条轴 split/intent/kind、9 组对抗对、维护流程、已知局限）见 [`eval/ride-chat-classifier-v0.4/README.md`](../eval/ride-chat-classifier-v0.4/README.md)；变更登记见同目录 `CHANGES.md`。**`kind` 只用于错误归因，不得用于放宽门槛**。

## 11. 增补记录（本文档按里程碑递增）

| 日期 | 里程碑 | 增补内容 | 状态 |
| --- | --- | --- | --- |
| 2026-10-23 | — | 骨架版建立：合同模板/现役工具索引/Prompt 版本索引/P0 条款；3.2/3.3/5/6 留占位 | ✅ |
| 2026-10-23 | AGT-A2 | 标注集 v0.4：83 例（dev 13 / blind 60 / red-team 10，16 意图全覆盖，SHA `9a4c242f…` 冻结候选）；覆盖策略 + **难度轴 `kind`（positive 53 / boundary 26 / ambiguous 4）** + **9 组对抗对**写入 manifest；`eval:classifier:preflight` 重写为 v0.4（含跨 split 防泄漏、kind 耦合、对抗对覆盖三重新增校验）；新增 `eval/ride-chat-classifier-v0.4/README.md` 用例说明 | ✅（冻结待用户批准） |
| 2026-10-23 | AGT-A3 | 分类器 Prompt v0.4 写入代码常量（16 意图定义 + 顺序判断规则 + 13 条 dev-only few-shot）；归档副本 `prompts/ride-chat-classifier-v0.2.md` + 同步脚本 + 一致性/防泄漏单测 | ✅ |
| 2026-10-24 | AGT-A2 | 三处边界张力经用户裁决（level_assessment BLIND-26 / training_supervision BLIND-45 / companion BLIND-31），与现有标注一致 → 数据集零改动、哈希不变；三条判据回写进 Prompt 判断规则第 2、4 条；**复合问法口径成文**（第 8 条：单标签 + 主意图优先级 + 次诉求由回复层承接；本集 4 例明确复合） | ✅ |
| 2026-10-24 | AGT-A4 | 评测脚本指向 v0.4：kind 分组归因（只诊断不放宽门槛）、kind 冻结一致性校验、run 记录升 v0.2（`runtimeMode`/`contracts`/`signOffReady`） | ✅ |
| 待补 | AGT-B | 5 新工具完整参数/返回 schema、白名单与预算重标定值、catalog 精简口径 | 占位 |
| 待补 | AGT-C | 4 生成任务簇 prompt 版本索引、KB 引用校验规则细则 | 占位 |
| 待补 | AGT-D | 分层混合上下文细则、校验器白名单扩展口径（P8 拍板后） | 占位 |
| 待补 | AGT-F | 计划 schema、`log_plan_execution` 写路径合同、处方硬门规则、确认令牌机制 | 占位 |
| 待补 | AGT-G | 监督反馈两档输出 schema、推送频控参数、暂停机制 | 占位 |
