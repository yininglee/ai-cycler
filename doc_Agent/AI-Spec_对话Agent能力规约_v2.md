# AI-Spec · 对话 Agent 能力规约 v2（集中合同文档）

> **2026-11-02 执行流程修订**：以[当前开发规划](开发规划/VIBE_CODING_Agent_开发规划_v2.md)为准，先完成共用架构，再按 UX 五场景执行“场景 → 输入输出合同 → Agent 能力与界面 → 端到端验收”。单节点、任务级测评及专项建集／冻结／Run 前置暂缓；必要时再决策建集。本文已有技术合同和历史证据保留，旧排期、样本数、专项测评门槛不自动成为当前阻塞。类型／构建等工程检查、规则硬门和用户验收继续。目标合同不等于全部已实装；本次未更改代码 schema 版本。

- 建立日期：2026-10-27｜取代：[AI-Spec v1（已归档）](archive/AI-Spec_对话Agent能力规约.md)
- 结构依据：[Agent 结构设计与改造定案 v1.0](开发规划/2026-10-27_Agent结构设计与改造定案.md)｜[需求分析 v2](2026-10-27_骑行伙伴Agent改造_需求分析_v2.md)
- 命名修订（2026-10-27）：响应中的可点按钮由 `actions` 更名 **`quickActions`**，避免与系统能力枚举 `action` 撞名
- **事实源分工（最高原则，继承 D-A6）**：Prompt 正文唯一事实源 = 代码库（`src/chat/` 版本化常量）；本文档承载**合同**（路由/动作/交互/工具/上下文/输出/校验），代码与文档冲突视为缺陷须修复其一

---

## 0. 当前合同适用范围（ARCH-04，2026-11-02 更新）

本文区分现役合同、实施快照和目标合同。**共用校验与写确认扩展以 §15 为准，上下文沿用 §14，统一执行主链沿用 §13**；§12 保留 ARCH-01 改造前源码核对快照。共同的输入上限、HTTP 错误、证据与交互净化规则继续沿用；写确认和计划领域合同仍待后续实施。模型最终输出、HTTP 响应、工具调用与执行模式是不同协议，不共用一个版本号。

改造前合同与迁移约束保留作历史快照，不作为当前状态快照。本文只记录技术合同；架构与场景的状态、检查证据和验收结论统一见[开发进度](开发规划/Agent改造开发进度.md)。

## 1. 结构基线（v2 起，取代 v1 §2/§4 的 16 路由口径）

**三平面结构**（定案 SD-1~SD-12）：

| 平面 | 内容 | 状态 |
|---|---|---|
| 控制平面 | L0 硬闸 + executionRoute 三值 | ARCH-02 执行合同 |
| 认知平面 | 统一工具循环 + 能力注册（tools/knowledge/query，workflow 暂无实装） | ARCH-02/03 共用机制 |
| 交互平面 | 动作 7 值 + choice 状态 + artifact 通道 + quickActions | **AGT-H 落地** |
| 校验三层 | 文本证据（现役）/ artifact schema / 领域硬门 | H/F 递进落地 |

不变的基线（继承）：层级 1 + 监督单点 L2；模型不计算只引用；三段收敛（确定性收敛 → 一次受限修复 → 硬降级）；渐进放行四阶段。

## 2. 执行合同（SD-1，ARCH-02 实装）

正式聊天通过 `runChatAgent`，公共响应新增可选兼容字段：

```
executionRoute ∈ { stop, deterministic, agent_loop }
```

- stop：安全与授权边界，固定受控回复。
- deterministic：纯问候、明确精确聚合、范围／能力边界、澄清与尚未开放的计划能力。
- agent_loop：允许的数据、知识与分析请求均进入同一工具循环，由模型按完整可用目录选择工具。

`decision.route` 暂时保留旧 16 值，供历史会话读取、上下文语义和遥测使用；`allowModel` 与实际执行模式对齐。它不再选择数据执行器、工具目录或正式模型的证据校验分支。统一循环的模型协议 route 固定为 `autonomous_tools`，沿用 output v0.2，公开结果恢复旧业务标签；两种 route 不应混淆。

分类器本轮保留语义边界与上下文提示；已配置的分类器失败时保持明确终局降级，不绕过边界继续主模型。未配置分类器时，普通数据／知识问法进入统一循环；规则历史遗留的记录／水平能力缺口不再拦截已实现查询。具体迁移与保留项见 §13。

## 3. 动作合同（SD-3）

```
action ∈ { deterministic_reply, tool_then_model, safety_stop, reject,
            select, produce_artifact, confirm_write }
```

| 新增动作 | 语义 | 触发 |
|---|---|---|
| `select` | 出选项让用户选（记录/目标/计划槽位） | 指涉不明或要素缺失 |
| `produce_artifact` | 产出结构化交付物（记录列表/计划） | 分析/计划类回复 |
| `confirm_write` | 请求用户确认一次写操作 | 计划生效（AGT-F） |

**落地状态（AGT-H0，2026-10-27）**：7 值已在类型与校验层放开（`CHAT_ROUTING_ACTIONS` / `isChatRoutingAction`），`makeChatDecision` 仍只产出原 4 值——`select` / `produce_artifact` 由 H2 开始产出，`confirm_write` 归 F。契约先就位、行为零变化，是为了让 H0 的"全量零回归"可验证。

## 4. 交互合同（SD-5/6，AGT-H 实装）

### 4.1 请求（`/api/chat` 键白名单扩为 `{text, summaries, choice}`）

```jsonc
{ "text": "…", "summaries": [...],
  "choice": { "kind": "ride" | "goal" | "plan_slot", "id": "r-0820" } }
```

