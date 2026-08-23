# T001 Fixture Findings

- 当前迁移清单：18 条自动骑后候选，11 条 READY，7 条 NEEDS_FIXTURE。
- 需要补齐的上下文类型：不同路线历史不可比、估算最大心率、无个人基线的高心率、室内心率-only、FTP不足、历史不足、室内功率-only。
- 当前 fixture 集没有显式室内模式或估算/FTP不足场景；历史与个人资料由 `buildRideAnalysisContext` 的 options 构造。
- 不修改旧 30 条评测文件，不伪造模型结果；新增样例应保持自动骑后 v0.3 合同。
- 七条补充 fixture 已完成：迁移清单变为 18 READY / 0 NEEDS_FIXTURE；7 个可复制 Coze 输入已生成。
