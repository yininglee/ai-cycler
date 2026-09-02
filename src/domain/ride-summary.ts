import { buildRideCapability, validateRideActivity } from "./ride-rules.ts";
import type {
  Confidence,
  DataLevel,
  Metric,
  MetricKey,
  RideActivity,
  RideCapabilityProfile,
  SensorKind,
  SensorQuality,
} from "./ride-schema.ts";

export const RIDE_CONTEXT_SNAPSHOT_VERSION = "1.0" as const;
export const B0_TEMPLATE_VERSION = "b0-template-v0.1" as const;
export const RIDE_RULES_VERSION = "ride-rules-v0.1" as const;

export interface SnapshotMetric {
  value: number;
  unit: Metric["unit"];
  evidenceId: string;
  confidence: Confidence;
  formulaVersion?: string;
}

export interface AllowedClaim {
  claimId: string;
  metricKey: MetricKey;
  text: string;
  value: number;
  unit: Metric["unit"];
  displayValue: string;
  evidenceId: string;
  provenance: Metric["provenance"];
  confidence: Confidence;
  formulaVersion?: string;
}

export interface RideContextSnapshot {
  schemaVersion: typeof RIDE_CONTEXT_SNAPSHOT_VERSION;
  rulesVersion: typeof RIDE_RULES_VERSION;
  rideId: string;
  userScope: string;
  dataLevel: DataLevel;
  analysisMode: RideCapabilityProfile["analysisMode"];
  recordedMetrics: Partial<Record<MetricKey, SnapshotMetric>>;
  derivedMetrics: Partial<Record<MetricKey, SnapshotMetric>>;
  estimatedMetrics: Partial<Record<MetricKey, SnapshotMetric>>;
  quality: {
    sensors: Partial<Record<SensorKind, SensorQuality>>;
    issueCodes: string[];
  };
  allowedClaims: AllowedClaim[];
  forbiddenClaims: string[];
  limitations: string[];
  safetyFlags: string[];
  privacyFlags: string[];
}

export interface RideAnalysisOutput {
  headline: string;
  summary: string;
  highlights: Array<{
    text: string;
    claimIds: string[];
    confidence: Confidence;
  }>;
  nextAction: {
    text: string;
    basisClaimIds: string[];
  };
  limitations: string[];
  safetyLevel: "normal" | "caution" | "stop";
  shareCopy: [string, string, string];
}

export interface B0RideAnalysis {
  templateVersion: typeof B0_TEMPLATE_VERSION;
  snapshot: RideContextSnapshot;
  output: RideAnalysisOutput;
}

const METRIC_ORDER: MetricKey[] = [
  "distanceM",
  "movingTimeS",
  "elapsedTimeS",
  "avgSpeedMps",
  "elevationGainM",
  "avgHeartRateBpm",
  "maxHeartRateBpm",
  "avgPowerW",
  "normalizedPowerW",
  "avgCadenceRpm",
  "maxSpeedMps",
];

const BASE_METRICS = new Set<MetricKey>([
  "distanceM",
  "elapsedTimeS",
  "movingTimeS",
  "elevationGainM",
  "avgSpeedMps",
  "maxSpeedMps",
  "activityEnergyKcal",
]);
const HEART_RATE_METRICS = new Set<MetricKey>(["avgHeartRateBpm", "maxHeartRateBpm", "avgCadenceRpm", "maxCadenceRpm"]);
const POWER_METRICS = new Set<MetricKey>(["avgPowerW", "maxPowerW", "normalizedPowerW"]);

const LABELS: Record<MetricKey, string> = {
  distanceM: "距离",
  elapsedTimeS: "总时间",
  movingTimeS: "骑行时间",
  elevationGainM: "累计爬升",
  elevationLossM: "累计下降",
  avgSpeedMps: "平均速度",
  maxSpeedMps: "最高速度",
  avgHeartRateBpm: "平均心率",
  maxHeartRateBpm: "最高心率",
  avgPowerW: "平均功率",
  maxPowerW: "最大功率",
  normalizedPowerW: "标准化功率",
  avgCadenceRpm: "平均踏频",
  maxCadenceRpm: "最大踏频",
  activityEnergyKcal: "运动消耗",
};

