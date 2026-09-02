import type { Metric, RideRecord, RideSeriesPoint } from "./ride-schema.ts";

export const RIDE_ELEVATION_RULES_VERSION = "ride-elevation-rules-v0.3" as const;

const SMOOTHING_WINDOW_M = 30;
const HYSTERESIS_M = 3;
const MAX_TIME_GAP_S = 120;
const MAX_DISTANCE_GAP_M = 500;
const ELEVATION_STEP_MAX_DISTANCE_M = 50;
const ELEVATION_STEP_MIN_DELTA_M = 20;
const ELEVATION_STEP_MIN_GRADE = 0.8;
const CUMULATIVE_ANOMALY_WINDOW_M = 100;
const CUMULATIVE_ANOMALY_MIN_DELTA_M = 20;
const CUMULATIVE_ANOMALY_MIN_GRADE = 0.48;
const ANOMALY_RECOVERY_WINDOW_M = 250;
const ANOMALY_RECOVERY_RATIO = 0.7;
const ANOMALY_STABILIZATION_WINDOW_M = 30;

export type RideElevationSource = "device_recorded" | "sample_recorded" | "rule_calculated" | "unavailable";

export interface RideElevationPoint {
  distanceM: number;
  elevationM: number;
  elapsedTimeS?: number;
  speedMps?: number;
}

export interface RideElevationCalibration {
  deviceValueM: number;
  calculatedValueM: number;
  differenceM: number;
  needsReview: boolean;
}

export interface RideElevationSummary {
  rulesVersion: typeof RIDE_ELEVATION_RULES_VERSION;
  gainM?: number;
  lossM?: number;
  minM?: number;
  maxM?: number;
  rangeM?: number;
  gainSource: RideElevationSource;
  lossSource: RideElevationSource;
  smoothedSegments: RideElevationPoint[][];
  smoothedPoints: RideElevationPoint[];
  gainCalibration?: RideElevationCalibration;
  lossCalibration?: RideElevationCalibration;
}

interface ElevationSegment {
  points: RideElevationPoint[];
}

