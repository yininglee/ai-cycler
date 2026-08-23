import assert from "node:assert/strict";
import test from "node:test";

import { buildRidePageViewModel, DEMO_RIDE_IDS, isDemoRideId, RIDE_DETAIL_UI_VERSION } from "../src/ui/ride-view-model.ts";

test("all visual-shell demo routes resolve to valid B0 view models", () => {
  for (const id of DEMO_RIDE_IDS) {
    const view = buildRidePageViewModel(id);
    assert.equal(view.id, id);
    assert.equal(view.uiVersion, RIDE_DETAIL_UI_VERSION);
    assert.ok(view.analysis.output.headline);
    assert.ok(view.factCards.length <= 5);
  }
});

test("visual route guard rejects unknown fixture ids", () => {
  assert.equal(isDemoRideId("l2-built-in-sample"), true);
  assert.equal(isDemoRideId("other-user-private"), false);
});

test("fact cards keep evidence labels and capability boundaries", () => {
  const l1 = buildRidePageViewModel("l1-built-in-sample");
  const l2 = buildRidePageViewModel("l2-built-in-sample");
  const l3 = buildRidePageViewModel("l3-built-in-sample");

  assert.ok(l1.factCards.every((card) => card.evidenceId));
  assert.ok(!l1.factCards.some((card) => card.label.includes("心率") || card.label.includes("功率")));
  assert.ok(l2.analysis.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgHeartRateBpm"));
  assert.ok(l3.analysis.snapshot.allowedClaims.some((claim) => claim.metricKey === "avgPowerW"));
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

test("detail sections expand only within the available data capability", () => {
  const l1 = buildRidePageViewModel("l1-built-in-sample");
  const l2 = buildRidePageViewModel("l2-built-in-sample");
  const l3 = buildRidePageViewModel("l3-built-in-sample");

  assert.deepEqual(l1.detailSections.map((section) => section.key), ["speed", "distance", "timing", "elevation"]);
  assert.deepEqual(l2.detailSections.map((section) => section.key), ["speed", "distance", "timing", "heart-rate", "cadence", "elevation"]);
  assert.deepEqual(l3.detailSections.map((section) => section.key), ["speed", "distance", "timing", "heart-rate", "power", "training-load", "cadence", "elevation", "other"]);
  assert.ok(l2.detailSections.flatMap((section) => section.metrics).every((metric) => !metric.label.includes("功率")));
  assert.ok(l3.detailSections.flatMap((section) => section.metrics).some((metric) => metric.label === "标准化功率"));
  assert.ok(l2.detailSections.flatMap((section) => section.metrics).some((metric) => metric.value === "84 rpm"));
  assert.ok(l3.detailSections.flatMap((section) => section.metrics).some((metric) => metric.value === "87 rpm"));
  assert.deepEqual(l3.detailSections.flatMap((section) => section.metrics)
    .filter((metric) => ["最高速度", "最高心率", "最大功率", "最大踏频", "运动消耗"].includes(metric.label))
    .map((metric) => metric.label), ["最高速度", "最高心率", "最大功率", "最大踏频", "运动消耗"]);
  assert.equal(l3.factCards.length, 5);
  assert.ok(!l3.analysis.snapshot.allowedClaims.some((claim) => claim.metricKey === "activityEnergyKcal"));
});

test("data details preserve evidence and do not invent missing metrics", () => {
  const basic = buildRidePageViewModel("gpx-no-timestamps");
  const allMetrics = basic.detailSections.flatMap((section) => section.metrics);

  assert.deepEqual(basic.detailSections.map((section) => section.key), ["distance", "elevation"]);
  assert.deepEqual(allMetrics.map((metric) => metric.label), ["距离", "累计爬升"]);
  assert.ok(allMetrics.every((metric) => metric.evidenceId));
  assert.ok(!allMetrics.some((metric) => metric.label === "骑行时间" || metric.label === "平均速度"));
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

  assert.ok(l1.visuals.route);
  assert.deepEqual(l1.visuals.charts.map((chart) => chart.key), ["speed", "elevation"]);
  assert.deepEqual(l2.visuals.charts.map((chart) => chart.key), ["speed", "elevation", "heart_rate", "cadence"]);
  assert.deepEqual(l3.visuals.charts.map((chart) => chart.key), ["speed", "elevation", "heart_rate", "power", "cadence"]);
  assert.ok(l3.visuals.charts.every((chart) => chart.path.startsWith("M ") && chart.sampleCount === 13));
});

test("untimed GPX keeps route and elevation but never creates a speed chart", () => {
  const untimed = buildRidePageViewModel("gpx-no-timestamps");

  assert.ok(untimed.visuals.route);
  assert.deepEqual(untimed.visuals.charts.map((chart) => chart.key), ["elevation"]);
  assert.equal(untimed.visuals.charts[0]?.axisLabel, "骑行距离");
  assert.ok(!untimed.visuals.charts.some((chart) => chart.key === "speed"));
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

  assert.equal(rejected.analysis.snapshot.analysisMode, "rejected");
  assert.equal(rejected.visuals.route, undefined);
  assert.deepEqual(rejected.visuals.charts, []);
});