- `choice.kind="ride"` 时 `id` **必须是 `rideId`**（同日多条必须可区分）
- `choice` 进入编排后映射为工具调用的 `rideRef`（或计划要素）

### 4.2 响应交互载荷（interaction v0.3，非模型输出协议）

```jsonc
{
  "reply": "…（≤600 字，不变）",
  "choices": [ { "id": "r-0820", "label": "8月20日", "sublabel": "31.1 km · 有功率", "kind": "ride" } ],
  "artifact": { "kind": "ride_list" | "plan" | "goal_options", "payload": { } },
  "quickActions": [ { "kind": "deepAnalysis", "rideId": "r-0820", "dateLabel": "8月20日" } ]
}
```

- `choices` 与 `artifact{kind:"ride_list"}` 的关系：choices 是渲染用的扁平列表；artifact 是同一数据的合同载荷，二者由编排层同源生成，**不双写**
- 旧字段（`rideAnchor/trace/loopTrace/validation/repairAttempts`）全部保留
- 旧前端忽略新字段不报错（向后兼容）；新前端按字段渲染列表与按钮

### 4.3 状态（摘要槽位 v0.3）

```
session_turn 槽位 = { question ≤120 字, route, rideAnchor?, choice?: {kind, id}, rideScope?: overview|cleared|pending }
```

- 目标：`rideAnchor`（日期）降级为纯展示与日志，跨轮唯一选择以 `choice.id`（rideId）为准。ARCH-03 起优先使用唯一 choice，旧日期仅供旧摘要兼容与展示；作用域重置阻止旧日期重新继承，日期字段继续兼容保留。
- 槽位总数 ≤6 不变；非法整体丢弃规则不变
- 旧槽位（v0.2，无 `choice`）原样读取并传递——**不需要迁移、不清理用户本地历史**

### 4.5 交互载荷定稿值（AGT-H0 落地，2026-10-27）

> 合同事实源 = `src/chat/chat-interaction.ts`（`CHAT_INTERACTION_CONTRACT_VERSION = ride-chat-interaction-v0.3`）。本节记录**定稿后的数字与处置策略**，与代码不一致视为缺陷。

| 项 | 定稿值 | 说明 |
|---|---|---|
| `choices` 上限 | **8**（渲染层可再收窄，D-H1 建议展示 5 条 + 超出折叠） | 超上限按非法处理（**不悄悄截断**：截断后的列表看起来"就是全部"） |
| `choices` 去重键 | `kind + id` | 同 id 不同 kind 不算重复；去重保留首次出现的文案 |
| `choice.id` 形态 | `/^[A-Za-z0-9:_-]{1,128}$/` | 刻意不设前缀白名单（`upload-<uuid>` / `private-ride-0` / `r-0820` 都是实现偶然） |
| `label` / `sublabel` | ≤40 / ≤60 字符、非空、无控制字符 | |
| `artifact.kind` | `ride_list` \| `plan` \| `goal_options` | `plan` 的 payload 形状**留白归 AGT-F**，H0 只卡"对象 + ≤8KB" |
| `ride_list.items` | 1~20 条，含 `rideId/dateLabel`，可选 `title/distanceKm/durationLabel/hasPower/hasHeartRate` | `totalCount/truncated` 可省略（缺省归一为"无截断"），显式给出时必须自洽 |
| `goal_options.options` | 1~8 条 `{id,label}`，同 id 去重 | 枚举值定稿归 D-H2（H4 前拍） |
| `quickActions` 上限 / 取值 | 4 条 / 仅 `deepAnalysis` | 同 `rideId` 去重；F 会新增计划类取值 |
| payload 体积 | `artifact.payload` ≤8KB | 与工具结果 32KB 预算分开计 |
| 非法处置 | **字段级整体丢弃**，不部分渲染；ARCH-04 起，提供的骑行列表与选项／按钮还需引用一致，非法列表不保留依赖它的骑行操作 | 记录列表可点选——少一条会被当成"就是全部"，点错一条会分析错记录；响应退回纯文本追问 |

**模型输出协议不升版**：仍是 `ride-chat-output-v0.2`。`choices/artifact/quickActions` 由编排层从工具结果**同源生成**，模型不经手——所以模型没有伪造记录列表的通道，`parseOutput` 也不接受这三个键（多一个键即 `OUTPUT_SCHEMA_INVALID`）。

### 4.4 记录选择（rideRef，工具入参）

```jsonc
{ "rideRef": { "date": "2026-08-20" } }        // 绝对日期
{ "rideRef": { "ordinal": -1 } }               // 按出发时间倒序，-1=最近一次
{ "rideRef": { "rideId": "r-0820" } }          // 唯一标识（点选/前轮 choice）
```

| 工具返回 | 编排行为 |
|---|---|
| 解析成功 | 正常返回该记录 claims |
| `ambiguous` + `candidates[]`（含 rideId/日期/距离/有哪些数据） | 模型据此追问；候选同时提升为响应 `choices` |
| `need_reference`（未指明） | **不默认取最新**；模型追问或显式传 `ordinal:-1` |

## 5. 工具合同（继承 v1 §3 全表 + 三项 v2 修订）

工具面 9 只读工具的完整合同表以 [AI-Spec v1 §3.1](archive/AI-Spec_对话Agent能力规约.md) 为索引（合同事实源 = `src/chat/chat-tools.ts`，`chatToolSpecs`）。v2 修订：

