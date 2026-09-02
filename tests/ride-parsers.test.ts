import assert from "node:assert/strict";
import test from "node:test";

import { buildRideCapability, validateRideActivity } from "../src/domain/ride-rules.ts";
import { parseFitActivity } from "../src/parsers/fit-parser.ts";
import {
  GPX_GPS_QUALITY_RULE_VERSION,
  MAX_PLAUSIBLE_CYCLING_SPEED_MPS,
  parseGpxActivity,
} from "../src/parsers/gpx-parser.ts";
import { isRideParseError } from "../src/parsers/parse-errors.ts";
import { parseRideFile } from "../src/parsers/index.ts";
import { assertUploadSize, MAX_UPLOAD_BYTES } from "../src/parsers/parser-utils.ts";
import { buildCyclingFitSample } from "./helpers/fit-sample.ts";

const TIMED_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>demo</name><trkseg>
    <trkpt lat="31.2304" lon="121.4737"><ele>10</ele><time>2026-08-17T06:00:00Z</time></trkpt>
    <trkpt lat="31.2304" lon="121.4937"><ele>30</ele><time>2026-08-17T06:10:00Z</time></trkpt>
    <trkpt lat="31.2304" lon="121.5137"><ele>25</ele><time>2026-08-17T06:20:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

const UNTIMED_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><ele>10</ele></trkpt>
  <trkpt lat="31.2304" lon="121.5137"><ele>25</ele></trkpt>
