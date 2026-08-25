# AI 骑行伙伴项目进展台账

> 类型：追加式事实记录  
> 规则：不删除或静默改写历史；更正以新条目追加。

---

## LOG-20260814-001｜上游产品材料就绪

- 日期：2026-08-14
- 阶段：项目规划
- 状态：`COMPLETED`
- 输入：`ai-cycling-amateur-plan.md`、`ai-cycling-amateur-prd.md`、`UED参考/`
- 结果：已有产品定位、目标人群、6 个 MVP 模块、AI 初步方案和 UED 参考图。
- 发现：完整 PRD 范围大于单人验证型 Demo 的合理范围；“AI 做翻译官”与 MVP 训练计划存在边界冲突。
- 下一步：从验证假设倒推 Demo 范围与 Agent 方案。

---

## LOG-20260814-002｜Demo、Agent 与评测研发基线完成

- 日期：2026-08-14
- 阶段：v0.0 前置设计
- 状态：`COMPLETED`
- 产物：
  - `AI骑行伙伴-Demo搭建与Agent研发指南.md`
  - `prompts/cycling-buddy-system-prompt.md`
  - `eval/ai-cycling-eval-cases.jsonl`
  - `eval/benchmark-report.md`
- 关键方案：单 Agent + 两条固定 Workflow；规则负责事实与安全，模型负责解释与表达；RAG 只用于审核知识；Function Calling 用于按需读取私有/实时数据。
- 评测资产：30 条用例，覆盖 L1/L2/L3、边界、安全、Prompt 注入、工具和 RAG；JSONL 格式验证通过。
- 基准状态：T0 仅完成协议和资产；因无可运行 Workflow 和模型配置，没有伪造 T1 实测分数。
- 验证：文档结构与代码围栏检查通过；JSONL 使用 `jq` 校验通过。
- 下一步：补充 Demo 到上线的版本路线与放行机制。

---

## LOG-20260814-003｜版本路线与上线放行机制完成

- 日期：2026-08-14
- 阶段：发布规划
- 状态：`COMPLETED`
- 产物：`AI骑行伙伴-版本路线图与上线放行机制.md`
- 路线：v0.0 → v0.1 Demo → v0.2 Alpha → v0.5 Beta → v0.9 MVP RC → v1.0 邀请制公开 Web → v1.x 证据驱动扩展。
- 内容：各阶段假设、样本量、Gate、AI/产品/工程/隐私/成本门槛、灰度、Feature Flag、回滚、事故分级、合规核对与发布模板。
- 参考排期：10–14 个有效开发周；低投入情况下按 16–24 个自然周规划。
- 验证：840 行；Markdown 代码围栏数量为偶数；交叉引用文件存在。
- 下一步：建立持续更新台账并确认首期范围。

---

## LOG-20260814-004｜项目台账建立

- 日期：2026-08-14
- 阶段：v0.0 前置确认
- 状态：`READY_FOR_PREVIEW`
- 产物：
  - `project-ledger/README.md`
  - `project-ledger/current-status.md`
  - `project-ledger/progress-ledger.md`
  - `project-ledger/decision-log.md`
- 目的：后续每个开发、测试、用户预览、Gate 和发布决定均可追溯。
- 当前等待：用户确认 DEC-001～003。
- 下一步：范围确认后，将 ITEM-V001 置为 `IN_PROGRESS`，建立 v0.0 fixture 与 Schema。

---

## LOG-20260814-005｜侧边学习笔记一致性核对

- 日期：2026-08-14
- 阶段：v0.0 前置确认
- 状态：`COMPLETED`
- 核对文件：`Demo验证到产品上线-学习笔记.md`
- 一致结论：学习笔记与项目路线图都采用 Demo → Alpha → Beta → 小范围上线 → 持续迭代，并要求按证据增加功能、按风险匹配测试。
- 差异：学习笔记是通用方法，建议 Alpha 20–50 人、Beta 100–500 人；项目路线图为单人项目采用更小的受控批次——Alpha 10–15 人、Beta 30–50 名激活用户、v1.0 100–300 人。
- 处理：不修改学习笔记；项目执行采用路线图的保守样本与逐批放量，所有比例同时报告分子/分母。
- 下一步：用户确认 DEC-001～003。

---

## LOG-20260814-006｜AI 产品交付编排 Skill 创建并安装

- 日期：2026-08-14
- 阶段：v0.0 前置确认
- 状态：`COMPLETED`
- Skill：`orchestrate-ai-product-delivery`
- 个人安装位置：`/Users/liyining/.codex/skills/orchestrate-ai-product-delivery/`
- 可版本管理源镜像：`skill-source/orchestrate-ai-product-delivery/`
- 能力：从 AI 产品规划/PRD/UED/代码生成并协同维护 Demo 与 Agent 研发指南、版本路线和放行机制、项目台账；随后按实施、测试、用户预览、验收、记录和下一步闭环持续指导。
- 资源：4 份渐进加载参考、5 份文档模板、1 个无第三方依赖的一致性检查脚本、UI 元数据。
- 标准验证：`quick_validate.py` 通过，结果 `Skill is valid!`。
- 脚本验证：当前项目严格检查 `0 error / 0 warning`；空项目正确报告 6 个缺失项。
- 独立前向测试：无当前对话上下文，仅使用原始规划、PRD 和 UED，在临时目录生成三文档、台账、8 条评测用例和 T0 `NOT_RUN` 报告；严格检查 `0 error / 0 warning`。
- 安装一致性：个人安装目录与工作区源镜像 `diff -qr` 无差异。
- 下一步：使用该 Skill 继续 ITEM-V000，确认 DEC-001～003 后开始 ITEM-V001。

---

## LOG-20260814-007｜ITEM-V000 范围确认完成并启动 ITEM-V001

- 日期：2026-08-14
- 阶段：v0.0 基线实现 / G0
- 状态：`IN_PROGRESS`
- 用户反馈：确认移动端响应式 Web；确认不生成多周训练处方；将数据接入从“样例+GPX、FIT 后置”调整为“样例+FIT+GPX，FIT 优先”，原因是现有和目标用户数据主要为 FIT。
- 决策结果：DEC-006、DEC-007、DEC-008 均 `ACCEPTED`；ITEM-V000 `ACCEPTED`。
- 文档同步：研发指南升级至 v1.2，版本路线升级至 v1.1，FIT 纳入 v0.1 和 G0/G1 范围。
- 当前工作项：ITEM-V001 `IN_PROGRESS`，建立统一 Schema、fixture 和确定性质量规则；暂不实现真实 FIT/GPX 解析器。
- 下一步：完成领域层实现、自动测试并提交用户预览。

---

## LOG-20260814-008｜ITEM-V001 统一 Schema 与 Fixture 提交预览

- 日期：2026-08-14
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V001
- 状态：`READY_FOR_PREVIEW`
- 目标：让内置样例、FIT 和 GPX 在进入规则/前端/AI 前使用同一个可追溯事实模型。
- 实际完成：RideActivity/Metric/SensorQuality/Issue/Capability TypeScript Schema；L1/L2/L3 判级、质量降级、短骑、时间戳、数值一致性、证据与公式版本规则；13 条 fixture（sample 3、FIT 8、GPX 2）。
- 变更文件：`package.json`、`pnpm-lock.yaml`、`.gitignore`、`src/domain/ride-schema.ts`、`src/domain/ride-rules.ts`、`src/fixtures/rides.ts`、`tests/ride-rules.test.ts`、`reviews/ITEM-V001-schema-fixture-review.md`。
- 版本矩阵：app 未创建；schema v0.1；rules v0.1；prompt v1.0 未实测；workflow/model/kb 未创建；eval v1。
- 测试与真实结果：Node 24 `node --test tests/*.test.ts`，17/17 通过；Skill 严格文档检查 0 error / 0 warning。
- 未执行验证：真实 FIT/GPX 解析、设备兼容、完整 TypeScript `tsc`、前端、扣子与模型调用均 `NOT_RUN`。
- 预览：`reviews/ITEM-V001-schema-fixture-review.md`。
- 用户反馈：等待。
- 验收决定：等待用户选择接受、修改或暂缓。
- 风险：当前 80% 覆盖率与 2% 无效样本比例是保守初值，需用真实 FIT 样本校准。
- 下一步：用户验收 ITEM-V001；未验收前不进入解析库选型或页面实现。

---

## LOG-20260817-001｜ITEM-DOC-001 PRD第7节AI产品专项提交预览

- 日期：2026-08-17
- 阶段：v0.0 架构对齐与基线实现 / G0
- 工作项：ITEM-DOC-001
- 状态：`READY_FOR_PREVIEW`
- 触发：用户在侧边任务完成Agent架构问题梳理，要求先完善PRD第7节再继续Demo开发。
- 输入：`AI骑行伙伴-Agent架构学习笔记.md`、`ai-cycling-amateur-prd.md`、`AI骑行伙伴-Demo搭建与Agent研发指南.md`、System Prompt、30条评测集、T0基准报告、版本路线与现有决策记录。
- 实际完成：PRD升级至v1.2；第7节从“泛化RAG + 固定DeepSeek + 3项质量指标”重构为12个小节，覆盖第一性原理、混合架构、单Agent双Workflow、规则/RAG/Function Calling/LLM决策矩阵、数据证据契约、工具合同、知识库治理、Prompt、安全与五级降级、模型/成本协议、三层评测、B0–B3基准、可观测性与放行。
- 一致性修正：第6.5节不再描述RAG检索用户骑行数据；改为只读工具读取私有/精确事实，RAG只检索审核知识。
- 范围保护：明确v0.1 Demo支持内置L1/L2/L3样例+FIT+GPX且FIT优先；Strava、多周处方型训练计划、实时路线和多Agent后置。
- 证据状态：没有执行模型调用，没有新增或伪造质量、延迟、成本结果；T0仍为`NOT_RUN`。
- ITEM-V001：继续保持`READY_FOR_PREVIEW`，未接受、未否决，待本工作项验收后恢复。
- 用户反馈：等待。
- 下一步：用户审阅并验收PRD第7节；如需修改，更新后重新预览。

---

## LOG-20260817-002｜ITEM-DOC-001 文档验证完成

- 日期：2026-08-17
- 阶段：v0.0 架构对齐与基线实现 / G0
- 工作项：ITEM-DOC-001
- 状态：`READY_FOR_PREVIEW`
- 预览材料：`reviews/ITEM-DOC-001-prd-section7-review.md`。
- Skill严格验证：`0 error / 0 warning`。
- PRD结构验证：第7节包含12个一级子节；Markdown代码围栏平衡；本地证据引用均存在。
- 旧架构检查：PRD中无“RAG检索用户骑行数据”“自动修正数值”“Embedding bge-m3”或固定DeepSeek表格残留。
- 评测资产验证：`eval/ai-cycling-eval-cases.jsonl`可解析，30条`case_id`唯一。
- 未执行：扣子Workflow、模型基准、延迟、成本、真实FIT/GPX解析与用户测试均`NOT_RUN`。
- 下一步：等待用户对ITEM-DOC-001给出接受、修改或暂缓决定。

---

## LOG-20260817-003｜ITEM-DOC-001 用户验收完成

- 日期：2026-08-17
- 阶段：v0.0 架构对齐与基线实现 / G0
- 工作项：ITEM-DOC-001
- 状态：`ACCEPTED`
- 用户反馈：用户明确回复“接受”。
- 验收范围：`ai-cycling-amateur-prd.md` v1.2第7节及预览材料所列六项研发约束，包括混合事实源、单Agent双Workflow、规则/LLM责任边界、基准驱动模型选型、五级降级/硬门槛/版本矩阵和FIT优先的Demo范围。
- 决策同步：新增DEC-010，将DEC-009的提案转为正式研发基线。
- 未扩大范围：没有接通扣子、选择模型、运行T1或默认验收ITEM-V001。
- 下一步：恢复ITEM-V001的Schema、fixture与质量规则用户预览和验收。

---

## LOG-20260817-004｜ITEM-V001 恢复预览并复跑自动测试

- 日期：2026-08-17
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V001
- 状态：`READY_FOR_PREVIEW`
- 前置条件：ITEM-DOC-001与DEC-010已`ACCEPTED`。
- 实际动作：恢复`reviews/ITEM-V001-schema-fixture-review.md`为唯一当前预览项；未修改Schema、规则或fixture行为。
- 自动测试：使用工作区Node 24执行`node --test tests/*.test.ts`，17/17通过，0失败，约81ms。
- 文档验证：Skill严格检查`0 error / 0 warning`。
- 环境说明：系统默认shell最初未暴露`node`命令，改用工作区捆绑Node可执行文件后正常运行；该问题不属于产品或测试失败。
- 未执行：真实FIT/GPX解析、设备兼容、前端、扣子和模型调用仍为`NOT_RUN`。
- 下一步：用户确认ITEM-V001的五项数据规则，或提出修改/暂缓。

---

## LOG-20260817-005｜ITEM-V001 用户验收并启动ITEM-V002

- 日期：2026-08-17
- 阶段：v0.0 基线实现 / G0
- 已验收工作项：ITEM-V001
- 验收状态：`ACCEPTED`
- 用户反馈：用户明确回复“接受 ITEM-V001”。
- 验收范围：统一`RideActivity v0.1`、13组fixture输入、L1/L2/L3判级、80%覆盖率/2%无效样本初始线、功率降心率、未知开发字段告警、损坏/矛盾拒绝、短骑/无时间戳降级。
- 验收证据：工作区Node 24复跑17/17自动测试通过；Skill严格检查`0 error / 0 warning`。
- 新工作项：ITEM-V002 `IN_PROGRESS`，真实FIT优先、GPX同步覆盖的最小解析链路。
- 范围保护：不接前端、数据库、扣子或模型；未发现用户真实文件样本，不宣称设备兼容已验证。
- 下一步：完成解析库证据比较，选择可回滚技术基线并实现端到端解析测试。

---

## LOG-20260817-006｜ITEM-V002 FIT/GPX最小解析链路提交预览

- 日期：2026-08-17
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V002
- 状态：`READY_FOR_PREVIEW`
- 技术选择：FIT使用`fit-file-parser`4.1.0，GPX使用`fast-xml-parser`5.11.0；直接依赖均为MIT，第三方库隔离在适配层。
- 实际完成：FIT二进制/CRC/Session/Record解析；GPX安全XML/轨迹/时间/距离/爬升解析；25MB/20万点限制；稳定解析错误码；统一`parseRideFile`入口；本地`inspect:ride`检查命令；TypeScript静态检查。
- 变更文件：`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`.gitignore`、`src/parsers/`、`scripts/inspect-ride-file.ts`、`tests/helpers/fit-sample.ts`、`tests/ride-parsers.test.ts`、`reviews/ITEM-V002-fit-gpx-parser-review.md`。
- 自动证据：`pnpm verify`通过；TypeScript `tsc --noEmit`通过；总测试27/27通过、0失败，其中解析器新增10项；Skill严格文档检查`0 error / 0 warning`。
- 安全/边界：FIT严格CRC；非骑行/多Session明确拒绝；GPX禁DOCTYPE/ENTITY，时间不可用时不生成速度；上传最大25MB，最多20万点。
- 许可盘点：当前生产传递依赖为MIT或BSD-3-Clause；不把工程盘点声明为法律意见。
- 未执行：用户真实FIT/GPX、设备兼容矩阵、私有开发字段、性能基准、上传API、页面、扣子和模型均`NOT_RUN`。
- 预览：`reviews/ITEM-V002-fit-gpx-parser-review.md`。
- 用户反馈：等待。
- 下一步：优先用1–3个用户真实FIT本地验证；用户确认基线或提出修改/暂缓。

---

## LOG-20260817-007｜ITEM-V002 用户真实FIT兼容验证与全0W修正

- 日期：2026-08-17
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V002
- 状态：`READY_FOR_PREVIEW`
- 用户反馈：用户明确告知真实FIT已放入`test-data/private/`，授权在本项目范围内进行本地解析验证。
- 样本与隐私：用户真实FIT 1个；文件位于Git忽略目录，仅本地读取，未上传模型或外部服务；台账不记录原始轨迹、坐标、具体骑行时间或明细数值。
- 首次真实验证发现：FIT头、长度、CRC、标准字段与Schema均可解析，但文件将无有效功率表示为全程0W，原实现因此生成0W功率指标并误判为L3。
- 修正：新增有效功率判定；全0W时移除功率指标和`power`传感器质量声明，降为L2，并记录`FIT_ALL_ZERO_POWER_IGNORED`；开发字段继续只告警、不影响标准字段。
- 变更文件：`src/parsers/fit-parser.ts`、`tests/helpers/fit-sample.ts`、`tests/ride-parsers.test.ts`、`reviews/ITEM-V002-fit-gpx-parser-review.md`、`project-ledger/current-status.md`、`project-ledger/progress-ledger.md`。
- 自动测试：工作区Node 24执行`pnpm verify`，TypeScript检查通过，28/28测试通过、0失败；新增全0W回归用例同时断言无功率指标、无功率质量声明且能力为L2。
- 真实样本复测：1/1解析成功；Schema有效；能力为L2；GPS/心率/踏频与基础汇总字段保留；功率指标和功率质量声明均不存在；出现开发字段与全0W忽略警告。
- 证据边界：只证明当前1个真实FIT样本与解析器v0.1兼容；真实GPX、多设备兼容矩阵、私有开发字段映射和性能基准仍未验证。
- 用户验收：等待。
- 下一步：用户选择“接受 ITEM-V002”“要求修改”或“暂缓”；未验收前不进入上传API/页面工作项。

---

## LOG-20260817-008｜ITEM-V002用户验收并启动ITEM-V003

- 日期：2026-08-17
- 阶段：v0.0 基线实现 / G0
- 已验收工作项：ITEM-V002
- 验收状态：`ACCEPTED`
- 用户反馈：用户明确回复“接受ITEM-V002”。
- 验收范围：FIT/GPX适配层、严格FIT校验、安全GPX解析、统一错误合同、25MB/20万点边界、全0W功率降级，以及“真实FIT 1/1兼容但不外推全设备”的证据边界。
- 验收证据：TypeScript检查通过；28/28自动测试通过；用户真实FIT 1/1解析成功并正确判为L2；Skill严格检查0 error / 0 warning。
- 决策同步：新增DEC-013，将DEC-012解析库提案转为正式技术基线。
- 新工作项：ITEM-V003 `IN_PROGRESS`，实现不调用LLM的B0确定性摘要、可追溯claim和降级输出。
- 范围保护：不同时创建页面、扣子Workflow、RAG、Function Calling或选择模型；真实GPX与多设备兼容矩阵后续补充。
- 下一步：完成B0输出契约、生成器、自动测试和可复跑基准记录，提交用户预览。

---

## LOG-20260817-009｜ITEM-V003 B0确定性摘要提交预览

- 日期：2026-08-17
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V003
- 状态：`READY_FOR_PREVIEW`
- 目标：建立无LLM也可用的确定性摘要与兜底，并形成后续B1/B2/B3增量对照组。
- 实际完成：`RideContextSnapshot 1.0`；记录/计算/估算指标分层；allowed/forbidden claim；证据ID、置信度和公式版本；L1/L2/L3能力裁剪；B0同构输出；basic/rejected固定降级；隐私裁剪；合同验证器；可复跑基准脚本。
- 变更文件：`src/domain/ride-summary.ts`、`tests/ride-summary.test.ts`、`scripts/benchmark-b0.ts`、`package.json`、`reviews/ITEM-V003-b0-summary-review.md`、`eval/benchmark-report.md`、项目台账。
- 自动测试：工作区Node 24执行`pnpm verify`；TypeScript检查通过；37/37测试通过、0失败，其中ITEM-V003新增9项。
- B0基准：`pnpm benchmark:b0`；13/13合同合法，13/13数字/claim可追溯，13/13能力边界通过，0失败；P50 0.069ms、P95 0.722ms；模型调用0、token 0、模型成本¥0。
- 性能证据边界：延迟为本机进程内13条单次运行，不代表API或页面端到端；¥0仅指无模型成本。
- 真实数据集成：用户真实FIT 1个经解析→判级→快照→B0复测，1/1合同有效并保持L2；无功率claim；不记录原始轨迹、坐标、具体骑行时间或明细数值。
- 未执行：Web页面/浏览器、扣子Workflow、B1/B2/B3、30条全量AI运行、双人盲评、用户可用性测试均`NOT_RUN`。
- 预览：`reviews/ITEM-V003-b0-summary-review.md`。
- 用户反馈与验收：等待。
- 下一步：用户选择“接受 ITEM-V003”“要求修改”或“暂缓”；接受后仅启动移动端优先的可点击视觉壳工作项。

---

## LOG-20260818-001｜ITEM-V003用户验收并启动ITEM-V004

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 已验收工作项：ITEM-V003
- 验收状态：`ACCEPTED`
- 用户反馈：用户明确回复“接受 ITEM-V003”。
- 验收范围：`RideContextSnapshot 1.0`、allowed/forbidden claim、`b0-template-v0.1`、basic/rejected降级、隐私裁剪、B0合同验证器及T0.1实测证据边界。
- 决策同步：新增DEC-014，正式确认B0兜底和B0/B2同构输出合同。
- 新工作项：ITEM-V004 `IN_PROGRESS`，搭建移动端优先的四页可点击视觉壳并以B0样例驱动。
- 范围保护：不接真实上传API、扣子、模型、账号、数据库或外部地图；本项只验证视觉、信息层级、页面状态与固定样例主流程。
- 下一步：提炼UED规则，实现页面、自动验证并提交浏览器预览。

---

## LOG-20260818-002｜ITEM-V004移动端视觉壳提交预览

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`READY_FOR_PREVIEW`
- 目标：让用户在真实页面中完成欢迎→样例选择→B0详情→证据→分享预览闭环，并检查full/basic/rejected和四种页面状态。
- UED输入：`UED参考/`五张Stoic iOS截图；提炼暖白背景、黑色主卡、粗体短标题、大圆角、胶囊按钮、充分留白和克制蓝紫渐变，不复制品牌资产。
- 技术实现：Next.js 16.3.1、React 19.2.8、TypeScript；App Router四页路由；全局Design Token；内置SVG图标；服务端生成B0视图模型；仅复制按钮为Client Component。
- 页面范围：`/`、`/import`、`/rides/[id]`、`/share/[id]`、404；包含empty/loading/error/success、L1/L2/L3、GPX无时间戳basic和FIT损坏rejected。
- 变更文件：`app/`、`src/ui/ride-view-model.ts`、`tests/ride-view-model.test.ts`、`next.config.ts`、`next-env.d.ts`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`AGENTS.md`/`CLAUDE.md`（Next开发服务器自动生成）、`reviews/ITEM-V004-visual-shell-review.md`及验收截图。
- 自动测试：`pnpm verify`通过；40/40测试通过、0失败；`pnpm build`生产构建成功。
- HTTP验证：主页、导入、L2详情、basic详情、rejected详情和L3分享六个请求均返回200。
- Chrome走查：390×844主流程六步全部通过；首页/详情无横向溢出；当前可见交互目标无小于44px项；1280×900桌面截图通过人工检查。
- 安全/边界：页面不包含模型Token或API密钥；不读取真实文件；不把B0冒充AI；拒绝态无冲突数字且禁用分享；分享卡标明隐藏起终点。
- 预览：`http://localhost:3000/`；文档`reviews/ITEM-V004-visual-shell-review.md`；截图`reviews/assets/ITEM-V004-*.png`。
- 未执行：真实上传API、真实轨迹图、保存图片、反馈持久化、扣子/模型、Safari/真机、屏幕阅读器人工测试、部署均`NOT_RUN`。
- 用户反馈与验收：等待。
- 下一步：用户亲自预览后选择“接受 ITEM-V004”“要求修改”或“暂缓”；未验收前不启动真实文件上传API。

---

## LOG-20260818-003｜ITEM-V004浏览器来源警告复核

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`READY_FOR_PREVIEW`
- 发现：首轮Chrome自动化以`127.0.0.1`访问由`localhost`启动的Next.js开发服务，Next.js按默认安全策略阻止不同来源的开发资源；服务端页面仍返回200，但该轮不能证明Client Component水合成功。
- 处理：不放宽`allowedDevOrigins`；改用评审地址`http://localhost:3000/`重新运行主流程和截图。
- 复核结果：主页→导入→L2详情→证据→分享流程通过；Clipboard API处于安全上下文，分享文案成功写入剪贴板；按钮在写入后显示“已复制”；无页面JavaScript错误。唯一资源404为未提供favicon，不影响主流程，后续可随品牌资产补充。
- 影响：LOG-20260818-002的服务端HTTP与视觉结果仍有效；Client Component可用性以本条复核为准。
- 下一步：继续等待用户验收ITEM-V004。

---

## LOG-20260818-004｜ITEM-V004缺失图标修正与最终构建

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`READY_FOR_PREVIEW`
- 触发：LOG-20260818-003复核时发现唯一404资源为尚未提供的站点图标。
- 修正：新增`app/icon.svg`品牌骑行图标；未引入外部图片或第三方品牌资产。
- 浏览器复核：`http://localhost:3000/`无≥400资源响应，无页面JavaScript错误。
- 最终构建：`pnpm build`成功，新增静态`/icon.svg`路由；Skill严格验证0 error / 0 warning。
- 下一步：继续等待用户验收ITEM-V004。

---

## LOG-20260818-005｜ITEM-V004概要与数据详情反馈确认

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`CHANGES_REQUESTED`
- 用户反馈：用户明确要求L1/L2/L3概要均保留“距离、骑行时间、平均速度、累计爬升”，暂不采用“3项公共指标+1项等级特征指标”；概要深化与骑行轨迹在记录详情页的展示后置。
- 用户接受范围：同意在当前工作项内增加基于现有`RideActivity v0.1` Schema的第一版“数据”Tab。
- 决策分类：统一四项概要=`ACCEPTED`；现Schema数据Tab=`ACCEPTED`；3+1概要=`DEFERRED`；轨迹、时序图与高级指标=`DEFERRED`。
- 范围保护：不增加卡路里、心率区间、IF、TSS、FTP或模拟轨迹；缺失和不可靠指标不以`0`占位。
- 下一步：实现分级数据Tab、补充自动测试与移动端浏览器验证，再次提交ITEM-V004预览。

---

