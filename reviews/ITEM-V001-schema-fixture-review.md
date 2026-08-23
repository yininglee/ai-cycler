# ITEM-V001 预览：统一骑行 Schema、Fixture 与质量规则

> 状态：`ACCEPTED`  
> 日期：2026-08-14  
> Schema：v0.1  
> Rules：v0.1
> 用户验收：2026-08-17，接受ITEM-V001

## 1. 本项要解决什么

FIT、GPX 和内置样例必须先转成同一种领域对象，后续规则、前端和 AI 才不会各自理解一套数据。本项完成的是“解析之后、AI 之前”的统一事实层。

本项没有读取真实 FIT/GPX，也没有接扣子或生成 AI 文案。真实文件解析器要在本项验收后单独选型和实现。

## 2. 已实现的数据契约

`RideActivity v0.1` 包含：

- 来源：`sample / fit / gpx`、文件名、格式版本、解析器版本、设备厂商和产品；
- 基础字段：记录 ID、骑行类型、开始时间；
- 白名单指标：距离、时长、移动时间、爬升、均速、最高速度、心率、功率、踏频；
- 指标证据：数值、单位、来源类型、置信度、`evidenceId`、计算公式版本；
- 传感器质量：覆盖率、总样本数、无效样本数；
- 来源问题：警告或错误及稳定错误码。

每个计算值必须带 `formulaVersion`，每个指标必须有唯一 `evidenceId`。这两个字段将用于防止 AI 引用无法追溯的数字。

## 3. L1/L2/L3 与降级规则

| 条件 | 结果 |
|---|---|
| 功率字段存在、覆盖率 ≥80%、无效样本比例 ≤2% | L3 功率分析 |
| 功率不可用，但心率满足相同质量线 | L2 心率分析 |
| 没有可靠心率/功率 | L1 轨迹分析 |
| 距离 <3 km 或时长 <10 分钟 | 仅基础分析 |
| GPX 无时间戳 | 不允许速度/时长，降为基础分析 |
| 上游为无时间戳 GPX 填入速度/时长 | 拒绝分析，不接受伪造时间轴 |
| FIT 未知开发字段 | 安全忽略并警告，标准字段仍可用 |
| FIT 截断或关键汇总互相矛盾 | 拒绝分析 |

允许话题会根据实际字段动态收缩。例如没有时间戳的 L1 不会因为“L1 通常可谈速度”而获得速度话题权限。

## 4. Fixture 实际结果

共 13 条：3 条内置样例、8 条 FIT、2 条 GPX。

| Fixture | 来源 | 有效 | 层级 | 模式 | 关键结果 |
|---|---|---:|---|---|---|
| `l1-built-in-sample` | sample | 是 | L1 | full | 内置轨迹样例 |
| `l2-built-in-sample` | sample | 是 | L2 | full | 内置心率样例 |
| `l3-built-in-sample` | sample | 是 | L3 | full | 内置功率样例 |
| `l1-gpx-normal` | GPX | 是 | L1 | full | 正常轨迹 |
| `l2-fit-heart-rate` | FIT | 是 | L2 | full | 心率可靠 |
| `l3-fit-power` | FIT | 是 | L3 | full | 功率可靠 |
| `gpx-no-timestamps` | GPX | 是 | L1 | basic | 不生成速度/时长 |
| `fit-heart-rate-dropout` | FIT | 是 | L1 | full | 心率质量不足，降级 |
| `fit-power-dropout-with-heart-rate` | FIT | 是 | L2 | full | 功率质量不足，按心率分析 |
| `fit-unknown-developer-field` | FIT | 是 | L2 | full | 忽略未知字段并告警 |
| `fit-truncated-file` | FIT | 否 | L1 | rejected | 截断文件拒绝 |
| `short-fit-ride` | FIT | 是 | L1 | basic | 短骑仅基础事实 |
| `inconsistent-fit-summary` | FIT | 否 | L1 | rejected | 均速与距离/时间矛盾 |

## 5. 自动验证

- 运行命令：`node --test tests/*.test.ts`
- 实际结果：17 tests，17 passed，0 failed。
- 2026-08-17使用工作区Node 24复跑：17 passed，0 failed，耗时约81ms。
- 文档系统检查：0 errors，0 warnings。
- 覆盖：三层样例、FIT/GPX 同 Schema、质量降级、无时间戳、截断 FIT、未知开发字段、短骑边界、数字矛盾、证据重复、公式版本、文件扩展名和覆盖率边界。

## 6. 尚未验证

- `NOT_RUN`：真实 FIT 文件解析；
- `NOT_RUN`：真实 GPX 文件解析；
- `NOT_RUN`：不同 Garmin/Wahoo/行者等设备导出兼容；
- `NOT_RUN`：TypeScript 完整静态类型检查——当前运行时没有安装 `typescript`，但 Node 24 已实际加载并执行全部 `.ts` 测试；
- `NOT_RUN`：前端页面和扣子 Workflow。

## 7. 请重点确认

1. FIT/GPX 都进入同一 Schema，而不是分成两套分析逻辑；
2. 功率/心率质量线暂定为覆盖率 ≥80%、无效样本比例 ≤2%；
3. FIT 功率不可用但心率可靠时降为 L2，而不是整条记录失败；
4. 未知 FIT 开发字段默认忽略并提示，截断或数字矛盾则拒绝分析；
5. 短骑和无时间戳记录仍可展示可信基础事实，但不生成完整 AI 解读。

验收选择：`接受 ITEM-V001`、`要求修改`或`暂缓`。
