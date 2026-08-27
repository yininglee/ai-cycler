import assert from "node:assert/strict";
import test from "node:test";

import { getRideFixture } from "../src/fixtures/rides.ts";
import { getImportedRide, getRideRecord, saveImportedRide } from "../src/imports/demo-ride-store.ts";

test("the local import store retains only an isolated normalized RideRecord", () => {
  const fixture = getRideFixture("l1-built-in-sample");
  const record = structuredClone({ activity: fixture.activity, series: fixture.series });
  record.activity.rideId = "upload-store-test";
  record.activity.source = { ...record.activity.source, kind: "gpx", fileName: "private-ride.gpx" };
  record.series.rideId = "upload-store-test";

  saveImportedRide(record);
  record.activity.metrics.distanceM!.value = 1;

  const stored = getImportedRide("upload-store-test");
  assert.ok(stored);
  assert.notEqual(stored.activity.metrics.distanceM?.value, 1);
  assert.equal(stored.activity.source.fileName, "private-ride.gpx");
  assert.equal(stored.series.privacy.preciseCoordinatesExcluded, true);
  assert.doesNotMatch(JSON.stringify(stored.series), /latitude|longitude/i);
  assert.equal(getRideRecord("upload-store-test")?.activity.rideId, "upload-store-test");
});
