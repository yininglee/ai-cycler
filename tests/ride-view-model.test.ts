import assert from "node:assert/strict";
import test from "node:test";

import { getRideFixture } from "../src/fixtures/rides.ts";
import { buildRidePageViewModel, buildRidePageViewModelFromRecord, DEMO_RIDE_IDS, isDemoRideId, RIDE_DETAIL_UI_VERSION } from "../src/ui/ride-view-model.ts";

test("all visual-shell demo routes resolve to valid ride detail view models", () => {
  for (const id of DEMO_RIDE_IDS) {
    const view = buildRidePageViewModel(id);
    assert.equal(view.id, id);
    assert.equal(view.uiVersion, RIDE_DETAIL_UI_VERSION);
    assert.equal(view.rejected, id === "fit-truncated-file");
    assert.ok(view.factCards.length <= 5);
  }
});

test("visual route guard rejects unknown fixture ids", () => {
  assert.equal(isDemoRideId("l2-built-in-sample"), true);
  assert.equal(isDemoRideId("other-user-private"), false);
});

test("fact cards keep evidence labels and follow fields present in each normalized record", () => {
  const l1 = buildRidePageViewModel("l1-built-in-sample");
  const l2 = buildRidePageViewModel("l2-built-in-sample");
  const l3 = buildRidePageViewModel("l3-built-in-sample");

  assert.ok(l1.factCards.every((card) => card.evidenceId));
  assert.ok(!l1.factCards.some((card) => card.label.includes("心率") || card.label.includes("功率")));
  assert.ok(l2.factCards.every((card) => card.evidenceId));
  assert.ok(l2.detailSections.flatMap((section) => section.metrics).some((metric) => metric.label === "平均心率"));
  assert.ok(l3.detailSections.flatMap((section) => section.metrics).some((metric) => metric.label === "平均功率"));
});

test("summary keeps four core metrics and adds energy only when reliable", () => {
  const core = ["距离", "骑行时间", "平均速度", "累计爬升"];

  for (const id of ["l1-built-in-sample", "l2-built-in-sample"] as const) {
    const view = buildRidePageViewModel(id);
    assert.deepEqual(view.factCards.map((card) => card.label), core);
  }

  const l3 = buildRidePageViewModel("l3-built-in-sample");
  assert.deepEqual(l3.factCards.map((card) => card.label), [...core, "运动消耗"]);
  assert.equal(l3.factCards.at(-1)?.value, "860 kcal");
});

test("short valid rides remain visible without the retired full-sample gate", () => {
  const fixture = getRideFixture("short-fit-ride");
  const view = buildRidePageViewModelFromRecord({ activity: fixture.activity, series: fixture.series });

  assert.equal(view.rejected, false);
  assert.ok(view.factCards.some((card) => card.label === "距离"));
  assert.ok(view.factCards.some((card) => card.label === "骑行时间"));
});

test("detail sections include all supported values present in the normalized record", () => {
  const l1 = buildRidePageViewModel("l1-built-in-sample");
  const l2 = buildRidePageViewModel("l2-built-in-sample");
  const l3 = buildRidePageViewModel("l3-built-in-sample");

  assert.deepEqual(l1.detailSections.map((section) => section.key), ["speed", "distance", "timing", "elevation"]);
  assert.deepEqual(l2.detailSections.map((section) => section.key), ["speed", "distance", "timing", "heart-rate", "cadence", "elevation"]);
  assert.deepEqual(l3.detailSections.map((section) => section.key), ["speed", "distance", "timing", "heart-rate", "power", "cadence", "elevation", "other"]);
  assert.ok(!l3.detailSections.flatMap((section) => section.metrics).some((metric) => metric.label === "标准化功率"));
  assert.ok(l2.detailSections.flatMap((section) => section.metrics).some((metric) => metric.value === "84 rpm"));
  assert.ok(l3.detailSections.flatMap((section) => section.metrics).some((metric) => metric.value === "87 rpm"));
  assert.deepEqual(l3.detailSections.flatMap((section) => section.metrics)
    .filter((metric) => ["最高速度", "最高心率", "最大功率", "最大踏频", "运动消耗"].includes(metric.label))
    .map((metric) => metric.label), ["最高速度", "最高心率", "最大功率", "最大踏频", "运动消耗"]);
  assert.equal(l3.factCards.length, 5);
  assert.ok(l3.detailSections.find((section) => section.key === "other")?.metrics.some((metric) => metric.label === "运动消耗"));
  assert.deepEqual(l1.detailSections.find((section) => section.key === "elevation")?.metrics.map((metric) => metric.label), ["累计爬升", "累计下降", "最高海拔", "最低海拔", "海拔范围"]);
});

