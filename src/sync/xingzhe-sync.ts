import { createHash, randomBytes, randomUUID } from "node:crypto";
import { findSessionAccount } from "../auth/account-store.ts";
import { RIDE_SCHEMA_VERSION, RIDE_SERIES_SCHEMA_VERSION, type Metric, type RideRecord } from "../domain/ride-schema.ts";
import { validateRideRecord } from "../domain/ride-series.ts";
import { createImportedRideId } from "../imports/demo-ride-store.ts";
import { importRideBytes } from "../imports/ride-import-service.ts";
import { isRideParseError } from "../parsers/index.ts";
import type { FileApplicationRepository, XingzheConnection } from "../persistence/application-repository.ts";
import type { SyncResult } from "../ux/platform.ts";
import {
  createXingzheClient, openXingzheCredentials, sealXingzheCredentials, xingzheAuthorizationUrl,
  XingzheError, type XingzheActivity, type XingzheConfig,
} from "./xingzhe-client.ts";
import { createManualSyncState, ManualSyncRuns, manualSyncKey } from "./manual-sync-runs.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const authorizationHash = (state: string, sessionToken: string) => hash(JSON.stringify([state, sessionToken]));
const messages = {
  authorization: "行者授权已失效，请重新连接。",
  rate_limit: "行者限制了请求频率，请稍后重试。",
  protocol: "行者返回的数据无法读取，请稍后重试。",
  upstream: "暂时无法完成行者同步，请稍后重试。",
};

type AuthorizationStage = "token" | "profile" | "save";

function authorizationFailure(stage: AuthorizationStage, error: unknown) {
  const upstream = error instanceof XingzheError ? error : undefined;
  console.warn(`[xingzhe-oauth] ${JSON.stringify({
    stage, kind: upstream?.code ?? "local", upstreamStatus: upstream?.upstreamStatus, rejection: upstream?.tokenRejection,
    responseIssue: upstream?.responseIssue, upstreamCode: upstream?.upstreamCode, profileFields: upstream?.profileFields,
  })}`);
  if (upstream?.code === "rate_limit") return "rate_limited";
  if (stage === "token") return upstream?.tokenRejection ?? (upstream?.code === "authorization" ? "token_rejected" : "token_failed");
  if (stage === "profile") return upstream?.code === "authorization" ? "profile_rejected" : "profile_failed";
  return "save_failed";
}

export async function startXingzheAuthorization(repository: FileApplicationRepository, ownerId: string, config: XingzheConfig,
  sessionToken: string, returnQuery?: string) {
  const state = randomBytes(32).toString("base64url");
  await repository.beginXingzheAuthorization(ownerId, authorizationHash(state, sessionToken), Date.now() + 10 * 60_000, returnQuery);
  return xingzheAuthorizationUrl(config, state);
}

export async function completeXingzheAuthorization(repository: FileApplicationRepository, ownerId: string, config: XingzheConfig,
  sessionToken: string, state: string, code: string | null, isDenied: boolean, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return { status: "invalid" };
  const stateHash = authorizationHash(state, sessionToken);
  const pending = await repository.claimXingzheAuthorization(ownerId, stateHash);
  if (!pending) return { status: "invalid" };
  const outcome = (status: string) => ({ status, returnQuery: pending.returnQuery });
  let saved = false;
  let stage: AuthorizationStage = "token";
  try {
    if (isDenied || !code || code.length > 2048) return outcome(isDenied ? "denied" : "invalid");
    const client = createXingzheClient(config, fetchImpl);
    const tokens = await client.exchange(code);
    stage = "profile";
    const accountKey = hash(await client.accountId(tokens.accessToken));
    stage = "save";
    if (findSessionAccount(sessionToken)?.id !== ownerId) return outcome("invalid");
    const id = randomUUID();
    const connection = {
      id, accountKey, connectedAt: new Date().toISOString(),
      credentials: sealXingzheCredentials(config, ownerId, id, tokens),
    };
    saved = await repository.finishXingzheAuthorization(ownerId, stateHash, connection);
    return outcome(saved ? "connected" : "invalid");
  } catch (error) {
    return outcome(authorizationFailure(stage, error));
  } finally {
    if (!saved) await repository.finishXingzheAuthorization(ownerId, stateHash);
  }
}

