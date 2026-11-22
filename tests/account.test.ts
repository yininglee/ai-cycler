import "./helpers/route-test-env.ts";
import { strict as assert } from "node:assert";
import test from "node:test";
import { POST as account, DELETE as deleteAccount } from "../app/api/account/route.ts";
import { GET as readProfile, PUT as saveProfile } from "../app/api/profile/route.ts";
import { GET as summaries } from "../app/api/rides/summary/route.ts";
import { POST as importRide } from "../app/api/rides/import/route.ts";
import { GET as platformStatus } from "../app/api/platform/route.ts";
import { getRequestSession, resolveOrCreateRequestSession } from "../src/auth/session.ts";
import { getApplicationRepository } from "../src/persistence/application-repository.ts";
import { TrainingPlanStore } from "../src/persistence/training-plan-store.ts";
import { scopedBrowserKey } from "../src/auth/browser-scope.ts";

const password = "paper-horse-cycling";
const gpx = '<gpx><trk><trkseg><trkpt lat="31" lon="121"><time>2026-10-01T06:00:00Z</time></trkpt><trkpt lat="31" lon="121.02"><time>2026-10-01T06:07:00Z</time></trkpt></trkseg></trk></gpx>';
const cookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0];
function request(path: string, session = "", body?: unknown, method = body ? "POST" : "GET") {
  return new Request(`http://localhost${path}`, {
    method, headers: { Cookie: session, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("native account forms POST credentials and redirect without putting them in the URL", async () => {
  const email = "native-login@example.test";
  const destination = "/connections/xingzhe?from=import";
  function form(fields: Record<string, string>, session = "", site = "same-origin") {
    return new Request("http://localhost/api/account", {
      method: "POST",
      headers: { "Sec-Fetch-Site": site, Cookie: session },
      body: new URLSearchParams(fields),
    });
  }
  const credentials = { email, password, returnTo: destination };
  const denied = await account(form({ ...credentials, action: "register" }, "", "cross-site"));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has("Set-Cookie"), false);

  const registered = await account(form({ ...credentials, action: "register" }));
  assert.equal(registered.status, 303);
  assert.equal(registered.headers.get("Location"), destination);
  const session = cookie(registered);
  assert.equal(getRequestSession(request("/", session))?.accountEmail, email);

  const signedOut = await account(form({ action: "logout", returnTo: destination }, session));
  assert.equal(signedOut.status, 303);
  assert.equal(signedOut.headers.get("Location"), "/account");
  assert.equal(getRequestSession(request("/", session)), null);

  const invalid = await account(form({ ...credentials, action: "login", password: "an invalid test password" }));
  assert.equal(invalid.status, 303);
  const retry = new URL(invalid.headers.get("Location")!, "http://localhost");
  assert.equal(retry.pathname, "/account");
  assert.deepEqual(Object.fromEntries(retry.searchParams), { returnTo: destination, error: "credentials" });
  assert.equal(invalid.headers.has("Set-Cookie"), false);

  const loggedIn = await account(form({ ...credentials, action: "login", returnTo: "//elsewhere.test" }));
  assert.equal(loggedIn.status, 303);
  assert.equal(loggedIn.headers.get("Location"), "/chat");
  assert.equal(getRequestSession(request("/", cookie(loggedIn)))?.accountEmail, email);
});

test("registration, cross-device login, private data, and session revocation", async () => {
  const email = "Rider-A@example.test";
  const guestCookie = resolveOrCreateRequestSession(request("/")).setCookie!.split(";")[0];
  await saveProfile(request("/api/profile", guestCookie, { age: 43 }, "PUT"));
  const registered = await account(request("/api/account", guestCookie, { action: "register", email, password }));
  assert.equal(registered.status, 201);
  assert.match(registered.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
  const first = cookie(registered);
  const owner = getRequestSession(request("/", first))!;
  assert.equal(owner.accountEmail, email.toLowerCase());
  assert.equal((await (await readProfile(request("/api/profile", first))).json()).age, undefined);
  assert.equal((await (await readProfile(request("/api/profile", guestCookie))).json()).age.value, 43);
  assert.equal((await account(request("/api/account", "", { action: "register", email: email.toLowerCase(), password }))).status, 409);
  assert.equal((await account(request("/api/account", "", { action: "login", email, password: password + "x" }))).status, 401);

  const second = cookie(await account(request("/api/account", "", { action: "login", email, password })));
  assert.notEqual(first, second);
  assert.equal(getRequestSession(request("/", second))?.userId, owner.userId);
  const other = cookie(await account(request("/api/account", "", { action: "register", email: "rider-b@example.test", password })));
  const otherOwner = getRequestSession(request("/", other))!.userId;
  assert.equal((await saveProfile(request("/api/profile", first, { age: 34 }, "PUT"))).status, 200);
  assert.equal((await (await readProfile(request("/api/profile", second))).json()).age.value, 34);
  assert.equal((await (await readProfile(request("/api/profile", other))).json()).age, undefined);

  const form = new FormData();
  form.set("file", new File([gpx], "ride.gpx", { type: "application/gpx+xml" }));
  const imported = await importRide(new Request("http://localhost/api/rides/import", { method: "POST", headers: { Cookie: first }, body: form }));
  assert.equal(imported.status, 201);
  const { rideId } = await imported.json();
  const url = `/api/rides/summary?id=${rideId}`;
  assert.equal((await (await summaries(request(url, second))).json()).rides.length, 1);
  assert.deepEqual((await (await summaries(request(url, other))).json()).rides, []);
  assert.deepEqual((await (await summaries(request(url, guestCookie))).json()).rides, []);

  const repository = getApplicationRepository();
  for (const [id, value] of [[owner.userId, "one"], [otherOwner, "two"]]) {
    await repository.saveAnalysisRun(id, "common-ride", { value });
  }
  assert.deepEqual((await repository.getAnalysisRun(owner.userId, "common-ride"))?.result, { value: "one" });
  assert.deepEqual((await repository.getAnalysisRun(otherOwner, "common-ride"))?.result, { value: "two" });
  const plans = new TrainingPlanStore();
  assert.notEqual((await plans.read(owner.userId)).id, (await plans.read(otherOwner)).id);
  assert.equal((await platformStatus(request("/api/platform?provider=onelap", other))).status, 200);
  assert.notEqual(scopedBrowserKey("chat", owner.userId), scopedBrowserKey("chat", otherOwner));

  assert.equal((await account(request("/api/account", first, { action: "logout" }))).status, 200);
  assert.equal(getRequestSession(request("/", first)), null);
  assert.equal((await summaries(request(url, first))).status, 401);
  assert.equal((await deleteAccount(request("/api/account", second, undefined, "DELETE"))).status, 200);
  assert.equal(getRequestSession(request("/", second)), null);
  assert.equal(await repository.getRide(owner.userId, rideId), null);
  assert.equal(await repository.getAnalysisRun(owner.userId, "common-ride"), null);
  assert.deepEqual((await repository.getAnalysisRun(otherOwner, "common-ride"))?.result, { value: "two" });
});
