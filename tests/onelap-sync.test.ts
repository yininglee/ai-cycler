import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { GET, POST } from "../app/api/platform/route.ts";
import { resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { importRideBytes } from "../src/imports/ride-import-service.ts";
import { executeChatTool } from "../src/chat/chat-tools.ts";
import { getApplicationRepository, FileApplicationRepository } from "../src/persistence/application-repository.ts";
import { connectOneLapPilot, readOneLapPilotConfig, syncOneLapPilot } from "../src/sync/onelap-sync.ts";
import { buildCyclingFitSample } from "./helpers/fit-sample.ts";

const ownerId = "onelap-test-owner";
const testConfig = { ownerId, accountKey: "test-account", token: "fixture-token", signingKey: "fixture-signing-key", cookie: undefined };
const bytes = buildCyclingFitSample({});
const listResponse = (id: string) => Response.json({ data: { list: [{ _id: id }], pages: 1 } });

test("OneLap sync downloads a signed activity list and persists the FIT once across restarts", async () => {
  const root = `${process.env.LOCAL_DATA_DIR}/automatic`;
  const repository = new FileApplicationRepository(root);
  let downloaded = 0;
  const fitUrl = "https://untrusted.invalid/file.fit";
  const upstream: typeof fetch = async (resource, init) => {
    const url = new URL(String(resource));
    assert.equal(url.origin, "https://u.onelap.cn");
    assert.equal(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), testConfig.token);
    if (url.pathname.endsWith("/list")) {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { page: 1, limit: 20 });
      const canonical = `limit=20&nonce=${headers.get("nonce")}&page=1&timestamp=${headers.get("timestamp")}&key=${testConfig.signingKey}`;
      assert.equal(headers.get("sign"), createHash("md5").update(canonical).digest("hex"));
      return listResponse("ride-one");
    }
    if (url.pathname.endsWith("/analysis/ride-one")) return Response.json({ data: { fitUrl } });
    assert.equal(Buffer.from(decodeURIComponent(url.pathname.split("/").pop()!), "base64").toString(), fitUrl);
    downloaded++;
    return new Response(Buffer.from(bytes));
  };

  await connectOneLapPilot(repository, testConfig);
  const first = await syncOneLapPilot(repository, testConfig, upstream);
  assert.ok(first?.lastSyncAt);
  assert.equal(first.result?.added, 1);
  const rideId = first.result!.rideIds[0]!;
  const restarted = new FileApplicationRepository(root);
  assert.equal((await restarted.getRide(ownerId, rideId))?.activity.source.platformId, "onelap");
  assert.equal(await restarted.getRide("other-owner", rideId), null);
  assert.equal((await syncOneLapPilot(restarted, testConfig, upstream))?.result?.duplicate, 1);
  assert.equal(downloaded, 1);

  await restarted.deleteRide(ownerId, rideId);
  assert.equal((await syncOneLapPilot(restarted, testConfig, upstream))?.result?.duplicate, 1);
  assert.equal((await restarted.listRides(ownerId)).length, 0);
});

test("sync shares content dedup with manual import and checks the connection again before saving", async () => {
  const repository = new FileApplicationRepository(`${process.env.LOCAL_DATA_DIR}/dedup`);
  await connectOneLapPilot(repository, testConfig);
  await importRideBytes(repository, ownerId, "manual.fit", bytes);
  const synced = await syncOneLapPilot(repository, testConfig, async resource => {
    if (String(resource).endsWith("/list")) return listResponse("same-fit");
    if (String(resource).endsWith("/same-fit")) return Response.json({ fitUrl: "same.fit" });
    return new Response(Buffer.from(bytes));
  });
  assert.equal(synced?.result?.duplicate, 1);
  assert.equal((await repository.listRides(ownerId)).length, 1);

  const disconnected = await syncOneLapPilot(repository, testConfig, async resource => {
    if (String(resource).endsWith("/list")) return listResponse("new-fit");
    if (String(resource).endsWith("/new-fit")) return Response.json({ fitUrl: "new.fit" });
    await repository.setOneLapConnection(ownerId, null);
    return new Response(Buffer.from(bytes));
  });
  assert.equal(disconnected, null);
  assert.equal((await repository.listRides(ownerId)).length, 1);
});

