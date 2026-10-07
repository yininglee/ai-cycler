// V2.1 骑行运动科学知识库（7 维度四段式）。
// 替换 batch1（ride-knowledge-base-batch1-v2.ts，版本 ride-kb-batch1-1.0.0，
// 现转只读归档）。内容来源：doc_V2.1/cycling_science_knowledge_base.md
// （整理依据 TrainingPeaks / Allen & Coggan《Training and Racing with a Power
// Meter》/ Joe Friel 心率区间体系 / 骑行运动科学公开文献）。
//
// 四段式（设计文档 §5）：
//   ① 指标定义   -> 驱动 MetricSpec（见 ride-derived-metric-spec-v21.ts），不进模型
//   ② 基准分级   -> explanation 的可引用正文（模型只能照转述，不能改数字）
//   ③ 解读逻辑   -> interpretationSignals（结构化 ✅/⚠️，供 supports/prohibits 与 Prompt 软引导）
//   ④ 运动科学依据 -> explanation 的主干
//
// 知识只解释"如何通常解读"，永不生成或替代用户的个人骑行事实（知识 ≠ 事实）。

import type { AnalysisDimensionId } from "./ride-analysis-evidence-v2.ts";
import type { KnowledgeBaseEntryV2 } from "./ride-analysis-knowledge-v2.ts";

export const RIDE_KNOWLEDGE_BASE_V21_VERSION = "ride-kb-2.1.0" as const;

export interface KnowledgeInterpretationSignalsV21 {
  // ✅ 良好信号（可支撑"做得对/表现好"类解读方向）。
  good: string[];
  // ⚠️ 问题信号（提示"可能存在问题的解读方向"）。
  bad: string[];
}

export interface KnowledgeBaseEntryV21 extends KnowledgeBaseEntryV2 {
  // 维度化知识：每条 1:1 对应一个解读维度（batch1 用 applicableDimensions 打散）。
  dimensionId: AnalysisDimensionId;
  // ③ 解读逻辑（结构化信号，供校验器 supports/prohibits 与 Prompt 软引导消费）。
  interpretationSignals: KnowledgeInterpretationSignalsV21;
}

const KB_SOURCE = "TrainingPeaks / Allen & Coggan / Joe Friel / 骑行运动科学公开文献";
const KB_VERSION = "整理自骑行运动科学知识库 v1.0";