</trkseg></trk></gpx>`;

const ISOLATED_GPS_SPIKE_GPX = `<gpx version="1.1"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><time>2026-08-18T00:00:00Z</time></trkpt>
  <trkpt lat="39.9042" lon="116.4074"><time>2026-08-18T00:01:00Z</time></trkpt>
  <trkpt lat="31.2305" lon="121.4738"><time>2026-08-18T00:02:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const CONSECUTIVE_GPS_SPIKE_GPX = `<gpx version="1.1"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><time>2026-08-18T00:00:00Z</time></trkpt>
  <trkpt lat="39.9042" lon="116.4074"><time>2026-08-18T00:01:00Z</time></trkpt>
  <trkpt lat="39.9043" lon="116.4075"><time>2026-08-18T00:02:00Z</time></trkpt>
  <trkpt lat="31.2305" lon="121.4738"><time>2026-08-18T00:03:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const ENDPOINT_GPS_SPIKE_GPX = `<gpx version="1.1"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><time>2026-08-18T00:00:00Z</time></trkpt>
  <trkpt lat="39.9042" lon="116.4074"><time>2026-08-18T00:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const HIGH_BUT_PLAUSIBLE_GPX = `<gpx version="1.1"><trk><trkseg>
  <trkpt lat="0" lon="0"><time>2026-08-18T00:00:00Z</time></trkpt>
  <trkpt lat="0" lon="0.015"><time>2026-08-18T00:01:00Z</time></trkpt>
  <trkpt lat="0" lon="0.03"><time>2026-08-18T00:02:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test("a standards-compliant generated FIT binary is decoded into the accepted RideActivity schema", async () => {
  const activity = await parseFitActivity({
    rideId: "fit-binary-001",
    fileName: "generated-cycling.fit",
    bytes: buildCyclingFitSample(),
  });
  const validation = validateRideActivity(activity);
  const capability = buildRideCapability(activity);

  assert.equal(validation.valid, true);
  assert.equal(activity.source.kind, "fit");
  assert.equal(activity.metrics.distanceM?.value, 3_500);
  assert.equal(activity.metrics.movingTimeS?.value, 1_200);
  assert.equal(activity.metrics.avgSpeedMps?.value, 3_500 / 1_200);
  assert.equal(activity.metrics.avgSpeedMps?.provenance, "calculated");
  assert.equal(activity.metrics.avgSpeedMps?.formulaVersion, "distance-over-moving-time-v0.1");
  assert.equal(activity.metrics.avgPowerW?.value, 210);
  assert.equal(capability.dataLevel, "L3");
  assert.equal(capability.analysisMode, "full");
});

test("a truncated FIT binary returns a stable parser error", async () => {
  const truncated = buildCyclingFitSample().slice(0, 20);
  await assert.rejects(
    parseFitActivity({ rideId: "fit-broken-001", fileName: "broken.fit", bytes: truncated }),
    (error: unknown) => isRideParseError(error) && error.code === "FIT_INVALID_OR_CORRUPT",
  );
});

test("a FIT file with a bad CRC returns the same stable corruption error", async () => {
  const corrupted = buildCyclingFitSample();
  corrupted[corrupted.length - 1] = corrupted.at(-1)! ^ 0xff;
  await assert.rejects(
    parseFitActivity({ rideId: "fit-crc-001", fileName: "bad-crc.fit", bytes: corrupted }),
    (error: unknown) => isRideParseError(error) && error.code === "FIT_INVALID_OR_CORRUPT",
  );
});

test("non-cycling and multi-session FIT files are not silently misclassified", async () => {
  await assert.rejects(
    parseFitActivity({
      rideId: "fit-run-001",
      fileName: "running.fit",
      bytes: buildCyclingFitSample({ sportValue: 1 }),
    }),
    (error: unknown) => isRideParseError(error) && error.code === "FIT_NO_CYCLING_SESSION",
  );
  await assert.rejects(
    parseFitActivity({
      rideId: "fit-multi-001",
      fileName: "multi.fit",
      bytes: buildCyclingFitSample({ sessionCount: 2 }),
    }),
    (error: unknown) => isRideParseError(error) && error.code === "FIT_MULTIPLE_CYCLING_SESSIONS",
  );
});

test("all-zero FIT power placeholders do not create false L3 capability", async () => {
  const activity = await parseFitActivity({
    rideId: "fit-zero-power-001",
    fileName: "zero-power.fit",
    bytes: buildCyclingFitSample({ allZeroPower: true }),
  });
  const capability = buildRideCapability(activity);

  assert.equal(activity.metrics.avgPowerW, undefined);
  assert.equal(activity.metrics.normalizedPowerW, undefined);
  assert.equal(activity.sensorQuality.power, undefined);
  assert.equal(capability.dataLevel, "L2");
  assert.ok(activity.sourceIssues.some((issue) => issue.code === "FIT_ALL_ZERO_POWER_IGNORED"));
});

test("all-zero FIT heart-rate placeholders do not reject otherwise valid rides", async () => {
  const activity = await parseFitActivity({
    rideId: "fit-zero-heart-rate-real-001",
    fileName: "zero-heart-rate.fit",
    bytes: buildCyclingFitSample({ allZeroHeartRate: true }),
  });
  const validation = validateRideActivity(activity);
  const capability = buildRideCapability(activity);

  assert.equal(validation.valid, true);
  assert.equal(activity.metrics.avgHeartRateBpm, undefined);
  assert.equal(activity.metrics.maxHeartRateBpm, undefined);
  assert.equal(activity.sensorQuality.heart_rate, undefined);
  assert.equal(capability.dataLevel, "L3");
  assert.equal(capability.analysisMode, "full");
  assert.ok(activity.sourceIssues.some((issue) => issue.code === "FIT_ALL_ZERO_HEART_RATE_IGNORED"));
});

test("all-zero FIT cadence placeholders do not create cadence capability", async () => {
  const activity = await parseFitActivity({
    rideId: "fit-zero-cadence-001",
    fileName: "zero-cadence.fit",
    bytes: buildCyclingFitSample({ allZeroCadence: true }),
  });
  const validation = validateRideActivity(activity);

  assert.equal(validation.valid, true);
  assert.equal(activity.metrics.avgCadenceRpm, undefined);
  assert.equal(activity.metrics.maxCadenceRpm, undefined);
  assert.equal(activity.sensorQuality.cadence, undefined);
  assert.ok(activity.sourceIssues.some((issue) => issue.code === "FIT_ALL_ZERO_CADENCE_IGNORED"));
});

test("timed GPX computes only traceable L1 metrics", () => {
  const activity = parseGpxActivity({ rideId: "gpx-timed-001", fileName: "timed.gpx", xml: TIMED_GPX });
  const validation = validateRideActivity(activity);
  const capability = buildRideCapability(activity);

  assert.equal(validation.valid, true);
  assert.equal(capability.dataLevel, "L1");
  assert.equal(capability.analysisMode, "full");
  assert.ok((activity.metrics.distanceM?.value ?? 0) > 3_000);
  assert.equal(activity.metrics.elapsedTimeS?.value, 1_200);
  assert.equal(activity.metrics.elevationGainM?.value, 20);
  assert.equal(activity.metrics.distanceM?.formulaVersion, "haversine-v0.1");
});

test("GPX without timestamps never creates time or speed", () => {
  const activity = parseGpxActivity({ rideId: "gpx-untimed-001", fileName: "untimed.gpx", xml: UNTIMED_GPX });
  const validation = validateRideActivity(activity);
  const capability = buildRideCapability(activity);

  assert.equal(validation.valid, true);
  assert.equal(activity.startTime, undefined);
  assert.equal(activity.metrics.elapsedTimeS, undefined);
  assert.equal(activity.metrics.movingTimeS, undefined);
  assert.equal(activity.metrics.avgSpeedMps, undefined);
  assert.equal(capability.analysisMode, "basic");
  assert.ok(validation.issues.some((issue) => issue.code === "MISSING_TIMESTAMPS"));
});

test("GPX rejects malformed and unsafe XML with stable codes", () => {
  assert.throws(
    () => parseGpxActivity({ rideId: "gpx-bad-001", fileName: "bad.gpx", xml: "<gpx><trk>" }),
    (error: unknown) => isRideParseError(error) && error.code === "GPX_INVALID_XML",
  );
  assert.throws(
    () => parseGpxActivity({
      rideId: "gpx-unsafe-001",
      fileName: "unsafe.gpx",
      xml: "<!DOCTYPE gpx [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><gpx>&xxe;</gpx>",
    }),
    (error: unknown) => isRideParseError(error) && error.code === "GPX_UNSAFE_XML",
  );
});

test("GPX rejects out-of-range coordinates", () => {
  const invalidCoordinates = "<gpx version='1.1'><trk><trkseg><trkpt lat='95' lon='121'/></trkseg></trk></gpx>";
  assert.throws(
    () => parseGpxActivity({ rideId: "gpx-coordinate-001", fileName: "coordinates.gpx", xml: invalidCoordinates }),
    (error: unknown) => isRideParseError(error) && error.code === "GPX_INVALID_COORDINATES",
  );
});

test("an isolated impossible GPS spike is filtered before metric calculation", () => {
  const activity = parseGpxActivity({
    rideId: "gpx-isolated-spike-001",
    fileName: "isolated-spike.gpx",
    xml: ISOLATED_GPS_SPIKE_GPX,
  });
  const capability = buildRideCapability(activity);

  assert.ok((activity.metrics.distanceM?.value ?? Number.POSITIVE_INFINITY) < 100);
  assert.equal(activity.metrics.avgSpeedMps, undefined);
  assert.equal(activity.sensorQuality.gps?.sampleCount, 3);
  assert.equal(activity.sensorQuality.gps?.invalidSampleCount, 1);
  assert.equal(activity.sensorQuality.gps?.coverage, 2 / 3);
  assert.ok(activity.sourceIssues.some((issue) =>
    issue.code === "GPX_GPS_SPIKE_FILTERED" && issue.message.includes(GPX_GPS_QUALITY_RULE_VERSION)
  ));
  assert.equal(capability.analysisMode, "basic");
  assert.ok(!capability.allowedTopics.includes("速度"));
});

test("continuous or endpoint-like impossible jumps are rejected instead of guessed", () => {
  assert.throws(
    () => parseGpxActivity({
      rideId: "gpx-consecutive-spike-001",
      fileName: "consecutive-spike.gpx",
      xml: CONSECUTIVE_GPS_SPIKE_GPX,
    }),
    (error: unknown) => isRideParseError(error) && error.code === "GPX_IMPLAUSIBLE_TRACK",
  );
  assert.throws(
    () => parseGpxActivity({
      rideId: "gpx-endpoint-spike-001",
      fileName: "endpoint-spike.gpx",
      xml: ENDPOINT_GPS_SPIKE_GPX,
    }),
    (error: unknown) => isRideParseError(error) && error.code === "GPX_IMPLAUSIBLE_TRACK",
  );
});

test("high but plausible cycling speed stays below the versioned quality threshold", () => {
  const activity = parseGpxActivity({
    rideId: "gpx-high-speed-001",
    fileName: "high-speed.gpx",
    xml: HIGH_BUT_PLAUSIBLE_GPX,
  });

  assert.equal(MAX_PLAUSIBLE_CYCLING_SPEED_MPS, 200 / 3.6);
  assert.ok((activity.metrics.avgSpeedMps?.value ?? 0) < MAX_PLAUSIBLE_CYCLING_SPEED_MPS);
  assert.ok(!activity.sourceIssues.some((issue) => issue.code === "GPX_GPS_SPIKE_FILTERED"));
});

test("the dispatcher enforces binary FIT input and known extensions", async () => {
  await assert.rejects(
    parseRideFile({ rideId: "fit-text-001", fileName: "wrong.fit", content: "not binary" }),
    (error: unknown) => isRideParseError(error) && error.code === "UNSUPPORTED_FILE_TYPE",
  );
  await assert.rejects(
    parseRideFile({ rideId: "csv-001", fileName: "ride.csv", content: "distance,time" }),
    (error: unknown) => isRideParseError(error) && error.code === "UNSUPPORTED_FILE_TYPE",
  );
  await assert.rejects(
    parseRideFile({ rideId: "gpx-encoding-001", fileName: "encoding.gpx", content: new Uint8Array([0xff, 0xfe]) }),
    (error: unknown) => isRideParseError(error) && error.code === "GPX_INVALID_ENCODING",
  );
});

test("empty and oversized uploads fail before either parser runs", () => {
  assert.throws(
    () => assertUploadSize(0),
    (error: unknown) => isRideParseError(error) && error.code === "FILE_EMPTY",
  );
  assert.throws(
    () => assertUploadSize(MAX_UPLOAD_BYTES + 1),
    (error: unknown) => isRideParseError(error) && error.code === "FILE_TOO_LARGE",
  );
});
