/**
 * DEMO-IMPORTED-RIDES：演示「已导入」记录的契约测试。
 *
 * 注意本文件**不**引入 tests/helpers/route-test-env.ts —— 那里会把
 * DEMO_IMPORTED_RIDES_ENABLED 置为 false，用于让路由契约测试跑在「无演示记录」基线上。
 * 这里要验证的正是演示记录启用时的行为。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getDemoImportedRide, loadDemoImportedRides } from "../src/fixtures/demo-imported-rides.ts";
import { DEMO_IMPORTED_RIDES, isDemoImportedRideId } from "../src/fixtures/demo-imported-ride-manifest.ts";
import { withDemoImportedRides } from "../src/persistence/demo-ride-repository.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";
import { validateRideActivity } from "../src/domain/ride-rules.ts";
import { validateRideSeries } from "../src/domain/ride-series.ts";
import { isDemoRideId } from "../src/ui/ride-view-model.ts";

test("清单里的每条演示记录都能从 FIT 解析出通过校验的记录", async () => {
  const rides = await loadDemoImportedRides();
  assert.equal(rides.length, DEMO_IMPORTED_RIDES.length);

  for (const ride of rides) {
    const { activity, series } = ride.record;
    assert.equal(activity.rideId, ride.rideId, "解析结果必须使用清单里的 rideId");
    assert.equal(activity.sport, "cycling");
    assert.ok(activity.startTime, `${ride.rideId} 缺少 startTime`);
    assert.equal(Number.isNaN(Date.parse(activity.startTime!)), false, `${ride.rideId} startTime 无法解析`);
    assert.equal(activity.source.kind, "fit", "演示记录必须走真实 FIT 导入链路");
    assert.equal(validateRideActivity(activity).valid, true, `${ride.rideId} 未通过记录校验`);
    assert.equal(validateRideSeries(series, activity).valid, true, `${ride.rideId} 未通过轨迹校验`);
    assert.ok(series.points.length > 0, `${ride.rideId} 轨迹点为空`);
    assert.equal(Number.isFinite(activity.metrics.distanceM?.value), true, `${ride.rideId} 缺少距离`);
    // 演示记录必须能与内置样例区分开：它们是「像导入的」，不是 fixture。
    assert.equal(isDemoRideId(ride.rideId), false, `${ride.rideId} 不应被当作内置样例`);
    assert.equal(isDemoImportedRideId(ride.rideId), true);
  }
});

test("演示记录覆盖功率与心率两类形态，并按骑行时间倒序排列", async () => {
  const rides = await loadDemoImportedRides();
  const withPower = rides.filter((ride) => Number.isFinite(ride.record.activity.metrics.avgPowerW?.value));
  const withHeartRate = rides.filter((ride) => Number.isFinite(ride.record.activity.metrics.avgHeartRateBpm?.value));
  // 2026-10-08 用户决策：固定四条演示记录（10/5 心率 / 8/20 通勤心率 /
  // 7/22 长途功率 / 7/18 起伏功率），列表按骑行时间倒序、10/5 排最前。
  assert.equal(rides.length, 4, "演示记录应正好四条");
  assert.ok(withPower.length >= 1, "至少需要一条带功率的记录");
  assert.ok(withHeartRate.length >= 1, "至少需要一条带心率的记录");
  const stamps = rides.map((ride) => ride.storedAt);
  assert.deepEqual(
    stamps,
    [...stamps].sort((left, right) => right.localeCompare(left)),
    "清单必须按骑行开始时间倒序（10/5 最前）",
  );
  assert.equal(rides[0]!.rideId, "demo-ride-2026-10-05", "10/5 骑行必须排最前");
});

test("loadDemoImportedRides 进程内只解析一次（返回同一份缓存）", async () => {
  const first = await loadDemoImportedRides();
  const second = await loadDemoImportedRides();
  assert.equal(first, second);
});

test("getDemoImportedRide 只认清单内的 id", async () => {
  const known = await getDemoImportedRide(DEMO_IMPORTED_RIDES[0].rideId);
  assert.ok(known);
  assert.equal(await getDemoImportedRide("l1-built-in-sample"), undefined, "内置样例不是演示导入记录");
  assert.equal(await getDemoImportedRide("upload-not-a-ride"), undefined);
});

test("仓储装饰器把演示记录合并进 listRides，并按 storedAt 倒序", async () => {
  const base = {
    async getProfile() { return null; },
    async listRides() {
      return [{ record: { activity: { rideId: "upload-owned" } }, storedAt: "2026-09-01T00:00:00.000Z" }] as never;
    },
    async getRide() {
      return null;
    },
  } as unknown as ApplicationRepository;

  const merged = await withDemoImportedRides(base).listRides("local-user-x");
  assert.equal(merged.length, DEMO_IMPORTED_RIDES.length + 1);
  assert.ok(merged.some((entry) => entry.record.activity.rideId === "upload-owned"), "用户自己的记录必须保留");
  const stamps = merged.map((entry) => entry.storedAt);
  assert.deepEqual(stamps, [...stamps].sort((left, right) => right.localeCompare(left)), "必须按 storedAt 倒序");
});

test("仓储装饰器让任意会话都能读到演示记录，但写操作不落到演示数据上", async () => {
  let deleted = 0;
  const base = {
    async getRide() {
      return null;
    },
    async deleteRide() {
      deleted += 1;
      return false;
    },
  } as unknown as ApplicationRepository;

  const repository = withDemoImportedRides(base);
  for (const meta of DEMO_IMPORTED_RIDES) {
    const record = await repository.getRide("some-other-user", meta.rideId);
    assert.ok(record, `${meta.rideId} 应对任意会话可见`);
    assert.equal(record.activity.rideId, meta.rideId);
  }
  // 只读：删除演示记录不会成功，也不会产生副作用。
  assert.equal(await repository.deleteRide("some-other-user", DEMO_IMPORTED_RIDES[0].rideId), false);
  assert.equal(deleted, 1);
  assert.equal(await repository.getRide("some-other-user", "upload-not-a-ride"), null);
});