test("OneLap rejects pull attempts during rate limiting and after authorization expires", async () => {
  const repository = new FileApplicationRepository(`${process.env.LOCAL_DATA_DIR}/upstream-errors`);
  await connectOneLapPilot(repository, testConfig);
  const limited = await syncOneLapPilot(repository, testConfig, async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  assert.ok((limited?.retryAt ?? 0) > Date.now());
  assert.equal((await syncOneLapPilot(repository, testConfig, async () => assert.fail("still backing off")))?.retryAt, limited?.retryAt);
  await repository.setOneLapConnection(ownerId, null);
  await connectOneLapPilot(repository, testConfig);
  const expired = await syncOneLapPilot(repository, testConfig, async () => new Response(null, { status: 401 }));
  assert.equal(expired?.paused, true);
  assert.equal((await syncOneLapPilot(repository, testConfig, async () => assert.fail("connection paused")))?.paused, true);
});

test("connecting and reading status do not contact OneLap; only an explicit sync pulls rides", async t => {
  const config = {
    SESSION_SECRET: "test-only-session-secret-at-least-32-characters", AUTH_SESSION_MODE: "development",
    ONELAP_SYNC_ENABLED: "true", ONELAP_SYNC_ACCOUNT_ID: "fixture-account",
    ONELAP_SYNC_TOKEN: testConfig.token, ONELAP_SYNC_SIGNING_KEY: testConfig.signingKey,
  };
  const saved = new Map([...Object.keys(config), "ONELAP_SYNC_OWNER_ID"].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of saved) value === undefined ? delete process.env[key] : (process.env[key] = value); });
  Object.assign(process.env, config);
  const url = "http://localhost/api/platform?provider=onelap";
  const session = resolveOrCreateRequestSession(new Request(url));
  process.env.ONELAP_SYNC_OWNER_ID = session.userId;
  assert.equal(readOneLapPilotConfig()?.ownerId, session.userId);
  const headers = { cookie: session.setCookie!.split(";")[0]!, "Content-Type": "application/json" };
  const upstream = t.mock.method(globalThis, "fetch", async () => Response.json({ data: { list: [] } }));
  const post = (action: string) => POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ provider: "onelap", action }) }));
  const other = await GET(new Request(url));
  assert.deepEqual(await other.json(), { platform: null });
  const importEntry = async (owner: string) => {
    const result = await executeChatTool(getApplicationRepository(), owner, { tool: "prepare_ride_import", input: {} });
    assert.ok(result.tool === "prepare_ride_import");
    assert.doesNotMatch(JSON.stringify(result), /fixture-token|fixture-signing-key|accountKey|rideIds/);
    return result.platforms.find(platform => platform.id === "onelap");
  };
  assert.deepEqual(await importEntry("another-account"), { id: "onelap", name: "顽鹿", mode: "simulated", status: "disconnected" });
  assert.deepEqual(await importEntry(session.userId), { id: "onelap", name: "顽鹿", mode: "live_manual", status: "disconnected" });
  const connected = await post("connect");
  assert.equal(connected.status, 200);
  const state = await connected.json();
  assert.equal(state.live, true);
  assert.equal(state.platform.status, "connected");
  assert.doesNotMatch(JSON.stringify(state), /fixture-token|fixture-signing-key|accountKey/);
  assert.deepEqual(await importEntry(session.userId), { id: "onelap", name: "顽鹿", mode: "live_manual", status: "connected" });
  const status = await GET(new Request(url, { headers }));
  assert.equal((await status.json()).platform.lastSyncAt, undefined);
  assert.equal(upstream.mock.callCount(), 0);

  const synced = await post("sync");
  assert.equal(synced.status, 200);
  assert.ok((await synced.json()).platform.lastSyncAt);
  assert.deepEqual(await importEntry(session.userId), { id: "onelap", name: "顽鹿", mode: "live_manual", status: "connected",
    lastAttempt: { added: 0, duplicate: 0, failed: 0, interrupted: false } });
  assert.equal(upstream.mock.callCount(), 1);
});
