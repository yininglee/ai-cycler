# `ride_analysis_v2` 扣子开发环境配置指南

> 状态：`P0-B_SMOKE_REVIEW`（P0-A 配置修复已通过；Prompt `3.1.6` 已发布到 `v0.0.9`，后续两轮受限冒烟 4/4 通过，等待用户验收）
> 输入合同：`ride-analysis-input-v0.2`  
> Prompt：`prompts/cycling-buddy-ride-analysis-v3.1.6.md` v3.1.6（已发布）
> 扣子 Workflow：`ride_analysis_v2`，当前发布版本 `v0.0.9`（历史版本：Prompt v3.1.5）
> Few-shot：首轮联调关闭；样例库v0.1保留为待重写、待评审候选  
> 输出合同修订：`ride-analysis-output-v0.3.2`；线 wire `schemaVersion` 保持 `ride-analysis-output-v0.3` 兼容

## 1. 哪些不用改

- 继续使用单一 Workflow，不增加多 Agent、RAG、知识库、Function Calling或代码节点。
- 继续保留“开始 → 大模型 → 结束”三个节点；如果你的新版扣子画布没有单独结束节点，则直接使用大模型节点的结构化输出，不必额外补节点。
- 模型继续使用当前账号内中文与JSON稳定的非深度思考快速模型；不要因本项更换模型做质量结论。
- 服务端继续负责准入、事实/数字/claim/安全校验、一次修复和B0；扣子不复制这些规则。
- Token、Workflow ID和模型ID仍只放本机`.env.local`，不进入前端、截图或Git。

## 2. 必须新建v2而不是覆盖v1

旧`ride_analysis_v1`使用`RideContextSnapshot 1.0 + Prompt v1.2 + output-v0.2`，只保留为失败学习证据。请新建或复制为`ride_analysis_v2`，不要覆盖已记录的v1版本；这样才能重放旧结果并回滚。

## 3. 开始节点输入

配置5个必填`String`变量。所有变量名均不超过扣子的20字符限制：

| 变量 | 长度 | 内容 | 首轮是否为空 |
|---|---:|---|---|
| `analysis_context` | 16 | `RideAnalysisContext v0.3` JSON字符串 | 否 |
| `analysis_elig` | 13 | `AnalysisEligibility v0.1` JSON字符串 | 否 |
| `few_shot_json` | 13 | Few-shot模式元数据；当前固定`disabled`且`examples=[]` | 否 |
| `repair_instruction` | 18 | 服务端校验错误码与受限修复要求 | 是 |
| `previous_output` | 15 | 上一次原始模型输出 | 是 |

不要再创建`ride_snapshot`。不要在扣子调试区手改`analysis_context`中的数字、claim或允许维度。

### 3.1 在哪里取得这5个字符串

在项目根目录执行：

```bash
pnpm export:coze-inputs
```

默认会为内置 L1/L2/L3 样例生成：

- `output/coze-inputs/l1-built-in-sample.json`
- `output/coze-inputs/l2-built-in-sample.json`
- `output/coze-inputs/l3-built-in-sample.json`

每个文件都是一个对象，里面的5个值全部是“字符串”，不是需要再嵌套粘贴的对象：

```json
{
  "analysis_context": "{...}",
  "analysis_elig": "{...}",
  "few_shot_json": "{\"mode\":\"disabled\",...}",
  "repair_instruction": "",
  "previous_output": ""
}
```

在扣子开始节点调试时，打开其中一个样例文件，把5个键对应的值分别复制到同名输入变量。不要复制最外层键名，也不要把`analysis_context`里的JSON再次手动格式化或修改。若要生成其他已存在的Fixture，可执行：

```bash
pnpm export:coze-inputs -- gpx-no-timestamps
```

当前`few_shot_json`应为以下结构，里面没有任何示例`text`：

```json
{"mode":"disabled","reason":"baseline_no_few_shot","libraryVersion":"ride-analysis-few-shot-v0.1","routerVersion":"few-shot-router-v0.1","exampleIds":[],"examples":[]}
```

## 4. 大模型节点

