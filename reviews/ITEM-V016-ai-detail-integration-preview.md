# ITEM-V016｜AI 结果接入详情页预览

## 1. 状态

`ACCEPTED`：用户已确认本地详情页接入和点击触发交互；AI 开关已恢复为关闭。

## 2. 最小充分审查卡

| 来源 | 定向范围 | 结论 |
|---|---|---|
| 项目台账 | `current-status.md`、`ITEM-V015`、`DEC-070` | 当前保持 Demo 边界；既有扣子运行证据不等于页面端到端证据 |
| 研发指南 | 阶段 4、阶段 8、详情页字段规则、D3 降级 | AI 通过校验后进入摘要/分析；AI 未生成或证据不足时静默隐藏，不影响确定性内容 |
| 版本路线图 | v0.1 骑后 AI、G1 范围和放行条件 | 新 AI 接入属于用户可见行为变化，必须单独预览；不因此宣称 G1 |
| 实现 | `app/rides/[id]/page.tsx`、`app/components/ride-ai-analysis.tsx`、`app/api/ride-analysis/route.ts`、`src/ai/ride-analysis-service.ts` | 页面保留 B0 首屏，点击后由 API 请求 AI；结果通过服务端合同校验后增量渲染 |
| 配置 | `.env.local`、`.env.example` | 当前 `AI_ANALYSIS_ENABLED=false`；启用后才会尝试扣子调用，超时上限为 `25000ms` |

## 3. 已实施接入范围

### 摘要 Tab

- 在核心事实卡片之后，显示校验通过的 `headline`；
- 显示 `overallAssessment.text` 及必要的 `limitations`；
- `nextAction.kind="grounded"` 且有 Claim 时显示为“基于本次数据的建议”；
- `nextAction.kind="general"` 显示为“通用建议”，不伪装成个性化结论；
- `safetyLevel="stop"` 不走普通摘要，显示固定安全停止提示。

### 分析 Tab

- 保留现有速度/海拔/心率/功率/踏频图表；
- 在对应图表附近按 `dimensions` 的 `key` 显示解读文本；
- 只渲染通过服务端 Schema 校验的维度，不自行拼接 Claim 或数字。

### 数据 Tab

- 不显示 AI 文案、Claim ID、内部版本、Token 或 Provider 日志；
- 继续只展示确定性事实、来源和质量边界。

## 4. 已实施运行方式

- 页面保持服务端生成的 B0 首屏，只有用户点击“查看 AI 解读”后，客户端才请求 `POST /api/ride-analysis`；
- AI 成功后增量显示 AI 模块，避免等待模型阻塞基础数据；
- `AI_DISABLED` 或未配置时静默保留 B0，并显示“AI 解读当前未开启”，不提供无效重试；真实超时、Provider 错误或修复失败时保留 B0，并提供一次重新尝试入口；
- 不自动重试第三次，不允许迟到的 AI 结果覆盖已显示的 B0 或安全停止结果；
- 只允许现有 Demo fixture ID，不接受页面传入任意用户或记录标识。

## 5. 非目标

- 不修改 Prompt、Workflow、Schema、Claim 规则、Few-shot 或 25 秒等待；
- 不扩大扣子批次，不把本地页面调用计入既有 B2 批次；
- 不接入真实上传记录、登录态、历史持久化、对话或生产 API；
- 不在 UI 展示精确模型 ID、区域、成本、Token 或内部证据 ID。

## 6. 实施前置与风险

1. `.env.local` 已恢复 `AI_ANALYSIS_ENABLED=false`；真实预览结束后默认不会产生新的扣子调用；
2. 单条真实页面调用使用 `l2-built-in-sample`，用户点击后等待约 55 秒，成功返回 B2；
3. 既有 25 秒四槽结果 P95 为 `34591.961ms`，页面先显示确定性内容，未把 AI 等待当作首屏等待；
4. 本次真实页面调用不计入既有 B2 批次，不创建新的质量分数，也不代表 G1 或生产就绪。

## 7. 验收标准

- AI 关闭或失败时，五类记录页面与当前 B0 预览完全一致；
- AI 成功时，摘要/分析只显示合同允许字段，数据 Tab 不出现 AI 内部信息；
- AI 超时、修复失败或 Provider 错误不造成空白页面、数字覆盖或第三次调用；
- L1/L2/L3、无时间戳和拒绝记录均保持原有能力边界；
- 浏览器预览能分别确认 B0、B2、降级和安全停止状态。

## 8. 本次实现与验证记录

- 新增客户端组件 `app/components/ride-ai-analysis.tsx`，初始只显示入口，点击后请求 AI；成功结果显示摘要、维度、限制和区分后的行动建议。
- 摘要和分析页提供 AI 入口；数据 Tab 未出现 AI 文案、Claim ID 或内部运行信息。
- 真实页面调用：`l2-built-in-sample`；结果 `source=b2`，headline 为“后程配速心率踏频均出现回落”，包含配速、心率、踏频和爬升维度；通用建议标注为“通用建议”。
- 失败路径保留 B0；AI 未开启时不提供无效重试，真实运行失败时才提供重新尝试入口；本地 `pnpm verify`：`201/201 PASS`；交付系统校验：`0 error(s), 0 warning(s)`。

## 9. 用户验收与后续

用户已确认本地详情页；当前开关已恢复关闭。下一项转入 v0.1 用户测试与 G1 证据准备，不扩大模型、Workflow 或生产边界。