function toRideRecord(activity: XingzheActivity): RideRecord {
  const rideId = createImportedRideId();
  const startTime = new Date(activity.start_time).toISOString();
  const source = { kind: "platform_summary", parserVersion: "xingzhe-openapi-v1" } as const;
  const metric = (name: string, value: number, unit: "m" | "s", isCalculated = false): Metric => ({
    value, unit, evidenceId: `xingzhe:${rideId}:${name}`, sourceField: name, sourceUnit: isCalculated ? "ms" : unit,
    provenance: isCalculated ? "calculated" : "recorded", confidence: "high", qualityStatus: "valid",
    recordedAt: startTime, ...(isCalculated ? { formulaVersion: "platform-elapsed-v1" } : {}),
  });
  return {
    activity: {
      schemaVersion: RIDE_SCHEMA_VERSION, rideId, startTime, sport: "cycling",
      source: { ...source, platformId: "xingzhe" },
      metrics: {
        distanceM: metric("distance", activity.distance, "m"),
        elapsedTimeS: metric("end_time - start_time", (activity.end_time - activity.start_time) / 1000, "s", true),
      },
      sensorQuality: {},
      sourceIssues: [{ code: "PLATFORM_SUMMARY_ONLY", severity: "warning", message: "行者摘要未提供轨迹或传感器采样。" }],
    },
    series: {
      schemaVersion: RIDE_SERIES_SCHEMA_VERSION, rideId, source, coordinateSpace: "relative_normalized",
      privacy: { ruleVersion: "relative-route-v0.1", preciseCoordinatesExcluded: true },
      availableSeries: [], seriesMetadata: {}, timeBasis: { kind: "none" }, points: [],
    },
  };
}

