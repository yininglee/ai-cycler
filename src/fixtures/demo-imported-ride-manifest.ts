/**
 * DEMO-IMPORTED-RIDES：Demo 演示用「已导入骑行记录」清单（客户端安全）。
 *
 * 这两条记录由真实 FIT 文件解析而来，随仓库分发（test-data/demo-imported-rides/），
 * 对任何访客都可见，不需要登录、不写入任何用户数据、不占用存储。
 * 它们只读：不可删除，也不属于任何会话。
 *
 * 本模块只放轻量元数据（id / 文案），可被客户端组件安全引用；
 * 真正的轨迹数据由服务端模块 demo-imported-rides.ts 异步加载，避免大数据进客户端 bundle。
 */

export const DEMO_IMPORTED_RIDES = [
  {
    rideId: "demo-ride-2026-07-22",
    fileName: "demo-ride-2026-07-22.fit",
    originalFileName: "1be0d1c0-63ef-476b-9103-61c1c04efba4.fit",
    capability: "长距离",
    title: "长途拉练 · 含功率",
    note: "161.8 km · 累计爬升 2924 m",
  },
  {
    rideId: "demo-ride-2026-08-20",
    fileName: "demo-ride-2026-08-20.fit",
    originalFileName: "sportRecord_20260820062626.fit",
    capability: "心率",
    title: "通勤 · 含心率",
    note: "31.1 km · 平均心率 165 bpm",
  },
] as const;

export type DemoImportedRideMeta = typeof DEMO_IMPORTED_RIDES[number];
export type DemoImportedRideId = DemoImportedRideMeta["rideId"];

const DEMO_IMPORTED_RIDE_ID_SET: ReadonlySet<string> = new Set(DEMO_IMPORTED_RIDES.map((item) => item.rideId));

/** 演示记录 id 判定。与内置样例（DEMO_RIDE_IDS）区分：这些记录「像导入的」，不是 fixture。 */
export function isDemoImportedRideId(value: string): value is DemoImportedRideId {
  return DEMO_IMPORTED_RIDE_ID_SET.has(value);
}

export function demoImportedRideMeta(rideId: string): DemoImportedRideMeta | undefined {
  return DEMO_IMPORTED_RIDES.find((item) => item.rideId === rideId);
}
