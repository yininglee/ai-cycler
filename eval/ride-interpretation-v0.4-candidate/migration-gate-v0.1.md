# AI-ADV-02C-GATE-01｜v0.4 候选迁移决策包

状态：`APPROVED`（2026-09-02，用户确认 Gate-01 决策包）。本 Gate 只冻结迁移范围和后续试运行方案，不修改生产链路，不调用模型；`AI-ADV-02C-MIG-01` 已获授权。实施中的标签规则修订已将候选 Prompt 递增至 `v0.4.6`，输出合同保持 `v0.4.2`；用户验收后才同步独立候选 Workflow。

## 1. 决策目标

确认离线候选链路是否具备进入 Coze 独立 Workflow 配置的条件，并把“候选迁移”“受限冒烟”“正式测评”分成三个不同授权动作。Gate 通过后只允许启动 `AI-ADV-02C-MIG-01` 的配置迁移；不等同于生产发布或 81 槽授权。

## 2. 当前候选基线

> 说明：本节及第 3--5 节保留 Gate-01 于 2026-09-02 获批时的候选快照。高光归属的当前实施规则已在第 7 节追加修订中收紧，执行时以第 7 节和最新 `manifest.json` 为准。

| 项目 | 候选值 | 生产基线（保持不变） |
|---|---|---|
| System Prompt | `prompts/cycling-buddy-ride-interpretation-v0.4.6-candidate.md` 中 System 部分 | `3.1.6` |
| User Prompt | 同一入口接收 `{{ride_interp_input}}`、`{{repair_instruction}}`、`{{previous_output}}`；首轮后两项传空 | 旧输入变量不改 |
| 输出合同 | `ride-interpretation-output-v0.4.2-candidate` | `ride-analysis-output-v0.3.2` |
| wire schemaVersion | `ride-interpretation-output-v0.4.2-candidate` | `ride-analysis-output-v0.3` |
| 高光展示 | `highlights[]` 带归属：整体高光在整体卡片内，维度高光在对应维度卡片内 | 生产链路不变 |
| 持久历史 | 不接入；仅保留显式 fixture | 不改变当前无持久历史边界 |

完整版本和 SHA-256 见同目录 `manifest.json`。候选输出 Schema、合法示例、2 个计划 fixture、13 个响应正反 fixture 和 L3 输入均已冻结；受限修复是编排协议，不把修复字段加入首次输入合同。

## 3. 迁移范围

### 必须迁移

- System Prompt 的角色、自然语言结构、Claim/数字/视觉引用和安全边界。
- User Prompt 由同一个大模型入口接收三个变量：`{{ride_interp_input}}` 由服务端注入 L7 最小投影 JSON，`{{repair_instruction}}` 和 `{{previous_output}}` 首轮传空。变量名均符合扣子 20 字符上限。
- 唯一一次受限修复分支：复用同一 `ride_interp_input`，并注入服务端生成的 `{{repair_instruction}}` 与不可信的 `{{previous_output}}`；修复失败立即 B0，禁止第三次调用。
- 输出 Schema `ride-interpretation-output-v0.4.2-candidate`，包括 `oneLineLabel`、`overallAssessment`、带归属的 `highlights[]`、`dimensions[]`、`limitations[]` 和最多一条 `nextAction`。
- 独立候选 Workflow 的输入映射、输出映射和可识别版本号。

### 暂不迁移

- 生产 Prompt `3.1.6`、生产合同 `ride-analysis-output-v0.3.2`、生产 Workflow `v0.0.9`。
- 持久历史、用户归属、删除重算、长期能力画像和 `history_change` / “相对自己”。
- 正式 81 槽、人工盲评和 `ITEM-V017` 用户测试。

### 待用户确认

- 候选 Workflow 是否使用独立名称/复制版本，以及实际 Workflow ID 和发布版本。
- 扣子模型、同步超时和额度是否足以执行 4 条受限冒烟。
- 4 条冒烟通过后，是否另行授权新的正式 AI 测评；本 Gate 不预授权正式批次。

## 4. 受限冒烟方案

使用全新 `AEVAL-SMOKE-YYYYMMDD-NNN` Run ID，固定 L1、L2、L3 首轮和 L3 受限 repair 四个槽位。每条只发送脱敏投影输入，不发送原始 FIT/GPX、文件名、坐标、完整轨迹、身份或健康自由文本；原始模型输出不落盘。

`L1`、`L2`、`L3` 首轮必须验证同一大模型入口接收 `ride_interp_input`，且 `repair_instruction`、`previous_output` 为空。`L3-repair` 必须先让首轮输出故意触发 L8 校验，再真实发起且仅发起一次同一入口修复调用，修复调用绑定同一输入、`repair_instruction` 和 `previous_output`；若第二次校验仍失败，记录 B0 且确认没有第三次 Provider 请求。

通过条件：4/4 Provider 成功；Schema、Claim、数字、视觉和安全校验全部通过；自然语言整体评价和重点维度可读；每条高光仅出现在其所属的整体或维度卡片内；无历史维度、未知维度/Claim、长期能力、危险建议或未注册视觉。

停止条件：任一结构/事实/数字/安全硬门失败，任一 Provider 额度或权限错误，或发现投影边界泄露。停止后保留 Run 证据，不覆盖旧候选 fixture、生产 Run 或生产 Workflow。

## 5. Gate 验收清单

