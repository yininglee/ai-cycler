// V2.1 指标规格目录（MetricSpec）。
// 由新知识库 doc_V2.1/cycling_science_knowledge_base.md 的"关键指标"表驱动：
// 每个关键指标一条 MetricSpec，声明它"怎么来（直取/规则计算）、依赖什么、
// 能支撑/不能支撑哪些结论"。这是模型输入口径的权威定义（设计文档 §4.1）。
//
// V21-02 冻结：7 维度 37 项 MetricSpec（覆盖新知识库全部关键指标行）。
// 共享指标（VI/EF）在多维度各列一条 MetricSpec，计算层只算一次。

import type { AnalysisDimensionId } from "./ride-analysis-evidence-v2.ts";

export const RIDE_METRIC_SPEC_VERSION = "ride-metric-spec-v2.1.0" as const;

export type MetricSpecSource = "direct" | "computed";

// 基准分级（照知识库各维度的"基准范围与分级"表）。description 是整体说明，
// grades 是分级条目，供知识挂载与 Prompt 软引导引用；数字只供转述，不自算。
export interface MetricBenchmark {
  description: string;
  grades: string[];
}

export interface MetricSpec {
  metricId: string;
  dimensionId: AnalysisDimensionId;
  name: string;
  definition: string;
  source: MetricSpecSource;
  // computed 项：依赖的底层指标/能力（如 VI 依赖 power.normalizedW + power.averageW）。
  dependencies?: string[];
  // computed 项：计算口径（版本化、可复现，照知识库"计算方法"列）。
  formula?: string;
  unit: string;
  displayUnit?: string;
  benchmark?: MetricBenchmark;
  // 该指标能支撑的结论方向。
  supports: string[];
  // 该指标禁止支撑的结论方向（对齐输出校验器射程）。
  prohibits: string[];
}

export function validateRideMetricSpecsV21(specs: MetricSpec[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (!spec.metricId.trim()) issues.push(`METRIC_ID_MISSING:${spec.metricId}`);
    if (seen.has(spec.metricId)) issues.push(`DUPLICATE_METRIC_ID:${spec.metricId}`);
    seen.add(spec.metricId);
    if (!spec.name.trim() || !spec.definition.trim() || !spec.unit.trim()) {
      issues.push(`METRIC_FIELDS_INVALID:${spec.metricId}`);
    }
    if (spec.source !== "direct" && spec.source !== "computed") {
      issues.push(`METRIC_SOURCE_INVALID:${spec.metricId}`);
    }
    if (spec.source === "computed" && (!spec.formula?.trim() || !spec.dependencies?.length)) {
      issues.push(`COMPUTED_METRIC_MISSING_FORMULA_OR_DEPENDENCY:${spec.metricId}`);
    }
    if (!spec.supports.length || !spec.prohibits.length) {
      issues.push(`METRIC_SUPPORT_OR_PROHIBIT_MISSING:${spec.metricId}`);
    }
  }
  return issues;
}

