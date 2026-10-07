import test from "node:test";
import assert from "node:assert/strict";
import { isModelVisibleClaimKeyV21 } from "../src/domain/ride-model-input-v2.ts";

test("V21 whitelist keeps KB key metrics and base facts", () => {
  const visible = [
    "metric.distanceM", "metric.elevationGainM", "metric.elapsedDurationS",
    "timing.movingDurationS", "stops.count",
    "speed.mean", "power.mean", "power.normalizedW", "power.averageWkg",
    "power.intensityFactor", "power.trainingStressScore", "power.zone.highIntensityCombined",
    "heart_rate.mean", "heartRate.zone.z2", "heartRate.efficiencyFactor",
    "cadence.mean", "terrain.trendClimbDistanceM", "climb.representativeClimbCount",
    "pacing.variabilityIndex", "pacing.negativeSplit", "power.curve.300s",
    "profile.maxHeartRateBpm", "profile.verifiedFtpW",
  ];
  for (const key of visible) {
    assert.equal(isModelVisibleClaimKeyV21(key), true, `${key} should be visible`);
  }
});

test("V21 whitelist excludes KB-irrelevant claims from the model projection", () => {
  const hidden = ["metric.activityEnergyKcal", "cruise.representative.1", "cruise.totalDurationS"];
  for (const key of hidden) {
    assert.equal(isModelVisibleClaimKeyV21(key), false, `${key} should be hidden`);
  }
});
