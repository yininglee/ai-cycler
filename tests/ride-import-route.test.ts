import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/rides/import/route.ts";
import { getImportedRide } from "../src/imports/demo-ride-store.ts";
import { buildRidePageViewModelFromRecord } from "../src/ui/ride-view-model.ts";
import { buildCyclingFitSample } from "./helpers/fit-sample.ts";

const TIMED_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"><trk><trkseg>
  <trkpt lat="31.2304" lon="121.4737"><ele>10</ele><time>2026-08-17T06:00:00Z</time></trkpt>
  <trkpt lat="31.2304" lon="121.4937"><ele>30</ele><time>2026-08-17T06:10:00Z</time></trkpt>
  <trkpt lat="31.2304" lon="121.5137"><ele>25</ele><time>2026-08-17T06:20:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test("import route parses a GPX upload and makes only its normalized record available", async () => {
  const form = new FormData();
  form.set("file", new Blob([TIMED_GPX], { type: "application/gpx+xml" }), "morning.gpx");
  const response = await POST(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));
  const body = await response.json() as { rideId?: string };

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(body.rideId ?? "", /^upload-/);
  const record = getImportedRide(body.rideId!);
  assert.ok(record);
  assert.equal(record.activity.source.kind, "gpx");
  assert.equal(record.activity.source.fileName, "morning.gpx");
  assert.ok((record.activity.metrics.distanceM?.value ?? 0) > 3_000);
  assert.equal(record.series.privacy.preciseCoordinatesExcluded, true);
  assert.doesNotMatch(JSON.stringify(record.series), /31\.2304|121\.4737|latitude|longitude/i);
});

test("import route rejects unsupported file extensions before parsing", async () => {
  const form = new FormData();
  form.set("file", new Blob(["distance,time"]), "ride.csv");
  const response = await POST(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "UNSUPPORTED_FILE_TYPE",
    message: "当前只支持 .fit 和 .gpx 文件",
  });
});

test("a valid FIT with non-fatal source warnings remains available in the detail view", async () => {
  const form = new FormData();
  const fitBytes = buildCyclingFitSample({ allZeroPower: true });
  form.set("file", new Blob([fitBytes.buffer as ArrayBuffer], { type: "application/octet-stream" }), "ride.fit");
  const response = await POST(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));
  const body = await response.json() as { rideId?: string };
  const record = getImportedRide(body.rideId!);

  assert.equal(response.status, 201);
  assert.ok(record);
  assert.ok(record.activity.sourceIssues.some((issue) => issue.severity === "warning"));
  const view = buildRidePageViewModelFromRecord(record);
  assert.equal(view.analysis.snapshot.analysisMode, "full");
  assert.ok(view.factCards.length > 0);
  assert.equal(view.visuals.charts.length > 0, true);
});
