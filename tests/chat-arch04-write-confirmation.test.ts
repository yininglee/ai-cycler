import assert from "node:assert/strict";
import test from "node:test";
import { createConfirmedWriteService, ConfirmedWriteError, type ConfirmedWriteStore, type WriteTransaction, type WriteGrant, type WriteReceipt, type WriteAudit, type ConfirmedWriteHandler } from "../src/chat/chat-write-confirmation.ts";
import { sanitizeChatInteractionPayload } from "../src/chat/chat-interaction.ts";

type Domain = { draft: { version: string; content: { minutes: number } }; writes: number };
type State = { domain: Domain; grants: Map<string, WriteGrant>; receipts: Map<string, WriteReceipt>; audits: WriteAudit[] };
function setup() {
  const states = new Map<string, State>();
  let queue = Promise.resolve();
  let failAudit = false;
  const state = (owner: string) => {
    if (!states.has(owner)) states.set(owner, { domain: { draft: { version: "v1", content: { minutes: 30 } }, writes: 0 }, grants: new Map(), receipts: new Map(), audits: [] });
    return states.get(owner)!;
  };
  // Test adapter only: clone before work, publish only after ALL operations succeed.
  // One global lock also serializes different keys/grants for the same target.
  const store: ConfirmedWriteStore<Domain> = { async transaction<T>(owner: string, work: (tx: WriteTransaction<Domain>) => Promise<T>) {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const next = structuredClone(state(owner));
      const result = await work({ domain: next.domain,
        getGrant: async key => next.grants.get(key) ?? null,
        putGrant: async grant => { next.grants.set(grant.tokenHash, grant); },
        getReceipt: async key => next.receipts.get(key) ?? null,
        putReceipt: async receipt => { next.receipts.set(receipt.idempotencyKey, receipt); },
        appendAudit: async event => { if (failAudit) throw new Error("audit unavailable"); next.audits.push(event); },
      });
      states.set(owner, next);
      return result;
    } finally { release(); }
  } };
  let rulesPass = true;
  const handler: ConfirmedWriteHandler<Domain> = {
    loadCurrent: async domain => domain.draft,
    validateSchema: content => typeof content === "object" && content !== null && "minutes" in content && typeof content.minutes === "number" && Number.isFinite(content.minutes),
    validateRules: content => rulesPass && (content as { minutes: number }).minutes > 0,
    apply: async domain => { domain.writes++; domain.draft.version = `v${domain.writes + 1}`; return { receiptId: `receipt-${domain.writes}` }; },
  };
  const service = createConfirmedWriteService(store, new Map([["test_activate", handler]]));
  const issue = (key = "request-1", ownerId = "owner-a") => service.issue({ ownerId, action: "test_activate", targetId: "draft-1", idempotencyKey: key, ttlMs: 100, now: 1000 });
  const request = (grant: Awaited<ReturnType<typeof issue>>) => ({ confirmed: true as const, token: grant.token, action: grant.action, targetId: grant.targetId, version: grant.version, idempotencyKey: grant.idempotencyKey });
  return { service, store, handler, state, issue, request, setRules: (value: boolean) => { rulesPass = value; }, setAuditFailure: (value: boolean) => { failAudit = value; } };
}
const code = (expected: string) => (error: unknown) => error instanceof ConfirmedWriteError && error.code === expected;

test("ARCH-04: confirmation binds owner, action, entity, version, token and key", async () => {
  const f = setup(); const grant = await f.issue(); const original = f.request(grant);
  assert.doesNotMatch(JSON.stringify([...f.state("owner-a").grants.values()]), new RegExp(grant.token));
  for (const patch of [{ targetId: "other" }, { version: "v2" }, { idempotencyKey: "other" }, { token: "x".repeat(43) }]) {
    await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: { ...original, ...patch }, now: 1001 }), code("INVALID_CONFIRMATION"));
  }
  await assert.rejects(f.service.confirm({ ownerId: "owner-b", request: original, now: 1001 }), code("INVALID_CONFIRMATION"));
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: { ...original, action: "unregistered" }, now: 1001 }), code("NOT_FOUND"));
  assert.equal(f.state("owner-a").domain.writes, 0);
});

test("ARCH-04: natural language, false confirmation and extra fields never write", async () => {
  const f = setup(); const r = f.request(await f.issue());
  for (const request of ["不错", { ...r, confirmed: false }, { ...r, ownerId: "owner-a" }, { ...r, token: "invalid" }]) {
    await assert.rejects(f.service.confirm({ ownerId: "owner-a", request, now: 1001 }), code("INVALID_CONFIRMATION"));
  }
  assert.equal(f.state("owner-a").domain.writes, 0);
});

test("ARCH-04: expiry, version changes and same-version payload changes reject before apply", async () => {
  const f = setup(); const r = f.request(await f.issue());
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: r, now: 1100 }), code("CONFIRMATION_EXPIRED"));
  f.state("owner-a").domain.draft.version = "v2";
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: r, now: 1001 }), code("VERSION_CONFLICT"));
  f.state("owner-a").domain.draft.version = "v1";
  f.state("owner-a").domain.draft.content.minutes = 50;
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: r, now: 1001 }), code("CONTENT_CHANGED"));
  assert.equal(f.state("owner-a").domain.writes, 0);
});

