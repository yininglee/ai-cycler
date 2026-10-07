// V2.1 派生指标纯函数模块。
// 把新知识库的"关键指标"中需规则计算的指标，实现为确定性纯函数
// （输入简单数值/数组，输出数值/分级），供 V21-07 接入 Claim 构建与白名单投影。
// 所有函数确定性、可复现、可单测；计算口径照 MetricSpec（ride-derived-metric-spec-v21.ts）
// 与新知识库的"计算方法"列。缺失输入不填 0、返回 undefined，由调用方进 limitation。

export const RIDE_DERIVED_METRICS_V21_VERSION = "ride-derived-metrics-v2.1.0" as const;

// ── 配速执行 pacingExecution ────────────────────────────────────────────────

// VI 变速系数 = NP / 平均功率。avgPower <= 0 时返回 undefined（无意义）。
export function variabilityIndex(np: number, averagePower: number): number | undefined {
  if (!Number.isFinite(np) || !Number.isFinite(averagePower) || averagePower <= 0) return undefined;
  return np / averagePower;
}

// 前半/后半功率差 = (后半NP - 前半NP) / 前半NP × 100（单位：百分比）。
export function splitDifferencePercent(firstHalfNp: number, secondHalfNp: number): number | undefined {
  if (!Number.isFinite(firstHalfNp) || !Number.isFinite(secondHalfNp) || firstHalfNp <= 0) return undefined;
  return ((secondHalfNp - firstHalfNp) / firstHalfNp) * 100;
}

export type NegativeSplitGrade = "negative_split" | "even" | "mild_positive" | "positive_split";

export interface NegativeSplitResult {
  grade: NegativeSplitGrade;
  differencePct: number;
}

// 负分割分级（照知识库）：后半高 2–5% 理想负分割；±2% 匀速；前半高 >5% 正分割/前快后崩。
export function negativeSplit(firstHalfNp: number, secondHalfNp: number): NegativeSplitResult | undefined {
  const differencePct = splitDifferencePercent(firstHalfNp, secondHalfNp);
  if (differencePct === undefined) return undefined;
  if (differencePct > 2) return { grade: "negative_split", differencePct };
  if (differencePct >= -2) return { grade: "even", differencePct };
  if (differencePct > -5) return { grade: "mild_positive", differencePct };
  return { grade: "positive_split", differencePct };
}

// 停歇时间占比 = 停歇时间 / 总时间 × 100（单位：百分比）。
export function stoppedTimeSharePercent(stoppedTimeS: number, elapsedTimeS: number): number | undefined {
  if (!Number.isFinite(stoppedTimeS) || !Number.isFinite(elapsedTimeS) || elapsedTimeS <= 0) return undefined;
  return (stoppedTimeS / elapsedTimeS) * 100;
}

// 爬升段/下降段功率比 = 爬坡段平均功率 / 下坡段平均功率。
export function climbDescentPowerRatio(climbAvgPowerW: number, descentAvgPowerW: number): number | undefined {
  if (!Number.isFinite(climbAvgPowerW) || !Number.isFinite(descentAvgPowerW) || descentAvgPowerW <= 0) return undefined;
  return climbAvgPowerW / descentAvgPowerW;
}

// ── 功率输出 powerOutput ─────────────────────────────────────────────────────

// 某时长的最大滑动窗口平均功率（samples 按等间隔采样，通常 1s）。
// 样本不足该时长时返回 undefined（数据不足，不进 Claim）。
export function bestAveragePower(powerSamples: number[], durationS: number): number | undefined {
  if (durationS <= 0 || !Number.isInteger(durationS) || powerSamples.length < durationS) return undefined;
  let windowSum = 0;
  for (let i = 0; i < durationS; i += 1) {
    const value = powerSamples[i];
    if (!Number.isFinite(value)) return undefined;
    windowSum += value;
  }
  let best = windowSum;
  for (let i = durationS; i < powerSamples.length; i += 1) {
    const value = powerSamples[i];
    if (!Number.isFinite(value)) return undefined;
    windowSum += value - powerSamples[i - durationS];
    if (windowSum > best) best = windowSum;
  }
  return best / durationS;
}

// 功率曲线：各时长（5s/1min/5min/20min/1h）的最大滑动窗口平均功率。
// 返回 Map<时长秒, 最佳平均功率>；某时长样本不足则不写入。
export function powerCurveBest(powerSamples: number[], durationsS: number[]): Map<number, number> {
  const curve = new Map<number, number>();
  for (const durationS of durationsS) {
    const best = bestAveragePower(powerSamples, durationS);
    if (best !== undefined) curve.set(durationS, best);
  }
  return curve;
}

// ── 爬坡表现 climbPerformance ───────────────────────────────────────────────

// 爬坡 W/kg = 爬坡段平均功率 / 体重。
export function climbWkg(climbAvgPowerW: number, weightKg: number): number | undefined {
  if (!Number.isFinite(climbAvgPowerW) || !Number.isFinite(weightKg) || weightKg <= 0) return undefined;
  return climbAvgPowerW / weightKg;
}

// VAM（垂直爬升速率）= 爬升高度 / 时间 × 3600（米/小时）。
export function vam(elevationGainM: number, durationS: number): number | undefined {
  if (!Number.isFinite(elevationGainM) || !Number.isFinite(durationS) || durationS <= 0) return undefined;
  return (elevationGainM / durationS) * 3600;
}

