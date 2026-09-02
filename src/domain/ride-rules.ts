import type {
  DataLevel,
  Metric,
  MetricKey,
  RideActivity,
  RideCapabilityProfile,
  RideIssue,
  RideValidationResult,
  SensorKind,
} from "./ride-schema.ts";

const MIN_FULL_DISTANCE_M = 3_000;
const MIN_FULL_DURATION_S = 600;
const MIN_SENSOR_COVERAGE = 0.8;
const MAX_INVALID_SAMPLE_RATIO = 0.02;
const SPEED_CONSISTENCY_TOLERANCE = 0.05;

const METRIC_BOUNDS: Partial<Record<MetricKey, { min: number; max: number }>> = {
  distanceM: { min: 0, max: 2_000_000 },
  elapsedTimeS: { min: 0, max: 604_800 },
  movingTimeS: { min: 0, max: 604_800 },
  elevationGainM: { min: 0, max: 30_000 },
  elevationLossM: { min: 0, max: 30_000 },
  avgSpeedMps: { min: 0, max: 40 },
  maxSpeedMps: { min: 0, max: 60 },
  avgHeartRateBpm: { min: 30, max: 240 },
  maxHeartRateBpm: { min: 30, max: 260 },
  avgPowerW: { min: 0, max: 3_000 },
  maxPowerW: { min: 0, max: 3_000 },
  normalizedPowerW: { min: 0, max: 3_000 },
  avgCadenceRpm: { min: 0, max: 250 },
  maxCadenceRpm: { min: 0, max: 250 },
  activityEnergyKcal: { min: 0, max: 50_000 },
};

const LEVEL_TOPICS: Record<DataLevel, { allowed: string[]; forbidden: string[] }> = {
  L1: {
    allowed: ["距离", "时长", "速度", "爬升", "路线回顾"],
    forbidden: ["心率区间", "功率", "FTP", "IF", "TSS", "恢复时间", "体能提升"],
  },
  L2: {
    allowed: ["距离", "时长", "速度", "爬升", "心率"],
    forbidden: ["心率区间", "功率", "FTP", "IF", "TSS", "功率输出"],
  },
  L3: {
    allowed: ["距离", "时长", "速度", "爬升", "心率", "功率"],
    forbidden: ["心率区间", "FTP", "功率区间", "IF", "TSS", "训练负荷", "医疗诊断", "保证提升"],
  },
};

