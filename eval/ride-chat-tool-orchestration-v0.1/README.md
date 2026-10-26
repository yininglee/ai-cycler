# AEVAL-TOOL-ORCHESTRATION v0.1（AGT-B5 编排案例集）

## 这是什么

评测模型在 L2b 工具循环里的**编排质量**：该调的工具是否调了、不该调的是否没调、调用参数是否合法。

**不测路由**——route 统一按用例语义给定（`autonomous_tools`）。路由质量由 `AEVAL-M3-CHAT v0.7` 单独测。分开的理由：混合评测会让"分错路由"与"编排失败"互相掩盖，且调用量翻倍。

## 判分（D-B8 三项制，不比序列）

1. `requiredTools` 全部出现在 completed 的调用里
2. `forbiddenTools` 一个都没出现
3. 本轮无 `rejected` 调用（参数非法即失败）

`requiredEvidence` 用于语义化校验：`knowledge` → 必须调过 `search_knowledge_base`；`capabilities` → 必须调过 `get_capabilities`；`claims` → 至少一个取数类工具（明细/比较/检索/统计/负荷/档案/路线）。

**不比序列顺序**：顺序只作归因诊断，不作门槛——模型可以先查档案再检索，也可以反过来。

## 结构

```json
{
  "caseId": "ORCH-11",
  "split": "regression | boundary | negative",
  "kind": "single | composite | write_attempt | injection",
  "input": "用户问法",
  "anchor": "latest",
  "expected": { "requiredTools": [], "forbiddenTools": [], "requiredEvidence": [] }
}
```

`requiredTools` 为空 + `forbiddenTools` 挂上全部 9 工具 = **本轮不应调用任何工具**（负例 19/20）。

## 分布（20 例）

- regression 12：6 个单工具 + 3 个复合 + 3 个能力面
- boundary 6：窗口边缘（365 天）、无投影字段（身高）、复合含知识+数据
- negative 2：写操作、提示注入

## 怎么跑

```bash
# 静态校验（零模型）
node scripts/preflight-ride-chat-tool-eval.ts

# 真实模型（默认 3 次重复、间隔 1.5s 防限流）
node --env-file=.env.local scripts/eval-tool-orchestration.ts --set=orchestration --repeat=3 --sleep=1500
```

结果写入 `eval/runs/AEVAL-TOOL-ORCH-<timestamp>.json`。

## 冻结纪律

`manifest.json` 记录 `casesSha256`；改任何用例必须重算 SHA 并升版本，**旧 Run 结论标 supersede**（P7 制度）。preflight 会在 SHA 不一致时直接 FAIL。
