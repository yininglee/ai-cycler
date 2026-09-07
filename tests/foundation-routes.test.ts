import assert from "node:assert/strict";
import test from "node:test";

import { POST as importRide } from "../app/api/rides/import/route.ts";
import { POST as analyzeRide } from "../app/api/ride-analysis/route.ts";
import { DELETE as deleteRide } from "../app/api/rides/[id]/route.ts";
import { DELETE as deleteAccount } from "../app/api/account/route.ts";
import { GET as getConsent, PUT as saveConsent } from "../app/api/consent/route.ts";
import { getRequestSession, resolveOrCreateRequestSession } from "../src/auth/session.ts";

const GPX = `<gpx version="1.1"><trk><trkseg><trkpt lat="31.23" lon="121.47"><ele>10</ele><time>2026-08-17T06:00:00Z</time></trkpt><trkpt lat="31.23" lon="121.49"><ele>30</ele><time>2026-08-17T06:10:00Z</time></trkpt></trkseg></trk></gpx>`;
const cookie = (setCookie: string | null) => setCookie?.split(";", 1)[0] ?? "";

test("private ride access and deletion require the owning signed session", async () => {
  const form = new FormData();
  form.set("file", new Blob([GPX], { type: "application/gpx+xml" }), "owned.gpx");
  const imported = await importRide(new Request("http://localhost/api/rides/import", { method: "POST", body: form }));
  const rideId = (await imported.json() as { rideId: string }).rideId;
  const ownerCookie = cookie(imported.headers.get("set-cookie"));
  const otherSession = resolveOrCreateRequestSession(new Request("http://localhost"));
  const analysis = await analyzeRide(new Request("http://localhost/api/ride-analysis", {
    method: "POST", headers: { Cookie: otherSession.setCookie!.split(";", 1)[0], "Content-Type": "application/json" }, body: JSON.stringify({ rideId }),
  }));
  assert.equal(analysis.status, 400);
  assert.deepEqual(await analysis.json(), { error: "UNKNOWN_RIDE" });
  const deletedByOther = await deleteRide(new Request("http://localhost/api/rides/" + rideId, { headers: { Cookie: otherSession.setCookie!.split(";", 1)[0] } }), { params: Promise.resolve({ id: rideId }) });
  assert.equal(deletedByOther.status, 404);
  const deleted = await deleteRide(new Request("http://localhost/api/rides/" + rideId, { headers: { Cookie: ownerCookie } }), { params: Promise.resolve({ id: rideId }) });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true });
});

test("account deletion clears the session and is idempotent for private data", async () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const request = new Request("http://localhost/api/account", { headers: { Cookie: session.setCookie!.split(";", 1)[0] } });
  const response = await deleteAccount(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie")?.includes("Max-Age=0"), true);
  const second = await deleteAccount(request);
  assert.equal(second.status, 200);
});

test("consent is private metadata and account deletion removes it", async () => {
  const initial = await getConsent(new Request("http://localhost/api/consent"));
  const ownerCookie = cookie(initial.headers.get("set-cookie"));
  assert.equal(await initial.json(), null);
  const saved = await saveConsent(new Request("http://localhost/api/consent", {
    method: "PUT", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ accepted: true }),
  }));
  assert.equal(saved.status, 200);
  const consent = await saved.json() as { policyVersion: string; acceptedAt: string };
  assert.equal(consent.policyVersion, "privacy-v1");
  assert.equal(Number.isNaN(Date.parse(consent.acceptedAt)), false);
  const other = await getConsent(new Request("http://localhost/api/consent"));
  assert.equal(await other.json(), null);
  const removed = await deleteAccount(new Request("http://localhost/api/account", { headers: { Cookie: ownerCookie } }));
  assert.equal(removed.status, 200);
  const afterDeletion = await getConsent(new Request("http://localhost/api/consent", { headers: { Cookie: ownerCookie } }));
  assert.equal(await afterDeletion.json(), null);
});

test("OIDC mode rejects development cookies instead of creating a shared identity", () => {
  const session = resolveOrCreateRequestSession(new Request("http://localhost"));
  const previous = process.env.AUTH_SESSION_MODE;
  process.env.AUTH_SESSION_MODE = "oidc";
  try {
    assert.equal(getRequestSession(new Request("http://localhost", { headers: { Cookie: session.setCookie!.split(";", 1)[0] } })), null);
    assert.throws(() => resolveOrCreateRequestSession(new Request("http://localhost")), { message: "OIDC session adapter is not configured" });
  } finally {
    if (previous === undefined) delete process.env.AUTH_SESSION_MODE;
    else process.env.AUTH_SESSION_MODE = previous;
  }
});