| # | 修订 | 内容 |
|---|---|---|
| 1 | **记录类工具入参加 `rideRef`**（§4.4），逐步替代"锚点注入" | 先 `get_ride_context` / `get_route_overview`（AGT-H），其余随 AGT-R |
| 2 | **能力注册表分四类**（SD-7）：Tools / 知识库 / 数据查询 / 工作流 | 工作流类新增 `generate_training_plan`（AGT-F）、`reanalyze_ride`（复用骑后解读链路，AGT-H 接前端入口） |
| 3 | **catalog 下发**：从可用能力注册表统一下发，不按旧 route 裁剪 | ARCH-02 已实装；保留各工具 purpose 与输入合同 |

计划相关工具（`get_training_plan` 为读取，`log_plan_execution` 为写入）及确认令牌仍为占位；场景四／五定稿并入。它们目前不在九个现役工具中。

### 5.1 记录选择（rideRef）实装合同（AGT-H1，2026-10-27）

> 合同事实源 = `src/chat/chat-ride-ref.ts`（`chat-ride-ref-v0.1`）+ `chat-tools.ts` 的 parse/执行分支。已实装于 `get_ride_context` / `get_route_overview`。

| 项 | 定稿值 |
|---|---|
| 入参 | `rideRef`（`{date}` \| `{ordinal}` \| `{rideId}`，**恰好一个键**）；`rideId` 裸参保留为迁移期糖（退役归 AGT-R），与 `rideRef` 同给即 `INVALID_INPUT` |
| 缺省 | **不默认取最新**。缺省由执行层返回 `need_reference` + 候选；要"最近一次"必须显式 `{ordinal:-1}`（编排层注入时即写这个） |
| `{date}` | Asia/Shanghai 日历日；未给年份时按"当前年 → 上一年"取最近。命中多条 → `ambiguous(same_day_multiple)`，**不再取出发最晚那条** |
| `{ordinal}` | 负数，`-1`=最近一次；`-365` 下限；越界 → `not_found(ordinal_out_of_range)`（不是 `ambiguous`） |
| `{rideId}` | 走 `ownedRide` 归属校验（他人记录 → `NOT_FOUND`）；循环内还需在本轮 `allowedRideIds` 内，否则 `RIDE_NOT_ALLOWED` |
| `{date}/{ordinal}` 的越权面 | 由服务端在本人 `listRides` 内解析，**无需** allowlist（不存在跨用户读取） |
| 返回 | `RideReferencePendingToolResult { status: ambiguous\|need_reference\|not_found, reason, candidates[], limitations:["ride_reference:<reason>"] }`；**不是失败、不是空结果** |
| `candidates` | ≤5 条、按出发时间倒序；字段 `rideId / dateLabel / timeLabel(HH:mm) / distanceKm / hasPower / hasHeartRate`。`timeLabel` **仅用于同日区分**，不进 Claims |
| 循环回执 | `ChatToolLoopCallReceipt.status = "reference_pending"` → agent 以**零模型候选话术**收口（`fallbackCode = TOOLS_REFERENCE_NEEDED`）；H2 再把候选提升为响应 `choices` + `artifact{ride_list}` |
| 锚点层同口径 | `resolveRideAnchor` / `resolveAnchorConfirmation` 的日期解析同判多条 → `clarify(reason:"same_day_multiple")` + 候选，`candidates` 透出供 H2 复用 |

**为什么 `{date}` 命中多条算"未定"而不是"选最晚"**：同一天两次骑行是真实场景（早晚各一次），静默选一条 = 用户问另一次永远问不到——这正是待修缺陷本身。日期粒度无法区分的，必须交给 `rideId`（点选）或时刻/序数。

## 6. 上下文输入规约（I/O 之 I，v2 增补 choice 行）

| 上下文源 | 格式与限额 | 约束 |
|---|---|---|
| 用户消息 | ≤1200 字符 | 注入防护沿用 |
| 会话上下文 | 槽位 v0.3：`{question, route, rideAnchor, choice?}` ≤6 条 | `choice` 是唯一跨轮选择记忆；历史数字不是事实来源 |
| 多轮原文 | 近 2~3 轮原文 + 更早摘要 | AGT-D 定稿（前置 P8） |
| 长期记忆 | 三层（领域结构化 / 显式偏好视 P9） | 按任务簇注入 |
| 工具 catalog + 结果 | catalog 全量（SD-8）；结果 ≤32KB | 脱敏 claim 投影不变 |
| 健康档案 / KB / 计划 | 沿用 v1 §6 | P4 口径不变 |

## 7. 生成任务簇输出约束（继承 v1 §7，v2 增 artifact 行）

| 任务簇 | 格式 | 必须满足 |
|---|---|---|
| 问答/分析/评估 | reply + 数字溯源 | 溯源 ≥98%；评估不给评级/预测/处方 |
| KB 问答 | reply + knowledgeIds | 命中率 ≥90%；未覆盖零模型话术（C2） |
| **交付物类（新）** | reply（≤600 字叙事）**+ artifact（结构化载荷，不占字数额度）** | artifact 过 schema 校验；两通道证据同源 |
| 训练计划 | artifact{plan} + 确认请求 | 处方硬门（F）；确认制 |
| 监督反馈 / 陪伴 | 沿用 v1 | — |

幻觉统一原则不变：答不了 → 诚实模板。

## 8. 输出校验与硬门（三层，SD-9）

| 层 | 校什么 | 状态 |
|---|---|---|
| 文本证据 | claimIds/knowledgeIds 溯源、数字等价类、违禁词否证豁免 | **现役**（v1 §8 全部机制沿用） |
| artifact schema | 交付物形状/枚举/引用一致性 | AGT-H 新增 |
| 领域硬门 | 处方强度/周量增幅/恢复日/禁忌 | AGT-F |

新增错误码：`OUTPUT_EVIDENCE_MISSING`（事实性回答零证据，H）；`OUTPUT_ARTIFACT_INVALID`（H）；`OUTPUT_ASSESSMENT_OVERREACH`（C3，短语级匹配）；`CRISIS_REFERRAL`（C4）。线上门禁纯确定性、零模型判官（口径不变）。