// 7 维度 37 项 MetricSpec（覆盖新知识库全部关键指标行）。
export const rideDerivedMetricSpecsV21: MetricSpec[] = [
  // ── 1. 配速执行 pacingExecution ──────────────────────────────────────────
  {
    metricId: "pacing.splitDifference",
    dimensionId: "pacingExecution",
    name: "前半/后半功率差 (Split Difference)",
    definition: "前后半程 NP 的差值百分比",
    source: "computed",
    dependencies: ["power.normalizedW", "timing.movingTimeS"],
    formula: "(后半NP - 前半NP) / 前半NP × 100%",
    unit: "ratio",
    displayUnit: "%",
    supports: ["pacing_split"],
    prohibits: ["causation", "ability_change", "training_plan_completion"],
  },
  {
    metricId: "pacing.variabilityIndex",
    dimensionId: "pacingExecution",
    name: "变速系数 VI (Variability Index)",
    definition: "NP 与平均功率的比值，反映功率波动程度",
    source: "computed",
    dependencies: ["power.normalizedW", "power.averageW"],
    formula: "VI = NP / 平均功率",
    unit: "ratio",
    benchmark: {
      description: "VI 解读分级",
      grades: [
        "1.00–1.05 非常稳定（计时赛/室内训练）",
        "1.05–1.15 正常户外起伏骑行",
        "1.15–1.25 波动较大（包含爬坡/拉扯）",
        ">1.25 波动剧烈（比赛/含大量间歇）",
      ],
    },
    supports: ["power_variability"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "pacing.stoppedTimeShare",
    dimensionId: "pacingExecution",
    name: "停歇时间占比",
    definition: "骑行中完全停止或极低功率（<50W）的时间比例",
    source: "computed",
    dependencies: ["timing.stoppedTimeS", "timing.elapsedTimeS"],
    formula: "停歇时间 / 总时间 × 100%",
    unit: "ratio",
    displayUnit: "%",
    supports: ["stop_observation"],
    prohibits: ["causation", "stop_cause"],
  },
  {
    metricId: "pacing.climbDescentPowerRatio",
    dimensionId: "pacingExecution",
    name: "爬升段/下降段功率比",
    definition: "上坡与下坡的功率分布对比",
    source: "computed",
    dependencies: ["climb.averagePowerW", "terrain.descentAveragePowerW"],
    formula: "爬坡段平均功率 / 下坡段平均功率",
    unit: "ratio",
    supports: ["terrain_pacing"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "pacing.negativeSplit",
    dimensionId: "pacingExecution",
    name: "负分割 (Negative Split)",
    definition: "后半程是否比前半程更快/更强",
    source: "computed",
    dependencies: ["power.normalizedW", "timing.movingTimeS"],
    formula: "后半 vs 前半 NP 差，按分级判定",
    unit: "ratio",
    displayUnit: "%",
    benchmark: {
      description: "负分割分级",
      grades: [
        "后半程比前半高 2–5%：理想负分割（耐力骑行/长距离）",
        "前后差 ±2% 以内：匀速配速（Perfectly Even）",
        "前半程比后半高 >5%：正分割/前快后崩（过早发力）",
      ],
    },
    supports: ["pacing_split"],
    prohibits: ["causation", "ability_change", "training_plan_completion"],
  },

  // ── 2. 爬坡表现 climbPerformance ─────────────────────────────────────────
  {
    metricId: "climb.wkg",
    dimensionId: "climbPerformance",
    name: "爬坡 W/kg",
    definition: "爬坡段平均功率 / 体重",
    source: "computed",
    dependencies: ["climb.averagePowerW", "profile.weightKg"],
    formula: "爬坡段平均功率 / 体重",
    unit: "W/kg",
    benchmark: {
      description: "FTP W/kg 骑手分级（男性参考）",
      grades: [
        "2.0–2.8 新手/休闲",
        "2.8–3.5 经常训练",
        "3.5–4.2 业余强手",
        "4.0–4.5 Cat 3–2",
        "4.5–5.5 Cat 1–精英业余",
        "5.5–6.0 Pro 洲际队",
        "6.0–6.5+ World Tour 爬坡手",
      ],
    },
    supports: ["climb_relative_power"],
    prohibits: ["causation", "ability_change", "infer_missing_profile"],
  },
  {
    metricId: "climb.vam",
    dimensionId: "climbPerformance",
    name: "VAM (Vertical Ascent Meteric)",
    definition: "垂直爬升速率（米/小时）",
    source: "computed",
    dependencies: ["climb.elevationGainM", "climb.durationS"],
    formula: "VAM = 爬升高度 / 时间 × 3600",
    unit: "m/h",
    benchmark: {
      description: "VAM 参考值",
      grades: [
        "休闲骑手：500–800 m/h",
        "训练有素：800–1200 m/h",
        "业余竞赛：1200–1600 m/h",
        "职业车手：1600–2000+ m/h（短陡坡）",
      ],
    },
    supports: ["climb_vertical_rate"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "climb.gradePowerMatch",
    dimensionId: "climbPerformance",
    name: "坡度-功率匹配度",
    definition: "不同坡度段的 W/kg 是否一致",
    source: "computed",
    dependencies: ["climb.wkg", "terrain.grade"],
    formula: "不同坡度段 W/kg 的一致性（变异系数）",
    unit: "ratio",
    displayUnit: "%",
    supports: ["climb_grade_power_match"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "climb.powerDecay",
    dimensionId: "climbPerformance",
    name: "爬坡功率衰减率",
    definition: "长爬坡中后半段 vs 前半段 W/kg 下降",
    source: "computed",
    dependencies: ["climb.wkg", "climb.durationS"],
    formula: "长爬坡后半 vs 前半 W/kg 下降百分比",
    unit: "ratio",
    displayUnit: "%",
    supports: ["climb_endurance"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "climb.effectiveElevationGain",
    dimensionId: "climbPerformance",
    name: "有效爬升高度",
    definition: "扣除假爬升（下坡+上坡连续）后的净爬升",
    source: "computed",
    dependencies: ["elevation.gainM", "terrain.grade"],
    formula: "扣除假爬升后的净爬升",
    unit: "m",
    supports: ["climb_net_elevation"],
    prohibits: ["causation"],
  },

  // ── 3. 心率负荷 heartRateLoad ────────────────────────────────────────────
  {
    metricId: "heartRate.mean",
    dimensionId: "heartRateLoad",
    name: "平均心率",
    definition: "骑行中心率统计值（需结合 LTHR 或 HRmax 解读）",
    source: "direct",
    unit: "bpm",
    supports: ["heart_rate_level"],
    prohibits: ["causation", "medical_diagnosis"],
  },
  {
    metricId: "heartRate.max",
    dimensionId: "heartRateLoad",
    name: "最大心率",
    definition: "骑行中最高心率（需结合 LTHR 或 HRmax 解读）",
    source: "direct",
    unit: "bpm",
    supports: ["heart_rate_level"],
    prohibits: ["causation", "medical_diagnosis"],
  },
  {
    metricId: "heartRate.zone",
    dimensionId: "heartRateLoad",
    name: "心率区间分布",
    definition: "各心率区间时间占比（Z1–Z5）",
    source: "computed",
    dependencies: ["heartRate.mean", "heartRate.baseline", "timing.movingTimeS"],
    formula: "按 LTHR 5 区（优先）或 maxHR 5 区（降级）计时间占比",
    unit: "ratio",
    displayUnit: "%",
    benchmark: {
      description: "心率区间分级（基于 LTHR）",
      grades: [
        "Z1 <81% 恢复区",
        "Z2 81–89% 有氧耐力区",
        "Z3 90–94% Tempo/节奏区",
        "Z4 95–105% 乳酸阈值区",
        "Z5 >106% VO₂max/无氧区",
      ],
    },
    supports: ["heart_rate_zone_distribution"],
    prohibits: ["causation", "medical_diagnosis"],
  },
  {
    metricId: "heartRate.drift",
    dimensionId: "heartRateLoad",
    name: "心率上升速率 (Heart Rate Drift)",
    definition: "稳态骑行中心率随时间的上升幅度",
    source: "computed",
    dependencies: ["heartRate.mean", "power.normalizedW", "timing.movingTimeS"],
    formula: "稳态阶段心率随时间的上升幅度",
    unit: "ratio",
    displayUnit: "%",
    supports: ["heart_rate_stage_change"],
    prohibits: ["causation", "medical_diagnosis", "recovery"],
  },
  {
    metricId: "heartRate.efficiencyFactor",
    dimensionId: "heartRateLoad",
    name: "效率因子 EF (Efficiency Factor)",
    definition: "NP / 平均心率",
    source: "computed",
    dependencies: ["power.normalizedW", "heartRate.mean"],
    formula: "EF = NP / 平均心率",
    unit: "W/bpm",
    benchmark: {
      description: "EF 参考（W/bpm）",
      grades: [
        "初学者：<1.5",
        "训练有素：1.5–2.0",
        "高水平：2.0–2.5",
        "精英：>2.5",
      ],
    },
    supports: ["aerobic_efficiency"],
    prohibits: ["causation", "medical_diagnosis", "recovery"],
  },
  {
    metricId: "heartRate.recovery",
    dimensionId: "heartRateLoad",
    name: "心率恢复 (HR Recovery)",
    definition: "骑行结束后 1–2 分钟心率下降幅度（受限：无停表后数据则进 limitation）",
    source: "computed",
    dependencies: ["heartRate.mean", "timing.postRideData"],
    formula: "骑行结束后 1–2 分钟心率降幅",
    unit: "bpm",
    supports: ["post_ride_hr_recovery"],
    prohibits: ["causation", "medical_diagnosis", "recovery_claim"],
  },

  // ── 4. 功率输出 powerOutput ──────────────────────────────────────────────
  {
    metricId: "power.average",
    dimensionId: "powerOutput",
    name: "平均功率 (Average Power)",
    definition: "全程功率的算术平均值（受滑行/下坡低功率拉低）",
    source: "direct",
    unit: "W",
    supports: ["power_level"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "power.np",
    dimensionId: "powerOutput",
    name: "标准化功率 NP (Normalized Power)",
    definition: "模拟以恒定功率骑行产生相同生理压力的功率（Allen & Coggan）",
    source: "computed",
    dependencies: ["power.average", "series.power"],
    formula: "对 30 秒滑动平均功率取 4 次方 → 平均 → 开 4 次方根",
    unit: "W",
    supports: ["normalized_power_output"],
    prohibits: ["causation", "if_without_ftp", "tss_without_ftp"],
  },
  {
    metricId: "power.max",
    dimensionId: "powerOutput",
    name: "最大功率 / 峰值功率",
    definition: "短时间内最高功率（反映无氧爆发力）",
    source: "direct",
    unit: "W",
    supports: ["short_duration_power_peak"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "power.wkg",
    dimensionId: "powerOutput",
    name: "功体比 W/kg",
    definition: "功率 / 体重（不同体重间的比较基准）",
    source: "computed",
    dependencies: ["power.average", "profile.weightKg"],
    formula: "功率 / 体重",
    unit: "W/kg",
    supports: ["relative_power_output"],
    prohibits: ["causation", "ability_change", "infer_missing_profile"],
  },
  {
    metricId: "power.curve",
    dimensionId: "powerOutput",
    name: "功率曲线 (Power Curve)",
    definition: "各时长（5s/1min/5min/20min/1hr）最大输出",
    source: "computed",
    dependencies: ["series.power", "power.average"],
    formula: "各时长窗口（5s/1min/5min/20min/1h）的最大平均功率",
    unit: "W",
    supports: ["power_curve"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "power.vi",
    dimensionId: "powerOutput",
    name: "有效功率比（= 变速系数 VI）",
    definition: "NP / 平均功率",
    source: "computed",
    dependencies: ["pacing.variabilityIndex"],
    formula: "VI = NP / 平均功率（共享 pacing.variabilityIndex）",
    unit: "ratio",
    supports: ["power_variability"],
    prohibits: ["causation", "ability_change"],
  },

  // ── 5. 强度与训练负荷 intensityAndTrainingLoad ──────────────────────────
  {
    metricId: "intensity.if",
    dimensionId: "intensityAndTrainingLoad",
    name: "强度因子 IF (Intensity Factor)",
    definition: "本次骑行 NP 相对于 FTP 的强度",
    source: "computed",
    dependencies: ["power.np", "profile.ftp"],
    formula: "IF = NP / FTP",
    unit: "ratio",
    benchmark: {
      description: "IF 强度分级",
      grades: [
        "<0.60 恢复骑",
        "0.60–0.70 轻松耐力",
        "0.71–0.85 中等耐力",
        "0.86–0.95 节奏/Tempo",
        "0.96–1.05 阈值",
        "1.06–1.20 VO₂max",
        ">1.20 无氧/冲刺",
      ],
    },
    supports: ["ride_intensity_factor"],
    prohibits: ["recovery", "health_status", "training_effect"],
  },
  {
    metricId: "intensity.tss",
    dimensionId: "intensityAndTrainingLoad",
    name: "训练压力分 TSS (Training Stress Score)",
    definition: "综合强度×时长的训练负荷量化",
    source: "computed",
    dependencies: ["intensity.if", "timing.movingTimeS"],
    formula: "TSS = IF² × 时长(小时) × 100",
    unit: "score",
    benchmark: {
      description: "单次骑行 TSS 参考",
      grades: [
        "<100 低（恢复几小时）",
        "100–200 中等（恢复 1 天）",
        "200–300 较高（恢复 1–2 天）",
        "300–450 高（恢复 2–3 天）",
        ">450 极高（比赛/长途，恢复 3–5 天）",
      ],
    },
    supports: ["single_ride_training_load"],
    prohibits: ["recovery", "injury_risk", "training_effect"],
  },
  {
    metricId: "intensity.rs",
    dimensionId: "intensityAndTrainingLoad",
    name: "相对强度 RS",
    definition: "另一种负荷表达方式",
    source: "computed",
    dependencies: ["power.np", "intensity.if", "profile.ftp", "timing.movingTimeS"],
    formula: "RS = (秒数 × NP × IF) / (FTP × 3600) × 100",
    unit: "score",
    supports: ["single_ride_training_load"],
    prohibits: ["recovery", "injury_risk", "training_effect"],
  },
  {
    metricId: "intensity.tssPerHour",
    dimensionId: "intensityAndTrainingLoad",
    name: "每个 TSS 耗时",
    definition: "负荷效率",
    source: "computed",
    dependencies: ["intensity.tss", "timing.movingTimeS"],
    formula: "总时长 / TSS",
    unit: "ratio",
    supports: ["load_efficiency"],
    prohibits: ["recovery", "training_effect"],
  },

  // ── 6. 踏频策略 cadenceStrategy ──────────────────────────────────────────
  {
    metricId: "cadence.mean",
    dimensionId: "cadenceStrategy",
    name: "平均踏频",
    definition: "全程踏频均值（需排除停车/滑行段）",
    source: "direct",
    unit: "RPM",
    supports: ["cadence_level"],
    prohibits: ["causation", "efficiency_claim"],
  },
  {
    metricId: "cadence.zone",
    dimensionId: "cadenceStrategy",
    name: "踏频分布",
    definition: "各踏频区间的时间占比（70–80 / 80–90 / 90–100 / 100+）",
    source: "computed",
    dependencies: ["cadence.mean", "timing.movingTimeS"],
    formula: "按踏频区间计时间占比",
    unit: "ratio",
    displayUnit: "%",
    supports: ["cadence_zone_distribution"],
    prohibits: ["causation", "efficiency_claim"],
  },
  {
    metricId: "cadence.cv",
    dimensionId: "cadenceStrategy",
    name: "踏频变异系数",
    definition: "踏频标准差 / 平均踏频（反映踩踏流畅度）",
    source: "computed",
    dependencies: ["cadence.mean", "series.cadence"],
    formula: "踏频标准差 / 平均踏频",
    unit: "ratio",
    displayUnit: "%",
    supports: ["cadence_stability"],
    prohibits: ["causation", "efficiency_claim"],
  },
  {
    metricId: "cadence.powerCadenceRelation",
    dimensionId: "cadenceStrategy",
    name: "功率-踏频关系",
    definition: "不同功率下骑手选择的踏频",
    source: "computed",
    dependencies: ["cadence.mean", "power.average", "series.cadence", "series.power"],
    formula: "不同功率档下的踏频选择",
    unit: "RPM",
    supports: ["cadence_power_relation"],
    prohibits: ["causation", "efficiency_claim"],
  },
  {
    metricId: "cadence.sensorAlignment",
    dimensionId: "cadenceStrategy",
    name: "传感器对齐",
    definition: "踏频数据与功率数据的时间同步性（用于判断数据质量）",
    source: "computed",
    dependencies: ["series.cadence", "series.power"],
    formula: "踏频与功率变化的时间延迟",
    unit: "s",
    supports: ["cadence_sensor_alignment"],
    prohibits: ["causation"],
  },

  // ── 7. 跨传感器配合 crossSensorCoordination ─────────────────────────────
  {
    metricId: "crossSensor.decoupling",
    dimensionId: "crossSensorCoordination",
    name: "有氧解耦 Pw:Hr",
    definition: "功率-心率比的漂移程度",
    source: "computed",
    dependencies: ["power.np", "heartRate.mean", "timing.movingTimeS"],
    formula: "(前半段 NP/HR - 后半段 NP/HR) / 前半段 NP/HR × 100%",
    unit: "ratio",
    displayUnit: "%",
    benchmark: {
      description: "有氧解耦 (Pw:Hr Decoupling) 分级",
      grades: [
        "<5% 优秀（有氧基础扎实，耐力持久）",
        "5–10% 中等（长距离有衰减）",
        "10–15% 偏弱（长距离明显掉速）",
        ">15% 差（需大量 Z2 训练）",
      ],
    },
    supports: ["aerobic_decoupling"],
    prohibits: ["causation", "ability_change", "recovery"],
  },
  {
    metricId: "crossSensor.efficiencyFactor",
    dimensionId: "crossSensorCoordination",
    name: "效率因子 EF（跨传感器视角）",
    definition: "功率/心率比值",
    source: "computed",
    dependencies: ["heartRate.efficiencyFactor"],
    formula: "EF = NP / 平均HR（共享 heartRate.efficiencyFactor）",
    unit: "W/bpm",
    supports: ["aerobic_efficiency"],
    prohibits: ["causation", "medical_diagnosis", "recovery"],
  },
  {
    metricId: "crossSensor.cadencePowerSync",
    dimensionId: "crossSensorCoordination",
    name: "踏频-功率同步性",
    definition: "踏频变化是否跟随功率变化",
    source: "computed",
    dependencies: ["series.cadence", "series.power"],
    formula: "踏频与功率变化的时间相关系数",
    unit: "ratio",
    supports: ["cadence_power_sync"],
    prohibits: ["causation", "response_order"],
  },
  {
    metricId: "crossSensor.speedPowerRatio",
    dimensionId: "crossSensorCoordination",
    name: "速度-功率比 (V/P)",
    definition: "速度 / 功率（滚动阻力+风阻+坡度的综合效率）",
    source: "computed",
    dependencies: ["speed.mean", "power.average"],
    formula: "速度 / 功率",
    unit: "ratio",
    supports: ["ride_economy"],
    prohibits: ["causation", "ability_change"],
  },
  {
    metricId: "crossSensor.hrCadenceRelation",
    dimensionId: "crossSensorCoordination",
    name: "心率-踏频关系",
    definition: "同功率下心率随踏频的变化",
    source: "computed",
    dependencies: ["heartRate.mean", "cadence.mean", "power.average"],
    formula: "对比不同踏频下的 HR",
    unit: "bpm",
    supports: ["hr_cadence_relation"],
    prohibits: ["causation", "medical_diagnosis"],
  },
  {
    metricId: "crossSensor.gradePowerMatch",
    dimensionId: "crossSensorCoordination",
    name: "坡度-功率匹配",
    definition: "坡度变化与功率变化的时间对齐",
    source: "computed",
    dependencies: ["terrain.grade", "series.power"],
    formula: "坡度与功率变化的延迟时间分析",
    unit: "s",
    supports: ["grade_power_alignment"],
    prohibits: ["causation"],
  },
];
