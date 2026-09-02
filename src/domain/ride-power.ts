import type { RideRecord, RideSeriesPoint } from "./ride-schema.ts";
import { buildRideTimingSummary } from "./ride-timing.ts";
import type { UserProfile } from "./user-profile.ts";

export const RIDE_POWER_RULES_VERSION = "ride-power-rules-v0.1" as const;
export const RIDE_POWER_PEAK_RULES_VERSION = "ride-power-peak-rules-v0.1" as const;

const STOP_SPEED_MPS = 1 / 3.6;
const EXPECTED_SAMPLE_INTERVAL_S = 2;
const HARD_MAX_GAP_S = 20;
const SOFT_MAX_GAP_S = 60;
const MAX_INTERPOLATION_SHARE = 0.02;
const HARD_COVERAGE = 0.9;
const SOFT_COVERAGE = 0.8;

export type PowerQualityLevel = "hard" | "soft" | "unavailable";
export type PowerUnavailableReason =
  | "missing_time_axis"
  | "missing_riding_time"
  | "missing_power_series"
  | "sensor_quality_failed"
  | "insufficient_coverage"
  | "long_gap"
  | "interpolation_limit";

export interface PowerZoneBin {
  key: "z1" | "z2" | "z3" | "z4" | "z5" | "z6" | "z7";
  label: string;
  durationS: number;
  share: number;
}

export type PowerPeakDurationS = 10 | 20 | 30;

export interface PowerPeak {
  durationS: PowerPeakDurationS;
  averagePowerW: number;
  startElapsedTimeS: number;
  endElapsedTimeS: number;
  rulesVersion: typeof RIDE_POWER_PEAK_RULES_VERSION;
  powerToWeight?: number;
}

export interface RidePowerSummary {
  rulesVersion: typeof RIDE_POWER_RULES_VERSION;
  qualityLevel: PowerQualityLevel;
  unavailableReasons: PowerUnavailableReason[];
  ridingDurationS?: number;
  validDurationS: number;
  interpolatedDurationS: number;
  coverage: number;
  longestGapS: number;
  gapCount: number;
  averagePowerW?: number;
  maxPowerW?: number;
  normalizedPowerW?: number;
  intensityFactor?: number;
  trainingStressScore?: number;
  ftpW?: number;
  averagePowerToWeight?: number;
  normalizedPowerToWeight?: number;
  zones?: PowerZoneBin[];
  peakPowers?: PowerPeak[];
}

type PowerSeriesSegment = {
  startElapsedTimeS: number;
  values: number[];
};

type PowerInterval = {
  startS: number;
  endS: number;
  previousPowerW?: number;
  currentPowerW?: number;
  stopped: boolean;
};

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function validPower(value: number | undefined): value is number {
  return finite(value) && value >= 0 && value <= 3_000;
}

function isStopped(previous: RideSeriesPoint, current: RideSeriesPoint, startS: number, endS: number, stops: Array<{ startElapsedTimeS: number; endElapsedTimeS: number }>): boolean {
  if (stops.some((stop) => startS >= stop.startElapsedTimeS && endS <= stop.endElapsedTimeS)) return true;
  const speed = finite(current.speedMps) ? current.speedMps : previous.speedMps;
  return finite(speed) && speed < STOP_SPEED_MPS;
}

function buildIntervals(record: RideRecord, stops: Array<{ startElapsedTimeS: number; endElapsedTimeS: number }>): PowerInterval[] {
  const intervals: PowerInterval[] = [];
  const points = record.series.points;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (!finite(previous.elapsedTimeS) || !finite(current.elapsedTimeS) || current.elapsedTimeS <= previous.elapsedTimeS) continue;
    intervals.push({
      startS: previous.elapsedTimeS,
      endS: current.elapsedTimeS,
      previousPowerW: previous.powerW,
      currentPowerW: current.powerW,
      stopped: isStopped(previous, current, previous.elapsedTimeS, current.elapsedTimeS, stops),
    });
  }
  return intervals;
}

