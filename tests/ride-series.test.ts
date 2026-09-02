import assert from "node:assert/strict";
import test from "node:test";

import { validateRideActivity } from "../src/domain/ride-rules.ts";
import { validateRideRecord, validateRideSeries } from "../src/domain/ride-series.ts";
import { getRideFixture, rideFixtures } from "../src/fixtures/rides.ts";
import { parseFitRide } from "../src/parsers/fit-parser.ts";
import { parseGpxRide } from "../src/parsers/gpx-parser.ts";
import { buildCyclingFitSample } from "./helpers/fit-sample.ts";

const TIMED_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="series-test"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><ele>10</ele><time>2026-08-19T00:00:00Z</time></trkpt>
  <trkpt lat="31.2305" lon="121.4837"><ele>25</ele><time>2026-08-19T00:05:00Z</time></trkpt>
  <trkpt lat="31.2310" lon="121.4937"><ele>20</ele><time>2026-08-19T00:10:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const UNTIMED_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="series-test"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><ele>10</ele></trkpt>
  <trkpt lat="31.2305" lon="121.4837"><ele>25</ele></trkpt>
  <trkpt lat="31.2310" lon="121.4937"><ele>20</ele></trkpt>
</trkseg></trk></gpx>`;

test("all current fixtures migrate to RideActivity v0.2 and valid RideSeries v0.1 contracts", () => {
  assert.equal(rideFixtures.length, 15);
  for (const fixture of rideFixtures) {
    assert.equal(fixture.activity.schemaVersion, "0.2", fixture.fixtureId);
    assert.equal(fixture.series.schemaVersion, "0.1", fixture.fixtureId);
    assert.equal(fixture.series.rideId, fixture.activity.rideId, fixture.fixtureId);
    assert.equal(validateRideSeries(fixture.series, fixture.activity).valid, true, fixture.fixtureId);
    assert.deepEqual(Object.keys(fixture.series.seriesMetadata), fixture.series.availableSeries, fixture.fixtureId);
  }
});

test("every aggregate metric preserves source field, source unit, quality, and applicable time", () => {
  for (const fixture of rideFixtures) {
    for (const [key, metric] of Object.entries(fixture.activity.metrics)) {
      assert.ok(metric.sourceField.length > 0, `${fixture.fixtureId}:${key}:sourceField`);
      assert.ok(metric.sourceUnit.length > 0, `${fixture.fixtureId}:${key}:sourceUnit`);
      assert.ok(["valid", "degraded"].includes(metric.qualityStatus), `${fixture.fixtureId}:${key}:quality`);
      if (fixture.activity.startTime) assert.ok(metric.recordedAt, `${fixture.fixtureId}:${key}:recordedAt`);
    }
    assert.equal(validateRideActivity(fixture.activity).valid, fixture.expected.valid, fixture.fixtureId);
  }
});

test("timed GPX produces privacy-safe route, distance, elevation, time, and speed series", () => {
  const record = parseGpxRide({ rideId: "timed-series", fileName: "timed.gpx", xml: TIMED_GPX });
  assert.equal(validateRideRecord(record).valid, true);
  assert.deepEqual(record.series.availableSeries, ["route", "distance", "elevation", "speed"]);
  assert.equal(record.series.points.length, 3);
  assert.equal(record.series.points.at(-1)?.elapsedTimeS, 600);
  assert.equal(record.series.timeBasis.kind, "elapsed_from_start");
  assert.equal(record.series.seriesMetadata.speed?.unit, "m/s");
  assert.equal(record.series.seriesMetadata.speed?.sampleCount, 2);
  assert.ok((record.activity.metrics.maxSpeedMps?.value ?? 0) > 0);
  const serialized = JSON.stringify(record.series);
  assert.ok(!serialized.includes("latitude"));
  assert.ok(!serialized.includes("longitude"));
  for (const point of record.series.points) {
    if (!point.route) continue;
    assert.ok(point.route.x >= 0 && point.route.x <= 1);
    assert.ok(point.route.y >= 0 && point.route.y <= 1);
  }
});

test("untimed GPX keeps route, distance, and elevation but never creates time or speed series", () => {
  const record = parseGpxRide({ rideId: "untimed-series", fileName: "untimed.gpx", xml: UNTIMED_GPX });
  assert.equal(validateRideRecord(record).valid, true);
  assert.deepEqual(record.series.availableSeries, ["route", "distance", "elevation"]);
  assert.ok(record.series.points.every((point) => point.elapsedTimeS === undefined));
  assert.ok(record.series.points.every((point) => point.speedMps === undefined));
  assert.deepEqual(record.series.timeBasis, { kind: "none" });
  assert.equal(record.activity.metrics.movingTimeS, undefined);
  assert.equal(record.activity.metrics.avgSpeedMps, undefined);
  assert.equal(record.activity.metrics.maxSpeedMps, undefined);
});

test("FIT produces optional recorded sensor series and traceable energy/max metrics without filling missing GPS", async () => {
  const record = await parseFitRide({
    rideId: "fit-series",
    fileName: "series.fit",
    bytes: buildCyclingFitSample(),
  });
  assert.equal(validateRideRecord(record).valid, true);
  assert.deepEqual(record.series.availableSeries, ["distance", "speed", "heart_rate", "power", "cadence"]);
  assert.ok(record.series.points.every((point) => point.route === undefined));
  assert.equal(record.series.seriesMetadata.heart_rate?.sourceField, "records.heart_rate");
  assert.equal(record.series.seriesMetadata.power?.qualityStatus, "valid");
  assert.equal(record.activity.metrics.activityEnergyKcal?.value, 320);
  assert.equal(record.activity.metrics.activityEnergyKcal?.sourceField, "session.total_calories");
  assert.equal(record.activity.metrics.maxPowerW?.value, 225);
  assert.equal(record.activity.metrics.maxCadenceRpm?.value, 120);
});

test("FIT zero GPS placeholders are excluded from the relative route", async () => {
  const record = await parseFitRide({
    rideId: "fit-gps-placeholder-series",
    fileName: "gps-placeholder.fit",
    bytes: buildCyclingFitSample({ includeGpsPlaceholder: true }),
  });
  assert.equal(validateRideRecord(record).valid, true);
  assert.ok(record.series.availableSeries.includes("route"));
  assert.equal(record.series.points.filter((point) => point.route !== undefined).length, 4);
  assert.equal(record.series.seriesMetadata.route?.sampleCount, 4);
});

test("all-zero FIT power never creates aggregate or series power capability", async () => {
  const record = await parseFitRide({
    rideId: "fit-zero-series",
    fileName: "zero.fit",
    bytes: buildCyclingFitSample({ allZeroPower: true }),
  });
  assert.equal(record.activity.metrics.avgPowerW, undefined);
  assert.equal(record.activity.metrics.maxPowerW, undefined);
  assert.ok(!record.series.availableSeries.includes("power"));
  assert.ok(record.series.points.every((point) => point.powerW === undefined));
});

test("all-zero FIT cadence never creates aggregate or series cadence capability", async () => {
  const record = await parseFitRide({
    rideId: "fit-zero-cadence-series",
    fileName: "zero-cadence.fit",
    bytes: buildCyclingFitSample({ allZeroCadence: true }),
  });
  assert.equal(validateRideRecord(record).valid, true);
  assert.equal(record.activity.metrics.avgCadenceRpm, undefined);
  assert.equal(record.activity.metrics.maxCadenceRpm, undefined);
  assert.equal(record.activity.sensorQuality.cadence, undefined);
  assert.ok(!record.series.availableSeries.includes("cadence"));
  assert.ok(record.series.points.every((point) => point.cadenceRpm === undefined));
});

test("a zero cadence sample remains valid when the FIT contains pedaling evidence", async () => {
  const record = await parseFitRide({
    rideId: "fit-cadence-coasting-series",
    fileName: "cadence-coasting.fit",
    bytes: buildCyclingFitSample({ includeCadenceZero: true }),
  });
  assert.ok(record.series.availableSeries.includes("cadence"));
  assert.equal(record.series.points[0]?.cadenceRpm, 0);
  assert.ok(record.series.points.some((point) => (point.cadenceRpm ?? 0) > 0));
});

test("series validation rejects activity/source mismatch and fabricated untimed GPX speed", () => {
  const fixture = getRideFixture("gpx-no-timestamps");
  const mismatched = structuredClone(fixture.series);
  mismatched.rideId = "other-ride";
  assert.ok(validateRideSeries(mismatched, fixture.activity).issues.some((item) => item.code === "SERIES_RIDE_ID_MISMATCH"));

  const fabricated = structuredClone(fixture.series);
  fabricated.points[0] = { ...fabricated.points[0]!, elapsedTimeS: 0, speedMps: 5 };
  fabricated.availableSeries = [...fabricated.availableSeries, "speed"];
  assert.ok(validateRideSeries(fabricated, fixture.activity).issues.some((item) => item.code === "UNTRUSTED_GPX_SERIES_TIMING"));
});