## 9. 边界与安全兜底（P0 条款，继承 v1 §9 全表）

现役：`safety_stop` 族、预算降级码、KB 引用校验、写拒绝。新增：确认令牌（F）、artifact 校验（H）。

## 10. 评测资产与验收索引

三套对话评测资产（编排集 v0.2 / 边界集 v0.1 / M3 v0.7）状态与基线见 [开发进度](开发规划/Agent改造开发进度.md)；判分要点：**编排集按 `requiredTools/forbiddenTools` 断言、边界集按 `behavior` 断言——两套天然适配去路由化，直接作 AGT-R 主回归**；M3 按 `expected.route` 断言，升 v0.8 时改"能力断言"。AGT-H 新增交互用例（点选/候选列表/同日多条/跨轮 choice 继承）随 H6 落地。评测制度（新 Run、supersede、bad case 回流）不动摇。

## 11. 增补记录

| 日期 | 来源 | 内容 | 状态 |
|---|---|---|---|
| 2026-10-27 | 结构定案 | v2 建立：三路由/动作 7 值/交互合同（choice/artifact/quickActions/rideRef）/四类能力注册表/校验三层；v1 的工具表与 Prompt 索引经归档链接继承 | ✅ 待 AGT-H/R 分批实装 |
| 2026-10-27 | AGT-H0 | 交互载荷定稿值写入 §4.5（choices 上限 8 / 去重键 / id 形态 / artifact 三 kind / 体积 8KB / 字段级整体丢弃）；§3 补动作落地状态；澄清"输出合同 v0.3 = 响应层，模型协议仍 v0.2" | ✅ H0 已实装（合同事实源 `chat-interaction.ts`） |
| 待补 | AGT-H | 交互合同实测修订（列表密度 D-H1、candidate 字段定稿）、`reanalyze_ride` 工作流合同 | 占位 |
| 待补 | AGT-R | 三路由落地后的路由/动作分派表、catalog 全量分工表 | 占位 |
| 待补 | AGT-F | 计划 schema、写路径合同、硬门规则、确认令牌 | 占位（v1 §3.3 占位继承） |


## 2026-11-02 · UX-P3 / AGT-H 联调实装补记

- /api/chat 的 choice 请求通道现已启用 ride kind；goal / plan_slot 仍为合同预留、请求暂拒。id 还需排除纯日期并校验当前会话可见性。显式点选与摘要 choice 都映射唯一 rideId，失效不替换。
- 结构化卡片由完成工具结果中的 ID 与授权仓储记录同源投影；pending 只显示实际 candidates。新增可选 title（≤40字符）。正常有效回答可带 artifact/quickActions，澄清轮带 select/choices；纯知识查询未查记录时不凭快照附记录。
- 最近整体使用现有 level_assessment 自主工具循环，默认今天为止近30天；get_ride_history 默认省略参数在此场景归一为 rideId=null/windowDays=30，显式范围参数保持。回答范围来自工具，不从前端表单另建规则分析；单次选择不污染下一轮近期整体。
- 前端默认5条，可展开本轮至20条；更多记录用 totalCount/truncated 说明并导向骑行页。每项可用其已校验 artifact rideId 打开现有 v2 抽屉，不受 quickActions最多4条限制。
- 主 Prompt 当前候选 ride-chat-prompt-v0.2.9，分类器候选 ride-chat-classifier-prompt-v0.4.2；归档同步。v0.2.8 为历史撤回版本不复用。真实模型效果尚未重新评测，模型输出合同仍 ride-chat-output-v0.2。
- 上文“由 H2 后续实现”等为2026-10-27阶段记录，本补记及开发进度中的当前状态优先；H4目标选项与H6真实主回归仍未收口。

- 历史工具对模型投影包含实际 windowStartDate/windowEndDate、limitations/reasonCodes，以及每行真实 rideId；窗口日期进入数字事实白名单。整体评估优先按语义分类结果清除单次选择，不依赖用户恰好输入“最近表现”字样。

## 12. ARCH-01 共用合同与迁移约束（2026-11-02，改造前快照）

### 12.1 实现与验收状态核对

- **已验收资产**：AGT-A/B 历史结果、H0 类型与净化合同、UX-P1 用户验收继续有效。它们不为当前新增代码或新架构背书。
- **已有代码、尚未整体用户验收**：H1 rideRef；UX-P2 同步／导入与解读衔接；UX-P3 主链联调、choice、同源卡片与连续追问。本轮工程检查仅证明检查范围内当前代码通过，不能据此将其转 Done。
- **未完成的共用机制**：三路由执行、统一工具循环、与旧 route 无关的可用能力目录、route 迁移兼容、通用确认写入机制。
- **未完成的领域能力**：真实计划生成、计划 schema／版本／启用事务、计划执行关联与评估。`plan` artifact 接受对象不代表已经有业务校验；`confirm_write` 枚举存在不代表可执行写入。
- **边界保持**：平台授权同步是明确模拟；文件导入是真实能力；深度解读复用现有工作流和界面，当前不是 agent_loop 已注册工具。界面按钮可达与真实生成质量分别验收。

源码核对入口：`app/api/chat/route.ts` 的 POST、`chat-agent.ts` 的 runChatAgent、`chat-tool-orchestration.ts` 的 createChatToolLoopRunner/buildChatToolCatalog、`chat-tools.ts` 的 chatToolSpecs、`chat-artifacts.ts` 的 buildChatRecordInteraction，以及 `chat-session.ts` 与 `app/components/chat-home.tsx`。