function pushSeconds(values: number[], start: number, end: number, from: number, to = from): void {
  const duration = Math.max(0, Math.round(end - start));
  for (let second = 0; second < duration; second += 1) {
    values.push(from + ((to - from) * (second / Math.max(1, duration))));
  }
}

function intervalPowerValues(interval: PowerInterval): number[] | undefined {
  const duration = Math.max(0, Math.round(interval.endS - interval.startS));
  if (duration === 0) return [];
  if (duration <= EXPECTED_SAMPLE_INTERVAL_S && validPower(interval.previousPowerW)) {
    return Array.from({ length: duration }, () => interval.previousPowerW!);
  }
  if (duration <= SOFT_MAX_GAP_S && validPower(interval.previousPowerW) && validPower(interval.currentPowerW)) {
    return Array.from({ length: duration }, (_, second) => interval.previousPowerW! + ((interval.currentPowerW! - interval.previousPowerW!) * (second / Math.max(1, duration))));
  }
  return undefined;
}

function appendPowerSegment(segments: PowerSeriesSegment[], startElapsedTimeS: number, values: number[], continuePrevious: boolean): void {
  if (values.length === 0) return;
  const previous = segments.at(-1);
  if (!continuePrevious || !previous || Math.abs(previous.startElapsedTimeS + previous.values.length - startElapsedTimeS) > 0.01) {
    segments.push({ startElapsedTimeS, values: [...values] });
    return;
  }
  previous.values.push(...values);
}

function peakPowerForDuration(
  segments: PowerSeriesSegment[],
  durationS: PowerPeakDurationS,
  weightKg: number | undefined,
): PowerPeak | undefined {
  let best: PowerPeak | undefined;
  for (const segment of segments) {
    if (segment.values.length < durationS) continue;
    let rolling = segment.values.slice(0, durationS).reduce((sum, value) => sum + value, 0);
    for (let index = 0; index <= segment.values.length - durationS; index += 1) {
      if (index > 0) rolling += segment.values[index + durationS - 1]! - segment.values[index - 1]!;
      const averagePowerW = rolling / durationS;
      if (!best || averagePowerW > best.averagePowerW) {
        best = {
          durationS,
          averagePowerW,
          startElapsedTimeS: segment.startElapsedTimeS + index,
          endElapsedTimeS: segment.startElapsedTimeS + index + durationS,
          rulesVersion: RIDE_POWER_PEAK_RULES_VERSION,
          ...(weightKg && weightKg > 0 ? { powerToWeight: averagePowerW / weightKg } : {}),
        };
      }
    }
  }
  return best;
}

function buildPeakPowers(segments: PowerSeriesSegment[], weightKg: number | undefined): PowerPeak[] | undefined {
  const peaks = ([10, 20, 30] as const).map((durationS) => peakPowerForDuration(segments, durationS, weightKg));
  if (peaks.some((peak) => peak === undefined)) return undefined;
  const [ten, twenty, thirty] = peaks as [PowerPeak, PowerPeak, PowerPeak];
  if (ten.averagePowerW + 1e-9 < twenty.averagePowerW || twenty.averagePowerW + 1e-9 < thirty.averagePowerW) return undefined;
  return [ten, twenty, thirty];
}

