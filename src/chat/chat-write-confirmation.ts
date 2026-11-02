import { createHash, randomBytes, randomUUID } from "node:crypto";

export const CHAT_WRITE_CONFIRMATION_VERSION = "chat-write-confirmation-v0.1" as const;
export type ConfirmedWriteErrorCode = "INVALID_CONFIRMATION" | "NOT_FOUND" | "CONFIRMATION_EXPIRED" | "VERSION_CONFLICT" | "CONTENT_CHANGED" | "IDEMPOTENCY_CONFLICT" | "ALREADY_CONSUMED" | "SCHEMA_REJECTED" | "RULES_REJECTED" | "VERSION_NOT_ADVANCED";
export class ConfirmedWriteError extends Error {
  readonly code: ConfirmedWriteErrorCode;
  constructor(code: ConfirmedWriteErrorCode) { super(code); this.code = code; this.name = "ConfirmedWriteError"; }
}

export type WriteDraft = { version: string; content: unknown };
export type WriteBinding = { ownerId: string; action: string; targetId: string; version: string; contentHash: string; idempotencyKey: string };
export type WriteGrant = WriteBinding & { tokenHash: string; issuedAt: number; expiresAt: number; consumed: boolean };
export type WriteReceipt = WriteBinding & { tokenHash: string; result: unknown; committedAt: number };
export type WriteAudit = { schemaVersion: typeof CHAT_WRITE_CONFIRMATION_VERSION; auditId: string; status: "issued" | "committed"; action: string; targetId: string; version: string; contentHash: string; idempotencyRef: string; occurredAt: number };
export type WriteConfirmationRequest = { confirmed: true; token: string; action: string; targetId: string; version: string; idempotencyKey: string };

/** All methods are scoped to the authenticated owner by the store adapter. */
export interface WriteTransaction<Domain> {
  domain: Domain;
  getGrant(tokenHash: string): Promise<WriteGrant | null>;
  putGrant(grant: WriteGrant): Promise<void>;
  getReceipt(idempotencyKey: string): Promise<WriteReceipt | null>;
  putReceipt(receipt: WriteReceipt): Promise<void>;
  appendAudit(event: WriteAudit): Promise<void>;
}
export interface ConfirmedWriteStore<Domain> {
  /** MUST serialize conflicting grants/targets/keys, including across processes.
   * Domain mutation, grant consumption, receipt and audit commit or roll back together.
   * The existing best-effort demo events/file repository do not satisfy this port.
   */
  transaction<T>(ownerId: string, work: (tx: WriteTransaction<Domain>) => Promise<T>): Promise<T>;
}
export interface ConfirmedWriteHandler<Domain> {
  loadCurrent(domain: Domain, targetId: string): Promise<WriteDraft | null>;
  validateSchema(content: unknown): boolean;
  validateRules(content: unknown): boolean;
  /** Must advance the confirmable version or remove the consumed draft. */
  apply(domain: Domain, targetId: string, draft: WriteDraft): Promise<unknown>;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
function fail(code: ConfirmedWriteErrorCode): never { throw new ConfirmedWriteError(code); }
function contentHash(content: unknown): string {
  const ancestors = new Set<object>();
  function json(value: unknown): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || ancestors.has(value)) return fail("SCHEMA_REJECTED");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return fail("SCHEMA_REJECTED");
    ancestors.add(value);
    const normalized = Array.isArray(value) ? Array.from(value, json)
      : Object.fromEntries(Object.keys(value).sort().map(key => [key, json((value as Record<string, unknown>)[key])]));
    ancestors.delete(value);
    return normalized;
  }
  return hash(JSON.stringify(json(content)));
}
function parseRequest(value: unknown): WriteConfirmationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("INVALID_CONFIRMATION");
  const r = value as Record<string, unknown>;
  const keys = ["confirmed", "token", "action", "targetId", "version", "idempotencyKey"];
  if (Object.keys(r).length !== keys.length || !keys.every(key => key in r) || r.confirmed !== true
    || typeof r.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(r.token)
    || ![r.action, r.targetId, r.version, r.idempotencyKey].every(identifier)) return fail("INVALID_CONFIRMATION");
  return r as WriteConfirmationRequest;
}
function checkContent<Domain>(handler: ConfirmedWriteHandler<Domain>, draft: WriteDraft) {
  if (!identifier(draft.version) || handler.validateSchema(draft.content) !== true) fail("SCHEMA_REJECTED");
  if (handler.validateRules(draft.content) !== true) fail("RULES_REJECTED");
}
function matches(binding: WriteBinding, ownerId: string, r: WriteConfirmationRequest): boolean {
  return binding.ownerId === ownerId && binding.action === r.action && binding.targetId === r.targetId
    && binding.version === r.version && binding.idempotencyKey === r.idempotencyKey;
}
function audit(binding: WriteBinding, status: WriteAudit["status"], now: number): WriteAudit {
  return { schemaVersion: CHAT_WRITE_CONFIRMATION_VERSION, auditId: randomUUID(), status,
    action: binding.action, targetId: binding.targetId, version: binding.version,
    contentHash: binding.contentHash, idempotencyRef: hash(binding.idempotencyKey), occurredAt: now };
}

