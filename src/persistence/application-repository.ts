import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RideRecord } from "../domain/ride-schema.ts";
import type { SyncResult } from "../ux/platform.ts";
import type { UserProfile } from "../domain/user-profile.ts";
import type { DemoEvent } from "../observability/demo-events.ts";

export interface AnalysisRunRecord { rideId: string; result: unknown; storedAt: string }
export interface ConsentRecord { policyVersion: string; acceptedAt: string }
export type OneLapConnection = {
  id: string;
  accountKey: string;
  connectedAt: string;
  lastAttemptAt?: string;
  lastSyncAt?: string;
  paused?: boolean;
  retryAt?: number;
  error?: string;
  result?: SyncResult;
};
export type XingzheConnection = OneLapConnection & { credentials: string };
export type RideImportSource = { connectionId: string; key: string } & (
  { provider?: "onelap" } | { provider: "xingzhe"; replaceSummary?: true; reimportDeleted?: boolean }
);
type SourceActivity = { ownerId: string; rideId: string | null };
type XingzheAuthorization = { stateHash: string; expiresAt: number; returnQuery?: string; claimed?: boolean };
type ImportResult = { rideId: string | null; duplicate: boolean; updated?: true };
export interface ApplicationRepository {
  getOneLapConnection(ownerId: string): Promise<OneLapConnection | null>;
  getXingzheConnection?(ownerId: string): Promise<XingzheConnection | null>;
  saveRide(ownerId: string, record: RideRecord, contentHash?: string): Promise<void>;
  /** 幂等导入去重：按 (ownerId, 内容哈希) 查找已导入记录；哈希随记录删除/账户删除一并移除。 */
  findRideIdByContentHash(ownerId: string, contentHash: string): Promise<string | null>;
  getRide(ownerId: string, rideId: string): Promise<RideRecord | null>;
  listRides(ownerId: string): Promise<Array<{ record: RideRecord; storedAt: string }>>;
  deleteRide(ownerId: string, rideId: string): Promise<boolean>;
  getProfile(ownerId: string): Promise<UserProfile | null>;
  saveProfile(ownerId: string, profile: UserProfile): Promise<void>;
  saveAnalysisRun(ownerId: string, rideId: string, result: unknown): Promise<void>;
  getAnalysisRun(ownerId: string, rideId: string): Promise<AnalysisRunRecord | null>;
  getConsent(ownerId: string): Promise<ConsentRecord | null>;
  saveConsent(ownerId: string, consent: ConsentRecord): Promise<void>;
  saveDemoEvent(ownerId: string, event: DemoEvent): Promise<void>;
  listDemoEvents(ownerId: string): Promise<DemoEvent[]>;
  deleteAccount(ownerId: string): Promise<void>;
}

type State = {
  rides: Record<string, { ownerId: string; record: RideRecord; storedAt: string; contentHash?: string }>;
  profiles: Record<string, UserProfile>;
  analysisRuns: Record<string, { ownerId: string; run: AnalysisRunRecord }>;
  consents: Record<string, ConsentRecord>;
  demoEvents: Record<string, { ownerId: string; event: DemoEvent }>;
  oneLapConnections: Record<string, OneLapConnection>;
  oneLapActivities: Record<string, SourceActivity>;
  xingzheConnections: Record<string, XingzheConnection>;
  xingzheActivities: Record<string, SourceActivity>;
  xingzheAuthorizations: Record<string, XingzheAuthorization>;
};

type RepositoryRuntime = {
  state: State | null;
  stateFileMtimeMs: number | null;
  queue: Promise<void>;
};

// Next.js route bundles share cache and write ordering. Each bundle creates
// its own repository handle so a hot reload picks up the current methods.
const globalState = globalThis as typeof globalThis & { cyclerRepositoryRuntimes?: Map<string, RepositoryRuntime> };
const runtimes = globalState.cyclerRepositoryRuntimes ??= new Map<string, RepositoryRuntime>();
const defaultRoot = () => process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".local-data");

function emptyState(): State {
  return {
    rides: {}, profiles: {}, analysisRuns: {}, consents: {}, demoEvents: {},
    oneLapConnections: {}, oneLapActivities: {},
    xingzheConnections: {}, xingzheActivities: {}, xingzheAuthorizations: {},
  };
}