function compactNumber(value: number, fractionDigits = 1): string {
  return Number(value.toFixed(fractionDigits)).toString();
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function formatMetric(key: MetricKey, metric: Metric): string {
  switch (key) {
    case "distanceM":
      return `${compactNumber(metric.value / 1_000)} km`;
    case "elapsedTimeS":
    case "movingTimeS":
      return formatDuration(metric.value);
    case "avgSpeedMps":
    case "maxSpeedMps":
      return `${compactNumber(metric.value * 3.6)} km/h`;
    case "elevationGainM":
    case "elevationLossM":
      return `${Math.round(metric.value)} m`;
    case "avgHeartRateBpm":
    case "maxHeartRateBpm":
      return `${Math.round(metric.value)} bpm`;
    case "avgPowerW":
    case "maxPowerW":
    case "normalizedPowerW":
      return `${Math.round(metric.value)} W`;
    case "avgCadenceRpm":
    case "maxCadenceRpm":
      return `${Math.round(metric.value)} rpm`;
    case "activityEnergyKcal":
      return `${Math.round(metric.value)} kcal`;
  }
}

function metricAllowed(key: MetricKey, dataLevel: DataLevel): boolean {
  if (BASE_METRICS.has(key)) return true;
  if (HEART_RATE_METRICS.has(key)) return dataLevel === "L2" || dataLevel === "L3";
  if (POWER_METRICS.has(key)) return dataLevel === "L3";
  return false;
}

function snapshotMetric(metric: Metric): SnapshotMetric {
  return {
    value: metric.value,
    unit: metric.unit,
    evidenceId: metric.evidenceId,
    confidence: metric.confidence,
    ...(metric.formulaVersion ? { formulaVersion: metric.formulaVersion } : {}),
  };
}

function normalizeLimitation(code: string, fallback: string): string {
  const known: Record<string, string> = {
    MISSING_TIMESTAMPS: "缺少可靠时间戳，不能计算速度或时长",
    HEART_RATE_NOT_USABLE: "心率覆盖不足或存在无效样本，已按无可靠心率处理",
    POWER_NOT_USABLE: "功率覆盖不足或存在无效样本，已按无可靠功率处理",
    FIT_DEVELOPER_FIELD_IGNORED: "检测到未支持的FIT开发字段，已安全忽略",
    FIT_ALL_ZERO_POWER_IGNORED: "功率字段仅包含占位值，已按无有效功率处理",
    FIT_ALL_ZERO_HEART_RATE_IGNORED: "心率字段仅包含占位值，已按无有效心率处理",
    FIT_ALL_ZERO_CADENCE_IGNORED: "踏频字段仅包含占位值，已按无有效踏频处理",
    GPX_GPS_SPIKE_FILTERED: "检测到GPS孤立跳点，已在计算距离和速度前过滤",
  };
  return known[code] ?? fallback;
}

function normalizeCapabilityLimitation(message: string): string {
  if (message.includes("GPX 没有可靠时间戳")) return "缺少可靠时间戳，不能计算速度或时长";
  if (message.includes("GPS孤立跳点") || message.includes("gpx-gps-quality")) {
    return "检测到GPS孤立跳点，已在计算距离和速度前过滤";
  }
  if (message.includes("心率覆盖不足")) return "心率覆盖不足或存在无效样本，已按无可靠心率处理";
  if (message.includes("功率覆盖不足")) return "功率覆盖不足或存在无效样本，已按无可靠功率处理";
  if (message.includes("心率字段仅包含占位值")) return "心率字段仅包含占位值，已按无有效心率处理";
  if (message.includes("踏频字段仅包含占位值")) return "踏频字段仅包含占位值，已按无有效踏频处理";
  if (message.includes("FIT开发字段") || message.includes("FIT 开发字段")) {
    return "检测到未支持的FIT开发字段，已安全忽略";
  }
  return message
    .replace("骑行距离不足 3 km", "骑行距离较短")
    .replace("骑行时长不足 10 分钟", "骑行时长较短");
}

function buildClaims(activity: RideActivity, capability: RideCapabilityProfile): AllowedClaim[] {
  if (capability.analysisMode === "rejected") return [];
  return METRIC_ORDER.flatMap((metricKey) => {
    const metric = activity.metrics[metricKey];
    if (!metric || !metricAllowed(metricKey, capability.dataLevel)) return [];
    const displayValue = formatMetric(metricKey, metric);
    return [{
      claimId: `claim:${activity.rideId}:${metricKey}`,
      metricKey,
      text: `${LABELS[metricKey]} ${displayValue}`,
      value: metric.value,
      unit: metric.unit,
      displayValue,
      evidenceId: metric.evidenceId,
      provenance: metric.provenance,
      confidence: metric.confidence,
      ...(metric.formulaVersion ? { formulaVersion: metric.formulaVersion } : {}),
    } satisfies AllowedClaim];
  });
}

export function buildRideContextSnapshot(
  activity: RideActivity,
  userScope = "local-demo",
): RideContextSnapshot {
  if (!userScope.trim()) throw new Error("userScope must not be empty");
  const validation = validateRideActivity(activity);
  const capability = buildRideCapability(activity);
  const recordedMetrics: RideContextSnapshot["recordedMetrics"] = {};
  const derivedMetrics: RideContextSnapshot["derivedMetrics"] = {};
  const estimatedMetrics: RideContextSnapshot["estimatedMetrics"] = {};

  for (const [metricKey, metric] of Object.entries(activity.metrics) as [MetricKey, Metric][]) {
    if (metricKey === "elevationLossM") continue;
    const target = metric.provenance === "recorded"
      ? recordedMetrics
      : metric.provenance === "calculated"
        ? derivedMetrics
        : estimatedMetrics;
    target[metricKey] = snapshotMetric(metric);
  }

  return {
    schemaVersion: RIDE_CONTEXT_SNAPSHOT_VERSION,
    rulesVersion: RIDE_RULES_VERSION,
    rideId: activity.rideId,
    userScope,
    dataLevel: capability.dataLevel,
    analysisMode: capability.analysisMode,
    recordedMetrics,
    derivedMetrics,
    estimatedMetrics,
    quality: {
      sensors: structuredClone(activity.sensorQuality),
      issueCodes: validation.issues.map((item) => item.code),
    },
    allowedClaims: buildClaims(activity, capability),
    forbiddenClaims: [...capability.forbiddenTopics],
    limitations: [...new Set([
      ...validation.issues.map((item) => normalizeLimitation(item.code, item.message)),
      ...capability.limitations.map(normalizeCapabilityLimitation),
    ])],
    safetyFlags: [],
    privacyFlags: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"],
  };
}

function summaryText(snapshot: RideContextSnapshot): string {
  if (snapshot.analysisMode === "rejected") {
    return "这条记录存在数据缺失、损坏或字段矛盾，当前不能安全生成骑行结论。请检查原始文件后重新导入；系统不会从冲突数据中自行选择数值。";
  }
  if (snapshot.analysisMode === "basic") {
    const hasRouteDistance = Boolean(snapshot.recordedMetrics.distanceM || snapshot.derivedMetrics.distanceM);
    return hasRouteDistance
      ? "这条记录的可用基础事实已经整理，但骑行距离较短、时长不足或时间信息不完整，因此只展示能够追溯的记录，不评价训练效果、恢复需求或体能变化。"
      : "这条记录缺少完整路线距离背景，但已有的传感器或时间事实可以追溯；本次仅展示这些事实，不评价训练效果、恢复需求或体能变化。";
  }
  if (snapshot.dataLevel === "L1") {
    return "本次骑行的距离、时间、速度与爬升等基础事实已经整理。当前缺少可靠的心率和功率依据，因此只回顾记录本身，不判断训练强度、恢复需求或体能变化。";
  }
  if (snapshot.dataLevel === "L2") {
    return "本次骑行的基础事实和可靠心率记录已经整理，可用于回顾当次节奏和心率表现。当前缺少可靠功率与长期可比数据，因此不判断功率表现、恢复需求或体能变化。";
  }
  return "本次骑行的基础事实、心率与功率记录已经整理，可用于回顾当次输出。当前没有长期可比数据或完整训练负荷背景，因此不判断体能变化，也不生成处方型训练计划。";
}

function headline(snapshot: RideContextSnapshot): string {
  if (snapshot.analysisMode === "rejected") return "这条记录暂时无法解读";
  if (snapshot.analysisMode === "basic") return "先查看这次的基础记录";
  if (snapshot.dataLevel === "L1") return "本次基础记录已整理";
  if (snapshot.dataLevel === "L2") return "本次心率记录已整理";
  return "本次功率记录已整理";
}

function preferredHighlightKeys(snapshot: RideContextSnapshot): MetricKey[] {
  if (snapshot.analysisMode === "basic") {
    const hasRouteDistance = snapshot.allowedClaims.some((claim) => claim.metricKey === "distanceM");
    if (!hasRouteDistance && snapshot.dataLevel === "L3") return ["avgPowerW", "normalizedPowerW", "movingTimeS"];
    if (!hasRouteDistance && snapshot.dataLevel === "L2") return ["avgHeartRateBpm", "maxHeartRateBpm", "movingTimeS"];
    return ["distanceM", "movingTimeS", "elevationGainM"];
  }
  if (snapshot.dataLevel === "L3") return ["distanceM", "avgPowerW", "avgSpeedMps"];
  if (snapshot.dataLevel === "L2") return ["distanceM", "avgHeartRateBpm", "avgSpeedMps"];
  return ["distanceM", "movingTimeS", "avgSpeedMps"];
}

function chooseBasisClaim(snapshot: RideContextSnapshot): AllowedClaim | undefined {
  const preferred = snapshot.dataLevel === "L3"
    ? "avgPowerW"
    : snapshot.dataLevel === "L2"
      ? "avgHeartRateBpm"
      : "distanceM";
  return snapshot.allowedClaims.find((claim) => claim.metricKey === preferred) ?? snapshot.allowedClaims[0];
}

function nextAction(snapshot: RideContextSnapshot): RideAnalysisOutput["nextAction"] {
  const basis = chooseBasisClaim(snapshot);
  if (snapshot.analysisMode === "rejected") {
    return { text: "检查原始文件是否完整，或换一条记录重新导入。", basisClaimIds: [] };
  }
  if (snapshot.analysisMode === "basic") {
    return {
      text: "保留这次基础记录；下次补充完整时间信息或更长记录后再判断强度。",
      basisClaimIds: basis ? [basis.claimId] : [],
    };
  }
  if (snapshot.dataLevel === "L1") {
    return {
      text: "下次可使用心率设备，让强度判断有更可靠的依据。",
      basisClaimIds: basis ? [basis.claimId] : [],
    };
  }
  if (snapshot.dataLevel === "L2") {
    return {
      text: "结合当时体感核对心率记录，再决定下一次是否调整节奏。",
      basisClaimIds: basis ? [basis.claimId] : [],
    };
  }
  return {
    text: "结合当时体感核对功率记录，再决定下一次是否调整训练。",
    basisClaimIds: basis ? [basis.claimId] : [],
  };
}

function outputLimitations(snapshot: RideContextSnapshot): string[] {
  if (snapshot.analysisMode === "rejected") {
    return snapshot.limitations.length > 0
      ? snapshot.limitations
      : ["记录未通过数据校验，不能生成骑行结论"];
  }
  const levelLimitation = snapshot.dataLevel === "L1"
    ? "缺少可靠心率与功率，不能判断训练强度或恢复需求"
    : snapshot.dataLevel === "L2"
      ? "缺少可靠功率，不能讨论功率表现或训练负荷"
      : "缺少长期可比数据，不判断体能趋势或给出训练处方";
  return [...new Set([...snapshot.limitations, levelLimitation])];
}

export function generateB0RideAnalysis(
  activity: RideActivity,
  userScope = "local-demo",
): B0RideAnalysis {
  const snapshot = buildRideContextSnapshot(activity, userScope);
  const preferredKeys = preferredHighlightKeys(snapshot);
  const highlights = preferredKeys.flatMap((metricKey) => {
    const claim = snapshot.allowedClaims.find((item) => item.metricKey === metricKey);
    return claim ? [{ text: claim.text, claimIds: [claim.claimId], confidence: claim.confidence }] : [];
  }).slice(0, 3);
  const shareCopy: RideAnalysisOutput["shareCopy"] = snapshot.analysisMode === "rejected"
    ? [
        "这条骑行记录暂时无法生成分享内容。",
        "记录需要重新导入后再生成分享内容。",
        "数据暂不可用，检查文件后再试。",
      ]
    : [
        "完成一次骑行记录，先把数据看懂。",
        "骑完回看可靠事实，下一次更有数。",
        "每次骑行都值得被认真记录。",
      ];

  return {
    templateVersion: B0_TEMPLATE_VERSION,
    snapshot,
    output: {
      headline: headline(snapshot),
      summary: summaryText(snapshot),
      highlights,
      nextAction: nextAction(snapshot),
      limitations: outputLimitations(snapshot),
      safetyLevel: "normal",
      shareCopy,
    },
  };
}

export interface B0ValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateB0RideAnalysis(result: B0RideAnalysis): B0ValidationResult {
  const issues: string[] = [];
  const { snapshot, output } = result;
  const claimById = new Map(snapshot.allowedClaims.map((claim) => [claim.claimId, claim]));

  if (result.templateVersion !== B0_TEMPLATE_VERSION) issues.push("INVALID_TEMPLATE_VERSION");
  if (output.headline.length === 0 || output.headline.length > 20) issues.push("INVALID_HEADLINE_LENGTH");
  if (output.summary.length === 0 || output.summary.length > 120) issues.push("INVALID_SUMMARY_LENGTH");
  if (output.highlights.length > 3) issues.push("TOO_MANY_HIGHLIGHTS");
  if (output.shareCopy.length !== 3 || output.shareCopy.some((copy) => copy.length > 50)) {
    issues.push("INVALID_SHARE_COPY");
  }
  if (snapshot.analysisMode === "rejected" && snapshot.allowedClaims.length > 0) {
    issues.push("REJECTED_RECORD_HAS_CLAIMS");
  }

  const claimIds = snapshot.allowedClaims.map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) issues.push("DUPLICATE_CLAIM_ID");

  for (const claim of snapshot.allowedClaims) {
    if (!claim.evidenceId) issues.push("CLAIM_WITHOUT_EVIDENCE");
    if (claim.provenance === "calculated" && !claim.formulaVersion) {
      issues.push("CALCULATED_CLAIM_WITHOUT_FORMULA");
    }
    if (snapshot.dataLevel === "L1" && (HEART_RATE_METRICS.has(claim.metricKey) || POWER_METRICS.has(claim.metricKey))) {
      issues.push("L1_CAPABILITY_VIOLATION");
    }
    if (snapshot.dataLevel === "L2" && POWER_METRICS.has(claim.metricKey)) {
      issues.push("L2_CAPABILITY_VIOLATION");
    }
  }

  for (const highlight of output.highlights) {
    if (highlight.claimIds.length === 0) issues.push("HIGHLIGHT_WITHOUT_CLAIM");
    for (const claimId of highlight.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) issues.push("UNKNOWN_HIGHLIGHT_CLAIM");
      else if (highlight.text !== claim.text) issues.push("HIGHLIGHT_NOT_GROUNDED");
    }
  }
  for (const claimId of output.nextAction.basisClaimIds) {
    if (!claimById.has(claimId)) issues.push("UNKNOWN_ACTION_CLAIM");
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
