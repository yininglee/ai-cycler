import { createHash } from "node:crypto";
import type { ApplicationRepository } from "../persistence/application-repository.ts";
import { PLATFORMS, type PlatformId } from "../ux/platform-catalog.ts";

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
  const profile = await repository.getProfile(ownerId);
  const connection = config ? await getOneLapPilotConnection(repository, config) : null;
  return PLATFORMS.map(({ id, name }) => {
    if (id === "onelap" && config) {
      const result = connection?.result;
      return { id, name, mode: "live_manual" as const,
        status: connection ? connection.paused ? "expired" as const : "connected" as const : "disconnected" as const,
        ...(result && { lastAttempt: { added: result.added, duplicate: result.duplicate, failed: result.failed, interrupted: !!connection.error } }),
      };
    }
    const simulated = profile?.ux?.platforms?.[id] ?? (id === "garmin" ? profile?.ux?.platform : undefined);
    return { id, name, mode: "simulated" as const, status: simulated?.status ?? "disconnected" as const };
  });
}
