import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRideTemporalFeaturesV2,
  RIDE_UNLOCATED_STOP_TOLERANCE_RATIO,
} from "../src/domain/ride-temporal-features-v2.ts";
import { buildRideCapabilityClaimsV2 } from "../src/domain/ride-capability-claims-v2.ts";
import { buildRideAnalysisEvidencePacketsV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { buildRideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import { getDemoImportedRide } from "../src/fixtures/demo-imported-rides.ts";

// S2-04 (PD-AI-17, user decision 2026-10-06): un-locatable stopped time is
// the part of the device-recorded stop time that cannot be placed on the
// timeline (e.g. scattered traffic-light pauses on commute rides). Within 10%
// of the ride span the timeline stays usable and the ride keeps its AI
// interpretation; above the ratio the previous blocking behavior is kept.
// Statistics always exclude ALL stopped time (located + unlocated) from
// time-weighted denominators.

test("demo-ride-2026-08-20 (commute, ~5% unlocated stop time) stays interpretable under PD-AI-17", async () => {
  const demo = await getDemoImportedRide("demo-ride-2026-08-20");
  assert.ok(demo);
  const record = structuredClone(demo.record);

  const temporal = buildRideTemporalFeaturesV2(record);
  // Device recorded 240 s stopped, only 41 s locatable -> 199 s unlocated.
  assert.ok(temporal.unlocatedStopTimeS > 0);
  assert.ok(
    temporal.unlocatedStopTimeS / temporal.span <= RIDE_UNLOCATED_STOP_TOLERANCE_RATIO,
    `expected unlocated stop within tolerance, got ${temporal.unlocatedStopTimeS}/${temporal.span}`,
  );
  assert.equal(temporal.unlocatedStopTolerated, true);
  const heartRate = temporal.series.find((item) => item.seriesKey === "heart_rate")!;
  assert.ok(heartRate.statistics, "heart-rate statistics must be produced under tolerance");

  const snapshot = buildRideCapabilityClaimsV2(record);
  const capability = (key: string) => snapshot.capabilities.find((item) => item.key === key)!;
  // Capabilities have three states (available / partial / unavailable); under
  // tolerance the timeline-dependent ones must stay usable, i.e. not blocked.
  assert.notEqual(capability("timing").status, "unavailable");
  assert.notEqual(capability("heartRate").status, "unavailable");
  assert.notEqual(capability("speed").status, "unavailable");

  const context = buildRideAnalysisEvidencePacketsV2(snapshot, {
    analysisRunId: "run:s2-04:commute",
    userScope: "user:s2-04:commute",
  });
  const dimensionIds = context.evidencePackets.map((packet) => packet.dimensionId);
  assert.ok(dimensionIds.includes("heartRateLoad"), `heartRateLoad missing, got ${dimensionIds.join(",")}`);
  assert.ok(dimensionIds.includes("pacingExecution"), `pacingExecution missing, got ${dimensionIds.join(",")}`);

  const inputResult = buildRideModelInputV2(context, {
    analysisRunId: "run:s2-04:commute",
    userScope: "user:s2-04:commute",
  });
  assert.equal(inputResult.status, "ready");
});

test("unlocated stop time above 10% of the span still blocks the timeline (PD-AI-17 upper bound)", async () => {
  const demo = await getDemoImportedRide("demo-ride-2026-08-20");
  assert.ok(demo);
  const record = structuredClone(demo.record);
  // Grow the RECORDED elapsed time (not shrink moving time) so the avg-speed
  // consistency check keeps the record valid while the device-recorded stop
  // time grows: stopped 240 s -> 540 s, of which only 41 s is locatable, so
  // unlocated reaches ~499 s of the 3958 s span (~12.6% > 10%).
  const elapsed = record.activity.metrics.elapsedTimeS!;
  elapsed.value = elapsed.value + 300;

  const temporal = buildRideTemporalFeaturesV2(record);
  assert.equal(temporal.unlocatedStopTolerated, false);
  assert.ok(temporal.series.every((item) => item.statistics === undefined));

  const snapshot = buildRideCapabilityClaimsV2(record);
  const timing = snapshot.capabilities.find((item) => item.key === "timing")!;
  assert.equal(timing.status, "unavailable");
  assert.equal(timing.unavailableReason, "UNLOCATED_STOP_TIME");

  const context = buildRideAnalysisEvidencePacketsV2(snapshot, {
    analysisRunId: "run:s2-04:blocked",
    userScope: "user:s2-04:blocked",
  });
  assert.equal(context.evidencePackets.length, 0);
  const inputResult = buildRideModelInputV2(context, {
    analysisRunId: "run:s2-04:blocked",
    userScope: "user:s2-04:blocked",
  });
  assert.equal(inputResult.status, "blocked");
  if (inputResult.status === "blocked") {
    assert.equal(inputResult.failureCode, "NO_DELIVERABLE_QUESTIONS");
  }
});
