# RIDE-AI-KB-01 知识库来源调研报告

- 任务：`RIDE-AI-KB-01` · 知识库首批内容选型与冻结（独立产品决策任务，最迟在 `RIDE-AI-S6-01` 启动前冻结）
- 调研时间：2026-10-05
- 调研方式：三本书籍（两本英文电子版全文抽取比对 + 一本中文扫描版逐页识别）+ TrainingPeaks 官网 19 篇文章逐一抓取评估 + UCI 官网及 cycling-science.com 栏目排查
- 排除决定（用户，2026-10-05）：《IOC 公路自行车手册》（2000）与 TP 骑行营养文（Hexis 产品推广）不使用，已从候选来源中移除；UCI 装备标准首批不纳入
- 状态：首批 8 条知识条目已起草（版本 `ride-kb-batch1-1.0.0`，五主题），通过 S3-02 合同校验，待用户验收冻结

---

## 1. 结论摘要

| 类别 | 推荐来源 | 评估 |
|---|---|---|
| 骑行数据标准 | TrainingPeaks 术语表 + Coggan 两篇原理文章 + 功率区间 + 阈值测试 | 权威闭环，最强来源 |
| 骑行运动科学 | 《Cycling Science》(2017) 相关章节 + San Millán 两篇 + Friel 过度训练 | 覆盖完整 |
| 训练方法论与中文解释 | 《公路车宝典》(2023 中译本，Friel) + TP 百英里指南 + 周期化 + Zone 2 + 心率漂移 | 中文主力来源 |
| 营养 | 《Cycling Science》第 15-17 章 | 够用 |
| 骑行装备标准 | UCI 官网 | **首批暂缓**，待产品定位明确 |

首批建议聚焦五个主题：指标定义、功率区间、训练负荷/PMC、恢复、心率漂移（详见第 6 节）。

---

## 2. 调研范围与方法

- **书籍**：用户提供两本 PDF，逐本提取出版信息、目录、样章正文，并按项目解读维度关键词（functional threshold / threshold power / normalized power / training stress / training load / critical power 等）全书扫描页级命中；其中《Cycling Science》(2017) 选为主力来源，《IOC 公路自行车手册》(2000) 经评估按用户决定不采用。
- **网站**：TrainingPeaks（trainingpeaks.com）博客与学习栏目共评估 19 篇（用户整理 9 篇 + 主动挖掘 10 篇）；UCI（uci.org）从官网入口排查训练科学与装备标准栏目。
- **评估标准**（对齐 S3-02 知识合同字段）：可精确定位引用（citationLocation）、来源可靠（sourceType/publisher）、覆盖项目解读维度（applicableDimensions）、结论强度与局限可标注（conclusionStrength/limitations）。

---

## 3. 候选来源评估

### 3.1 《Cycling Science》（2017）—— 骑行运动科学主力来源

- 出版：Human Kinetics，2017；主编 Stephen S. Cheung & Mikel Zabala；569 页、40 章、9 大部分；40 位领域专家分章撰写。
- 关键词命中：threshold power 23 页、training load 26 页、functional threshold 17 页、critical power 10 页、normalized power 2 页。
- 与解读维度直接对应的章节：

| 解读维度 | 章节 |
|---|---|
| 功率输出 / FTP / 体能评估 | 第 26 章 Assessing Cycling Fitness；第 29 章 Using a Power Meter（Hunter Allen） |
| 训练负荷 / 训练计划 | 第 27 章 Designing Training Programs（Laursen/Plews） |
| 疲劳与过度训练 | 第 21 章 Fatigue and Overtraining |
| 恢复 | 第 22 章 Recovery Interventions（Halson） |
| 爬坡 | 第 14 章 Tackling the Hills |
| 配速 | 第 35 章 The Science of Pacing |
| 数据管理 | 第 30 章 Data Management for Cyclists（Friel） |

