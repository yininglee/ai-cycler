/**
 * DEMO-IMPORTED-RIDES：把全局演示「已导入」记录合并进仓储读取路径。
 *
 * 采用装饰器而不是改造 FileApplicationRepository，原因：
 * 1) 演示记录不属于任何会话，也不应该被写进 .local-data —— 写入型方法一律不拦截；
 * 2) 只需要在读取处生效（listRides / getRide），就能让列表、详情、AI 解读、
 *    聊天聚合与锚点确认同时看到这四条记录，无需改动各自的业务逻辑；
 * 3) 删除路径自然返回 404（记录不在仓储里），配合 UI 隐藏删除按钮即达成只读。
 */

import type { ApplicationRepository } from "./application-repository.ts";
import { getApplicationRepository } from "./application-repository.ts";
import { isDemoImportedRideId } from "../fixtures/demo-imported-ride-manifest.ts";
import { listDemoImportedRideEntries, loadDemoImportedRides } from "../fixtures/demo-imported-rides.ts";

/** 给仓储加上演示记录的只读视图（写操作原样透传，不产生任何持久化副作用）。 */
export function withDemoImportedRides(base: ApplicationRepository): ApplicationRepository {
  return new Proxy(base, {
    get(target, property) {
      if (property === "listRides") {
        return async (ownerId: string) => {
          const profile = await target.getProfile(ownerId);
          const [owned, demo] = await Promise.all([
            target.listRides(ownerId),
            listDemoImportedRideEntries(),
          ]);
          // 演示记录 id 形如 demo-ride-*，用户导入记录形如 upload-*，两类不会同名，
          // 因此直接合并后按 storedAt 倒序即可（演示记录用骑行开始时间做排序键）。
          if (profile?.ux?.mode === "blank") return owned.filter((entry) => entry.storedAt >= (profile.ux?.blankSince ?? ""));
          return [...owned, ...demo].sort((left, right) => right.storedAt.localeCompare(left.storedAt));
        };
      }
      if (property === "getRide") {
        return async (ownerId: string, rideId: string) => {
          if (isDemoImportedRideId(rideId)) {
            const demo = (await loadDemoImportedRides()).find((item) => item.rideId === rideId);
            if (demo) return structuredClone(demo.record);
          }
          return target.getRide(ownerId, rideId);
        };
      }
      // 以 target 作为 receiver（而非 proxy）：避免基类里可能存在的 getter 因 this
      // 指向 proxy 而再次进入拦截逻辑。方法统一绑定到 target，保持 this 正确。
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** 读取路径统一入口：返回带演示记录的仓储视图。写操作仍落在真实仓储上。 */
export async function getRideRepository(): Promise<ApplicationRepository> {
  await loadDemoImportedRides();
  return withDemoImportedRides(getApplicationRepository());
}