function analysisKey(ownerId: string, rideId: string) { return JSON.stringify([ownerId, rideId]); }

function sanitized(record: RideRecord): RideRecord {
  const next = structuredClone(record);
  delete next.activity.source.fileName;
  return next;
}

export class FileApplicationRepository implements ApplicationRepository {
  private readonly runtime: RepositoryRuntime;
  readonly filePath: string;
  readonly root: string;
  constructor(root: string = defaultRoot()) {
    this.root = root;
    this.filePath = path.join(root, "application-state.json");
    const key = path.resolve(this.filePath);
    this.runtime = runtimes.get(key) ?? { state: null, stateFileMtimeMs: null, queue: Promise.resolve() };
    runtimes.set(key, this.runtime);
  }

  private async fileMtimeMs(): Promise<number | null> {
    try { return (await stat(this.filePath)).mtimeMs; } catch { return null; }
  }

  private async load(): Promise<State> {
    const runtime = this.runtime;
    // Reload when the state file changed on disk (e.g. another dev server
    // instance or process wrote it); otherwise serve the cached state.
    if (runtime.state) {
      const currentMtime = await this.fileMtimeMs();
      if (currentMtime === null || currentMtime === runtime.stateFileMtimeMs) return runtime.state;
    }
    // Stat before reading: if the file is rewritten while we read, the
    // recorded mtime will differ from the file's and the next load reloads.
    runtime.stateFileMtimeMs = await this.fileMtimeMs();
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as State;
      runtime.state = { ...emptyState(), ...parsed };
    } catch { runtime.state = emptyState(); }
    return runtime.state;
  }

  private async mutate(fn: (state: State) => void | Promise<void>): Promise<void> {
    const runtime = this.runtime;
    runtime.queue = runtime.queue.catch(() => {}).then(async () => {
      const state = structuredClone(await this.load());
      await fn(state);
      await mkdir(this.root, { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(state), "utf8");
      await rename(temp, this.filePath);
      runtime.state = state;
      runtime.stateFileMtimeMs = await this.fileMtimeMs();
    });
    return runtime.queue;
  }

  async saveRide(ownerId: string, record: RideRecord, contentHash?: string): Promise<void> {
    await this.mutate((state) => {
      state.rides[record.activity.rideId] = {
        ownerId, record: sanitized(record), storedAt: new Date().toISOString(),
        ...(contentHash !== undefined ? { contentHash } : {}),
      };
    });
  }
  async findRideIdByContentHash(ownerId: string, contentHash: string): Promise<string | null> {
    const entry = Object.values((await this.load()).rides)
      .find((item) => item.ownerId === ownerId && item.contentHash === contentHash);
    return entry?.record.activity.rideId ?? null;
  }
  async importRide(ownerId: string, contentHash: string, parse: (rideId?: string) => Promise<RideRecord>, source?: RideImportSource): Promise<ImportResult | null> {
    let result: ImportResult | null = null;
    await this.mutate(async state => {
      const activities = source?.provider === "xingzhe" ? state.xingzheActivities : state.oneLapActivities;
      if (source) {
        const connections = source.provider === "xingzhe" ? state.xingzheConnections : state.oneLapConnections;
        if (connections[ownerId]?.id !== source.connectionId) return;
        const known = activities[source.key];
        if (source.provider === "xingzhe" && source.reimportDeleted) {
          if (known?.ownerId !== ownerId || known.rideId !== null) {
            result = { rideId: known?.ownerId === ownerId ? known.rideId : null, duplicate: true };
            return;
          }
        } else if (known?.ownerId === ownerId) {
          const target = known.rideId ? state.rides[known.rideId] : undefined;
          if (source.provider === "xingzhe" && source.replaceSummary && target?.ownerId === ownerId
            && target.record.activity.source.kind === "platform_summary"
            && !Object.values(state.rides).some(ride => ride.ownerId === ownerId && ride.contentHash === contentHash)) {
            const rideId = target.record.activity.rideId;
            target.record = sanitized(await parse(rideId));
            target.contentHash = contentHash;
            result = { rideId, duplicate: false, updated: true };
            return;
          }
          result = { rideId: known.rideId, duplicate: true };
          return;
        }
      }
      const existing = Object.values(state.rides).find(item => item.ownerId === ownerId && item.contentHash === contentHash);
      let rideId: string;
      if (!existing) {
        const record = await parse();
        rideId = record.activity.rideId;
        state.rides[rideId] = { ownerId, record: sanitized(record), storedAt: new Date().toISOString(), contentHash };
      } else {
        rideId = existing.record.activity.rideId;
        const ux = state.profiles[ownerId]?.ux;
        if (!source && ux?.mode === "blank" && existing.storedAt < (ux.blankSince ?? "")) existing.storedAt = new Date().toISOString();
      }
      if (source) activities[source.key] = { ownerId, rideId };
      result = { rideId, duplicate: Boolean(existing) };
    });
    return result;
  }
  async getOneLapConnection(ownerId: string): Promise<OneLapConnection | null> {
    return structuredClone((await this.load()).oneLapConnections[ownerId] ?? null);
  }
  async setOneLapConnection(ownerId: string, connection: OneLapConnection | null, expectedId?: string) {
    await this.mutate(state => {
      if (expectedId !== undefined && state.oneLapConnections[ownerId]?.id !== expectedId) return;
      if (connection) {
        const next = structuredClone(connection);
        if (next.result) next.result.rideIds = next.result.rideIds.filter(id => state.rides[id]?.ownerId === ownerId);
        state.oneLapConnections[ownerId] = next;
      }
      else delete state.oneLapConnections[ownerId];
    });
  }
  async findOneLapActivity(ownerId: string, key: string): Promise<{ rideId: string | null } | null> {
    const activity = (await this.load()).oneLapActivities[key];
    return activity?.ownerId === ownerId ? { rideId: activity.rideId } : null;
  }
  async getXingzheConnection(ownerId: string): Promise<XingzheConnection | null> {
    return structuredClone((await this.load()).xingzheConnections[ownerId] ?? null);
  }
  async findXingzheActivity(ownerId: string, key: string): Promise<"summary" | "imported" | "deleted" | null> {
    const state = await this.load();
    const activity = state.xingzheActivities[key];
    if (activity?.ownerId !== ownerId) return null;
    if (activity.rideId === null) return "deleted";
    const ride = state.rides[activity.rideId];
    return ride?.ownerId === ownerId && ride.record.activity.source.kind === "platform_summary" ? "summary" : "imported";
  }
  async updateXingzheConnection(ownerId: string, connection: XingzheConnection): Promise<void> {
    await this.mutate(state => {
      if (state.xingzheConnections[ownerId]?.id !== connection.id) return;
      const next = structuredClone(connection);
      if (next.result) next.result.rideIds = next.result.rideIds.filter(id => state.rides[id]?.ownerId === ownerId);
      state.xingzheConnections[ownerId] = next;
    });
  }
  async beginXingzheAuthorization(ownerId: string, stateHash: string, expiresAt: number, returnQuery?: string): Promise<void> {
    await this.mutate(state => {
      state.xingzheAuthorizations[ownerId] = { stateHash, expiresAt, returnQuery };
    });
  }
  async claimXingzheAuthorization(ownerId: string, stateHash: string): Promise<XingzheAuthorization | null> {
    let claimed: XingzheAuthorization | null = null;
    await this.mutate(state => {
      const pending = state.xingzheAuthorizations[ownerId];
      if (pending?.stateHash !== stateHash || pending.claimed || pending.expiresAt <= Date.now()) return;
      pending.claimed = true;
      claimed = structuredClone(pending);
    });
    return claimed;
  }
  async finishXingzheAuthorization(ownerId: string, stateHash: string, connection?: XingzheConnection): Promise<boolean> {
    let finished = false;
    await this.mutate(state => {
      const pending = state.xingzheAuthorizations[ownerId];
      if (pending?.stateHash !== stateHash || !pending.claimed) return;
      delete state.xingzheAuthorizations[ownerId];
      if (connection) state.xingzheConnections[ownerId] = structuredClone(connection);
      finished = true;
    });
    return finished;
  }
  async disconnectXingzhe(ownerId: string): Promise<void> {
    await this.mutate(state => {
      delete state.xingzheAuthorizations[ownerId];
      delete state.xingzheConnections[ownerId];
    });
  }
  async getRide(ownerId: string, rideId: string): Promise<RideRecord | null> {
    const item = (await this.load()).rides[rideId];
    return item?.ownerId === ownerId ? structuredClone(item.record) : null;
  }
  async listRides(ownerId: string): Promise<Array<{ record: RideRecord; storedAt: string }>> {
    return Object.values((await this.load()).rides)
      .filter((item): item is { ownerId: string; record: RideRecord; storedAt: string } => item.ownerId === ownerId)
      .sort((left, right) => right.storedAt.localeCompare(left.storedAt))
      .map((item) => ({ record: structuredClone(item.record), storedAt: item.storedAt }));
  }
  async deleteRide(ownerId: string, rideId: string): Promise<boolean> {
    let deleted = false;
    await this.mutate(state => {
      if (state.rides[rideId]?.ownerId !== ownerId) return;
      delete state.rides[rideId];
      delete state.analysisRuns[analysisKey(ownerId, rideId)];
      if (state.analysisRuns[rideId]?.ownerId === ownerId) delete state.analysisRuns[rideId];
      for (const activity of [...Object.values(state.oneLapActivities), ...Object.values(state.xingzheActivities)]) {
        if (activity.ownerId === ownerId && activity.rideId === rideId) activity.rideId = null;
      }
      for (const connection of [state.oneLapConnections[ownerId], state.xingzheConnections[ownerId]]) {
        if (connection?.result) connection.result.rideIds = connection.result.rideIds.filter(id => id !== rideId);
      }
      deleted = true;
    });
    return deleted;
  }
  async getProfile(ownerId: string): Promise<UserProfile | null> { const value = (await this.load()).profiles[ownerId]; return value ? structuredClone(value) : null; }
  async saveProfile(ownerId: string, profile: UserProfile): Promise<void> { await this.mutate((state) => { state.profiles[ownerId] = structuredClone(profile); }); }
  async saveAnalysisRun(ownerId: string, rideId: string, result: unknown): Promise<void> { await this.mutate((state) => { state.analysisRuns[analysisKey(ownerId, rideId)] = { ownerId, run: { rideId, result: structuredClone(result), storedAt: new Date().toISOString() } }; }); }
  async getAnalysisRun(ownerId: string, rideId: string): Promise<AnalysisRunRecord | null> {
    const runs = (await this.load()).analysisRuns;
    const value = runs[analysisKey(ownerId, rideId)] ?? runs[rideId];
    return value?.ownerId === ownerId ? structuredClone(value.run) : null;
  }
  async getConsent(ownerId: string): Promise<ConsentRecord | null> { const value = (await this.load()).consents[ownerId]; return value ? structuredClone(value) : null; }
  async saveConsent(ownerId: string, consent: ConsentRecord): Promise<void> { await this.mutate((state) => { state.consents[ownerId] = structuredClone(consent); }); }
  async saveDemoEvent(ownerId: string, event: DemoEvent): Promise<void> { await this.mutate((state) => { state.demoEvents[event.eventId] = { ownerId, event: structuredClone(event) }; }); }
  async listDemoEvents(ownerId: string): Promise<DemoEvent[]> {
    return Object.values((await this.load()).demoEvents)
      .filter((item): item is { ownerId: string; event: DemoEvent } => item.ownerId === ownerId)
      .sort((left, right) => left.event.occurredAt.localeCompare(right.event.occurredAt))
      .map((item) => structuredClone(item.event));
  }
  async deleteAccount(ownerId: string): Promise<void> {
    await this.mutate((state) => {
      for (const [id, item] of Object.entries(state.rides)) if (item.ownerId === ownerId) delete state.rides[id];
      for (const [key, item] of Object.entries(state.analysisRuns)) if (item.ownerId === ownerId) delete state.analysisRuns[key];
      for (const [id, item] of Object.entries(state.demoEvents)) if (item.ownerId === ownerId) delete state.demoEvents[id];
      delete state.profiles[ownerId];
      delete state.consents[ownerId];
      delete state.oneLapConnections[ownerId];
      delete state.xingzheConnections[ownerId];
      delete state.xingzheAuthorizations[ownerId];
      for (const [key, activity] of Object.entries(state.oneLapActivities)) if (activity.ownerId === ownerId) delete state.oneLapActivities[key];
      for (const [key, activity] of Object.entries(state.xingzheActivities)) if (activity.ownerId === ownerId) delete state.xingzheActivities[key];
    });
  }
}

export function getApplicationRepository(): FileApplicationRepository {
  return new FileApplicationRepository();
}
