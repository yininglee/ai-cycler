# AGT-B 工具合并方案：`get_ride_context` + `find_ride` → `query_ride_metrics`

> 设计稿 · 2026-10-26 · **决策：不实施（2026-10-26 22:30 评估后否决）**
>
> **否决理由（三条，均有数据支撑）**：
> 1. **原始动机消失**：方案的立论是"工具选择误用 ~6 次/轮"。B5 收口时该数字为 **0**——
>    四次"看起来像工具选错"的失败，根因分别是用例期望过僵（cases v0.2）、caps 上限 8<18、
>    缺 ridesWithoutTss 事实、缺 rows[].claims 事实，**没有一次是工具设计问题**。
> 2. **覆盖不到剩余问题**：本方案只合 get_ride_context + find_ride（get_route_overview
>    明确不在范围）。而 B5 剩余 2 次失败（ORCH-11 r2/r3）缺的正是 get_route_overview
>    ——**即使实施合并也照样失败**。
> 3. **成本不划算**：1 个工作日 + 违反 P7 作废刚冻结的编排集 v0.2 + 全基线重跑，而收益
>    上限 95-97% **低于当前已达成的 96.8%**。
>
> **保留本文档的理由**：若未来出现"合并后仍有 ≥5 次工具选择误用"的实证（当前为 0），
> 或工具面继续扩张到 12+ 个导致 catalog 超限，本方案可直接复用。判据已写在 §7。
> 背景：B5 收口后编排集 57/63 = 90.5%，剩余失败中**工具选择误用**占 ~4-5 次/轮，是最大单一失败源。
> 前置：本方案会改动工具面与评测资产，**与 B5 冻结制度（P7）冲突**，实施须开新数据集版本 + 全新 Run。

---

## 1. 现状：两个工具、一套几乎相同的输出

| | `get_ride_context` | `find_ride` |
|---|---|---|
| **定位方式** | 锚点（或本轮结果里的 rideId） | 窗口内按 metric 检索极值/阈值 |
| **输入** | `rideId?` + `dims[]` | `rideId?` + `metric` + `mode` + `threshold?` + `windowDays?` + `metrics?` |
| **输出** | `claims[]`（多条指标的 claim） | `matches[].claims[]`（命中记录各自的 claim） |
| **证据形态** | `claims` | `claims` |
| **锚点模式** | `required` | `required` |
| **数字白名单** | 从 claims 派生 | 从 matches 的 claims 派生 |

**关键观察**：两者的**输出本质相同**——都是"某条记录的指标 claim"。差别只在**怎么定位那条记录**：
- `get_ride_context`：记录已知（锚点）
- `find_ride`：记录未知，需要检索

### 误用数据（近三轮 Run，共 189 次执行）

| 现象 | 次数 | 典型 |
|---|---|---|
| 该用 `get_ride_context` 却调 `find_ride` | ~3/轮 | ORCH-01「最近一次平均功率」、ORCH-13「算负分割吗」 |
| 该用 `get_route_overview` 却调 `find_ride` | ~2/轮 | ORCH-08「路线爬坡多吗」、ORCH-11 r1 |
| 该检索（`find_ride`）却直接查锚点 | ~1/轮 | 加引导后的副作用（ORCH-11 三连、ORCH-09 参数非法） |
| **合计** | **~6/轮 ≈ 10%** | 全部是"选错工具/参数"类 |

---

## 2. 三个候选方案

### 方案 A：三合一 `query_rides(mode)`（含 `get_ride_history`）

```jsonc
{ "tool": "query_rides", "input": { "mode": "single|search|range", ... } }
```

- **优点**：工具面 9 → 7，一次收敛所有"记录取数"
- **否决**：返回形状三态（`claims[]` / `matches[]` / `rows[]`），证据合同要按分支重写；`range` 的聚合语义（窗口统计）与单次指标差异过大；改动面最大

### 方案 B：两合一，`select` 参数决定定位方式（**推荐**）

```jsonc
{
  "tool": "query_ride_metrics",
  "input": {
    "select": "anchor | ride | extreme | threshold",   // 怎么定位记录
    "rideId": "select=ride 时必填",
    "metric": "select=extreme/threshold 时必填（单选字符串）",
    "mode": "max | min | threshold",
    "threshold": "数字，mode=threshold 时必填",
    "windowDays": "1-365，缺省 30",
    "dims": "字符串数组（要哪些指标）"
  }
}
```

