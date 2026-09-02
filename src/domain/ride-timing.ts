import type { RideRecord } from "./ride-schema.ts";

export const RIDE_TIMING_RULES_VERSION = "ride-timing-rules-v0.2" as const;

const STOP_SPEED_MPS = 1 / 3.6;
const RESUME_SPEED_MPS = 2 / 3.6;
const STOP_CANDIDATE_MIN_S = 10;
const STOP_CONFIRM_MIN_S = 30;
const RESUME_CONFIRM_MIN_S = 5;
const SHORT_GAP_MAX_S = 10;
const CRUISE_MIN_S = 120;
const LONG_CRUISE_MIN_S = 300;
const CRUISE_MAX_GRADE = 0.01;
const CRUISE_MAX_CV = 0.1;
const GRADE_WINDOW_M = 100;
const MIN_GRADE_WINDOW_M = 60;
const DEVICE_STOP_MAX_DISTANCE_M = 50;
const DEVICE_STOP_EDGE_SPEED_MPS = 1;

export type RideTimingSource = "device_recorded" | "rule_inferred" | "unavailable";

export interface RideStopSegment {
  startElapsedTimeS: number;
  endElapsedTimeS: number;
  durationS: number;
  kind: "stop" | "short_stop";
}

export interface RideCruiseSegment {
  startElapsedTimeS: number;
  endElapsedTimeS: number;
  startDistanceM?: number;
  endDistanceM?: number;
  durationS: number;
  distanceM?: number;
  averageSpeedMps: number;
  speedCoefficientOfVariation: number;
  isLong: boolean;
}

export interface RideTimingSummary {
  rulesVersion: typeof RIDE_TIMING_RULES_VERSION;
  source: RideTimingSource;
  elapsedTimeS?: number;
  movingTimeS?: number;
  stoppedTimeS?: number;
  elapsedAverageSpeedMps?: number;
  movingAverageSpeedMps?: number;
  stops: RideStopSegment[];
  cruiseSegments: RideCruiseSegment[];
}

interface TimedSample {
  startTimeS: number;
  endTimeS: number;
  startDistanceM?: number;
  endDistanceM?: number;
  speedMps?: number;
  startSpeedMps?: number;
  elevationStartM?: number;
  elevationEndM?: number;
}

function sampleDurationS(sample: TimedSample): number {
  return sample.endTimeS - sample.startTimeS;
}

