import test from "node:test";
import assert from "node:assert/strict";
import {
  RIDE_DERIVED_METRICS_V21_VERSION,
  bestAveragePower,
  climbDescentPowerRatio,
  climbPowerDecayPercent,
  climbWkg,
  coefficientOfVariationPercent,
  effectiveElevationGain,
  efficiencyFactor,
  gradePowerMatchCv,
  heartRateDriftPercent,
  heartRateRecovery,
  intensityFactor,
  negativeSplit,
  powerCurveBest,
  pwHrDecouplingPercent,
  relativeStress,
  speedPowerRatio,
  splitDifferencePercent,
  stoppedTimeSharePercent,
  timeCorrelation,
  timePerTss,
  trainingStressScore,
  vam,
  variabilityIndex,
} from "../src/domain/ride-derived-metrics-v21.ts";

test("V21 derived-metrics version is frozen", () => {
  assert.match(RIDE_DERIVED_METRICS_V21_VERSION, /^ride-derived-metrics-v2\.1\.0$/);
});

test("variabilityIndex = NP / average power, rejects non-positive divisor", () => {
  assert.equal(variabilityIndex(250, 200), 1.25);
  assert.equal(variabilityIndex(200, 200), 1);
  assert.equal(variabilityIndex(250, 0), undefined);
  assert.equal(variabilityIndex(Number.NaN, 200), undefined);
});

test("splitDifferencePercent = (second - first) / first * 100", () => {
  assert.equal(splitDifferencePercent(200, 210), 5);
  assert.equal(splitDifferencePercent(200, 200), 0);
  assert.equal(splitDifferencePercent(200, 190), -5);
  assert.equal(splitDifferencePercent(0, 210), undefined);
});

test("negativeSplit grades per the knowledge-base bands", () => {
  assert.deepEqual(negativeSplit(200, 210), { grade: "negative_split", differencePct: 5 });
  assert.deepEqual(negativeSplit(200, 202), { grade: "even", differencePct: 1 });
  assert.deepEqual(negativeSplit(210, 200)?.grade, "mild_positive");
  assert.deepEqual(negativeSplit(220, 200), { grade: "positive_split", differencePct: -9.090909090909092 });
  assert.equal(negativeSplit(0, 200), undefined);
});

test("stoppedTimeSharePercent = stopped / elapsed * 100", () => {
  const share = stoppedTimeSharePercent(600, 3600)!;
  assert.ok(Math.abs(share - 100 / 6) < 1e-9);
  assert.equal(stoppedTimeSharePercent(0, 3600), 0);
  assert.equal(stoppedTimeSharePercent(600, 0), undefined);
});

test("climbDescentPowerRatio = climb / descent, rejects non-positive descent", () => {
  assert.equal(climbDescentPowerRatio(260, 200), 1.3);
  assert.equal(climbDescentPowerRatio(260, 0), undefined);
});

test("bestAveragePower returns the max sliding-window mean", () => {
  assert.equal(bestAveragePower([100, 200, 300, 400], 1), 400);
  assert.equal(bestAveragePower([100, 200, 300, 400], 2), 350);
  assert.equal(bestAveragePower([100, 200, 300, 400], 3), 300);
  assert.equal(bestAveragePower([100, 200, 300, 400], 4), 250);
  assert.equal(bestAveragePower([100, 200, 300, 400], 5), undefined); // insufficient samples
  assert.equal(bestAveragePower([100, Number.NaN, 300], 2), undefined); // non-finite
});

test("powerCurveBest maps each duration to its best average power", () => {
  const curve = powerCurveBest([100, 200, 300, 400], [1, 2, 3, 5]);
  assert.equal(curve.get(1), 400);
  assert.equal(curve.get(2), 350);
  assert.equal(curve.get(3), 300);
  assert.equal(curve.has(5), false); // insufficient samples dropped, not zero-filled
});

// ── V21-04 爬坡 + 强度派生指标 ──────────────────────────────────────────────

test("climbWkg = climb power / body weight", () => {
  assert.equal(climbWkg(300, 75), 4);
  assert.equal(climbWkg(300, 0), undefined);
});

test("vam = elevation gain / duration * 3600 (m/h)", () => {
  assert.equal(vam(500, 3600), 500);
  assert.equal(vam(1000, 1800), 2000);
  assert.equal(vam(500, 0), undefined);
});

