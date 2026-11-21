import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RideRecord } from "../domain/ride-schema.ts";
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
  result?: { added: number; duplicate: number; failed: number; rideIds: string[] };
};
type OneLapSource = { connectionId: string; key: string };
type ImportResult = { rideId: string | null; duplicate: boolean };
export interface ApplicationRepository {
  getOneLapConnection(ownerId: string): Promise<OneLapConnection | null>;
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
  oneLapActivities: Record<string, { ownerId: string; rideId: string | null }>;
};

// Next.js dev mode compiles each route into its own bundle, so module-level
// state is not shared between the import API and the ride pages. Keep the
// repository singletons on globalThis (same pattern as demo-ride-store) so
// every route reads and writes through the same cached instance.
const INSTANCES_KEY = "__aiCyclingBuddyApplicationRepositories";

function repositoryInstances(): Map<string, FileApplicationRepository> {
  const globalState = globalThis as typeof globalThis & { [INSTANCES_KEY]?: Map<string, FileApplicationRepository> };
  if (!globalState[INSTANCES_KEY]) globalState[INSTANCES_KEY] = new Map();
  return globalState[INSTANCES_KEY];
}

const defaultRoot = () => process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".local-data");

function emptyState(): State { return { rides: {}, profiles: {}, analysisRuns: {}, consents: {}, demoEvents: {}, oneLapConnections: {}, oneLapActivities: {} }; }

function sanitized(record: RideRecord): RideRecord {
  const next = structuredClone(record);
  delete next.activity.source.fileName;
  return next;
}

export class FileApplicationRepository implements ApplicationRepository {
  private state: State | null = null;
  private stateFileMtimeMs: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  readonly filePath: string;
  readonly root: string;
  constructor(root: string = defaultRoot()) { this.root = root; this.filePath = path.join(root, "application-state.json"); }

  private async fileMtimeMs(): Promise<number | null> {
    try { return (await stat(this.filePath)).mtimeMs; } catch { return null; }
  }

  private async load(): Promise<State> {
    // Reload when the state file changed on disk (e.g. another dev server
    // instance or process wrote it); otherwise serve the cached state.
    if (this.state) {
      const currentMtime = await this.fileMtimeMs();
      if (currentMtime === null || currentMtime === this.stateFileMtimeMs) return this.state;
    }
    // Stat before reading: if the file is rewritten while we read, the
    // recorded mtime will differ from the file's and the next load reloads.
    this.stateFileMtimeMs = await this.fileMtimeMs();
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as State;
      this.state = { ...emptyState(), ...parsed };
    } catch { this.state = emptyState(); }
    return this.state;
  }

  private async mutate(fn: (state: State) => void | Promise<void>): Promise<void> {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const state = structuredClone(await this.load());
      await fn(state);
      await mkdir(this.root, { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(state), "utf8");
      await rename(temp, this.filePath);
      this.state = state;
      this.stateFileMtimeMs = await this.fileMtimeMs();
    });
    return this.queue;
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
  async importRide(ownerId: string, contentHash: string, parse: () => Promise<RideRecord>, source?: OneLapSource): Promise<ImportResult | null> {
    let result: ImportResult | null = null;
    await this.mutate(async state => {
      if (source) {
        if (state.oneLapConnections[ownerId]?.id !== source.connectionId) return;
        const known = state.oneLapActivities[source.key];
        if (known?.ownerId === ownerId) {
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
      if (source) state.oneLapActivities[source.key] = { ownerId, rideId };
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
      delete state.analysisRuns[rideId];
      for (const activity of Object.values(state.oneLapActivities)) {
        if (activity.ownerId === ownerId && activity.rideId === rideId) activity.rideId = null;
      }
      const result = state.oneLapConnections[ownerId]?.result;
      if (result) result.rideIds = result.rideIds.filter(id => id !== rideId);
      deleted = true;
    });
    return deleted;
  }
  async getProfile(ownerId: string): Promise<UserProfile | null> { const value = (await this.load()).profiles[ownerId]; return value ? structuredClone(value) : null; }
  async saveProfile(ownerId: string, profile: UserProfile): Promise<void> { await this.mutate((state) => { state.profiles[ownerId] = structuredClone(profile); }); }
  async saveAnalysisRun(ownerId: string, rideId: string, result: unknown): Promise<void> { await this.mutate((state) => { state.analysisRuns[rideId] = { ownerId, run: { rideId, result: structuredClone(result), storedAt: new Date().toISOString() } }; }); }
  async getAnalysisRun(ownerId: string, rideId: string): Promise<AnalysisRunRecord | null> { const value = (await this.load()).analysisRuns[rideId]; return value?.ownerId === ownerId ? structuredClone(value.run) : null; }
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
      for (const [id, item] of Object.entries(state.rides)) if (item.ownerId === ownerId) { delete state.rides[id]; delete state.analysisRuns[id]; }
      for (const [id, item] of Object.entries(state.demoEvents)) if (item.ownerId === ownerId) delete state.demoEvents[id];
      delete state.profiles[ownerId];
      delete state.consents[ownerId];
      delete state.oneLapConnections[ownerId];
      for (const [key, activity] of Object.entries(state.oneLapActivities)) if (activity.ownerId === ownerId) delete state.oneLapActivities[key];
    });
  }
}

export function getApplicationRepository(): FileApplicationRepository { const root = defaultRoot(); const instances = repositoryInstances(); let instance = instances.get(root); if (!instance) { instance = new FileApplicationRepository(root); instances.set(root, instance); } return instance; }
