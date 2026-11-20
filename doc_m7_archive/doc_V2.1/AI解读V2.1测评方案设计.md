# AI 解读 V2.1 测评方案设计（RIDE-AI-EVAL-V21）

- 状态：v1.0（2026-10-08），R01（demo 失败率量化 Run）随本方案一同启动
- 基线：以 [AI解读V2测评方案设计](../doc_V2/AI解读V2测评方案设计.md)（RIDE-AI-EVAL-01）为母版，按 V2.1 优化内容修订——**继承其框架（样例集冻结 / 四项盲评指标 / 失败率量化三档阈值 / 反例集 / Run 版本留痕），替换版本栈与观测维度**
- 关联：[AI骑行解读V2.1优化设计文档](AI骑行解读V2.1优化设计文档.md)、[VIBE_CODING_V2.1_开发规划](VIBE_CODING_V2.1_开发规划.md)（V21-12）、[RIDE-AI-V21-派生指标丢失与跨维度引用根因分析](RIDE-AI-V21-派生指标丢失与跨维度引用根因分析.md)

## 1. 目标

V2.1 改动了"喂给模型什么"（指标口径 + 知识库）与"知识怎么用"（四段式挂载 + 解读信号软引导），输出合同未变。本方案用冻结 Run 回答三个问题：

1. **V2.1 版本栈下的偶发 `REPAIR_FAILED` 失败率**是多少（对照 V2 EVAL-01 基线 55%）——V2.1 的派生指标供给 + 知识参照系 + Prompt v2.8.x 是否把它压下来；
2. **新增能力是否被模型真实使用**：约 20 个派生指标（VI/EF/负分割/功率曲线等）与 7 维度知识是否进入模型输出，还是"喂了没用"；
3. **修复链路的吸收结构**：首轮 issue 被确定性收敛吸收多少、模型修复轮吸收多少、最终降级多少——为"继续打地鼠 vs 换供给方式"提供数据。

R01（demo 量化 Run）结论用于 demo 阶段决策；**不作为放量依据**——正式放量仍按 §9 走完整盲评 Run。

## 2. 版本栈基线（V2.1，Run 期间冻结）

| 组件 | 版本 / 取值 | V2.1 变化 |
|---|---|---|
| Prompt | `ride-prompt-v2.8.1` | v2.8.0 解读信号软引导；v2.8.1 knowledgeReference 数字双来源口径 |
| 输出 schema | `ride-output-v2.2.0` | 不变（断言对象 + 5 种 conclusionType） |
| 知识库 | `ride-kb-2.1.0`（7 维度四段式） | 替换 batch1；知识输入**打开**（V2 为 soft-off） |
| 指标供给 | `ride-derived-metrics-v21`（约 20 个派生指标）+ MetricSpec 37 项 + 白名单投影三层 | 新增 |
| 模型提供方规则 | v2.1.0（temperature 0.3、思考关闭） | 不变 |
| 输出校验 | V2 通用门 + 范围语义（`extractNumberRanges`）+ 连字符剥离 + 功率曲线时长放行 | 三处修复 |
| 模型 | SiliconFlow deepseek-V4-Flash | 不变 |

## 3. 样例集（两级）

### 3.1 R01 demo 量化 Run（本轮执行，4 条真实踩坑样例）

| # | 样例 | 数据源 | 覆盖场景 |
|---|---|---|---|
| 1 | `demo-ride-2026-07-22` | fixtures（FIT） | 6.6h 长骑行、全传感器、15 段爬坡取 3 代表——**派生指标全量供给压力样例** |
| 2 | `demo-ride-2026-08-20` | fixtures（FIT） | 通勤、`power: SERIES_MISSING`——**降级说明 + limitation 回填样例** |
| 3 | `upload-0312e501-…` | `.local-data` 真实上传 | 用户真实骑行 + 真实 Profile（age28/maxHR192/FTP220） |
| 4 | `upload-07971de0-…` | `.local-data` 真实上传 | 同上 |

> upload 记录持久化在 `.local-data/application-state.json`（`rides[key].record`），离线脚本可直接读取并复刻生产链路——不再依赖 dev server。

### 3.2 正式盲评 Run（V21-12，demo 验证通过后）

沿用 V2 方案 10 条冻结样例（8 可解读 + 2 预期拦截/降级），并补 V2.1 场景：含派生指标高发的长骑行已在 #2；追加**无踏频 / 无心率**变体各 1 条（验证跨传感器维度 limitation 路径）。样例集冻结后跨 Run 不改。

## 4. R01：REPAIR_FAILED 失败率量化方法（本轮执行）

