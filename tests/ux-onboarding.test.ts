import "./helpers/route-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { GET, PUT } from "../app/api/profile/route.ts";
import { PUT as ux } from "../app/api/ux/route.ts";
import { isProfileProposalInput } from "../src/chat/chat-user-capabilities.ts";

test("clear and blank mode persist without reseeding; goal updates preserve profile", async () => {
  const initial = await GET(new Request("http://localhost/api/profile"));
  const cookie = initial.headers.get("set-cookie")!.split(";", 1)[0];
  const request = (body: unknown) => new Request("http://localhost/api/profile", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await PUT(request({ age: null, heightCm: null, weightKg: null, maxHeartRateBpm: null, ftpWatts: null }));
  const cleared = await (await GET(new Request("http://localhost/api/profile", { headers: { Cookie: cookie } }))).json();
  assert.equal(cleared.age, undefined);
  await ux(request({ action: "blank" }));
  await PUT(request({ age: 31, weightKg: 71 }));
  const goal = await ux(request({ action: "goal", goal: { title: "提升耐力", detail: "100 km" } }));
  const profile = await goal.json();
  assert.equal(profile.age.value, 31);
  assert.equal(profile.ux.mode, "blank");
  assert.equal(profile.ux.goal.detail, "100 km");
  const invalid = await ux(request({ action: "goal", goal: { title: "", detail: "" } }));
  assert.equal(invalid.status, 422);
});

test("profile proposal parameters use domain ranges and exact fields without interpreting language", () => {
  assert.equal(isProfileProposalInput({ age: 31, weightKg: 71, ftpWatts: 220 }), true);
  assert.equal(isProfileProposalInput({ ftpWatts: null }), true);
  for (const input of [{}, { age: 999 }, { weightKg: "71" }, { ownerId: "other", weightKg: 71 }, { ftpWatts: NaN }]) assert.equal(isProfileProposalInput(input), false);
});

test("blank prototype view hides earlier rides and keeps subsequent imports; demo restores them", async () => {
  const { withDemoImportedRides } = await import("../src/persistence/demo-ride-repository.ts");
  const { createUserProfile } = await import("../src/domain/user-profile.ts");
  const profile = createUserProfile();
  profile.ux = { mode: "blank", blankSince: "2026-11-01T01:00:00Z" };
  const base = {
    async getProfile() { return profile; },
    async listRides() { return [{ storedAt: "2026-10-31T00:00:00Z", record: { activity: { rideId: "old" } } }, { storedAt: "2026-11-01T02:00:00Z", record: { activity: { rideId: "new" } } }]; },
  } as unknown as import("../src/persistence/application-repository.ts").ApplicationRepository;
  const view = withDemoImportedRides(base);
  assert.deepEqual((await view.listRides("owner")).map(e => e.record.activity.rideId), ["new"]);
  profile.ux.mode = "demo";
  assert.equal((await view.listRides("owner")).length, 2);
});