## LOG-20260818-006｜ITEM-V004第一版数据Tab提交预览

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`READY_FOR_PREVIEW`
- 实际完成：详情页增加URL可定位的“解读/数据”双Tab；三等级概要明确固定距离、骑行时间、平均速度、累计爬升；数据Tab按能力展示基础、心率、功率、踏频分组；每项保留来源与evidence ID；增加数据来源、传感器覆盖率和问题码；损坏记录不展示数字。
- 来源修正：内置fixture记录值由“设备记录”改为“内置样例”，避免将合成样例误称为真实设备证据。
- 变更文件：`src/ui/ride-view-model.ts`、`tests/ride-view-model.test.ts`、`app/rides/[id]/page.tsx`、`app/globals.css`、`reviews/ITEM-V004-visual-shell-review.md`及项目台账。
- 自动验证：使用工作区Node 24运行`pnpm verify`，TypeScript通过，44/44测试通过、0失败；新增4项视图模型测试。
- 生产构建：`pnpm build`成功；`/rides/[id]`按预期为动态服务端路由。
- 浏览器验证：375px有效宽度下，L1只显示基础，L2增加心率，L3增加功率；evidence ID可展开；切换Tab后URL与选中态正确；无时间戳样例只显示距离/爬升且无`0 km/h`；损坏FIT指标数为0；L3`scrollWidth=clientWidth=375`。
- 证据边界：未实现真实轨迹、时序图、心率区间、卡路里、IF/TSS/FTP；未增加真实用户或设备兼容证据；Safari、真机与屏幕阅读器人工测试仍`NOT_RUN`。
- 预览：`http://localhost:3000/rides/l2-built-in-sample?tab=data`与`reviews/ITEM-V004-visual-shell-review.md`。
- 用户验收：等待。
- 下一步：用户检查概要四项、数据分组、来源说明与移动端密度，并选择接受、要求修改或暂缓ITEM-V004。

---

## LOG-20260818-007｜ITEM-V004 NP与踏频可见性反馈核对

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`READY_FOR_PREVIEW`
- 用户反馈：用户在L3数据页未识别到NP，也未看到踏频展示。
- 实际核对：NP已经以“标准化功率”展示，L3内置样例值为211W、来源为`np-v0.1`；当前可点击的L3内置样例没有`avgCadenceRpm`，因此踏频分组按“缺失不展示”规则未出现。
- 原因分类：NP属于命名可发现性问题；踏频属于演示fixture覆盖不足，不是Schema或详情组件不支持。
- 提议修正：将标签改为“标准化功率（NP）”；为L2/L3内置样例补充可明确标记为样例的平均踏频，使可点击Demo覆盖现有Schema能力。
- 测试状态：本条仅完成代码与浏览器只读核对，尚未实施修改，测试`NOT_RUN`。
- 用户决定：等待确认是否实施提议修正。
- 下一步：用户确认后，将ITEM-V004转为`CHANGES_REQUESTED`并实施；否则保持现状继续验收。

---

## LOG-20260818-008｜ITEM-V004踏频补充范围确认

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`CHANGES_REQUESTED`
- 用户决定：用户明确回复“补充踏频记录即可”。
- 范围分类：接受为L2/L3可点击内置样例补充平均踏频；不实施“标准化功率（NP）”改名；不改变Schema、判级规则、概要四项或真实文件解析逻辑。
- 证据边界：新增数值属于内置演示样例，不代表用户真实骑行或设备验证结果。
- 下一步：补充fixture、质量参数和回归断言，完成自动测试、生产构建与浏览器复核。

---

## LOG-20260818-009｜ITEM-V004踏频样例补充完成并重新预览

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 工作项：ITEM-V004
- 状态：`READY_FOR_PREVIEW`
- 实际完成：L2内置样例增加平均踏频84 rpm和96%样例覆盖率；L3内置样例增加平均踏频87 rpm和98%样例覆盖率；数据Tab自动出现“踏频数据”分组和踏频质量行。
- 未改变：NP继续显示为“标准化功率”；L1没有踏频；概要仍固定距离、骑行时间、平均速度、累计爬升；缺失数据仍不以0占位。
- 变更文件：`src/fixtures/rides.ts`、`tests/ride-view-model.test.ts`、`reviews/ITEM-V004-visual-shell-review.md`及项目台账。
- 自动验证：使用工作区Node 24运行`pnpm verify`，TypeScript通过，44/44测试通过、0失败；`pnpm build`生产构建成功。
- 浏览器验证：L2显示84 rpm，L3显示87 rpm；两页均出现“踏频数据”；L3踏频质量显示覆盖98%；L2/L3指标分级正确；页面无JavaScript错误。
- 证据边界：数值和覆盖率均为演示fixture，用于UI/规则验证；未因此增加真实设备兼容证据。
- 预览：`http://localhost:3000/rides/l3-built-in-sample?tab=data`。
- 用户验收：等待。
- 下一步：用户检查L2/L3踏频分组后，选择接受、要求修改或暂缓ITEM-V004。

---

## LOG-20260818-010｜ITEM-V004用户验收完成并准备G0审计

- 日期：2026-08-18
- 阶段：v0.0 基线实现 / G0
- 已验收工作项：ITEM-V004
- 验收状态：`ACCEPTED`
- 用户反馈：用户明确回复“接受 ITEM-V004”。
- 验收范围：移动端优先四页视觉壳、固定样例主流程、full/basic/rejected与页面状态、统一四项概要、“解读/数据”双Tab、按能力展示基础/心率/功率/踏频、证据与来源、分享预览及L2/L3踏频样例。
- 验收证据：LOG-20260818-009记录的44/44自动测试、生产构建与L2/L3浏览器踏频复核；评审文档`reviews/ITEM-V004-visual-shell-review.md`。
- 证据边界：用户验收是产品预览接受，不等于真实用户可用性、真实上传、真机兼容、模型质量或G0自动通过。
- 文档同步：研发指南更新至v1.3的当前基线状态；版本路线更新至v1.2的当前下一步；历史台账与T0/T0.1基准记录不改写。
- 新工作项：ITEM-G0-001状态`READY`，对G0六项硬条件进行正式证据审计并提交放行建议。
- 下一步：经用户指示后启动ITEM-G0-001；未完成放行前不接入扣子B2。

---

## LOG-20260818-011｜ITEM-G0-001正式启动

- 日期：2026-08-18
- 阶段：v0.0 / G0
- 工作项：ITEM-G0-001
- 状态：`IN_PROGRESS`
- 用户授权：用户明确回复“开始 ITEM-G0-001”。
- 目标：冻结v0.0版本矩阵，按安全/隐私→事实边界→核心任务→可靠性/延迟/成本顺序审计G0六项硬条件。
- 范围保护：不接扣子、不调用模型、不实现上传API、不顺手修复审计中发现的产品缺口。
- 验收标准：每项Gate关联可复现证据；给出唯一放行决定、回退基线、停止条件与下一工作项。
- 下一步：复跑自动测试、B0基准、生产构建、评测结构、前端密钥扫描与异常场景审计。

---

## LOG-20260818-012｜ITEM-G0-001审计完成并提交NO-GO预览

- 日期：2026-08-18
- 阶段：v0.0 / G0
- 工作项：ITEM-G0-001
- 状态：`READY_FOR_PREVIEW`
- 冻结矩阵：app`visual-shell-v0.1`、schema`0.1`、rules`ride-rules-v0.1`、snapshot`1.0`、FIT/GPX parser`v0.1`、B0`b0-template-v0.1`、eval set`v1`；Workflow/Model/KB未创建。
- 自动测试：`pnpm verify`通过，44/44测试通过、0失败；`pnpm build`生产构建成功。
- B0基准：13/13合同、数字追溯和能力边界通过；P50 0.039ms、P95 0.896ms；模型调用/token/模型成本为0/0/¥0。
- 其他证据：30条评测、30个唯一ID；`RA-L1-004`存在；当前5个可点击状态的事实/详情指标均保留evidence ID；前端源码与静态产物密钥特征扫描0命中。
- 阻断复现：合法坐标与递增时间构成的合成GPX跳点被计算为约2134.6km、64038.4km/h，`sourceIssues`为空；当前无法满足GPS跳点降级硬条件。
- 审计工具失败记录：首次JSONL统计命令因换行拆分写法错误退出1；修正后同轮30/30读取成功。该错误不计为产品失败。
- Gate结果：六项中5项`PASS`、1项`FAIL`；正式决定`NO-GO`，不允许接入扣子B2。
- 回退与停止：继续使用B0和固定样例；不开放真实上传；任何未降级GPS跳点、证据丢失或客户端密钥命中均维持停止。
- 报告：`reviews/ITEM-G0-001-g0-release-review.md`；基准追加记录：`eval/benchmark-report.md` T0.2。
- 建议下一项：ITEM-G0-FIX-001 GPS跳点确定性质量门；当前不启动，等待用户接受审计。
- 用户验收：等待。
- 下一步：用户回复`接受 ITEM-G0-001`或`要求复核：……`。

---

## LOG-20260818-013｜ITEM-G0-001用户验收并建立GPS跳点修复项

- 日期：2026-08-18
- 阶段：v0.0 / G0
- 已验收工作项：ITEM-G0-001
- 验收状态：`ACCEPTED`
- 用户反馈：用户明确回复“接受 ITEM-G0-001”。
- 验收范围：G0六项证据、5项PASS/1项FAIL、GPS跳点阻断复现、`NO-GO`放行决定、B0回退基线和“不接扣子/不开放真实上传”的风险控制。
- 决策同步：新增DEC-017，将DEC-016的提案转为正式决定；GPS跳点修复并复审通过前不得接入扣子B2。
- 文档同步：G0评审报告标记为`ACCEPTED`；版本路线更新至v1.3，当前顺序改为GPS修复→G0复审→扣子B2。
- 新工作项：ITEM-G0-FIX-001状态`READY`，只修GPS跳点确定性质量门，不扩大到地图匹配、上传API或模型。
- 测试执行：本条仅记录用户验收与状态迁移，没有代码变化，自动测试`NOT_RUN`；沿用LOG-20260818-012的审计证据。
- 下一步：经用户指示后启动ITEM-G0-FIX-001。

---

## LOG-20260818-014｜ITEM-G0-FIX-001正式启动

- 日期：2026-08-18
- 阶段：v0.0 / G0修复
- 工作项：ITEM-G0-FIX-001
- 状态：`IN_PROGRESS`
- 用户授权：用户明确回复“开始 ITEM-G0-FIX-001”。
- 目标：在GPX解析确定性事实层识别不可能的GPS跳点，避免异常距离和速度进入Schema、allowed claims或后续模型。
- 实施范围：带可靠时间戳GPX的版本化速度阈值、孤立跳点处理、不可安全修复拒绝、稳定issue/error、质量统计、fixture、规则与B0回归。
- 排除项：地图匹配、机器学习清洗、无时间戳空间纠偏、真实上传API、扣子、模型和G0放行决定。
- 验收标准：正常和合理高速不回归；孤立跳点安全过滤；连续/端点异常不猜测；错误事实不进入速度claim；全量测试、B0基准和生产构建通过；提交用户预览。
- 下一步：实现并复测原G0阻断样本，形成评审证据。

---

## LOG-20260818-015｜ITEM-G0-FIX-001实现完成并提交预览

- 日期：2026-08-18
- 阶段：v0.0 / G0修复
- 工作项：ITEM-G0-FIX-001
- 状态：`READY_FOR_PREVIEW`
- 版本矩阵：`RideActivity v0.1 / ride-rules-v0.1 / RideContextSnapshot 1.0 / b0-template-v0.1 / fit-parser-v0.1 / gpx-parser-v0.2 / gpx-gps-quality-v0.1`。
- 实际完成：200 km/h版本化硬阈值；仅在前后分段均超阈值且桥接合理时过滤孤立中间点；过滤后复检；连续或端点异常返回`GPX_IMPLAUSIBLE_TRACK`；可修复异常记录`GPX_GPS_SPIKE_FILTERED`、原始样本数、无效点数和覆盖率。
- 输出边界：异常点先于指标计算被移除；issue与能力局限归一为单条用户说明；B0只读取重算后的allowed claims。无时间戳GPX仍无法依靠分段速度识别空间跳点，属于本版明确边界。
- fixture变化：新增`l1-gps-spike`，当前确定性fixture由13条增加到14条；历史13条基准分母不改写。
- 变更文件：`src/parsers/gpx-parser.ts`、`src/parsers/parse-errors.ts`、`src/domain/ride-summary.ts`、`src/fixtures/rides.ts`、`tests/ride-parsers.test.ts`、`tests/ride-rules.test.ts`、`tests/ride-summary.test.ts`、`reviews/ITEM-G0-FIX-001-gps-quality-review.md`、`eval/benchmark-report.md`及项目协作文档/台账。
- 自动验证：加载工作区Node 24后，`pnpm verify`通过，48/48测试、0失败；`pnpm benchmark:b0`为14/14合同/数字追溯/能力边界通过，P50 0.059ms、P95 0.785ms；`pnpm build`成功。
- 失败记录：首次直接运行三个命令时终端`PATH`缺少Node，均在进入产品测试前失败；切换工作区运行时后同轮重跑成功。该失败属于验证环境配置，不计为产品失败。
- 阻断样本复测：同一合成GPX从约2134.6 km降为14.630m；3个样本中1个过滤；analysisMode为`basic`；allowed claims仅距离、总时间、累计爬升，不含速度；局限说明仅一条GPS跳点提示。
- 决策状态：新增DEC-018为`PROPOSED`，等待用户通过本项验收确认阈值与异常策略。
- Gate边界：G0继续为已验收的`NO-GO`；本项即使开发者验证完成也不自动放行，不接入扣子B2。
- 评审报告：`reviews/ITEM-G0-FIX-001-gps-quality-review.md`；基准追加记录：`eval/benchmark-report.md` T0.3。
- 用户验收：等待。
- 下一步：用户回复`接受 ITEM-G0-FIX-001`或提出修改；接受后建立并执行独立G0复审项。

---

## LOG-20260818-016｜台账结构优化规则生效

- 日期：2026-08-18
- 阶段：项目治理 / v0.0 G0修复
- 工作项：台账可追溯性优化
- 状态：`COMPLETED`
- 本次变化：新增`project-ledger/index.md`作为最短恢复路径；明确`current-status`、进展日志、决策日志、评审/基准报告的唯一事实源分工；未来日志改为“变化摘要 + 证据链接”，不再复制完整测试表、版本矩阵或决策理由。
- 影响文件：`project-ledger/index.md`、`project-ledger/README.md`、`project-ledger/current-status.md`、项目交付Skill及其源镜像。
- 历史处理：既有日志和决策记录保持不变；新规则从本条起生效，历史事实如需修正仍采用追加更正条目。
- 验证：待运行交付系统一致性校验；本条不改变产品代码、版本矩阵或G0放行结论。
- 用户反馈/验收：用户明确要求优化台账并同步Skill；本条记录该授权，优化结果待用户检查。
- 下一步：继续按新规则记录ITEM-G0-FIX-001预览和后续G0复审。

---

## LOG-20260818-017｜更正LOG-20260818-016并补齐台账优化

- 元信息：2026-08-18 / 项目治理 / 台账可追溯性优化；状态：`IN_PROGRESS`
- 更正：LOG-20260818-016使用了协议未定义的`COMPLETED`，且在校验待运行时即称规则生效；正确状态为修正与验证进行中。原条目保留，不静默改写。
- 本次变化：统一Codex恢复入口、精简当前状态和日志模板、拆分三类证据事实源，并补充模板与校验器。
- 验证摘要：新版校验器已复现并检出`LATEST_LOG_STATUS_INVALID: COMPLETED`。
- 下一步：同步个人Skill，完成Skill与交付系统全量校验后追加结果。

---

## LOG-20260818-018｜精简台账规则与Skill同步完成

- 元信息：2026-08-18 / 项目治理 / 台账可追溯性优化；状态：`READY_FOR_PREVIEW`
- 本次变化：Codex恢复只读`current-status`，`index`改为人工导航；日志采用条件字段；工作项验证、跨版本基准、原始AI运行分别归档；源Skill与个人安装版已同步。
- 验证摘要：[Skill源文件](../skill-source/orchestrate-ai-product-delivery/SKILL.md)与安装版基础校验均通过；[新版校验器](../skill-source/orchestrate-ai-product-delivery/scripts/validate_delivery_system.py)严格模式为0错误/0警告；两份Skill目录一致；坏链接负向检查可检出。负向测试夹具首次加载失败，修正加载方式后通过目标断言。
- 用户动作：用户已授权按审查建议修改；本次结果待检查。
- 下一步：继续等待ITEM-G0-FIX-001验收，后续按精简规则记录G0复审。

---

## LOG-20260818-019｜ITEM-G0-FIX-001用户验收