function powerZones(ftpW: number, values: number[]): PowerZoneBin[] {
  const definitions: Array<{ key: PowerZoneBin["key"]; label: string; matches: (value: number) => boolean }> = [
    { key: "z1", label: `Z1 · <${Math.ceil(ftpW * .55)} W`, matches: (value) => value < ftpW * .55 },
    { key: "z2", label: `Z2 · ${Math.ceil(ftpW * .55)}–${Math.ceil(ftpW * .76) - 1} W`, matches: (value) => value >= ftpW * .55 && value < ftpW * .76 },
    { key: "z3", label: `Z3 · ${Math.ceil(ftpW * .76)}–${Math.ceil(ftpW * .91) - 1} W`, matches: (value) => value >= ftpW * .76 && value < ftpW * .91 },
    { key: "z4", label: `Z4 · ${Math.ceil(ftpW * .91)}–${Math.ceil(ftpW * 1.06) - 1} W`, matches: (value) => value >= ftpW * .91 && value < ftpW * 1.06 },
    { key: "z5", label: `Z5 · ${Math.ceil(ftpW * 1.06)}–${Math.ceil(ftpW * 1.21) - 1} W`, matches: (value) => value >= ftpW * 1.06 && value < ftpW * 1.21 },
    { key: "z6", label: `Z6 · ${Math.ceil(ftpW * 1.21)}–${Math.ceil(ftpW * 1.51) - 1} W`, matches: (value) => value >= ftpW * 1.21 && value < ftpW * 1.51 },
    { key: "z7", label: `Z7 · ≥${Math.ceil(ftpW * 1.51)} W`, matches: (value) => value >= ftpW * 1.51 },
  ];
  return definitions.map((definition) => {
    const durationS = values.filter(definition.matches).length;
    return { key: definition.key, label: definition.label, durationS, share: values.length > 0 ? durationS / values.length : 0 };
  });
}

function normalizedPower(values: number[]): number | undefined {
  if (values.length < 30) return undefined;
  const rolling: number[] = [];
  let total = values.slice(0, 30).reduce((sum, value) => sum + value, 0);
  rolling.push(total / 30);
  for (let index = 30; index < values.length; index += 1) {
    total += values[index]! - values[index - 30]!;
    rolling.push(total / 30);
  }
  return (rolling.reduce((sum, value) => sum + value ** 4, 0) / rolling.length) ** .25;
}