- 优点：受控出版的学术教科书；章节可精确定位引用；2017 年版本较新；证据导向。
- 局限：不含 ACWR（急慢性负荷比）表述；部分领域 9 年内已有新进展，引用时逐条标注"2017"版本号。

### 3.2 《公路车宝典：骑行训练完全手册（第5版）》(2023 中译本) —— 训练方法论与中文解释主力来源

- 出版：人民邮电出版社，2023 年 8 月，潘震译；原著 Joe Friel《The Cyclist's Training Bible》第 5 版（©2018，Velopress）；正规授权翻译（ISBN 978-7-115-60476-7，版权合同登记 图字 01-2020-0634）；271 页、6 部分 14 章 + 附录；用户提供扫描版（无文字层，逐页识别目录评估）。
- 作者权威性：Joe Friel 为世界顶级耐力训练教练、TrainingPeaks 体系联合创始顾问；已选用的 TP 文章中"区间设定法"与"过度训练判断"两篇即出自其手。
- 与解读维度的对应：

| 解读维度 | 章节 |
|---|---|
| FTP / 训练区间 / TSS | 第 4 章 训练强度（功能阈、设置训练区间、训练压力分数） |
| 训练负荷 / 体能·疲劳·状态 | 第 3 章 训练的基本概念 |
| 疲劳 / 过度训练 / 恢复 | 第 10 章 训练压力 + 第 11 章 疲劳、恢复与适应 |
| 周期化 / 赛季规划 | 第 7-9 章（年度计划、周规划、周期模型） |
| 减量备赛 | 第 13 章 为比赛减量 |
| 训练数据分析 | 第 14 章 训练日记 |

- 三大优点：① **中文来源**——知识条目中文解释可直接参考母语表述，引用展示对中文用户友好，弥补其余来源全英文的缺陷；② 版本新（原著 2018 第 5 版彻底重写，比《Cycling Science》2017 更新）；③ 口径兼容——Friel 与 Coggan 指标体系同源（同属 TrainingPeaks 体系），与"术语表唯一基准"规则不冲突。
- 使用规则：指标定义仍以 TP 术语表为唯一基准，本书作为中文解释与训练方法论的权威来源；中译术语在知识条目中固定中英对照（功能阈=FTP、训练压力分数=TSS、状态=Form/TSB），避免同一概念两个名字。
- 分工：与《Cycling Science》(2017) 并列主力——书 2 管运动科学深度，本书管训练方法论与中文表述。

### 3.3 TrainingPeaks 文章 —— 骑行数据标准主力来源

#### 3.3.1 用户整理的 8 篇（已剔除营养文）