- 元信息：2026-08-18 / v0.0 G0修复 / ITEM-G0-FIX-001；状态：`ACCEPTED`
- 本次变化：用户接受GPS跳点质量门及已知边界；评审状态转为已验收，新增`DEC-020`正式确认规则；唯一下一项切换为`ITEM-G0-002` G0重新审计。
- 证据：[ITEM-G0-FIX-001评审](../reviews/ITEM-G0-FIX-001-gps-quality-review.md)、[T0.3基准](../eval/benchmark-report.md#10-t03gps质量门后的b0回归2026-08-18)。
- 用户决定：用户明确回复“接受 ITEM-G0-FIX-001”。
- Gate边界：G0仍为`NO-GO`；本次不启动扣子、模型或真实上传。
- 下一步：经用户指示后启动`ITEM-G0-002`，用已验收新矩阵独立复审G0。

---

## LOG-20260818-020｜ITEM-G0-002重新审计完成

- 元信息：2026-08-18 / v0.0 G0 / ITEM-G0-002；状态：`READY_FOR_PREVIEW`
- 本次变化：使用已验收GPS质量门冻结新矩阵并复审G0；六项结果为`6 PASS / 0 FAIL`，新增`DEC-021 PROPOSED`，建议`GO`但仅允许开发环境B2接入。
- 验证摘要：[G0复审报告](../reviews/ITEM-G0-002-g0-reaudit-review.md)；[T0.4 / RUN-20260818-001](../eval/benchmark-report.md#11-t04g0新矩阵重新审计2026-08-18)。
- 用户动作：等待验收本次放行结论与范围。
- 风险边界：B1/B2/B3、真实上传、真实GPX、多设备、5人测试和上线均未验证；当前有效G0决定在用户验收前仍为`NO-GO`。
- 下一步：用户回复`接受 ITEM-G0-002`或提出复核项。

---

## LOG-20260818-021｜ITEM-G0-002用户验收

- 元信息：2026-08-18 / v0.0 G0 / ITEM-G0-002；状态：`ACCEPTED`
- 本次变化：G0正式为`GO`；新增`DEC-022`，取代`DEC-021`提案和`DEC-017 NO-GO`；项目进入v0.1开发环境B2接入准备。
- 证据：[ITEM-G0-002复审](../reviews/ITEM-G0-002-g0-reaudit-review.md)、[T0.4 / RUN-20260818-001](../eval/benchmark-report.md#11-t04g0新矩阵重新审计2026-08-18)；交付系统严格校验为0错误/0警告。
- 用户决定：用户明确回复“接受 ITEM-G0-002”。
- 放行边界：仅允许开发环境B2最小接入；B1/B2/B3模型基准、真实上传、5人测试、G1和上线均未放行。
- 下一步：经用户指示后启动`ITEM-V005`扣子B2最小开发环境接入。

---

## LOG-20260818-022｜ITEM-V005服务端基线完成

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 本次变化：建立扣子服务端适配、camelCase严格输出合同、claim/数字/层级后校验、一次受限修复、B0降级、AI开关和Demo专用API；新增`DEC-023 PROPOSED`。
- 验证摘要：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md)记录66/66测试、14/14 B0回归、生产构建和密钥边界扫描结果；真实扣子调用仍`NOT_RUN`。
- 失败记录：前两次验证分别暴露`ProcessEnv` typing和Node strip-only参数属性兼容问题，修正后全量复跑通过。
- 下一步：用户按[Workflow配置指南](../coze/ride_analysis_v1-配置指南.md)建立私有开发版并回传非敏感版本信息；不回传Token。

---

## LOG-20260818-023｜扣子Workflow已创建

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 用户动作：用户已在扣子创建`ride_analysis_v1`。
- 下一步：在开始节点配置`ride_context_snapshot`、`repair_instruction`、`previous_output`三个String变量，暂不添加RAG、工具或代码节点。

---

## LOG-20260818-024｜扣子输入变量长度约束

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 新证据：扣子开始节点的变量名最长20字符，原`ride_context_snapshot`不可用。
- 调整：输入合同统一改为`ride_snapshot`，其内容仍是`RideContextSnapshot 1.0`；服务端、Prompt、测试和配置指南已同步。
- 下一步：用户配置`ride_snapshot`、`repair_instruction`、`previous_output`三个String变量。

---

## LOG-20260818-025｜Workflow输入合同已配置

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 用户动作：用户已完成`ride_snapshot`、`repair_instruction`、`previous_output`三个String输入变量配置。
- 下一步：添加并连接LLM节点，根据账号实际候选列表选择B2首测模型。

---

## LOG-20260818-026｜扣子结构化输出导入兼容问题

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 新证据：用户截图显示豆包2.0 mini节点已生成目标业务对象，但扣子当前“导入JSON”把标准JSON Schema解析为`schema/id/type/additionalProperties/required/properties`字段；结束节点绑定`properties`后返回`null`。
- 修正：保留`ride-analysis-output-schema.json`作为服务端强校验合同，新增`ride-analysis-output-example.json`供扣子推断七个业务字段；结束节点后续直接返回七个根字段，不新增代码节点。
- 风险边界：本次节点输出尚未通过结束节点、服务端合同或端到端冒烟，不计为B2成功样本，也不确认当前候选模型。
- 下一步：用户重新导入扣子专用输出样例；确认大模型节点输出字段正确后再配置结束节点映射。

---

## LOG-20260818-027｜扣子业务输出字段已恢复

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 用户动作与证据：用户已导入扣子专用输出样例；截图确认大模型节点暴露七个目标业务字段及正确的嵌套类型，`LOG-20260818-026`中的导入兼容问题已修复。
- 风险边界：结束节点仍是旧`output`映射，尚未形成可供服务端消费的Workflow返回，也未计入模型基准。
- 下一步：结束节点改为七个同名返回变量并逐项映射大模型节点输出。

---

## LOG-20260818-028｜扣子结束节点七字段映射完成

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 用户动作与证据：用户截图确认结束节点已删除旧`output`，七个业务变量按同名字段和正确类型映射到大模型节点，且未返回`reasoning_content`。
- 风险边界：截图中的运行状态不能证明它发生在映射更新后；本条只确认静态配置，不记为真实Workflow成功样本。
- 下一步：使用已有内置L1输入重新执行一次完整Workflow，并检查结束节点七字段实际值。

---

## LOG-20260818-029｜首次L1 Workflow调试合同未通过

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md#5-首次workflow调试证据)记录三节点与七字段返回成功，界面显示约23秒、5172 Tokens；但`limitations`为空且summary转写为58字符，命中两个硬合同错误。
- 结果边界：这是Workflow连通证据，不是B2成功样本；因缺少完整原始JSON、请求ID、成本和确切model ID，不登记为可比较`RUN-*`。
- 下一步：使用同一输入和首次输出人工触发一次受限修复，验证两个错误能否被删除且不新增事实。

---

## LOG-20260818-030｜豆包2.0 mini受限修复失败

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md#6-一次受限修复调试证据)记录修复调用约44秒、8649 Tokens；summary和空`limitations`均未改变，两个硬门错误仍存在。
- 降级边界：按服务端规则结果为`REPAIR_FAILED`并降B0，不做第三次模型调用；豆包2.0 mini当前不具备B2首选证据。
- 下一步：冻结Prompt、Schema、输入和参数，仅替换为豆包2.0 lite复跑首次L1，用单变量对照判断模型能力影响。

---

## LOG-20260818-031｜豆包2.0 lite局部合同改善但仍超时

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md#7-豆包20-lite单变量对照)记录同一L1单变量换模后约34秒、3988 Tokens；summary为67字符，`limitations`为1条，两个已知硬门错误已清除。
- 结果边界：其余claim/数字/层级合同未从截图完成验证；34秒仍超服务端预算，当前不能选定B2模型或发布Workflow。
- 下一步：获取本次完整七字段JSON，用已有服务端校验器确定其余硬门结果。

---

## LOG-20260818-032｜豆包2.0 lite首条L1完整合同通过

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[RUN-20260818-002](../eval/runs/RUN-20260818-002.json)保存用户提供的完整输出；同一服务端校验器返回`valid=true`、`issues=[]`，包括claim/数字/层级/安全和长度检查。
- 结果边界：仅1条L1、UI约34秒；确切model ID、发布Workflow版本、请求ID和成本缺失，标记`comparable=false`；延迟仍不满足8秒默认预算。
- 下一步：检查并截图LLM节点思考模式、temperature和输出Token上限，先解决可控配置问题，再扩大到L2/L3。

---

## LOG-20260818-033｜扣子模型参数可控项确认

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 新证据：用户截图确认当前为平衡模式、最大回复4096、深度思考开启/中；temperature未暴露，Chat API、当前时间/SP防泄漏和异常处理面板可见。
- 修正：更正先前“没有temperature和最大输出Token配置项”的不完整判断；最大回复长度和深度思考可控，temperature记录为`NOT_CONFIGURED`。配置指南与研发指南已同步。
- 下一步：仅改为精确模式、最大回复700、关闭深度思考，复跑同一L1观察延迟与合同是否保持通过。

---

## LOG-20260818-034｜扣子预设修改后显示自定义

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 用户澄清：扣子修改最大回复长度或深度思考开关后，生成多样性标签会从“精确模式”变为“自定义”。
- 解释与修正：这是预设参数被覆盖的正常UI行为；冻结“精确模式默认值 + 最大回复700 + 关闭深度思考”的最终参数组合，不要求界面继续显示“精确模式”。相关指南与当前状态已同步。
- 下一步：保存自定义参数组合，复跑同一L1并记录耗时、Tokens和合同结果。

---

## LOG-20260818-035｜优化参数后L1延迟显著改善

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md#9-优化参数后的l1调试证据)记录自定义参数组合下大模型约8.48秒、Workflow约9秒、2824 Tokens；截图可见`limitations`为2条。
- 结果边界：完整七字段尚未用服务端校验器复验；约9秒仍略高于8秒默认预算，不能据此放行API或G1。
- 下一步：获取本次完整JSON，先确认合同，再决定L2/L3或API延迟实测顺序。

---

## LOG-20260818-036｜优化参数L1完整合同仍失败

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[RUN-20260818-003](../eval/runs/RUN-20260818-003.json)经同一服务端校验器返回`INVALID_SUMMARY_LENGTH`，summary为59字符；同时记录三项自动合同未覆盖的语义质量疑点。
- 结果边界：参数优化改善延迟但未保证合同；该运行必须进入一次受限修复，且修复成功也不自动消除人工质量问题。
- 下一步：保持同一输入、模型、Prompt和参数，仅传本次输出与`INVALID_SUMMARY_LENGTH`执行一次修复。

---

## LOG-20260818-037｜一次修复仍失败并提出summary合同调整

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`IN_PROGRESS`
- 实际证据：[RUN-20260818-004](../eval/runs/RUN-20260818-004.json)记录唯一修复调用约9秒/3296 Tokens，summary由59字符变为49字符，仍触发`INVALID_SUMMARY_LENGTH`。
- 降级边界：必须`REPAIR_FAILED`并降B0，不做第三次调用；新增`DEC-024 PROPOSED`，建议将summary丰富度从硬门移到人工质量评分。
- 下一步：等待用户决定接受DEC-024或保留60字符硬下限；决定前暂停模型调用。

---

## LOG-20260818-038｜DEC-024接受并完成合同v0.2修订

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`READY_FOR_PREVIEW`
- 本次变化：用户接受DEC-024；B2输出Schema升级为`ride-analysis-output-v0.2`，Prompt升级为v1.2，B2/B0校验移除summary 60字符下限，保留非空、≤120及事实/安全等硬门。
- 证据：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md#11-dec-024接受后的合同修订)；RUN-004原始输出离线复验为v0.2 `valid=true`、49字符summary；[DEC-025](decision-log.md#dec-025确认dec-024并升级summary合同)。
- 验证：`pnpm verify` 69/69通过；`pnpm benchmark:b0` 14/14通过（P50 0.031ms，P95 0.421ms）；`pnpm build`成功；Schema JSON解析通过；交付系统严格校验0错误/0警告。
- 用户决定：用户明确回复“接受 DEC-024”；本地实现等待预览验收。
- 下一步：用户预览本地实现；接受后只执行一个动作：在扣子LLM节点替换为Prompt v1.2，不重跑或发布Workflow，直到预览获接受。

---

## LOG-20260818-039｜ITEM-V005本地实现用户验收

- 元信息：2026-08-18 / v0.1 / ITEM-V005；状态：`ACCEPTED`
- 本次变化：用户接受本地合同v0.2修订预览；ITEM-V005完成验收，未改变真实扣子Workflow或模型运行证据。
- 证据：[ITEM-V005评审](../reviews/ITEM-V005-coze-b2-integration-review.md#11-dec-024接受后的合同修订)、[LOG-20260818-038](progress-ledger.md#log-20260818-038dec-024接受并完成合同v02修订)。
- 用户决定：用户明确回复“接受”。
- 风险边界：扣子Prompt尚未同步；真实Workflow、L1/L2/L3冒烟、API延迟和G1仍未验证。
- 下一步：开始`ITEM-V005-PROMPT-001`，只在扣子LLM节点替换Prompt v1.2，不重跑或发布。

---

## LOG-20260818-040｜扣子Prompt v1.2已替换

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`READY_FOR_PREVIEW`
- 本次变化：用户确认已将System Prompt替换为v1.2；未记录Workflow运行、发布或模型质量结果。
- 用户动作：用户明确回复“Prompt 已替换”。
- 风险边界：尚未取得扣子节点参数/版本的非敏感截图或文字确认；L1/L2/L3冒烟、API延迟和G1仍未验证。
- 下一步：预览并确认扣子LLM节点仍为冻结参数组合；确认前不运行或发布Workflow。

---

## LOG-20260818-041｜扣子模型参数截图预览

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`READY_FOR_PREVIEW`
- 新证据：用户截图确认Chat API；自定义模式下重复语句惩罚`0.00`、最大回复长度`700`、最大推理&回答长度`0`；当前时间和SP防泄漏指令关闭；深度思考开关及程度均为关闭。
- 用户动作：用户提交扣子模型设置截图；temperature字段未出现，继续记录为`NOT_CONFIGURED`。
- 风险边界：截图未包含结束节点七个输出字段映射，也未执行Workflow；不计为模型成功样本或发布证据。
- 下一步：只确认结束节点七个字段映射保持不变；确认前不运行或发布Workflow。

---

## LOG-20260818-042｜扣子LLM七字段输出截图预览

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`READY_FOR_PREVIEW`
- 新证据：用户截图确认LLM节点输出格式为JSON；`headline`、`summary`为String；`highlights`为包含`text`/`claimIds`/`confidence`的Array<Object>；`nextAction`为包含`text`/`basisClaimIds`的Object；`limitations`、`shareCopy`为Array<String>；`safetyLevel`为String；支持续写关闭。
- 边界证据：截图同时显示平台附带的`reasoning_content` String；它不是业务合同字段，禁止映射到结束节点或服务端输出，否则会触发未知字段校验。
- 用户动作：用户提交LLM节点输出结构截图。
- 风险边界：结束节点实际返回是否只包含七个业务字段、Workflow是否运行成功仍未验证；不计为模型成功样本或发布证据。
- 下一步：只确认结束节点排除`reasoning_content`并保留七个业务字段；确认前不运行或发布Workflow。

---

## LOG-20260818-043｜结束节点排除reasoning_content确认

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`READY_FOR_PREVIEW`
- 新证据：用户确认结束节点已没有`reasoning_content`，七个业务字段保持为最终返回合同。
- 用户动作：用户明确说明“结束节点没有了”。
- 风险边界：尚未执行新的Workflow调试；模型质量、端到端延迟、B2成功率和G1仍未验证。
- 下一步：使用内置L1样例运行一次完整Workflow调试，只检查结束节点实际七字段JSON和是否能被服务端合同校验；不发布Workflow。

---

## LOG-20260818-044｜L1首次Workflow调试命中受限修复

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`IN_PROGRESS`
- 实际证据：[RUN-20260818-005](../eval/runs/RUN-20260818-005.json)；内置L1结束节点返回七字段，约7秒，当前服务端合同唯一失败为`ACTION_WITHOUT_BASIS`。
- 结论：模型已遵守主要事实/数字/能力边界，但`nextAction.basisClaimIds`为空；因快照存在可引用claim，不能作为B2成功样本，不能发布。
- 风险边界：不修改页面、Schema、结束节点或冻结参数；这不是Token、reasoning_content或字段映射问题。
- 下一步：对同一L1输入执行一次受限修复，只传`ACTION_WITHOUT_BASIS`和本次完整输出；修复后重新校验，禁止第三次调用。

---

## LOG-20260818-045｜L1受限修复通过合同

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`READY_FOR_PREVIEW`
- 实际证据：[RUN-20260818-006](../eval/runs/RUN-20260818-006.json)；同一L1、同一模型和参数下，修复为`ACTION_WITHOUT_BASIS`补充两个有效依据claim后，当前v0.2合同返回`valid=true`、`issues=[]`。
- 结论：本次L1完成“首次失败→一次受限修复→合同通过”闭环；不计为可比较模型基准，不能外推L2/L3或G1。
- 用户动作：用户提交修复后的完整七字段JSON和调试截图。
- 风险边界：尚未验证L2/L3、其他失败类型、真实API延迟、成本、发布版本和5人测试。
- 下一步：提交`ITEM-V005-PROMPT-001`用户验收；验收后再开始L2/L3冒烟。

---

## LOG-20260818-046｜用户反馈要求提升骑后洞察质量

- 元信息：2026-08-18 / v0.1 / ITEM-V005-PROMPT-001；状态：`CHANGES_REQUESTED`
- 用户反馈：当前summary和highlights主要平铺距离、时间、速度、爬升；“数据完整的骑行”对用户意义有限，解读丰富度和专业度不足。
- 诊断：事实/数字/claim硬门已通过，但Prompt没有把“非复述、解释数据关系、说明用户意义、承认不可判断”定义成可执行质量规则；L1当前也缺少心率/功率和外部基准，不能凭空推断体能或训练效果。
- 决策状态：新增`DEC-026 PROPOSED`，建议Prompt v1.3采用“洞察优先”结构；用户确认前不修改Prompt或重跑Workflow。
- 下一步：审阅并决定Prompt v1.3方案；通过后再同步文件、扣子Prompt和评测用例。

---

## LOG-20260819-001｜单次骑后体验升级为PRD整体重对齐

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户反馈：无AI需完整展示FIT/GPX单次数据；AI需按PRD 6.3多维评价本次骑行并结合历史；能力按实际字段组合而非严格L1/L2/L3；需工程化Few-shot和模块×版本规划。
- 审计结论：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)确认当前缺少时序/轨迹、历史比较、多维特征合同，旧Prompt优化不足以解决产品价值问题。
- 范围调整：暂停旧Prompt的L2/L3冒烟和发布；先与用户逐条确认PRD冲突，再同步PRD、研发指南、路线图和评测。
- 下一步：确认参考图中“得分换成运动”的准确字段含义与单位。

---

## LOG-20260819-002｜确认摘要使用运动消耗指标

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户明确确认摘要中的“得分”改为“运动消耗”；记录为`DEC-027 ACCEPTED`，展示单位为`kcal`。
- 边界：FIT存在设备记录值时展示记录值；GPX或缺失时只能在具备版本化公式和必要输入后展示估算值并标注“估算”，不得把缺失值补成0。
- 下一步：确认无AI单次详情在v0.1 Demo的最小实现范围及高阶数据分期。

---

## LOG-20260819-003｜确认无AI单次详情v0.1范围

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-028`；v0.1纳入隐私安全SVG轨迹、概要、可用传感器指标、基础曲线和数据明细，界面继续沿用当前风格。
- 范围边界：真实底图、区间分布、高阶事件/图表以及依赖FTP、历史或规则前提的训练指标延期，后续必须写入模块×版本实现矩阵。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)。
- 下一步：确认AI骑后输出结构及“评价骑行、不评价数据完整度”的内容边界。

---

## LOG-20260819-004｜确认AI骑后解读结构

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-029`；AI评价本次骑行，按实际能力生成整体评价、动态多维解读、确定性亮点事件和有依据的一条建议，不以数据完整度为主体评价。
- 决定关系：`DEC-029 SUPERSEDES DEC-026`；旧Prompt v1.3局部优化方案不再作为当前方向，后续将单独评审输出Schema v0.3和Prompt。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)、[RUN-20260818-006](../eval/runs/RUN-20260818-006.json)及用户明确确认。
- 下一步：确认用实际可用能力集合取代L1/L2/L3业务硬门，并明确L1/L2/L3是否仅保留为测试分组。

---

## LOG-20260819-005｜确认原子能力模型

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-030`；产品、UI和Prompt将按轨迹、时间、海拔、心率、功率、踏频、历史比较与可信用户基线等实际能力组合生成内容。
- 范围边界：L1/L2/L3仅保留为现有Fixture/评测的内部分组，不对用户展示且不作为业务硬门；功率、心率或历史数据的存在不会自动授予其派生分析能力。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认自动骑后分析、对话式历史查询与RAG的职责分工。

---

## LOG-20260819-006｜确认历史比较事实链

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-031`；自动解读由服务端预取并计算`HistoricalComparisonSnapshot`，对话通过只读Function Calling按问题调用同一历史服务，RAG不作为历史数值事实源。
- 交互补充：首次骑行或历史不可比时，自动解读静默省略历史维度，直接解读本次骑行；只在用户主动询问历史结论且证据不足时说明无法判断。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：逐条确认PRD 6.2/6.3中的数据与分析规则，首先处理无时间戳GPX的可用能力边界。

---

## LOG-20260819-007｜确认无时间戳GPX边界

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-032`；无可信时间戳GPX不模拟时间轴，只使用实际具备的轨迹、距离和海拔能力，不生成时长、速度、时长派生负荷或快慢结论。
- 交互边界：UI和自动AI解读静默省略不可用指标/维度；只在用户主动询问时长或速度时说明无法判断。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认首次含功率数据的骑行能否自动形成可信FTP，以及FTP不可信时的功率分析边界。

---

## LOG-20260819-008｜确认功率与FTP能力分离

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-033`；首个功率FIT不自动形成可信FTP，v0.1允许平均/最大功率、功率曲线、稳定性与合规NP分析，但不实现FTP估算或生成依赖FTP的功率区间、IF、TSS和训练/恢复结论。
- 规则变化：取消“有功率即专业训练级”的默认；FTP必须具有来源、时间和置信状态，系统估算属于后续独立能力。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认最大心率的来源与可信等级，以及使用估算最大心率时的心率区间与AI表达边界。

---

## LOG-20260819-009｜确认个人资料与心率基线

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户确认`DEC-034`；填写年龄后默认以`220 - 年龄`产生可用的估算最大心率与心率区间，允许用户在个人资料中覆盖；数值必须保留来源、时间和公式版本。
- 个人资料范围：年龄、身高、体重、最大心率和FTP；FTP继续受`DEC-033`约束，个人资料和区间模块的实现阶段待模块×版本矩阵确认。
- 表达与隐私边界：AI不将系统估算值表述为实测；个人资料和区间设置页显示来源，上线前需完成权限、告知、删除和最小化模型传输评审。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认固定踏频阈值能否用于“偏低/标准/优秀”的评价，以及无上下文时的踏频AI表达边界。

---

## LOG-20260819-010｜确认踏频解读边界

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户确认`DEC-035`；删除脱离场景的“偏低/标准/优秀”固定阈值评级，v0.1展示踏频数据/曲线并只在有确定性上下文时生成描述性AI解读。
- 边界：无必要上下文时不给固定目标踏频或“更省力”结论；传感器异常由确定性规则处理，踏频区间分布继续延期。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认恢复建议的事实前提、自主程度和v0.1边界。

---

## LOG-20260819-011｜确认恢复建议边界

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-036`；v0.1不仅凭距离、速度或单次平均心率生成个性化恢复处方，下一步建议可为有证据的技术/观察建议、明确标记的通用骑后整理，或省略。
- 安全边界：个性化恢复需后续可信负荷/历史/必要主观反馈与专项规则；高风险症状触发固定停止训练与求助提示，AI不做病因诊断。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认PRD中“骑行<3km或<10min一律不生成完整AI解读”是否改为按有效能力与分析价值动态降级。

---

## LOG-20260819-012｜确认短活动AI降级

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-037`；`<3km/<10min`改为短活动标记，由`AnalysisEligibility`根据可解释特征动态决定是否调用模型，无AI增量时直接展示无AI详情。
- 范围边界：室内或无GPS骑行按实际时间/功率/心率/踏频能力判断；异常或采样不足时不让模型猜测。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认运动消耗的记录值、估算值和功率换算值的优先级与展示边界。

---

## LOG-20260819-013｜确认运动消耗来源优先级

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-038`；运动消耗优先使用可信设备记录值，其次是必要输入齐全时的版本化估算，最后才是标记为近似值的功率换算。
- 范围边界：缺少体重/时长/可信功率时不补零或虚构；GPX无可信时间戳不计算依赖时长的消耗；AI不混用来源，生活化食物换算不作v0.1默认展示。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认Few-shot样例库的建设和维护方式，然后合并更新PRD 6.2/6.3和编号决策。

---

## LOG-20260819-014｜确认Few-shot工程化样例库

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-039`；Few-shot作为独立版本化样例库维护，由确定性能力路由选择2–3个示例注入Prompt，并与规则、Schema、评测和运行版本同步。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md)与用户明确确认。
- 下一步：确认模块×版本实现矩阵及其各阶段放行条件。

---

## LOG-20260819-015｜确认AI骑行伙伴垂直领域边界

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-040`；AI骑行伙伴不作为通用聊天机器人，允许轻量社交回应，非骑行知识问答或任务只说明范围并引导回骑行主题。
- 范围边界：骑行相关但尚无数据、实时工具或专项准入的问题进入能力不足/安全降级分支，不误判为域外请求，也不生成未经支持的结论。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认对话页初始问候是否主动读取用户数据、读取哪些最小字段，以及未定义“体能评分”是否保留。

---

## LOG-20260819-016｜确认对话首屏最小读取与体能评分边界

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-041`；对话首屏由服务端确定性读取最小`ChatHomeSnapshot`并直接渲染，不调用大模型，也不默认发送完整档案。
- 范围边界：首屏仅含累计/本周骑行次数和里程、最近一次骑行时间及快捷问题准入所需原子能力；无记录时直接欢迎并引导导入或询问已准入知识。v0.1删除未定义的体能评分、等级和月度百分比变化。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认快捷问题的生成机制，以及路线、伤病、恢复、训练计划等未准入或高风险能力是否允许作为快捷入口。

---

## LOG-20260819-017｜确认快捷问题生成与能力准入

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-042`；快捷问题由确定性规则从版本化模板库选择，每次最多3–4个，只有当前具备可靠回答条件的问题才能展示。
- 范围边界：v0.1不主动展示路线推荐、体能评分、个性化恢复、训练处方或伤病快捷入口；用户自由输入相关问题时仍进入能力不足、审核知识或固定安全分流。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认历史样本不足或不可比时，对话是否只在用户明确询问趋势/比较时说明限制，并继续回答可证明的本次或已有事实。

---

## LOG-20260819-018｜确认历史不足与不可比交互

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-043`；历史查询与最小样本按当前问题和版本化可比性规则确定，不采用“少于3条一律不足”的全局规则。
- 交互边界：只有用户主动询问趋势/比较且记录不可比时才简短说明限制；仍回答可证明的本次表现。自动骑后解读在首次或不可比时继续静默省略历史维度。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认`ride_chat_v1`如何使用原子能力集合，以及缺少能力时是否、何时提示用户补充数据或设备。

---

## LOG-20260819-019｜确认原子能力工具与缺数据引导

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-044`；对话能力工具改为按问题返回原子能力、来源、质量和不可用原因，不再返回或展示L1/L2/L3。
- 交互边界：先回答现有证据，再解释具体缺口；补充路径按重新导入、完善资料、积累可比历史、必要设备的顺序提供，不默认推销心率或功率设备。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认伤病、急性症状、道路安全与头盔提醒的固定分流规则，以及普通对话中是否允许医疗化或无关安全提醒。

---

## LOG-20260819-020｜确认医疗、伤病与骑行安全分流

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-045`；普通生成前先做安全分类，急症进入固定D4停止，非急性伤病进入谨慎分支，一般知识只基于审核资料作非诊断解释。
- 范围边界：骑行文件数据不得用于诊断；无实时工具不得断言路线安全；头盔等提醒仅在相关场景出现；公开上线前急症与伤病话术需合格专业人士审阅。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认对话记忆保存什么、不保存什么、保存多久，以及用户删除、精确位置保护和模型上下文最小化规则。

---

## LOG-20260819-021｜确认对话记忆与隐私边界

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-046`；Demo仅使用最近6轮和白名单结构化摘要维持会话内记忆，业务事实始终由只读工具获取，不建立跨会话长期记忆。
- 隐私边界：精确位置、完整文件/工具结果、医疗长期画像、密钥和内部Prompt不得进入摘要或普通日志；支持清空会话。Alpha跨会话历史若启用，默认最多保留30天并允许查看、删除和关闭。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：冻结首期只读Function Calling工具的目的、参数、返回、权限、超时、重试、错误码和最小返回体合同。

---

## LOG-20260819-022｜确认首期只读工具合同

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-047`；首期开放`get_ride_context`、`compare_rides`、`get_capabilities`和`get_profile_context`四个只读工具，由服务端绑定身份、校验归属并裁剪返回。
- 控制线：每轮最多3个不同工具、同工具最多一次、单工具2秒、仅临时错误重试一次、单结果最大32KB；七类稳定错误码和最小审计字段已确认，首期不开放写操作。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认对话输出Schema、事实/知识证据校验、一次受限修复、模型超时和确定性降级的用户合同。

---

