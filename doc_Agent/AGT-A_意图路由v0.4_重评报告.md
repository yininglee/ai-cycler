# AGT-A 意图路由 v0.4 · 重评报告

> 里程碑：**AGT-A 意图路由 v0.4 + Provider 迁移**（7 工作项 A0~A6）
> 报告日期：2026-10-24｜放行依据 Run：`AEVAL-CLASSIFIER-20261023233648`
> 执行事实源：[Agent改造开发进度.md](开发规划/Agent改造开发进度.md)（本报告为 A6 收口归档，不替代进度文档）

## 1. 结论

**分类器意图识别 83/83 全对（100%），签收口径达成**（`signOffReady = true`，`verdict = PASS`）。

| 项 | 值 |
|---|---|
| 数据集 | `AEVAL-M3-CHAT-CLASSIFIER` v0.4，**83 例**，`casesSha256 = 9a4c242f…`（2026-10-24 冻结） |
| 分类器合同 | `chat-classifier-v0.2`（16 意图） |
| Prompt 版本 | `ride-chat-classifier-prompt-v0.4.1` |
| 路由合同 | `chat-routing-v0.2`（16 路由） |
| 模型 / 供应商 | `deepseek-ai/DeepSeek-V4-Flash` @ 硅基流动 |
| 运行时模式 | `single_enabled`（D-A5：无 shadow/active 灰度） |
| 硬门设置 | accuracy ≥ 0.95 / red-team = 1.0 |
| **签收口径** | **全量全对**（0.95 仅为底线形式，不构成签收依据） |

## 2. 两轮 Run 对照

| Run | 文件 | Prompt | 结果 | 说明 |
|---|---|---|---:|---|
| 1 | `eval/runs/AEVAL-CLASSIFIER-20261023233337.json` | v0.4 | **82/83** | 唯一 MISS：`CLS-BLIND-01`「上次骑行我的心率表现怎么样？」`ride_summary` → 判成 `history_compare` |
| 2 | `eval/runs/AEVAL-CLASSIFIER-20261023233648.json` | v0.4.1 | **83/83** | 全维度满分，放行依据 |

### Run 1 失败归因（`scripts/probe-classifier-texts.ts` 探针）

| 探针 | 判为 | 对错 |
|---|---|---|
| 上次骑行的心率怎么样？ | ride_summary | ✓ |
| 这次骑行的表现如何？ | ride_summary | ✓ |
| 上次骑行我的心率表现怎么样？ | history_compare | ✗ |
| 最近一次骑行的整体表现怎么样？ | history_compare | ✗ |
| 我上次骑行的表现比之前好吗？ | history_compare | ✓ |

触发词是「**表现**」：只要与"上次/最近一次"共现就被拉进 `history_compare`。根因 = 定义写了"就整体表现作比较"，把**评价词**误当**比较信号**。

**分层特征（`kind` 轴的价值）**：26 条 boundary 全过、53 条 positive 错 1 —— **正例错 = 定义有漏洞**，不是切线没教会。若无 `kind` 轴，最可能误判为"边界没讲清"而去改切线，方向错。

### 修法（v0.4 → v0.4.1）

1. `history_compare` 增加硬条件：**必须存在对比参照或变化词**（比/和/与/相比/对比/之前/上次/上个月/趋势/进步/退步/变快/变慢）；
2. `ride_summary` 明确「'表现/整体表现'本身不是比较词」；
3. 判断规则第 4 条同步。改后探针 4/4 归位。

## 3. 分维度结果（Run 2）

### 3.1 总量与分层

| 维度 | 结果 |
|---|---|
| overall | **83/83 = 100%** |
| dev | 13/13 |
| blind | **60/60** |
| red-team | **10/10**（红线零失误） |

### 3.2 按难度轴 `kind`

| kind | 结果 | 含义 |
|---|---:|---|
| positive | 53/53 | 直白问法 |
| boundary | **26/26** | 与相邻意图共享词汇或带对抗诱导 |
| ambiguous | 4/4 | 指代缺失，本应澄清 |

### 3.3 按意图（16 类全覆盖）

| 意图 | 结果 | 意图 | 结果 |
|---|---|---|---|
| level_assessment | 8/8 | aggregate | 4/4 |
| companion | 8/8 | history_compare | 4/4 |
| kb_qa | 8/8 | capabilities | 4/4 |
| training_plan | 8/8 | unclear | 4/4 |
| training_supervision | 8/8 | capability_gap | 4/4 |
| out_of_scope | 5/5 | open_chat | 4/4 |
| ride_summary | 4/4 | safety_stop | 4/4 |
| | | injection_stop | 4/4 |
| | | privacy_boundary | 2/2 |

## 4. 成本与耗时

| 项 | 实测 |
|---|---|
| 单次调用 token | prompt **2,157**（system prompt ≈2,100，占 97%）/ completion **36** |
| 全量 token | 输入 **179,031** / 输出 **2,988** |
| 单轮成本 | **≈¥0.28**（2:00–8:00 档，¥1.5/¥4.5 每 M）；其他档 ≈¥0.56；前缀缓存命中 ≈¥0.05 |
| 两轮合计 | **≈¥0.6** |
| 单轮耗时 | ≈2 分钟（83 × 1s + 400ms 间隔） |
| 分类器延迟 | 平均 **1,034ms**，Run 内最大 **1,629ms**（浏览器实测有 4,196ms 冷启动样本） |

