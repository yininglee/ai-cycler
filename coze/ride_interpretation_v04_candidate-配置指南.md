# v0.4 候选骑后解读 Coze 配置指南

状态：`CANDIDATE_REVIEW`
已发布适用版本：`ride_analysis_v3 v0.0.11 / cycling-buddy-ride-interpretation-v0.4.14-candidate`
输出合同：`ride-interpretation-output-v0.4.2-candidate`

本指南只用于独立候选 Workflow 的迁移核对，不修改生产 `ride_analysis_v2 v0.0.9`，不接持久历史，不执行正式测评。

2026-09-05 `FIX-016` 已发布更新：独立候选 `ride_analysis_v3` 已发布为 `v0.0.11 / Prompt v0.4.14`。`overallAssessment.text` 和 `dimensions[].text` 只写事实→本次骑行表现→体现/反映的骑行能力，不得出现任何行动建议或行动引导；所有建议只能写在 `nextAction.text`。下文关于 `v0.0.9 / Prompt v0.4.12` 的已发布冒烟记录是历史证据，不代表 v0.4.14 的真实诊断或冒烟已完成。

本版 Prompt `v0.4.12` 延续标签规则，并将高光归属简化为整体评价：高光统一使用 `{kind:"overall"}`，仍可概括任意已选维度，但只能复用整体评价已引用的 Claim/图表。高光文字出现数字时，该数字必须由同一条计划内 Candidate Claim 同时支撑高光自身 `claimIds` 和整体评价 `claimIds`；不能同时满足时，删掉数字，必要时删掉整条高光。修复指令会先补齐整体评价中已开放的同一 Claim，再让高光复用；无法合法补齐时不得只删 Claim ID 而保留数字。禁止输出 `dimension`、`dimensionId` 或其他归属类型。输出合同版本、L8 校验、修复次数和生产链路均不变。

已确认独立 `ride_analysis_v3` 发布为 `v0.0.9`，并标注 Prompt `v0.4.12`。保持 Workflow ID、模型、三个开始变量和输出 Schema 不变；生产 `ride_analysis_v2` 未修改。发布后四槽 Run [AEVAL-SMOKE-20260904-002](../eval/runs/AEVAL-SMOKE-20260904-002.json) 已 `4/4` 通过，当前等待用户验收；该结果不等同新的 81 槽正式测评授权。

## 节点与变量

开始节点暴露一个必填业务输入和两个可选修复变量：

| 变量 | 类型 | 首次调用 | 修复调用 | 来源 |
|---|---|---:|---:|---|
| `ride_interp_input` | String | 必填 | 必填 | 服务端 L7 最小投影 JSON |
| `repair_instruction` | String | 非必填（传空） | 非必填 | L8 首次校验生成的错误指令 |
| `previous_output` | String | 非必填（传空） | 非必填 | 首次模型原始输出，仅作待修复草稿 |

`repair_instruction` 和 `previous_output` 是同一大模型入口的可选工作流变量。首次调用由服务端传空；仅在 L8 失败后由服务端填入，不能由用户自由填写，也不得作为事实来源。

## 调用流程

```text
服务端首次调用同一 Workflow
  ride_interp_input=<L7 最小投影 JSON>
  repair_instruction=""
  previous_output=""
       -> 大模型（唯一节点）
            -> 服务端 L8 校验
                 通过 -> 接受输出
                 失败 -> 服务端生成修复指令
                     -> 服务端第二次调用同一 Workflow
                          ride_interp_input=<同一 L7 投影>
                          repair_instruction=<服务端修复指令>
                          previous_output=<首次原文>
                               -> 大模型（同一唯一节点）
                                    -> 服务端再次 L8 校验
                                         通过 -> 接受输出
                                         失败/超时/供应商错误 -> B0
```

Coze 只配置一个大模型节点和三个开始变量。该节点使用同一份 System Prompt 与三变量 User Prompt；服务端通过两次 Workflow 请求实现首轮解读和一次受限修复。Coze 内不配置 L8、修复指令生成、调用次数控制或 B0 分支。

扣子变量名上限为 20 个字符，因此使用 `ride_interp_input`（17），不能使用 `ride_interpretation_input`（25）。`repair_instruction`（18）和 `previous_output`（15）保持不变。此处变量改名只影响 Workflow 的入参键和 `{{...}}` 占位符；传入的 JSON 仍是 `RideInterpretationInputV04Candidate`，输入合同版本不变。

## 配置核对

### 结束节点返回变量与嵌套类型（发布前必核对）

结束节点只能返回以下 7 个根变量，名称必须逐字一致：
`schemaVersion`、`oneLineLabel`、`overallAssessment`、`dimensions`、`highlights`、`limitations`、`nextAction`。

其中 `oneLineLabel`、`overallAssessment`、`nextAction` 为对象；`dimensions`、`highlights`、`limitations` 为对象数组。`limitations` 的数组元素必须为 `{ dimensionId, claimIds }`，不能配置成 `Array<String>`；`highlights` 的数组元素必须为 `{ text, claimIds, visualRefIds, target }`。结束节点应直接映射大模型节点对应对象，不要把对象转成字符串，也不要把 `hightline` 等近似拼写作为变量名。

服务端不会再把缺失的 `highlights` 自动补成空数组。若结束节点漏映射、拼写错误或返回层级被包成不符合合同的结构，本轮会记录 `PROVIDER_INVALID_RESPONSE` 或 L8 结构错误并进入既定一次修复/B0 流程，确保配置问题不会被默认值掩盖。

- 结构化输出 Schema 固定为 `ride-interpretation-output-v0.4.2-candidate`；首次和修复调用使用同一 Schema。
- 本轮只允许 6 个当次维度，不接入 `history_change` 或“相对自己”。系统选择并排序维度，模型必须完整回填，不能删卡或重排。
- 每个高光的 `target` 必须严格为 `{kind:"overall"}`；高光可以来自任意已选维度，但其 Claim/图表引用必须分别为整体评价 `claimIds`/`visualRefIds` 的子集，前端统一在整体评价卡片下展示。高光文字中的每个数字还必须由一条同时位于高光和整体评价 `claimIds` 的计划内 Candidate Claim 支撑；不能形成这条完整证据链时删除数字或整条高光。
- 一句话标签必须在 12 个可见字符以内，概括最突出且有证据支持的特点，并引用至少一个 Candidate Claim；可包含被其 Claim 引用的原值、展示值或同一 Claim 的允许单位换算。标签引用 performance 或 relation Claim 时必须概括本次表现，不能只列事实；没有此类证据时可以作事实性描述，不强行评价。
- `few_shot_json` 不配置、不发送；不把 `analysis_context`、`analysis_elig` 或旧生产变量带入候选链路。
- L8 校验失败才允许进入修复分支；首次成功不得额外调用修复模型。
- 修复分支只允许修正 L8 指出的 Claim、数字、视觉、维度或安全问题；可以在输入计划已开放的 Claim 中补齐或替换引用，但不得新增计划外事实、数字、Claim、维度、视觉或行动。若错误为高光数字或高光证据不属于整体评价，只有在整体评价计划已开放同一 Claim 时才可先补齐整体评价再复用；否则必须删除高光数字或整条高光，绝不能只删除 Claim ID 而保留数字。
- 第二次校验失败、模型超时或供应商错误时直接返回服务端 B0；不得重试或发起第三次模型调用。
- 冒烟必须留存调用次数、版本矩阵、校验结果和 B0 标记，但不落盘原始模型输出或敏感输入。

详细迁移范围、四条冒烟槽位和停止条件见 `eval/ride-interpretation-v0.4-candidate/migration-gate-v0.1.md`。