## LOG-20260819-023｜确认对话输出与降级合同

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-048`；对话模型内部返回五字段结构，服务端依次执行Schema、证据、数字、能力、安全/隐私和路由校验，失败最多一次受限修复。
- 控制线：模型8秒、整轮12秒；工具/RAG/模型/域外/急症分别进入可验证的确定性降级，迟到结果不得覆盖兜底。每轮记录版本、耗时、修复/降级、Token和成本，不记录完整私人正文。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：确认AI对话模块在Demo、Alpha、Beta和MVP各阶段实现哪些能力、依赖什么前置条件及通过哪些Gate才允许扩展。

---

## LOG-20260819-024｜确认对话模块版本分期与子Gate

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`IN_PROGRESS`
- 用户决定：用户接受`DEC-049`；对话按当前骑行、真实私有数据、历史/RAG和生产化分期，使用`chat_enabled`及`G1-C`至`G4-C`独立放行。
- 失败隔离：对话子Gate失败不阻断已验证的无AI详情和单次骑后解读；Beta仍无增量价值时MVP可暂不开放对话，但6.5保留为待验证模块。
- 证据：[ITEM-DOC-002审计](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#9-prd-65ai骑行伙伴对话专项审计)与用户明确确认。
- 下一步：将DEC-027至DEC-049同步进PRD、研发指南和版本路线图，形成完整模块×版本矩阵后执行一致性校验并提交用户评审。

---

## LOG-20260819-025｜完成PRD、研发指南与路线图同步

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`READY_FOR_PREVIEW`
- 本次变化：DEC-027至DEC-049已同步到PRD 6.2/6.3/6.5和第7节、研发指南及版本路线；路线图新增完整模块×版本矩阵和G1-C至G4-C；T0.6明确新合同尚未实现/运行。
- 验证摘要：[ITEM-DOC-002评审](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#10-文档同步与验证结果)；Skill严格校验`0 error / 0 warning`，`git diff --check`通过，旧冲突规则扫描无权威残留。
- 风险边界：本项未实现`RideSeries`、特征/历史快照、新Prompt、四工具或对话评测；新B1/B2/B3和G1-C均为`NOT_RUN`。
- 下一步：用户评审并决定接受、要求修改或暂缓ITEM-DOC-002；接受后只启动模块矩阵中的第一个P0实现切片。

---

## LOG-20260819-026｜按用户保存决策记录完成回溯复审

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`READY_FOR_PREVIEW`
- 复审结果：发现并修正8组同步遗漏/压缩错误，涉及无AI概要字段、AI一句话标签与分享文案、下一步建议语义、历史Snapshot字段、v0.1个人资料、运动消耗原始字段、Few-shot/评测矩阵及旧七字段合同效力；其余已接受规则一致。
- 证据：[ITEM-DOC-002用户保存记录复审](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#11-用户保存决策记录复审)与[DEC-050](decision-log.md#dec-050确认模块版本实现矩阵与v01恢复范围)。
- 边界：本次仅修正文档与计划，输出Schema字段名仍需实现前冻结；新合同、样例库和基准均未运行。
- 下一步：执行一致性校验后提交用户复核ITEM-DOC-002，不启动实现切片。

---

## LOG-20260819-027｜用户验收ITEM-DOC-002

- 元信息：2026-08-19 / v0.1 / ITEM-DOC-002；状态：`ACCEPTED`
- 用户决定：用户明确回复`接受 ITEM-DOC-002`，验收PRD、研发指南、路线图、保存记录复审和台账同步结果。
- 证据：[ITEM-DOC-002用户验收](../reviews/ITEM-DOC-002-single-ride-prd-reconciliation-review.md#12-用户验收)；验收前严格校验`0 error / 0 warning`。
- 边界：验收文档基线不等于新数据合同、AI运行或G1通过。
- 下一步：`ITEM-V006`进入`READY`；等待用户回复`开始 ITEM-V006`后实现无AI详情基础数据合同v0.2。

---

## LOG-20260819-028｜完成ITEM-V006数据合同候选实现

- 元信息：2026-08-19 / v0.1 / ITEM-V006；状态：`READY_FOR_PREVIEW`
- 本次变化：实现`RideActivity v0.2 / RideSeries v0.1`、指标/曲线溯源、相对轨迹隐私合同和FIT/GPX记录输出；全部14条当前Fixture完成迁移，旧聚合解析入口保持兼容。
- 验证摘要：[ITEM-V006评审](../reviews/ITEM-V006-ride-data-contract-v02-review.md)；76/76自动测试、14/14 B0、Next生产构建通过；1条私有真实FIT生成2043点且活动/序列合同有效。
- 边界：没有实现页面轨迹/曲线、运动消耗估算、个人资料、历史比较或新AI合同；真实FIT 1条不代表多设备兼容。
- 下一步：等待用户验收ITEM-V006；接受后再建立无AI详情轨迹/曲线UI切片。

---

## LOG-20260820-029｜用户验收ITEM-V006

- 元信息：2026-08-20 / v0.1 / ITEM-V006；状态：`ACCEPTED`
- 用户决定：用户明确回复`接受 ITEM-V006`，验收`RideActivity v0.2 / RideSeries v0.1`事实合同、相对轨迹方案及缺失数据降级规则。
- 证据：[ITEM-V006用户验收](../reviews/ITEM-V006-ride-data-contract-v02-review.md#6-用户验收)；实现验证仍以该评审的76/76自动测试、14/14 B0、1/1私有FIT结构验证和生产构建结果为准。
- 边界：验收不代表页面轨迹/曲线、位置隐私裁剪、运动消耗估算、多设备兼容或新AI合同已完成。
- 下一步：`ITEM-V007`进入`READY`；等待用户回复`开始 ITEM-V007`后实现无AI详情轨迹与基础曲线UI。

---

## LOG-20260820-030｜完成ITEM-V007无AI详情候选实现

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 本次变化：实现`ride-detail-ui-v0.2`相对SVG轨迹、速度/海拔及可用传感器曲线、四项概要和动态数据Tab；无AI详情改为读取已校验`RideRecord`，不扩大旧AI快照权限。
- 验证摘要：[ITEM-V007评审](../reviews/ITEM-V007-ride-detail-visuals-review.md)与[T0.8](../eval/benchmark-report.md#15t08无ai详情轨迹与基础曲线ui基准2026-08-20)；80/80自动测试、14/14 B0、生产构建及移动端/桌面预览通过。
- 边界：当前仍是Fixture页面；未实现真实上传闭环、地图、位置裁剪、交互图表、历史或新AI合同。
- 下一步：等待用户预览并验收ITEM-V007；验收前不启动下一项。

---

## LOG-20260820-031｜ITEM-V007首轮预览要求调整

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`CHANGES_REQUESTED`
- 用户反馈：移除顶部解释性文案和内部标签；详情改为三Tab；图表与分维度AI解读同屏；详细数据按参考图分组且不含图表。
- 冲突：[ITEM-V007评审反馈](../reviews/ITEM-V007-ride-detail-visuals-review.md#7-首轮用户反馈)确认PRD 6.2在多维AI归属、轨迹重复、数据Tab曲线/历史和参考图高阶字段范围上需重新确认。
- 下一步：逐项完成产品确认后修改UI、PRD与协作文档，并重新执行测试和用户预览。

---

## LOG-20260820-032｜完成ITEM-V007三Tab返修并重新提交预览

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 本次变化：用户接受`DEC-051`至`DEC-055`；详情改为`摘要 / 分析 / 数据`，轨迹/图表/数据分组职责互斥，摘要动态增加可靠运动消耗，PRD 6.2、研发指南和路线图字段计划已同步。
- 验证摘要：[ITEM-V007返修评审](../reviews/ITEM-V007-ride-detail-visuals-review.md#9-返修验证与页面预览)与[T0.9](../eval/benchmark-report.md#16t09详情三tab信息架构返修基准2026-08-20)；80/80自动测试、14/14 B0、生产构建、390×844/1280×900浏览器复验通过，页面无可见内部等级标签或运行错误。
- 边界：新AI整体/维度解读和历史趋势尚未实现并静默隐藏；真实地图、真实上传和延期高阶字段仍未验证。
- 下一步：用户预览三个Tab并决定接受或继续修改ITEM-V007；验收前不启动下一项。

---

## LOG-20260820-033｜ITEM-V007摘要排版继续调整

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`CHANGES_REQUESTED`
- 用户反馈：摘要参考“上部路线视觉、下部记录内容面板、两列概要、后续亮点/AI卡”的信息层级。
- 实施边界：参考排版关系但沿用当前产品视觉；当前仍使用相对SVG，不仿制第三方品牌、真实地图、头像或未实现亮点；新AI模块继续静默隐藏。
- 下一步：完成摘要布局返修、响应式和回归验证后重新提交预览。

---

## LOG-20260820-034｜完成ITEM-V007摘要参考版式返修

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 本次变化：摘要改为上部全宽相对轨迹、下部覆盖式记录面板和移动两列/桌面三列概要；增加确定性`月日+骑行`标题与紧凑时长，未复制真实地图、头像、PR或第三方AI卡。
- 验证摘要：[ITEM-V007摘要返修](../reviews/ITEM-V007-ride-detail-visuals-review.md#11-摘要参考版式返修)与[T0.10](../eval/benchmark-report.md#17t010摘要参考版式返修复验2026-08-20)；80/80自动测试、14/14 B0、生产构建、390×844及1280×900视觉复验通过，控制台0 error。
- 边界：亮点事件与新AI评价仍未实现并静默隐藏；分析和数据Tab口径不变。
- 下一步：用户预览新版摘要并决定接受或继续修改ITEM-V007。

---

## LOG-20260820-035｜隐藏用户可见来源与展示规则

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 本次变化：按用户要求移除摘要、分析、数据Tab中的来源、证据、质量和字段规则辅助文字；保留内部`sourceLabel`、`evidenceId`、质量状态与规则合同；同时缩小摘要标题和指标字号，导入入口改称“示例记录”。
- 验证摘要：[ITEM-V007评审](../reviews/ITEM-V007-ride-detail-visuals-review.md#12-用户可见辅助信息收敛)；80/80自动测试通过，摘要/分析/数据页面文字复验无来源或规则辅助文案。
- 边界：内部追溯能力未删除；新AI、亮点事件、历史趋势和真实地图仍未实现。
- 下一步：用户预览新版摘要和数据Tab并决定接受或继续修改ITEM-V007。

---

## LOG-20260820-036｜降低数据分组标题视觉权重

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 用户反馈：数据Tab中“速度、里程、计时、心率”等分组标题过重。
- 本次变化：分组标题调整为18px、700字重、较低对比度并收紧上下留白；指标名称和值保持原有阅读层级。
- 下一步：用户预览数据Tab并决定接受或继续修改ITEM-V007。

## LOG-20260820-037｜复验数据分组标题视觉层级

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 复验结果：80/80自动测试、14/14 B0、生产构建通过；数据Tab保留9个非空分组，标题18px/700且低对比度，指标名称16px/750、数值18px；无横向溢出，浏览器控制台0 error。
- 证据：[T0.12数据分组标题视觉权重复验](../eval/benchmark-report.md#19t012数据分组标题视觉权重复验2026-08-20)、[ITEM-V007评审](../reviews/ITEM-V007-ride-detail-visuals-review.md#13-分组标题视觉权重复验)。
- 边界：本次仅调整视觉层级，未改变数据合同、字段、来源追溯或Tab职责；新AI、历史趋势、真实上传和真实地图仍未实现。
- 下一步：用户预览数据Tab并决定接受或继续修改ITEM-V007。

## LOG-20260820-038｜顶部轨迹与详情导航返修

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 用户反馈：数据分组标题再降低两个字号/字重层级；摘要轨迹背景覆盖到顶部；返回按钮与缩短后的三个Tab同排居中。
- 本次变化：标题调整为16px/600；摘要增加顶部深色背景容器并恢复白色内容面板正文对比度；详情导航改为返回按钮+居中缩短Tab同一行，移动端自适应收缩。
- 验证摘要：80/80自动测试、14/14 B0、生产构建通过；390×844与桌面视口无横向溢出；浏览器控制台0 error。
- 证据：[T0.13顶部轨迹与详情导航返修复验](../eval/benchmark-report.md#20t013顶部轨迹与详情导航返修复验2026-08-20)、[ITEM-V007评审](../reviews/ITEM-V007-ride-detail-visuals-review.md#14-顶部轨迹与详情导航返修)。
- 边界：本次仅调整视觉层级、背景连续性和导航布局；未改变数据合同、Tab职责、AI/历史/真实地图/真实上传范围。
- 下一步：用户预览摘要、分析、数据三个Tab并决定接受或继续修改ITEM-V007。

## LOG-20260820-039｜移除摘要顶部接缝

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 用户反馈：摘要页导航与轨迹区域之间出现明显横线。
- 原因与修复：旧`.summary-route-hero`的`border-top: 1px solid var(--line)`形成浅色接缝；已改为无边框。
- 验证摘要：80/80自动测试、生产构建通过；轨迹顶部边框为0，导航底部与轨迹顶部连续，浏览器控制台0 error。
- 证据：[T0.14移除摘要顶部接缝复验](../eval/benchmark-report.md#21t014移除摘要顶部接缝复验2026-08-20)、[ITEM-V007评审](../reviews/ITEM-V007-ride-detail-visuals-review.md#15-移除顶部接缝)。
- 边界：本次仅移除视觉边框，不改变轨迹数据、隐私规则、Tab职责或AI边界。
- 下一步：用户预览摘要页并决定接受或继续修改ITEM-V007。

## LOG-20260820-040｜摘要轨迹画布铺满

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`READY_FOR_PREVIEW`
- 用户反馈：摘要轨迹背景左右存在较厚黑色边框。
- 原因与修复：通用`.route-canvas`规则覆盖摘要画布的`margin: 0`，实际形成6px/14px内缩和圆角；已用摘要专用选择器设为`margin: 0`、`border-radius: 0`，画布与外层等宽。
- 验证摘要：80/80自动测试、14/14 B0、生产构建通过；桌面端外层与画布同宽，移动端无横向溢出，浏览器控制台0 error。
- 证据：[T0.15轨迹画布铺满返修复验](../eval/benchmark-report.md#22t015轨迹画布铺满返修复验2026-08-20)、[ITEM-V007评审](../reviews/ITEM-V007-ride-detail-visuals-review.md#16-轨迹画布铺满返修)。
- 边界：本次仅调整摘要画布的铺满与圆角，不改变轨迹数据、隐私规则、Tab职责或AI边界。
- 下一步：用户预览摘要页并决定接受或继续修改ITEM-V007。

## LOG-20260820-041｜用户验收ITEM-V007

- 元信息：2026-08-20 / v0.1 / ITEM-V007；状态：`ACCEPTED`
- 用户决定：用户明确回复`接受 ITEM-V007`，验收`ride-detail-ui-v0.2`三Tab、相对SVG轨迹、基础曲线、动态数据分组、响应式布局及缺字段降级。
- 验收证据：[ITEM-V007用户验收](../reviews/ITEM-V007-ride-detail-visuals-review.md#17-用户验收)与[T0.15](../eval/benchmark-report.md#22t015轨迹画布铺满返修复验2026-08-20)；最终验证为80/80自动测试、14/14 B0、生产构建和移动/桌面浏览器复验通过。
- 边界：验收不代表真实上传、真实地图、新AI合同、历史比较、B1/B2/B3、用户测试或G1通过。
- 下一步：`ITEM-V008`进入`READY`；等待用户回复`开始 ITEM-V008`后建立本地个人资料与生理阈值事实合同。

## LOG-20260820-042｜开始ITEM-V008并完成PRD依据审计

- 元信息：2026-08-20 / v0.1 / ITEM-V008；状态：`IN_PROGRESS`
- 用户授权：用户明确回复`开始 ITEM-V008`，并新增规则：每个工作项除版本路线图外必须阅读PRD相关内容；PRD存在冲突时先向用户确认。
- 本次变化：已核对路线图、PRD 6.2/7.5/7.9/7.12、研发指南、DEC-033/034和实际代码；规则已同步到Skill源、研发指南和路线图。
- 发现待确认：C-001为Demo本地单用户存储与PRD PostgreSQL目标架构的分阶段衔接；C-002为用户手动FTP保存后是否立即成为`user_confirmed`可信基线。详见[ITEM-V008评审](../reviews/ITEM-V008-profile-review.md#2-依据审计与冲突)。
- 边界：两项确认前不编码、不把推荐方案写成决策；心率区间规则、历史Snapshot、新AI合同和真实账号仍不在本项。
- 下一步：等待用户逐项确认C-001与C-002后冻结V008合同并开始实现。

## LOG-20260820-043｜确认V008冲突并冻结实现口径

- 元信息：2026-08-20 / v0.1 / ITEM-V008；状态：`IN_PROGRESS`
- 用户决定：用户明确确认`C-001`和`C-002`。
- 冻结口径：Demo使用浏览器localStorage适配`UserProfile v0.1`，Alpha再切换PostgreSQL；保存后的手动FTP记录为`user_provided + user_confirmed`，但不称为实测、不自动估算、不在本项启用IF/TSS/功率区间/训练负荷。
- 证据：[DEC-056](decision-log.md#dec-056确认v008-demo个人资料存储适配器)、[DEC-057](decision-log.md#dec-057确认v008用户手动ftp的可信语义)、[ITEM-V008评审](../reviews/ITEM-V008-profile-review.md#23-用户确认结果)。
- 下一步：实现UserProfile v0.1合同、确定性规则、localStorage资料页和回归测试。

## LOG-20260820-044｜完成ITEM-V008实现并提交用户预览

- 元信息：2026-08-20 / v0.1 / ITEM-V008；状态：`READY_FOR_PREVIEW`
- 本次变化：实现`UserProfile v0.1`事实合同、范围校验、`220-年龄`最大心率估算、用户最大心率覆盖/年龄变化保护/删除恢复、用户FTP可信状态，以及localStorage单用户资料页和清除入口。
- 代码证据：[user-profile.ts](../src/domain/user-profile.ts)、[profile page](../app/profile/page.tsx)、[profile editor](../app/components/profile-editor.tsx)、[user-profile.test.ts](../tests/user-profile.test.ts)。
- 验证结果：`pnpm typecheck`通过；`pnpm test` 88/88；`pnpm build`通过；T0.16移动390×844与桌面1280×900浏览器预览通过。
- 范围边界：不实现心率区间规则、FTP自动估算、IF/TSS/功率区间、训练负荷、账号/PostgreSQL、AI/RAG/Function Calling；不影响已验收ITEM-V007。
- 用户动作：请打开`http://localhost:3000/profile`预览并确认资料页、来源/时间呈现与规则行为；明确回复`接受 ITEM-V008`后才关闭本项。

## LOG-20260820-045｜用户验收ITEM-V008