- **方法**：4 条样例 × 每条 5 次 = **20 次真实调用**，每次走完整生产链路：首轮调用 → 独立校验 → 确定性收敛 → 至多一次受限模型修复 → 全量重验 → pass / `REPAIR_FAILED`。参数 PD-AI-23（temperature 0.3、思考关闭）。
- **统计口径**：
  - 首轮通过率（stage=`firstPass`）
  - 确定性收敛通过率（`deterministicRepairPass`，零模型调用）
  - 模型修复通过率（`modelRepairPass`，1 次修复调用）
  - **最终降级率**（`repairFailed`，核心指标）+ 供应商错误率（`providerError`）
  - 每样例分列 + 总体
- **阈值（沿用 V2 三档，仅作 demo 决策参考）**：最终降级率 ≤5% 状态良好；5–15% 需定处理方案；>15% 停下先归因再动。

## 5. 错误类型分布与 V2.1 归因标签

在 V2 错误类型（数字不在证据内 / 高光未绑证据 / 稳定性措辞无证据 / 跨 Claim 合计 / AI_TIMEOUT 等）之上，V2.1 新增 5 个归因标签，脚本自动打标：

| 标签 | 定义 | 对应已修/待修 |
|---|---|---|
| `derived-lost` | 模型引用派生指标数字但该 claim 不在其维度问题包（供给侧丢失） | 已修（packet 归属三处）——验证不复发 |
| `derived-unbound` | knowledgeReference / fact 写了事实数字（含派生）未绑对应 claim | Prompt v2.8.1 引导目标 |
| `knowledge-range` | 知识基准/分级范围数字被误拦或转述越界 | 范围语义已修——验证不复发 |
| `cross-dimension` | 跨维度引用共享指标（VI/EF/Wkg）被拦 | packet 归属已修——验证不复发 |
| `knowledge-mix` | knowledgeReference 混入本次事实（语义层，人工复核判定） | 观测项 |

## 6. 诊断留痕（支持进一步归因）

每次调用落盘到 `output/v21-eval/<RunID>/raw/`：

1. **首轮模型输出原文**（`*-first-output.txt`）——模型原始行为不可替代；
2. **首轮 issue 全文**（code / path / message）+ **按 path 提取的违规断言原文**——归因主力；
3. **编排 steps**（first_validation / deterministic_organize / model_repair_call / post_repair_validation 每步 detail）+ 最终 fallback.failureCodes；
4. callRecords（latencyMs / usage tokens）——成本与延迟观测。

汇总产物：`summary.json`（机器可读统计）+ `report.md`（失败率、错误码分布、逐样例明细、归因聚类、诊断结论）。

## 7. 盲评指标（正式 Run 沿用四项 + V2.1 观测）

四项 1–7 分制与发布门阈值不变（事实忠实度硬门问题=0 / 不确定性表达 / 洞察价值 ≥4 / 行动性 ≥4）。V2.1 新增观测：

1. **派生指标采纳率**：每成功输出中引用 `calculated` 派生 Claim 的断言占比（对照 V2 输出）——回答"喂了有没有用"；
2. **知识引用健康度**：knowledgeReference 断言占比、其数字命中知识正文 vs 绑 claim 的分布；
3. interpretation 无证据表述越界率（PD-AI-27 延续）。

## 8. 反例集（回归）

V2 六类（稳定性无波动 / 能力提升无历史 / 恢复无 TSB / 计划无计划 / 因果 / 历史对比）+ V21-10 补充的 **VI/EF 派生数字自算反例**与派生数字正确绑定正例，全部必须被校验器拦截，漏拦=0（`tests/ride-output-validator-v2.test.ts` 长期运行）。

## 9. 发布门对照（正式 Run 后）

沿用 V2 口径：事实硬门问题 = 0；四类零容忍断言 = 0；事实忠实度 ≥ B0 确定性基线；允许修复时总模型调用 ≤ 2 次。全部达标 → 申请 V2.1 放量；任一不达标 → 按失败类型定方案后**开新 Run**（不续跑、不跨 Run 混用结论）。

## 10. Run ID 与版本留痕

- 格式 `EVAL-V21-R{序号}-{冻结日期}`，首个 **`EVAL-V21-R01-20261008`**（demo 失败率量化 Run）。
- 每次 Run 记录 §2 完整版本栈 + 样例集版本；任一变化 → 新 Run。

## 11. 与 V2 EVAL-01/02 的关系

- V2 EVAL-01 的量化结论（55% 触发 STOP）是 V2.1 的**对照基线**；V2.1 修复项（供给、归属、数字门、Prompt）是否有效，由 R01 对照回答。
- V2 主链的 RIDE-AI-EVAL-02（发布门执行）暂不启动；V2.1 正式盲评 Run（V21-12）**必须在 V2 发布门评测之后**开新 Run（既有决策：避免旧指标口径结论给新口径背书）。