function isContinuousSample(sample: TimedSample): boolean {
  return sampleDurationS(sample) <= SHORT_GAP_MAX_S;
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function metricValue(record: RideRecord, key: "elapsedTimeS" | "movingTimeS"): number | undefined {
  const metric = record.activity.metrics[key];
  return metric?.qualityStatus === "valid" && finite(metric.value) ? metric.value : undefined;
}

function hasTrustedDeviceTiming(record: RideRecord): boolean {
  const elapsed = record.activity.metrics.elapsedTimeS;
  const moving = record.activity.metrics.movingTimeS;
  return record.activity.source.kind === "fit"
    && elapsed?.qualityStatus === "valid"
    && moving?.qualityStatus === "valid"
    && elapsed.provenance === "recorded"
    && moving.provenance === "recorded"
    && elapsed.sourceField === "session.total_elapsed_time"
    && (moving.sourceField === "session.total_moving_time" || moving.sourceField === "session.total_timer_time");
}

function timedSamples(record: RideRecord): TimedSample[] {
  const points = record.series.points;
  const samples: TimedSample[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (!finite(previous.elapsedTimeS) || !finite(current.elapsedTimeS)) continue;
    const durationS = current.elapsedTimeS - previous.elapsedTimeS;
    if (durationS <= 0 || durationS > 86_400) continue;
    const distanceDelta = finite(previous.distanceM) && finite(current.distanceM)
      ? current.distanceM - previous.distanceM
      : undefined;
    const speedMps = finite(current.speedMps)
      ? current.speedMps
      : finite(distanceDelta) && distanceDelta >= 0 ? distanceDelta / durationS : undefined;
    const startSpeedMps = finite(previous.speedMps)
      ? previous.speedMps
      : finite(distanceDelta) && distanceDelta >= 0 ? distanceDelta / durationS : undefined;
    samples.push({
      startTimeS: previous.elapsedTimeS,
      endTimeS: current.elapsedTimeS,
      ...(finite(previous.distanceM) ? { startDistanceM: previous.distanceM } : {}),
      ...(finite(current.distanceM) ? { endDistanceM: current.distanceM } : {}),
      ...(finite(speedMps) ? { speedMps } : {}),
      ...(finite(startSpeedMps) ? { startSpeedMps } : {}),
      ...(finite(previous.elevationM) ? { elevationStartM: previous.elevationM } : {}),
      ...(finite(current.elevationM) ? { elevationEndM: current.elevationM } : {}),
    });
  }
  return samples;
}

function inferDeviceStops(samples: TimedSample[], stoppedTimeS: number): RideStopSegment[] {
  if (stoppedTimeS <= 0) return [];
  const candidates: RideStopSegment[] = [...inferStops(samples)];
  for (const sample of samples) {
    const durationS = sampleDurationS(sample);
    const distanceDelta = finite(sample.startDistanceM) && finite(sample.endDistanceM)
      ? sample.endDistanceM - sample.startDistanceM
      : undefined;
    const stationaryGap = durationS > SHORT_GAP_MAX_S
      && finite(distanceDelta)
      && distanceDelta >= -5
      && distanceDelta <= DEVICE_STOP_MAX_DISTANCE_M
      && finite(sample.startSpeedMps)
      && finite(sample.speedMps)
      && (sample.startSpeedMps < DEVICE_STOP_EDGE_SPEED_MPS || sample.speedMps < DEVICE_STOP_EDGE_SPEED_MPS);
    if (stationaryGap) {
      candidates.push({
        startElapsedTimeS: sample.startTimeS,
        endElapsedTimeS: sample.endTimeS,
        durationS,
        kind: durationS >= STOP_CONFIRM_MIN_S ? "stop" : "short_stop",
      });
    }
  }
  candidates.sort((a, b) => a.startElapsedTimeS - b.startElapsedTimeS);
  const merged: RideStopSegment[] = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous && candidate.startElapsedTimeS <= previous.endElapsedTimeS) {
      previous.endElapsedTimeS = Math.max(previous.endElapsedTimeS, candidate.endElapsedTimeS);
      previous.durationS = previous.endElapsedTimeS - previous.startElapsedTimeS;
      previous.kind = previous.durationS >= STOP_CONFIRM_MIN_S ? "stop" : "short_stop";
      continue;
    }
    merged.push({ ...candidate });
  }
  return merged;
}

function inferStops(samples: TimedSample[]): RideStopSegment[] {
  const stops: RideStopSegment[] = [];
  let candidateStart: number | undefined;
  let candidateEnd: number | undefined;
  let resumeStart: number | undefined;
  const flush = () => {
    if (candidateStart === undefined || candidateEnd === undefined) return;
    const durationS = candidateEnd - candidateStart;
    if (durationS >= STOP_CANDIDATE_MIN_S) {
      stops.push({ startElapsedTimeS: candidateStart, endElapsedTimeS: candidateEnd, durationS, kind: durationS >= STOP_CONFIRM_MIN_S ? "stop" : "short_stop" });
    }
    candidateStart = undefined;
    candidateEnd = undefined;
    resumeStart = undefined;
  };
  for (const sample of samples) {
    if (!isContinuousSample(sample) || sample.speedMps === undefined) {
      flush();
      continue;
    }
    const lowSpeed = sample.speedMps !== undefined && sample.speedMps < STOP_SPEED_MPS;
    if (lowSpeed) {
      candidateStart ??= sample.startTimeS;
      candidateEnd = sample.endTimeS;
      resumeStart = undefined;
      continue;
    }
    if (candidateStart === undefined) continue;
    const movingAgain = sample.speedMps !== undefined && sample.speedMps >= RESUME_SPEED_MPS;
    if (movingAgain) {
      resumeStart ??= sample.startTimeS;
      if (sample.endTimeS - resumeStart >= RESUME_CONFIRM_MIN_S) flush();
    } else {
      resumeStart = undefined;
      candidateEnd = sample.endTimeS;
    }
  }
  flush();
  return stops;
}