1. 选择支持JSON结构化输出的中文快速模型，关闭深度思考。
2. 先选择“精确模式”预设；若修改最大回复长度或深度思考后界面显示“自定义”，属于正常状态。记录最终参数组合，不只记录模式名。
3. 最大回复长度固定为`2400`，与Prompt v3.1.6沿用的L1/L2/L3及受限修复试运行配置一致；后续只有在冻结同条件对照并取得截断率、延迟和成本证据后才调整。
4. 若界面没有temperature，记录`NOT_CONFIGURED`，不用寻找隐藏配置或增加节点。
5. 将`prompts/cycling-buddy-ride-analysis-v3.1.6.md` v3.1.6的`System Prompt`代码块完整放入系统提示词。v3.1.5及更早版本保持不变，不要覆盖历史Prompt。
6. 将同文件的`User Prompt`代码块放入用户提示词，并把5个占位符分别绑定到开始节点同名变量。运行时数据放在用户提示词更合适，系统提示词只维护稳定角色、事实、安全和输出规则。

从旧候选升级到v3.1.6时，只替换大模型节点的System Prompt，并重新导入服务端导出的5个输入字符串；User Prompt、五个开始节点输入变量、结构化输出Schema和结束节点映射均不变。v3.1.6保留Claim ID逐字复制、整体评价默认无数字、上下文标签默认关闭和删除/降级机制；并新增逐字段上下文词扫描、固定的limitations模板，以及“事实→本次表现→用户意义”和跨维度综合优先的解读要求。禁止跨 Claim 运算、未知 Claim、字段型维度和无上下文依据的时间/场景/路线标签；limitations不匹配固定模板时必须删除。

`nextAction`的产品含义是“下一步行动建议”，不是字段罗列或单纯的观察结论。每次最多生成一条，方向可为：恢复、下一次提升重点、训练/练习重点、继续观察。有直接 Claim 依据时使用`grounded`并绑定直接相关的`basisClaimIds`；没有个性化依据时使用`general`并保持空数组，内容限于低风险的恢复整理、记录体感或通用观察；没有安全且有帮助的建议时才使用`null`。单次骑行只给方向性、低风险建议，不生成多周计划、个性化恢复时长或高强度处方。不得使用旧合同的`kind=tip`，也不得因为缺少心率/功率而推荐购买设备。

**重要核对：**运行结果必须是`schemaVersion="ride-analysis-output-v0.3"`，对应合同修订版本`ride-analysis-output-v0.3.2`；`safetyLevel`为`normal/caution/stop`、`notableEvents`为对象数组、`nextAction.kind`为`grounded/general`、`shareCopy`正好3条。若出现`schemaVersion=0.2`、`safetyLevel=safe`、`kind=tip`或只有1条分享文案，说明仍在使用旧Prompt或旧结构化输出约束，不要把该结果当作v3.1.6质量结果。

## 5. 结构化输出

推荐用`coze/ride-analysis-output-example.json`让当前扣子界面生成根字段与嵌套类型，然后逐项核对：

### 5.1 示例 JSON 的用途与限制

`coze/ride-analysis-output-example.json`是“字段结构导入样例”，用于让扣子生成根字段、对象层级和数组元素类型。它的限制项示例已采用当前固定模板；该文案仅用于导入数组类型，不表示每次输出都应带限制项。

JSON 示例中的`schemaVersion: "ride-analysis-output-v0.3"`只能提供一个默认示例值，不能让扣子导入器自动生成常量、枚举或不可覆盖约束。因此截图中`schemaVersion`显示为普通`String`属于扣子导入行为，不代表示例文件错误，也不能据此判定 wire 合同已经固定。

导入后必须在扣子画布继续完成以下配置：

1. 大模型节点保留由该示例生成的9个根字段和嵌套类型；`notableEvents`必须是`Array<Object>`。
2. 若节点支持枚举/常量约束，将大模型节点的`schemaVersion`允许值收窄为唯一值`ride-analysis-output-v0.3`。
3. 当前扣子结束节点只能选择变量，不能直接填写常量。推荐在“大模型”与“结束”之间增加一个最小代码节点，例如定义一个无业务输入的 String 输出`schemaVersion`，代码只返回固定字面量`ride-analysis-output-v0.3`；结束节点的`schemaVersion`映射到“代码节点 - schemaVersion”，其余8个字段继续映射大模型节点。代码节点不得改写其它字段、拼接字符串或执行业务计算。

