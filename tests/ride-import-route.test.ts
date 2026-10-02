import "./helpers/route-test-env.ts";
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
  assert.equal(view.rejected, false);
  assert.ok(view.factCards.length > 0);
  assert.equal(view.visuals.charts.length > 0, true);
});

test("re-uploading identical content in the same session returns the existing ride id", async () => {
  const upload = (): Request => {
    const form = new FormData();
    form.set("file", new Blob([TIMED_GPX], { type: "application/gpx+xml" }), "morning.gpx");
    return new Request("http://localhost/api/rides/import", { method: "POST", body: form });
  };

  const first = await POST(upload());
  const firstBody = await first.json() as { rideId?: string; duplicate?: boolean };
  assert.equal(first.status, 201);
  const cookie = first.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const second = await POST(new Request("http://localhost/api/rides/import", {
    method: "POST",
    headers: { cookie },
    body: (() => { const form = new FormData(); form.set("file", new Blob([TIMED_GPX], { type: "application/gpx+xml" }), "morning.gpx"); return form; })(),
  }));
  const secondBody = await second.json() as { rideId?: string; duplicate?: boolean };

  assert.equal(second.status, 200);
  assert.equal(secondBody.rideId, firstBody.rideId);
  assert.equal(secondBody.duplicate, true);
});

test("a declared MIME type conflicting with the extension is rejected before parsing", async () => {
  const form = new FormData();
  form.set("file", new Blob([TIMED_GPX], { type: "image/png" }), "ride.gpx");
  const response = await POST(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));

  assert.equal(response.status, 422);
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "UNSUPPORTED_MIME_TYPE");
});

test("imports beyond the per-session sliding window are rejected with 429 and Retry-After", async () => {
  // 先建立一个独立会话：第一次导入消耗一个配额并返回会话 Cookie。
  const form = new FormData();
  form.set("file", new Blob(["distance,time"]), "ride.csv");
  const first = await POST(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));
  assert.equal(first.status, 422);
  const cookie = first.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const post = () => POST(new Request("http://localhost/api/rides/import", {
    method: "POST",
    headers: { cookie },
    body: new FormData(),
  }));

  // 默认窗口 10 次/60 秒：首次已用 1 次，再发 9 次（共 10 次）仍应放行（4xx 业务拒绝但未超限）。
  for (let i = 0; i < 9; i += 1) {
    const response = await post();
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error?: string }).error, "MISSING_FILE");
  }

  // 窗口内 10 次配额用尽后，第 11 次请求返回 429 + Retry-After。
  const throttled = await post();
  assert.equal(throttled.status, 429);
  const body = await throttled.json() as { error?: string };
  assert.equal(body.error, "IMPORT_RATE_LIMITED");
  const retryAfter = Number(throttled.headers.get("retry-after"));
  assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1 && retryAfter <= 60);
});
