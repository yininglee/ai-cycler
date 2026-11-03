import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConfirmedWriteStore, WriteAudit, WriteGrant, WriteReceipt } from "../chat/chat-write-confirmation.ts";
import { emptyPlanIntake, type PlanIntake, type TrainingPlan } from "../domain/training-plan.ts";
import type { TrainingExecution, TrainingLinkDraft } from "../domain/training-execution.ts";

export type PlanWorkspace = {
  id: string; intakeVersion: number; confirmedIntakeVersion: number | null; intake: PlanIntake;
  version: number; draftVersion: number | null; activeVersion: number | null;
  plans: TrainingPlan[]; activatedAt: Record<string, string>; replacedAt: Record<string, string>;
  workoutRecords: Record<string, { completedAt: string; rideId?: string }>;
  executions: Record<string, TrainingExecution>; linkDrafts: Record<string, TrainingLinkDraft>; deletedVersions: Record<string, string>;
};
type OwnerState = { workspace: PlanWorkspace; grants: Record<string, WriteGrant>; receipts: Record<string, WriteReceipt>; audits: WriteAudit[] };
const globalQueues = globalThis as typeof globalThis & { __cyclerPlanQueues?: Map<string, Promise<unknown>> };
const queues = globalQueues.__cyclerPlanQueues ??= new Map();
const empty = (ownerId: string, viewKey: string): OwnerState => ({ workspace: { id: `plan-${createHash("sha256").update(JSON.stringify([ownerId, viewKey])).digest("hex").slice(0, 32)}`, intakeVersion: 0, confirmedIntakeVersion: null, intake: emptyPlanIntake(), version: 0, draftVersion: null, activeVersion: null, plans: [], activatedAt: {}, replacedAt: {}, workoutRecords: {}, executions: {}, linkDrafts: {}, deletedVersions: {} }, grants: {}, receipts: {}, audits: [] });
function normalize(workspace: PlanWorkspace): PlanWorkspace {
  workspace.executions ??= {}; workspace.linkDrafts ??= {}; workspace.deletedVersions ??= {};
  return workspace;
}

/** SQLite serializes writers across processes and atomically commits domain,
 * confirmation consumption, receipts and audit. No model calls run in a transaction. */
export class TrainingPlanStore implements ConfirmedWriteStore<PlanWorkspace> {
  readonly filePath: string;
  readonly viewKey: string;
  constructor(viewKey = "default", root = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".local-data")) {
    this.viewKey = viewKey;
    mkdirSync(root, { recursive: true });
    this.filePath = path.join(root, "training-plans.sqlite");
  }
  private open() {
    const db = new DatabaseSync(this.filePath);
    db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec("CREATE TABLE IF NOT EXISTS plan_state (owner_id TEXT NOT NULL, view_key TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(owner_id,view_key))");
    return db;
  }
  async transaction<T>(ownerId: string, work: Parameters<ConfirmedWriteStore<PlanWorkspace>["transaction"]>[1]): Promise<T> {
    const run = (queues.get(this.filePath) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const db = this.open();
      let begun = false;
      try {
        db.exec("BEGIN IMMEDIATE");
        begun = true;
        const row = db.prepare("SELECT content FROM plan_state WHERE owner_id=? AND view_key=?").get(ownerId, this.viewKey) as { content: string } | undefined;
        const state: OwnerState = row ? JSON.parse(row.content) : empty(ownerId, this.viewKey);
        normalize(state.workspace);
        const result = await work({ domain: state.workspace,
          getGrant: async key => state.grants[key] ?? null, putGrant: async grant => { state.grants[grant.tokenHash] = grant; },
          getReceipt: async key => state.receipts[key] ?? null, putReceipt: async receipt => { state.receipts[receipt.idempotencyKey] = receipt; },
          appendAudit: async audit => { state.audits.push(audit); },
        });
        db.prepare("INSERT INTO plan_state(owner_id,view_key,content) VALUES(?,?,?) ON CONFLICT(owner_id,view_key) DO UPDATE SET content=excluded.content").run(ownerId, this.viewKey, JSON.stringify(state));
        db.exec("COMMIT");
        begun = false;
        return result as T;
      } catch (error) { if (begun) db.exec("ROLLBACK"); throw error; }
      finally { db.close(); }
    });
    queues.set(this.filePath, run);
    return run;
  }
  async read(ownerId: string): Promise<PlanWorkspace> {
    const db = this.open();
    try {
      const row = db.prepare("SELECT content FROM plan_state WHERE owner_id=? AND view_key=?").get(ownerId, this.viewKey) as { content: string } | undefined;
      return normalize(row ? JSON.parse(row.content).workspace : empty(ownerId, this.viewKey).workspace);
    } finally { db.close(); }
  }
  async deleteOwner(ownerId: string): Promise<void> {
    const run = (queues.get(this.filePath) ?? Promise.resolve()).catch(() => {}).then(() => {
      const db = this.open();
      try { db.prepare("DELETE FROM plan_state WHERE owner_id=?").run(ownerId); } finally { db.close(); }
    });
    queues.set(this.filePath, run); await run;
  }
}