代码节点最小实现：

```javascript
async function main(args) {
  return { schemaVersion: "ride-analysis-output-v0.3" };
}
```

该节点无需配置输入变量；运行结果中应能看到代码节点耗时接近毫秒级，且结束节点的`schemaVersion`来源显示为“代码 - schemaVersion”。
4. 若当前账号/Workflow 不允许代码节点，则保留“大模型 - schemaVersion”映射，并明确这是平台限制：服务端仍会校验并在必要时进行一次受限修复，但不能宣称扣子端已固定常量，也不能以此满足 P0-A 的配置验收门。
5. 保存并发布递增的 Workflow 版本，再用新版本执行4条冒烟。只有4条结果都精确返回该 wire 值，且不再出现`INVALID_OUTPUT_SCHEMA_VERSION`，结构硬门才算通过；若采用代码节点，还需在证据中记录节点版本和固定值。

如果扣子工作流没有单独结束节点，则应在大模型节点本身确认唯一允许值能力；若平台既不支持枚举/常量，也不能增加代码节点，只能依靠 Prompt + 服务端校验/一次受限修复，并将平台限制记录为未解决风险。

- 根字段必须正好9个：`schemaVersion/headline/overallAssessment/dimensions/notableEvents/nextAction/limitations/safetyLevel/shareCopy`；
- `dimensions`、`notableEvents`、`limitations`、`shareCopy`为数组；其中 `notableEvents` 必须是 `Array<Object>`，每项包含 `eventId`、`text`、`claimIds`，不能配置为 `Array<String>`；
- `overallAssessment`为对象；`nextAction`运行时为对象或`null`，但导入示例使用完整对象以便扣子生成嵌套字段；
- `shareCopy`正好3条；
- `schemaVersion`固定为`ride-analysis-output-v0.3`。

`coze/ride-analysis-output-schema.json`是标准JSON Schema和服务端/人工核对事实源。若扣子的“导入JSON”会把`$schema/$id/type/properties`识别成业务字段，不要导入Schema文件，改用示例文件。

如果当前大模型节点已经直接产生结构化根字段，结束节点无需二次拼装或将对象转字符串。服务端兼容根对象及常见`analysis_json/output/data`包装。

## 6. Prompt 同步、发布与首轮人工联调

1. 将候选文件 `prompts/cycling-buddy-ride-analysis-v3.1.6.md` 的 `System Prompt` 同步到大模型节点；`User Prompt`、5 个输入变量、结构化输出 Schema 和结束节点映射保持不变。
2. 保存并发布递增 Workflow 版本，并在扣子历史中记录新发布版本、Prompt `3.1.6`、合同 `ride-analysis-output-v0.3.2`、模型参数和发布时间。`v0.0.8`及更早版本保持历史不可变。
3. 在开始节点填入服务端测试产生的5个字符串；首次运行时`repair_instruction`和`previous_output`填空字符串。
4. 运行后确认根字段完整、`schemaVersion`正确，且没有Markdown代码围栏；重点检查`nextAction`是否为“下一步行动建议”，四类方向与`grounded/general`约束是否生效。
5. 将输出原样交回服务端校验；不要人工修正文案后冒充模型通过。
6. 若首轮校验失败，由服务端发起唯一一次修复调用；确认修复输入包含错误码和前次输出，同时`few_shot_json.examples`仍为空。
7. 再失败、超时或供应商错误必须返回B0；不能在扣子内无限重试。

联调通过的最低证据：内置三种能力组合各1条首轮运行，至少1条故意错误触发修复，记录`request_id/model_id/workflow_version/prompt_version/few_shot_mode/latency/token/fallback`。当前每条运行的`few_shot_mode`都必须是`disabled`。这只是冒烟证据，不等于B2质量基准通过。

### 6.1 发布后证据回传清单