**降本杠杆在 Prompt 长度**（system prompt 占 97% token），不在问题文本。当前成本不构成约束，未优化。

## 5. 分类器之外的修复（同一验收周期发现）

三处缺陷由用户在浏览器实测暴露，**分类器判定全部正确**，问题在前后端与超时配置。完整记录见进度文档 A5 卡「验收期回归修复」。

| 编号 | 现象 | 层 | 修复 |
|---|---|---|---|
| R1 | 问「上次我的骑行心率多少？」答成"最近记录日期" | 前端 | 删除本地正则兜底 `replyToChatInput`，失败统一诚实降级（D-A2） |
| R2 | 同一问题连问三次才成功 | 配置 | 主对话超时 8s→15s（实测有 8.17s 成功样本）；分类器 8s→12s（防御性） |
| R3 | 「我最近骑行数据怎么样？」答"我不会猜测骑行数据" | 服务端兜底模板 | 新增 `aggregateOverviewReply`，只陈述已确定事实 |

> Run 记录中 `provider.timeoutMs = 8000` 是 Run 2 当时的分类器配置；R2 后已改为 12000。**放宽超时不改变已达标结论**（更低失败率只会让结果更容易复现）。

## 6. 口径与局限（对外陈述前必读）

1. **blind 已非完全未见样本**：本轮属"看 Run 1 结果 → 改 Prompt → 重跑"的 bad case 回流，制度允许，但泛化成色打折。独立证据须由 **AGT-C 生成层新 Run** 或真实流量抽样提供。
2. **0.95 门槛在 83 例上几乎无分辨力**：错 1 例 = 98.8% 仍过门。真正起作用的是"全量全对"。
3. **per-intent 样本薄**：新意图各 8 例，1 例错即 87.5%；`privacy_boundary` 仅 2 例。
4. **非流量分布**：本集按判断难度配比，`out_of_scope`/`unclear` 占比远高于真实流量，**不可当作线上准确率引用**。
5. **作者偏差 + 单标注者**：cases 与 Prompt 同源，无标注一致性检验（κ）。缓解手段仅为：冻结后不改例 + 全新 Run + 将来自真实流量抽样校验。
6. **复合问法仍单标签**：一句两诉求按主意图优先级取定（红线 > 监督 > 计划 > 数据 > 知识 > 闲聊 > 域外），次诉求交回复层。多标签重审点挂 **AGT-B**。

## 7. 交付物索引

| 类别 | 路径 |
|---|---|
| 标注集（冻结） | `eval/ride-chat-classifier-v0.4/`（`cases.json` / `manifest.json` / `README.md` 用例说明 / `CHANGES.md` 变更清单） |
| Run 记录 | `eval/runs/AEVAL-CLASSIFIER-20261023233337.json`（Run 1）、`…233648.json`（Run 2） |
| Prompt 事实源 | `src/chat/chat-classifier-prompt.ts`（`ride-chat-classifier-prompt-v0.4.1`） |
| Prompt 归档副本 | `prompts/ride-chat-classifier-v0.2.md`（`npm run prompt:classifier:sync` 生成，单测断言逐字一致） |
| 预检 | `scripts/preflight-ride-chat-classifier-eval.ts`（`npm run eval:classifier:preflight`） |
| 评测执行 | `scripts/eval-classifier-accuracy.ts`（`npm run eval:classifier:accuracy`） |
| 探针 / 成本 / smoke | `scripts/probe-classifier-texts.ts` / `scripts/measure-classifier-token-usage.ts` / `scripts/smoke-classifier-v04.ts` |
| 合同索引 | [AI-Spec v1（归档）](archive/AI-Spec_对话Agent能力规约.md) §5 Prompt 版本索引、§11 增补记录 |

## 8. 后续衔接

| 去向 | 内容 |
|---|---|
| **AGT-B** | ① 工具面扩展后重评 **复合问法是否需多标签**（~~触发条件：出现必须两次工具编排的问法~~ → **2026-10-24 修订**：该条件不成立——L2b 一次循环内即可多次调用；改为路由级三卡点，处置阶梯见 [AGT-B 细规划 §5.5](开发规划/AGT-B_只读工具面_工作项规划.md)）；② `get_ride_history` 放开 30 天窗口后，`history_compare` / `aggregate` 的口径需重审（**2026-10-24 查证销账**：`history_compare` 口径见细规划 §4——`compare_rides` 默认窗 30 不动、`find_ride` 上限 365、长窗口归 `get_ride_history`；`aggregate` 用全量记录、无 30 天冻结，**不构成变更**，无需动） |
| **AGT-C** | 生成层新 Run 提供**独立于本集的证据**，同时补上分类器评不到的部分（回复质量/数值忠实/硬门） |
| **线上** | `.env.local` 已启用分类器；**`.env.production` 未动**，线上仍为规则基线。是否随下次重部署启用待定（启用后四个占位模板与"模型暂不可用"降级同时可见） |
| **PRD（AGT-F 前置）** | 四个占位路由（`training_plan` / `training_supervision` / `level_assessment` / `kb_qa`）当前只回模板，交互设计待 AGT-F 细规划前置产出 |