### 12.2 现役入口、响应与错误合同

**入口**：`POST /api/chat`，Node.js runtime、JSON 完整响应、`Cache-Control: no-store`。前端逐步呈现已返回文本，不是模型 token 流。身份由服务端 session 取得，不接受客户端 ownerId。

**请求**：只接受必填 `text` 和可选 `summaries`、`choice`；未知顶层键拒绝。`text` 经现有网关规范化，最大 1200 字符／4KB；原始请求体上限为 4KB + 3KB + 256 字节。限流为同一 subject 每 60 秒最多 20 次。

- `choice` 仅接受精确 `{kind,id}`，当前入口只开放 `kind=ride`；ID 按 interaction 合同校验，并排除纯 YYYY-MM-DD。`goal/plan_slot` 虽在通用类型中，入口暂拒；日期不代替 rideId。
- 每次点选在当前用户可见仓储视图内验证，包含演示空白状态边界。摘要 choice 只提供指向线索，也须重新验证；不能信任客户端历史作为归属或事实证据。
- `summaries` 最多 6 条，白名单为 `{kind:session_turn,question,route,rideAnchor?,choice?}`，question 最多 120 字符；非法摘要整体丢弃、记录 dropped，当前问题仍处理。现役 route 仍为 16 值白名单。

**正常响应**：通常为 `ChatAgentPublicResult` 加规范化 `text` 和可选顶层 `choice`；包括 schemaVersion、decision、execution、modelInvoked、reply，以及可选 fallbackCode、rideAnchor、toolTrace、loopTrace、outputValidation、repairAttempts、choices/artifact/quickActions。`publicChatAgentResult` 去掉 providerRawOutput/toolContext 并净化交互字段；顶层 choice 在 API 装配，是前端写回摘要的当前选择。

现役存在提前返回 `{reply,text}` 的日期确认未命中分支，没有完整 agent envelope。消费方不得假设所有 200 响应一定有 decision/schemaVersion；统一响应在后续架构实施时处理，旧返回形状需兼容。

**HTTP 拒绝**：400 `INVALID_INPUT`；413 `INPUT_TOO_LARGE`；429 `RATE_LIMITED`；缺少身份或所选记录不可见返回 404 `NOT_FOUND`。记录不可见不区分不存在、他人、已移除等详情。当前前端对 404 统一显示重新选记录，其余 HTTP 错误显示通用不可用提示。

**业务降级**：模型未配置／不可用、工具失败、预算耗尽、无可用证据等通常以 HTTP 200 + reply/fallbackCode 返回。不能用 `response.ok` 判断模型回答成功；诊断还需 execution、fallbackCode 与 outputValidation。工具待选是可恢复交互，不是网络错误。

### 12.3 现役协议版本与能力合同

以下版本继续沿用，ARCH-01 不升版：

- Agent 公共 envelope：`ride-chat-agent-v0.1`；routing：`chat-routing-v0.2`，当前代码仍为 16 route。
- 模型最终输出：`ride-chat-output-v0.2`，保留旧 v0.1 解析；模型输出 reply、route、claimIds、capabilityKeys、knowledgeIds，禁止自行输出 choices/artifact/quickActions。reply 最多 600 字符且不超过 2KB，证据按本轮真实工具结果校验。
- 交互类型／净化：`ride-chat-interaction-v0.3`；choices 最多 8，记录 artifact 最多 20 项，quickActions 最多 4，payload 最多 8KB；前端默认展示 5 项。大于 5 的记录可从 artifact 直接点选／解读，不依赖只有 4 项的 quickActions。
- 工具定义／结果集合：`chat-tools-v0.2`；调用协议 `ride-chat-tool-call-v0.1`；目录 `ride-chat-tool-catalog-v0.1`；rideRef：`chat-ride-ref-v0.1`。这些版本不能相互替代。

**现役九个工具均为只读**：get_ride_context、get_capabilities、compare_rides、find_ride、get_health_profile、get_training_load、search_knowledge_base、get_ride_history、get_route_overview。chatToolSpecs 已承载 anchorMode、evidenceKind、合法入参与证据投影，是注册表可复用资产；尚无统一 availability/category/write-policy 注册合同。

**结果与错误**：工具调用先规范化再做严格参数校验；get_ride_context/get_route_overview 使用 rideRef，其他记录工具仍有 rideId 输入。工具循环回执为 completed/result、rejected/INVALID_TOOL_CALL 或 RIDE_NOT_ALLOWED、failed/工具降级码、reference_pending/pendingStatus/reason/candidates。reference_pending 要求选择或更正引用，不能被归并成空证据或查无记录的最终回答。

数据可用性与能力实现是两回事：已实现的心率工具遇到缺心率，应返回限制；能力未实现则不得出现在模型可调用目录。空骑行用户仍能调用知识库、个人基线等无锚点工具。知识没有命中、负荷基线不可信和记录不可比，各按实际结果说明限制，不补造证据。

单工具输入最多 4KB、结果最多 32KB、默认工具超时 2 秒；循环累计工具最多 5 次、单轮最多 4 次、provider 最多 6 次、墙钟预算 90 秒。预算耗尽后诚实降级，不以隐式重试绕过上限。

### 12.4 共用目标合同与迁移约束（待 ARCH-02～04 实装）

