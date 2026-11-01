# AGT-H · 交互骨架（批次 1）工作项规划（细版）

- 细化日期：2026-10-27｜所属：[开发规划 v2](VIBE_CODING_Agent_开发规划_v2.md) 里程碑 AGT-H｜结构依据：[定案 v1.0](2026-10-27_Agent结构设计与改造定案.md)｜执行事实源：[Agent 改造开发进度](Agent改造开发进度.md)
- 前置：**D-S1~D-S4 拍板**（定案 §6.2）；本细规划内含 D-H1~D-H3 于 H2/H4/H5 前拍板即可

## 1. 产品目标（一句话）

用户说"分析一下我的骑行数据"时，系统能**问"哪一次"并展示可点选的记录列表**；用户点选或回答后**基于那条记录**生成分析，回复末尾带**【查看深度分析】入口**；轻问只给轻答并引导深入。场景①②端到端可用。

**非目标**：不删任何路由（去路由化归 AGT-R）；不做训练计划（归 AGT-F）；不改分类器；不动 compare/find 的入参（rideRef 只接两个先行工具）。

**进入条件**：结构定案 D-S1~D-S4 已拍板（认可三平面方向与 AGT-H 插入位置）。**退出条件**：见各工作项（汇总 = 场景①②端到端演示通过 + 两套主回归零退化 + 用户验收）。

## 2. 现状代码基线核对（规划期已核）

| 事实 | 位置 | 对 H 的意义 |
|---|---|---|
| 追问话术已存在 | `chat-ride-anchor.ts:116-121`（`latestClarifyReply`） | H2 复用话术骨架，替换为"候选 + 追问" |
| 记录清单数据已在手 | `app/chat/page.tsx:9`（`listRides` 结果被 `buildChatHomeSnapshot` 丢弃） | H4 只需把列表投给前端 |
| 深度分析链路完整 | `/api/ride-analysis`（V1/v2 引擎）+ `RideAiAnalysis`/`InterpretationSheet` 组件 | H5 纯前端装配 |
| 请求白名单只有两键 | `app/api/chat/route.ts:90` | H3 扩 `choice` |
| 确认轮只认三形态 | `chat-ride-anchor.ts:202-227` | H3 扩第四形态（点选回传） |
| 响应无结构化载荷 | `chat-agent.ts` `publicChatAgentResult` | H0 加 `choices/artifact/quickActions` |
| 摘要槽位无 choice | `chat-session.ts:11-17` | H0 升 v0.3 |
| 锚点同日多条取最晚 | `chat-ride-anchor.ts:70-87` | H1 rideRef 用 `rideId` 根治 |

## 3. 工作项（H0~H6）

### AGT-H0 · 合同定稿与兼容层

- **进入条件**：结构定案 D-S1~D-S4 已拍板（认可三平面与 AGT-H 插入位置）。
- 目标：动作 7 值、输出合同 v0.3（`choices` / `artifact` / `quickActions` 三个可选顶层字段）、摘要槽位 v0.3（`choice {kind,id}`）在类型与校验层落地；**双版本解析兼容**（旧摘要/旧输出照常，不破坏现役链路与 704+ 单测）。
- 关键约束：新字段全部 optional；旧前端忽略不报错；`quickActions` 命名修订同步进 AI-Spec v2（已改）与代码常量。
- 退出条件：tsc 0 error；全量单测零回归；新增 ≥10 项合同正反例单测（非法 choice 结构整体丢弃、choices 去重、artifact kind 枚举）。

### AGT-H1 · rideRef 工具参数（先行两工具）

- **进入条件**：AGT-H0 完成（合同已定稿）。
- 目标：`get_ride_context` / `get_route_overview` 入参支持 `rideRef {date|ordinal|rideId}`；解析成功返回该记录；`ambiguous`（同日多条/序数歧义）返回 `candidates[]`（`rideId`、日期标签、距离、有无功率/心率）；未指明返回 `need_reference`（**不默认取最新**）。
- 范围：这两工具的 `anchorMode: required` 语义改为"必须有 rideRef"；锚点注入通道（`RideAnchorOverride`/确认轮）映射为 rideRef 之一，**不删除**（退役归 AGT-R）。
- 退出条件：同日两条 fixture 下点选/日期/序数三路全部唯一定位；`candidates` 字段有单测；编排集/边界集零回归（这两集不按 route 断言，但工具入参变化须跑）。

### AGT-H2 · select 动作与候选提升