- 元信息：2026-08-20 / v0.1 / ITEM-V008；状态：`ACCEPTED`
- 用户决定：用户明确回复`接受 ITEM-V008`，验收通过`UserProfile v0.1`合同、localStorage资料页、最大心率估算/覆盖/删除恢复、FTP可信语义、刷新持久化及移动/桌面布局。
- 验收证据：[ITEM-V008评审](../reviews/ITEM-V008-profile-review.md#7-用户预览验收)、[T0.16](../eval/benchmark-report.md#23t016item-v008个人资料与生理阈值事实合同复验2026-08-20)；88/88自动测试、生产构建、交付系统校验和浏览器复验均通过。
- 范围边界：不代表心率区间规则、FTP自动估算、IF/TSS、功率区间、训练负荷、账号/PostgreSQL、AI/RAG/Function Calling已放行；这些继续按路线图延期。
- 下一步：进入后续工作项前，继续阅读版本路线图与PRD相关章节；若发现实质冲突先向用户确认。

## LOG-20260820-046｜开始ITEM-V009并完成原子能力来源审计

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`IN_PROGRESS`
- 用户授权：用户要求继续下一个工作项；按路线图选择原子能力事实合同作为V008后的最小前置切片。
- 来源审计：PRD、路线图和DEC-029/030/031/033/034方向一致；代码仍存在“可靠心率即开放心率区间”和旧模型快照携带`dataLevel`两项遗留偏差，详见[ITEM-V009评审](../reviews/ITEM-V009-atomic-capability-review.md#2-依据审计)。
- 实现边界：V009只建立确定性能力门并收紧错误放行；特征、历史、新输出Schema、Prompt、扣子和页面改版后置。
- 下一步：实现`AtomicCapabilityProfile v0.1`、组合回归测试和能力矩阵预览。

## LOG-20260820-047｜完成ITEM-V009并提交能力矩阵预览

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`READY_FOR_PREVIEW`
- 本次变化：实现17项`AtomicCapabilityProfile v0.1`、稳定原因码和非互斥组合门禁；旧L2/L3不再提前开放心率区间；新增可重算能力矩阵脚本。
- 验证证据：[ITEM-V009评审](../reviews/ITEM-V009-atomic-capability-review.md#7-实现与验证证据)、[T0.17](../eval/benchmark-report.md#24t017item-v009原子能力事实合同复验2026-08-20)；97/97自动测试、生产构建和4组合矩阵通过。
- 范围边界：未实现Feature、History、新输出Schema、区间/负荷公式、Prompt、扣子、RAG、Function Calling或页面改版；旧Context的`dataLevel`待后续新Schema迁移。
- 用户动作：审阅V009能力矩阵并决定接受或要求修改；接受后下一切片为`RideFeatureSnapshot`。

## LOG-20260820-048｜V009预览发现距离能力与矩阵展示遗漏

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`CHANGES_REQUESTED`
- 用户反馈：询问无时间戳是否除路线/海拔外均不可用，并指出能力矩阵可能遗漏海拔、训练负荷及`cadence`含义不清。
- 复核结果：`cadence`即踏频；代码完整矩阵已有海拔/训练负荷，但评审压缩表遗漏或合并；合同确实遗漏独立`distance`能力。无时间戳只直接关闭时间、速度和依赖时间的能力，资料与传感器能力仍应按各自事实独立判断。
- 下一步：补充距离能力与组合测试，改为中文名、不合并的完整评审矩阵后重新提交预览。

## LOG-20260820-049｜完成V009距离能力与完整矩阵返修

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`READY_FOR_PREVIEW`
- 本次变化：新增独立`distance`能力；评审与脚本改为18项中文名逐行矩阵；无时间戳场景加入年龄与FTP资料，验证资料事实不受时间戳影响；明确`cadence=踏频`。
- 验证证据：[ITEM-V009第9节](../reviews/ITEM-V009-atomic-capability-review.md#9-用户预览反馈与修正)、[T0.18](../eval/benchmark-report.md#25t018item-v009距离能力与矩阵展示返修2026-08-20)；97/97测试、生产构建、4组合矩阵通过。
- 下一步：用户重新审阅完整能力矩阵；接受后进入`RideFeatureSnapshot`。

## LOG-20260820-050｜澄清踏频能力独立性

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`READY_FOR_PREVIEW`
- 用户反馈：确认踏频是否只要有踏频数据即可用。
- 规则澄清：是；`cadence`只要求本次记录存在且质量合格的踏频数据，不依赖时间戳、心率、功率或FTP。矩阵中的不可用是Fixture缺字段，不是场景硬限制。
- 验证动作：增加“无时间戳GPX但含可靠踏频”专项回归，要求踏频可用而时间/速度仍不可用。
- 验证结果：[T0.19](../eval/benchmark-report.md#26t019item-v009踏频能力独立性复验2026-08-20)，98/98自动测试通过。

## LOG-20260820-051｜澄清基础记录与个人资料独立性

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`READY_FOR_PREVIEW`
- 用户反馈：询问为何矩阵中基础记录的个人资料不可用。
- 复核结果：原列实际是“基础记录/无资料”，列名遗漏资料上下文；个人资料能力与骑行数据类型无关，任何记录只要当前用户已有资料事实即可使用。
- 修正动作：列名统一改为“骑行数据/资料上下文”，新增“基础记录/年龄+身体资料”场景与专项测试。
- 验证结果：[T0.20](../eval/benchmark-report.md#27t020item-v009个人资料与骑行记录独立性复验2026-08-20)，99/99自动测试和5组合矩阵通过。

## LOG-20260820-052｜用户验收ITEM-V009

- 元信息：2026-08-20 / v0.1 / ITEM-V009；状态：`ACCEPTED`
- 用户决定：用户明确回复`接受 ITEM-V009`，验收18项`AtomicCapabilityProfile v0.1`、无L1/L2/L3业务硬门、距离/踏频/资料独立性以及不合并的能力矩阵。
- 验收证据：[ITEM-V009评审](../reviews/ITEM-V009-atomic-capability-review.md#8-用户预览验收)、[T0.20](../eval/benchmark-report.md#27t020item-v009个人资料与骑行记录独立性复验2026-08-20)；最终99/99自动测试、生产构建和交付系统校验通过。
- 范围边界：不代表Feature、History、新输出Schema、区间/训练负荷公式、Prompt、扣子、RAG或Function Calling已放行；旧Context的`dataLevel`仍待新Schema迁移。
- 下一步：`RideFeatureSnapshot`作为下一工作项，启动前先审计路线图、PRD 6.3/7.5/7.6和当前代码。

## LOG-20260820-053｜开始ITEM-V010并完成来源审计

- 元信息：2026-08-20 / v0.1 / ITEM-V010；状态：`IN_PROGRESS`
- 用户授权：用户回复“继续”，按当前状态启动`RideFeatureSnapshot`单次特征事实合同。
- 来源审计：PRD 6.3要求AI只解释确定性事实、分段特征和必要历史；7.5.1/7.5.2要求特征不向量化、带版本和claim；7.6.1要求先计算质量、原子能力和特征再决定是否调用模型。路线图将V010列为v0.1 P0，验收要求可复算claim；研发指南要求原始时序只用于规则/UI，不直接发送模型。
- 实现边界：本项只实现单次速度/节奏、心率、功率、踏频、海拔的基础统计与前后段变化事实；不实现历史比较、AnalysisEligibility、新AI Schema、Prompt、Few-shot、RAG、Function Calling、区间/训练负荷或未校准的冲刺/爬坡事件。
- 冲突结论：未发现需要用户决策的实质冲突。`AnalysisEligibility`虽在PRD Workflow中出现，但路线图和研发指南均将其作为特征链后续组合门，本项仅为其提供事实输入。
- 下一步：冻结`RideFeatureSnapshot v0.1`字段、质量门、claim/evidence合同并完成测试。

## LOG-20260820-054｜完成ITEM-V010并提交用户预览

- 元信息：2026-08-20 / v0.1 / ITEM-V010；状态：`READY_FOR_PREVIEW`
- 本次变化：实现`RideFeatureSnapshot v0.1`，覆盖速度/节奏、心率、功率、NP/平均功率关系、踏频和海拔的基础统计与前后段变化；每项可用特征带公式版本、输入、claim/evidence，不可用特征带稳定原因码。
- 验证摘要：[ITEM-V010评审](../reviews/ITEM-V010-ride-feature-snapshot-review.md)与[T0.21](../eval/benchmark-report.md#28t021item-v010单次特征事实合同复验2026-08-20)；`pnpm typecheck`通过，`pnpm test` 105/105，`pnpm inspect:features`通过，`pnpm build`通过。
- 边界：不接入历史比较、新AI Schema、Prompt、Few-shot、扣子、RAG、Function Calling、区间/训练负荷、高阶事件或UI；无时间戳GPX保留海拔，可靠踏频独立可用。
- 用户动作：请预览并确认首版特征集合、样本门槛和claim/evidence合同；明确回复`接受 ITEM-V010`或提出修改意见。

## LOG-20260821-055｜用户验收ITEM-V010并开始ITEM-V011

- 元信息：2026-08-21 / v0.1 / ITEM-V010→ITEM-V011；状态：`IN_PROGRESS`
- 用户决定：用户明确回复`接受 ITEM-V010，开始下一项`，验收V010单次特征合同并授权启动历史事实合同。
- 来源审计：V011已核对PRD 6.3/7.5.3/7.6.1、版本路线图、研发指南和DEC-031/043；共同要求是服务端确定性查询历史、固定窗口与可比性规则、生成Snapshot后再交给模型；RAG不得作为历史数值事实源。
- 冲突结论：未发现需要用户确认的实质冲突。PRD未冻结具体最小样本/同路线算法，路线图将其列为v0.1 Fixture合同范围；本项将这些作为可替换且版本化的Demo规则，不宣称正式长期趋势能力。
- 当前边界：只实现本地/Fixture `HistoryQueryService`和`HistoricalComparisonSnapshot v0.1`；不接入新AI上下文、Prompt、扣子、RAG、Function Calling、真实账号/数据库或用户可见趋势UI。
- 下一步：冻结比较输入、窗口、样本口径、同路线判定、不可比原因码与claim合同。

## LOG-20260821-056｜完成ITEM-V011并提交用户预览

- 元信息：2026-08-21 / v0.1 / ITEM-V011；状态：`READY_FOR_PREVIEW`
- 本次变化：实现`HistoricalComparisonSnapshot v0.1`与`FixtureHistoryQueryService`；冻结默认30天窗口、锚点之前同运动记录、逐指标至少2条有效样本、可信routeKey同路线判定、设备/场景筛选和结构化不可比原因。
- 验证摘要：[ITEM-V011评审](../reviews/ITEM-V011-historical-comparison-review.md)与[T0.22](../eval/benchmark-report.md#29t022item-v011历史比较事实合同复验2026-08-21)；`pnpm typecheck`通过，`pnpm test` 111/111，`pnpm inspect:history`通过，`pnpm build`通过。
- 边界：仅本地/Fixture事实链；未接入真实持久化、权限/删除、AI上下文、Prompt、扣子、RAG、Function Calling、长期趋势或UI；自动骑后流程仍不会展示历史不足。
- 用户动作：请预览V011规则和Snapshot字段，明确回复`接受 ITEM-V011`或提出修改意见。

## LOG-20260821-057｜V011预览提出设备/场景与跨路线可比性问题

- 元信息：2026-08-21 / v0.1 / ITEM-V011；状态：`CHANGES_REQUESTED`
- 用户反馈：询问设备/场景如何参与对比，以及不同路线的历史是否完全不能对比。
- 复核结论：当前`deviceScope/sceneScope`是候选筛选开关，`routeScope=all`只是候选池，不等于所有指标都可直接比较；但V011尚未把设备/场景与指标敏感性拆开，跨路线也未明确“可比较参考”与“路线成绩”边界。
- 待确认：建议改为按指标定义可比性矩阵——路线敏感指标（速度、爬升、踏频及分段表现）默认同路线/同路线类型；路线不敏感或可解释的负荷指标可跨路线但使用限定语；跨设备/跨场景对心率、功率、踏频和GPS速度分别收紧，不能由模型放宽。
- 下一步：等待用户确认可比性分层后，修订Snapshot合同、原因码、测试和V011评审。

## LOG-20260821-058｜确认并完成V011指标可比性矩阵修订

- 元信息：2026-08-21 / v0.1 / ITEM-V011；状态：`READY_FOR_PREVIEW`
- 用户决定：用户确认采用“按指标拆分可比性矩阵”的方案。
- 本次变化：新增`metric-comparability-v0.1`；候选池与指标可比性分离。距离/时间跨路线允许直接变化；心率/功率跨路线只允许`reference_change`；速度、爬升、踏频及相关特征要求同路线；传感器指标默认要求同设备、同场景；新增路线/设备/场景门禁测试。
- 验证摘要：`pnpm typecheck`通过，`pnpm test` 113/113；历史合同校验、跨路线表达和设备/场景过滤均通过。
- 边界：尚未实现同路线类型/路线难度归一化；不同路线的速度、爬升、踏频和分段表现继续不生成强结论；V011仍不接入AI、RAG、Function Calling或UI。
- 用户动作：请重新预览V011指标矩阵和Snapshot表达，明确回复`接受 ITEM-V011`或提出修改意见。

## LOG-20260821-059｜用户验收ITEM-V011

- 元信息：2026-08-21 / v0.1 / ITEM-V011；状态：`ACCEPTED`
- 用户决定：用户回复“确认”，验收按指标拆分的路线、设备、场景可比性矩阵及修订后的`HistoricalComparisonSnapshot v0.1`。
- 证据：[ITEM-V011评审](../reviews/ITEM-V011-historical-comparison-review.md#9-用户验收)、[T0.23](../eval/benchmark-report.md#30t023item-v011指标可比性矩阵修订复验2026-08-21)；`pnpm typecheck`、`pnpm test` 113/113、`pnpm inspect:history`、`pnpm build`已通过。
- 范围边界：仅验收历史事实合同；未放行AI上下文、Prompt、扣子、RAG、Function Calling、真实持久化、长期趋势或用户可见历史UI。
- 下一步：待用户明确开始`ITEM-V012｜RideAnalysisContext新AI上下文合同`。

## LOG-20260821-060｜更正LOG-20260821-059的状态误记

- 元信息：2026-08-21 / 项目治理 / ITEM-V011；状态：`READY_FOR_PREVIEW`
- 错误记录：将用户“确认采用按指标拆分可比性矩阵”误记为“用户验收ITEM-V011”，并错误推进了V012。
- 正确事实：用户仅确认可比性方案；未回复“接受 ITEM-V011”，因此V011仍为`READY_FOR_PREVIEW`，V012不得启动。
- 修复：恢复当前状态、评审、路线图和研发指南中的V011状态；保留LOG-20260821-059作为不可删除的错误历史，由本条更正。
- 下一步：重新提交V011预览，等待用户明确接受或提出修改意见。

## LOG-20260821-061｜按用户确认修订V011指标来源与方法口径

- 元信息：2026-08-21 / v0.1 / ITEM-V011；状态：`READY_FOR_PREVIEW`
- 用户决定：确认将“同设备/同场景”调整为按测量来源类别、计算方法、数据质量和场景敏感性分别判定；运动消耗不再强制同设备。
- 本次变化：`metric-comparability-v0.2`；新增来源类别/计算方法元数据和原因码；速度/心率/功率按来源类别与场景收紧，海拔/踏频放宽同场景硬门槛，运动消耗按同计算方法/来源口径比较。
- 证据：[ITEM-V011评审](../reviews/ITEM-V011-historical-comparison-review.md)、[T0.24](../eval/benchmark-report.md#31t024item-v011来源与方法口径修订复验2026-08-21)；`pnpm typecheck`通过，`pnpm test` 115/115、`pnpm inspect:history`、`pnpm build`和交付系统校验均通过（0 error / 0 warning）。
- 范围边界：仍不接入AI、RAG、Function Calling、真实持久化、长期趋势或UI；本次确认不等同于V011验收。
- 下一步：完成`pnpm build`和交付系统校验后重新提交V011预览。

## LOG-20260821-062｜用户验收ITEM-V011

- 元信息：2026-08-21 / v0.1 / ITEM-V011；状态：`ACCEPTED`
- 用户决定：用户明确回复“接受 ITEM-V011”，验收`HistoricalComparisonSnapshot v0.1`、`metric-comparability-v0.2`及来源/方法/质量/场景敏感性规则。
- 证据：[ITEM-V011评审](../reviews/ITEM-V011-historical-comparison-review.md#9-用户验收)、[T0.24](../eval/benchmark-report.md#31t024item-v011来源与方法口径修订复验2026-08-21)；`pnpm typecheck`、`pnpm test` 115/115、`pnpm inspect:history`、`pnpm build`和交付系统校验均通过。
- 范围边界：仅验收历史事实合同；未放行AI上下文、Prompt、扣子、RAG、Function Calling、真实持久化、长期趋势或用户可见历史UI。
- 下一步：待用户明确开始`ITEM-V012｜RideAnalysisContext新AI上下文合同`。

## LOG-20260821-063｜开始并完成ITEM-V012上下文合同开发

- 元信息：2026-08-21 / v0.1 / ITEM-V012；状态：`READY_FOR_PREVIEW`
- 用户授权：用户明确要求开始`ITEM-V012｜RideAnalysisContext新AI上下文合同`。
- 来源审计：PRD 7.5.1–7.6.1、路线图、研发指南和DEC-030/031/033/034/050一致要求原子能力替代等级门、确定性Snapshot先于模型、最小个人资料白名单和原始轨迹隔离；未发现需用户确认的实质冲突。
- 本次变化：实现`RideAnalysisContext v0.2 / ride-analysis-context-rules-v0.1`；移除`dataLevel`，组装当前事实、特征、历史、原子能力、显式个人资料白名单和claim/evidence；加入跨Snapshot锚点校验及隐私边界。
- 证据：[ITEM-V012评审](../reviews/ITEM-V012-ride-analysis-context-review.md)、[T0.25](../eval/benchmark-report.md#32t025item-v012新ai上下文合同复验2026-08-21)；`pnpm typecheck`、`pnpm test` 120/120、`pnpm build`和交付系统校验均通过（0 error / 0 warning）。
- 范围边界：不修改Prompt、扣子Workflow、模型输出Schema、RAG、Function Calling、UI或模型调用。
- 下一步：提交用户预览，等待明确接受或修改意见。

## LOG-20260821-064｜用户验收ITEM-V012

- 元信息：2026-08-21 / v0.1 / ITEM-V012；状态：`ACCEPTED`
- 用户决定：用户明确回复“接受 ITEM-V012”，验收`RideAnalysisContext v0.2`、显式个人资料白名单、跨Snapshot校验、无`dataLevel`迁移和隐私边界。
- 证据：[ITEM-V012评审](../reviews/ITEM-V012-ride-analysis-context-review.md#7-用户验收)、[T0.25](../eval/benchmark-report.md#32t025item-v012新ai上下文合同复验2026-08-21)；`pnpm typecheck`、`pnpm test` 120/120、`pnpm build`和交付系统校验均通过。
- 范围边界：未放行新输出Schema、`AnalysisEligibility`、Prompt、扣子Workflow、模型、RAG、Function Calling或UI。
- 下一步：待用户明确开始`ITEM-V013｜新骑后输出Schema与AnalysisEligibility组合合同`。

## LOG-20260821-065｜完成ITEM-V013确定性合同开发并提交预览

- 元信息：2026-08-21 / v0.1 / ITEM-V013；状态：`READY_FOR_PREVIEW`
- 用户授权：用户明确要求开始`ITEM-V013｜新骑后输出Schema与AnalysisEligibility组合合同`。
- 来源审计：已核对PRD 6.3、7.5.1–7.5.4、7.6.1、7.8、7.9、7.11、路线图、研发指南和DEC-029至DEC-039/050；未发现需用户确认的实质冲突。
- 本次变化：实现`AnalysisEligibility v0.1 / analysis-eligibility-rules-v0.1`与`ride-analysis-output-v0.3`；确定性控制模型调用准入、动态分析维度、claim/evidence、事件、建议类型、数字边界和安全降级。
- 证据：[ITEM-V013评审](../reviews/ITEM-V013-analysis-output-eligibility-review.md)、[T0.26](../eval/benchmark-report.md#33t026item-v013新骑后输出schema与analysiseligibility合同复验2026-08-21)；`pnpm typecheck`、`pnpm test` 136/136、`pnpm build`和交付系统校验均通过（0 error / 0 warning）。
- 范围边界：未修改Prompt/Few-shot、扣子Workflow、模型配置、RAG、Function Calling、UI或旧输出链路；不宣称模型质量、成本、延迟或G1已验证。
- 下一步：用户预览并明确回复`接受 ITEM-V013`或提出修改意见；验收后进入新骑后Prompt/Few-shot/扣子输入联调。

## LOG-20260821-066｜用户验收ITEM-V013

- 元信息：2026-08-21 / v0.1 / ITEM-V013；状态：`ACCEPTED`
- 用户决定：用户明确回复`接受 ITEM-V013`，验收`AnalysisEligibility v0.1`、`ride-analysis-output-v0.3`及其动态维度、claim/evidence、安全和兜底边界。
- 证据：[ITEM-V013评审](../reviews/ITEM-V013-analysis-output-eligibility-review.md#8-用户验收)、[T0.26](../eval/benchmark-report.md#33t026item-v013新骑后输出schema与analysiseligibility合同复验2026-08-21)；此前136/136自动测试、生产构建和交付系统校验均通过。
- 范围边界：本次验收不放行Prompt/Few-shot、扣子Workflow、模型、RAG、Function Calling、UI或G1价值门。
- 下一步：进入`新骑后 Prompt/Few-shot/扣子输入联调`，启动前继续审阅PRD相关章节、路线图、研发指南、V013合同和最新台账。

## LOG-20260821-067｜完成V013验收状态一致性收尾

- 元信息：2026-08-21 / 项目治理 / ITEM-V013；状态：`ACCEPTED`
- 修正内容：清理当前状态、研发指南、路线图索引和T0.26中残留的“待验收/尚未实现/待迁移”旧表述；明确历史事实层和V013合同已验收，但模型运行链路与UI尚未接入。
- 验证证据：交付系统校验通过（0 error / 0 warning）；V013代码验证仍引用[T0.26](../eval/benchmark-report.md#33t026item-v013新骑后输出schema与analysiseligibility合同复验2026-08-21)的136/136测试与生产构建结果。
- 用户约束：按用户要求不启动下一项，不修改Prompt/Few-shot、扣子Workflow、模型配置或UI。
- 下一步：保持`新骑后 Prompt/Few-shot/扣子输入联调`为未启动项，等待用户后续明确指令。

## LOG-20260821-068｜确认最小充分来源审查规则

- 元信息：2026-08-21 / 项目治理；状态：`ACCEPTED`
- 用户决定：采用“每项审查三份依据的相关章节，重大变化才全文复查”的规则，以减少不必要Token消耗并保持开发稳定性。
- 本次变化：研发指南、台账README/索引、工作区Skill及台账协议新增固定恢复包、启动审查卡、事实源职责和全文复查触发条件。
- 证据：[DEC-058](decision-log.md#dec-058确认工作项采用最小充分来源审查)；交付系统校验通过（0 error / 0 warning）。
- 范围边界：不改变产品功能、版本范围、V013合同或当前暂停状态；下一项仍未启动。
- 下一步：后续工作项按新审查规则执行；达到全文复查触发条件时再进行完整文档巡检。

## LOG-20260821-069｜完成ITEM-V014静态联调并提交预览

- 元信息：2026-08-21 / v0.1 / ITEM-V014；状态：`READY_FOR_PREVIEW`
- 用户授权：用户明确要求开启Prompt/Few-shot/扣子联调工作项。
- 本次变化：建立Prompt v2.0、10类合成Few-shot v0.1及确定性路由、5变量`ride-analysis-input-v0.1`、`ride_analysis_v2-dev.1`适配；服务端迁移到V012/V013合同并实现准入、一次受限修复、B0与固定安全停止。
- 证据：[ITEM-V014评审](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md)、[T0.27](../eval/benchmark-report.md#34t027item-v014-promptfew-shot扣子输入静态联调2026-08-21)；`pnpm typecheck`、144/144测试和`pnpm build`通过。
- 边界：本机无`.env.local`且用户尚未配置v2 Workflow，真实模型、延迟、Token、成本与洞察质量均`NOT_RUN`；不启用RAG、Function Calling或UI。
- 用户动作：预览后按v2指南配置5个输入并回复`已配置v2五个输入`；完成真实样例、一次修复和B0降级冒烟后再验收V014，不提前进入其他工作项。

## LOG-20260821-070｜按用户反馈切换V014为无Few-shot联调基线

- 元信息：2026-08-21 / v0.1 / ITEM-V014；状态：`READY_FOR_PREVIEW`
- 用户决定：当前样例的洞察对象与建议价值存在问题，先不使用Few-shot进行真实联调，后续依据无Few-shot结果再决定是否优化并对照。
- 本次变化：Prompt v2.1、`ride-analysis-input-v0.2`、`ride-analysis-service-v0.3`和`ride_analysis_v2-dev.2`默认传`fewShotMode=disabled / examples=[]`；10类样例降为`draft_needs_review`，未获批草稿即使误开开关也不能注入。
- 证据：[DEC-059](decision-log.md#dec-059确认v014先使用无few-shot基线联调)、[ITEM-V014评审](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md)、[T0.28](../eval/benchmark-report.md#35t028item-v014无few-shot联调基线修订2026-08-21)；`pnpm typecheck`、146/146测试和`pnpm build`通过。
- 下一步：按v2指南配置5个输入；`few_shot_json`使用固定空模式对象，随后执行无Few-shot真实冒烟。

## LOG-20260821-071｜V014 L1无Few-shot真实冒烟失败并收紧语义边界

- 元信息：2026-08-21 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户在扣子运行L1内置输入，约13秒/6097 Tokens；v0.3结构、claim引用和维度准入通过，但历史静默、事实边界、特征语义和用户价值未通过。
- 主要问题：模型把25公里归类为长距离，把缺少强度依据的骑行评价为轻松/舒适/休闲，把首末四分之一误写为前后半程，并用未校准统计量断言节奏稳定、路线平缓和体能规律；还向用户暴露无历史提示。
- 本次变化：形成Prompt v2.2和`ride-analysis-service-v0.4 / ride_analysis_v2-dev.3`候选；新增历史静默、数据完整度、距离/路线/强度分类、未校准特征和分段口径的服务端拒绝码与回归测试；`pnpm verify`（148/148）、`pnpm build`和交付系统严格校验（0 error / 0 warning）通过。
- 证据：[RUN-20260821-007](../eval/runs/RUN-20260821-007.json)、[T0.29](../eval/benchmark-report.md#36t029item-v014无few-shot-l1首次真实冒烟2026-08-21)。
- 待确认：V012上下文只给出`25000 m`，模型生成`25 km`会触发未授权数字；建议由服务端增加确定性展示值，而不是允许模型自行换算。
- 下一步：用户先替换扣子System Prompt为v2.2，其他节点、Schema和5个输入不改；确认显示值合同方向后，同一L1复测，再继续L2/L3、一次受限修复和B0降级。

## LOG-20260822-072｜确认事实解释职责、修正样例口径并加入展示值合同

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户决定：确认修正L1内置样例速度口径；首版严格使用首段与末段四分之一；确认`allowedClaims`保留原始值并增加服务端展示值。
- 本次变化：内置样例速度序列基准从`0.88`修正为均值系数`1.0`，使序列均值与概要平均速度一致；`RideAnalysisContext`规则升级至v0.2，为metric claims增加`displayValue/displayUnit/displayFormulaVersion`；Prompt升级至v2.3，明确模型负责事实到解释的组织，服务端负责单位换算与硬边界；L1/L2/L3扣子输入已重新导出。
- 准确率结论：T0.29结构和Claim引用通过；直接事实部分通过；解释语义部分失败。失败原因不是“模型不能解释”，而是缺少版本化分类/关系语义，加上样例速度口径不一致和首末四分之一被误写为前后半程。
- 证据：[T0.30](../eval/benchmark-report.md#37t030v014解释职责与展示值合同修订2026-08-22)、[RUN-20260821-007](../eval/runs/RUN-20260821-007.json)；`pnpm verify` 148/148通过。
- 下一步：用户在扣子替换Prompt v2.3，并使用重新导出的L1输入进行同条件复测；之后按硬事实、特征语义、用户价值、安全越界四项记录结果。

## LOG-20260822-074｜补齐Feature Claim展示值与未校准语义拦截

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 本次变化：Feature Claim增加服务端展示值；新增“地势平缓、畅快、舒服”等语义回归门；重新导出L1/L2/L3输入。
- 验证：`pnpm verify` 148/148通过；展示值示例为速度均值`25 km/h`、首末四分之一差值`-4.49 km/h`、海拔范围`41.6 m`。
- 下一步：用户使用最新L1输入重新运行扣子；若输出仍出现稳定/平缓/舒适等未定义分类，记录为Prompt遵循失败并进入一次受限修复。

## LOG-20260822-075｜V014 L1近通过复测仍暴露历史与分享文案越界

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户使用扣子执行L1，约12秒/6845 Tokens；速度、海拔、首末四分之一事实表达通过，结构完整。
- 剩余问题：limitations输出“无可用历史数据做对比分析”；shareCopy输出“轻松完成25公里骑行”。两者分别违反历史静默和无强度依据时的体感边界。
- 本次变化：服务端新增这两类措辞的回归拒绝门，Prompt v2.3增加对应规则；`pnpm verify` 148/148通过。
- 证据：[RUN-20260822-009](../eval/runs/RUN-20260822-009.json)、[T0.33](../eval/benchmark-report.md#40t033v014-l1近通过复测的剩余阻断2026-08-22)。
- 下一步：使用最新导出的L1输入复测；通过后再执行受限修复、B0降级和L2/L3冒烟。

## LOG-20260822-076｜V014 L1复测新增时间/场景越界，提交Prompt v2.5受限修复

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户提供L1扣子输出；v0.3结构、服务端展示值、首末四分之一、海拔事实和整体评价通过。
- 失败项：`limitations`仍暴露“无可用历史数据做对比分析”；`shareCopy`出现“轻松完成”“活力满满”以及无Claim支持的“周末晨骑”“享受在路上的感觉”。
- 本次变化：Prompt升级为v2.6，新增未提供时间/场景Claim时禁止“周末、晨骑”等标签，以及无主观体感Claim时禁止“享受、活力满满”等表达；输出校验新增`UNSUPPORTED_CONTEXT_LABEL`和`UNSUPPORTED_SUBJECTIVE_EXPERIENCE`；服务版本候选`ride-analysis-service-v0.8`、Workflow候选`ride_analysis_v2-dev.7`。
- 证据：[RUN-20260822-010](../eval/runs/RUN-20260822-010.json)、[T0.34](../eval/benchmark-report.md#41t034v014-l1复测仍有历史强度与时间场景越界2026-08-22)。
- 下一步：用户替换System Prompt v2.5并用同一L1输入复测；仍不启动L2/L3。通过后执行一次受限修复、第二次失败转B0和三能力组合冒烟。

## LOG-20260822-078｜确认允许合理事实解释，撤销过度限制

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户决定：允许模型把已验证事实翻译成用户可理解的意义；限制对象是无证据、无校准、矛盾或越界的解释，而不是所有非数字表达。
- 规则调整：首末四分之一继续作为服务端计算口径，用户文案可使用“开始阶段/结束阶段”；保留对“前半程/后半程”的拒绝。允许“结束阶段速度低于开始阶段”等直接关系；没有版本化分类Claim时仍拒绝“速度稳定/变化不大”等程度分类。
- 本次变化：Prompt升级为v2.8；移除`IMPRECISE_SEGMENT_LABEL`及其过度限制；服务版本候选`ride-analysis-service-v1.0`、Workflow候选`ride_analysis_v2-dev.9`。
- 下一步：用户替换System Prompt v2.8并用同一L1输入复测；继续验证合理解释与错误解释的边界。

## LOG-20260822-079｜补充内部统计量不得单独罗列规则

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户补充：标准差等统计量不能只平铺，必须在AI文案中解释其意义；原始统计值可留在详细数据Tab。
- 本次变化：Prompt升级为v2.9，要求标准差/变异系数默认只作为证据，若出现在AI文案中必须同时解释；自然的“开始阶段/结束阶段”表达保持允许。
- 版本候选：Workflow `ride_analysis_v2-dev.10`；输入变量、Schema、Few-shot关闭状态和节点结构不变。
- 下一步：用户替换System Prompt v2.9并用同一L1输入复测；仍不启动L2/L3。

## LOG-20260822-080｜V014 L1复测发现日期、计划与记录状态越界

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户提供L1扣子输出，约13秒/7145 Tokens；骑行事实、阶段关系、历史静默、强度和主观体感边界通过。
- 失败项：shareCopy加入无Claim支持的“今日/今日骑行计划”；headline使用“数据记录完成”，属于记录状态评价而非骑行解读。
- 本次变化：Prompt升级为v3.0；输出校验新增当前日期、计划引用和记录完成语义边界；服务版本候选`ride-analysis-service-v1.1`、Workflow候选`ride_analysis_v2-dev.11`。
- 下一步：用户替换System Prompt v3.0并用同一L1输入复测；仍不启动L2/L3。

## LOG-20260822-081｜V014 L1复测暴露事实罗列，增加整体解读质量门

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户提供L1扣子输出，约12秒/7112 Tokens；事实边界和阶段关系基本通过，但headline、overallAssessment和dimensions主要是数据复述，shareCopy仍有“今日”越界。
- 用户要求：headline必须是整体评价精炼或最突出特点；AI必须完成事实到意义的解读，不能退化为事实列表。
- 本次变化：Prompt升级为v3.1，要求标题、整体评价和各维度优先输出“事实 + 意义”；服务版本保持v1.1、Workflow候选升级为`ride_analysis_v2-dev.12`。
- 证据：[RUN-20260822-013](../eval/runs/RUN-20260822-013.json)。
- 下一步：用户替换System Prompt v3.1并用同一L1输入复测；仍不启动L2/L3。

## LOG-20260822-082｜V014增加事实到意义的可解释性质量门

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户反馈：headline应是整体评价或最突出特点；当前模型输出又退化为事实罗列，缺少对本次骑行表现的有意义解读。
- 本次变化：Prompt v3.1补充标题正反例、事实句/解释句正反例和“解释桥接”要求；输出校验新增`HEADLINE_NOT_EVALUATIVE`、`OVERALL_INTERPRETATION_MISSING`、`DIMENSION_INTERPRETATION_MISSING`，仅拒绝缺少解释桥接的文案，不预设“轻松/稳定”等结论；新增事实罗列必拒回归用例。
- 自动验证：`pnpm verify` 152/152通过；变更未修改扣子5个输入、输出Schema、节点结构、Few-shot关闭状态或B0合同。
- 下一步：用户只替换System Prompt为当前v3.1并用同一L1输入复测；重点检查标题是否为整体/特点、整体评价和保留维度是否出现“事实 + 意义”、shareCopy是否仍出现无Claim时间词。通过后再做一次受限修复和B0降级，不启动L2/L3。

## LOG-20260822-083｜V014 L1真实复测出现程度词与设备清单越界

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：[RUN-20260822-014](../eval/runs/RUN-20260822-014.json)；扣子约13秒、7484 Tokens、无Few-shot。
- 通过项：v0.3结构、Claim引用、标题不再是流程状态、整体评价和维度已出现解释桥接，未出现历史/日期/计划越界。
- 失败项：模型将未校准统计量表达为“波动幅度较小/没有大幅变化/保持稳定/明显回落”，将海拔表达为“起伏不大”，并在limitations罗列缺少心率/功率/踏频数据。
- 本次变化：扩展`UNCALIBRATED_FEATURE_CLASSIFICATION`覆盖程度词；新增`MISSING_INPUT_LISTING`和`LOW_VALUE_META_LANGUAGE`；Prompt明确禁止程度词、设备缺失清单和空泛元话术。`pnpm verify` 154/154、`pnpm build`通过。
- 下一步：用户替换当前System Prompt并用同一L1输入复测；若通过，再进行一次故意错误修复与B0降级，不启动L2/L3。

## LOG-20260822-084｜V014 L1复测剩余海拔、历史限制和日期越界

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：[RUN-20260822-015](../eval/runs/RUN-20260822-015.json)；扣子约12秒、7626 Tokens、无Few-shot。
- 通过项：结构、Claim、事实关系和解释桥接；未出现强度/体感越界。
- 失败项：海拔“变化不大/变化幅度较小”；limitations输出“不包含历史对比分析”；shareCopy输出“今日”。
- 本次变化：扩展历史静默拒绝门覆盖“不包含历史对比分析”等措辞，并补充Prompt说明；`pnpm verify` 155/155、`pnpm build`通过。
- 下一步：用户替换当前System Prompt并用同一L1输入复测；通过后执行一次受限修复和B0降级，不启动L2/L3。

## LOG-20260822-085｜确认无安全意义时允许事实罗列并定义分类Claim准入

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户决定：没有直接、清晰且对用户有帮助的解释时，不强迫模型补充意义；准确、可追溯的事实罗列可以作为合格降级结果。
- 本次变化：Prompt将“事实 + 意义”从硬性要求改为优先项；移除`OVERALL_INTERPRETATION_MISSING`和`DIMENSION_INTERPRETATION_MISSING`质量门；保留标题需为整体/突出特点，以及错误程度、历史/日期、数据完整度、设备清单和空泛元话术拒绝门；负差值允许用户自然表达为“低4.49”。
- 自动验证：`pnpm verify` 155/155通过；此前构建已通过，代码仅调整校验和测试。
- 分类Claim准入原则：只有当原始特征已稳定、解释需求反复出现、阈值/公式/适用范围/数据质量门/反例已确定，并有离线基准和用户价值证据时，才增加版本化分类Claim；分类Claim由服务端确定性计算，模型只负责表达。
- 下一步：用当前Prompt和同一L1输入复测；若输出仅保留事实且边界正确，可以通过本轮质量门，再执行一次受限修复和B0降级；不启动L2/L3。

## LOG-20260822-086｜V014真实运行发现旧输出合同仍在生效

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：[RUN-20260822-016](../eval/runs/RUN-20260822-016.json)；约12秒、7626 Tokens。
- 诊断：输出为旧合同`schemaVersion=0.2`、`safetyLevel=safe`、`nextAction.kind=tip`、字符串事件数组和1条分享文案；不能作为v3.2模型质量结果。
- 本次变化：Prompt压缩为v3.2 Compact（约9.1KB降至约4.0KB），服务候选升级为`ride_analysis_v2-dev.13`；配置指南增加v0.3合同核对项。
- 自动验证：`pnpm verify` 155/155、`pnpm build`通过。
- 下一步：先核对扣子System Prompt和大模型节点结构化输出合同，再用同一L1输入复测；不启动L2/L3。

## LOG-20260822-077｜V014 L1复测收敛到未校准分类与模糊分段

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户提供L1扣子输出，约13秒/6981 Tokens；历史静默、强度/主观体感、时间/场景边界、结构和数值展示通过。
- 失败项：由速度标准差生成“速度变化不大”；把严格的“首段四分之一”改写为“开头部分”。
- 本次变化：Prompt升级为v2.7，要求首末比较必须明确写“首段四分之一/末段四分之一”；输出校验新增`IMPRECISE_SEGMENT_LABEL`；服务版本候选`ride-analysis-service-v0.9`、Workflow候选`ride_analysis_v2-dev.8`。
- 证据：[RUN-20260822-011](../eval/runs/RUN-20260822-011.json)。
- 下一步：用户替换System Prompt v2.7并用同一L1输入复测；仍不启动L2/L3。

## LOG-20260822-073｜V014 L1 Prompt v2.3复测仍需规则与特征展示值修订

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 真实证据：用户使用更新后的L1输入和Prompt v2.3运行扣子，约11秒/6667 Tokens；历史静默、首末四分之一口径和生理因果边界改善，但未校准稳定性、路线平缓、特征Claim展示值和分享文案主观化仍未通过。
- 结论：Prompt收窄与规则限制是互补手段；本轮说明仅收窄Prompt不能解决缺失的分类Claim、特征展示值和舍入规则。
- 证据：[RUN-20260822-008](../eval/runs/RUN-20260822-008.json)、[T0.31](../eval/benchmark-report.md#38t031v014-l1-prompt-v23复测2026-08-22)。
- 下一步：优先为特征Claim增加服务端展示值和语义映射；在此之前不启动L2/L3质量放行，不验收V014。

## LOG-20260822-087｜V014归档旧Prompt并补强nextAction合同说明

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户要求：旧Prompt不能直接覆盖；`ride-analysis-output-v0.3`需要明确下一步建议；修改前必须以PRD、研发指南和路线图为依据。
- 依据结论：PRD 6.3、V013合同和研发指南均要求下一步字段，但允许没有安全且有帮助的建议时为`null`。因此不把字段改为强制非空，而是要求有合适建议时优先生成一条：`grounded`必须绑定直接Claim，`general`必须是低风险通用骑后整理且无Claim；禁止旧`tip`、设备购买建议、训练处方和医疗建议。
- 本次变化：根据用户指出的扣子粘贴不完整问题，从本地对话日志恢复 v3.1 文件[`cycling-buddy-ride-analysis-v3.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.md)，并在本轮补建原样备份；v3.2 Compact补充nextAction优先级；扣子输出示例改为完整general对象以生成嵌套字段；配置指南、研发指南、路线图和V014评审同步更新。
- 质量判断：用户提供并确认扣子运行日志原文，v3.1可信边界为20条（含`2a`）；原始日志顶部的结构示例仍是历史格式，不能替代当前已验收的`ride-analysis-output-v0.3`合同。`RUN-20260822-016`仍是旧v0.2合同，不能作为v3.2语义质量证据。
- 下一步：用户在扣子确认System Prompt为v3.2 Compact、结构化输出Schema为v0.3且`nextAction`对象字段存在；用同一L1输入重跑。未完成合同核对和真实复测前，不做V014验收，不启动下一工作项。

## LOG-20260822-088｜V014 Prompt旧版备份追溯纠正

- 用户指出：旧版可信边界应为20条，且旧Prompt在修改前应先备份；此前未先建立独立备份，属于维护流程错误。
- 已执行：保留17条恢复版的修改前快照[`cycling-buddy-ride-analysis-v3.1.recovered-17-boundaries.backup.md`](../prompts/cycling-buddy-ride-analysis-v3.1.recovered-17-boundaries.backup.md)，并将用户提供的扣子日志原文归档为[`cycling-buddy-ride-analysis-v3.1.coze-log-20-boundaries.md`](../prompts/cycling-buddy-ride-analysis-v3.1.coze-log-20-boundaries.md)；主文件[`cycling-buddy-ride-analysis-v3.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.md)在20条边界基础上补回生成方法、安全边界、输出合同和User Prompt。主文件SHA-256为`7a3a18eae029a2d6f3efba04967e6d9785db2cf31b0819ee604b29f4e58707ca`，扣子日志归档SHA-256为`77ed051ef3ac066a2bd7fedc0a2f1ca2802f07cd50ee70c0d1a513ab5dd4d790`。
- 兼容性说明：扣子日志中的历史Schema使用`notableEvents: List[string]`等旧格式；当前联调仍必须以`ride-analysis-output-v0.3`对象合同为准，不能直接把历史Schema粘贴到当前工作流。

## LOG-20260822-089｜V014 v3.2维度组织回归与v3.2.1修订

- 用户提供同一L1输入的对照结果：v3.2 Compact把距离、时间、均速、爬升和特征拆成字段型维度，headline只罗列概要，limitations暴露历史准入原因，shareCopy出现“今日/享受/轻松”等无Claim支持表达；旧v3.1则按`pace`/`climbing`组织语义维度，符合PRD 6.3的“按实际能力选择有价值维度”。
- 根因：v3.2压缩时保留了“解释可选”，但遗漏了v3.1的维度选择、同维度Claim合并和“基础概要不生成维度卡”规则。
- 已完成：修改前备份[`cycling-buddy-ride-analysis-v2.compact-pre-dimension-fix.backup.md`](../prompts/cycling-buddy-ride-analysis-v2.compact-pre-dimension-fix.backup.md)；Prompt升级为`v3.2.1`，补回语义维度合同、历史静默、分享文案和headline边界；服务端运行版本同步为`3.2.1`。
- 当前规则：概要Claim默认进入`overallAssessment`；`dimensions`只生成`pace`、`climbing`、`heartRate`、`power`、`cadence`、`history`等有特征/关系/历史证据的语义维度，同一维度合并相关Claim，无认知增量时省略。
- 自动验证：`pnpm verify` 157/157 PASS；真实扣子复测待用户在扣子完整替换v3.2.1后，用同一L1输入重跑；在复测前不启动L2/L3、不验收V014。
- 当前工作项仍为`ITEM-V014`，状态`CHANGES_REQUESTED`；v3.2 Compact、扣子输入和输出合同本轮不变。

## LOG-20260822-090｜V014依据PRD重设计Prompt v3.3

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户反馈：v3.2.1仍把基础Claim过度排除出维度，要求重新审查PRD、版本路线图和Demo/Agent研发指南后设计Prompt。
- 依据结论：PRD 6.3的`dimensions`是业务分析维度，不是字段清单；基础事实可作为已开放业务维度的证据；`AnalysisEligibility`仍是维度准入权威；`endurance`当前没有基础Claim直接开放，不能由模型从距离/时间自行推断。
- 本次变化：先备份[`cycling-buddy-ride-analysis-v3.2.1.pre-v3.3.backup.md`](../prompts/cycling-buddy-ride-analysis-v3.2.1.pre-v3.3.backup.md)，Prompt候选升级为v3.3；同步服务端版本、扣子配置指南、研发指南、版本路线图和当前状态。未修改v3.1及其20条边界归档，未启用Few-shot、RAG或Function Calling。
- 自动验证：`pnpm verify` 157/157 PASS。
- 下一步：用户在扣子完整替换System Prompt v3.3，以同一L1输入真实复测；真实复测、一次受限修复和B0降级完成前，不验收V014、不启动L2/L3。

## LOG-20260822-091｜V014回到v3.1整体逻辑并建立v3.1.1定向候选

- 元信息：2026-08-22 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户决定：继续使用v3.1的整体评价逻辑；limitations允许说明无心率/功率/踏频，但必须说明解读限制；shareCopy允许低风险主观社交表达；没有意义的解读可降级为事实罗列；优化pace及其他维度的“事实 + 直接意义”。
- 本次变化：保留原[`cycling-buddy-ride-analysis-v3.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.md)不变，建立[`cycling-buddy-ride-analysis-v3.1.1.md`](../prompts/cycling-buddy-ride-analysis-v3.1.1.md)；服务端同步为`ride-analysis-service-v1.2 / ride_analysis_v2-dev.14 / Prompt 3.1.1`；输出校验改为核心解读字段与shareCopy分层，传感器缺失限制增加影响说明门。
- 自动验证：待执行；真实扣子复测尚未执行。
- 下一步：用户在扣子完整替换v3.1.1 System Prompt，用同一L1输入重跑；通过后执行一次受限修复、二次失败转B0和L1/L2/L3能力组合冒烟。V014未验收，不启动L2/L3放行。

## LOG-20260823-092｜V014 v3.1.1 L1/L2/L3三能力组合冒烟入账

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 证据：[RUN-20260823-018](../eval/runs/RUN-20260823-018.json)。用户提供同一Prompt v3.1.1、Few-shot disabled下的L1/L2/L3结果，原始结果已归档。
- 判定：L1 `PASS`；L2 `CONDITIONAL_PASS`（shareCopy出现“今日”）；L3 `FAIL`（踏频CV被分类为稳定、首末功率差值被扩大为全程结论、历史原因泄露、shareCopy出现“今日”）。
- 结论：v3.1.1的业务维度组织、pace事实+直接意义和传感器限制说明已达到当前目标；统计特征分类、首末口径扩展、历史静默和日期标签仍需受限修复验证。
- 下一步：对L3输出执行一次受限修复，只删除/收窄越权表达；修复失败时验证第二次失败转B0。未完成前不修改原始运行记录、不验收V014、不启动后续工作项。

- 服务端补充确定性拒绝码`OVERBROAD_SERIES_CONCLUSION`，用于阻止将首末阶段Claim扩展为全程结论；不修改Prompt版本和原始运行记录。

## LOG-20260823-093｜V014 L3一次受限修复结果

- 证据：[RUN-20260823-019](../eval/runs/RUN-20260823-019.json)。L3修复删除稳定性分类、历史泄露、全程功率结论和“今日”标签，硬边界修复通过。
- 状态：`CONDITIONAL_PASS`。踏频CV和标准化功率比仍以原始统计量呈现而无意义解释；V014暂不验收。
- 下一步：执行二次失败转B0验证；原始运行和修复运行均保持不变。

## LOG-20260823-094｜V014二次失败转B0验证

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 证据：[RUN-20260823-020](../eval/runs/RUN-20260823-020.json)、[T0.49](../eval/benchmark-report.md#56t049v014二次失败转b0确定性验证2026-08-23)。
- 验证：首次输出和唯一一次受限修复均为非法JSON；服务端最终返回`source=b0`、`fallbackCode=REPAIR_FAILED`、`attempts=2`，没有第三次Provider调用，`fewShotMode=disabled`，B0模板输出合法且保留可追溯Claim与低风险后续建议。
- 结论：失败重试上限与B0兜底路径通过；不改变RUN-20260823-018/019的语义结果，V014仍为`CHANGES_REQUESTED`。
- 下一步：解决L3中`cadenceCoefficientOfVariation`与`normalizedPowerRatio`仅罗列原始值、未说明用户意义的问题；完成后再提交V014最终验收判断。

## LOG-20260823-095｜V014统计量意义表达修订

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 依据：按PRD 6.3功率/踏频解读要求、研发指南规则与LLM职责划分，本轮只补统计含义表达，不新增未经校准的稳定性、强度、训练负荷或骑行水平分类Claim。
- 本次变化：新建并备份Prompt `v3.1.2`；服务端升级为`ride-analysis-service-v1.3 / ride_analysis_v2-dev.15`；新增`*_STATISTIC_WITHOUT_MEANING`校验，要求CV说明相对平均值的变化程度、标准化功率比说明与平均功率的相对关系。
- 验证：[T0.50](../eval/benchmark-report.md#57t050v014统计量意义校验与prompt-v312静态复验2026-08-23)、[ITEM-V014评审](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#18-v312-统计量意义修订)；`pnpm verify` 161/161、生产构建和交付系统校验均通过。
- 下一步：用户在扣子完整替换v3.1.2，用同一L3输入复测；真实复测通过后再提交V014验收判断，不启动后续L2/L3放行。

## LOG-20260823-096｜V014撤销统计量强制解释

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户决定：没有分类Claim且没有明确用户价值时，不强制解释CV或标准化功率比；内部统计量可省略，原始值保留在数据Tab。
- 本次变化：直接修订Prompt v3.1.2，撤销`*_STATISTIC_WITHOUT_MEANING`服务端强制校验及对应测试；保留通用事实、数字、安全、维度和失败降级规则。同步更新配置指南、研发指南、路线图、当前状态和V014评审。
- 证据：[T0.51](../eval/benchmark-report.md#58t051v014统计量解释强制项撤销2026-08-23)、[ITEM-V014评审](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#19-用户修订后的-v312-统计量降级规则)。
- 验证：`pnpm verify` 159/159、生产构建和交付系统校验均通过。
- 下一步：在扣子使用同一L3输入复测v3.1.2；V014仍不验收，不启动后续L2/L3放行。

## LOG-20260823-097｜V014确认事实驱动合理定性与自动骑后历史限制

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户决定：当前没有版本化分类/关系Claim时，允许模型基于已验证事实做适度、符合常识且有用户意义的定性解释；没有意义时事实罗列或省略维度；自动骑后`limitations`允许说明历史记录不足/无法进行历史对比，但首次/历史不可比不生成`history`维度。
- 本次变化：正式Prompt `v3.1.2`更新生成方法、统计量使用和历史限制；服务端移除未校准统计定性的硬拒绝，并将历史缺口校验限定为非limitations文本；保留Claim/数字、维度准入、首末阶段、日期场景、距离/路线/强度和安全边界；同步研发指南、路线图、扣子配置指南、V014评审和`DEC-060`。
- 自动验证：`pnpm verify` 160/160通过，`pnpm build`生产构建通过，交付系统校验`0 error / 0 warning`；新增/修订的历史限制与合理定性回归均通过。
- 未执行：真实扣子v3.1.2复测、L3质量人工评审和V014验收仍未完成；原始`RUN-20260823-018/019/020`保持不变。
- 下一步：用完整Prompt v3.1.2和同一L3输入复测；通过后再提交V014验收，不启动下一工作项。

## LOG-20260823-098｜V014允许同一Claim展示换算并补齐整体Claim覆盖

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 变更：Prompt `v3.1.2`允许同一Claim的常见单位/比例展示换算和合理舍入，并在输出合同末尾加入高频日期/场景与Claim覆盖最终检查；服务端升级为`ride-analysis-service-v1.4`，数字校验增加有限换算族，新增`OVERALL_TOPIC_WITHOUT_CLAIM`主题覆盖拒绝码。
- 证据：`tests/ride-analysis-output-v03.test.ts`新增正确/错误百分比换算、整体评价主题漏引与完整引用回归；针对L3输出，心率/踏频/功率的整体描述现在必须分别引用对应Claim。
- 验证：`pnpm exec node --test tests/ride-analysis-output-v03.test.ts` 21/21通过；全量`pnpm verify` 162/162通过；`pnpm build`生产构建通过；交付系统校验`0 error / 0 warning`。
- 用户决策：接受同一Claim可验证展示换算；日期标签问题先按“可能增加遗漏风险但单次失败不足以归因于Prompt过长”处理，不盲目压缩Prompt。
- 下一步：使用完整v3.1.2和同一L3输入在扣子复测；观察换算、日期/场景标签和整体Claim覆盖，完成后再提交V014验收，不启动L2/L3放行。

## LOG-20260823-099｜V014强化整体评价跨维度选择

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户反馈：最新L3结果的`dimensions`覆盖pace、heartRate、power、cadence、climbing，但`overallAssessment`只总结概要和pace，未回答多个传感器维度共同构成的整体表现。
- 变更：Prompt v3.1.2的生成方法明确整体评价要选择最能改变整体判断的1—3组业务证据；速度、心率、功率、踏频或可比历史共同影响判断时合并说明并补齐Claim；无整体认知增量的孤立维度可留在`dimensions`。同步研发指南和扣子配置指南，未创建新Prompt版本。
- 验证：Prompt静态回归新增跨维度整体评价规则检查；`pnpm verify` 162/162通过；`pnpm build`生产构建通过；交付系统校验`0 error / 0 warning`。
- 下一步：用完整v3.1.2和同一L3输入复测整体评价是否纳入必要的心率、功率、踏频证据；不启动后续工作项或L2/L3放行。

## LOG-20260823-100｜V014补强首末阶段不得扩展为全程

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 用户提供的新L3结果：整体评价已纳入速度、心率、功率和踏频Claim，但仍写出“功率全程没有变化”；该文本把`powerFirstLastDeltaW`首末阶段事实扩展成全程结论。
- 变更：在当前Prompt v3.1.2整体评价规则中加入明确反例，要求首末Claim只能表达首末阶段关系，除非存在全程统计Claim；扣子配置指南同步该口径。服务端既有`OVERBROAD_SERIES_CONCLUSION`继续作为硬校验。
- 验证：Prompt静态回归已增加该反例检查；`pnpm verify` 162/162通过。
- 下一步：用完整v3.1.2和同一L3输入复测；重点观察功率是否收窄为“首末阶段没有变化”，不启动后续工作项或L2/L3放行。

## LOG-20260823-101｜V014补充无范围限定“一致”表达校验

- 元信息：2026-08-23 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 变更：新增`UNSCOPED_CONSISTENCY_CONCLUSION`，拒绝仅有首末证据时的“功率保持一致”等无范围限定表达；保留“首末阶段功率保持一致”合法。Prompt v3.1.2与扣子配置指南同步明确反例。
- 验证：`pnpm verify` 163/163通过；新增首末限定/未限定正反例；真实扣子复测待执行。
- 下一步：用完整v3.1.2和同一L3输入复测，确认模型将功率表述收窄为首末阶段结论。

## LOG-20260823-102｜V014验收更正并启动T001评测迁移

- 元信息：2026-08-23 / v0.1 / ITEM-V014→ITEM-T001；状态：`IN_PROGRESS`
- 更正：此前当前状态仍将V014记录为`CHANGES_REQUESTED`并把L3真实复测写成下一项；实际用户已确认受限修复和B0降级路径结果，V014的工程联调范围已完成。真实模型质量和G1仍未放行，不能把V014等同于T1基准通过。
- 本次变化：启动`ITEM-T001`，审查PRD 6.3/7.11、研发指南13–14、路线图G1/W4及DEC-059/060/061；保留旧30条文件，新增自动骑后迁移清单并将安全/注入/工具/RAG移出自动骑后合同。
- 证据：[ITEM-T001评测迁移审查](../reviews/ITEM-T001-eval-migration-review.md)、[T1准备 / B0基线](../eval/benchmark-report.md#64t1准备item-t001新合同评测迁移与b0基线2026-08-23)、`eval/ride-analysis-cases-v0.3-migration.json`。
- 验证：B0当前fixtures 14/14合同、数字/Claim追溯和能力边界通过；P50 0.030ms、P95 0.918ms；`B1/B2/B3=NOT_RUN`。
- 风险/阻塞：18条自动骑后上下文fixture已补齐；仍无真实模型ID、Token、成本和端到端P95，不能执行完整T1或宣称G1。
- 下一步：冻结运行矩阵并按每条3次协议执行B1/B2/B3，保留原始失败、修复和降级记录。

## LOG-20260823-103｜T001七条补充上下文fixture完成

- 元信息：2026-08-23 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 本次变化：新增 `src/fixtures/ride-analysis-eval.ts`，生成七条补充上下文；更新 Coze 导出脚本并生成 7 个 `output/coze-inputs/eval-*.json`；迁移清单现为 `18 READY / 0 NEEDS_FIXTURE`。
- 覆盖边界：不同路线不可比、估算最大心率、无个人基线高心率、室内心率-only、FTP不足、历史样本不足、室内功率-only；室内样例不含GPS/路线Claim，历史样例不开放history维度。
- 证据：[补充fixture测试](../tests/ride-analysis-eval-fixtures.test.ts)、[迁移资产测试](../tests/ride-analysis-eval-migration.test.ts)、[T1准备 / B0基线](../eval/benchmark-report.md#64t1准备item-t001新合同评测迁移与b0基线2026-08-23)。
- 验证：`pnpm verify` 167/167、`pnpm build`通过、交付系统校验 `0 error / 0 warning`；18条迁移清单均为READY，7个Coze输入文件已生成。
- 风险/阻塞：所有fixture为合成/内置评测输入；B1/B2/B3真实模型运行、Token、成本和P95仍未执行。
- 下一步：冻结 T001 版本矩阵，按每条3次协议执行 B0/B1/B2/B3，并保留失败、修复和降级记录。

## LOG-20260823-104｜T001 18条新合同B0基线完成

- 元信息：2026-08-23 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 本次变化：新增独立 `benchmark:t001:b0` runner，逐条构建18个 `RideAnalysisContext v0.2` / `AnalysisEligibility v0.1` 上下文，并调用确定性 `b0-template-v0.1` 作为对照；原有旧14条 B0 runner 保持不变。
- 评测清单更正：`RA-AUTO-014` 的 fixture 没有可靠海拔事实，`expectedDimensionKeys` 从 `pace/heartRate/climbing` 修正为 `pace/heartRate`；其他条目的预期维度按关注子集校验，不要求等于全部开放维度。
- 证据：[RUN-20260823-022](../eval/runs/RUN-20260823-022.json)、[T1 18条B0基线](../eval/benchmark-report.md#65t1item-t001新合同18条b0基线2026-08-23)、[T001评测迁移审查](../reviews/ITEM-T001-eval-migration-review.md#9-run-20260823-02218条新合同b0基线)。
- 验证：新上下文合同18/18、准入合同18/18、预期关注维度证据18/18、B0输出合同18/18；P50/P95为0.188/1.684ms，本机进程内；模型调用、Token、成本均为0；生产构建和全量验证待本条之后执行。
- 风险/阻塞：B0仍是旧 `RideContextSnapshot v1.0 / RideAnalysisOutput` 确定性模板，不是 v0.3 模型结果；B1/B2/B3、人工评分、端到端P95和成本仍未运行。
- 下一步：冻结并取得真实模型配置，按每条3次协议执行B2，再在同一矩阵下执行B1/B3；保留每次原始运行、修复和B0降级。

## LOG-20260823-105｜T001 B0基线变更后验证完成

- 元信息：2026-08-23 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 证据：`pnpm verify` 167/167通过；`pnpm build`生产构建通过；交付系统校验 `0 error / 0 warning`。
- 影响：新增T001 runner、迁移清单修正和台账同步没有引入类型、测试、构建或交付文档回归。
- 下一步：等待/取得冻结模型配置后执行真实B2；B1/B2/B3和人工评审完成前不推进G1。

## LOG-20260823-106｜T001 18条扣子输入导出完成

- 元信息：2026-08-23 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 本次变化：新增 `export:coze:t001`，为 `RA-AUTO-001` 至 `RA-AUTO-018` 生成五变量扣子输入文件 `output/coze-inputs/t001-RA-AUTO-*.json`。
- 验证：18个输入均通过上下文/准入合同校验；输入键为`analysis_context`、`analysis_elig`、`few_shot_json`、`repair_instruction`、`previous_output`；Few-shot均为`disabled`且examples为空；`RA-AUTO-014`仅开放`pace`、`heartRate`。
- 边界：输入导出不等于扣子模型运行；没有新增模型ID、Token、成本或质量结论。
- 下一步：使用同一版本矩阵在扣子或服务端真实配置下按每条3次协议运行B2，并保留原始输出、受限修复和B0降级记录。

## LOG-20260824-107｜T001项目状态与主文档一致性审计

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 审计结论：实际资产与`RUN-20260823-022`一致，18条自动骑后上下文、18条B0和18个扣子输入均存在；B1/B2/B3仍无真实模型运行。`current-status`误把已验收V014列为当前项，PRD/研发指南/路线图仍残留“历史不足完全静默”“旧30条混合集合直接作为骑后固定集”“新B0仍仅14条”的旧陈述。
- 修复：依据已接受`DEC-060/063/064`和实际运行证据，同步PRD、研发指南、路线图与当前状态；保留原30条文件及既有追加式历史，不改写旧运行或旧日志。
- 当前边界：自动骑后历史不可比时不生成`history`维度，但可在`limitations`说明影响；当前固定集为18条自动骑后+12条独立对话，B0为18/18，B1/B2/B3为`NOT_RUN`。
- 下一步：实现B2 54个运行槽位的批次清单与原始结果导入/硬合同校验；该准备项不调用模型。

## LOG-20260824-108｜T001 B2固定集运行准备完成

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 本次变化：新增18条×3次的B2冻结清单、真实原始结果接收协议、服务端回放导入器与命令`benchmark:t001:b2:validate`；要求精确模型ID、区域、参数、请求ID、时间、延迟、Token、成本和最多两次完整Provider尝试。
- 防误判：合法导入只记`validationStatus=PASS`与`benchmarkStatus=NOT_SCORED`；使用`wx`禁止覆盖既有RUN。合成测试中的51次B2成功和3次不准入B0仅验证服务链路，不创建模型运行证据。
- 边界补强：畸形嵌套JSON返回明确issue而不崩溃；不可准入案例除0调用和0 Token外还必须0模型成本。
- 证据：[B2运行接收协议](../eval/t001-b2-run-protocol.md)、[ITEM-T001评审](../reviews/ITEM-T001-eval-migration-review.md#11-b2真实运行准备项)、[T1准备记录](../eval/benchmark-report.md#67t1准备item-t001-b2批次接收与服务端回放校验2026-08-24)。
- 验证：聚焦测试6/6、`pnpm verify` 173/173、`pnpm build`通过、交付系统校验`0 error / 0 warning`。
- 未执行：B1/B2/B3真实模型运行、两名评审盲评、质量/成本/端到端P95和G1结论仍为`NOT_RUN`。
- 下一步：用户预览并验收本准备项；随后取得冻结的精确模型ID、区域、参数和Token/成本来源，执行54槽真实B2。

## LOG-20260824-109｜T001验收前Git基线风险登记

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 审计事实：当前路径是Git工作树，分支为`main`，但尚无任何commit；项目文件全部处于未跟踪状态。
- 影响：现有本地测试和文档证据仍可复验，但缺少不可变源码基线、变更diff和可靠回滚点，后续真实模型RUN也无法绑定到具体commit。
- 处置：本轮只登记风险，不在未获用户确认时创建首个全量提交或改变分支。
- 下一步：用户在B2准备项验收时一并决定是否建立首个Git基线；真实B2仍需另行取得精确模型配置与计量来源。

## LOG-20260824-110｜用户确认建立首个本地Git基线

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 用户决定：在真实B2前把当前项目提交到本地仓库，建立首个可回滚、可绑定RUN的源码基线。
- 提交边界：纳入当前代码、文档、Prompt、非私密fixture、评测清单和可复验证据；排除`.env*`、私有FIT、`node_modules`、`.next`、`.pnpm-store`和TypeScript增量缓存。
- 安全检查：未发现真实API Token；配置指南中的Token文本均为占位符。
- 后续规则：真实B2批次必须记录所用commit；本次只建立本地基线，不推送远端。

## LOG-20260824-111｜纠正LOG-20260823-102的V014完成状态

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`CHANGES_REQUESTED`
- 错误陈述：`LOG-20260823-102`把用户对历史受限修复和B0降级结果的确认解释为V014工程联调范围已完成，并据此启动T001。
- 正确证据：用户明确澄清，最终Prompt v3.1.2目前只使用L3样例在扣子完成一次试运行；`RUN-20260823-018/019/020`分别属于v3.1.1三能力冒烟、v3.1.1受限修复和自动化B0降级，不能替代最终v3.1.2链路证据。V014评审文件也一直保持`CHANGES_REQUESTED`，没有用户`ACCEPTED`记录。
- 影响：V014恢复为当前工作项；T001已经完成的fixture、B0、输入导出和B2接收协议资产保留，但真实B2暂停。研发指南、路线图和当前状态中的过度结项同步纠正；不删除或改写原LOG-102。
- 来源审查：PRD 6.3/7.11、研发指南6/14、路线图v0.1/G1与当前产品行为无新冲突；本次只纠正实际执行和验收状态。
- 下一步：归档用户提供的v3.1.2 L3原始输出，以同一L3上下文运行Service v1.4合同复验；不补造缺失模型元数据，不外推L1/L2结果。

## LOG-20260824-112｜V014 L3归档与确定性合同修复待预览

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`READY_FOR_PREVIEW`（L3归档与合同修复切片）
- 变化：用户提供的最终v3.1.2 L3输出已原样归档为`RUN-20260824-023`。原始`feature-rules-v0.1 / Service v1.4`回放暴露CV物理单位错误及同Claim原值舍入缺口；修复为`feature-rules-v0.2 / Service v1.5`，Prompt、Workflow和Few-shot配置不变。T001原Service v1.4矩阵继续冻结，未静默改写。
- 证据：[V014评审第24节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#24-run-20260824-023v312-l3试运行归档与合同修复复验)、[RUN-20260824-023](../eval/runs/RUN-20260824-023.json)、[T0.57](../eval/benchmark-report.md#68t057v014-v312-l3归档与确定性合同修复2026-08-24)；聚焦36/36、全量176/176、生产构建通过、交付系统0 error / 0 warning。
- 风险：精确模型ID、请求ID、首次/修复角色、延迟、Token和成本均`NOT_RECORDED`；最终L1/L2及v3.1.2失败链路未运行，本条不代表V014整体或G1通过。
- 下一步：用户预览并确认本L3归档与合同修复切片；接受后补最终v3.1.2 L1/L2，再复验一次受限修复与B0路径。

## LOG-20260824-113｜用户接受V014 L3归档与合同修复切片

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`ACCEPTED`（仅L3归档与合同修复切片）
- 用户决定：接受“L3归档与合同修复”切片，包括原始L3证据边界、`feature-rules-v0.2 / Service v1.5`修复和修复后合同回放结果。
- 边界：`ITEM-V014`整体仍未完成；本次不推断未记录模型元数据，不代表最终L1/L2、受限修复/B0路径、T001或G1通过。
- 证据：[V014评审第25节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#25-用户验收l3归档与合同修复切片)、[RUN-20260824-023](../eval/runs/RUN-20260824-023.json)。
- 下一步：使用当前导出的L1/L2五变量输入，在同一Prompt v3.1.2、Workflow dev.15、Few-shot disabled矩阵下执行扣子试运行并归档原始输出。

## LOG-20260824-114｜V014最终v3.1.2 L1/L2试运行待预览

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`READY_FOR_PREVIEW`（L1/L2试运行切片）
- 变化：归档用户提供的L1/L2原始输出和两张扣子元数据截图；界面显示模型“豆包·2.0-lite”，L1为11秒/8583 Tokens，L2为16秒/11092 Tokens。精确模型ID、请求ID、毫秒延迟、Token拆分和成本保持`NOT_RECORDED`。
- 证据：[V014评审第26节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#26-run-20260824-024025最终v312-l1l2扣子试运行)、[RUN-024](../eval/runs/RUN-20260824-024.json)、[RUN-025](../eval/runs/RUN-20260824-025.json)、[T0.58](../eval/benchmark-report.md#69t058v014最终v312-l1l2扣子试运行2026-08-24)；两条合同均PASS/0 issue，聚焦6/6、全量180/180通过。
- 质量边界：L1统计术语偏专业且整体评价重复一条局限；L2均值Claim略冗余，均不构成事实、能力或安全硬失败。本轮未修改Prompt。
- 下一步：用户预览并确认L1/L2试运行切片；接受后复验最终v3.1.2的一次受限修复与二次失败B0路径。

## LOG-20260824-115｜用户接受V014最终v3.1.2 L1/L2试运行切片

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`ACCEPTED`（仅最终v3.1.2 L1/L2试运行切片）
- 用户决定：接受“最终Prompt v3.1.2 L1/L2试运行”切片，包括两条原始输出归档、截图可见元数据边界、Service v1.5合同PASS结果和非阻断质量备注。
- 边界：`ITEM-V014`整体仍未完成；本次不补足未记录模型元数据，不代表稳定性基准、受限修复/B0路径、T001或G1通过。
- 证据：[V014评审第27节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#27-用户验收最终v312-l1l2试运行切片)、[RUN-024](../eval/runs/RUN-20260824-024.json)、[RUN-025](../eval/runs/RUN-20260824-025.json)。
- 下一步：使用最终Prompt v3.1.2复验一次受限修复；随后验证第二次校验失败是否停止重试并转入B0。

## LOG-20260824-116｜V014最终v3.1.2受限修复输入已就绪

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`IN_PROGRESS`
- 变化：新增可复现导出器和五变量修复输入；基于已验收L3输出只注入未知Claim与`999W`，Service v1.5确定性生成三项错误码和受限修复说明，Few-shot保持关闭。
- 证据：[V014评审第28节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#28-最终v312受限修复输入准备)、[修复输入](../output/coze-inputs/l3-built-in-sample-repair-v3.1.2.json)；聚焦2/2、全量182/182、`git diff --check`和交付系统校验通过。
- 边界：输入准备没有调用模型，不代表受限修复通过；修复输出、精确模型元数据和质量结论仍未产生。
- 下一步：用户在当前Prompt v3.1.2 / Workflow dev.15 / Few-shot disabled配置中原样运行五变量修复输入，并返回原始JSON与截图供归档回放。

## LOG-20260824-117｜V014最终v3.1.2受限修复与B0路径待预览

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`READY_FOR_PREVIEW`（最终受限修复/B0切片）
- 变化：真实扣子修复输出归档为`RUN-20260824-026`并通过Service v1.5回放；确定性二次失败路径归档为`RUN-20260824-027`，两次非法输出后返回`REPAIR_FAILED + B0`且无第三次Provider调用。
- 证据：[V014评审第29节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#29-run-20260824-026027最终v312受限修复与b0路径复验)、[RUN-026](../eval/runs/RUN-20260824-026.json)、[RUN-027](../eval/runs/RUN-20260824-027.json)、[T0.59](../eval/benchmark-report.md#70t059v014最终v312受限修复与b0路径2026-08-24)；聚焦6/6、全量186/186通过。
- 证据边界：RUN-026精确模型ID、请求ID、毫秒延迟、Token拆分和成本未记录；RUN-027不调用真实模型。该切片不等于18条稳定性基准、T001或G1通过。
- 下一步：用户预览并确认最终受限修复/B0切片；接受后再进行`ITEM-V014`整体验收判断，不直接启动T001。

## LOG-20260824-118｜用户接受V014最终修复/B0切片并进入整体验收

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`READY_FOR_PREVIEW`（整体验收）
- 用户决定：接受“最终v3.1.2受限修复与B0路径”切片，包括RUN-026真实修复、RUN-027确定性B0路径及其元数据边界。
- 整体审计：最终Prompt、旧版保留、五变量输入、Few-shot关闭、output-v0.3、Service v1.5、L1/L2/L3真实样例、一次修复、二次失败B0和自动回归证据均已齐备，V014具备整体验收条件。
- 证据：[V014评审第30至31节](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#30-用户验收最终v312受限修复与b0路径切片)、[RUN-026](../eval/runs/RUN-20260824-026.json)、[RUN-027](../eval/runs/RUN-20260824-027.json)、[T0.59](../eval/benchmark-report.md#70t059v014最终v312受限修复与b0路径2026-08-24)。
- 边界：精确模型计量、18条稳定性、B2相对B0价值、UI接入、T001和G1仍未验证；本条不把V014自动标记为`ACCEPTED`。
- 下一步：用户明确回复`接受 ITEM-V014`或提出整体修改意见；在此之前不启动T001真实B2。

## LOG-20260824-119｜用户接受ITEM-V014整体

- 元信息：2026-08-24 / v0.1 / ITEM-V014；状态：`ACCEPTED`
- 用户决定：接受`ITEM-V014｜新骑后Prompt/Few-shot/扣子输入联调`整体，包括最终v3.1.2三个已验收切片与第31节整体证据矩阵。
- 证据：[V014整体用户验收](../reviews/ITEM-V014-prompt-few-shot-coze-input-review.md#32-用户验收item-v014整体)、[T0.57](../eval/benchmark-report.md#68t057v014-v312-l3归档与确定性合同修复2026-08-24)、[T0.58](../eval/benchmark-report.md#69t058v014最终v312-l1l2扣子试运行2026-08-24)、[T0.59](../eval/benchmark-report.md#70t059v014最终v312受限修复与b0路径2026-08-24)。
- 边界：本次不发布扣子工作流、不接入API/UI、不运行真实B2，也不改变B1/B2/B3和G1的`NOT_RUN`状态。
- 下一步：审查T001原Service v1.4冻结矩阵与已接受Service v1.5基线的差异，形成可预览的重冻结方案；用户确认方案后才决定测试环境发布与真实B2执行。

## LOG-20260824-120｜T001 Service v1.5版本矩阵重冻结方案待预览

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（重冻结审查切片）
- 来源审查：PRD 6.3/7.11、研发指南6/13/14、路线图v0.1/G1与已接受决策无新冲突。
- 审计结论：新矩阵不能只把Service v1.4改成v1.5；V014已使18个输入从`ride-feature-rules-v0.1`变为`v0.2`。`RUN-20260823-022`保留为历史B0，新矩阵需在同输入上生成新B0；首个Git基线`8c16778...`早于这些修复，不能直接绑定未来B2。
- 建议：升级T001 manifest/raw/evaluated合同为v0.2，冻结Service v1.5/特征规则v0.2，以SHA-256绑定18个五变量输入，新建同矩阵B0，并要求真实B2记录完整`sourceCommit`。
- 证据：[ITEM-T001评审第12节](../reviews/ITEM-T001-eval-migration-review.md#12-service-v15版本矩阵重冻结审查)、[DEC-065提案](decision-log.md#dec-065t001-service-v15版本矩阵重冻结方案)。现有18/18输入通过五变量、上下文/准入Schema和Few-shot disabled静态检查。
- 未执行：manifest/协议/导入器尚未修改，新B0、新commit、扣子发布、B1/B2/B3、人工评分和G1判断均未执行。
- 下一步：用户确认或修改`DEC-065`方案；确认后实施并自动验证Service v1.5重冻结，仍不运行真实B2。

## LOG-20260824-121｜用户接受DEC-065重冻结方案

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 用户决定：明确回复“接受 DEC-065 重冻结方案”，授权实施manifest/批次合同v0.2、Service v1.5/特征规则v0.2输入冻结、新B0及`sourceCommit`接收门。
- 边界：不授权本切片发布扣子、调用模型、创建真实B2、评分或判断G1。
- 下一步：实施重冻结并运行聚焦、全量、构建和交付系统校验。

## LOG-20260824-122｜T001 Service v1.5重冻结实施待预览

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（重冻结实施切片）
- 变化：T001 manifest/raw/evaluated合同升为v0.2，冻结Service v1.5/特征规则v0.2、18个五变量输入及SHA-256，新增完整`sourceCommit`接收门；新建同矩阵确定性B0 `RUN-20260824-028`，旧`RUN-20260823-022`保持不变。
- 证据：[ITEM-T001评审第13节](../reviews/ITEM-T001-eval-migration-review.md#13-service-v15重冻结实施)、[RUN-028](../eval/runs/RUN-20260824-028.json)、[T1准备记录](../eval/benchmark-report.md#71t1准备t001-service-v15版本矩阵重冻结与新b02026-08-24)。
- 验证：RUN-028上下文/准入/预期维度/B0均18/18 PASS，模型调用/Token/成本为0；T001聚焦7/7、全量187/187、生产构建通过。
- 未执行：新Git commit、扣子发布、API/UI接入、B1/B2/B3真实运行、人工双评和G1判断。
- 下一步：用户验收重冻结实施切片；验收后建立包含已验收V014与T001重冻结实现的新本地Git commit。

## LOG-20260824-123｜用户接受T001 Service v1.5重冻结实施切片

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`ACCEPTED`（Service v1.5重冻结实施切片）
- 用户决定：明确回复“接受 ITEM-T001 Service v1.5重冻结实施切片。进入下一项”，接受第13节的实施、验证证据和未执行边界。
- 证据：[ITEM-T001第14节](../reviews/ITEM-T001-eval-migration-review.md#14-用户验收service-v15重冻结实施切片)、[RUN-028](../eval/runs/RUN-20260824-028.json)。
- 边界：不发布扣子、不调用模型、不创建真实B2、不评分或判断G1。
- 下一步：建立包含已验收V014与T001实现的新本地Git冻结基线，使未来B2可绑定真实`sourceCommit`。

## LOG-20260824-124｜T001新Git冻结基线待预览

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（新Git冻结基线切片）
- 变化：建立源码冻结提交`78facde226a738ea0fefe660f38ddaada50a5393`，包含已验收V014与T001 Service v1.5重冻结资产；提交中无文件删除，三个无关删除未纳入。
- 证据：[ITEM-T001第15节](../reviews/ITEM-T001-eval-migration-review.md#15-新git冻结基线)；提交前差异检查和交付系统校验通过，提交后文件集复核无删除项。
- 未执行：扣子发布、API/UI接入、B1/B2/B3、人工双评和G1判断。
- 下一步：用户验收新Git冻结基线；验收后审查真实B2的测试环境发布与模型计量配置。

## LOG-20260824-125｜用户接受T001新Git冻结基线并暂停

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`ACCEPTED`（新Git冻结基线切片）
- 用户决定：明确回复“接受 ITEM-T001 新Git冻结基线切片。先不进行下一项”，接受源码冻结提交`78facde226a738ea0fefe660f38ddaada50a5393`及已记录边界。
- 证据：[ITEM-T001第16节](../reviews/ITEM-T001-eval-migration-review.md#16-用户验收新git冻结基线切片)。
- 暂停边界：不启动真实B2运行配置审查，不发布扣子、不调用模型、不接入API/UI。
- 下一步：等待用户明确恢复；恢复时再开始`ITEM-T001 真实B2运行配置审查切片`，不自动运行54槽。

## LOG-20260824-126｜T001真实B2运行配置审查待预览

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（真实B2运行配置审查切片）
- 来源审查：PRD 6.3/7.11/7.12、研发指南14.2/14.3/16.1、路线图3.1/5.3/18与当前实现无产品范围冲突；运行计量合同存在未闭合项。
- 审计结论：源码、18输入、Prompt v3.1.2、Service v1.5和Few-shot状态已冻结；精确模型ID/区域/完整参数、测试环境发布版本、Token拆分、成本来源和首Token可观测性仍缺失。配置指南`1200`与截图实际`2400`的最大回复长度不一致。
- 建议：测试环境冻结发布后通过API批次运行；先做计量可得性预检，不能取得必需字段时不运行54槽、不用估算补证据。
- 证据：[ITEM-T001第17节](../reviews/ITEM-T001-eval-migration-review.md#17-真实b2运行配置审查)、[DEC-066提案](decision-log.md#dec-066t001真实b2测试发布与计量预检方案)。
- 未执行：扣子发布、`.env.local`配置、模型调用、B1/B2/B3、人工双评和G1判断。
- 下一步：用户确认或修改`DEC-066`；接受后再进入测试环境发布与计量预检切片。

## LOG-20260824-127｜用户接受DEC-066与真实B2运行配置审查方案

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`ACCEPTED`（真实B2运行配置审查切片）
- 用户决定：明确回复“接受 DEC-066”，确认测试环境冻结发布、API批次运行和先计量预检后54槽的方案；最大回复长度文档基线从旧候选`1200`同步为已试运行配置`2400`。
- 证据：[ITEM-T001第18节](../reviews/ITEM-T001-eval-migration-review.md#18-用户验收真实b2运行配置审查切片)、[DEC-066](decision-log.md#dec-066t001真实b2测试发布与计量预检方案)。
- 授权边界：本次不授权实际发布扣子或调用模型；B1/B2/B3和G1仍为`NOT_RUN`。
- 下一步：等待用户授权`ITEM-T001 测试环境发布与计量预检切片`的测试环境发布动作；任何单次模型调用另行确认。

## LOG-20260824-128｜T001测试环境发布与计量预检启动后等待登录

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`BLOCKED`（测试环境发布与计量预检切片）
- 用户授权：明确要求进行本切片；授权范围为冻结配置取证、测试环境发布和计量预检，不含生产发布、54槽B2或UI接入。
- 当前事实：manifest与首条输入摘要未漂移；可控浏览器已打开扣子网页版，但当前无登录态，只能到达登录弹窗。
- 安全边界：未输入或保存手机号、验证码、Cookie、API Token；未发布Workflow、未调用模型。
- 证据：[ITEM-T001第19节](../reviews/ITEM-T001-eval-migration-review.md#19-测试环境发布与计量预检)。
- 下一步：用户在已显示页面完成登录并回复“已登录”，随后继续配置取证和测试发布。

## LOG-20260824-129｜T001测试发布与唯一计量预检待预览

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（测试环境发布与计量预检切片）
- 用户行动：用户在可控浏览器完成扣子登录，解除`LOG-20260824-128`的外部登录阻塞。
- 变化：冻结工作流`7676429753852018707`已发布为平台版本`v0.0.1`；可见Prompt v3.1.2、五变量、output-v0.3、Few-shot disabled和模型生成配置未发现漂移。平台无安全的放弃草稿入口，恢复`v0.0.1`后草稿内容一致但仍标记未发布修改，没有发布无意义的`v0.0.2`。
- 证据：唯一一次`RA-AUTO-001`预检成功，输入/输出/总Token为`7667 / 737 / 8404`，LogId为`202608241249057986C46248E67C3BEBD4`；详见[ITEM-T001第19节](../reviews/ITEM-T001-eval-migration-review.md#19-测试环境发布与计量预检)。
- 阻断：平台日志与官方API合同仍不提供精确模型ID、计算区域、首Token延迟和成本来源；54槽B2依据`DEC-066`未运行，B1/B2/B3继续`NOT_RUN`。
- 下一步：用户验收本切片并评审[DEC-067](decision-log.md#dec-067t001扣子b2不可观测计量字段处置)；接受合同分层方案后才实施适配器/合同修订，若坚持完整计量硬门则改为评审运行链路迁移。

## LOG-20260824-130｜用户接受扣子Demo测试验证路径

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`ACCEPTED`（测试环境发布与计量预检切片）
- 用户决定：当前Demo阶段继续使用扣子进行测试验证，接受`DEC-067`的分层计量方案。
- 接受边界：扣子`v0.0.1`继续用于质量、结构和可靠性验证；精确模型ID、区域、首Token延迟和成本来源不估算，记录为`NOT_OBSERVABLE`；性能与成本Gate保持`NOT_SCORED`。
- 未发生：本次没有运行54槽B2，没有生产发布、API/UI接入或G1判断。
- 证据：[ITEM-T001第20节](../reviews/ITEM-T001-eval-migration-review.md#20-用户接受扣子demo测试验证路径)、[DEC-067](decision-log.md#dec-067t001扣子b2不可观测计量字段处置)。
- 下一步：实施并验证扣子B2分层计量接收合同；完成后再单独预览批次执行范围。

## LOG-20260824-131｜T001扣子B2分层计量合同适配待预览

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（扣子B2分层计量合同适配）
- 变化：T001批次/结果合同升为`v0.3`；允许模型ID、区域、首Token延迟和成本字段显式记录`NOT_OBSERVABLE`；新增逐槽`firstTokenLatencyMs`和`costSource`，保留请求、Token、尝试、原始输出、修复链和54槽完整性硬门。
- 证据：聚焦合同测试`8/8 PASS`，覆盖完整54槽回放、重复/缺槽、畸形嵌套、不可准入成本和`NOT_OBSERVABLE`合法路径；类型检查和`git diff --check`通过；详见[ITEM-T001第20.2节](../reviews/ITEM-T001-eval-migration-review.md#202-分层合同适配结果)。
- 未执行：真实扣子B2、人工双评、性能/成本评分和G1判断均未执行。
- 下一步：用户预览并确认合同适配；确认后再单独决定扣子54槽批次的执行范围和授权。

## LOG-20260824-132｜T001扣子B2批次执行范围待确认

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`（扣子B2批次执行范围预览）
- 预览范围：扣子 Workflow `7676429753852018707` / 平台版本 `v0.0.1`，18个固定案例各3次，共54个槽位；按当前准入 fixture 预计51个可调用槽位，`RA-AUTO-018#1..#3`必须0调用并走B0。
- 计量与重试：每个可准入槽最多首次调用+一次受限修复；请求ID、Token拆分、尝试/端到端耗时必须记录；模型ID、区域、首Token和成本不可得时写`NOT_OBSERVABLE`，不估算。
- 停止与排除：配置/输入漂移、证据链缺失、权限/配额/计费异常或越界接入时停止剩余槽位；不运行B1/B3、不人工评分、不判断G1或生产放行。
- 证据：[ITEM-T001第21节](../reviews/ITEM-T001-eval-migration-review.md#21-扣子b2批次执行范围预览)、[B2 manifest](../eval/t001-b2-benchmark-manifest.json)、[B2协议](../eval/t001-b2-run-protocol.md)。
- 下一步：等待用户确认以上执行范围和授权；确认前不调用真实模型、不创建B2 RUN。

## LOG-20260824-133｜T001扣子B2改为手工截图证据采集

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 用户决定：用户确认执行范围后，改为由用户按《T001 B2 扣子手工执行指南》在扣子完成槽位执行并通过截图反馈，不继续自动批量调用。
- 实际变化：已在已发布 `v0.0.1` 预览中发生 `RA-AUTO-001#1` 一次调用；页面显示 `运行完成 12s / 8408 Tokens`，尚未形成可导入的完整原始记录。
- 边界：不得重复 `RA-AUTO-001#1`；剩余可调用槽为 `RA-AUTO-001#2/#3` 至 `RA-AUTO-017#1/#2/#3` 共50个；`RA-AUTO-018#1..#3`必须0模型调用并使用`RUN-20260824-028` B0。
- 证据：[手工执行指南](../eval/t001-b2-coze-manual-execution-guide.md)、扣子 `v0.0.1` 预览页面；完整请求/输出/修复链待用户截图补齐。
- 风险：在截图证据收齐前，不能生成合法的54槽`raw batch`，不能计算质量、性能、成本或G1结论。
- 下一步：用户先反馈 `RA-AUTO-001#1` 历史运行截图，再按每批3至6槽执行和反馈。

## LOG-20260824-134｜T001 RA-AUTO-001#1运行日志已取证

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 槽位证据：`RA-AUTO-001#1` 在扣子发布版本`v0.0.1`预览中于`2026-08-24 17:55:45`运行成功；输入`rideId=ride-l1-built-in-sample`、`userScope=coze-t001:RA-AUTO-001`。
- 计量：Workflow LogId `20260824175533C12F3708B030050D0659`；大模型节点`10.98s`；豆包·2.0·lite节点`10.89s`；页面总耗时约`12s`；输入/输出/总Token为`7667/741/8408`。
- 输出可见证据：`schemaVersion=ride-analysis-output-v0.3`、`safetyLevel=normal`、`dimensions=2`、`limitations=2`、`notableEvents=0`、`shareCopy=3`；headline为“后程配速回落，整体速度波动较小”；运行结果状态为成功。
- 未取得：本地请求ID、首Token延迟、精确模型ID/区域、成本来源及完整可复制的原始输出文本；这些字段不估算，不能据此写入正式54槽 raw batch。
- 下一步：保留该槽位不重复调用；用户继续执行剩余50个可调用槽，并按指南提交截图。

## LOG-20260824-135｜T001 API B2恢复预检发现本地超时配置未对齐

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`BLOCKED`
- 来源审查：`current-status.md`、评审第21/22节、PRD 6.3/7.11、研发指南14.2/14.3/16.1、路线图G1/W4、`DEC-066/067`；仅审查当前API批次执行直接相关章节。
- 变化：用户声明已将`AI_ANALYSIS_TIMEOUT_MS`调整为`15000`；实际读取`.env.local`仍为`8000`，shell环境没有同名覆盖。零调用预检已验证Workflow名称/ID/平台版本、PAT存在性、18条输入逐文件与聚合SHA-256，以及源码提交`bbed93dd8816b2a37696f4d25361078059a0acb8`；外部调用`0`。
- 证据：API客户端和执行器已提交；类型检查通过、全部`188/188`测试通过；预检未启动模型。此前同Workflow模型节点约`10.26s`，8秒配置会将正常响应判为超时。
- 风险/阻塞：不得在配置未对齐时消耗54槽额度；不得把用户声明直接当作文件事实，也不得自动覆盖用户配置。
- 下一步：修正`.env.local`超时值后重新执行零调用预检；通过后启动新的54槽API B2，保持`benchmarkStatus=NOT_SCORED`，不运行B1/B3、不人工评分、不判断G1。

## LOG-20260824-136｜T001 API B2零调用预检通过并启动批次

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 变化：用户保存`.env.local`后，实际读取到`AI_ANALYSIS_TIMEOUT_MS=15000`；第二次零调用预检通过。Workflow名称/ID/平台版本、PAT存在性、18条输入逐文件与聚合SHA-256、源码提交均保持一致。
- 证据：预检输出 `timeoutMs=15000`、`externalCalls=0`、输入摘要 `5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671`、源码提交 `bbed93dd8816b2a37696f4d25361078059a0acb8`。
- 启动边界：开始新的 API B2 `18案例×3次=54槽`；预计51个可调用槽，`RA-AUTO-018#1..#3`严格0调用并走`RUN-20260824-028` B0；每个可调用槽最多首次调用+一次受限修复。此前手工`RA-AUTO-001#1`不重复、不计入新批次。
- 停止条件：Workflow/Prompt/输入摘要漂移、权限/配额/计费异常、服务端无法保存请求/Token/尝试证据、未授权生产或UI接入时停止剩余槽位；平台不可观测字段继续写`NOT_OBSERVABLE`，不估算。
- 下一步：等待批次完成并生成新的`*-raw.json`，随后运行本地批次校验器和服务端回放；`benchmarkStatus`保持`NOT_SCORED`，不运行B1/B3、不人工评分、不判断G1。

## LOG-20260824-137｜T001 API B2正式批次完成并通过回放

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 变化：在外部网络权限下使用同一冻结配置完成新的`18案例×3次=54槽`批次，生成`RUN-20260824-367`；`RA-AUTO-018#1..#3`严格0模型调用并走B0，未重复手工`RA-AUTO-001#1`。
- 证据：原始批次[`RUN-20260824-367-raw.json`](../eval/runs/RUN-20260824-367-raw.json)；回放结果[`RUN-20260824-367.json`](../eval/runs/RUN-20260824-367.json)；本地校验`validationStatus=PASS`、`benchmarkStatus=NOT_SCORED`、54/54槽。
- 结果：首轮合同通过`15`、受限修复成功`8`、B2成功`23`、B0降级`31`、安全停止`0`、模型调用`67`、总Token`365607`、P50/P95`15002.862/23541.581ms`；成本`NOT_OBSERVABLE`。20次首轮超时、16次修复尝试和3个不准入0调用槽均保留在原始记录中。
- 边界：这是质量/结构/可靠性原始证据和合同回放，不是人工质量评分、性能/成本Gate或G1结论；平台不可观测字段未估算。
- 下一步：用户预览正式批次与回放结果后，再单独决定人工双评/质量分析；不自动启动B1/B3。

## LOG-20260824-138｜T001 B2结果预览与人工评测决策启动

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 来源审查：评测协议第5节、研发指南13.2–13.3/14.2、PRD 7.11、路线图G1/W4及评审第25节；未重复读取三份主文档全文。
- 变化：正式批次合同回放已通过，但质量尚未盲评。当前结果为23槽B2有效输出、31槽B0降级、首轮超时20次、P95 23541.581ms；因此将人工评测定义为诊断性质量评估，运行稳定性单独保留。
- 证据：[人工评测计划](../eval/t001-b2-human-review-plan-v0.1.md)、[`RUN-20260824-367`](../eval/runs/RUN-20260824-367.json)。
- 推荐决策：对23个B2输出逐槽双盲评分，并对10个至少有B2结果的案例配对同案例B0；不把31个B0降级槽当作B2模型质量样本。
- 下一步：等待用户接受或修改评测范围；未决策前不生成匿名评分包、不启动人工评分、不运行B1/B3、不判断G1。

## LOG-20260824-139｜T001匿名双盲评分包已生成

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 用户决定：接受`ACCEPT_REVIEW_PLAN`，按推荐范围启动两名评审。
- 变化：为评审A和评审B分别生成独立顺序的33项匿名包；每包包含23个B2有效输出和10个同案例B0配对输出。项目维护者映射表单独保存，未放入评审包。
- 证据：[评审A匿名包](../eval/human-review/T001-B2-blind-reviewer-A-v0.1.json)、[评审B匿名包](../eval/human-review/T001-B2-blind-reviewer-B-v0.1.json)、[评审A评分表](../eval/human-review/T001-B2-blind-score-sheet-A-v0.1.md)、[评审B评分表](../eval/human-review/T001-B2-blind-score-sheet-B-v0.1.md)、[内部映射表](../eval/human-review/T001-B2-scoring-key-v0.1.json)。
- 校验：类型检查通过；匿名包未包含`B2`/`B0`标签、RUN ID、Workflow、模型、案例ID或请求ID；交付系统校验通过。
- 边界：评分包生成不等于评分完成；未收到两名评审评分前，不计算综合质量、B0洞察增量或G1结论。
- 下一步：两名评审分别提交评分表；再执行分歧复核、加权汇总和同案例B0配对分析。

## LOG-20260824-140｜T001匿名评分包补充中文Claim说明

- 元信息：2026-08-24 / v0.1 / ITEM-T001；状态：`IN_PROGRESS`
- 用户反馈：要求在评审包中为各个Claim增加中文描述，帮助评分人理解骑行数据证据含义。
- 变化：匿名包的`evidence.allowedClaims`新增`description`字段，覆盖距离、时间、海拔、速度、心率、功率、标准化功率、踏频及其统计特征；A/B包已重新生成，样本与匿名映射不变。
- 证据：[评审A匿名包](../eval/human-review/T001-B2-blind-reviewer-A-v0.1.json)、[评审B匿名包](../eval/human-review/T001-B2-blind-reviewer-B-v0.1.json)、[生成脚本](../scripts/generate-t001-b2-human-review-pack.ts)。
- 校验：类型检查通过，匿名来源检查通过，`git diff --check`通过，交付系统校验`0 error / 0 warning`。
- 下一步：评审人使用更新后的A/B评分表完成双盲评分；未提交评分前不汇总或判断G1。

## LOG-20260825-141｜T001两名评审完成双盲评分

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户反馈：两名评审已完成评分表。
- 完整性：评审A、B均为33/33项；所有单项维度分差小于2分，无需复核。
- 结果：23个B2有效输出的两人合并加权均值`3.998/5`；事实忠实均值`5.000`，洞察价值`3.609`，行动性`3.000`，易懂性`3.978`，语气`4.000`，不确定性`3.978`。
- 配对结果：10个同案例B2/B0配对的洞察价值差值（B2-B0）两人合并均值`+2.3`；仅作为诊断性增量，不替代G1。
- 硬门/运行边界：两项评审标记的硬门问题来自B0配对样本`ITEM-029/031`，不是B2有效输出；正式批次仍有31/54 B0降级、P95`23541.581ms`，成本`NOT_OBSERVABLE`。
- 证据：[人工评测汇总](../eval/human-review/T001-B2-human-review-result-v0.1.md)、[机器可读结果](../eval/human-review/T001-B2-human-review-result-v0.1.json)、两份匿名评分表。
- 下一步：用户预览汇总并决定先修复运行时/B0能力判断，或设计下一轮受限B2复测；不自动推进G1。

## LOG-20260825-142｜T001 B2运行时与B0能力判断修复切片

- 元信息：2026-08-25 / v0.1 / ITEM-T001-B2；状态：`READY_FOR_PREVIEW`
- 来源审查：`current-status.md`、`RUN-20260824-367`、人工评测汇总、Service v1.5/B0/超时相关实现与测试；采用最小充分审查，未重复读取三份主文档全文。
- 变化：修复旧 B0 对室内传感器-only 记录的过严距离门控；缺少路线距离但存在可靠时间/速度/心率/功率/踏频/爬升事实时进入`basic`并保留可用 Claim。室内仅心率/仅功率 B0 改为展示对应传感器事实。
- 运行时边界：保留`AI_ANALYSIS_TIMEOUT_MS` 15秒上限；首轮超时、修复超时立即 B0，最多两次调用，不新增第三次重试。未以放宽超时掩盖 P95问题。
- 验证：定向测试`42/42 PASS`，`pnpm typecheck PASS`；新增室内心率/功率、修复超时无第三次调用、15秒上限回归。
- 未执行：扣子复测、54槽复测、B1/B3、G1、成本/性能Gate。
- 证据：[ITEM-T001-B2运行时修复](../reviews/ITEM-T001-B2-runtime-remediation-review.md)。
- 下一步：等待用户预览；接受后再决定是否提出独立超时预算调整和新的受限 B2 复测授权。

## LOG-20260825-143｜T001结果文档同步维护

- 元信息：2026-08-25 / v0.1 / 文档维护；状态：`READY_FOR_PREVIEW`
- 变化：修正 `ITEM-T001-eval-migration-review.md` 顶部可变状态和验收摘要；补齐 `eval/benchmark-report.md` 的真实 B2 批次、人工双盲评测和运行时/B0修复摘要；同步 `project-ledger/README.md` 与 `index.md` 的事实源和当前工作项导航。
- 事实边界：历史准备章节保留不改；真实 B2 为 `RUN-20260824-367`、合同回放 `PASS / NOT_SCORED`；人工结果为 `DIAGNOSTIC_ONLY`；B1/B3/G1仍未放行。
- 验证：待本次文档维护完成后运行 `git diff --check`、交付系统校验和文档链接/状态复核。
- 下一步：进入 `ITEM-T001-B2` 运行时修复切片用户预览；未获接受前不调整超时预算、不重新调用扣子。

## LOG-20260825-144｜T001运行时/B0修复与解读质量回归完成

- 元信息：2026-08-25 / v0.1 / ITEM-T001-B2；状态：`READY_FOR_PREVIEW`
- 用户决定：接受运行时超时与 B0 能力判断修复，并要求补齐事实罗列、行动泛化、overall 维度整合回归后再决定受限 B2 复测。
- 变化：Prompt v3.1.2补入四条解读质量规则；输出校验增加非阻断`FEATURE_EVIDENCE_AVAILABLE_NOT_USED`质量警告；回归覆盖无意义解释时事实降级、可用特征未使用、general/grounded行动区分、overall必要维度子集和主题Claim完整性。
- 验证：定向`32/32 PASS`；全量`pnpm verify 196/196 PASS`；`pnpm build PASS`；`git diff --check PASS`；交付系统校验`0 error / 0 warning`。
- 边界：未重新调用扣子，不把本地结果外推为31/54降级率改善；B1/B3、性能/成本Gate和G1仍未运行/未评分。
- 下一步：预览受限 B2 复测最小范围，等待用户单独授权后才执行新的扣子批次。

## LOG-20260825-145｜扣子 Prompt 等价性核对发现四条规则缺失

- 元信息：2026-08-25 / v0.1 / ITEM-T001-B2；状态：`BLOCKED`
- 用户反馈：扣子已发布 `v0.0.1` 的实际 Prompt 只有四条规则的旧有相关表达，缺少本轮新增的四条明确约束。
- 结论：不同措辞本身不必触发版本变更，但本次已确认存在语义规则缺口；若要验证本轮解读质量修复，不能直接用 `v0.0.1` 复测，否则无法验证新增规则。
- 操作边界：保留 `v0.0.1` 作为历史控制版本；用户需在扣子复制/编辑 Prompt 后发布新的测试版本，保持模型、输入合同、输出 Schema、Few-shot 和 Workflow 连接不变。
- 下一步：用户完成新测试版本发布并反馈实际平台版本号及配置截图；随后更新版本矩阵并执行零调用预检，不立即运行54槽。

## LOG-20260825-146｜扣子 v0.0.2 Prompt 同步完成

- 元信息：2026-08-25 / v0.1 / ITEM-T001-B2；状态：`READY_FOR_PREVIEW`
- 用户证据：扣子截图确认新版本`v0.0.2`已发布；`v0.0.1`保留为历史控制版本，四条新增解读质量规则已进入实际 System Prompt。
- 变化：`.env.local`、`.env.example`、API执行器和B2接收协议均切换到平台测试版本`v0.0.2`；内部 Workflow 标签仍为`ride_analysis_v2-dev.15`，超时上限仍为15000ms。
- 边界：本次仅完成版本配置和文档同步，外部调用次数为0；不把发布证据当作模型运行结果，不启动54槽、不运行B1/B3、不判断G1。
- 下一步：执行零调用预检；预检通过后生成受限B2复测范围预览，等待用户另行授权真实调用。

## LOG-20260825-147｜v0.0.2 零调用预检通过与受限范围预览

- 元信息：2026-08-25 / v0.1 / ITEM-T001-B2；状态：`READY_FOR_PREVIEW`
- 预检证据：Workflow `7676429753852018707` / 平台版本 `v0.0.2`；输入集 SHA-256 `5333b4cd4d5aeb21fbada26357381120e3665ffc2c71bda429d5cdce9b2c7671`；源码提交 `dc256faaf3e4bf43d233f2f800b2c85fa0e4b77d`；超时 `15000ms`；PAT `PRESENT_REDACTED`；`externalCalls=0`。
- 范围预览：推荐 `RA-AUTO-001/005/006/010/011/013/018` 各3次，共21槽；其中`RA-AUTO-018#1..#3`必须0调用并走B0，其余6案例各3次可调用，每槽最多一次受限修复。
- 停止条件：版本/输入漂移、权限配额异常、计量证据无法保存或非预期生产调用立即停止；平台不可观测字段继续为`NOT_OBSERVABLE`，性能/成本保持`NOT_SCORED`。
- 下一步：等待用户确认21槽范围；未确认前不启动真实扣子批次。

## LOG-20260825-148｜扣子 v0.0.2 受限 B2 批次完成

- 元信息：2026-08-25 / v0.1 / ITEM-T001-B2；状态：`READY_FOR_PREVIEW`
- 用户决定：确认 `RA-AUTO-001/005/006/010/011/013/018` 各3次及既定停止条件。
- 运行证据：[原始批次](../eval/runs/RUN-20260825-756-raw.json)、[回放结果](../eval/runs/RUN-20260825-756.json)；Workflow `7676429753852018707` / 平台 `v0.0.2` / 源码提交 `c3e8c34afd7ce298446f36ff8cb4fc825a673f9f`。
- 结果：21/21 槽接收与回放 `PASS`；B2 `7`、B0 `14`、安全停止 `0`；Provider 调用 `21`；总 Token `101712`；P50/P95=`15002.545/20334.534ms`；成本 `NOT_OBSERVABLE`。
- 边界：`RA-AUTO-018#1..#3` 严格0调用；本轮为受限样本，不外推完整54槽降级率，不生成质量分数、不运行B1/B3、不判断G1。
- 下一步：用户预览原始输出和回放，再决定人工复评、扩大样本或保持当前 Demo 边界。

## LOG-20260825-149｜Prompt v3.1.2 Compact Candidate 生成与输出评估

- 元信息：2026-08-25 / v0.1 / Prompt优化候选；状态：`CANDIDATE_NOT_DEPLOYED`
- 变化：新增 `cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md`，保留角色、可信边界、四条质量规则、生成方法、安全边界、输出合同和User Prompt结构；未覆盖现有 v3.1.2，未同步扣子。
- 长度：14,147字节/92行压缩为8,394字节/82行，约减少40.7%；压缩来自同义边界合并，不删除安全规则或产品限制。
- 输出评估：`RUN-20260825-756`的21/21合同回放通过；7个成功B2输出平均JSON约1,390字符，主要可优化为overall与dimensions的最小Claim集合、短句和必要limitations；不建议修改output-v0.3字段合同。
- 验证：`git diff --check`通过；交付系统校验`0 error / 0 warning`；本次无模型调用。
- 下一步：同一7个受限案例、同模型、同输入、同超时预算执行候选A/B；质量不下降且超时/修复率有改善后，才考虑发布新的扣子测试版本。

## LOG-20260825-150｜Prompt A/B 实验合同与执行入口预览

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 来源审查：`current-status.md` 当前工作项、`DEC-060/061/062/067`、研发指南 Prompt/评测/模型章节、路线图 T1/B2/G1；采用最小充分审查，未重复读取三份主文档全文。
- 变化：新增 [`t001-prompt-ab-manifest-v0.1`](../eval/t001-prompt-ab-manifest-v0.1.json)；执行器支持显式 `--arm=A|B`，A 固定绑定扣子 `v0.0.2`，B 必须显式提供新 Workflow 名称/ID/平台版本；新增机器指标比较脚本和 Claim 引用层统计。
- A 基线：复用 `RUN-20260825-756`，不重新调用；B 目标为同一7案例×3次=21槽，同一输入摘要、模型和 `15000ms` 超时，串行执行，每槽最多一次修复，`RA-AUTO-018`严格0调用。
- 验证：`pnpm verify` `197/197 PASS`；未执行 B 预检或真实 B 调用。
- 边界：人工可读性、洞察价值和行动区分在 B 完成后通过两名评审匿名盲评；本切片不优化输出字段、不修改现有 Prompt、不判断 G1或性能/成本Gate。
- 下一步：用户在扣子复制/发布 Compact Candidate 测试版本并反馈 Workflow 名称、ID和平台版本；随后先运行 `--arm=B --preflight` 零调用预检，再请求启动21槽真实 B 批次。

## LOG-20260825-151｜Prompt A/B B臂测试版本与零调用预检

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户证据：扣子截图确认 B 为 `ride_analysis_v2_Cam_Candidate` / Workflow ID `7677880281836503082` / 平台版本 `v0.0.1`；模型显示名“豆包·2.0-lite”、Chat API、最大回复长度 `2400`、深度思考关闭。
- 预检：`arm=B`、候选 Prompt 资产存在、输入集 SHA-256 `5333b4cd...2c7671`、超时 `15000ms`、源码提交 `535234d`、`externalCalls=0`；没有发起模型调用。
- 边界：截图只能确认显示配置与 A 对齐，精确Provider模型ID仍为`NOT_OBSERVABLE`；未运行 B 21槽、不生成质量或可读性结论。
- 下一步：等待用户确认启动 B 的 `7案例×3次=21槽` 串行真实批次；确认后保留逐槽请求/尝试/Token/原始输出，随后本地回放并与 A 基线比较。

## LOG-20260825-152｜Prompt A/B B臂真实批次与匿名评审包

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户决定：确认启动 B 的21槽真实批次。
- 运行证据：B 原始批次[`RUN-20260825-960-raw.json`](../eval/runs/RUN-20260825-960-raw.json)，回放[`RUN-20260825-960.json`](../eval/runs/RUN-20260825-960.json)；`validationStatus=PASS`、21/21槽、安全停止0、`RA-AUTO-018#1..#3`严格0调用。
- B结果：B2 `2/21`、B0 `19/21`、首轮合同成功0、修复触发8、修复成功2、Provider调用26、总Token111825、P50/P95=`15008.962/24975.913ms`、成本`NOT_OBSERVABLE`。
- A/B机器比较：[`T001-PROMPT-AB-comparison-v0.1.json`](../eval/runs/T001-PROMPT-AB-comparison-v0.1.json)；B相对A的B2成功率下降23.81个百分点，超时槽位率上升4.76个百分点，修复触发率上升23.81个百分点，B0降级率上升23.81个百分点，调用增加5、Token增加10113；两组有效B2输出均无未知Claim引用。
- 人工评测：已生成21个同槽匿名配对样本的A/B盲评包，两名评审分别独立打乱变体顺序；人工可读性、洞察价值和行动区分仍未评分。
- 下一步：两名评审填写[`T001-PROMPT-AB-blind-score-sheet-A/B-v0.1`](../eval/human-review/)，完成后汇总分歧和可读性结果；在此之前不保留 B、不替换 A、不判断G1。

## LOG-20260825-153｜Prompt A/B 人工评审完成与候选归档

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户反馈：两名评审已完成 A/B 匿名评分表。
- 完整性：评审A、B均为 `21/21`；硬门备注 `0`；分数分歧达到2分 `3` 项。
- 结果：A/B均值（事实忠实/洞察价值/行动性/易懂性/语气/不确定性）分别为 A `4.405/2.214/3.000/3.976/4.000/4.071`，B `4.310/2.000/3.000/4.000/4.000/4.071`；更易读偏好 A/B/相同=`7/5/30`。
- 结论：Compact Candidate没有抵消其 B2成功率下降（`2/21` vs A `7/21`）和B0降级率上升（`19/21` vs A `14/21`）；B作为失败学习证据归档，不发布、不接入、不替换A，不判断G1。
- 证据：[人工结果](../eval/human-review/T001-PROMPT-AB-human-review-result-v0.1.md)、[机器比较](../eval/runs/T001-PROMPT-AB-comparison-v0.1.json)、[A/B评审](../reviews/ITEM-T001-prompt-ab-preview-review.md)。
- 下一步：记录B候选失败原因，明确下一轮候选是否需要先解决运行时超时/修复退化；不直接继续压缩Prompt或扩大批次。

## LOG-20260825-154｜原版Prompt保留与运行时可靠性恢复预览

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户决定：继续使用原版 Prompt `v3.1.2`；Compact Candidate 归档为失败学习证据，不发布、不接入、不替换。
- 已有证据：A `RUN-20260825-756` 为 B2 `7/21`、B0 `14/21`；B `RUN-20260825-960` 为 B2 `2/21`、B0 `19/21`；人工洞察价值 A/B=`2.214/2.000`。A/B均未发现未知Claim引用，但该指标不等同于语义完整性。
- 诊断观察：超时集中在`RA-AUTO-006/011/013`等案例；当前传给扣子的`analysis_context`包含`allowedClaims`之外的完整`recordedMetrics`、`derivedMetrics`、`estimatedMetrics`、`featureSnapshot`、能力对象和历史快照，存在与Claim重复的输入载荷。相关案例输入约`19,918–29,084`字符；仅作相关性观察，不宣称因果。
- 下一项：新增独立的模型传输投影层预览。保持上下文本体、Prompt、Schema、模型、Workflow、Few-shot、`15000ms`超时和B0规则不变；先做18条输入的原Context/投影Context等价性测试和零调用字节摘要，再申请小范围扣子复测。
- 非目标：不修改原版Prompt，不优化输出Schema，不扩大到54槽，不重新运行A/B，不判断G1或性能/成本Gate。

## LOG-20260825-155｜原版Prompt输入投影4槽受限复测完成

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户决定：接受`RA-AUTO-001/006/011/018`各1次的4槽受限范围；`018`必须0调用，前三槽各最多首次生成加一次受限修复。
- 实现与验证：新增模型传输投影，18条Claim/限制/安全/隐私/版本/eligibility等价性验证通过；上下文总字节减少`59.94%`；本地`201/201 PASS`，冻结提交`68e1f70ac6fefa998ab540618c64b4239aba0ba5`。
- 真实结果：[`RUN-20260825-918`](../eval/runs/RUN-20260825-918.json)为4/4回放PASS，B2 `1`、B0 `3`、超时`2`、修复`0`、调用`3`、Token `6099`、安全停止`0`；`018`严格0调用。
- 比较结论：相对投影前同一4个`#1`槽，B2/B0、超时和修复结果均未变化；Claim硬合同完整。投影减少载荷但未恢复`006/011`的15秒可靠性，不扩大复测、不做人评、不判断G1。
- 下一步：预览15秒同步调用策略的处置选项；不继续压缩Prompt或重复输入投影实验。

## LOG-20260825-156｜T001同步等待预算调整为25秒

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 用户决定：不再比较15秒保持、延长等待和异步生成三种策略，直接将 Demo 服务端同步等待上限从`15000ms`延长至`25000ms`。
- 实施：`CozeWorkflowClient`超时上限、`.env.example`和本机`.env.local`已同步为`25000`；配置测试断言已更新；扣子未重新调用。
- 保持：Prompt v3.1.2、输入投影v0.1、Schema、模型、Workflow、Few-shot disabled、一次受限修复、B0规则和分层计量合同不变；历史15秒运行证据原样保留。
- 边界：25秒仅为当前Demo同步等待预算，不是G1的端到端P95 8秒目标，不解除性能/成本`NOT_SCORED`，不代表生产就绪。
- 下一步：先完成本地验证；后续如需扣子复测，另行确认受限槽位和调用授权，不自动扩大至54槽。

## LOG-20260825-157｜T001 25秒受限可靠性复测范围预览

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 来源审查：`current-status.md`、`DEC-069`、`RUN-20260825-918`、T001运行接收合同和当前执行器；采用最小充分审查，未全文重读三份主文档。
- 实施：执行器新增显式`--timeout-ms=15000|25000`；默认15秒保持历史A/B可复现，25秒批次不写入Prompt A/B实验元数据；本地未调用扣子。
- 预览范围：`RA-AUTO-001/006/011/018`各1次，共4槽；前三槽最多首次生成+一次受限修复，`018`严格0 Provider调用。
- 停止条件：配置/输入/证据漂移、权限配额异常、无法保存逐槽证据、`018`发生调用或安全停止，立即停止剩余槽位；不扩大到21/54槽，不做人评，不判断G1。
- 下一步：等待用户确认范围；确认后先提交当前冻结实现，再执行`--arm=A --scope=restricted --timeout-ms=25000 --preflight`零调用预检，预检通过后另行请求真实调用授权。

## LOG-20260825-158｜T001 25秒同步等待受限可靠性复测完成

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`READY_FOR_PREVIEW`
- 冻结：源码提交`56acf9230f7cfb30713eb0eaf826385b6483763d`；Prompt`3.1.2`、Workflow`7676429753852018707/v0.0.2`、输入摘要`5333b4cd...2c767`、Few-shot disabled、超时`25000ms`。
- 预检：零调用预检`PASS`，4槽范围与配置一致，`externalCalls=0`。
- 运行证据：原始批次[`RUN-20260825-510-raw.json`](../eval/runs/RUN-20260825-510-raw.json)，回放[`RUN-20260825-510.json`](../eval/runs/RUN-20260825-510.json)；4/4回放`PASS`、`benchmarkStatus=NOT_SCORED`。
- 结果：B2`3/4`、B0`1/4`、首轮合同通过`1`、修复成功`2`、Provider调用`5`、总Token`40865`、安全停止`0`、P50/P95=`11643.478/34591.961ms`；`RA-AUTO-018`严格0调用。
- 对照：与同四槽15秒`RUN-20260825-918`相比，B2`1/4→3/4`、B0`3/4→1/4`，但P95进入修复长尾；不外推21/54槽，不做人评、不评分性能/成本、不判断G1。
- 下一步：用户预览逐槽输出和对照结果，决定保持当前Demo边界或另行批准更大样本/异步性能专项。

## LOG-20260825-159｜T001保持Demo边界

- 元信息：2026-08-25 / v0.1 / ITEM-T001；状态：`ACCEPTED`（保持Demo边界）
- 用户决定：保持当前 Demo 边界，继续使用原版 Prompt `v3.1.2`、扣子 `v0.0.2`、输入投影 `v0.1` 和`25000ms`同步等待。
- 不做：不扩大到21/54槽，不启动异步生成或性能专项，不修改历史15秒证据，不判断G1或生产就绪。
- 依据：`RUN-20260825-510`同四槽B2`3/4`，但P95=`34591.961ms`；性能/成本仍为`NOT_SCORED`。
- 下一步：在Demo边界内收集真实用户预览反馈；只有出现明确性能/成本需求、完整平台计量字段或进入G1评审，才重新评估运行策略。
