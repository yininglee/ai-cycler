# T002-V04 v0.4 候选链双人盲评执行指南 v0.1

> 关联测评：`AEVAL-M1-RIDE-INTERPRETATION-V04-BLIND-REVIEW`（`AI_AGENT_测评计划与记录.md` 第 5 节 M1 / 第 7 节）
> 关联任务：`M1-BLIND-01`（`开发进度.md` 第 3 节）
> 2026-09-07 立项。用户决策：取消 5 人用户测试（`ITEM-V017` → `Cancelled`），M1 质量验证由本双人盲评承接；评审由两名独立 LLM 担任。

## 1. 目的与定位

对已迁移生产入口的 v0.4 候选链（`ride_analysis_v3 v0.0.11 / Prompt v0.4.14`，含 FIX-018 确定性兜底）执行双人盲评，回答：

1. 候选输出的六维 Rubric 综合质量是否达到 ≥4.2/5；
2. 相对确定性事实层（B0），洞察价值是否有可感知增量（配对均值 ≥+1 分）；
3. 事实忠实与不确定性是否不低于 B0（不得因模型化而劣化）。

本盲评**不构成**：真实用户体验验证（已取消）、稳定性结论（FORMAL-08 已收口）、新版本放行依据之外的任何外推。

## 2. 测评设计

### 2.1 对照与配对

| 组 | 定义 | 生成方式 |
|---|---|---|
| 候选（B） | 生产候选链真实输出 | 每案例 1 次真实 Provider 调用，逐字存储 |
| B0 确定性事实层 | 无模型的事实摘要，代表无 AI 解读时用户可获得的信息 | 由该案例输入的允许 Claim 按固定规则确定性渲染（与 FIX-018 事实兜底同源：`claimFactFallbackText`），无任何模型调用 |

每案例两条样本（候选 1 条 + B0 1 条），共 18 样本/评审。两套评审包内容相同、顺序不同。

### 2.2 测评集

复用 [formal-stability-plan-v0.16](../ride-interpretation-v0.4-candidate/formal-stability-plan-v0.16.json) 冻结的 9 案例（含输入 SHA 校验）：

| 案例 | 层 | Fixture | 场景 |
|---|---|---|---|
| F01 | L1 | l1-built-in-sample | 基础 GPS 当次解读 |
| F02 | L1 | l1-gpx-normal | 正常 GPX 路线解读 |
| F03 | L1 | l1-gps-spike | GPS 异常点后的受限解读 |
| F04 | L2 | l2-built-in-sample | 心率与节奏当次解读 |
| F05 | L2 | l2-fit-heart-rate | 可靠心率 FIT 解读 |
| F06 | L2 | fit-heart-rate-dropout | 心率缺失时的降级解读 |
| F07 | L3 | l3-built-in-sample | 完整功率当次解读 |
| F08 | L3 | l3-fit-power | 可靠功率 FIT 解读 |
| F09 | L3 | fit-power-dropout-with-heart-rate | 功率缺失时的降级解读 |

### 2.3 指标

沿用 `AI_AGENT_测评计划与记录.md` 第 3.2 节六维 Rubric 与权重：

| 维度 | 权重 |
|---|---:|
| 事实忠实 | 30% |
| 洞察价值 | 25% |
| 行动性 | 20% |
| 易懂性 | 10% |
| 语气匹配 | 5% |
| 不确定性 | 10% |

- 评分 1–5 分/维度 + 硬门备注 + 评语（见 [LLM 评审指南](T002-V04-llm-reviewer-instructions-v0.1.md)）。
- 硬门备注发现的问题优先于分数：硬门失败样本不进入综合质量分。
- 分歧处理：两评审任一维度分差 ≥2 分 → 该项必须复核（由维护者标记，交第三视角仲裁或维持并记录理由）。
- 汇总口径：各维度均值/中位数、候选-B0 配对差、两评审绝对一致率、加权 Cohen's kappa（首轮建立一致性基线，不预设 kappa 阈值；一致性过低时先修评分锚点，不平均掉分歧）。

### 2.4 匿名化规则

- 评审包内样本只有 `itemId`、`evidence`（脱敏证据卡）、`output`（呈现形状与生产前端一致）。
- 剥离：caseId、fixtureId、tier、来源标签（候选/B0）、Run ID、Workflow/模型/版本、请求 ID。
- 候选与 B0 的输出渲染为相同结构（headline / overallAssessment / dimensions / limitations / nextAction / safetyLevel），避免以结构猜来源。
- 顺序打乱：两套包使用不同固定种子（记录在 scoring key），可复现。
- 评审指南明令禁止评审推断来源；评分表不记录来源猜测。

## 3. 执行流程与授权门

