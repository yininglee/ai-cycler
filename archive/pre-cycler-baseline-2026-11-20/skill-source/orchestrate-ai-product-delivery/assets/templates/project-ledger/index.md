# [PRODUCT_NAME] 台账导航

> 人工导航与事实源目录；不承载项目事实，也不是Codex每次恢复的必读文件。

## 事实源

| 事实 | 权威文件 |
|---|---|
| 当前阶段、Gate、阻塞、下一项、版本矩阵 | `current-status.md` |
| 实施、反馈、验收、失败、纠正 | `progress-ledger.md` |
| 产品、AI、技术和放行决定 | `decision-log.md` |
| 工作项验证 | `reviews/ITEM-*.md` |
| 跨版本基准 | `eval/benchmark-report.md` |
| 原始AI运行 | `eval/runs/`中的`RUN-*`记录 |
| Gate、灰度、回滚政策 | 版本路线图与上线放行机制 |

## 当前链接

- 当前状态：`current-status.md`
- 当前工作项最近日志：`progress-ledger.md`
- 当前评审/基准：按当前状态中的链接打开

## 精简日志格式

```markdown
## LOG-YYYYMMDD-NNN｜变化摘要

- 元信息：日期 / 阶段 / 工作项；状态：`STATUS`
- 本次变化：
- 验证摘要与证据链接：
- 下一步：
```

仅在发生时增加版本变化、用户反馈、风险、阻塞或`NOT_RUN/PARTIAL`；不要填写空字段。