1. **执行决策**：实际分派只使用 stop/deterministic/agent_loop。旧业务意图与 route 可作兼容／遥测信息，不能继续选另一套取数执行器或工具目录。安全与精确聚合保持服务端确定性。分类器是删除还是保留边界判断，ARCH-02 结合现有 L0、语义边界、域外和失败行为决定并记录，不把失败降级静默改为已验证成功。
2. **能力目录**：在 chatToolSpecs 的输入校验、执行和证据声明之上，统一声明类别（tools/knowledge/query/workflow）、是否已实现／启用、锚点需求和副作用。模型目录与实际可执行白名单同源，只包含已实现、启用且当前可调用的能力，不按旧业务意图裁剪；缺数据由工具结果解释。工具目录的具体类型名和版本随 ARCH-02 代码变更同步，不先虚构已存在 API。
3. **模型与结构化产物**：事实回答继续经过证据校验；记录 ID 和记录卡片由服务端从本轮工具结果及可见仓储投影。澄清时使用实际候选；知识问答未查询记录时不凭快照附卡片。领域计划的模型生成结果须在服务端完成 schema 与规则校验后才能装配为草案，模型不得直接装配写确认凭据。
4. **上下文**：唯一记录选择使用 choice.id，rideRef 负责解析；明确日期／序数／点选的优先级及冲突澄清。新建对话不继承旧记录对象；同步只更新原对话。重新问总体时清除单次作用域；纯知识问题是否承接记录由问题上下文决定，不强绑个人结论。服务端每轮取事实，不沿用历史回复数字。
5. **兼容**：新三路由不能直接替换旧枚举后删除解析。必须同时处理 API decision、摘要 route 白名单、本地存储恢复、挂起确认识别、provider 输入及输出 route 校验、观测和现有工程检查。保留无 choice 的旧摘要，提供旧 route 到新执行语义的适配，或采用明确版本迁移；不清空用户历史来规避迁移。实施时记录具体映射、版本和回退办法。
6. **引用授权**：显式 choice、摘要继承、rideRef 和工具结果返回的 ID 均须验证；循环内继续执行 allowedRideIds 及归属检查。由日期／序数解析也必须限定在本人可见数据。失效对象要求重新选择，不自动换最新。独立安全请求不应因历史失效 choice 被拦截；此优先级须在统一入口中检查。
7. **范围**：现役近期整体默认截止今天近 30 天；工具提供实际窗口、记录数和限制。get_ride_history 当前只有 rideId/windowDays/metrics，不接受任意 startDate/endDate；不得承诺全部自定义日期表达已支持。绝对范围的输入、校验和统计合同在场景三补齐，不偷换为近 N 天。

### 12.5 写确认扩展约束（待 ARCH-04／场景四实装）

当前聊天工具注册表没有写工具。资料和目标已通过前端确认流程及 profile 接口保存，因此“计划是全项目首个写路径”的历史表述不准确；计划启用是待建设的 Agent 计划域确认事务。

共用机制至少要求：服务端识别用户、动作、目标实体、草案版本、确认凭据／有效性和幂等标识；模型文本、用户随口说“不错”和 plan artifact 本身都不能授权写入。客户端只发明确确认动作，服务端重读当前草案、检查版本与规则后执行。

版本过期、凭据不匹配、权限或规则校验失败均不得写入；同一确认重复请求不能生成多份生效计划，成功结果可重放。启用、替换未来安排和保留已完成记录的事务边界与审计须在场景四定稿。重试保留草案，不自动启用新版本。

ARCH-04 建立共用约束与可扩展验证机制，场景四再定实际 endpoint、请求／响应 schema、错误码、凭据时效及计划规则参数。当前不在 /api/chat 顶层新增 confirm 字段，也不注册虚构写工具。处方规则未落实前，计划保持不可启用。

实施状态、工程检查和验收结论统一见[开发进度](开发规划/Agent改造开发进度.md)，本文不重复记录。

## 13. ARCH-02 统一主链与能力注册（2026-11-02）

### 13.1 已实装的共用机制

事实源为 `src/chat/chat-execution.ts`（`chat-execution-v0.1`）、`chat-capability-registry.ts`（`chat-capability-registry-v0.1`）与 `chat-agent.ts` 的 runChatAgent。

- API 网关继续验证请求、身份与限流，L0 及可选语义分类提供边界和上下文提示；统一入口再次检查 L0，不能仅凭外部传入的良性 decision 跳过已知红线。
- runChatAgent 按 executionRoute 三值执行；允许的数据／知识请求只调用 runAutonomousToolLoop，不调用固定 toolRunner。六类旧数据标签均使用同一模型协议、工具目录与动态证据校验。
- 已有九个只读工具统一注册，类别为 tools/knowledge/query；workflow 类别预留但无可执行占位。注册信息包含 implemented、enabled、effect 和现有 spec。目录构造和循环调用准入均从可用注册集合读取；未实现计划生成、启用与执行评估工具不注册。
- 旧 catalog scope 名称仅作兼容别名，三种数据 scope 均返回全量九个工具；chatToolCatalogRouteOf 将六种数据标签统一映射 autonomous_tools。正式主链不依赖该旧标签适配器构造目录。
- 缺传感器数据由工具结果与 limitations 说明，不当作该能力未实现。无骑行记录可使用无锚点的个人档案／知识库工具。
- 纯问候零模型直答；简单精确汇总由仓储和规则计算。带“为什么／分析／建议／比较”等复合诉求的汇总不被 L0 聚合快路径吞掉，可进入统一循环查询和解释。

### 13.2 当前请求到输出的合同

请求顶层仍是 text/summaries/choice，没有新增客户端执行模式开关。executionRoute 由服务端计算，不能由用户或模型指定。HTTP 错误、正文／摘要上限、交互净化、隐私投影继续沿用 §12.2～3。

正常 Agent envelope 增加 executionRoute；decision.route 保留业务标签，decision.allowModel 与实际模式对齐。模型实际接收 autonomous_tools，并以此回传 output.route，校验后再由服务端返回原业务标签。旧本地历史和摘要不需要清空／更名；其 route 校验仍接受旧值。本轮不把 stop/deterministic/agent_loop 写入旧摘要 route 字段。

