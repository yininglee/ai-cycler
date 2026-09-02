import type { AnalysisContextClaim } from "./ride-analysis-context.ts";
import { buildRideElevationSummary } from "./ride-elevation.ts";
import { buildRideEventClimbSummary, type RideEventClimb } from "./ride-event-climbs.ts";
import { buildRidePowerSummary, type PowerZoneBin } from "./ride-power.ts";
import { buildRideRouteShapeSummary } from "./ride-route-shape.ts";
import type { AtomicCapabilityKey } from "./atomic-capabilities.ts";
import type { RideRecord } from "./ride-schema.ts";
import { buildRideTimingSummary } from "./ride-timing.ts";
import type { UserProfile } from "./user-profile.ts";
import { buildCadenceZoneDistribution, buildHeartRateZoneDistribution, type ZoneDistribution } from "./ride-zones.ts";

export const RIDE_ADVANCED_CLAIM_RULES_VERSION = "ride-advanced-claim-rules-v0.1" as const;

export interface RideAdvancedClaimSnapshot {
  rulesVersion: typeof RIDE_ADVANCED_CLAIM_RULES_VERSION;
  claims: AnalysisContextClaim[];
  limitations: string[];
  availableCapabilityKeys: AtomicCapabilityKey[];
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function compact(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

function duration(seconds: number): string {
  const roundedMinutes = Math.round(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function claim(
  rideId: string,
  key: string,
  evidenceIds: string[],
  details: Omit<AnalysisContextClaim, "claimId" | "kind" | "key" | "evidenceIds" | "confidence" | "provenance" | "formulaVersion">,
): AnalysisContextClaim {
  return {
    claimId: `claim:${rideId}:advanced:${key}`,
    kind: "advanced",
    key,
    confidence: "high",
    provenance: "calculated",
    evidenceIds,
    formulaVersion: RIDE_ADVANCED_CLAIM_RULES_VERSION,
    ...details,
  };
}

function metricEvidence(record: RideRecord, key: string): string[] {
  const metric = record.activity.metrics[key as keyof typeof record.activity.metrics];
  return metric?.qualityStatus === "valid" ? [metric.evidenceId] : [];
}

function ruleEvidence(rideId: string, rule: string, key: string): string[] {
  return [`evidence:${rideId}:advanced:${rule}:${key}`];
}

function zoneClaims(
  record: RideRecord,
  prefix: "heartRate" | "cadence" | "power",
  distribution: ZoneDistribution | undefined,
  evidenceIds: string[],
): AnalysisContextClaim[] {
  if (!distribution || distribution.unavailableReason) return [];
  const claims: AnalysisContextClaim[] = [claim(record.activity.rideId, `${prefix}.coverage`, evidenceIds, {
    value: distribution.coverage,
    unit: "ratio",
    text: `${prefix === "heartRate" ? "心率" : prefix === "cadence" ? "踏频" : "功率"}有效覆盖 ${(distribution.coverage * 100).toFixed(0)}%`,
    displayValue: compact(distribution.coverage * 100, 0),
    displayUnit: "%",
  })];
  for (const bin of distribution.bins) {
    if (bin.durationS <= 0) continue;
    claims.push(claim(record.activity.rideId, `${prefix}.zone.${bin.key}`, evidenceIds, {
      value: bin.durationS,
      unit: "s",
      text: `${bin.label}：${duration(bin.durationS)}，占有效骑行时间 ${(bin.share * 100).toFixed(0)}%`,
      displayValue: duration(bin.durationS),
      displayUnit: "duration",
    }));
  }
  return claims;
}

function powerZoneClaims(
  record: RideRecord,
  bins: PowerZoneBin[] | undefined,
  coverage: number,
  evidenceIds: string[],
): AnalysisContextClaim[] {
  if (!bins) return [];
  const claims: AnalysisContextClaim[] = [claim(record.activity.rideId, "power.coverage", evidenceIds, {
    value: coverage,
    unit: "ratio",
    text: `功率有效覆盖 ${(coverage * 100).toFixed(0)}%`,
    displayValue: compact(coverage * 100, 0),
    displayUnit: "%",
  })];
  for (const bin of bins) {
    if (bin.durationS <= 0) continue;
    claims.push(claim(record.activity.rideId, `power.zone.${bin.key}`, evidenceIds, {
      value: bin.durationS,
      unit: "s",
      text: `${bin.label}：${duration(bin.durationS)}，占有效骑行时间 ${(bin.share * 100).toFixed(0)}%`,
      displayValue: duration(bin.durationS),
      displayUnit: "duration",
    }));
  }
  return claims;
}

function representativeClimbs(climbs: RideEventClimb[]): RideEventClimb[] {
  const categoryRank: Record<RideEventClimb["category"], number> = { HC: 5, "1": 4, "2": 3, "3": 2, "4": 1 };
  return [...climbs]
    .sort((a, b) => categoryRank[b.category] - categoryRank[a.category] || b.difficultyScore - a.difficultyScore || b.distanceM - a.distanceM)
    .slice(0, 3);
}

export function buildRideAdvancedClaimSnapshot(record: RideRecord, profile?: UserProfile): RideAdvancedClaimSnapshot {
  const claims: AnalysisContextClaim[] = [];
  const limitations: string[] = [];
  const capabilityKeys = new Set<AtomicCapabilityKey>();
  const rideId = record.activity.rideId;
  const timing = buildRideTimingSummary(record);

  if (timing.source !== "unavailable") {
    capabilityKeys.add("timing");
    if (finite(timing.elapsedAverageSpeedMps)) claims.push(claim(rideId, "timing.elapsedAverageSpeedMps", metricEvidence(record, "distanceM"), {
      value: timing.elapsedAverageSpeedMps,
      unit: "m/s",
      text: `总均速 ${compact(timing.elapsedAverageSpeedMps * 3.6)} km/h`,
      displayValue: compact(timing.elapsedAverageSpeedMps * 3.6),
      displayUnit: "km/h",
    }));
    if (finite(timing.movingAverageSpeedMps)) claims.push(claim(rideId, "timing.movingAverageSpeedMps", metricEvidence(record, "distanceM"), {
      value: timing.movingAverageSpeedMps,
      unit: "m/s",
      text: `移动均速 ${compact(timing.movingAverageSpeedMps * 3.6)} km/h`,
      displayValue: compact(timing.movingAverageSpeedMps * 3.6),
      displayUnit: "km/h",
    }));
    if (finite(timing.stoppedTimeS)) claims.push(claim(rideId, "timing.stoppedTimeS", ruleEvidence(rideId, timing.rulesVersion, "stopped"), {
      value: timing.stoppedTimeS,
      unit: "s",
      text: `停歇 ${duration(timing.stoppedTimeS)}`,
      displayValue: duration(timing.stoppedTimeS),
      displayUnit: "duration",
    }));

    const cruises = [...timing.cruiseSegments].sort((a, b) => Number(b.isLong) - Number(a.isLong) || b.durationS - a.durationS);
    const cruiseDurationS = cruises.reduce((total, item) => total + item.durationS, 0);
    if (cruiseDurationS > 0) {
      claims.push(claim(rideId, "cruise.totalDurationS", ruleEvidence(rideId, timing.rulesVersion, "cruise-total"), {
        value: cruiseDurationS,
        unit: "s",
        text: `识别到 ${cruises.length} 段巡航，合计 ${duration(cruiseDurationS)}`,
        displayValue: duration(cruiseDurationS),
        displayUnit: "duration",
      }));
      cruises.slice(0, 3).forEach((segment, index) => {
        claims.push(claim(rideId, `cruise.representative.${index + 1}`, ruleEvidence(rideId, timing.rulesVersion, `cruise-${index + 1}`), {
          value: segment.durationS,
          unit: "s",
          text: `${segment.isLong ? "长巡航" : "巡航"} ${duration(segment.durationS)}，均速 ${compact(segment.averageSpeedMps * 3.6)} km/h`,
          displayValue: duration(segment.durationS),
          displayUnit: "duration",
        }));
      });
    }
  } else {
    limitations.push("advanced.timing:unavailable");
  }

  const elevation = buildRideElevationSummary(record);
  const routeShape = buildRideRouteShapeSummary(elevation);
  if (routeShape.isAvailable) {
    capabilityKeys.add("route");
    capabilityKeys.add("elevation");
    for (const [key, label, value] of [
      ["route.trendClimbDistanceM", "长趋势爬坡里程", routeShape.trendClimbDistanceM],
      ["route.trendFlatDistanceM", "长趋势平路里程", routeShape.trendFlatDistanceM],
      ["route.trendDescentDistanceM", "长趋势下坡里程", routeShape.trendDescentDistanceM],
    ] as const) {
      claims.push(claim(rideId, key, ruleEvidence(rideId, routeShape.rulesVersion, key), {
        value,
        unit: "m",
        text: `${label} ${compact(value / 1_000)} km`,
        displayValue: compact(value / 1_000),
        displayUnit: "km",
      }));
    }
    if (routeShape.needsCoverageNotice) limitations.push(`advanced.route:partial_coverage:${compact(routeShape.coverageRatio * 100, 0)}%`);
  } else {
    limitations.push("advanced.route:unavailable");
  }

  for (const [key, label, value] of [
    ["elevation.minM", "最低海拔", elevation.minM],
    ["elevation.maxM", "最高海拔", elevation.maxM],
    ["elevation.rangeM", "海拔范围", elevation.rangeM],
  ] as const) {
    if (!finite(value)) continue;
    claims.push(claim(rideId, key, ruleEvidence(rideId, elevation.rulesVersion, key), {
      value,
      unit: "m",
      text: `${label} ${compact(value, 0)} m`,
      displayValue: compact(value, 0),
      displayUnit: "m",
    }));
  }

  const climbSummary = buildRideEventClimbSummary(elevation, routeShape, record);
  if (climbSummary.isAvailable) {
    representativeClimbs(climbSummary.climbs).forEach((climb, index) => {
      claims.push(claim(rideId, `climb.representative.${index + 1}`, ruleEvidence(rideId, climb.rulesVersion, `climb-${index + 1}`), {
        value: climb.distanceM,
        unit: "m",
        text: `${climb.category}级爬坡 ${compact(climb.distanceM / 1_000)} km，净爬升 ${compact(climb.netElevationGainM, 0)} m，平均坡度 ${(climb.averageGrade * 100).toFixed(1)}%`,
        displayValue: compact(climb.distanceM / 1_000),
        displayUnit: "km",
      }));
    });
  } else if (climbSummary.unavailableReasons.length > 0) {
    limitations.push(`advanced.climb:${climbSummary.unavailableReasons.join(",")}`);
  }

  const heartRate = buildHeartRateZoneDistribution(record, profile);
  if (!heartRate.unavailableReason && heartRate.baseline) {
    capabilityKeys.add("heartRateZones");
    claims.push(claim(rideId, "heartRate.baseline", ruleEvidence(rideId, heartRate.rulesVersion, "baseline"), {
      value: heartRate.baseline.maxHeartRateBpm,
      unit: "bpm",
      text: `心率分区基线 ${heartRate.baseline.maxHeartRateBpm} bpm（${heartRate.baseline.source === "user_provided" ? "用户填写" : "按年龄公式估算"}）`,
      displayValue: compact(heartRate.baseline.maxHeartRateBpm, 0),
      displayUnit: "bpm",
    }));
    claims.push(...zoneClaims(record, "heartRate", heartRate, ruleEvidence(rideId, heartRate.rulesVersion, "zones")));
    if (heartRate.baseline.source === "system_estimated") limitations.push("advanced.heartRate:baseline_system_estimated");
  } else {
    limitations.push(`advanced.heartRate:${heartRate.unavailableReason ?? "unavailable"}`);
  }

  const cadence = buildCadenceZoneDistribution(record);
  if (!cadence.unavailableReason) {
    capabilityKeys.add("cadence");
    claims.push(...zoneClaims(record, "cadence", cadence, ruleEvidence(rideId, cadence.rulesVersion, "zones")));
  } else {
    limitations.push(`advanced.cadence:${cadence.unavailableReason}`);
  }

  const power = buildRidePowerSummary(record, profile);
  if (power.qualityLevel !== "unavailable") {
    capabilityKeys.add("power");
    capabilityKeys.add("normalizedPower");
    if (power.zones) capabilityKeys.add("powerZones");
    if (power.trainingStressScore !== undefined) capabilityKeys.add("trainingLoad");
    claims.push(claim(rideId, "power.quality", ruleEvidence(rideId, power.rulesVersion, "quality"), {
      text: `功率数据质量：${power.qualityLevel === "hard" ? "完整" : "部分缺失，结果仅供参考"}；覆盖 ${(power.coverage * 100).toFixed(0)}%，最长缺口 ${compact(power.longestGapS, 0)} 秒`,
    }));
    const values: Array<[string, string, number | undefined, string]> = [
      ["power.averageW", "平均功率", power.averagePowerW, "W"],
      ["power.normalizedW", "标准化功率", power.normalizedPowerW, "W"],
      ["power.intensityFactor", "强度因子 IF", power.intensityFactor, "ratio"],
      ["power.trainingStressScore", "训练压力 TSS", power.trainingStressScore, "score"],
      ["power.averageWkg", "平均功体比", power.averagePowerToWeight, "W/kg"],
      ["power.normalizedWkg", "标准化功体比", power.normalizedPowerToWeight, "W/kg"],
    ];
    for (const [key, label, value, unit] of values) {
      if (!finite(value)) continue;
      claims.push(claim(rideId, key, ruleEvidence(rideId, power.rulesVersion, key), {
        value,
        unit,
        text: `${label} ${compact(value, unit === "ratio" ? 2 : 1)}${unit === "ratio" ? "" : ` ${unit}`}`,
        displayValue: compact(value, unit === "ratio" ? 2 : 1),
        displayUnit: unit,
      }));
    }
    claims.push(...powerZoneClaims(record, power.zones, power.coverage, ruleEvidence(rideId, power.rulesVersion, "zones")));
    for (const peak of power.peakPowers ?? []) {
      claims.push(claim(rideId, `power.peakAverage.${peak.durationS}s`, ruleEvidence(rideId, peak.rulesVersion, `peak-${peak.durationS}`), {
        value: peak.averagePowerW,
        unit: "W",
        text: `本次 ${peak.durationS} 秒峰值平均功率 ${compact(peak.averagePowerW, 0)} W${peak.powerToWeight !== undefined ? `，${compact(peak.powerToWeight, 1)} W/kg` : ""}`,
        displayValue: compact(peak.averagePowerW, 0),
        displayUnit: "W",
      }));
    }
    if (power.qualityLevel === "soft") limitations.push("advanced.power:soft_quality_results_reference_only");
    if (!power.ftpW) limitations.push("advanced.power:ftp_missing");
    if (!profile?.weightKg) limitations.push("advanced.power:weight_missing");
  } else {
    limitations.push(`advanced.power:${power.unavailableReasons.join(",") || "unavailable"}`);
  }

  return {
    rulesVersion: RIDE_ADVANCED_CLAIM_RULES_VERSION,
    claims,
    limitations: [...new Set(limitations)],
    availableCapabilityKeys: [...capabilityKeys],
  };
}
