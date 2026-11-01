# AI-Spec · 对话 Agent 能力规约 v2（集中合同文档）

- 建立日期：2026-10-27｜取代：[AI-Spec v1（已归档）](archive/AI-Spec_对话Agent能力规约.md)
- 结构依据：[Agent 结构设计与改造定案 v1.0](开发规划/2026-10-27_Agent结构设计与改造定案.md)｜[需求分析 v2](2026-10-27_骑行伙伴Agent改造_需求分析_v2.md)
- 命名修订（2026-10-27）：响应中的可点按钮由 `actions` 更名 **`quickActions`**，避免与系统能力枚举 `action` 撞名
- **事实源分工（最高原则，继承 D-A6）**：Prompt 正文唯一事实源 = 代码库（`src/chat/` 版本化常量）；本文档承载**合同**（路由/动作/交互/工具/上下文/输出/校验），代码与文档冲突视为缺陷须修复其一

---

## 1. 结构基线（v2 起，取代 v1 §2/§4 的 16 路由口径）

**三平面结构**（定案 SD-1~SD-12）：

| 平面 | 内容 | 状态 |
|---|---|---|
| 控制平面 | L0 硬闸（红线/纯问候/强聚合/写拒绝）+ 三路由 | AGT-R 落地 |
| 认知平面 | 统一 `agent_loop` + 四类能力注册表 + rideRef | AGT-R 落地（循环本体现役） |
| 交互平面 | 动作 7 值 + choice 状态 + artifact 通道 + quickActions | **AGT-H 落地** |
| 校验三层 | 文本证据（现役）/ artifact schema / 领域硬门 | H/F 递进落地 |

不变的基线（继承）：层级 1 + 监督单点 L2；模型不计算只引用；三段收敛（确定性收敛 → 一次受限修复 → 硬降级）；渐进放行四阶段。

## 2. 路由合同（SD-1）

```
route ∈ { stop, deterministic, agent_loop }
```

| route | 触发 | 承载 | 备注 |
|---|---|---|---|
| `stop` | 红线（急症/用药/危险骑行/实时路况/隐私/注入），`risk` 子标签区分 | 固定话术 | 永不进模型 |
| `deterministic` | 纯问候、强聚合、能力缺口、写拒绝、含糊 | 零模型直答 | 聚合数字服务端计算 |
| `agent_loop` | 其余一切 | 统一循环 | 唯一取数路径 |

16→3 映射表见定案 §6.1。分类器处置（D-S2）：先试删除（L0 之后全进循环），域外拦截不达标退二分类。

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

### 4.2 响应（输出合同 v0.3，新增两个可选顶层字段 + quickActions）

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
session_turn 槽位 = { question ≤120 字, route, rideAnchor(展示用), choice?: {kind, id} }
```

- `rideAnchor`（日期）降级为纯展示与日志；**跨轮选择记忆以 `choice.id`（rideId）为准**
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
| `ride_list.items` | 1~20 条，含 `rideId/dateLabel`，可选 `distanceKm/durationLabel/hasPower/hasHeartRate` | `totalCount/truncated` 可省略（缺省归一为"无截断"），显式给出时必须自洽 |
| `goal_options.options` | 1~8 条 `{id,label}`，同 id 去重 | 枚举值定稿归 D-H2（H4 前拍） |
| `quickActions` 上限 / 取值 | 4 条 / 仅 `deepAnalysis` | 同 `rideId` 去重；F 会新增计划类取值 |
| payload 体积 | `artifact.payload` ≤8KB | 与工具结果 32KB 预算分开计 |
| 非法处置 | **字段级整体丢弃**，不部分渲染 | 记录列表可点选——少一条会被当成"就是全部"，点错一条会分析错记录；响应退回纯文本追问 |

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
| 3 | **catalog 下发**：按路由裁剪（B3 机制）→ 全量 + 分工表（SD-8） | AGT-R 生效；`purpose` 写"用途+边界"，禁止写"不要用 X"（实测压制正确用法） |

写操作工具（`get_training_plan` / `log_plan_execution` / 确认令牌）合同仍按 v1 §3.3 占位，AGT-F 细规划定稿并入。

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