API 不再装配固定单工具 runner。未配置主模型时，不会先执行 compare_rides 等固定工具，也不会返回“上下文已取回待校验”作为正常答案，而是如实返回 MODEL_NOT_CONFIGURED；已有引用澄清可在模型前完成，已解析的日期可继续返回以供上下文恢复。

显式 choice 的结构错误仍拒绝；归属／有效性检查在实际读取记录时执行。对于独立安全、纯问候、精确汇总及能力占位回复，不使用历史或显式记录选择，失效 ID 不阻止这些回复；数据请求中的非法／越权／不可见 choice 仍返回 404，不换成最新记录。新测试覆盖这项优先级。

模型输出合同仍为 ride-chat-output-v0.2，交互合同仍为 ride-chat-interaction-v0.3；主 Prompt 升至 ride-chat-prompt-v0.3.0 并同步归档。统一循环允许纯知识回答只引用 knowledgeIds，个人事实继续要求实际 claimIds，复合回答可同时引用两类证据；不放宽数字、引用或安全检查。

### 13.3 分类器决策与范围

本轮保留已有分类器作为语义边界检查及上下文提示，避免在没有真实模型边界证据时删除纵深保护。仍使用旧分类协议返回业务标签，但这些标签不能选择另一条取数执行器或裁剪目录。分类器已配置时的失败保持显式降级；配置错误也降级，已知 L0 快路径仍可独立运行。

分类器未配置时，未知知识／数据措辞进入统一循环，并继续受工具白名单、归属、预算和证据校验约束；旧规则把“那次／历史骑行／能力水平”等标为能力缺口的情况，改为允许查询的上下文提示。明确请求制定计划／执行评估继续说明未开放。此处没有承诺所有语义变体都能正确理解；真实模型边界与生成质量尚未重新验证。

### 13.4 历史入口、兼容与回退

原固定工具执行器更名为 runLegacyChatAgent 并标注 deprecated，只供历史合同检查、旧测评资产和必要回退使用；正式 /api/chat 与现有编排预览均使用 runChatAgent，没有通过请求切换到旧执行器的入口。新入口即使收到兼容的 toolRunner 参数，也不会执行它。

历史固定链测试与 CHAT15/M3 旧脚本显式引用 legacy 名称，避免让旧 route/单工具断言冒充新架构能力验收。它们的历史证据继续保留，专项测评仍暂缓；新主链由新的集成检查和更新后的 API 联调检查覆盖。以后测评新架构时，需按新主链合同另行决策口径和 Run，不沿用 legacy 脚本成绩。

本项兼容方式是新增执行字段并保留旧元数据，不进行破坏式历史数据迁移。回退应恢复本项主链／目录／Prompt 的一致版本，不能只切回旧 Prompt 而仍使用新循环；也不能通过清空本地历史规避兼容问题。

实施状态、工程检查和验收结论统一见[开发进度](开发规划/Agent改造开发进度.md)，本文不重复记录。

## 14. ARCH-03 上下文与结构化交互（2026-11-02）

### 14.1 合同与兼容

共用事实源为 `src/chat/chat-context.ts`，合同标识 `ride-chat-context-v0.1`。请求顶层仍为 text/summaries/choice，不增加客户端选取执行主链的权限。API 响应及 session_turn 摘要新增可选 `rideScope`，允许三个值：

- `overview`：已切回近期整体，阻断旧单次选择和日期的继承。
- `cleared`：记录失效或文字与点选冲突，清除旧对象，用户需重新选择。
- `pending`：当前等待选择／确认，阻断旧对象，但允许“是的／最近一次／日期”完成挂起问题。

同一个摘要不能同时携带 rideScope 与 choice/rideAnchor；网关遇到冲突或非法值整体丢弃摘要，当前问题仍处理。旧无该字段的摘要和 localStorage key 继续读取，不清空用户历史；摘要仍最多六轮。前端将失效选择的 404 转成可保存的 cleared 槽位，避免下一轮重复携带坏引用。纯网络失败不冒充对象已失效。

### 14.2 记录对象与追问

- 中间的问候等中性轮不丢失选择：统一向前查找最近的唯一 choice，遇到作用域标记或旧版近期整体轮立即停止。日期兼容继承也遵循相同屏障；不能在 reset 后重新找到更早日期。
- 明确点选优先于隐式继承；文字明确指定日期、最近一次或序数时，不注入旧 choice。点选与文字对象冲突先请用户重新选择，不带旧对象执行。明确点选／单次指涉不会被“水平评估”标签误当近期整体。
- 支持“倒数第二次”等简单中文序数与数字序数；不存在或未识别的序号给候选，不回退为最新记录。无明确对象的“分析骑行数据”等请求先给候选；跨记录检索原有窗口基准与用户单次选择分开，保留既有检索口径。
- 服务端明确解析出的记录 ID 随 choice 返回，包括已选对象但主模型未配置的情况；确认后不只保存日期，同日多条也可继续定位。
- 纯知识问题不继承失效个人对象；保留问题摘要供理解概念，去掉传给该轮引用解析的个人 ID／日期。带“这次／我的”等个人指涉的问题仍验证对象，不把个人追问降为通用知识。
- “当前是哪一次”优先按唯一 choice 回答并展示日期／出发时间；切回整体或清除对象后不再声称默认分析最新一次。旧无作用域摘要仍保留日期兼容行为。

### 14.3 结构化结果与界面

记录卡片仍由真实工具结果和当前可见仓储投影生成；模型不生成记录 ID。多次历史查询采用本轮最后一次 get_ride_history 结果；候选先去重并过滤不可见 ID，再计算数量和截断状态。列表、choices 与 deepAnalysis 使用同一记录 ID。