export const rideKnowledgeBaseV21: KnowledgeBaseEntryV21[] = [
  {
    knowledgeId: "kb-v21-pacingExecution",
    dimensionId: "pacingExecution",
    category: "cyclingSportsScience",
    topic: "配速执行：变速系数、分段功率与负分割",
    title: "配速执行维度知识（The Science of Pacing 与公开文献整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §1 配速执行",
    applicableDimensions: ["pacingExecution"],
    applicableConditions: ["功率数据完整的骑行记录", "解读配速分配、停歇与分段表现时"],
    conclusionStrength: "moderate",
    limitations: [
      "负分割与配速策略存在个体差异，理想配速随地形、风向与体能动态调整",
      "前半/后半功率差需以 NP 而非平均功率为口径，受滑行与停歇影响",
    ],
    safetyBoundaries: [],
    forbiddenFactKeys: [
      "pacing.variabilityIndex", "pacing.splitDifference", "pacing.negativeSplit",
      "pacing.stoppedTimeShare", "pacing.climbDescentPowerRatio", "power.np", "power.mean",
    ],
    explanation:
      "配速执行考察功率、速度或心率随时间的分布质量。理想配速不是恒定功率，而是按地形与体能动态调整的“生理恒速”——保持恒定的生理消耗而非恒定机械输出。变速系数（VI = NP / 平均功率）衡量功率波动程度：VI 1.00–1.05 非常稳定（计时赛/室内）、1.05–1.15 正常户外起伏、1.15–1.25 波动较大（含爬坡/拉扯）、>1.25 波动剧烈（比赛/大量间歇）。负分割（后半程是否更强）分级：后半程比前半高 2–5% 为理想负分割（耐力骑行/长距离）、前后差 ±2% 以内为匀速配速、前半比后半高 >5% 为正分割（前快后崩、过早发力）。运动科学依据：上坡时空气阻力下降、重力阻力上升，每瓦功率节省的时间更多，因此上坡多输出、下坡少输出能在相同平均功率下缩短用时（地形自适应配速，研究提示可提升约 2–3%）；长距离骑行（>2h）前半程保守 5–10W、后半程提升可避免早期糖原耗竭；心率对功率变化有 20–30 秒滞后，故功率是配速控制的首选即时指标，心率用于验证生理负荷。",
    interpretationSignals: {
      good: [
        "地形自适应配速：爬坡段功率略升、平路/下坡段略降（坡度 +1% → 功率 +3–5%）",
        "长距离骑行后半程功率下降 ≤3%（同心率下）",
        "VI 与地形复杂度匹配（平路 VI 低、山路 VI 高）",
        "前 20 分钟功率不超过计划目标的 105%",
      ],
      bad: [
        "前 15–30 分钟功率显著高于全程均值（“肾上腺素开局”）",
        "爬坡时功率 spike 过大（>20% 目标 W/kg），下坡时完全松脚",
        "长距离骑行后半程功率衰减 >10%（同心率下）",
        "停歇次数多、单次停歇时间长（>5 分钟/次），提示补给或节奏管理差",
      ],
    },
  },
  {
    knowledgeId: "kb-v21-climbPerformance",
    dimensionId: "climbPerformance",
    category: "cyclingSportsScience",
    topic: "爬坡表现：功率体重比、VAM 与坡度功率匹配",
    title: "爬坡表现维度知识（Tackling the Hills 与功率分解理论整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §2 爬坡表现",
    applicableDimensions: ["climbPerformance"],
    applicableConditions: ["海拔/地形与功率数据完整的骑行记录", "解读爬坡与地形分段表现时"],
    conclusionStrength: "high",
    limitations: [
      "FTP W/kg 分级为男性参考，女性与年龄组存在差异",
      "VAM 受坡度、风向与路况影响，同坡度下比较才有意义",
    ],
    safetyBoundaries: [],
    forbiddenFactKeys: [
      "climb.wkg", "climb.vam", "climb.gradePowerMatch", "climb.powerDecay",
      "climb.effectiveElevationGain", "power.mean", "profile.weightKg",
    ],
    explanation:
      "爬坡表现由功率体重比（W/kg）主导：坡度 >6% 时重力阻力远大于空气与滚动阻力，W/kg 是预测爬坡速度的最佳单一指标。FTP W/kg 骑手分级（男性参考）：2.0–2.8 新手/休闲、2.8–3.5 经常训练、3.5–4.2 业余强手、4.0–4.5 Cat 3–2、4.5–5.5 Cat 1–精英业余、5.5–6.0 Pro 洲际队、6.0–6.5+ World Tour 爬坡手。VAM（垂直爬升速率，米/小时 = 爬升高度 / 时间 × 3600）参考：休闲 500–800、训练有素 800–1200、业余竞赛 1200–1600、职业 1600–2000+（短陡坡）。运动科学依据：总功率 = 重力功率 + 空气阻力功率 + 滚动阻力功率 + 加速功率，坡度 >6% 时重力功率占比 >80%；在恒定 W/kg 下爬坡速度与坡度成反比，每 +1% 坡度速度约下降 10–12%；低踏频爬坡更多募集 II 型快肌纤维、疲劳更快，高踏频（>90 RPM）更多依赖 I 型慢肌、耐力更好但心血管成本更高。",
    interpretationSignals: {
      good: [
        "不同坡度段 W/kg 一致性高（变异系数 <10%）",
        "长爬坡（>10min）后半段 W/kg 衰减 ≤5%",
        "爬坡踏频保持在 70–90 RPM，不出现过度碾车（<60 RPM）",
        "VAM 与 W/kg 匹配（同坡度下 VAM 稳定）",
      ],
      bad: [
        "陡坡 W/kg 远低于缓坡（提示齿比选择或踏频策略问题）",
        "长爬坡中后段功率骤降 >15%（有氧耐力不足或补给不足）",
        "爬坡踏频持续 <60 RPM（过度依赖股四头肌大力量，疲劳快）",
        "爬坡心率飙升但功率上不去（已超阈值，糖原主导供能）",
      ],
    },
  },
  {
    knowledgeId: "kb-v21-heartRateLoad",
    dimensionId: "heartRateLoad",
    category: "cyclingSportsScience",
    topic: "心率负荷：LTHR 分区、心率漂移与效率因子",
    title: "心率负荷维度知识（Joe Friel 心率区间体系与心率漂移研究整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §3 心率负荷",
    applicableDimensions: ["heartRateLoad"],
    applicableConditions: ["心率数据完整的骑行记录", "解读心率水平、分布与变化时", "区间基准以 Claim 标注为准：资料有 LTHR 用 LTHR 5 区，否则用 maxHR 5 区（当前代码默认 maxHR）"],
    conclusionStrength: "moderate",
    limitations: [
      "心率本身不直接代表强度，受温度、脱水、咖啡因与睡眠影响",
      "心率区间分级保留 maxHR 与 LTHR 两套基准；当前计算默认 maxHR 5 区，LTHR 需资料字段（正式阶段接入），两套百分比阈值不同、不可混用",
    ],
    safetyBoundaries: ["本条为运动科学知识，不构成医疗诊断；持续异常心率应咨询医生"],
    forbiddenFactKeys: [
      "heartRate.mean", "heartRate.max", "heartRate.zone", "heartRate.drift",
      "heartRate.efficiencyFactor", "heartRate.recovery", "power.np",
    ],
    explanation:
      "心率是心血管系统对运动负荷的反应，反映“输入侧”生理成本；心率变化趋势与心率-功率关系是评估有氧能力与疲劳状态的重要窗口。心率区间分级有两套基准（用户资料填写了乳酸阈值心率时按 LTHR 分区，未填写时按 maxHR 分区近似；两套百分比阈值不同，同一心率会落入不同区，解读时以 Claim 标注的基准为准，不可混用）。maxHR 5 区（以最大心率为 100%，当前默认口径）——Z1 50–60% 恢复区、Z2 60–70% 有氧基础区、Z3 70–80% 节奏耐力区、Z4 80–90% 阈值区、Z5 90–100% 极限无氧区；解读要点：Z1/Z2 占比高提示有氧效率与耐力储备好，长时间停留在 Z3 会显著累积疲劳、是长距离掉速的前兆区间，Z4 连续停留通常不超过 20–30 分钟，Z5 仅出现在短冲刺、陡坡、终点冲刺等极端场景且单次骑行占比通常低于 5%，占比过高提示强度分配极端。LTHR 5 区（乳酸阈值心率 ≈ 30 分钟全力骑的平均心率，训练有素者约为 HRmax 的 85–90%，正式阶段接入资料字段后启用）——Z1 <81% 恢复区、Z2 81–89% 有氧耐力区、Z3 90–94% Tempo/节奏区、Z4 95–105% 乳酸阈值区、Z5 >106% VO₂max/无氧区。效率因子 EF = NP / 平均心率（单位 W/bpm）参考：初学者 <1.5、训练有素 1.5–2.0、高水平 2.0–2.5、精英 >2.5。运动科学依据：心率对功率变化的响应延迟约 20–30 秒，是“滞后指标”，适合评估整体负荷而非即时配速；长时间稳态骑行中心率随脱水、体温升高、每搏输出量下降而逐渐上升（cardiac drift），正常漂移率约 3–5%/小时；EF 越高代表每跳心脏输出的机械功率越多，即同强度下 EF 上升 = 有氧经济改善。",
    interpretationSignals: {
      good: [
        "Z2 骑行中心率漂移 ≤5%（90 分钟以上稳态）",
        "EF 值在同强度骑行中逐周上升（有氧效率提升）",
        "骑行后 1 分钟心率恢复 ≥20–30 bpm",
        "心率区间分布与训练目标匹配（如恢复骑 90%+ 在 Z1–Z2）",
      ],
      bad: [
        "相同功率下心率比平时高 5–10 bpm（疲劳未恢复/脱水/高温/生病前兆）",
        "Z2 骑心率漂移 >10%（有氧基础不足）",
        "心率长时间挂在 Z4–Z5 且功率上不去（过度训练/糖原耗尽）",
        "骑行后心率恢复 <12 bpm（心血管适应度差或疲劳累积）",
        "心率曲线锯齿剧烈且与功率变化不同步（心率带佩戴问题/信号干扰）",
      ],
    },
  },
  {
    knowledgeId: "kb-v21-powerOutput",
    dimensionId: "powerOutput",
    category: "cyclingSportsScience",
    topic: "功率输出：标准化功率、功率区间与功率曲线",
    title: "功率输出维度知识（Allen & Coggan 功率训练体系整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §4 功率输出",
    applicableDimensions: ["powerOutput"],
    applicableConditions: ["功率数据完整的骑行记录", "解读功率水平、稳定性与峰值时"],
    conclusionStrength: "high",
    limitations: [
      "NP 为生理压力估算模型，非生理测量",
      "功率区间边界为百分比近似，个体生理转折点存在差异",
    ],
    safetyBoundaries: [],
    forbiddenFactKeys: [
      "power.mean", "power.np", "power.max", "power.wkg", "power.zone", "power.curve", "power.vi",
    ],
    explanation:
      "功率是踩踏产生的机械功率（瓦特），是自行车运动中最客观、最即时的“输出侧”指标，不受心率滞后、温度与疲劳感知干扰。标准化功率 NP（Allen & Coggan）：对 30 秒滑动平均功率取 4 次方、平均后开 4 次方根——4 次方加权的功率均值与心率、血乳酸反应的相关性最好，最能代表“身体实际承受的生理压力”。七级功率区间（基于 FTP）：Z1 <55% 主动恢复、Z2 56–75% 有氧耐力、Z3 76–90% Tempo、Z4 91–105% 乳酸阈值、Z5 106–120% VO₂max、Z6 121–150% 无氧能力、Z7 >150% 神经肌肉功率。有效功率比 = NP / 平均功率 = 变速系数 VI。FTP（功能性阈值功率）= 最大可持续 1 小时的平均功率，约等于 95% 的 20 分钟全力骑功率，是划分所有功率区间的基准。运动科学依据：速度受风阻、坡度影响极大（风阻 ∝ 速度³），功率直接对应人体做功，是更可比的指标。",
    interpretationSignals: {
      good: [
        "NP 与平均功率差值小（VI 接近 1.0，节奏稳定）",
        "功率曲线各时长成比例（如 1min ≈ 120–130% FTP、5min ≈ 105–110% FTP）",
        "峰值功率与平均功率比合理（短骑行比值高、长骑行比值低）",
        "同 FTP 下 W/kg 随训练提升",
      ],
      bad: [
        "平均功率远低于 NP（VI >1.2）：功率波动大，频繁拉扯或路况差",
        "功率曲线畸形（如 5min 功率 > 20min 功率的 110%）：测试不充分或体能下降",
        "长时间功率挂在 Z3（“哑区”）：训练无明确针对性",
        "功率数据突然跳变/死区：功率计校准问题或传感器故障",
      ],
    },
  },
  {
    knowledgeId: "kb-v21-intensityAndTrainingLoad",
    dimensionId: "intensityAndTrainingLoad",
    category: "cyclingSportsScience",
    topic: "强度与训练负荷：IF、TSS 与极化训练",
    title: "强度与训练负荷维度知识（TrainingPeaks 负荷体系整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §5 强度与训练负荷",
    applicableDimensions: ["intensityAndTrainingLoad"],
    applicableConditions: ["功率数据完整且具备可信 FTP 基准的骑行记录", "解读强度与单次训练负荷时"],
    conclusionStrength: "high",
    limitations: [
      "TSS 是模型估算而非生理测量，数值含义依赖 FTP 基准准确性",
      "单次骑行难以判断长期负荷状态，需结合多日趋势",
    ],
    safetyBoundaries: ["本条为运动科学知识，不构成医疗或训练处方"],
    forbiddenFactKeys: [
      "intensity.if", "intensity.tss", "intensity.rs", "intensity.tssPerHour",
      "power.np", "profile.ftp",
    ],
    explanation:
      "训练负荷量化一次骑行“给身体施加了多少训练刺激”：强度（多努力）与时长（多久）共同决定。强度因子 IF = NP / FTP：<0.60 恢复骑、0.60–0.70 轻松耐力、0.71–0.85 中等耐力、0.86–0.95 节奏/Tempo、0.96–1.05 阈值、1.06–1.20 VO₂max、>1.20 无氧/冲刺。训练压力分 TSS = IF² × 时长(小时) × 100（以 FTP 强度骑 1 小时 = 100 TSS）：<100 低、100–200 中等、200–300 较高、300–450 高、>450 极高（比赛/长途，恢复 3–5 天）。相对强度 RS = (秒数 × NP × IF) / (FTP × 3600) × 100 是另一种负荷表达。运动科学依据：TSS 中 IF 取平方意味着强度对负荷的贡献是指数级的——IF 从 0.7 升到 0.9（+29%），负荷增加约 65%；精英耐力运动员约 75–85% 训练时间在低强度（Z1–Z2）、15–25% 在高强度（Z4+），很少在 Z3（“垃圾里程”）；TSS 是累积 CTL（慢性负荷）与 ATL（急性负荷）的基础。",
    interpretationSignals: {
      good: [
        "训练骑 IF 与目标匹配（恢复骑 <0.65、基础骑 0.65–0.75、阈值骑 0.85–0.95）",
        "TSS 与骑手水平匹配（业余骑手周 TSS 建议 300–600）",
        "高 TSS 骑行后有足够的低强度恢复日",
        "80/20 分布：约 80% 时间在 Z1–Z2、20% 在 Z4+",
      ],
      bad: [
        "大部分时间挂在 Z3（IF 0.75–0.85）——“垃圾里程”，既不够恢复也不够刺激",
        "连续多日高 TSS（>250/天）无恢复：过度训练风险",
        "单次 IF 很高但时长极短（IF>1.1 但 TSS<50）：短间歇，需关注总训练量",
        "TSS 与主观 RPE 严重不符：FTP 可能需要重新测试",
      ],
    },
  },
  {
    knowledgeId: "kb-v21-cadenceStrategy",
    dimensionId: "cadenceStrategy",
    category: "cyclingSportsScience",
    topic: "踏频策略：踏频分布、扭矩关系与经济性",
    title: "踏频策略维度知识（功率-踏频关系研究整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §6 踏频策略",
    applicableDimensions: ["cadenceStrategy"],
    applicableConditions: ["踏频数据完整的骑行记录", "解读踏频水平、分布与踩踏流畅度时"],
    conclusionStrength: "moderate",
    limitations: [
      "个体最优踏频因人而异（心血管成本 + 肌肉成本总和最低点不同）",
      "平均踏频需排除停车与滑行段",
    ],
    safetyBoundaries: [],
    forbiddenFactKeys: [
      "cadence.mean", "cadence.zone", "cadence.coefficientOfVariation", "cadence.powerCadenceRelation",
    ],
    explanation:
      "踏频（Cadence，RPM）是每分钟踩踏圈数。同一功率可通过“高踏频+轻齿比”或“低踏频+重齿比”实现：高踏频心血管成本高、肌肉力量成本低，低踏频反之。典型踏频参考：平路耐力 85–95、平路计时赛 90–100、缓坡（3–6%）80–90、陡坡（>8%）65–80、冲刺 100–120+、起步/低速 <60。精英车手平路 90–105（高有氧能力支撑高踏频的心血管成本），休闲骑手 70–85（更依赖肌肉力量）。运动科学依据：功率 = 踏频 × 扭矩 × 常数——同一功率下高踏频对应低扭矩（每脚力量小）、低踏频对应高扭矩（每脚力量大）；代谢经济性悖论：实验室测得最低耗氧的踏频是 60–70 RPM，但骑手自发选择 85–95，因为高踏频虽耗氧略高但肌肉骨骼应力小、延迟局部肌肉疲劳，对长距离更有利；低踏频高扭矩更多募集 II 型快肌（力量大易疲劳），高踏频低扭矩更多募集 I 型慢肌（耐力好力量小）。",
    interpretationSignals: {
      good: [
        "平路踏频集中在 85–95 RPM（分布窄、变异小）",
        "坡度增加时踏频自然下降（缓坡降 5 RPM、陡坡降 10–20 RPM）",
        "功率上升时踏频保持稳定（不出现“踩不动”式的踏频崩塌）",
        "踏频数据与功率数据时间对齐良好",
      ],
      bad: [
        "平路踏频持续 <70 RPM：过度碾车，股四头肌疲劳快，不适合长距离",
        "平路踏频持续 >110 RPM：心血管成本大，经济性差",
        "踏频波动极大（标准差 >15 RPM）：踩踏不流畅，齿比选择不当",
        "功率变化时踏频几乎不变：齿比选择太固定，未根据路况换挡",
        "踏频数据与功率数据不同步：传感器配对问题，数据可信度下降",
      ],
    },
  },
  {
    knowledgeId: "kb-v21-crossSensorCoordination",
    dimensionId: "crossSensorCoordination",
    category: "cyclingSportsScience",
    topic: "跨传感器配合：有氧解耦、效率因子与多传感器验证",
    title: "跨传感器配合维度知识（有氧解耦与效率因子研究整理）",
    publisher: KB_SOURCE,
    sourceType: "review",
    version: KB_VERSION,
    citationLocation: "cycling_science_knowledge_base.md §7 跨传感器配合",
    applicableDimensions: ["crossSensorCoordination"],
    applicableConditions: ["功率与心率同时完整且时间对齐的骑行记录", "解读跨传感器同窗口关系时"],
    conclusionStrength: "moderate",
    limitations: [
      "解耦受环境温度、hydration 与疲劳影响，非唯一有氧能力指标",
      "短时间骑行解耦意义有限，通常需 90 分钟以上 Z2 稳态",
    ],
    safetyBoundaries: [],
    forbiddenFactKeys: [
      "crossSensor.decoupling", "crossSensor.efficiencyFactor", "crossSensor.speedPowerRatio",
      "crossSensor.hrCadenceRelation", "crossSensor.gradePowerMatch", "power.np", "heartRate.mean",
    ],
    explanation:
      "跨传感器分析将功率、心率、踏频、速度、坡度放在同一时间窗口下对比，观察其关系如何随骑行变化——这些关系（而非单一指标）才能揭示真实生理状态与训练效果。有氧解耦（Pw:Hr Decoupling）= (前半段 NP/HR − 后半段 NP/HR) / 前半段 × 100%：<5% 优秀（有氧基础扎实）、5–10% 中等、10–15% 偏弱（长距离明显掉速）、>15% 差（需大量 Z2 训练）；测试条件为 90 分钟以上 Z2 稳态骑行，前后各取 20 分钟。效率因子 EF = NP / 平均心率（单位 W/bpm）参考：初学者 <1.5、训练有素 1.5–2.0、高水平 2.0–2.5、精英 >2.5。运动科学依据：长时间稳态中脱水导致血容量下降、每搏输出量减少，心脏需跳更快维持心输出量，故相同功率下心率逐渐上升（cardiac drift 是解耦的生理机制）；EF = 输出 / 输入，随有氧能力提升、完成相同功率所需心率下降，比单看功率或心率更能反映真实进步；多传感器三角验证可抵消单一传感器误差——例如功率高但心率不高可能因滑行段拉低平均功率，功率正常但心率极高可能因爬坡段肌肉做功而心肺跟不上。",
    interpretationSignals: {
      good: [
        "稳态骑行中 Pw:Hr 解耦 <5%（有氧基础好）",
        "同功率下 EF 逐周提升（体能进步）",
        "功率变化时踏频同步调整（换挡时机合理）",
        "速度/功率比稳定（无异常风阻或机械问题）",
        "心率上升滞后于功率上升约 20–30 秒（正常生理响应）",
      ],
      bad: [
        "功率不变但心率持续上升（Pw:Hr 解耦大 → 有氧耐力不足/脱水/高温）",
        "功率上升但心率不升（心率带故障/心率已达平台）",
        "踏频骤变但功率不变（换挡失误或踩踏技术问题）",
        "速度-功率比突然下降（爆胎/刹车蹭碟/逆风增强）",
        "心率和功率时间轴错位 >3 秒（传感器配对/同步问题）",
        "高踏频下心率异常高（心肺瓶颈）；低踏频下功率上不去但心率已高（肌肉力量瓶颈）",
      ],
    },
  },
];
