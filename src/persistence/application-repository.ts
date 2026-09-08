import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RideRecord } from "../domain/ride-schema.ts";
import type { UserProfile } from "../domain/user-profile.ts";
import type { DemoEvent } from "../observability/demo-events.ts";

export interface AnalysisRunRecord { rideId: string; result: unknown; storedAt: string }
export interface ConsentRecord { policyVersion: string; acceptedAt: string }
export interface ApplicationRepository {
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
};

const instances = new Map<string, FileApplicationRepository>();
const defaultRoot = () => process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".local-data");

function emptyState(): State { return { rides: {}, profiles: {}, analysisRuns: {}, consents: {}, demoEvents: {} }; }

function sanitized(record: RideRecord): RideRecord {
  const next = structuredClone(record);
  delete next.activity.source.fileName;
  return next;
}

export class FileApplicationRepository implements ApplicationRepository {
  private state: State | null = null;
  private queue: Promise<void> = Promise.resolve();
  readonly filePath: string;
  readonly root: string;
  constructor(root: string = defaultRoot()) { this.root = root; this.filePath = path.join(root, "application-state.json"); }

  private async load(): Promise<State> {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as State;
      this.state = { ...emptyState(), ...parsed };
    } catch { this.state = emptyState(); }
    return this.state;
  }

  private async mutate(fn: (state: State) => void): Promise<void> {
    this.queue = this.queue.then(async () => {
      const state = await this.load();
      fn(state);
      await mkdir(this.root, { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(state), "utf8");
      await rename(temp, this.filePath);
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
    await this.mutate((state) => { const item = state.rides[rideId]; if (item?.ownerId === ownerId) { delete state.rides[rideId]; delete state.analysisRuns[rideId]; deleted = true; } });
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
    });
  }
}

export function getApplicationRepository(): ApplicationRepository { const root = defaultRoot(); let instance = instances.get(root); if (!instance) { instance = new FileApplicationRepository(root); instances.set(root, instance); } return instance; }