近期整体及待选择轮不返回旧 choice/rideAnchor；分别返回 overview/pending。记录失效、冲突与缺项有明确继续路径。正常聊天仍复用现有列表、详情与解读抽屉，不增加常驻记录提示，也不恢复已撤销的“继续追问”按钮。同步更新原对话、新对话隔离及原有草稿／返回行为继续复用。

实施状态、工程检查和验收结论统一见[开发进度](开发规划/Agent改造开发进度.md)，本文不重复记录。

## 15. ARCH-04 共用校验与写确认扩展（2026-11-02）

### 15.1 范围与当前开放状态

新增服务端组件 `src/chat/chat-write-confirmation.ts`，合同标识 `chat-write-confirmation-v0.1`。该组件可供后续领域工作流接入，**没有新增 HTTP 写入口、计划实体、启用按钮或可执行计划工具**。当前九项模型工具继续只读；`plan` 对象占位、confirm_write 枚举和模型文字均不构成写入许可。资料与目标继续使用已有独立确认／profile 保存链路。

服务端通过 createConfirmedWriteService 注入事务存储与明确注册的 action handler。handler 必须提供 loadCurrent、validateSchema、validateRules、apply；schema 或规则缺失／不通过时不能签发或提交。没有注册 action 就不能签发凭据，未注册的请求返回 NOT_FOUND。生产环境尚未注册计划 action。

### 15.2 签发、绑定与提交合同

issue 只供可信服务端调用，输入为经过身份认证的 ownerId、action、targetId、idempotencyKey、ttlMs 及可选服务端时间。凭据有效期由领域接入明确指定，本项不提前决定计划时效。

签发过程在事务内重读当前草案，校验 schema 与领域规则，绑定用户、动作、实体、版本、内容摘要及幂等键。随机 token 使用 32 字节安全随机数；存储只保存 SHA-256 摘要，原 token 只在签发成功后返回，审计不记录原 token。内容摘要来自服务端内容的规范 JSON（对象键排序），拒绝循环、非 JSON 类型及非有限数字，不接受客户端自报摘要。

confirm 的身份由调用方从认证上下文传入，不从请求 body 读取。请求只能包含：

```
{ confirmed: true, token, action, targetId, version, idempotencyKey }
```

任何额外字段、自然语言“不错”、confirmed=false 或格式不合法均返回 INVALID_CONFIRMATION。`/api/chat` 没有因此开放 confirm 顶层字段，仍拒绝未知键。

提交时在同一事务内验证凭据绑定及有效期，重读当前草案；版本变化、同版本内容变化、对象不存在或校验不通过均不调用业务写入。成功后 apply 必须推进可确认版本或删除已消费草案；未推进返回 VERSION_NOT_ADVANCED 并回滚，以阻止不同凭据重复提交同一版本。

### 15.3 幂等、事务和审计适配要求

ConfirmedWriteStore.transaction 必须按认证用户隔离，并串行化冲突的实体、凭据和幂等键，**包含多进程场景**。业务状态、凭据消费、成功回执和 committed 审计必须原子提交或一起回滚；只按幂等键加锁不足以防止不同 key 同时启用同一版本。

成功回执绑定同一用户／动作／实体／版本／幂等键及 token 摘要。完全相同的已成功重试返回原结果，不重复执行 apply 或追加 committed 审计；凭据后来过期或草案后来修改也不影响同一成功回执重放。相同 key 换 token、实体或版本返回 IDEMPOTENCY_CONFLICT。尚未成功的过期凭据不能执行。

审计记录合同包括 schemaVersion、auditId、issued/committed 状态、动作、实体、版本、内容摘要、幂等引用摘要和时间；日志不保存原 token 或草案正文。审计失败必须导致事务失败，不能使用聊天 demo event 的 best-effort 吞错逻辑。异常保留未提交状态，满足前提时可重试。

当前 FileApplicationRepository 和 saveDemoEvent **不作为此原子端口的实现**；本项没有给它添加伪事务包装。场景四需实现实际领域存储适配器，确保版本推进、原子提交、跨进程互斥、凭据／回执持久化，以及账户清理和领域审计策略，再接启用入口。apply 只能操作同一事务内的领域状态，不得把无法回滚的外部操作伪装成已原子提交。

### 15.4 共用校验与预算收口

- 文本证据、数字、知识引用及安全检查保留；记录列表及动作继续来自服务端真实工具投影。
- interaction 原有结构校验之外，新增引用一致性：如果附带 ride_list，所有 ride choice 和 deepAnalysis 必须属于该列表。任一操作越出列表时整体丢弃对应 choices 或 quickActions；提供了非法 artifact 时也丢弃依赖其列表的骑行操作。没有 artifact 的旧独立选项仍兼容，结构化字段及模型输出 schema 不变。
- plan payload 仍只是对象形状占位；不将它当作已通过计划 schema、处方规则或写授权。新写确认服务要求领域 schema 与规则显式实现，不能以该占位净化结果跳过校验。
- 工具总数、单轮数量、超时及降级继续沿用。循环修复现在计入最多 6 次 Provider 调用；调用发起即计数，失败尝试也计入。第 6 次输出失败后不再发起第 7 次修复，转预算降级。该统计口径变化已更新工程检查，历史专项测评结果不用于证明新预算口径。

### 15.5 接入限制

确认服务的生产存储适配、领域规则与启用入口随场景四接通；不得用测试适配器或宽泛 plan 对象代替真实事务与处方校验。当前实施、检查与验收状态统一见[开发进度](开发规划/Agent改造开发进度.md)。