async function runOnce(repository: FileApplicationRepository, ownerId: string, config: XingzheConfig, cancellation: AbortSignal, fetchImpl: typeof fetch, reimportDeleted: boolean) {
  const connection = await repository.getXingzheConnection(ownerId);
  if (!connection || connection.paused || (connection.retryAt ?? 0) > Date.now()) return connection;
  const client = createXingzheClient(config, fetchImpl, cancellation);
  const result: SyncResult & { skippedDeleted: number } = { added: 0, duplicate: 0, failed: 0, skippedDeleted: 0, rideIds: [] };
  const next: XingzheConnection = { ...connection, error: undefined, retryAt: undefined, result };
  const seen = new Set<number>();
  const current = async () => (await repository.getXingzheConnection(ownerId))?.id === connection.id;
  async function tryFit(activityId: number, accessToken: string, key: string) {
    let bytes: Uint8Array | null;
    try {
      bytes = await client.downloadFit(activityId, accessToken);
    } catch (error) {
      if (cancellation.aborted || (error instanceof XingzheError && error.code === "rate_limit")) throw error;
      return undefined;
    }
    cancellation.throwIfAborted();
    if (!bytes) return undefined;
    try {
      const { result: imported } = await importRideBytes(repository, ownerId, "xingzhe.fit", bytes, {
        platformId: "xingzhe", source: { provider: "xingzhe", connectionId: next.id, key, replaceSummary: true, reimportDeleted },
      });
      return imported;
    } catch (error) {
      if (!isRideParseError(error)) throw error;
      return undefined;
    }
  }
  // After a rejected access token, restart the scan once using the refreshed token.
  // Keep successful and failed activity IDs across both passes.
  async function scan(accessToken: string) {
    for await (const activity of client.activities(accessToken)) {
      if (!await current()) return false;
      if (!activity) {
        if (!reimportDeleted) result.failed++;
        continue;
      }
      if (seen.has(activity.id)) continue;
      seen.add(activity.id);
      const key = hash(JSON.stringify([ownerId, next.accountKey, activity.id]));
      const known = await repository.findXingzheActivity(ownerId, key);
      if (reimportDeleted && known !== "deleted") continue;
      if (!reimportDeleted && known === "deleted") { result.skippedDeleted++; continue; }
      if (known === "imported") { result.duplicate++; continue; }
      const record = toRideRecord(activity);
      if (!validateRideRecord(record).valid) { result.failed++; continue; }
      const fit = await tryFit(activity.id, accessToken, key);
      const imported = fit === undefined ? await repository.importRide(ownerId, `xingzhe:${key}`, async () => record, {
        provider: "xingzhe", connectionId: next.id, key, reimportDeleted,
      }) : fit;
      if (!imported) return false;
      if (imported.rideId === null) {
        if (!reimportDeleted) result.skippedDeleted++;
        continue;
      }
      if (fit === undefined || (known === "summary" && imported.duplicate)) {
        result.summaryOnly = (result.summaryOnly ?? 0) + 1;
      }
      if (imported.duplicate) result.duplicate++;
      else {
        if (imported.updated) result.updated = (result.updated ?? 0) + 1;
        else result.added++;
        result.rideIds.push(imported.rideId);
      }
    }
    return true;
  }

  try {
    const tokens = openXingzheCredentials(config, ownerId, connection.id, connection.credentials);
    const refresh = async () => {
      if (!tokens.refreshToken) throw new XingzheError("authorization");
      const refreshed = await client.refresh(tokens.refreshToken);
      next.credentials = sealXingzheCredentials(config, ownerId, next.id, refreshed);
      // Persist rotated tokens before making additional requests.
      await repository.updateXingzheConnection(ownerId, { ...connection, credentials: next.credentials });
      return refreshed.accessToken;
    };
    const expired = tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now() + 15_000;
    let completed: boolean;
    try {
      const accessToken = expired ? await refresh() : tokens.accessToken;
      if (!await current()) return null;
      completed = await scan(accessToken);
    } catch (error) {
      if (expired || !(error instanceof XingzheError) || error.code !== "authorization") throw error;
      if (!await current()) return null;
      const accessToken = await refresh();
      if (!await current()) return null;
      completed = await scan(accessToken);
    }
    if (!completed) return null;
    if (!result.failed) next.lastSyncAt = new Date().toISOString();
  } catch (error) {
    if (cancellation.aborted) return null;
    next.error = messages[error instanceof XingzheError ? error.code : "upstream"];
    if (error instanceof XingzheError) {
      next.paused = error.code === "authorization";
      next.retryAt = error.retryAt;
    }
  }
  next.lastAttemptAt = new Date().toISOString();
  await repository.updateXingzheConnection(ownerId, next);
  const latest = await repository.getXingzheConnection(ownerId);
  return latest?.id === connection.id ? latest : null;
}

const runtime = globalThis as typeof globalThis & { cyclerXingzheSyncState?: ReturnType<typeof createManualSyncState<XingzheConnection>> };
const runs = new ManualSyncRuns(runtime.cyclerXingzheSyncState ??= createManualSyncState<XingzheConnection>());

export function syncXingzhe(repository: FileApplicationRepository, ownerId: string, config: XingzheConfig, fetchImpl = fetch,
  operation: "sync" | "reimport-deleted" = "sync") {
  return runs.start(manualSyncKey(repository.root, ownerId),
    signal => runOnce(repository, ownerId, config, signal, fetchImpl, operation === "reimport-deleted"), operation);
}

export function disconnectXingzhe(repository: FileApplicationRepository, ownerId: string) {
  return runs.disconnect(manualSyncKey(repository.root, ownerId), () => repository.disconnectXingzhe(ownerId));
}