| # | 文章 | 作者/日期 | 评价 |
|---|---|---|---|
| 1 | [终极百英里训练指南](https://www.trainingpeaks.com/guides/century-training/) | TP 官方 | 适合——系统训练框架，归训练方法论 |
| 2 | [身体、心理和社会恢复](https://www.trainingpeaks.com/blog/why-athletes-need-physical-mental-and-social-recovery/) | Phil White，2026-09 | 适合——恢复主题有研究支撑 |
| 3 | [指标术语表](https://trainingpeaks.com/learn/articles/glossary-of-trainingpeaks-metrics/) | TP 官方 | **最适合**——TSS/IF/FTP/NP/CTL/ATL/TSB/VI/EF 等全部指标权威定义源 |
| 4 | [指标简介（一）](https://www.trainingpeaks.com/learn/articles/an-introduction-to-trainingpeaks-metrics/) | TP 官方，2019 | 适合——入门讲解 |
| 5 | [指标简介（二）](https://www.trainingpeaks.com/blog/an-introduction-to-more-trainingpeaks-metrics-part-two/) | Dave Schell，2017 | 适合——VI/EF/有氧解耦等进阶指标唯一系统来源 |
| 6 | [功率训练区间](https://www.trainingpeaks.com/blog/power-training-levels/) | **Dr. Coggan**（FTP/NP 体系创始人），2016 | **最适合**——7 级功率区间原作者执笔 |
| 7 | [乳酸阈值详解](https://www.trainingpeaks.com/learn/articles/thresholds-411/) | TP 官方，2008 | 适合 |
| 8 | [阈值测试](https://www.trainingpeaks.com/blog/threshold-tests-for-swim-bike-and-run/) | Dave Schell，2018 | 适合——20/30 分钟测试等具体协议 |

#### 3.3.2 主动挖掘的 10 篇（按价值排序）

| # | 文章 | 作者 | 价值 |
|---|---|---|---|
| 1 | [The Science of the Performance Manager](https://trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/) | **Coggan** | CTL/ATL/TSB 学术论证（Banister 冲量-响应模型），含文献 |
| 2 | [NP、IF 与 TSS 详解](https://trainingpeaks.com/learn/articles/normalized-power-intensity-factor-training-stress/) | **Coggan**，2016 | 三大指标第一手定义、典型 IF 值、TSS 疲劳分级表 |
| 3 | [Zone 2 Training](https://trainingpeaks.com/blog/zone-2-training-for-endurance-athletes/) | San Millán 博士 | 顶级运动科学家（环法车队教练）执笔，有氧基础生理机制 |
| 4 | [乳酸与乳酸阈值](https://trainingpeaks.com/blog/what-is-lactate-and-lactate-threshold/) | San Millán | 乳酸穿梭理论深度背景 |
| 5 | [有氧解耦（心率漂移）使用指南](https://www.trainingpeaks.com/blog/how-to-use-aerobic-decoupling/) | Kyle Wolfe（USAC L1 教练） | Pw:Hr 解读，知识库空缺主题 |
| 6 | [如何判断过度训练](https://www.trainingpeaks.com/blog/how-to-know-if-you-are-overtraining/) | Joe Friel | 过度训练四大标志 |
| 7 | [FTP 的生理学与新测试协议](https://www.trainingpeaks.com/blog/the-physiology-of-ftp-and-new-testing-protocols/) | Kolie Moore，2018 | FTP 与 MLSS、20 分钟测试局限（批判视角） |
| 8 | [Friel 区间设定快速指南](https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/) | Joe Friel | 30 分钟 TT 区间设定标准方法 |
| 9 | [周期化三周期](https://www.trainingpeaks.com/blog/macrocycles-mesocycles-and-microcycles-understanding-the-3-cycles-of-periodization/) | Tyrone Holmes | 周期化主题空缺 |
| 10 | [PMC 图表使用指南](https://trainingpeaks.com/learn/articles/what-is-the-performance-management-chart/) | TP 官方 | Fitness/Fatigue/Form 官方使用指南 |

- **口径统一规则**：#3 术语表为所有指标定义的唯一基准来源；#4/#5/#7 与术语表主题重叠，仅按主题补充引用，避免同一概念两个出处、口径不一。
- 版权说明：知识条目形式为"引用出处 + 自撰中文简短解释"，不复制原文；TrainingPeaks 为商业内容，演示用途低风险，KB-01 冻结时按合同逐条确认版权范围。

### 3.4 UCI 官网 —— 首批暂缓

- 排查结论：**无训练科学内容**（官网以赛事/新闻/治理为主）；装备技术标准丰富但属"管理机构规章"而非训练知识。
- 可用资源（已验证可访问）：[装备认证栏目](https://www.uci.org/equipment/bh2JJzw1eB0n876rX2iB1)（Clarification Guide 2026/2027、车架/轮组认证清单）、[2025 装备规程修订声明](https://www.uci.org/pressrelease/uci-statement-on-its-recent-decisions-regarding-changes-to-equipment/39bHGV3T3d3sNHKNe2Rvbx)（车把最小宽 400mm、轮圈限高 65mm 等）、[车架认证标签解读](https://www.uci.org/article/uci-frameset-approval-whats-in-a-sticker/5wPo5xaoH6uaJYAx6xQubP)、[场地车速度科学](https://www.uci.org/article/the-science-of-track-speed/5M2rrXZUZfOuGsiyh6j9vU)。
- 建议：**首批不纳入（用户 2026-10-05 确认）**，聚焦训练解读主线；若未来产品加装备解读（如"你的车合规吗"），UCI 是唯一权威来源，届时再扩充。

### 3.5 未来候选来源：《Routledge Handbook of Cycling Science》—— 出版后升级用（暂不可引用）

- 排查日期：2026-10-05；来源：cycling-science.com/handbook。
- 出版信息：Routledge，主编 Richard Davison & Arthur Henrique Bossi，43 章 / 550 页 / 9 部分，**2026-11-17 出版**（预售 2026-10-27 开始），当前无法引用。
- 价值：目录与知识库需求高度重合——功率测量与训练（作者含 SRM 功率计发明人 Uli Schoberer）、训练区间、心率训练、训练负荷监控、爬坡、配速、临界功率（Burnley/Jones）；出版后比《Cycling Science》(2017) 更新、覆盖更全，且各章明确标注证据强度与未定论领域，与 S3-02 合同的 conclusionStrength/limitations 理念一致。
- 处理：首批不纳入；出版后若项目仍需扩充知识库，优先评估替换/补充现有来源。
- 同站其他资源：博客/播客（Davison 教授研究评论）免费可看但主题偏窄，不入首批；站内订阅制"Knowledge Base"尚未上线，无法访问。

---

## 4. 类别匹配矩阵

| 类别 | 来源 | 强度 |
|---|---|---|
| 骑行数据标准 | TP #3 术语表（定义基准）+ Coggan×2（原理）+ #6 功率区间 + #8 阈值测试 + #5 进阶指标 | 强 |
| 骑行运动科学 | 《Cycling Science》第 14/21/22/26/27/29/30/35 章 + San Millán×2 + Friel 过度训练 | 强 |
| 训练方法论 | 《公路车宝典》(2023 中译本) 为主力 + TP 百英里指南 + 周期化 + Zone 2 + 有氧解耦 + PMC 使用指南 | 中→高（新增中文主力来源后提升） |
| 营养 | 《Cycling Science》第 15-17 章 | 中 |
| 装备标准 | UCI（暂缓） | — |

---

## 5. 风险与注意事项

1. **版权**：书籍与文章均为商业版权内容；知识条目只引用结论 + 标注出处 + 自撰解释，不复制原文。
2. **中英文来源并存**：《公路车宝典》(2023 中译本) 加入后，训练方法论类条目可全中文引用展示；数据标准与运动科学类条目仍为英文来源，explanation 用中文撰写并注明英文出处，符合 S3-02 合同。
3. **时效标注**：《Cycling Science》(2017) 与各文章逐条标注首发年份；乳酸阈值详解一文为 2008 年首发，阈值相关结论优先引用更新的来源。
4. **口径统一**：指标定义以 TP 术语表为唯一基准；同一概念禁止多出处不同口径。
5. **知识边界**（项目硬约束）：知识只用于解释、绝不冒充骑行数据；缺知识不伪造出处；`forbiddenFactKeys` 逐条配置，防止知识结论被写成用户当日骑行事实。

---

## 6. 待用户决策事项

1. ~~**首批条目主题与数量**~~：已决策——用户 2026-10-05 确认"按建议起草"；首批 8 条已交付（TSS、FTP、功率区间、PMC、Friel 体能-疲劳、恢复、心率漂移、过度训练），见 `src/domain/ride-knowledge-base-batch1-v2.ts`。
2. ~~**UCI 装备标准是否纳入**~~：已决策——用户 2026-10-05 确认首批不纳入。
3. **当前待办**：用户验收首批 8 条后冻结（版本 `ride-kb-batch1-1.0.0`），`RIDE-AI-S6-01` 方可启动。