export function buildRidePowerSummary(record: RideRecord, profile?: UserProfile | null): RidePowerSummary {
  const empty: RidePowerSummary = {
    rulesVersion: RIDE_POWER_RULES_VERSION,
    qualityLevel: "unavailable",
    unavailableReasons: [],
    validDurationS: 0,
    interpolatedDurationS: 0,
    coverage: 0,
    longestGapS: 0,
    gapCount: 0,
  };
  if (record.series.timeBasis.kind === "none") return { ...empty, unavailableReasons: ["missing_time_axis"] };
  if (!record.series.availableSeries.includes("power")) return { ...empty, unavailableReasons: ["missing_power_series"] };
  const quality = record.activity.sensorQuality.power;
  if (!quality || quality.sampleCount === 0 || quality.invalidSampleCount / quality.sampleCount > .02) {
    return { ...empty, unavailableReasons: ["sensor_quality_failed"] };
  }
  const timing = buildRideTimingSummary(record);
  if (!finite(timing.movingTimeS) || timing.movingTimeS <= 0) return { ...empty, unavailableReasons: ["missing_riding_time"] };

  const intervals = buildIntervals(record, timing.stops);
  const powerSegments: PowerSeriesSegment[] = [];
  const allValues: number[] = [];
  let validDurationS = 0;
  let interpolatedDurationS = 0;
  let longestGapS = 0;
  let gapCount = 0;
  let hasLongGap = false;
  let canContinuePowerSegment = false;
  for (const interval of intervals) {
    const duration = interval.endS - interval.startS;
    if (interval.stopped) {
      canContinuePowerSegment = false;
      continue;
    }
    if (duration <= EXPECTED_SAMPLE_INTERVAL_S && validPower(interval.previousPowerW)) {
      validDurationS += duration;
      pushSeconds(allValues, interval.startS, interval.endS, interval.previousPowerW);
      appendPowerSegment(powerSegments, interval.startS, intervalPowerValues(interval) ?? [], canContinuePowerSegment);
      canContinuePowerSegment = true;
      continue;
    }
    if (duration > EXPECTED_SAMPLE_INTERVAL_S) {
      longestGapS = Math.max(longestGapS, duration);
      gapCount += 1;
      if (validPower(interval.previousPowerW) && validPower(interval.currentPowerW) && duration <= SOFT_MAX_GAP_S) {
        interpolatedDurationS += duration;
        validDurationS += duration;
        pushSeconds(allValues, interval.startS, interval.endS, interval.previousPowerW, interval.currentPowerW);
        appendPowerSegment(powerSegments, interval.startS, intervalPowerValues(interval) ?? [], canContinuePowerSegment);
        canContinuePowerSegment = true;
      } else {
        hasLongGap ||= duration > SOFT_MAX_GAP_S;
        canContinuePowerSegment = false;
      }
    } else {
      canContinuePowerSegment = false;
    }
  }
  const coverage = validDurationS / timing.movingTimeS;
  const interpolationShare = interpolatedDurationS / timing.movingTimeS;
  const reasons: PowerUnavailableReason[] = [];
  if (coverage < SOFT_COVERAGE) reasons.push("insufficient_coverage");
  if (hasLongGap || longestGapS > SOFT_MAX_GAP_S) reasons.push("long_gap");
  if (interpolationShare > MAX_INTERPOLATION_SHARE) reasons.push("interpolation_limit");
  const qualityLevel: PowerQualityLevel = reasons.length > 0
    ? "unavailable"
    : coverage >= HARD_COVERAGE && longestGapS <= HARD_MAX_GAP_S ? "hard"
      : "soft";
  const averagePowerW = allValues.length > 0 ? allValues.reduce((sum, value) => sum + value, 0) / allValues.length : undefined;
  const maxPowerW = allValues.length > 0 ? Math.max(...allValues) : undefined;
  const recordedAveragePower = record.activity.metrics.avgPowerW;
  const displayAveragePowerW = recordedAveragePower?.qualityStatus === "valid"
    ? recordedAveragePower.value
    : averagePowerW;
  const np = qualityLevel === "unavailable" ? undefined : normalizedPower(allValues);
  const ftpW = profile?.ftp?.trustStatus === "user_confirmed" ? profile.ftp.valueWatts : undefined;
  const intensityFactor = np !== undefined && ftpW ? np / ftpW : undefined;
  const trainingStressScore = np !== undefined && intensityFactor !== undefined && ftpW
    ? (timing.movingTimeS * np * intensityFactor / (ftpW * 3_600)) * 100
    : undefined;
  const weightKg = profile?.weightKg?.value;
  const peakPowers = qualityLevel === "unavailable" ? undefined : buildPeakPowers(powerSegments, weightKg);
  return {
    ...empty,
    qualityLevel,
    unavailableReasons: reasons,
    ridingDurationS: timing.movingTimeS,
    validDurationS,
    interpolatedDurationS,
    coverage,
    longestGapS,
    gapCount,
    ...(displayAveragePowerW !== undefined ? { averagePowerW: displayAveragePowerW } : {}),
    ...(maxPowerW !== undefined ? { maxPowerW } : {}),
    ...(np !== undefined ? { normalizedPowerW: np } : {}),
    ...(ftpW ? { ftpW, zones: qualityLevel === "unavailable" ? undefined : powerZones(ftpW, allValues) } : {}),
    ...(intensityFactor !== undefined ? { intensityFactor } : {}),
    ...(trainingStressScore !== undefined ? { trainingStressScore } : {}),
    ...(qualityLevel !== "unavailable" && weightKg && displayAveragePowerW !== undefined ? { averagePowerToWeight: displayAveragePowerW / weightKg } : {}),
    ...(qualityLevel !== "unavailable" && weightKg && np !== undefined ? { normalizedPowerToWeight: np / weightKg } : {}),
    ...(peakPowers ? { peakPowers } : {}),
  };
}
