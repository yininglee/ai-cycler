# 文档历史归档说明（2026-09-07 模块级压缩）

- 归档日期：2026-09-07。
- 对应主文档：`开发进度.md`、`AI_AGENT_测评计划与记录.md`。
- 原样快照：`开发进度.before.md`、`AI_AGENT_测评计划与记录.before.md`（压缩前逐字副本）。
- 触发条件：用户验收 `MIG-PROD-01`（2026-09-07，生产解读入口离线迁移与台账卫生通过）；按 2026-09-07 决策，验收通过时一并执行两文档的历史区压缩。
- 本次治理内容：
  1. `开发进度.md`：`MIG-PROD-01` 置 `Done`；第 4 节补 `FIX-018`、`VALIDATION-08`、`FIX-018-SMOKE`、`FORMAL-08`、`MIG-PROD-01` 五条 Done 记录（此前仅存于 3A 任务卡正文）；3A 节 349 行压缩为一条 `AI-ADV-02C` 模块摘要，任务卡正文退役至本归档与 2026-09-05/09-06 归档。
  2. `AI_AGENT_测评计划与记录.md`：第 5 节 `AEVAL-M1-ADVANCED-INTERPRETATION` 移除过期时间快照段落（保留指标表、Claim 范围表、测评集矩阵）；第 7 节 9 月 3-4 日 Run 流水账与 P0-A/P0-B 子记录整体归档，保留修复-验证循环索引、历史批次索引、当前修复结论三个锚点。
- 压缩原则与既有治理一致：只压缩已被后续任务取代、不再影响当前状态的重复过程；Run ID、输入哈希、版本矩阵、用户验收证据、失败结论全部保留（正文或索引表至少一处可查）；`eval/runs/*.json` 一字不动。
- `MIG-PROD-01` 的后续门不受本次压缩影响：真实链路冒烟（本机 dev server + `/api/ride-analysis` 端到端一次真实 Provider 调用）仍需用户单独授权。
- 本归档不涉及产品代码、Prompt、Coze Workflow、测评逻辑或另一工作树的 `MVP-FOUNDATION-01`。

# 文档历史归档说明（2026-09-07 第二次压缩：AI-ADV-02C 模块收口 + PILOT-03 暂停）

- 归档日期：2026-09-07（同日第二轮）。
- 对应主文档：`开发进度.md`、`VIBE_CODING_开发规划.md`、`AI_AGENT_测评计划与记录.md`。
- 原样快照：`开发进度.before-compact2.md`、`VIBE_CODING_开发规划.before-compact2.md`、`AI_AGENT_测评计划与记录.before-compact2.md`（本次压缩前逐字副本）。
- 触发条件：`IMPL-010` 延伸（三轮 UI 形态迭代：独立路由 → 抽屉组件 → expanded 单次调用）与 `V2-DEPRECATION-01`（全项目 v2 资产废弃，用户选 D）均已完成并随 `28b409a` 提交；同日用户决策：`PILOT-03` 由 NO-GO 修复路径置 `Paused`（真实 FIT 文件使用暂未发现问题，修复→复评循环与盲评后续重新安排）。
- 本次治理内容：
  1. `开发进度.md` 第 4 节：`AI-ADV-02C` 全部子任务 Done 记录（IMPL-001~012、GATE-01、MIG-01 修复-验证循环全部子任务、MIG-PROD-01/02、IMPL-010 延伸三轮、V2-DEPRECATION-01）压缩为一条模块级 Done 摘要；`M1-BLIND-01` 记录保留完整（M1 仍 In Progress 的关键质量证据）。
  2. `开发进度.md` 第 1/2/3/3B 节：快照、看板、任务卡同步至 IMPL-010 延伸 + V2 废弃完成后的终态；`MIG-PROD-02` 已 Done 的任务卡折叠；3B 节新增 `PILOT-03` `Paused` 卡。
  3. `VIBE_CODING_开发规划.md`：M1 当前状态段与 `PILOT-03` 行改 `Paused`。
  4. `AI_AGENT_测评计划与记录.md`：盲评条目后续处置同步为暂停状态。
- 压缩原则与第一轮一致：Run ID、输入哈希、版本矩阵、用户验收原话、失败结论全部保留（模块摘要或索引表至少一处可查）；`eval/runs/*.json`、`eval/human-review/*` 一字不动。
- 本次不涉及产品代码改动。