function gradeForSample(samples: TimedSample[], index: number): number | undefined {
  const sample = samples[index]!;
  if (!finite(sample.startDistanceM) || !finite(sample.endDistanceM)) return undefined;
  const centerDistance = (sample.startDistanceM + sample.endDistanceM) / 2;
  let beforeIndex: number | undefined;
  let afterIndex: number | undefined;
  for (let offset = index; offset >= 0; offset -= 1) {
    const candidate = samples[offset]!;
    if (finite(candidate.startDistanceM) && centerDistance - candidate.startDistanceM >= GRADE_WINDOW_M / 2) {
      beforeIndex = offset;
      break;
    }
  }
  for (let offset = index; offset < samples.length; offset += 1) {
    const candidate = samples[offset]!;
    if (finite(candidate.endDistanceM) && candidate.endDistanceM - centerDistance >= GRADE_WINDOW_M / 2) {
      afterIndex = offset;
      break;
    }
  }
  if (beforeIndex === undefined || afterIndex === undefined) return undefined;
  const windowSamples = samples.slice(beforeIndex, afterIndex + 1);
  if (windowSamples.some((item) => !isContinuousSample(item))) return undefined;
  const before = samples[beforeIndex]!;
  const after = samples[afterIndex]!;
  if (!before || !after || !finite(before.elevationStartM) || !finite(after.elevationEndM)) return undefined;
  const horizontalM = after.endDistanceM! - before.startDistanceM!;
  return horizontalM >= MIN_GRADE_WINDOW_M ? (after.elevationEndM - before.elevationStartM) / horizontalM : undefined;
}

function buildCruiseSegments(samples: TimedSample[]): RideCruiseSegment[] {
  const segments: RideCruiseSegment[] = [];
  let run: TimedSample[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const start = run[0]!;
    const end = run.at(-1)!;
    const durationS = end.endTimeS - start.startTimeS;
    const durationWeighted = run.reduce((sum, item) => sum + (item.speedMps ?? 0) * (item.endTimeS - item.startTimeS), 0);
    const totalDuration = run.reduce((sum, item) => sum + (item.endTimeS - item.startTimeS), 0);
    const averageSpeedMps = totalDuration > 0 ? durationWeighted / totalDuration : 0;
    const variance = totalDuration > 0
      ? run.reduce((sum, item) => sum + (((item.speedMps ?? 0) - averageSpeedMps) ** 2) * (item.endTimeS - item.startTimeS), 0) / totalDuration
      : 0;
    const cv = averageSpeedMps > 0 ? Math.sqrt(variance) / averageSpeedMps : Infinity;
    if (durationS >= CRUISE_MIN_S && averageSpeedMps >= RESUME_SPEED_MPS && cv <= CRUISE_MAX_CV) {
      const startDistanceM = start.startDistanceM;
      const endDistanceM = end.endDistanceM;
      const distanceM = finite(startDistanceM) && finite(endDistanceM) && endDistanceM >= startDistanceM ? endDistanceM - startDistanceM : undefined;
      segments.push({
        startElapsedTimeS: start.startTimeS,
        endElapsedTimeS: end.endTimeS,
        ...(finite(startDistanceM) ? { startDistanceM } : {}),
        ...(finite(endDistanceM) ? { endDistanceM } : {}),
        durationS,
        ...(finite(distanceM) ? { distanceM } : {}),
        averageSpeedMps,
        speedCoefficientOfVariation: cv,
        isLong: durationS >= LONG_CRUISE_MIN_S,
      });
    }
    run = [];
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const grade = gradeForSample(samples, index);
    const cruiseEligible = isContinuousSample(sample)
      && sample.speedMps !== undefined
      && sample.speedMps >= RESUME_SPEED_MPS
      && grade !== undefined
      && Math.abs(grade) <= CRUISE_MAX_GRADE;
    if (!cruiseEligible) {
      flush();
      continue;
    }
    const candidate = [...run, sample];
    if (run.length > 0 && speedCv(candidate) > CRUISE_MAX_CV) flush();
    run.push(sample);
  }
  flush();
  return segments;
}

