import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { POST as account } from "../app/api/account/route.ts";
import { GET as getPlatform, POST as platform } from "../app/api/platform/route.ts";
import { GET as callback } from "../app/api/platform/xingzhe/callback/route.ts";
import { POST as importRide } from "../app/api/rides/import/route.ts";
import { GET as summaries } from "../app/api/rides/summary/route.ts";
import { getRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { buildRidePageViewModelFromRecord } from "../src/ui/ride-view-model.ts";

function request(path: string, cookie: string, body?: object) {
  return new Request(`http://localhost${path}`, {
    method: body ? "POST" : "GET",
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function register(email: string) {
  const response = await account(request("/api/account", "", { action: "register", email, password: "test cycling account" }));
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie")!.split(";")[0];
}

test("顽鹿 and 行者 file uploads keep provenance, deduplicate by owner, and keep the original record", async () => {
  const a = await register("file-a@example.test");
  const b = await register("file-b@example.test");
  const file = await readFile(new URL("../test-data/synthetic-import-preview.gpx", import.meta.url));
  async function upload(session: string, provider: string) {
    const data = new FormData();
    data.set("file", new File([new Uint8Array(file)], "activity.gpx", { type: "application/gpx+xml" }));
    data.set("platform", provider);
    return importRide(new Request("http://localhost/api/rides/import", { method: "POST", headers: { Cookie: session }, body: data }));
  }
  assert.equal((await upload(a, "garmin")).status, 422);
  const onelap = await upload(a, "onelap");
  const xingzhe = await upload(b, "xingzhe");
  assert.equal(onelap.status, 201);
  assert.equal(xingzhe.status, 201);
  const first = (await onelap.json()).rideId;
  const second = (await xingzhe.json()).rideId;
  assert.notEqual(first, second);
  assert.deepEqual(await (await upload(a, "onelap")).json(), { rideId: first, duplicate: true });
  const url = `/api/rides/summary?id=${first}&id=${second}`;
  assert.deepEqual((await (await summaries(request(url, a))).json()).rides.map((ride: { source: string }) => ride.source), ["顽鹿"]);
  assert.deepEqual((await (await summaries(request(url, b))).json()).rides.map((ride: { source: string }) => ride.source), ["行者"]);
});

test("行者 status explains why the connection is unavailable without exposing application credentials", async t => {
  const config = {
    XINGZHE_SYNC_ENABLED: "false",
    XINGZHE_CLIENT_ID: "test-only-client",
    XINGZHE_CLIENT_SECRET: "test-only-client-secret",
    XINGZHE_REDIRECT_URI: "",
    SESSION_SECRET: "local-sync-test-secret-with-32-characters",
  };
  const previous = new Map(Object.keys(config).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, config);
  const cookie = await register("oauth-configuration@example.test");
  const status = async () => (await getPlatform(request("/api/platform?provider=xingzhe", cookie))).json();
  assert.deepEqual(await status(), { fileOnly: true, syncUnavailable: "disabled", platform: null });

  process.env.XINGZHE_SYNC_ENABLED = "true";
  assert.deepEqual(await status(), { fileOnly: true, syncUnavailable: "incomplete", platform: null });
  process.env.XINGZHE_REDIRECT_URI = "https://cycler.example.test/incorrect-callback";
  assert.deepEqual(await status(), { fileOnly: true, syncUnavailable: "invalid_callback", platform: null });

  process.env.XINGZHE_REDIRECT_URI = "http://localhost/api/platform/xingzhe/callback";
  assert.deepEqual(await status(), { live: true, platform: null });
  const mismatched = request("/api/platform", cookie, { provider: "xingzhe", action: "connect", from: "import" });
  mismatched.headers.set("Origin", "http://192.168.31.170:3001");
  const refused = await platform(mismatched);
  assert.equal(refused.status, 409);
  const problem = await refused.json();
  assert.match(problem.error, /回调域名不一致/);
  assert.equal(problem.connectionUrl, "http://localhost/connections/xingzhe?from=import");
});

test("行者 callback distinguishes token rejection from profile permission without logging vendor messages", async t => {
  const config = {
    SESSION_SECRET: "local-sync-test-secret-with-32-characters",
    XINGZHE_SYNC_ENABLED: "true",
    XINGZHE_CLIENT_ID: "browser-check-client",
    XINGZHE_CLIENT_SECRET: "browser-check-secret",
    XINGZHE_REDIRECT_URI: "http://localhost/api/platform/xingzhe/callback",
  };
  const original = new Map(Object.keys(config).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, config);
  const cookie = await register("oauth-diagnostics@example.test");
  let failToken = true;
  let malformedProfile = false;
  const vendorDetail = "sensitive-vendor-diagnostic-fixture";
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    if (url.pathname === "/oauth2/v2/access_token/") {
      return failToken
        ? Response.json({ error: "invalid_grant", error_description: vendorDetail }, { status: 400 })
        : Response.json({ access_token: vendorDetail });
    }
    assert.equal(url.pathname, "/openapi/v1/athlete/info/");
    return malformedProfile
      ? Response.json({ data: { uid: vendorDetail } })
      : Response.json({ code: 401, msg: vendorDetail }, { status: 401 });
  });
  const warning = t.mock.method(console, "warn", () => {});
  async function attempt() {
    const initiated = await platform(request("/api/platform", cookie, { provider: "xingzhe", action: "connect" }));
    const state = new URL((await initiated.json()).authorizationUrl).searchParams.get("state");
    const result = await callback(request(`/api/platform/xingzhe/callback?state=${state}&code=test-code`, cookie));
    return result.headers.get("Location");
  }
  assert.equal(await attempt(), "/connections/xingzhe?oauth=invalid_code");
  failToken = false;
  assert.equal(await attempt(), "/connections/xingzhe?oauth=profile_rejected");
  malformedProfile = true;
  assert.equal(await attempt(), "/connections/xingzhe?oauth=profile_failed");
  const diagnostics = warning.mock.calls.map(call => call.arguments[0]).join("\n");
  assert.match(diagnostics, /"stage":"token".*"upstreamStatus":400/);
  assert.match(diagnostics, /"stage":"profile".*"upstreamStatus":401/);
  assert.match(diagnostics, /"responseIssue":"missing_profile_id".*"data.uid:string"/);
  assert.ok(!diagnostics.includes(vendorDetail));
  assert.ok(!diagnostics.includes("test-code"));
});

test("行者 sync upgrades summaries with FIT, deduplicates, refreshes, and stops on disconnect", { timeout: 8000 }, async t => {
  Object.assign(process.env, {
    SESSION_SECRET: "local-sync-test-secret-with-32-characters",
    XINGZHE_SYNC_ENABLED: "true",
    XINGZHE_CLIENT_ID: "cycler-test-client",
    XINGZHE_CLIENT_SECRET: "test-only-client-secret",
    XINGZHE_REDIRECT_URI: "http://localhost/api/platform/xingzhe/callback",
  });
  const a = await register("oauth-a@example.test");
  const b = await register("oauth-b@example.test");
  const login = await account(request("/api/account", "", { action: "login", email: "oauth-a@example.test", password: "test cycling account" }));
  assert.equal(login.status, 200);
  const anotherSession = login.headers.get("set-cookie")!.split(";")[0];
  const ownerId = getRequestSession(request("/", a))!.userId;
  const repository = getApplicationRepository();
  const action = (cookie: string, type: string, context?: object) => platform(request("/api/platform", cookie, { provider: "xingzhe", action: type, ...context }));
  async function status(cookie: string) {
    return (await getPlatform(request("/api/platform?provider=xingzhe", cookie))).json();
  }
  let exchanges = 0;
  let refreshes = 0;
  let listRequests = 0;
  let fitRequests = 0;
  let fitAvailable = false;
  let includeUnseenRide = false;
  let upstreamRateLimited = false;
  let holdListRequest = false;
  const heldRequest = Promise.withResolvers<AbortSignal>();
  const start = Date.parse("2026-11-20T06:00:00Z");
  const activity = { id: 101, sport: 3, start_time: start, end_time: start + 3_600_000, distance: 25_000 };
  const fit = await readFile(new URL("../test-data/demo-imported-rides/demo-ride-2026-08-20.fit", import.meta.url));
  const signedFitUrl = "https://xingzhe-workout.oss-cn-hangzhou.aliyuncs.com/files/cycling.fit?signature=fixture";
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    const authorization = new Headers(init.headers).get("Authorization");
    if (input.href === signedFitUrl) {
      assert.equal(authorization, null);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      return new Response(new Uint8Array(fit));
    }
    assert.equal(input.origin, "https://www.imxingzhe.com");
    if (input.pathname === "/oauth2/v2/access_token/") {
      const body = init.body as FormData;
      assert.equal(authorization, "Bearer cycler-test-client:test-only-client-secret");
      if (body.get("grant_type") === "refresh_token") {
        refreshes++;
        assert.equal(body.get("refresh_token"), "initial-refresh-test-token");
        return Response.json({ access_token: "fresh-access-test-token", refresh_token: "rotated-refresh-test-token", expires_in: 3600 });
      }
      exchanges++;
      assert.equal(body.get("code"), "test-code");
      return Response.json({ access_token: "initial-access-test-token", refresh_token: "initial-refresh-test-token", expires_in: 1 });
    }
    if (input.pathname === "/openapi/v1/athlete/info/") {
      assert.equal(authorization, "Bearer initial-access-test-token");
      return Response.json({ code: 200, data: { id: 4242 } });
    }
    if (input.pathname === "/api/v1/workout/101/fit/") {
      assert.equal(authorization, "Bearer fresh-access-test-token");
      assert.equal(init.redirect, "manual");
      fitRequests++;
      return Response.redirect(fitAvailable ? signedFitUrl : "https://untrusted.example.test/record.fit", 302);
    }
    assert.equal(input.pathname, "/openapi/v1/activities/");
    assert.equal(authorization, "Bearer fresh-access-test-token");
    listRequests++;
    if (upstreamRateLimited) return new Response(null, { status: 429, headers: { "Retry-After": "120" } });
    if (holdListRequest) {
      const signal = AbortSignal.any([init.signal!, t.signal]);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        heldRequest.resolve(signal);
      });
    }
    const results = [activity, { ...activity, id: 102, sport: 2 }, { ...activity, id: 103, distance: -1 }];
    if (includeUnseenRide) results.push({ ...activity, id: 104 });
    return Response.json({ next: null, count: results.length, results });
  });
  assert.equal((await status("")).requiresAccount, true);
  assert.equal((await action("", "connect")).status, 401);
  async function begin() {
    const response = await action(a, "connect", { from: "chat", conversationId: "ride-conversation" });
    assert.equal(response.status, 200);
    const authorization = new URL((await response.json()).authorizationUrl);
    assert.equal(authorization.pathname, "/oauth2/v2/authorize");
    assert.equal(authorization.searchParams.get("scope"), "read");
    return authorization.searchParams.get("state");
  }
  function finish(cookie: string, state: string | null) {
    return callback(request(`/api/platform/xingzhe/callback?code=test-code&state=${state}`, cookie));
  }
  const state = await begin();
  assert.equal((await finish(b, state)).headers.get("Location"), "/connections/xingzhe?oauth=invalid");
  assert.equal((await finish(anotherSession, state)).headers.get("Location"), "/connections/xingzhe?oauth=invalid");
  assert.equal(exchanges, 0);
  const completed = await finish(a, state);
  assert.equal(completed.status, 303);
  assert.equal(completed.headers.get("Location"), "/connections/xingzhe?from=chat&conversation=ride-conversation&oauth=connected");
  assert.equal((await finish(a, state)).headers.get("Location"), "/connections/xingzhe?oauth=invalid");
  assert.equal(exchanges, 1);
  assert.equal(listRequests, 0);
  assert.equal((await status(a)).platform.status, "connected");
  assert.equal((await status(b)).platform, null);
  assert.equal((await action(b, "sync")).status, 409);
  assert.equal((await action(b, "reimport-deleted")).status, 409);
  assert.doesNotMatch(await readFile(repository.filePath, "utf8"), /(?:initial|rotated|fresh)-(?:refresh|access)-test-token/);

  const responses = await Promise.all([action(a, "sync"), action(a, "sync")]);
  const [sync, concurrent] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(sync, concurrent);
  assert.equal(refreshes, 1);
  assert.equal(listRequests, 1);
  assert.deepEqual(sync.platform.result, { added: 1, duplicate: 0, failed: 1, skippedDeleted: 0, summaryOnly: 1, rideIds: [sync.platform.result.rideIds[0]] });
  assert.ok(fetchMock.mock.calls.every(call => {
    const url = call.arguments[0];
    return !(url instanceof URL) || url.hostname !== "untrusted.example.test";
  }));
  const id = sync.platform.result.rideIds[0];
  const record = (await repository.getRide(ownerId, id))!;
  assert.equal(record.activity.source.kind, "platform_summary");
  assert.equal(record.activity.metrics.elapsedTimeS?.value, 3600);
  assert.deepEqual(record.series.points, []);
  assert.match(buildRidePageViewModelFromRecord(record).rideMeta.sourceLabel, /行者.*摘要/);
  assert.deepEqual((await (await summaries(request(`/api/rides/summary?id=${id}`, b))).json()).rides, []);

  fitAvailable = true;
  const updated = await (await action(a, "sync")).json();
  assert.deepEqual(updated.platform.result, { added: 0, updated: 1, duplicate: 0, failed: 1, skippedDeleted: 0, rideIds: [id] });
  const fullRecord = (await repository.getRide(ownerId, id))!;
  assert.deepEqual([fullRecord.activity.source.kind, fullRecord.activity.source.platformId], ["fit", "xingzhe"]);
  assert.equal(fullRecord.series.rideId, id);
  assert.ok(fullRecord.series.availableSeries.includes("speed"));
  assert.ok(fullRecord.series.points.length > 0);
  assert.ok(!("fileName" in fullRecord.activity.source));
  assert.equal((await (await action(a, "sync")).json()).platform.result.duplicate, 1);
  assert.equal((await repository.listRides(ownerId)).length, 1);
  assert.equal(fitRequests, 2);
  upstreamRateLimited = true;
  await action(a, "sync");
  const throttled = await action(a, "sync");
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get("Retry-After")) > 0);
  assert.equal((await action(a, "disconnect")).status, 200);
  assert.equal((await status(a)).platform, null);
  assert.equal((await action(a, "sync")).status, 409);
  assert.equal((await repository.listRides(ownerId)).length, 1);

  upstreamRateLimited = false;
  const reconnect = await begin();
  await finish(a, reconnect);
  await repository.deleteRide(ownerId, id);
  const skipped = (await (await action(a, "sync")).json()).platform.result;
  assert.equal(skipped.duplicate, 0);
  assert.equal(skipped.skippedDeleted, 1);
  assert.equal((await repository.listRides(ownerId)).length, 0);
  assert.equal(fitRequests, 2);
  includeUnseenRide = true;
  const reimported = (await (await action(a, "reimport-deleted")).json()).platform.result;
  assert.deepEqual(reimported, { added: 1, duplicate: 0, failed: 0, skippedDeleted: 0, rideIds: [reimported.rideIds[0]] });
  assert.notEqual(reimported.rideIds[0], id);
  assert.equal((await repository.getRide(ownerId, reimported.rideIds[0]))?.activity.source.kind, "fit");
  assert.equal((await (await action(a, "reimport-deleted")).json()).platform.result.added, 0);
  assert.equal((await repository.listRides(ownerId)).length, 1);
  assert.equal(fitRequests, 3);
  includeUnseenRide = false;
  await repository.deleteRide(ownerId, reimported.rideIds[0]);

  holdListRequest = true;
  const interrupted = action(a, "sync");
  const signal = await heldRequest.promise;
  assert.equal((await action(a, "reimport-deleted")).status, 409);
  assert.equal((await action(a, "disconnect")).status, 200);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await (await interrupted).json(), { live: true, platform: null });
  assert.equal((await status(a)).platform, null);
  assert.deepEqual(await repository.listRides(ownerId), []);
});