// 变异系数 = 标准差 / 均值 × 100（单位：百分比）。通用，供坡度-功率匹配度与踏频变异系数复用。
export function coefficientOfVariationPercent(values: number[]): number | undefined {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return undefined;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / mean) * 100;
}

// 坡度-功率匹配度：不同坡度段 W/kg 的一致性（变异系数越低越一致）。
export function gradePowerMatchCv(wkgValues: number[]): number | undefined {
  return coefficientOfVariationPercent(wkgValues);
}

// 爬坡功率衰减率 = 长爬坡后半 vs 前半 W/kg 下降百分比。
export function climbPowerDecayPercent(firstHalfWkg: number, secondHalfWkg: number): number | undefined {
  if (!Number.isFinite(firstHalfWkg) || !Number.isFinite(secondHalfWkg) || firstHalfWkg <= 0) return undefined;
  return ((firstHalfWkg - secondHalfWkg) / firstHalfWkg) * 100;
}

// 有效爬升高度 = 总爬升 - 假爬升（下坡+上坡连续的假爬升）。
export function effectiveElevationGain(totalGainM: number, falseGainM: number): number | undefined {
  if (!Number.isFinite(totalGainM) || !Number.isFinite(falseGainM)) return undefined;
  return Math.max(0, totalGainM - falseGainM);
}

// ── 强度与训练负荷 intensityAndTrainingLoad ────────────────────────────────

// 强度因子 IF = NP / FTP。
export function intensityFactor(np: number, ftp: number): number | undefined {
  if (!Number.isFinite(np) || !Number.isFinite(ftp) || ftp <= 0) return undefined;
  return np / ftp;
}

// 训练压力分 TSS = IF² × 时长(小时) × 100。
export function trainingStressScore(ifValue: number, movingTimeS: number): number | undefined {
  if (!Number.isFinite(ifValue) || ifValue < 0 || !Number.isFinite(movingTimeS) || movingTimeS < 0) return undefined;
  return ifValue * ifValue * (movingTimeS / 3600) * 100;
}

// 相对强度 RS = (秒数 × NP × IF) / (FTP × 3600) × 100。
export function relativeStress(seconds: number, np: number, ifValue: number, ftp: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(np) || !Number.isFinite(ifValue)
    || !Number.isFinite(ftp) || ftp <= 0) return undefined;
  return (seconds * np * ifValue) / (ftp * 3600) * 100;
}

// 每个 TSS 耗时 = 总时长 / TSS（秒/分）。
export function timePerTss(elapsedTimeS: number, tss: number): number | undefined {
  if (!Number.isFinite(elapsedTimeS) || elapsedTimeS < 0 || !Number.isFinite(tss) || tss <= 0) return undefined;
  return elapsedTimeS / tss;
}

// ── 心率负荷 heartRateLoad ──────────────────────────────────────────────────

// 效率因子 EF = NP / 平均心率（W/bpm）。
export function efficiencyFactor(np: number, avgHr: number): number | undefined {
  if (!Number.isFinite(np) || !Number.isFinite(avgHr) || avgHr <= 0) return undefined;
  return np / avgHr;
}

// 心率上升速率（漂移）= (后半段心率 - 前半段心率) / 前半段心率 × 100。正值 = 心率上升。
export function heartRateDriftPercent(firstHalfHr: number, secondHalfHr: number): number | undefined {
  if (!Number.isFinite(firstHalfHr) || !Number.isFinite(secondHalfHr) || firstHalfHr <= 0) return undefined;
  return ((secondHalfHr - firstHalfHr) / firstHalfHr) * 100;
}

// 心率恢复 = 骑行结束时心率 - 骑行后 1–2 分钟心率（bpm 降幅）。依赖停表后数据。
export function heartRateRecovery(endHr: number, postRideHr: number): number | undefined {
  if (!Number.isFinite(endHr) || !Number.isFinite(postRideHr)) return undefined;
  return endHr - postRideHr;
}

// ── 跨传感器配合 crossSensorCoordination ───────────────────────────────────

// 有氧解耦 Pw:Hr = (前半段 NP/HR - 后半段 NP/HR) / 前半段 NP/HR × 100。正值 = 解耦。
export function pwHrDecouplingPercent(firstHalfNpHr: number, secondHalfNpHr: number): number | undefined {
  if (!Number.isFinite(firstHalfNpHr) || !Number.isFinite(secondHalfNpHr) || firstHalfNpHr <= 0) return undefined;
  return ((firstHalfNpHr - secondHalfNpHr) / firstHalfNpHr) * 100;
}

// 速度-功率比 V/P = 速度 / 功率（骑行经济性综合指标）。
export function speedPowerRatio(speedMps: number, powerW: number): number | undefined {
  if (!Number.isFinite(speedMps) || !Number.isFinite(powerW) || powerW <= 0) return undefined;
  return speedMps / powerW;
}

// 时间相关系数（Pearson）：供踏频-功率同步性、坡度-功率匹配等"两序列对齐"指标复用。
// 两序列长度须一致且 ≥2；任一方零方差返回 undefined（无相关性定义）。
export function timeCorrelation(x: number[], y: number[]): number | undefined {
  if (x.length !== y.length || x.length < 2) return undefined;
  if (x.some((value) => !Number.isFinite(value)) || y.some((value) => !Number.isFinite(value))) return undefined;
  const n = x.length;
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return undefined;
  return numerator / Math.sqrt(denX * denY);
}