test("coefficientOfVariationPercent = std / mean * 100", () => {
  assert.equal(coefficientOfVariationPercent([3, 3, 3]), 0);
  assert.ok(Math.abs(coefficientOfVariationPercent([2, 4])! - 100 / 3) < 1e-9);
  assert.equal(coefficientOfVariationPercent([]), undefined);
  assert.equal(coefficientOfVariationPercent([Number.NaN, 3]), undefined);
});

test("gradePowerMatchCv is the W/kg consistency across grade segments", () => {
  assert.equal(gradePowerMatchCv([4, 4, 4]), 0);
});

test("climbPowerDecayPercent = (first - second) / first * 100", () => {
  assert.equal(climbPowerDecayPercent(4, 3.5), 12.5);
  assert.equal(climbPowerDecayPercent(4, 0), 100);
  assert.equal(climbPowerDecayPercent(0, 3.5), undefined);
});

test("effectiveElevationGain = total gain - false gain, floored at 0", () => {
  assert.equal(effectiveElevationGain(1000, 200), 800);
  assert.equal(effectiveElevationGain(100, 200), 0);
  assert.equal(effectiveElevationGain(1000, Number.NaN), undefined);
});

test("intensityFactor = NP / FTP", () => {
  assert.equal(intensityFactor(250, 200), 1.25);
  assert.equal(intensityFactor(250, 0), undefined);
});

test("trainingStressScore = IF^2 * hours * 100 (1h at FTP = 100)", () => {
  assert.equal(trainingStressScore(1, 3600), 100);
  assert.equal(trainingStressScore(0.9, 3600), 81);
  assert.equal(trainingStressScore(-1, 3600), undefined);
});

test("relativeStress = seconds * NP * IF / (FTP * 3600) * 100", () => {
  assert.equal(relativeStress(3600, 200, 1, 200), 100);
  assert.equal(relativeStress(3600, 200, 1, 0), undefined);
});

test("timePerTss = elapsed / TSS", () => {
  assert.equal(timePerTss(7200, 100), 72);
  assert.equal(timePerTss(7200, 0), undefined);
});

// ── V21-05 心率 + 跨传感器派生指标 ──────────────────────────────────────────

test("efficiencyFactor = NP / average HR", () => {
  assert.equal(efficiencyFactor(250, 125), 2);
  assert.equal(efficiencyFactor(250, 0), undefined);
});

test("heartRateDriftPercent = (second - first) / first * 100", () => {
  assert.equal(heartRateDriftPercent(140, 147), 5);
  assert.equal(heartRateDriftPercent(140, 133), -5);
  assert.equal(heartRateDriftPercent(0, 147), undefined);
});

test("heartRateRecovery = end HR - post-ride HR (bpm drop)", () => {
  assert.equal(heartRateRecovery(160, 135), 25);
  assert.equal(heartRateRecovery(160, Number.NaN), undefined);
});

test("pwHrDecouplingPercent = (first NP/HR - second NP/HR) / first * 100", () => {
  assert.ok(Math.abs(pwHrDecouplingPercent(2, 1.8)! - 10) < 1e-9);
  assert.equal(pwHrDecouplingPercent(2, 2), 0);
  assert.equal(pwHrDecouplingPercent(0, 1.8), undefined);
});

test("speedPowerRatio = speed / power", () => {
  assert.equal(speedPowerRatio(10, 200), 0.05);
  assert.equal(speedPowerRatio(10, 0), undefined);
});

test("timeCorrelation (Pearson) for cross-sensor alignment", () => {
  assert.equal(timeCorrelation([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(timeCorrelation([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(timeCorrelation([1, 1, 1], [1, 2, 3]), undefined); // zero variance
  assert.equal(timeCorrelation([1, 2], [1]), undefined); // length mismatch
});

// ── V21-06 踏频派生指标（复用 coefficientOfVariationPercent / timeCorrelation）──

test("cadence CV reuses coefficientOfVariationPercent", () => {
  // 踏频变异系数 = 踏频标准差 / 平均踏频，与通用 CV 同一口径。
  assert.equal(coefficientOfVariationPercent([85, 90, 95]), coefficientOfVariationPercent([85, 90, 95]));
});

test("cadence sensor alignment reuses timeCorrelation", () => {
  // 踏频-功率同步性 = 两序列时间相关系数，与通用 timeCorrelation 同一口径。
  assert.equal(timeCorrelation([80, 85, 90], [200, 210, 220]), 1);
});