- **返回统一形态**（关键）：
```jsonc
{
  "schemaVersion": "chat-tools-v0.2",
  "tool": "query_ride_metrics",
  "resolvedRideId": "ride-power-0",
  "rideDateLabel": "10月24日",
  "select": "anchor",
  "matchedCount": 1,          // select=extreme/threshold 时有意义
  "claims": [ /* 统一 claims 形态 */ ],
  "limitations": [],
  "privacy": [...]
}
```
- **优点**：① 输出恒为 `claims[]` → 证据合同、数字白名单、`claim:loop` 编号、投影**全部复用**；② "选哪个工具"消失，只剩"选哪种定位"，语义在同一工具内更易自洽；③ 少一个工具 → catalog 更短（可能略降延迟）
- **代价**：`select` 本身仍可能选错（但错在同一工具内，模型更容易从"没找到记录"的反馈自纠）

### 方案 C：只改说明不动结构

- 已试过（2026-10-26 purpose 反向映射）→ **净亏 5 次**，已回退。见 B5 卡"purpose 反向映射尝试失败"。
- **否决理由**：catalog 里加"不要用"的限定会连带压制正确用法（ORCH-11 从 1/3 掉到 0/3）。

---

## 3. 方案 B 详细设计

### 3.1 契约

```ts
export type QueryRideMetricsInput = {
  select: "anchor" | "ride" | "extreme" | "threshold";
  rideId?: string;                  // select=ride
  metric?: ChatComparisonMetricKey; // select=extreme|threshold
  mode?: "max" | "min" | "threshold";
  threshold?: number;
  windowDays?: number;              // 缺省 30
  dims: RideContextDimension[];
};
```

**内部路由**（实现层，模型不可见）：
| select | 实现 |
|---|---|
| `anchor` | 原 `get_ride_context`（锚点，dims） |
| `ride` | 原 `get_ride_context`（指定 rideId，dims） |
| `extreme` | 原 `find_ride`（metric + mode=max/min）→ 命中记录的 claims |
| `threshold` | 原 `find_ride`（metric + threshold）→ 命中记录的 claims |

**`select` 的默认值**：`anchor`（最高频）。缺省时模型不用填，减少一次判断。

### 3.2 catalog 描述（关键：用"定位"而非"工具"组织语义）

```
query_ride_metrics：查骑行的指标（功率/心率/踏频/速度/距离/爬升）。
用 select 说明你要的是哪一条记录：
- anchor（缺省）：最近一次／这次／那次——记录已知，直接取指标
- ride：指定某条记录（rideId 来自本轮结果）
- extreme：跨多次记录找极值（哪次最远/最快/爬升最多）→ 再用 mode=max/min
- threshold：跨多次记录找超过某值的（哪次心率超过 170）
```

**与旧版的差别**：不再出现"find_ride / get_ride_context"两个名字，模型不需要在两者间做选择；`select` 的四个值直接对应四种自然问法。

### 3.3 `get_route_overview` 的处置（不在本次合并范围）

路线形状是**另一类输出**（爬坡分段、占比），不属于"指标 claims"。**保持独立**，但其 `rideId` 说明应放宽为"来自 query_ride_metrics 的 resolvedRideId"。

---

## 4. 收益量化（诚实估计）

| 项 | 现状 | 合并后（预期） | 依据 |
|---|---|---|---|
| 工具选择误用 | ~6/轮 | **~2/轮** | `select` 选错比工具选错少（同一工具内语义自洽，且有默认值） |
| 编排合法率 | 57/63 = 90.5% | **~60-61/63 = 95-97%** | +3~4 次 |
| 边界集 | 106/114 = 93.0% | 基本不变 | 边界集测的是降级语义，不涉及工具选择 |
| 工具面规模 | 9 | **8** | 少一个工具 |
| catalog 长度 | ~2.4KB | 略降 | 少一个 purpose + params |

**不能解决的失败**（合并无效）：
- `REPAIR_FAILED`（数字/引用越界）：~1-2/轮
- 模型输出波动（同一用例 2/3 vs 3/3）：~1/轮
- 真实超时：~0-1/轮

**所以合并的**上限是 95-97%，不是 100%**。

---

## 5. 改动面清单（文件级）

