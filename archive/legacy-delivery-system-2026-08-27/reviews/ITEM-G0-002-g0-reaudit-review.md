# ITEM-G0-002｜G0“可以接模型”重新审计

> 状态：`ACCEPTED`  
> 审计日期：2026-08-18  
> Gate：G0“可以接模型”  
> 正式结论：`GO`  
> 运行ID：`RUN-20260818-001`

## 1. 结论

新版本矩阵满足G0全部六项硬条件，G0正式从`NO-GO`改为`GO`。该结论只允许进入开发环境中的扣子B2接入与T1模型评测，不代表真实上传、Demo核心价值、Alpha或上线已经放行。

GPS跳点这一原唯一硬阻塞已关闭：相同合成GPX在`gpx-parser-v0.2`下输出14.630m，过滤1/3样本，记录`GPX_GPS_SPIKE_FILTERED`，不生成平均速度，也不把速度送入allowed claims。

## 2. 冻结版本矩阵

| 组件 | 本次版本 | 状态 |
|---|---|---|
| App | `0.0.1 / visual-shell-v0.1` | 已验收 |
| Schema | `RideActivity v0.1` | 已验收 |
| Rules | `ride-rules-v0.1` | 已验收 |
| Snapshot | `RideContextSnapshot 1.0` | 已验收 |
| FIT解析器 | `fit-parser-v0.1` | 已验收 |
| GPX解析器 | `gpx-parser-v0.2` | ITEM-G0-FIX-001已验收 |
| GPS质量规则 | `gpx-gps-quality-v0.1` | ITEM-G0-FIX-001已验收 |
| B0 | `b0-template-v0.1` | 已验收 |
| Prompt | `v1.0` | 尚未接入模型实测 |
| Workflow / Model / KB | 未创建 / 未选择 / 未创建 | `NOT_RUN`，不属于G0运行 |
| 评测集 | `ai-cycling-eval-cases.jsonl v1`，30条 | 结构与唯一ID通过 |

## 3. G0逐项结果

| G0条件 | 结果 | 本轮证据 | 边界 |
|---|---|---|---|
| 删除AI后，样例仍能展示可信基础摘要 | `PASS` | B0 14/14合同有效；5个Demo状态可生成确定性视图 | 固定fixture，不是用户价值证据 |
| 每个展示数字可追溯到字段或版本化公式 | `PASS` | 5个Demo状态的事实卡和详情指标均有`evidenceId`；highlight与allowed claim一致 | 当前视图与fixture范围 |
| L1/L2/L3能力边界单测通过 | `PASS` | `pnpm verify` 48/48通过，覆盖判级、降级、越层与不造数 | 模型尚未接入，不代表模型越权评测通过 |
| FIT/GPX异常均有降级状态 | `PASS` | FIT截断/CRC/开发字段/全0功率，GPX无时间戳/恶意XML/孤立/连续/端点跳变，字段矛盾均有warning、basic、rejected或稳定解析错误 | 真实设备异常分布尚未验证 |
| 前端不存在模型Token或服务端密钥 | `PASS` | 对`app/`、`src/`、`next.config.ts`、`.next/static`执行密钥特征扫描，0命中 | 模式扫描不是专业密钥审计；当前尚未配置模型密钥 |
| B0已记录质量、延迟和成本基线 | `PASS` | 14/14合同、grounding、能力边界通过；P50 0.032ms、P95 0.472ms；模型调用/token/成本为0/0/¥0 | 本机进程内，不是页面或模型端到端延迟 |

G0结果：`6 PASS / 0 FAIL`。

## 4. 实际执行证据

| 检查 | 结果 |
|---|---|
| `pnpm verify` | TypeScript通过；48/48测试通过，0失败 |
| `pnpm benchmark:b0` | 14/14通过；P50 0.032ms，P95 0.472ms；模型成本¥0 |
| `pnpm build` | Next.js 16.3.1生产构建成功 |
| 评测集结构 | 30条、30个唯一`case_id`；`RA-L1-004`及`quality_gate`存在 |
| 前端与静态产物密钥特征 | 0命中 |
| GPS阻断样本端到端 | 14.630m；无平均速度；issue和质量统计存在；B0合同有效 |
| 展示证据链 | 5/5 Demo状态的事实卡与详情指标均带`evidenceId` |

详细B0数字追加在[基准报告T0.4](../eval/benchmark-report.md#11-t04g0新矩阵重新审计2026-08-18)。

## 5. 放行范围与停止条件

- 决定：`GO`，已经用户验收并生效；
- 允许：建立开发环境扣子`ride_analysis_v1`、服务端B2适配/校验/超时/降级链路，并运行冻结30条T1评测；
- 不允许：开放真实文件上传、外部用户、生产流量、多周训练处方或直接宣布G1通过；
- 观察范围：仅owner/reviewer与开发环境，无外部流量；
- 自动停止：任何客户端密钥、错误事实进入claim、L1/L2/L3越权、GPS异常未降级、B0回退不可用；
- 回退基线：关闭AI路径，继续使用`visual-shell-v0.1 + b0-template-v0.1`和固定样例；
- 下次复核：B2完成30条冻结评测和服务端降级验证后，进入T1结果评审；未通过不得进入5人测试。

## 6. 尚不能得出的结论

- 未运行B1/B2/B3，不能判断模型质量、延迟、成本或相对B0增量；
- 未实现真实上传，不能判断真实GPX、多设备或大文件兼容；
- 未进行5人任务测试，不能判断AI解读是否创造用户价值；
- 未部署、无账号/数据库/监控/删除，因此不具备Alpha或上线条件；
- 本次`GO`只关闭“是否可以开始接模型”的基线Gate。

## 7. 用户验收

- 验收结果：`ACCEPTED`。
- 用户决定：2026-08-18明确回复“接受 ITEM-G0-002”。
- 验收范围：接受G0六项`6 PASS / 0 FAIL`的审计结果，并确认只允许开发环境B2接入的`GO`。
- 后续项：单独建立`ITEM-V005`，本验收本身不创建扣子Workflow、不调用模型。