- [x] 离线候选输入、输出、Prompt、Schema、fixture 和版本哈希已冻结。
- [x] 迁移范围明确区分必须迁移、暂不迁移和待确认项。
- [x] 4 条冒烟槽位、通过条件、停止条件和新 Run ID 规则已冻结。
- [x] 一次受限修复协议已冻结：首次调用不暴露修复字段，L8 失败后最多一次修复，失败即 B0。
- [x] `AI-ADV-02C-MIG-01` 已获用户授权并进入迁移流程；当前因外部配置资料未齐而 `Blocked`，尚未执行 Coze 配置或模型调用。
- [x] 用户确认本决策包（2026-09-02），并于同日授权 `AI-ADV-02C-MIG-01`；迁移仅限独立候选 Workflow。

## 6. 下一步

Gate-01 决策包已于 2026-09-02 经用户确认，`AI-ADV-02C-MIG-01` 亦已获授权。当前任务因独立候选 Workflow 标识、模型与额度未确认而 `Blocked`；信息补齐后于扣子完成配置核对并发布，收到实际 Workflow 版本后再启动 4 条受限冒烟。正式测评需另行建立新测评 Run 和授权，不沿用旧 `AEVAL-RUN-20260831-356`。

## 7. Gate 后实施修订（2026-09-03）

本节是 Gate 通过后的候选实现修订，不回写第 2--5 节在 2026-09-02 获批时的历史基线，也不改变生产隔离、一次受限修复或正式测评需另行授权的边界。

- 用户确认采用简化方案：`highlights[].target` 唯一合法值为 `{ "kind": "overall" }`。模型不再选择维度归属，前端只在整体评价卡片内展示高光。
- 高光仍可概括任意已选维度，但其 `claimIds` 和 `visualRefIds` 必须分别是 `overallAssessment.claimIds` 和 `overallAssessment.visualRefIds` 的子集。这样每条高光都能回溯到整体评价已采用的证据。
- 候选 Prompt 递增为 [v0.4.11](../../prompts/cycling-buddy-ride-interpretation-v0.4.11-candidate.md)，输出合同版本仍为 `ride-interpretation-output-v0.4.2-candidate`；Schema、合法示例、响应 fixture、L8、一次受限修复和呈现层已同步。当前资产哈希见 [manifest](manifest.json)。
- 本次仅完成离线合同与回归准备，未发布扣子 Workflow、未调用模型、未创建新的四槽冒烟或 81 槽正式 Run。用户验收后，才同步完整 v0.4.11 System Prompt 至独立候选 Workflow，发布递增版本，并以全新 Run ID 重跑 L1/L2/L3/L3-repair 四槽。

### 8. 发布后四槽冒烟（2026-09-03）

- 用户已发布独立候选 Workflow `ride_analysis_v3 / 7680762018618359814 / v0.0.8`，Prompt `v0.4.11`；生产链路保持隔离。
- 全新 Run [AEVAL-SMOKE-20260903-015](../../eval/runs/AEVAL-SMOKE-20260903-015.json) 的 L1/L2/L3 首轮均一次通过 L8，L3-repair 在注入首轮结构错误后经唯一一次受限修复通过；4/4 Provider 成功，无 B0、无第三次调用。
- 本轮达到四槽冒烟通过条件，仍需用户验收后才能决定是否建立新冻结计划并授权新的 81 槽正式测评；不得直接复用历史正式 Run。

### 9. 正式测评后的候选修订（2026-09-03）

- `v0.4.11 / v0.0.8` 的正式 Run `AEVAL-RUN-20260903-117` 完成 `81/81` 槽，但 `F04:R4` 在唯一一次受限修复后仍出现高光数字无合法 Claim、以及高光 Claim 不属于整体评价证据的组合错误。因此结果为 `80/81`，历史 Run 与其冻结计划保持不变。
- 用户已授权 `AI-ADV-02C-MIG-01-FIX-003`。离线候选 Prompt 递增为 [v0.4.12](../../prompts/cycling-buddy-ride-interpretation-v0.4.12-candidate.md)：高光文字中的数字必须同时由高光自身和整体评价引用的同一条计划内 Candidate Claim 支撑；无法形成完整证据链时，删除数字，必要时删除高光。
- 服务端的一次受限修复同步遵循此顺序：仅当整体评价计划已经开放同一 Claim 时，才先补齐整体评价再让高光复用；否则删除数字或高光。该修订不增加调用次数、不放宽 L8、B0、数字、图表或生产隔离边界。
- 本节只记录离线修订，未同步扣子、未发布新的候选 Workflow、未创建新的四槽冒烟或正式 Run。用户审核并发布递增 Workflow 版本后，必须以全新 Run ID 先重跑 L1/L2/L3/L3-repair 四槽；四槽通过也不自动启动新的 81 槽测评。

### 10. v0.4.12 发布后四槽冒烟（2026-09-04）

- 用户已发布独立候选 Workflow `ride_analysis_v3 / 7680762018618359814 / v0.0.9`，Prompt `v0.4.12`；生产 Workflow 保持隔离。
- 全新 Run [AEVAL-SMOKE-20260904-002](../../eval/runs/AEVAL-SMOKE-20260904-002.json) 为 `4/4 PASS`：L1/L3 首轮通过；L2 经唯一一次受限修复通过；L3-repair 注入首轮结构错误后，经同一入口唯一一次修复通过。无 B0、无第三次调用，最终输出未出现高光数字或整体证据归属错误。
- 本轮仅进入用户验收 `Review`。通过后仍须单独新建冻结正式计划，并取得用户新的 81 槽授权；不复用或改写 `AEVAL-RUN-20260903-117`。
- 用户于 2026-09-04 明确确认本轮冒烟；`FIX-003` 已完成。下一步仅为创建和预检 `v0.4.12 / v0.0.9` 的独立冻结正式计划，计划完成后仍需用户单独授权执行新的 81 槽 Run。