test("data details preserve evidence and do not invent missing metrics", () => {
  const basic = buildRidePageViewModel("gpx-no-timestamps");
  const allMetrics = basic.detailSections.flatMap((section) => section.metrics);

  assert.deepEqual(basic.detailSections.map((section) => section.key), ["distance"]);
  assert.deepEqual(allMetrics.map((metric) => metric.label), ["距离"]);
  assert.ok(allMetrics.every((metric) => metric.evidenceId));
  assert.ok(!allMetrics.some((metric) => ["骑行时间", "平均速度", "累计爬升"].includes(metric.label)));
  assert.match(basic.dataQuality.note, /不会用 0 代替/);
});

test("built-in samples are labeled as samples instead of device records", () => {
  const l2 = buildRidePageViewModel("l2-built-in-sample");

  assert.equal(l2.dataQuality.sourceLabel, "内置演示样例");
  assert.ok(l2.factCards.some((card) => card.sourceLabel === "内置样例"));
  assert.ok(!l2.factCards.some((card) => card.sourceLabel === "设备记录"));
});

test("data tab visuals follow the actual RideSeries capabilities", () => {
  const l1 = buildRidePageViewModel("l1-built-in-sample");
  const l2 = buildRidePageViewModel("l2-built-in-sample");
  const l3 = buildRidePageViewModel("l3-built-in-sample");
  const powerPreview = buildRidePageViewModel("l3-power-preview");

  assert.ok(l1.visuals.route);
  assert.deepEqual(l1.visuals.charts.map((chart) => chart.key), ["speed", "elevation"]);
  assert.deepEqual(l2.visuals.charts.map((chart) => chart.key), ["speed", "elevation", "heart_rate", "cadence"]);
  assert.deepEqual(l3.visuals.charts.map((chart) => chart.key), ["speed", "elevation", "heart_rate", "power", "cadence"]);
  assert.ok(l3.visuals.charts.every((chart) => chart.path.startsWith("M ")));
  assert.ok(l3.visuals.charts.every((chart) => chart.sampleCount === 13));
  assert.equal(powerPreview.visuals.charts.find((chart) => chart.key === "power")?.sampleCount, 6_301);
  assert.equal(powerPreview.visuals.charts.find((chart) => chart.key === "elevation")?.sampleCount, 6_301);
  assert.ok(powerPreview.visuals.charts.filter((chart) => !["power", "elevation"].includes(chart.key)).every((chart) => chart.sampleCount === 13));
});

test("untimed sparse GPX keeps its route but never invents speed or elevation charts", () => {
  const untimed = buildRidePageViewModel("gpx-no-timestamps");

  assert.ok(untimed.visuals.route);
  assert.deepEqual(untimed.visuals.charts.map((chart) => chart.key), []);
  assert.ok(!untimed.visuals.charts.some((chart) => chart.key === "speed"));
  assert.ok(!untimed.visuals.charts.some((chart) => chart.key === "elevation"));
  assert.ok(!untimed.factCards.some((metric) => metric.label.includes("速度")));
});

test("visual view model exposes only relative drawing data", () => {
  const view = buildRidePageViewModel("l3-built-in-sample");
  const serialized = JSON.stringify(view.visuals);

  assert.doesNotMatch(serialized, /latitude|longitude|fileName|121\.4|31\.2/i);
  assert.match(view.visuals.route?.privacyLabel ?? "", /移除精确坐标/);
  assert.match(view.rideMeta.summaryLabel, /内置演示样例/);
  assert.match(view.rideMeta.dateLabel ?? "", /2026年8月10日/);
  assert.equal(view.rideMeta.titleLabel, "8月10日骑行");
});

test("invalid ride records do not produce route or chart visuals", () => {
  const rejected = buildRidePageViewModel("fit-truncated-file");

  assert.equal(rejected.rejected, true);
  assert.equal(rejected.visuals.route, undefined);
  assert.deepEqual(rejected.visuals.charts, []);
});