`v3.1.6` 尚未同步扣子。发布后将由服务端以全新 Run ID 执行4条冒烟；`SMOKE-20260831134610` 是 P0-A 的历史冒烟，不可替代本轮；P0-B 最新历史冒烟证据为 `SMOKE-20260831171936`：

- 当前 Workflow 发布版本、发布时间和发布说明；
- L1/L2/L3 各1条运行结果（成功/失败、延迟、Token；可见字段才记录）；
- 至少1条故意错误输入是否触发且仅触发一次受限修复；
- 输出是否通过根字段、Claim/数字和安全校验；
- 是否发生 B0 fallback、超时、供应商错误或结构化输出异常。

v0.0.8 额度恢复后的最新结果：4/4 Provider 成功；L2 与 L3-repair 完整校验通过，L1 触发 `UNSUPPORTED_CONTEXT_LABEL`，L3 触发 `MISSING_INPUT_IMPACT`，整体 2/4 通过。结构化证据见 `eval/runs/SMOKE-20260831171936.json`。

额度恢复后必须使用全新 Run ID 重跑同一 4 条冒烟；在 4/4 Provider 成功且三类语义硬门全部为 0 前，不得启动 81 槽正式测评。

此前 `code=4028` 的额度阻断已解除；同一版本的多次联网重放在 2/4 与 3/4 完整通过间波动，说明语义硬门尚未稳定通过。当前应递增 Prompt 并收紧限制项/上下文标签规则，不得启动正式测评。

发布版本只代表扣子配置已部署，不代表 `AEVAL-M1-ADVANCED-INTERPRETATION` 的检查点 C--E 已通过，也不代表 G1 或生产放行。

### 6.2 P0-A 最新冒烟证据

2026-08-31 联网执行 `node scripts/run-coze-smoke.ts`，使用 Workflow `ride_analysis_v2 v0.0.5`、Prompt `3.1.3`、few-shot `disabled`：L1/L2/L3 首轮及 L3 受限 repair 共 4/4 Provider 成功。四条结果均未出现 `INVALID_OUTPUT_SCHEMA_VERSION` 或 `INVALID_NOTABLE_EVENTS`，说明 wire `schemaVersion=ride-analysis-output-v0.3` 和 `notableEvents=Array<Object>` 已在本轮返回中保持结构稳定；但整体校验仅 L3-repair 通过，L1/L2/L3 首轮分别出现 `UNSUPPORTED_CONTEXT_LABEL`、`OVERALL_UNKNOWN_CLAIM + UNSUPPORTED_CONTEXT_LABEL`、`OVERALL_UNSUPPORTED_NUMBER`，属于 P0-B 尚未修复的语义/数字白名单问题。B0 fallback 未触发。P50/P95 延迟约 `16247.116/17136.735ms`，Token 总量 `34267`。结构化证据：[SMOKE-20260831134610](../eval/runs/SMOKE-20260831134610.json)。

本轮结果可作为 P0-A 的配置与 wire 结构证据，但不代表 P0-B 或 81 槽正式测评 D 放行。用户验收时需确认四条结果的 `schemaVersion` 精确为 `ride-analysis-output-v0.3`、`notableEvents` 为对象数组，并知悉首轮语义/数字硬门仍失败；确认后才进入 P0-B。

## 7. 服务端环境变量

```dotenv
AI_ANALYSIS_ENABLED=true
AI_FEW_SHOT_ENABLED=false
COZE_API_URL=https://api.coze.cn/v1/workflow/run
COZE_WORKFLOW_ID=新版v2工作流ID
COZE_API_TOKEN=仅保存在本机的开发Token
COZE_MODEL_ID=控制台中实际模型ID
# Demo当前同步等待上限；不代表G1的P95性能目标或生产放行
AI_ANALYSIS_TIMEOUT_MS=25000
AI_MAX_RESPONSE_BYTES=262144
```

本仓库没有`.env.local`时，真实扣子冒烟保持`NOT_RUN`；页面和API会继续使用B0，不应据此判断扣子故障。

不要在当前联调中把`AI_FEW_SHOT_ENABLED`改为`true`。后续只有在样例逐条优化、状态改为`approved_for_experiment`，并冻结无Few-shot对照结果后，才建立独立实验开启。
