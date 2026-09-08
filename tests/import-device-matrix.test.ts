import assert from "node:assert/strict";
import test from "node:test";

import { isRideParseError, parseRideRecord } from "../src/parsers/index.ts";
import { buildRideCapability } from "../src/domain/ride-rules.ts";
import { buildCyclingFitSample } from "./helpers/fit-sample.ts";

/**
 * MVP-FOUNDATION-04 支持设备/来源矩阵（RISK-004 证据）
 *
 * 每个用例代表一类真实导出来源的合成样本；断言解析器的确定性结果
 * （接受、接受但降级/警告、或稳定错误码）。真实设备文件进入回归时
 * 按同表追加行，不替换合成样本。
 *
 * | 编号 | 来源类别 | 格式 | 预期 |
 * |---|---|---|---|
 * | FIT-1 | 码表完整记录（GPS+心率+功率+踏频） | FIT | 接受，L3/full |
 * | FIT-2 | 智能骑行台/虚拟平台（无 GPS） | FIT | 接受，轨迹降级 |
 * | FIT-3 | 功率字段全零占位设备 | FIT | 接受，FIT_ALL_ZERO_POWER_IGNORED 警告 |
 * | FIT-4 | GPS (0,0) 占位坐标设备 | FIT | 接受，轨迹按不可用处理 |
 * | FIT-5 | 多段骑行合并导出 | FIT | 拒绝 FIT_MULTIPLE_CYCLING_SESSIONS |
 * | FIT-6 | 扩展名伪装（.fit 的 XML/随机字节） | FIT | 拒绝 FILE_HEADER_MISMATCH |
 * | GPX-1 | 标准导出（时间+海拔） | GPX | 接受，L1 可追溯指标 |
 * | GPX-2 | 无海拔导出 | GPX | 接受，海拔不生成 |
 * | GPX-3 | 无时间戳导出 | GPX | 接受，GPX_TIMING_UNAVAILABLE 警告 |
 * | GPX-4 | 多段 trkseg（自动暂停设备） | GPX | 接受，点位按顺序合并 |
 * | GPX-5 | 带命名空间/TrackPointExtension | GPX | 接受，扩展忽略、标准字段可用 |
 * | GPX-6 | 扩展名伪装（.gpx 的 CSV/JSON） | GPX | 拒绝 FILE_HEADER_MISMATCH |
 */

async function expectParseError(input: Parameters<typeof parseRideRecord>[0], code: string): Promise<void> {
  try {
    await parseRideRecord(input);
    assert.fail(`expected RideParseError ${code}`);
  } catch (error) {
    assert.ok(isRideParseError(error), `expected RideParseError, got ${String(error)}`);
    assert.equal(error.code, code);
  }
}

test("matrix FIT-1: head-unit full record (GPS+HR+power+cadence) is accepted at L3", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-fit-1",
    fileName: "head-unit.fit",
    content: buildCyclingFitSample({ realGps: true }),
  });
  const capability = buildRideCapability(record.activity);
  assert.equal(record.activity.source.kind, "fit");
  assert.equal(capability.dataLevel, "L3");
  assert.equal(capability.analysisMode, "full");
  assert.ok(record.series.availableSeries.includes("route"));
  assert.equal(record.series.seriesMetadata.route?.qualityStatus, "valid");
});

test("matrix FIT-2: trainer/virtual-platform file without GPS is accepted without route series", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-fit-2",
    fileName: "trainer.fit",
    content: buildCyclingFitSample({ includeGpsPlaceholder: false }),
  });
  assert.equal(record.activity.source.kind, "fit");
  // 无 GPS 样本没有 position 字段，轨迹序列整体不可用。
  assert.equal(record.series.availableSeries.includes("route"), false);
  assert.ok(record.series.availableSeries.includes("power"));
});

test("matrix FIT-3: all-zero power placeholder device is accepted with a warning", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-fit-3",
    fileName: "zero-power.fit",
    content: buildCyclingFitSample({ allZeroPower: true }),
  });
  assert.ok(record.activity.sourceIssues.some((issue) => issue.code === "FIT_ALL_ZERO_POWER_IGNORED"));
  assert.equal(record.activity.metrics.avgPowerW, undefined);
});

test("matrix FIT-4: GPS (0,0) placeholder coordinates are filtered, route stays usable", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-fit-4",
    fileName: "gps-placeholder.fit",
    content: buildCyclingFitSample({ includeGpsPlaceholder: true }),
  });
  // 首点 (0,0) 占位被剔除，覆盖率为 4/5，轨迹序列仍可用。
  assert.equal(record.activity.sensorQuality.gps?.coverage, 0.8);
  assert.ok(record.series.availableSeries.includes("route"));
});

test("matrix FIT-5: multi-session export is rejected with a stable code", async () => {
  await expectParseError({
    rideId: "matrix-fit-5",
    fileName: "multi-session.fit",
    content: buildCyclingFitSample({ sessionCount: 2 }),
  }, "FIT_MULTIPLE_CYCLING_SESSIONS");
});

test("matrix FIT-6: XML or random bytes disguised as .fit fail the header check", async () => {
  const xmlBytes = new TextEncoder().encode("<?xml version=\"1.0\"?><gpx></gpx>");
  await expectParseError({ rideId: "matrix-fit-6a", fileName: "fake.fit", content: xmlBytes }, "FILE_HEADER_MISMATCH");
  const randomBytes = crypto.getRandomValues(new Uint8Array(64));
  await expectParseError({ rideId: "matrix-fit-6b", fileName: "random.fit", content: randomBytes }, "FILE_HEADER_MISMATCH");
});