function speedCv(samples: TimedSample[]): number {
  const totalDuration = samples.reduce((sum, item) => sum + (item.endTimeS - item.startTimeS), 0);
  if (totalDuration <= 0) return Infinity;
  const average = samples.reduce((sum, item) => sum + (item.speedMps ?? 0) * (item.endTimeS - item.startTimeS), 0) / totalDuration;
  if (average <= 0) return Infinity;
  const variance = samples.reduce((sum, item) => sum + (((item.speedMps ?? 0) - average) ** 2) * (item.endTimeS - item.startTimeS), 0) / totalDuration;
  return Math.sqrt(variance) / average;
}

export function buildRideTimingSummary(record: RideRecord): RideTimingSummary {
  const elapsedMetric = metricValue(record, "elapsedTimeS");
  const movingMetric = metricValue(record, "movingTimeS");
  const samples = timedSamples(record);
  const distanceM = record.activity.metrics.distanceM?.qualityStatus === "valid" ? record.activity.metrics.distanceM.value : undefined;
  const deviceTiming = hasTrustedDeviceTiming(record) && elapsedMetric !== undefined && movingMetric !== undefined && elapsedMetric >= movingMetric;
  if (deviceTiming) {
    const stoppedTimeS = elapsedMetric - movingMetric;
    return {
      rulesVersion: RIDE_TIMING_RULES_VERSION,
      source: "device_recorded",
      elapsedTimeS: elapsedMetric,
      movingTimeS: movingMetric,
      stoppedTimeS,
      ...(distanceM !== undefined && elapsedMetric > 0 ? { elapsedAverageSpeedMps: distanceM / elapsedMetric } : {}),
      ...(distanceM !== undefined && movingMetric > 0 ? { movingAverageSpeedMps: distanceM / movingMetric } : {}),
      stops: inferDeviceStops(samples, stoppedTimeS),
      cruiseSegments: buildCruiseSegments(samples),
    };
  }
  if (samples.length === 0) return { rulesVersion: RIDE_TIMING_RULES_VERSION, source: "unavailable", stops: [], cruiseSegments: [] };
  const inferredElapsed = samples.at(-1)!.endTimeS - samples[0]!.startTimeS;
  const inferredStops = inferStops(samples);
  const confirmedStops = inferredStops.filter((stop) => stop.durationS >= STOP_CONFIRM_MIN_S);
  const stoppedTimeS = confirmedStops.reduce((sum, stop) => sum + stop.durationS, 0);
  const observedTimeS = samples
    .filter((sample) => isContinuousSample(sample) && sample.speedMps !== undefined)
    .reduce((sum, sample) => sum + sampleDurationS(sample), 0);
  if (observedTimeS === 0) {
    return {
      rulesVersion: RIDE_TIMING_RULES_VERSION,
      source: "unavailable",
      elapsedTimeS: inferredElapsed,
      stops: [],
      cruiseSegments: [],
    };
  }
  const movingTimeS = Math.max(0, observedTimeS - stoppedTimeS);
  return {
    rulesVersion: RIDE_TIMING_RULES_VERSION,
    source: "rule_inferred",
    elapsedTimeS: inferredElapsed,
    movingTimeS,
    stoppedTimeS,
    ...(distanceM !== undefined && inferredElapsed > 0 ? { elapsedAverageSpeedMps: distanceM / inferredElapsed } : {}),
    ...(distanceM !== undefined && movingTimeS > 0 ? { movingAverageSpeedMps: distanceM / movingTimeS } : {}),
    stops: inferredStops,
    cruiseSegments: buildCruiseSegments(samples),
  };
}
