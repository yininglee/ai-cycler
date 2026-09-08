import { deriveRouteMatchKey } from "../domain/route-match-key.ts";
import type { HistoricalRide } from "../domain/historical-comparison.ts";
import type { RideRecord } from "../domain/ride-schema.ts";

/**
 * MVP-REPEAT-01 持久历史适配：把 Repository 中的标准化记录转换为
 * 历史比较领域的 HistoricalRide。调用方负责按 owner 过滤（listRides
 * 已隔离），本模块只做元数据派生：
 * - historyId = rideId；
 * - routeKey 来自 route-match-key-v0.1；
 * - deviceKey 来自设备厂商:型号（缺失时省略，指标口径约束由领域层保守降级）；
 * - sceneKey 由运动类型推导室内/室外——这是数据可支撑的唯一场景信号，
 *   运动本身已由领域层单独校验，因此场景门等价于"同运动即同场景"。
 */

export function buildHistoricalRide(record: RideRecord): HistoricalRide {
  const source = record.activity.source;
  const deviceKey = source.deviceManufacturer && source.deviceProduct
    ? `${source.deviceManufacturer}:${source.deviceProduct}`
    : undefined;
  const routeKey = deriveRouteMatchKey(record);
  const sceneKey = record.activity.sport === "indoor_cycling" ? "indoor" : "outdoor";
  return {
    metadata: {
      historyId: record.activity.rideId,
      ...(routeKey !== undefined ? { routeKey } : {}),
      ...(deviceKey !== undefined ? { deviceKey } : {}),
      sceneKey,
    },
    record,
  };
}

export function buildHistoricalRides(records: RideRecord[]): HistoricalRide[] {
  return records.map(buildHistoricalRide);
}
