import { createHash } from "node:crypto";
import type { ApplicationRepository, OneLapConnection } from "../persistence/application-repository.ts";
import { isImportPlatform, PLATFORMS, type PlatformId } from "../ux/platform-catalog.ts";
import { readXingzheConfig } from "./xingzhe-client.ts";

export function readOneLapPilotConfig() {
  const ownerId = process.env.ONELAP_SYNC_OWNER_ID?.trim();
  const accountId = process.env.ONELAP_SYNC_ACCOUNT_ID?.trim();
  const token = process.env.ONELAP_SYNC_TOKEN?.trim();
  const signingKey = process.env.ONELAP_SYNC_SIGNING_KEY?.trim();
  if (process.env.ONELAP_SYNC_ENABLED !== "true" || process.env.AUTH_SESSION_MODE === "oidc" || (process.env.SESSION_SECRET?.length ?? 0) < 32 || !ownerId || !accountId || !token || !signingKey) return null;
  return { ownerId, accountKey: createHash("sha256").update(accountId).digest("hex"), token, signingKey, cookie: process.env.ONELAP_SYNC_COOKIE?.trim() };
}
export type OneLapPilotConfig = NonNullable<ReturnType<typeof readOneLapPilotConfig>>;

export async function getOneLapPilotConnection(repository: Pick<ApplicationRepository, "getOneLapConnection">, config: OneLapPilotConfig) {
  const state = await repository.getOneLapConnection(config.ownerId);
  return state?.accountKey === config.accountKey ? state : null;
}

export function oneLapPilotFor(ownerId: string | null, platform: PlatformId) {
  if (!ownerId || platform !== "onelap") return null;
  const config = readOneLapPilotConfig();
  return config?.ownerId === ownerId ? config : null;
}

/** Project only connection status and import counts. Record IDs and credentials stay server-side. */
export async function readImportPlatforms(repository: ApplicationRepository, ownerId: string) {
  const config = oneLapPilotFor(ownerId, "onelap");
  const registered = ownerId.startsWith("account-");
  const xingzheConfigured = Boolean(readXingzheConfig());
  const xingzhe = registered && xingzheConfigured;
  const [profile, onelapConnection, xingzheConnection] = await Promise.all([
    repository.getProfile(ownerId),
    config ? getOneLapPilotConnection(repository, config) : null,
    xingzhe ? repository.getXingzheConnection?.(ownerId) : null,
  ]);
  function live(id: PlatformId, name: string, connection?: OneLapConnection | null) {
    const result = connection?.result;
    return { id, name, mode: "live_manual" as const,
      status: connection ? connection.paused ? "expired" as const : "connected" as const : "disconnected" as const,
      ...(result && { lastAttempt: { added: result.added, duplicate: result.duplicate, failed: result.failed, interrupted: !!connection.error } }),
    };
  }
  return PLATFORMS.filter(({ id }) => !registered || isImportPlatform(id)).map(({ id, name }) => {
    if (id === "onelap" && config) {
      return live(id, name, onelapConnection);
    }
    if (id === "xingzhe" && xingzhe) return live(id, name, xingzheConnection);
    if (registered || (id === "xingzhe" && xingzheConfigured)) return { id, name, mode: "file_only" as const, status: "disconnected" as const };
    const simulated = profile?.ux?.platforms?.[id] ?? (id === "garmin" ? profile?.ux?.platform : undefined);
    return { id, name, mode: "simulated" as const, status: simulated?.status ?? "disconnected" as const };
  });
}