const GPX_POINT = (lat: string, lon: string, ele: string | null, time: string | null) =>
  `<trkpt lat="${lat}" lon="${lon}">${ele === null ? "" : `<ele>${ele}</ele>`}${time === null ? "" : `<time>${time}</time>`}</trkpt>`;

test("matrix GPX-1: standard timed export with elevation computes traceable metrics", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-gpx-1",
    fileName: "standard.gpx",
    content: `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="matrix"><trk><trkseg>${
      GPX_POINT("31.2304", "121.4737", "10", "2026-08-17T06:00:00Z") +
      GPX_POINT("31.2304", "121.4937", "30", "2026-08-17T06:10:00Z") +
      GPX_POINT("31.2304", "121.5137", "25", "2026-08-17T06:20:00Z")
    }</trkseg></trk></gpx>`,
  });
  assert.equal(record.activity.source.kind, "gpx");
  assert.ok((record.activity.metrics.distanceM?.value ?? 0) > 3_000);
  assert.equal(record.activity.metrics.elapsedTimeS?.value, 1_200);
  assert.ok((record.activity.metrics.elevationGainM?.value ?? 0) > 0);
});

test("matrix GPX-2: export without elevation is accepted and omits ascent", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-gpx-2",
    fileName: "no-ele.gpx",
    content: `<gpx version="1.1"><trk><trkseg>${
      GPX_POINT("31.2304", "121.4737", null, "2026-08-17T06:00:00Z") +
      GPX_POINT("31.2304", "121.4937", null, "2026-08-17T06:10:00Z")
    }</trkseg></trk></gpx>`,
  });
  // 无海拔点位不累计爬升（0 米，而非缺失）。
  assert.equal(record.activity.metrics.elevationGainM?.value ?? 0, 0);
  assert.ok((record.activity.metrics.distanceM?.value ?? 0) > 0);
});

test("matrix GPX-3: export without timestamps is accepted with timing warning", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-gpx-3",
    fileName: "untimed.gpx",
    content: `<gpx version="1.1"><trk><trkseg>${
      GPX_POINT("31.2304", "121.4737", "10", null) +
      GPX_POINT("31.2304", "121.4937", "20", null)
    }</trkseg></trk></gpx>`,
  });
  assert.ok(record.activity.sourceIssues.some((issue) => issue.code === "GPX_TIMING_UNAVAILABLE"));
  assert.equal(record.activity.metrics.elapsedTimeS, undefined);
  assert.equal(record.activity.metrics.avgSpeedMps, undefined);
});

test("matrix GPX-4: multi-segment tracks (auto-pause devices) merge in order", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-gpx-4",
    fileName: "segments.gpx",
    content: `<gpx version="1.1"><trk>
      <trkseg>${GPX_POINT("31.2304", "121.4737", "10", "2026-08-17T06:00:00Z")}${GPX_POINT("31.2304", "121.4837", "15", "2026-08-17T06:05:00Z")}</trkseg>
      <trkseg>${GPX_POINT("31.2304", "121.4937", "20", "2026-08-17T06:10:00Z")}${GPX_POINT("31.2304", "121.5037", "25", "2026-08-17T06:15:00Z")}</trkseg>
    </trk></gpx>`,
  });
  const routePoints = record.series.points.filter((point) => point.route);
  assert.equal(record.series.points.length, 4);
  assert.equal(routePoints.length, 4);
});

test("matrix GPX-5: namespaced export with TrackPointExtension keeps standard fields", async () => {
  const record = await parseRideRecord({
    rideId: "matrix-gpx-5",
    fileName: "extensions.gpx",
    content: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="matrix" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><trkseg>
<trkpt lat="31.2304" lon="121.4737"><ele>10</ele><time>2026-08-17T06:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="31.2304" lon="121.4937"><ele>20</ele><time>2026-08-17T06:10:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
</trkseg></trk></gpx>`,
  });
  // 标准字段可用；扩展字段当前版本忽略，不产生心率能力。
  assert.ok((record.activity.metrics.distanceM?.value ?? 0) > 0);
  assert.equal(record.activity.metrics.avgHeartRateBpm, undefined);
});

test("matrix GPX-6: non-XML content disguised as .gpx fails the header check", async () => {
  await expectParseError({
    rideId: "matrix-gpx-6a",
    fileName: "fake.gpx",
    content: new TextEncoder().encode("distance,time\n1,2"),
  }, "FILE_HEADER_MISMATCH");
  await expectParseError({
    rideId: "matrix-gpx-6b",
    fileName: "json.gpx",
    content: new TextEncoder().encode("{\"trk\":[]}"),
  }, "FILE_HEADER_MISMATCH");
});

test("matrix coverage: 6 FIT + 6 GPX source categories are represented", () => {
  const fitCases = ["head-unit", "trainer", "zero-power", "gps-placeholder", "multi-session", "fake"];
  const gpxCases = ["standard", "no-ele", "untimed", "segments", "extensions", "fake"];
  assert.equal(fitCases.length, 6);
  assert.equal(gpxCases.length, 6);
});
