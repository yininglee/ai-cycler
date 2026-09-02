# AI-ADV-02C-GATE-01｜v0.4 候选迁移决策包

状态：`READY_FOR_USER_DECISION`（2026-09-01）。本 Gate 只冻结迁移范围和后续试运行方案，不修改生产链路，不调用模型。

## 1. 决策目标

确认离线候选链路是否具备进入 Coze 独立 Workflow 配置的条件，并把“候选迁移”“受限冒烟”“正式测评”分成三个不同授权动作。Gate 通过后只允许启动 `AI-ADV-02C-MIG-01` 的配置迁移；不等同于生产发布或 81 槽授权。

## 2. 当前候选基线

| 项目 | 候选值 | 生产基线（保持不变） |
|---|---|---|
| System Prompt | `prompts/cycling-buddy-ride-interpretation-v0.4-candidate.md` 中 System 部分 | `3.1.6` |
| User Prompt | 仅接收 `{{ride_interpretation_input}}` | 旧输入变量不改 |
| 输出合同 | `ride-interpretation-output-v0.4.1-candidate` | `ride-analysis-output-v0.3.2` |
| wire schemaVersion | `ride-interpretation-output-v0.4.1-candidate` | `ride-analysis-output-v0.3` |
| 高光展示 | `highlights[]` 保留为合同字段，前端放在整体评价卡片内 | 生产链路不变 |
| 持久历史 | 不接入；仅保留显式 fixture | 不改变当前无持久历史边界 |

完整版本和 SHA-256 见同目录 `manifest.json`。候选输出 Schema、合法示例、2 个计划 fixture、7 个响应正反 fixture 和 L3 输入均已冻结。

## 3. 迁移范围

### 必须迁移

- System Prompt 的角色、自然语言结构、Claim/数字/视觉引用和安全边界。
- User Prompt 的单变量 `{{ride_interpretation_input}}`，由服务端注入 L7 最小投影 JSON。
- 输出 Schema `ride-interpretation-output-v0.4.1-candidate`，包括 `oneLineLabel`、`overallAssessment`、`dimensions[]`、`highlights[]`、`limitations[]` 和最多一条 `nextAction`。
- 独立候选 Workflow 的输入映射、输出映射和可识别版本号。

### 暂不迁移

- 生产 Prompt `3.1.6`、生产合同 `ride-analysis-output-v0.3.2`、生产 Workflow `v0.0.9`。
- 持久历史、用户归属、删除重算和长期能力画像。
- 正式 81 槽、人工盲评和 `ITEM-V017` 用户测试。

### 待用户确认

- 候选 Workflow 是否使用独立名称/复制版本，以及实际 Workflow ID 和发布版本。
- 扣子模型、同步超时和额度是否足以执行 4 条受限冒烟。
- 4 条冒烟通过后，是否另行授权新的正式 AI 测评；本 Gate 不预授权正式批次。

## 4. 受限冒烟方案

使用全新 `AEVAL-SMOKE-YYYYMMDD-NNN` Run ID，固定 L1、L2、L3 首轮和 L3 受限 repair 四个槽位。每条只发送脱敏投影输入，不发送原始 FIT/GPX、文件名、坐标、完整轨迹、身份或健康自由文本；原始模型输出不落盘。

通过条件：4/4 Provider 成功；Schema、Claim、数字、视觉和安全校验全部通过；自然语言整体评价和重点维度可读；高光出现在整体评价卡片内；无未知维度/Claim、长期能力、危险建议或未注册视觉。

停止条件：任一结构/事实/数字/安全硬门失败，任一 Provider 额度或权限错误，或发现投影边界泄露。停止后保留 Run 证据，不覆盖旧候选 fixture、生产 Run 或生产 Workflow。

## 5. Gate 验收清单

- [x] 离线候选输入、输出、Prompt、Schema、fixture 和版本哈希已冻结。
- [x] 迁移范围明确区分必须迁移、暂不迁移和待确认项。
- [x] 4 条冒烟槽位、通过条件、停止条件和新 Run ID 规则已冻结。
- [x] `AI-ADV-02C-MIG-01` 保持 `Backlog`，未执行 Coze 配置或模型调用。
- [ ] 用户确认本决策包并授权开始 `AI-ADV-02C-MIG-01`。

## 6. 下一步

用户确认 Gate-01 后，才在扣子创建独立候选 Workflow，完成配置核对并发布；收到实际 Workflow 版本后，再启动 `AI-ADV-02C-MIG-01` 的 4 条受限冒烟。正式测评需另行建立新测评 Run 和授权，不沿用旧 `AEVAL-RUN-20260831-356`。