- **进入条件**：AGT-H1 完成（工具已能返回 candidates）；D-H1 已拍板。
- 目标：编排层把工具返回的 `ambiguous`/`need_reference` 提升为响应 `choices` + `artifact{kind:"ride_list"}`；追问话术分两档：**确定性档**（零模型，含候选日期范围）与**模型档**（循环内模型自己追问，话术由 prompt 段约束）。
- 决策 **D-H1（列表密度）**：建议"最近 5 条 + 每项带日期/距离/有无功率心率 + 超出折叠"。
- 退出条件：场景①第一轮（无指涉）返回带 `choices` 的追问；候选数据与 `listRides` 一致；话术不再默认"最近一次"。

### AGT-H3 · 请求 choice 通道

- **进入条件**：AGT-H0/H2 完成（choice 合同与候选链路就绪）。
- 目标：`/api/chat` 键白名单扩 `choice`；`choice.kind="ride"` 校验 `rideId` 归属本人（404 语义，与 `ownedRide` 同口径）后映射为 rideRef；确认轮（`detectAnchorConfirmation`）新增第四接受形态=带 choice 的请求；摘要槽位记 `choice`。
- 关键约束：**点选必须传 `rideId`**（传日期判 `INVALID_INPUT`，前端不会传错，但服务端要防）。
- 退出条件：点选 → 分析 → 下一轮"那心率呢"仍锚定同一条（跨轮 choice 继承）；编排集/边界集零回归。

### AGT-H4 · 前端交互（列表 + 点选 + 当前对象指示）

- **进入条件**：AGT-H3 完成（请求通道可用）；D-H2 已拍板。
- 目标：`ChatHome` 渲染 `choices` 为可点列表（点击即带 `choice` 发请求）；消息流顶部常驻"当前分析对象：8月20日 · 31.1 km"指示条（来自最近 `choice`/`rideAnchor`）；快照补记录列表投影（`listRides` 数据本就在页面层）。
- 决策 **D-H2（训练目标枚举）**：`goal_options` 的枚举值定稿（建议：提升 FTP / 完成首次百公里 / 减重 / 备赛 / 保持健康 / 其他）——本里程碑只定枚举与渲染样式，不接生成（归 F）。
- 退出条件：场景① 端到端演示（列表→点选→分析→追问继承）；旧会话（无 choice 槽位）兼容加载。

### AGT-H5 · 深度分析入口与轻答引导

- **进入条件**：AGT-H4 完成（前端能渲染对象）；D-H3 已拍板。
- 目标：数据类回复附带 `quickActions[{kind:"deepAnalysis", rideId, dateLabel}]`；前端渲染为按钮，点击在对话上方叠 `InterpretationSheet` 抽屉（传 `rideId`/`dateLabel`/`engine="v2"`），不跳页；轻答文案末尾固定引导一句（不得声称"已做深度分析"）。
- 决策 **D-H3（入口形态）**：抽屉（推荐）vs 跳转详情页。
- 退出条件：场景② 端到端（轻问→轻答+引导→点按钮→抽屉出完整解读）；抽屉期间对话状态不丢。

### AGT-H6 · 交互用例集与里程碑收口

- **进入条件**：AGT-H0~H5 完成。
- 目标：新建 `eval/ride-chat-interaction-v0.1/`（≥12 例：无指涉→候选、点选→唯一定位、同日两条、跨轮继承、深度入口字段、goal_options 渲染、旧会话兼容、choice 非法整体丢弃等）；编排集 + 边界集全量回归；演示验收汇报写进度文档；AI-Spec v2 §4 交互合同按实测修订。
- 退出条件：交互集全过；两套主回归零退化；用户验收（演示场景①②）。

## 4. 依赖与顺序

H0 → H1 → H2 → H3 → H4 → H5 → H6（H4/H5 可并行前端装配；H2 依赖 H1 的 candidates；H3 依赖 H0 合同）。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| rideRef 迁移期两套选择机制并存（锚点 + rideRef） | H1 明确"映射不删除"，退役归 AGT-R；单测覆盖映射等价 |
| 模型档追问话术不可控 | 首选确定性档（候选+追问走零模型）；模型档仅循环内允许 |
| 前端 localStorage 旧结构 | 槽位解析双版本兼容（H0 层已保证） |
| 深度分析抽屉延迟（v2 引擎十几秒） | 抽屉内已有三段 loading；文案提示"约 10~20 秒" |

## 6. 决策项汇总

| # | 决策 | 何时拍 |
|---|---|---|
| D-H1 | 记录列表密度（条数/字段/折叠） | H2 前 |
| D-H2 | 训练目标枚举定稿 | H4 前 |
| D-H3 | 深度分析入口形态（抽屉/跳页） | H5 前 |
