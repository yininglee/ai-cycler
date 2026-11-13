import type { AnalysisDimensionId } from "./ride-analysis-evidence-v2.ts";

type TrainingKnowledgeEntry = {
  knowledgeId: string;
  dimensionId: AnalysisDimensionId;
  topic: string;
  title: string;
  keywords: readonly string[];
  explanation: string;
  limitations: readonly string[];
  conclusionStrength: "high" | "moderate" | "limited";
  sources: readonly { label: string; url: string }[];
};

export const trainingKnowledgeBase: readonly TrainingKnowledgeEntry[] = [
  {
    knowledgeId: "kb-training-progression",
    dimensionId: "intensityAndTrainingLoad",
    topic: "训练基础与渐进增加",
    title: "循序增加训练量",
    keywords: ["规律骑行", "入门", "新手", "恢复训练", "渐进", "训练量", "加量", "训练频率"],
    explanation: "先依据能稳定完成的骑行频率、时长和近期变化选择起点。可以逐步调整单次时长、频率或强度，并按实际完成和恢复情况复核。可用时间是排程上限，计划可以从更少的训练开始。",
    limitations: ["ACSM 指南面向表面健康的成年人。渐进原则没有给出适用于所有骑友的每周加量比例。"],
    conclusionStrength: "high",
    sources: [{ label: "Garber 等，ACSM 运动处方立场声明，2011", url: "https://pubmed.ncbi.nlm.nih.gov/21694556/" }],
  },
  {
    knowledgeId: "kb-training-recovery",
    dimensionId: "intensityAndTrainingLoad",
    topic: "训练负荷、疲劳与恢复",
    title: "结合训练量与恢复判断负荷",
    keywords: ["恢复", "疲劳", "休息", "训练负荷", "减量", "睡眠", "停练"],
    explanation: "骑行时长、频率和功率描述已完成的训练。相近的外部负荷可以产生不同的主观用力与疲劳。解读训练变化时结合近期训练分布、自述疲劳和生活压力。资料不齐或间断较长时，优先选择可复核的保守起点。",
    limitations: ["上传记录可能不完整。单个负荷值、心率或一次疲劳自述不能诊断过度训练或预测个人伤病。"],
    conclusionStrength: "moderate",
    sources: [{ label: "Soligard 等，IOC 训练负荷共识，2016", url: "https://pubmed.ncbi.nlm.nih.gov/27535989/" }],
  },
  {
    knowledgeId: "kb-training-endurance",
    dimensionId: "intensityAndTrainingLoad",
    topic: "耐力与长距离骑行",
    title: "长距离目标与持续骑行能力",
    keywords: ["耐力", "长距离", "长骑", "百公里", "完赛", "持续骑行"],
    explanation: "长距离骑行要关注持续运动后的输出能力。训练有素骑友的实验发现，长时间骑行后的生理阈值与短时高强度表现存在个体差异。制定长距离目标时，可以在规则允许的范围内把一部分耐力时长放在较宽裕的一天，并以近期有效的最长单次骑行为起点。",
    limitations: ["实验主要纳入训练有素者。研究支持关注长时间运动后的表现，未给出入门骑友的长骑进阶剂量或完赛保证。"],
    conclusionStrength: "moderate",
    sources: [{ label: "Maunder 等，长时间运动后的耐久性实验，2024", url: "https://pubmed.ncbi.nlm.nih.gov/38546844/" }],
  },
  {
    knowledgeId: "kb-training-intensity",
    dimensionId: "intensityAndTrainingLoad",
    topic: "极化训练、节奏与阈值",
    title: "强度分配与周期安排",
    keywords: ["极化", "80/20", "强度分配", "提升速度", "节奏", "阈值", "周期化", "间歇", "提速"],
    explanation: "一项训练有素男性骑友的交叉试验发现，低强度占主要部分的极化方案在部分指标上优于阈值偏重的方案。另一项训练有素骑友的试验中，集中式和传统周期安排在主要表现改善上相近。计划可保留轻松训练，依据基础和目标安排较费力的课，并留出恢复。",
    limitations: ["试验样本小且主要是有训练基础的骑友。极化方案的强度比例不能直接照搬，研究中的高强度间歇也不能直接等同于本产品的节奏或阈值课型。"],
    conclusionStrength: "moderate",
    sources: [
      { label: "Neal 等，骑行强度分配交叉试验，2013", url: "https://pubmed.ncbi.nlm.nih.gov/23264537/" },
      { label: "Almquist 等，骑行周期化对照试验，2022", url: "https://pubmed.ncbi.nlm.nih.gov/35299664/" },
    ],
  },
  {
    knowledgeId: "kb-training-talk-test",
    dimensionId: "heartRateLoad",
    topic: "交谈测试与主观用力",
    title: "用说话和主观感受辨别强度",
    keywords: ["交谈测试", "谈话测试", "主观用力", "RPE", "没有功率计", "没功率计", "轻松骑"],
    explanation: "交谈测试可粗略区分相对强度。中等强度活动通常还能说话，较费力时往往只能说几个词就需要换气。结合个人主观用力和呼吸判断，没有可用功率目标时也能执行用力提示。",
    limitations: ["交谈测试是粗略提示，无法从中换算出个人 FTP、瓦数或精确心率区间。"],
    conclusionStrength: "moderate",
    sources: [{ label: "CDC，如何衡量身体活动强度", url: "https://www.cdc.gov/physical-activity-basics/measuring/index.html" }],
  },
  {
    knowledgeId: "kb-training-ftp",
    dimensionId: "powerOutput",
    topic: "FTP、阈值功率与测试差异",
    title: "阈值功率估计的适用边界",
    keywords: ["FTP", "阈值功率", "功率区间", "乳酸阈", "提升阈值"],
    explanation: "FTP 用于描述和参考骑手较长时间维持的功率。短计时测试的换算估计和较长计时测试在群体均值上可能接近，个人差异仍可很大。比较训练前后表现时应留意测试方法和条件是否一致。计划使用已核对的功率基准，缺少基准时保留主观用力提示。",
    limitations: ["一次普通骑行的平均功率无法用来推断 FTP。不同阈值测量不宜直接互换。"],
    conclusionStrength: "moderate",
    sources: [{ label: "Borszcz 等，骑行 FTP 的效度与生理反应，2018", url: "https://pubmed.ncbi.nlm.nih.gov/29801189/" }],
  },
  {
    knowledgeId: "kb-training-climb",
    dimensionId: "climbPerformance",
    topic: "爬坡目标与地形配速",
    title: "根据坡度理解持续输出",
    keywords: ["爬坡", "上坡", "坡度", "爬升", "坡段", "地形配速"],
    explanation: "有经验骑友的起伏路线短距离计时试验发现，随坡度调整功率可能比保持恒定功率更有效。应用到计划时，爬坡目标可以强调持续、受控的用力和地形配速练习，具体时长和强度仍取决于个人基础与可用课型。",
    limitations: ["短距离试验不能给出通用坡段瓦数或爬坡训练剂量。户外比较还受路线、天气和骑行条件影响。"],
    conclusionStrength: "limited",
    sources: [{ label: "Cangley 等，坡度变化与骑行配速试验，2011", url: "https://pubmed.ncbi.nlm.nih.gov/21165802/" }],
  },
  {
    knowledgeId: "kb-training-taper",
    dimensionId: "intensityAndTrainingLoad",
    topic: "备赛与赛前减量",
    title: "赛前减量与训练疲劳",
    keywords: ["备赛", "赛事", "比赛", "赛前", "减量", "taper"],
    explanation: "赛前减量是临近赛事时减少训练负担，以便在比赛前降低累积疲劳。小样本骑行试验在已训练骑手中比较了不同减量幅度，结果提示赛前训练量的安排会影响计时表现。应用到草案时，先核对赛事日期和近期训练，考虑在适当阶段减少训练量。",
    limitations: ["证据来自受训练骑手，具体减量幅度和保留的强度取决于此前训练和目标。没有已确认的赛事日期时不假定需要赛前减量。"],
    conclusionStrength: "moderate",
    sources: [{ label: "Neary 等，不同减量方案的骑行计时试验，2003", url: "https://pubmed.ncbi.nlm.nih.gov/12904635/" }],
  },
];

export function trainingKnowledgeForPlan(goal: string, hasPowerTarget: boolean): readonly TrainingKnowledgeEntry[] {
  const query = goal.toLowerCase();
  const core = new Set(["kb-training-progression", "kb-training-recovery", hasPowerTarget ? "kb-training-ftp" : "kb-training-talk-test"]);
  const relevant = trainingKnowledgeBase.filter(entry =>
    !core.has(entry.knowledgeId) && entry.keywords.some(keyword => query.includes(keyword.toLowerCase())));
  return [...trainingKnowledgeBase.filter(entry => core.has(entry.knowledgeId)), ...relevant.slice(0, 3)];
}