function issue(
  code: string,
  severity: "warning" | "error",
  message: string,
  field?: string,
): RideIssue {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function isFiniteMetric(metric: Metric): boolean {
  return Number.isFinite(metric.value);
}

export function isRideSensorUsable(activity: RideActivity, sensor: SensorKind): boolean {
  const quality = activity.sensorQuality[sensor];
  const invalidRatio = quality && quality.sampleCount > 0
    ? quality.invalidSampleCount / quality.sampleCount
    : 1;
  return Boolean(
    quality &&
      quality.coverage >= MIN_SENSOR_COVERAGE &&
      invalidRatio <= MAX_INVALID_SAMPLE_RATIO,
  );
}

export function validateRideActivity(activity: RideActivity): RideValidationResult {
  const issues: RideIssue[] = [...activity.sourceIssues];

  if (activity.schemaVersion !== "0.2") {
    issues.push(issue("UNSUPPORTED_SCHEMA_VERSION", "error", "不支持的数据 Schema 版本", "schemaVersion"));
  }

  if (!activity.rideId.trim()) {
    issues.push(issue("MISSING_RIDE_ID", "error", "缺少骑行记录 ID", "rideId"));
  }

  if (activity.source.kind === "fit" && !activity.source.fileName?.toLowerCase().endsWith(".fit")) {
    issues.push(issue("SOURCE_EXTENSION_MISMATCH", "error", "FIT 来源必须使用 .fit 文件", "source.fileName"));
  }

  if (activity.source.kind === "gpx" && !activity.source.fileName?.toLowerCase().endsWith(".gpx")) {
    issues.push(issue("SOURCE_EXTENSION_MISMATCH", "error", "GPX 来源必须使用 .gpx 文件", "source.fileName"));
  }

  const evidenceIds = new Set<string>();
  for (const [key, metric] of Object.entries(activity.metrics) as [MetricKey, Metric][]) {
    if (!isFiniteMetric(metric)) {
      issues.push(issue("NON_FINITE_METRIC", "error", `${key} 不是有限数值`, `metrics.${key}`));
    }

    const bounds = METRIC_BOUNDS[key];
    if (bounds && (metric.value < bounds.min || metric.value > bounds.max)) {
      issues.push(issue("METRIC_OUT_OF_RANGE", "error", `${key} 超出合理范围`, `metrics.${key}`));
    }

    if (evidenceIds.has(metric.evidenceId)) {
      issues.push(issue("DUPLICATE_EVIDENCE_ID", "error", `证据 ID 重复：${metric.evidenceId}`, `metrics.${key}`));
    }
    evidenceIds.add(metric.evidenceId);

    if (!metric.sourceField.trim() || !metric.sourceUnit.trim()) {
      issues.push(issue("MISSING_METRIC_SOURCE", "error", "指标缺少原始字段或单位", `metrics.${key}`));
    }
    if (metric.qualityStatus !== "valid" && metric.qualityStatus !== "degraded") {
      issues.push(issue("INVALID_METRIC_QUALITY", "error", "指标质量状态无效", `metrics.${key}.qualityStatus`));
    }
    if (activity.startTime && !metric.recordedAt) {
      issues.push(issue("MISSING_METRIC_TIME", "error", "有活动时间时指标必须保留记录时间", `metrics.${key}.recordedAt`));
    }
    if (metric.recordedAt && Number.isNaN(Date.parse(metric.recordedAt))) {
      issues.push(issue("INVALID_METRIC_TIME", "error", "指标记录时间不是有效ISO时间", `metrics.${key}.recordedAt`));
    }

    if (metric.provenance === "calculated" && !metric.formulaVersion) {
      issues.push(issue("MISSING_FORMULA_VERSION", "error", `${key} 为计算值但缺少公式版本`, `metrics.${key}`));
    }
  }

  for (const [sensor, quality] of Object.entries(activity.sensorQuality)) {
    if (quality.coverage < 0 || quality.coverage > 1) {
      issues.push(issue("INVALID_SENSOR_COVERAGE", "error", `${sensor} 覆盖率必须位于 0 到 1`, `sensorQuality.${sensor}`));
    }
    if (quality.sampleCount < 0 || !Number.isInteger(quality.sampleCount)) {
      issues.push(issue("INVALID_SAMPLE_COUNT", "error", `${sensor} 总样本数必须为非负整数`, `sensorQuality.${sensor}`));
    }
    if (quality.invalidSampleCount < 0 || !Number.isInteger(quality.invalidSampleCount) || quality.invalidSampleCount > quality.sampleCount) {
      issues.push(issue("INVALID_SAMPLE_COUNT", "error", `${sensor} 无效样本数必须为非负整数`, `sensorQuality.${sensor}`));
    }
  }

  const distance = activity.metrics.distanceM?.value;
  const movingTime = activity.metrics.movingTimeS?.value;
  const elapsedTime = activity.metrics.elapsedTimeS?.value;
  const avgSpeed = activity.metrics.avgSpeedMps?.value;
  if (distance && avgSpeed) {
    // FIT devices may calculate the recorded average speed against either
    // timer time or elapsed time. Accept either traceable time basis; reject
    // only when both available bases materially disagree with the summary.
    const candidateTimes = [movingTime, elapsedTime].filter(
      (value): value is number => value !== undefined && value > 0,
    );
    const matchesAnyTimeBasis = candidateTimes.some((duration) => {
      const calculatedSpeed = distance / duration;
      const relativeError = Math.abs(calculatedSpeed - avgSpeed) / calculatedSpeed;
      return relativeError <= SPEED_CONSISTENCY_TOLERANCE;
    });
    if (candidateTimes.length > 0 && !matchesAnyTimeBasis) {
      issues.push(issue("INCONSISTENT_AVG_SPEED", "error", "均速与距离及可用时间口径不一致", "metrics.avgSpeedMps"));
    }
  }

  if (activity.metrics.maxHeartRateBpm && activity.metrics.avgHeartRateBpm &&
      activity.metrics.maxHeartRateBpm.value < activity.metrics.avgHeartRateBpm.value) {
    issues.push(issue("INCONSISTENT_HEART_RATE", "error", "最大心率低于平均心率", "metrics.maxHeartRateBpm"));
  }

  if (activity.metrics.maxSpeedMps && activity.metrics.avgSpeedMps &&
      activity.metrics.maxSpeedMps.value < activity.metrics.avgSpeedMps.value) {
    issues.push(issue("INCONSISTENT_SPEED", "error", "最高速度低于平均速度", "metrics.maxSpeedMps"));
  }

  if (activity.source.kind === "gpx" && !activity.startTime) {
    issues.push(issue("MISSING_TIMESTAMPS", "warning", "GPX 没有可靠时间戳，不能计算速度或时长"));
    if (activity.metrics.elapsedTimeS || activity.metrics.movingTimeS || activity.metrics.avgSpeedMps || activity.metrics.maxSpeedMps) {
      issues.push(issue("UNTRUSTED_GPX_TIMING", "error", "无时间戳 GPX 不得包含时长或速度结论"));
    }
  }

  if (activity.metrics.avgHeartRateBpm && !isRideSensorUsable(activity, "heart_rate")) {
    issues.push(issue("HEART_RATE_NOT_USABLE", "warning", "心率覆盖不足或存在无效样本，降级处理"));
  }

  if (activity.metrics.avgPowerW && !isRideSensorUsable(activity, "power")) {
    issues.push(issue("POWER_NOT_USABLE", "warning", "功率覆盖不足或存在无效样本，降级处理"));
  }

  return { valid: !issues.some((item) => item.severity === "error"), issues };
}

export function buildRideCapability(activity: RideActivity): RideCapabilityProfile {
  const validation = validateRideActivity(activity);
  const availableMetrics = Object.keys(activity.metrics) as MetricKey[];
  const usablePower = Boolean(activity.metrics.avgPowerW) && isRideSensorUsable(activity, "power");
  const usableHeartRate = Boolean(activity.metrics.avgHeartRateBpm) && isRideSensorUsable(activity, "heart_rate");

  const dataLevel: DataLevel = usablePower ? "L3" : usableHeartRate ? "L2" : "L1";
  const limitations = validation.issues.map((item) => item.message);

  const distance = activity.metrics.distanceM?.value;
  const duration = activity.metrics.movingTimeS?.value ?? activity.metrics.elapsedTimeS?.value;
  const hasReliableTiming = !(activity.source.kind === "gpx" && !activity.startTime);
  const hasMinimumSample = Boolean(
    hasReliableTiming &&
    distance !== undefined &&
      distance >= MIN_FULL_DISTANCE_M &&
      duration !== undefined &&
      duration >= MIN_FULL_DURATION_S,
  );
  // Indoor or sensor-only records can intentionally omit route distance while
  // still carrying reliable heart-rate/power evidence. Keep those records in
  // the basic deterministic path instead of treating the missing route field
  // as a contradiction that invalidates every capability.
  const hasUsableAnalysisMetric = Boolean(
    activity.metrics.movingTimeS ||
    activity.metrics.elapsedTimeS ||
    activity.metrics.avgSpeedMps ||
    activity.metrics.avgHeartRateBpm && usableHeartRate ||
    activity.metrics.avgPowerW && usablePower ||
    activity.metrics.avgCadenceRpm ||
    activity.metrics.elevationGainM,
  );

  let analysisMode: RideCapabilityProfile["analysisMode"];
  if (!validation.valid || (!hasUsableAnalysisMetric && (distance === undefined || distance <= 0))) {
    analysisMode = "rejected";
  } else if (!hasMinimumSample) {
    analysisMode = "basic";
    if (distance === undefined) limitations.push("缺少完整路线距离，仅展示可追溯的基础事实");
    else if (distance < MIN_FULL_DISTANCE_M) limitations.push("骑行距离不足 3 km，仅展示基础事实");
    if (duration === undefined) limitations.push("缺少可靠时长，不能生成速度或完整强度解读");
    else if (duration < MIN_FULL_DURATION_S) limitations.push("骑行时长不足 10 分钟，仅展示基础事实");
  } else {
    analysisMode = "full";
  }

  const allowedTopics = LEVEL_TOPICS[dataLevel].allowed.filter((topic) => {
    if (topic === "时长") return Boolean(activity.metrics.movingTimeS || activity.metrics.elapsedTimeS);
    if (topic === "速度") return Boolean(activity.metrics.avgSpeedMps || activity.metrics.maxSpeedMps);
    if (topic === "爬升") return Boolean(activity.metrics.elevationGainM);
    if (topic === "心率" || topic === "心率区间") return usableHeartRate;
    if (topic === "功率") return usablePower;
    return true;
  });

  return {
    rideId: activity.rideId,
    dataLevel,
    analysisMode,
    availableMetrics,
    allowedTopics,
    forbiddenTopics: LEVEL_TOPICS[dataLevel].forbidden,
    limitations: [...new Set(limitations)],
  };
}

export const rideRuleThresholds = {
  minimumFullDistanceM: MIN_FULL_DISTANCE_M,
  minimumFullDurationS: MIN_FULL_DURATION_S,
  minimumSensorCoverage: MIN_SENSOR_COVERAGE,
  maximumInvalidSampleRatio: MAX_INVALID_SAMPLE_RATIO,
  speedConsistencyTolerance: SPEED_CONSISTENCY_TOLERANCE,
} as const;
