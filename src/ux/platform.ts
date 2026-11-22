import type { PlatformId } from "./platform-catalog.ts";
import { createHash } from "node:crypto";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { createUserProfile } from "../domain/user-profile.ts";
import { getRideFixture } from "../fixtures/rides.ts";

export type PlatformState = {
  status: "connected" | "expired";
  connectedAt: string;
  range: 7 | 30 | 90;
  lastSyncAt?: string;
  failedIds: string[];
  extra?: boolean;
};
export type SyncResult = { added: number; duplicate: number; failed: number; rideIds: string[]; updated?: number; summaryOnly?: number; skippedDeleted?: number };
export type PlatformAction = "connect" | "disconnect" | "sync" | "retry" | "expire" | "add-sample";
export class PlatformError extends Error {}

// Serialize this prototype's platform operations per repository and owner, including retries.
const globalQueues = globalThis as typeof globalThis & { __cyclerPlatformQueues?: Map<string, Promise<unknown>> };
const queues = globalQueues.__cyclerPlatformQueues ??= new Map();
export function updatePlatform(repository: ApplicationRepository, owner: string, action: PlatformAction, range: 7 | 30 | 90 = 30, scenario?: string, provider: PlatformId = "garmin") {
  const key = `${'root' in repository ? repository.root : 'default'}:${owner}`;
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const profile = await repository.getProfile(owner) ?? createUserProfile();
    let platform = profile.ux?.platforms?.[provider] ?? (provider === "garmin" ? profile.ux?.platform : undefined);
    let result: SyncResult | undefined;
    if (action === "disconnect") platform = undefined;
    else if (action === "connect") platform = { status: "connected", connectedAt: platform?.connectedAt ?? new Date().toISOString(), range, failedIds: platform?.failedIds ?? [], lastSyncAt: platform?.lastSyncAt, extra: platform?.extra };
    else {
      if (!platform) throw new PlatformError("请先完成模拟授权。");
      if (action === "expire") platform.status = "expired";
      else if (platform.status === "expired") throw new PlatformError("模拟授权已失效，请重新授权后再同步。");
      else if (action === "add-sample") platform.extra = true;
      else {
        if (scenario === "network") throw new PlatformError("模拟连接中断，本次未同步，请重试。");
        const anchor = Date.parse(platform.connectedAt);
        const catalog = [1, 4, 15, 60, ...(platform.extra ? [0] : [])].filter(days => days <= platform!.range);
        result = { added: 0, duplicate: 0, failed: 0, rideIds: [] };
        const failedIds: string[] = action === "retry" ? [] : [...platform.failedIds];
        for (const days of catalog) {
          const hash = createHash("sha256").update(`platform-demo:${provider === "garmin" ? "" : `${provider}:`}${owner}:${platform.connectedAt}:${days}`).digest("hex");
          const id = `platform-${hash.slice(0, 24)}`;
          if (action === "retry" && !platform.failedIds.includes(id)) continue;
          if (await repository.getRide(owner, id)) { result.duplicate++; result.rideIds.push(id); continue; }
          if (scenario === "partial" && days === 1) { result.failed++; if (!failedIds.includes(id)) failedIds.push(id); continue; }
          const fixture = getRideFixture(days === 4 ? "l1-built-in-sample" : "l3-built-in-sample");
          const record = structuredClone({ activity: fixture.activity, series: fixture.series });
          const date = new Date(anchor - days * 86400000).toISOString();
          record.activity.rideId = id;
          record.activity.startTime = date;
          record.activity.source = { kind: "sample", parserVersion: "platform-demo-v1", platformId: provider };
          record.series.rideId = id;
          record.series.source = { kind: "sample", parserVersion: "platform-demo-v1" };
          record.series.timeBasis = { kind: "elapsed_from_start", startTime: date };
          for (const metric of Object.values(record.activity.metrics)) if (metric) metric.recordedAt = date;
          await repository.saveRide(owner, record, `platform-demo:${hash}`);
          result.added++; result.rideIds.push(id);
        }
        platform.lastSyncAt = new Date().toISOString();
        platform.failedIds = failedIds;
      }
    }
    const platforms = { ...(profile.ux?.platform ? { garmin: profile.ux.platform } : {}), ...profile.ux?.platforms, [provider]: platform };
    profile.ux = { ...profile.ux, platforms, platform: undefined };
    await repository.saveProfile(owner, profile);
    return { platform: platform ?? null, result };
  });
  queues.set(key, task);
  void task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
  return task;
}
