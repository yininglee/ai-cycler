// TSS（Training Stress Score）计算 —— AGT-B1 新增。
//
// 为什么新增：`ride-pmc-load-v2` 的输入要求"每条骑行日的 TSS"，但全库没有任何模块
// 计算它——V2.1 spec 只有 `intensity.tss` 的公式定义（`TSS = IF² × 时长(h) × 100`），
// `ride-derived-metrics-v21.ts` 只有 `timePerTss` 辅助函数，`buildRidePmcLoadV2` 全库
// 零调用方。因此 B0 审查把这条链路认定为"新增工作"而非"封装"，B1 在此补齐。
//
// 位置选择：按项目原则（派生指标由规则函数算、LLM 只叙事），TSS 属派生指标，放 domain 层；
// chat 工具（`get_training_load`）只做组装与投影，不参与计算。
//
// 口径（与 V2.1 spec `intensity.tss` 的声明严格对齐，验收 2026-10-24 修正）：
//   dependencies: ["intensity.if", "timing.movingTimeS"]
//   IF  = NP / FTP                      （强度因子，无量纲）
//   TSS = IF² × movingTimeS(小时) × 100
// **时长只用 movingTimeS（骑行时间，不含停歇）**——初版曾允许"缺失时退回 elapsedTimeS"，
// 验收时发现这与 spec 的依赖声明冲突：通勤骑 elapsed 远大于 moving，把停歇算进负荷
// 会系统性高估 TSS 并污染 PMC 下游。movingTimeS 缺失即 unavailable，不做退回、不估算。

export const RIDE_TSS_RULES_VERSION = "ride-tss-v1.1" as const;

export type RideTssUnavailableReason =
  | "FTP_MISSING"
  | "POWER_MISSING"
  | "DURATION_MISSING"
  | "INVALID_INPUT";

export type RideTssResult =
  | {
    status: "available";
    rulesVersion: typeof RIDE_TSS_RULES_VERSION;
    tss: number;
    intensityFactor: number;
    movingTimeS: number;
  }
  | { status: "unavailable"; rulesVersion: typeof RIDE_TSS_RULES_VERSION; reason: RideTssUnavailableReason };

export type RideTssInput = {
  normalizedPowerW?: number;
  ftpWatts?: number;
  movingTimeS?: number;
};

export function computeRideTss(input: RideTssInput): RideTssResult {
  const { normalizedPowerW, ftpWatts, movingTimeS } = input;

  if (ftpWatts === undefined || !Number.isFinite(ftpWatts) || ftpWatts <= 0) {
    return { status: "unavailable", rulesVersion: RIDE_TSS_RULES_VERSION, reason: "FTP_MISSING" };
  }
  if (normalizedPowerW === undefined || !Number.isFinite(normalizedPowerW) || normalizedPowerW <= 0) {
    return { status: "unavailable", rulesVersion: RIDE_TSS_RULES_VERSION, reason: "POWER_MISSING" };
  }
  if (movingTimeS === undefined || !Number.isFinite(movingTimeS) || movingTimeS <= 0) {
    return { status: "unavailable", rulesVersion: RIDE_TSS_RULES_VERSION, reason: "DURATION_MISSING" };
  }

  const intensityFactor = normalizedPowerW / ftpWatts;
  const tss = intensityFactor ** 2 * (movingTimeS / 3_600) * 100;
  if (!Number.isFinite(tss) || tss <= 0) {
    return { status: "unavailable", rulesVersion: RIDE_TSS_RULES_VERSION, reason: "INVALID_INPUT" };
  }

  return {
    status: "available",
    rulesVersion: RIDE_TSS_RULES_VERSION,
    // 保留一位小数：PMC 是逐日累加模型，喂原始浮点会让 CTL/ATL 出现无意义的抖动。
    tss: Math.round(tss * 10) / 10,
    intensityFactor: Math.round(intensityFactor * 100) / 100,
    movingTimeS,
  };
}