/** Server-only extension. Handlers are supplied by trusted application code,
 * never by a tool request. No production write handler is registered yet.
 */
export function createConfirmedWriteService<Domain>(store: ConfirmedWriteStore<Domain>, handlers: ReadonlyMap<string, ConfirmedWriteHandler<Domain>>) {
  // Snapshot registration so a caller cannot later replace an approved action.
  const registered = new Map(handlers);
  return {
    async issue(input: { ownerId: string; action: string; targetId: string; idempotencyKey: string; ttlMs: number; now?: number }) {
      const now = input.now ?? Date.now();
      if (![input.ownerId, input.action, input.targetId, input.idempotencyKey].every(identifier)
        || !Number.isSafeInteger(now) || !Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0 || !Number.isSafeInteger(now + input.ttlMs)) fail("INVALID_CONFIRMATION");
      const handler = registered.get(input.action);
      if (!handler) return fail("NOT_FOUND");
      return store.transaction(input.ownerId, async tx => {
        if (await tx.getReceipt(input.idempotencyKey)) fail("IDEMPOTENCY_CONFLICT");
        const current = await handler.loadCurrent(tx.domain, input.targetId);
        if (!current) return fail("NOT_FOUND");
        const draft = structuredClone(current);
        checkContent(handler, draft);
        const token = randomBytes(32).toString("base64url");
        const grant: WriteGrant = { ownerId: input.ownerId, action: input.action, targetId: input.targetId,
          version: draft.version, contentHash: contentHash(draft.content), idempotencyKey: input.idempotencyKey,
          tokenHash: hash(token), issuedAt: now, expiresAt: now + input.ttlMs, consumed: false };
        await tx.putGrant(grant);
        await tx.appendAudit(audit(grant, "issued", now));
        return { token, action: grant.action, targetId: grant.targetId, version: grant.version, idempotencyKey: grant.idempotencyKey, expiresAt: grant.expiresAt };
      });
    },
    async confirm(input: { ownerId: string; request: unknown; now?: number }) {
      if (!identifier(input.ownerId)) return fail("INVALID_CONFIRMATION");
      const request = parseRequest(input.request);
      const now = input.now ?? Date.now();
      if (!Number.isSafeInteger(now)) return fail("INVALID_CONFIRMATION");
      const handler = registered.get(request.action);
      if (!handler) return fail("NOT_FOUND");
      const tokenHash = hash(request.token);
      return store.transaction(input.ownerId, async tx => {
        const previous = await tx.getReceipt(request.idempotencyKey);
        // An authenticated, identical retry can replay after expiry or a later edit;
        // replay never reapplies the mutation or revalidates a different draft.
        if (previous) {
          if (!matches(previous, input.ownerId, request) || previous.tokenHash !== tokenHash) return fail("IDEMPOTENCY_CONFLICT");
          return { replayed: true, result: structuredClone(previous.result) };
        }
        const grant = await tx.getGrant(tokenHash);
        if (!grant || !matches(grant, input.ownerId, request)) return fail("INVALID_CONFIRMATION");
        if (grant.consumed) return fail("ALREADY_CONSUMED");
        if (now < grant.issuedAt || now >= grant.expiresAt) return fail("CONFIRMATION_EXPIRED");
        const current = await handler.loadCurrent(tx.domain, request.targetId);
        if (!current) return fail("NOT_FOUND");
        const draft = structuredClone(current);
        if (draft.version !== grant.version) return fail("VERSION_CONFLICT");
        if (contentHash(draft.content) !== grant.contentHash) return fail("CONTENT_CHANGED");
        checkContent(handler, draft);
        const result = structuredClone(await handler.apply(tx.domain, request.targetId, draft));
        contentHash(result); // Receipts must survive a JSON-backed transaction adapter.
        const after = await handler.loadCurrent(tx.domain, request.targetId);
        if (after && after.version === grant.version) return fail("VERSION_NOT_ADVANCED");
        await tx.putGrant({ ...grant, consumed: true });
        await tx.putReceipt({ ...grant, result, committedAt: now });
        await tx.appendAudit(audit(grant, "committed", now));
        return { replayed: false, result };
      });
    },
  };
}