test("ARCH-04: schema and domain rules are mandatory on issuance and repeated on commit", async () => {
  const f = setup(); const r = f.request(await f.issue());
  f.setRules(false);
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: r, now: 1001 }), code("RULES_REJECTED"));
  await assert.rejects(f.issue("other-key"), code("RULES_REJECTED"));
  f.setRules(true);
  f.state("owner-a").domain.draft.content.minutes = NaN;
  await assert.rejects(f.issue("bad-schema"), code("SCHEMA_REJECTED"));
  assert.equal(f.state("owner-a").domain.writes, 0);
});

test("ARCH-04: concurrent double confirmation writes once, with receipt replay after expiry", async () => {
  const f = setup(); const r = f.request(await f.issue());
  const results = await Promise.all([1, 2, 3].map(() => f.service.confirm({ ownerId: "owner-a", request: r, now: 1001 })));
  assert.deepEqual(results.map(result => result.replayed), [false, true, true]);
  assert.equal(f.state("owner-a").domain.writes, 1);
  assert.deepEqual(await f.service.confirm({ ownerId: "owner-a", request: r, now: 5000 }), { replayed: true, result: { receiptId: "receipt-1" } });
  assert.deepEqual(f.state("owner-a").audits.map(event => event.status), ["issued", "committed"]);
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: { ...r, token: "y".repeat(43) }, now: 1001 }), code("IDEMPOTENCY_CONFLICT"));
});

test("ARCH-04: different grants and keys cannot both apply the same draft version", async () => {
  const f = setup(); const a = f.request(await f.issue("a")); const b = f.request(await f.issue("b"));
  const results = await Promise.allSettled([a, b].map(request => f.service.confirm({ ownerId: "owner-a", request, now: 1001 })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && code("VERSION_CONFLICT")(rejected.reason));
  assert.equal(f.state("owner-a").domain.writes, 1);
});

test("ARCH-04: audit failure rolls back mutation, consumption and receipt, and retry can succeed", async () => {
  const f = setup(); const r = f.request(await f.issue());
  f.setAuditFailure(true);
  await assert.rejects(f.service.confirm({ ownerId: "owner-a", request: r, now: 1001 }), /audit unavailable/);
  assert.equal(f.state("owner-a").domain.writes, 0);
  assert.equal(f.state("owner-a").receipts.size, 0);
  assert.ok([...f.state("owner-a").grants.values()].every(grant => !grant.consumed));
  f.setAuditFailure(false);
  assert.equal((await f.service.confirm({ ownerId: "owner-a", request: r, now: 1001 })).replayed, false);
});

test("ARCH-04: handlers must invalidate the consumed version; empty production registration grants nothing", async () => {
  const f = setup();
  const service = createConfirmedWriteService(f.store, new Map([["test_activate", { ...f.handler, apply: async () => ({}) }]]));
  const r = f.request(await f.issue());
  await assert.rejects(service.confirm({ ownerId: "owner-a", request: r, now: 1001 }), code("VERSION_NOT_ADVANCED"));
  const empty = createConfirmedWriteService(f.store, new Map());
  await assert.rejects(empty.issue({ ownerId: "owner-a", action: "test_activate", targetId: "draft-1", idempotencyKey: "new", ttlMs: 100, now: 1000 }), code("NOT_FOUND"));
});

test("ARCH-04: schema-valid actions must reference the accompanying record list", () => {
  const result = sanitizeChatInteractionPayload({ artifact: { kind: "ride_list", payload: { items: [{ rideId: "ride-a", dateLabel: "11月1日" }] } },
    choices: [{ kind: "ride", id: "ride-b", label: "其他记录" }], quickActions: [{ kind: "deepAnalysis", rideId: "ride-b", dateLabel: "11月1日" }] });
  assert.equal(result.artifact?.kind, "ride_list");
  assert.equal(result.choices, undefined); assert.equal(result.quickActions, undefined);
  assert.deepEqual(result.droppedFields, ["choices", "quickActions"]);
});

test("ARCH-04: the sixth provider call cannot trigger a seventh repair call", async () => {
  const { runChatAgent } = await import("../src/chat/chat-agent.ts");
  const { makeChatDecision } = await import("../src/chat/chat-routing.ts");
  const { createChatToolLoopRunner } = await import("../src/chat/chat-tool-orchestration.ts");
  const repo = { listRides: async () => [], getProfile: async () => null } as unknown as import("../src/persistence/application-repository.ts").ApplicationRepository;
  let calls = 0;
  const result = await runChatAgent({ text: "解释骑行原理", decision: makeChatDecision("kb_qa", "none", "KB_QA", 8), loopRunner: createChatToolLoopRunner(repo, "owner"),
    provider: { async run() {
      calls++;
      return { rawText: calls <= 5 ? JSON.stringify({ schemaVersion: "ride-chat-tool-call-v0.1", calls: [{ tool: "search_knowledge_base", input: { keywords: ["心率"], maxEntries: 1 } }] }) : "invalid output" };
    } },
  });
  assert.equal(calls, 6);
  assert.equal(result.loopTrace?.providerCalls, 6);
  assert.equal(result.fallbackCode, "TOOLS_LOOP_BUDGET_EXHAUSTED");
});
