import { createHash, randomUUID } from "node:crypto";
import { importRideBytes } from "../imports/ride-import-service.ts";
import { isRideParseError } from "../parsers/parse-errors.ts";
import type { FileApplicationRepository, OneLapConnection } from "../persistence/application-repository.ts";
import { createOneLapClient, OneLapError } from "./onelap-client.ts";

const MESSAGES = {
  authorization: "顽鹿授权已失效或请求被拒绝。请更新服务端连接凭据后重新连接。",
  rate_limit: "顽鹿限制了请求频率，请稍后重试。",
  protocol: "顽鹿返回的数据无法读取，请稍后重试。",
  upstream: "暂时无法完成顽鹿同步，请稍后重试。",
};

export function readOneLapPilotConfig() {
  const ownerId = process.env.ONELAP_SYNC_OWNER_ID?.trim();
  const accountId = process.env.ONELAP_SYNC_ACCOUNT_ID?.trim();
  const token = process.env.ONELAP_SYNC_TOKEN?.trim();
  const signingKey = process.env.ONELAP_SYNC_SIGNING_KEY?.trim();
  if (process.env.ONELAP_SYNC_ENABLED !== "true" || process.env.AUTH_SESSION_MODE === "oidc" || (process.env.SESSION_SECRET?.length ?? 0) < 32 || !ownerId || !accountId || !token || !signingKey) return null;
  return { ownerId, accountKey: createHash("sha256").update(accountId).digest("hex"), token, signingKey, cookie: process.env.ONELAP_SYNC_COOKIE?.trim() };
}
type Config = NonNullable<ReturnType<typeof readOneLapPilotConfig>>;

export async function getOneLapPilotConnection(repository: FileApplicationRepository, config: Config) {
  const state = await repository.getOneLapConnection(config.ownerId);
  return state?.accountKey === config.accountKey ? state : null;
}

export async function connectOneLapPilot(repository: FileApplicationRepository, config: Config) {
  const existing = await getOneLapPilotConnection(repository, config);
  if (existing && !existing.paused) return existing;
  const connection = { id: randomUUID(), accountKey: config.accountKey, connectedAt: new Date().toISOString(), lastSyncAt: existing?.lastSyncAt };
  await repository.setOneLapConnection(config.ownerId, connection);
  return connection;
}

// Overlapping requests for the same account share one pull.
const runtime = globalThis as typeof globalThis & { __cyclerOneLapRuns?: Map<string, Promise<OneLapConnection | null>> };
const runs = runtime.__cyclerOneLapRuns ??= new Map();

async function runOnce(repository: FileApplicationRepository, config: Config, fetchImpl: typeof fetch) {
  const connection = await getOneLapPilotConnection(repository, config);
  const now = Date.now();
  if (!connection || connection.paused || (connection.retryAt ?? 0) > now) return connection;

  const signal = AbortSignal.timeout(60_000);
  const client = createOneLapClient(config, signal, fetchImpl);
  const result = { added: 0, duplicate: 0, failed: 0, rideIds: [] as string[] };
  const next: OneLapConnection = { ...connection, error: undefined, retryAt: undefined, result };
  try {
    for await (const activity of client.activities()) {
      if (signal.aborted) throw new OneLapError("upstream");
      if ((await repository.getOneLapConnection(config.ownerId))?.id !== connection.id) return null;
      const key = createHash("sha256").update(JSON.stringify([config.ownerId, config.accountKey, activity.id])).digest("hex");
      const existing = await repository.findOneLapActivity(config.ownerId, key);
      if (existing) {
        result.duplicate++;
        continue;
      }
      let bytes: Uint8Array;
      try { bytes = await client.download(activity); }
      catch (error) {
        if (signal.aborted || (error instanceof OneLapError && ["authorization", "rate_limit"].includes(error.code))) throw error;
        result.failed++;
        continue;
      }
      try {
        const imported = await importRideBytes(repository, config.ownerId, "onelap.fit", bytes, { connectionId: connection.id, key });
        if (!imported.result) return null;
        if (imported.result.duplicate) result.duplicate++;
        else if (imported.result.rideId) {
          result.added++;
          result.rideIds.push(imported.result.rideId);
        }
      } catch (error) {
        // A malformed FIT can be skipped; a storage failure stops the round.
        if (!isRideParseError(error)) throw error;
        result.failed++;
      }
    }
    if (result.failed === 0) next.lastSyncAt = new Date().toISOString();
  } catch (error) {
    next.error = MESSAGES[error instanceof OneLapError ? error.code : "upstream"];
    if (error instanceof OneLapError) {
      next.paused = error.code === "authorization";
      next.retryAt = error.retryAt;
    }
  }
  next.lastAttemptAt = new Date().toISOString();
  await repository.setOneLapConnection(config.ownerId, next, connection.id);
  return getOneLapPilotConnection(repository, config);
}

export function syncOneLapPilot(repository: FileApplicationRepository, config: Config, fetchImpl = fetch) {
  const key = JSON.stringify([repository.root, config.ownerId]);
  const existing = runs.get(key);
  if (existing) return existing;
  const task = runOnce(repository, config, fetchImpl).finally(() => { runs.delete(key); });
  runs.set(key, task);
  return task;
}