```
检查点 A 指标冻结（已具备，沿用 3.2）
   ↓
检查点 B/C 评审包生成（需用户单独授权一次 9 槽、逐字存输出的真实 Provider 运行）
   ↓
Phase 2 双 LLM 评审（用户执行，无 Provider 调用）
   ↓
Phase 3 汇总（维护者执行聚合与复核标记）
   ↓
检查点 D/E 结果与结论签署（GO / NO-GO / STOP-RETHINK）
```

### Phase 1：评审包生成（脚本，需授权）

脚本：`scripts/run-t002-v04-blind-review-pack.ts`

```bash
# 预检（无模型调用）：校验计划、运行时资产 SHA、9 案例 inputSha256
node scripts/run-t002-v04-blind-review-pack.ts --preflight

# 真实生成（仅在用户明确授权后执行；环境变量为授权闩）
T002_V04_BLIND_REVIEW_CONFIRM=YES node scripts/run-t002-v04-blind-review-pack.ts
```

生成产物（`eval/human-review/`）：

| 文件 | 用途 | 可见对象 |
|---|---|---|
| `T002-V04-blind-reviewer-A-v0.1.json` | 评审 A 匿名包（18 样本） | 仅评审 A |
| `T002-V04-blind-reviewer-B-v0.1.json` | 评审 B 匿名包（同样本、异序） | 仅评审 B |
| `T002-V04-blind-score-sheet-A/B-v0.1.md` | 对应空白评分表 | 仅对应评审 |
| `T002-V04-scoring-key-v0.1.json` | itemId→来源/caseId 映射与打乱种子 | **仅维护者，不得发给评审** |
| `eval/runs/AEVAL-RUN-*.json` | 运行记录（含逐字输出、版本矩阵、延迟） | 仅维护者 |

停止规则：任一案例出现 B0 降级或 L8 校验失败 → 脚本中止、不生成评审包、运行记录标记 `aborted`，按修复流程另立任务；不重试、不补跑。

### Phase 2：双 LLM 评审（用户执行）

对评审 A 与 B 各自进行（两个独立 LLM 会话，互不可见）：

1. 新开一个 LLM 会话（建议使用不同模型或独立上下文，保证独立性）；
2. 发送三样材料：`T002-V04-llm-reviewer-instructions-v0.1.md`（评审指南）、该评审的匿名包 JSON、该评审的空白评分表；
3. 要求 LLM 按指南逐项评分并把填写完成的评分表全文返回；
4. 将返回的评分表原样保存回 `T002-V04-blind-score-sheet-A/B-v0.1.md`（或另存 `-filled` 版本，保留空白原表）。

注意：不要向评审会话提供 scoring key、本项目仓库、生产代码或任何历史 Run；不要让两个评审会话共享上下文。

### Phase 3：汇总（维护者执行）

两份评分表回收后，按第 2.3 节口径计算并写入 `T002-V04-blind-review-result-v0.1.md`：

1. 逐 itemId 对齐两评审分数；分差 ≥2 分的项列表标记复核；
2. 硬门备注去重汇总为硬门问题清单（候选样本与 B0 样本分开统计）；
3. 计算各维度均值/中位数（排除硬门失败样本后的综合质量分 + 全样本口径并列报告）；
4. 按 scoring key 还原配对关系，计算每案例「候选洞察价值 − B0 洞察价值」配对差及均值；
5. 计算两评审绝对一致率与加权 Cohen's kappa（六维合并及分维度）；
6. 输出结论建议，交用户签署。

### Phase 4：结论签署（检查点 E）

| 结论 | 判定条件（须同时满足/触发） |
|---|---|
| `GO` | 无未解决硬门失败；候选综合质量 ≥4.2/5；洞察价值相对 B0 配对均值 ≥+1；事实忠实与不确定性两维不低于 B0 配对均值 |
| `NO-GO` | 出现任一未解决硬门失败；或综合质量 <4.2 且洞察增量 <+1 |
| `STOP-RETHINK` | 两评审一致性过低无法建立基线；或出现系统性硬门失败（≥3 案例）；或评分锚点被证实存在歧义 |

结论与签署记录写入 `AI_AGENT_测评计划与记录.md` 第 7 节与 `开发进度.md`（`M1-BLIND-01` → `Done`，附用户验收原话）。

## 4. 边界与合规

- 不修改 Prompt、Coze Workflow、L0–L8、候选链运行时资产（服务 SHA `f0004576...` 保持冻结）；
- 不续跑 `AEVAL-RUN-20260906-955` 或任何历史 Run；盲评生成运行使用全新 Run ID；
- 评审材料全部来自脱敏 fixture，不含真实用户数据、文件名、坐标或身份；
- 逐字存储的候选输出仅用于盲评证据，评审结束后随归档保留，不用于微调或 Prompt 改写依据之外的用途；
- 只有评审指南、匿名包、评分表三样材料可发给 LLM 评审；scoring key 与运行记录永不外发。

## 5. 版本

- v0.1（2026-09-07）：初版。依据用户 2026-09-07 决策（取消 5 人测试、以 LLM 双评审执行盲评）建立。