interface ElevationAnomalyCorridor {
  startIndex: number;
  endIndex: number;
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function metricIsTrusted(record: RideRecord, metric: Metric | undefined, sourceField: string): metric is Metric {
  return record.activity.source.kind === "fit"
    && metric?.qualityStatus === "valid"
    && metric.provenance === "recorded"
    && metric.sourceField === sourceField
    && finite(metric.value)
    && metric.value >= 0;
}

function hasLongGap(previous: RideSeriesPoint, current: RideSeriesPoint): boolean {
  if (finite(previous.elapsedTimeS) && finite(current.elapsedTimeS) && current.elapsedTimeS - previous.elapsedTimeS > MAX_TIME_GAP_S) {
    return true;
  }
  return finite(previous.distanceM) && finite(current.distanceM)
    && current.distanceM - previous.distanceM > MAX_DISTANCE_GAP_M;
}

function stepDeltaM(previous: RideSeriesPoint, current: RideSeriesPoint): number | undefined {
  if (!finite(previous.distanceM) || !finite(previous.elevationM) || !finite(current.distanceM) || !finite(current.elevationM)) {
    return undefined;
  }
  const distanceM = current.distanceM - previous.distanceM;
  if (distanceM <= 0 || distanceM > ELEVATION_STEP_MAX_DISTANCE_M) return undefined;
  const deltaM = current.elevationM - previous.elevationM;
  if (Math.abs(deltaM) < ELEVATION_STEP_MIN_DELTA_M || Math.abs(deltaM) / distanceM < ELEVATION_STEP_MIN_GRADE) return undefined;
  return deltaM;
}

function confirmedStepDeltaM(
  beforePrevious: RideSeriesPoint | undefined,
  previous: RideSeriesPoint,
  current: RideSeriesPoint,
  next: RideSeriesPoint | undefined,
): number | undefined {
  const signedDeltaM = stepDeltaM(previous, current);
  if (signedDeltaM === undefined) return undefined;

  const priorSignedDeltaM = beforePrevious ? stepDeltaM(beforePrevious, previous) : undefined;
  if (priorSignedDeltaM !== undefined && finite(beforePrevious?.elevationM) && finite(current.elevationM)) {
    const currentRelativeToPriorM = current.elevationM - beforePrevious.elevationM;
    if (currentRelativeToPriorM * Math.sign(priorSignedDeltaM) < Math.abs(priorSignedDeltaM) / 2) return undefined;
  }
  if (!next || !finite(next.distanceM) || !finite(next.elevationM) || !finite(current.distanceM) || !finite(previous.elevationM)
    || next.distanceM <= current.distanceM) {
    return signedDeltaM;
  }

  // Keep a one-point spike in the smoothing path. A real step remains on the new elevation side.
  const nextSignedDeltaM = next.elevationM - previous.elevationM;
  return nextSignedDeltaM * Math.sign(signedDeltaM) >= Math.abs(signedDeltaM) / 2 ? signedDeltaM : undefined;
}

function stepRunEndIndex(points: RideSeriesPoint[], startIndex: number, signedStepDeltaM: number): number {
  let endIndex = startIndex;
  let previous = points[startIndex]!;
  const direction = Math.sign(signedStepDeltaM);
  for (let index = startIndex + 1; index < points.length; index += 1) {
    const current = points[index]!;
    if (!finite(previous.distanceM) || !finite(previous.elevationM) || !finite(current.distanceM) || !finite(current.elevationM)) break;
    const distanceM = current.distanceM - previous.distanceM;
    if (distanceM === 0) {
      endIndex = index;
      previous = current;
      continue;
    }
    if (distanceM < 0 || distanceM > ELEVATION_STEP_MAX_DISTANCE_M) break;
    const deltaM = current.elevationM - previous.elevationM;
    if (deltaM * direction <= 0 || Math.abs(deltaM) / distanceM < ELEVATION_STEP_MIN_GRADE) break;
    endIndex = index;
    previous = current;
  }
  return endIndex;
}

function isUsableForwardPair(previous: RideSeriesPoint, current: RideSeriesPoint): boolean {
  return finite(previous.distanceM) && finite(previous.elevationM)
    && finite(current.distanceM) && finite(current.elevationM)
    && current.distanceM > previous.distanceM
    && current.distanceM - previous.distanceM <= MAX_DISTANCE_GAP_M;
}

function cumulativeAnomalyCandidate(
  points: RideSeriesPoint[],
  startIndex: number,
): { endIndex: number; signedDeltaM: number } | undefined {
  const start = points[startIndex];
  if (!start || !finite(start.distanceM) || !finite(start.elevationM)) return undefined;

  let previous = start;
  for (let endIndex = startIndex + 1; endIndex < points.length; endIndex += 1) {
    const current = points[endIndex]!;
    if (!isUsableForwardPair(previous, current)) return undefined;
    const distanceM = current.distanceM! - start.distanceM;
    if (distanceM > CUMULATIVE_ANOMALY_WINDOW_M) return undefined;
    const signedDeltaM = current.elevationM! - start.elevationM;
    if (Math.abs(signedDeltaM) >= CUMULATIVE_ANOMALY_MIN_DELTA_M
      && Math.abs(signedDeltaM) / distanceM >= CUMULATIVE_ANOMALY_MIN_GRADE) {
      return { endIndex, signedDeltaM };
    }
    previous = current;
  }
  return undefined;
}

function stabilizedRecoveryEndIndex(
  points: RideSeriesPoint[],
  recoveryIndex: number,
): number | undefined {
  const recovery = points[recoveryIndex]!;
  let previous = recovery;
  for (let index = recoveryIndex + 1; index < points.length; index += 1) {
    const current = points[index]!;
    if (!isUsableForwardPair(previous, current)) return undefined;
    const spanM = current.distanceM! - recovery.distanceM!;
    if (spanM >= ANOMALY_STABILIZATION_WINDOW_M) {
      const grade = Math.abs(current.elevationM! - recovery.elevationM!) / spanM;
      return grade < CUMULATIVE_ANOMALY_MIN_GRADE ? index : undefined;
    }
    previous = current;
  }
  return undefined;
}

function cumulativeAnomalyCorridors(points: RideSeriesPoint[]): ElevationAnomalyCorridor[] {
  const corridors: ElevationAnomalyCorridor[] = [];
  let startIndex = 0;
  while (startIndex < points.length) {
    const candidate = cumulativeAnomalyCandidate(points, startIndex);
    if (!candidate) {
      startIndex += 1;
      continue;
    }

    const candidateEnd = points[candidate.endIndex]!;
    const direction = Math.sign(candidate.signedDeltaM);
    let previous = candidateEnd;
    let endIndex: number | undefined;
    for (let recoveryIndex = candidate.endIndex + 1; recoveryIndex < points.length; recoveryIndex += 1) {
      const recovery = points[recoveryIndex]!;
      if (!isUsableForwardPair(previous, recovery)
        || recovery.distanceM! - candidateEnd.distanceM! > ANOMALY_RECOVERY_WINDOW_M) break;
      const recoveredM = (recovery.elevationM! - candidateEnd.elevationM!) * -direction;
      if (recoveredM >= Math.abs(candidate.signedDeltaM) * ANOMALY_RECOVERY_RATIO) {
        const stabilizationEnd = stabilizedRecoveryEndIndex(points, recoveryIndex);
        if (stabilizationEnd !== undefined) {
          endIndex = stabilizationEnd;
          break;
        }
      }
      previous = recovery;
    }

    if (endIndex !== undefined) {
      corridors.push({ startIndex, endIndex });
      startIndex = endIndex + 1;
    } else {
      // The candidate is a possible real extreme section until an opposite recovery proves otherwise.
      startIndex += 1;
    }
  }
  return corridors;
}

function toElevationPoint(point: RideSeriesPoint): RideElevationPoint {
  return {
    distanceM: point.distanceM!,
    elevationM: point.elevationM!,
    ...(finite(point.elapsedTimeS) ? { elapsedTimeS: point.elapsedTimeS } : {}),
    ...(finite(point.speedMps) ? { speedMps: point.speedMps } : {}),
  };
}

function elevationSegments(points: RideSeriesPoint[], preserveSampleContinuity = false): ElevationSegment[] {
  const segments: ElevationSegment[] = [];
  const corridors = cumulativeAnomalyCorridors(points);
  let segment: RideElevationPoint[] = [];
  let previous: RideSeriesPoint | undefined;
  let beforePrevious: RideSeriesPoint | undefined;
  let skipThroughIndex = -1;
  let corridorIndex = 0;
  const flush = () => {
    if (segment.length >= 2) segments.push({ points: segment });
    segment = [];
  };

  for (const [index, point] of points.entries()) {
    if (index <= skipThroughIndex) continue;
    const corridor = corridors[corridorIndex];
    if (corridor && index === corridor.startIndex) {
      flush();
      previous = undefined;
      beforePrevious = undefined;
      skipThroughIndex = corridor.endIndex;
      corridorIndex += 1;
      continue;
    }
    const usable = finite(point.distanceM) && finite(point.elevationM);
    if (!usable) {
      flush();
      previous = undefined;
      beforePrevious = undefined;
      continue;
    }
    if (previous) {
      const signedStepDeltaM = confirmedStepDeltaM(beforePrevious, previous, point, points[index + 1]);
      if (signedStepDeltaM !== undefined) {
        flush();
        const stepEndIndex = stepRunEndIndex(points, index, signedStepDeltaM);
        if (stepEndIndex > index) {
          previous = undefined;
          beforePrevious = undefined;
          skipThroughIndex = stepEndIndex;
          continue;
        }
        segment.push(toElevationPoint(point));
        beforePrevious = undefined;
        previous = point;
        continue;
      }
      if (!finite(previous.distanceM) || !finite(previous.elevationM)
        || point.distanceM! < previous.distanceM
        || (!preserveSampleContinuity && hasLongGap(previous, point))) {
        flush();
      }
    }
    segment.push(toElevationPoint(point));
    beforePrevious = previous;
    previous = point;
  }
  flush();
  return segments;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function smoothSegment(segment: ElevationSegment): RideElevationPoint[] {
  const radiusM = SMOOTHING_WINDOW_M / 2;
  return segment.points.map((point) => ({
    distanceM: point.distanceM,
    elevationM: median(segment.points
      .filter((candidate) => Math.abs(candidate.distanceM - point.distanceM) <= radiusM)
      .map((candidate) => candidate.elevationM)),
    ...(finite(point.elapsedTimeS) ? { elapsedTimeS: point.elapsedTimeS } : {}),
    ...(finite(point.speedMps) ? { speedMps: point.speedMps } : {}),
  }));
}

function accumulateWithHysteresis(points: RideElevationPoint[]): { gainM: number; lossM: number } {
  let reference = points[0]!.elevationM;
  let direction: "up" | "down" | undefined;
  let gainM = 0;
  let lossM = 0;

  for (const point of points.slice(1)) {
    const delta = point.elevationM - reference;
    if (!direction) {
      if (delta >= HYSTERESIS_M) {
        gainM += delta;
        reference = point.elevationM;
        direction = "up";
      } else if (delta <= -HYSTERESIS_M) {
        lossM += -delta;
        reference = point.elevationM;
        direction = "down";
      }
      continue;
    }
    if (direction === "up") {
      if (delta >= 0) {
        gainM += delta;
        reference = point.elevationM;
      } else if (delta <= -HYSTERESIS_M) {
        lossM += -delta;
        reference = point.elevationM;
        direction = "down";
      }
      continue;
    }
    if (delta <= 0) {
      lossM += -delta;
      reference = point.elevationM;
    } else if (delta >= HYSTERESIS_M) {
      gainM += delta;
      reference = point.elevationM;
      direction = "up";
    }
  }
  return { gainM, lossM };
}

function calibration(deviceValueM: number | undefined, calculatedValueM: number | undefined): RideElevationCalibration | undefined {
  if (!finite(deviceValueM) || !finite(calculatedValueM)) return undefined;
  const differenceM = Math.abs(deviceValueM - calculatedValueM);
  return {
    deviceValueM,
    calculatedValueM,
    differenceM,
    needsReview: differenceM > Math.max(20, deviceValueM * 0.2),
  };
}

function metricIsRecordedSample(metric: Metric | undefined): metric is Metric {
  return metric?.qualityStatus === "valid"
    && metric.provenance === "recorded"
    && finite(metric.value)
    && metric.value >= 0;
}

export function buildRideElevationSummary(record: RideRecord): RideElevationSummary {
  const isBuiltInSample = record.activity.source.kind === "sample";
  // Sparse demo fixtures are only kept visually continuous; imported FIT/GPX always preserve real data gaps.
  const smoothedSegments = elevationSegments(record.series.points, isBuiltInSample).map(smoothSegment);
  const smoothedPoints = smoothedSegments.flat();
  const calculated = smoothedSegments.reduce(
    (total, segment) => {
      const value = accumulateWithHysteresis(segment);
      return { gainM: total.gainM + value.gainM, lossM: total.lossM + value.lossM };
    },
    { gainM: 0, lossM: 0 },
  );
  const hasCalculatedSeries = smoothedPoints.length >= 2;
  const deviceGain = record.activity.metrics.elevationGainM;
  const deviceLoss = record.activity.metrics.elevationLossM;
  const trustedGain = metricIsTrusted(record, deviceGain, "session.total_ascent") ? deviceGain.value : undefined;
  const trustedLoss = metricIsTrusted(record, deviceLoss, "session.total_descent") ? deviceLoss.value : undefined;
  const sampleGain = isBuiltInSample && metricIsRecordedSample(deviceGain) ? deviceGain.value : undefined;
  const sampleLoss = isBuiltInSample && metricIsRecordedSample(deviceLoss) ? deviceLoss.value : undefined;
  const minM = hasCalculatedSeries ? Math.min(...smoothedPoints.map((point) => point.elevationM)) : undefined;
  const maxM = hasCalculatedSeries ? Math.max(...smoothedPoints.map((point) => point.elevationM)) : undefined;

  return {
    rulesVersion: RIDE_ELEVATION_RULES_VERSION,
    ...(trustedGain !== undefined ? { gainM: trustedGain } : sampleGain !== undefined ? { gainM: sampleGain } : hasCalculatedSeries ? { gainM: calculated.gainM } : {}),
    ...(trustedLoss !== undefined ? { lossM: trustedLoss } : sampleLoss !== undefined ? { lossM: sampleLoss } : hasCalculatedSeries ? { lossM: calculated.lossM } : {}),
    ...(minM !== undefined ? { minM } : {}),
    ...(maxM !== undefined ? { maxM } : {}),
    ...(minM !== undefined && maxM !== undefined ? { rangeM: maxM - minM } : {}),
    gainSource: trustedGain !== undefined ? "device_recorded" : sampleGain !== undefined ? "sample_recorded" : hasCalculatedSeries ? "rule_calculated" : "unavailable",
    lossSource: trustedLoss !== undefined ? "device_recorded" : sampleLoss !== undefined ? "sample_recorded" : hasCalculatedSeries ? "rule_calculated" : "unavailable",
    smoothedSegments,
    smoothedPoints,
    ...(calibration(trustedGain, hasCalculatedSeries ? calculated.gainM : undefined) ? {
      gainCalibration: calibration(trustedGain, calculated.gainM),
    } : {}),
    ...(calibration(trustedLoss, hasCalculatedSeries ? calculated.lossM : undefined) ? {
      lossCalibration: calibration(trustedLoss, calculated.lossM),
    } : {}),
  };
}
