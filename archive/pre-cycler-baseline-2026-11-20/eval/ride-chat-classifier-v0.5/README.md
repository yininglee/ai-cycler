# 分类器边界合同回归集 v0.5

当前合同为 chat-classifier-v0.3，Prompt 为 ride-chat-classifier-prompt-v0.5.0。五种结果分别为安全、隐私、注入、明确域外和 allow。needsClarification 固定 false。

用例来自 v0.4 已知样例，域内业务与含糊指代统一重标为 allow。全部作为回归资料，不提供新盲测证据。原 v0.4 的历史结果适用于当时的业务分类合同。

运行 `node scripts/preflight-ride-chat-classifier-eval.ts` 校验资产哈希和合同一致性。联网评测入口为 `scripts/eval-classifier-accuracy.ts`，使用当前数据集与配置的分类模型。

上下文与查询范围的工程回归见 chat-arch02-execution、chat-arch03-context、chat-route 和 scn03-recent-knowledge 测试。旧业务标签不得清除已选记录或改变查询窗口，范围重置使用 rideScope，范围查询以工具入参为准。