| # | 文件 | 改动 | 风险 |
|---|---|---|---|
| 1 | `src/chat/chat-tools.ts` | 新增 `query_ride_metrics` 分支（内部复用两个既有 builder）；`ChatToolName` 加值 | 中 |
| 2 | `src/chat/chat-tools.ts` | `chatToolSpecs` 增条目（`evidenceKind: "claims"`、`anchorMode: "required"`、claimIds/numericFacts/hasUsableEvidence） | 中 |
| 3 | `src/chat/chat-tool-orchestration.ts` | `CHAT_TOOL_CATALOG_SCOPE` 三处路由列表换名；`CHAT_TOOL_CATALOG_INPUTS` 新增四项说明 | 低 |
| 4 | `src/chat/chat-tool-orchestration.ts` | `normalizeLoopCall` 的 select 分支校验（select=ride 时 rideId 必填、extreme 时 metric 必填等） | **高**（参数校验是最容易出错的地方，参考"metric 是单选字符串"那四个类型陷阱） |
| 5 | `src/chat/chat-agent.ts` | 投影分支（`query_ride_metrics` → 统一 claims 投影 + `claim:loop` 编号） | 低（复用现有） |
| 6 | `src/chat/chat-workflow-prompt.ts` | 工具分工段改写（少一个工具，表述可缩短 → **可能降低延迟**） | 中 |
| 7 | `eval/ride-chat-tool-orchestration-v0.1/cases.json` | 21 例的 `requiredTools`/`forbiddenTools`/`requiredAnyOf` 全改 | **高**（cases 已冻结，须开 v0.2） |
| 8 | `eval/ride-chat-boundary-v0.1` | 少数用例引用工具名（如有） | 低 |
| 9 | `scripts/preflight-ride-chat-tool-eval.ts` | 工具名枚举同步 | 低 |
| 10 | `tests/chat-b1-*` / `chat-b3-*` / `chat-b5-*` | 涉及两工具的断言 | 中 |
| 11 | `doc_Agent/AI-Spec_对话Agent能力规约.md` | §3.2 工具表（9→8） | 低 |

**工作量估计**：代码 4~6h、评测资产 + 重跑验证 3~4h。**合计约 1 个工作日**。

---

## 6. 风险与迁移

| 风险 | 等级 | 应对 |
|---|---|---|
| **冻结数据集作废** | **高** | P7 制度：cases 升 v0.2 + 全新 Run；旧基线（90.5%/93.0%）标 `supersede`，不作背书 |
| `select` 参数校验出错（如 extreme 缺 metric） | 高 | 参考既有四个"类型陷阱"：`select` 与依赖参数在 catalog 里逐条写清必填关系；preflight 加"参数组合"校验 |
| 合并后仍误用（select 错） | 中 | 预期 6→2 次；若仍 >4 次/轮，说明问题在模型能力而非工具设计 → 转"换模型"路线 |
| 历史 Run 不可比 | 中 | 明确以合并为分界线，文档记录 |
| 时间成本 | 中 | 1 个工作日，且今晚 B5 已收口，不阻塞其他线 |

---

## 7. 决策建议

### 建议顺序：**先换模型验证（10 分钟），再决定是否合并（1 天）**

理由：
1. **误用的性质是"理解"还是"设计"？** 当前 6 次/轮误用全部是"对一句话的意图判断"。如果换个更强的模型（如 `DeepSeek-V4` 或更大参数版本）后误用降到 2 次以下 → **问题在模型能力，合并是过度设计**
2. **换模型的成本极低**：只改 `SILICONFLOW_CHAT_MODEL_ID` 一个环境变量，跑一轮 20 分钟就能对比
3. **合并的成本是 1 天 + 数据集升版 + 全部基线重跑**，而且会作废刚冻结的 B5 资产

### 两条路的判据

| 换模型结果 | 结论 |
|---|---|
| 误用降到 ≤2/轮、编排 ≥95% | **不合并**，记"模型选型是工具选择的关键变量"，B 收口 |
| 误用仍 ≥5/轮 | **合并**，方案 B 实施；同时记录"prompt/catalog 引导对此类误用无效"（已有三次失败证据） |

### 如果直接选合并

按 §5 清单推进，注意三件事：
1. **cases 升 v0.2**（不要原地改冻结文件）
2. **`select` 与依赖参数的必填关系**在 catalog 里逐条写明——这是历史上出错最多的地方
3. 合并后跑一轮对比，**若未达 95%，不要继续加引导**（已有三次反噬证据），转"换模型"

---

## 附：本方案不做什么

- 不改 `compare_rides` / `get_route_overview` / `get_ride_history` 的结构
- 不改输出合同 `ride-chat-output-v0.2`
- 不改证据校验（`claimIds` 语义不变）
- **不为了合并而合并**：如果换模型能解决，本方案不实施
