import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_PROFILE_BASELINE_TIMESTAMP,
  MAX_HEART_RATE_FORMULA_VERSION,
  ProfileValidationError,
  createUserProfile,
  demoBaselineProfile,
  deserializeUserProfile,
  estimateMaxHeartRate,
  hasAnyProfileFact,
  parseProfileInput,
  serializeUserProfile,
  updateUserProfile,
} from "../src/domain/user-profile.ts";

const T0 = "2026-08-20T08:00:00.000Z";
const T1 = "2026-08-20T09:00:00.000Z";

test("age creates a traceable estimated maximum heart rate", () => {
  const profile = createUserProfile({ age: 35 }, T0);
  assert.equal(profile.maxHeartRate?.valueBpm, 185);
  assert.equal(profile.maxHeartRate?.source, "system_estimated");
  assert.equal(profile.maxHeartRate?.formulaVersion, MAX_HEART_RATE_FORMULA_VERSION);
  assert.equal(profile.maxHeartRate?.createdAt, T0);
});

test("user maximum heart rate overrides the estimate and age changes do not overwrite it", () => {
  const initial = createUserProfile({ age: 35 }, T0);
  const overridden = updateUserProfile(initial, { maxHeartRateBpm: 192 }, T1);
  const changedAge = updateUserProfile(overridden, { age: 40 }, "2026-08-21T09:00:00.000Z");
  assert.equal(changedAge.maxHeartRate?.valueBpm, 192);
  assert.equal(changedAge.maxHeartRate?.source, "user_provided");
  assert.equal(changedAge.maxHeartRate?.formulaVersion, undefined);
});

test("clearing user maximum heart rate restores the current age estimate", () => {
  const profile = updateUserProfile(
    createUserProfile({ age: 35, maxHeartRateBpm: 192 }, T0),
    { maxHeartRateBpm: null },
    T1,
  );
  assert.equal(profile.maxHeartRate?.valueBpm, 185);
  assert.equal(profile.maxHeartRate?.source, "system_estimated");
  assert.equal(profile.maxHeartRate?.updatedAt, T1);
});

test("FTP is only created from explicit user input and is user-confirmed", () => {
  const profile = createUserProfile({ ftpWatts: 240 }, T0);
  assert.deepEqual(profile.ftp && {
    valueWatts: profile.ftp.valueWatts,
    source: profile.ftp.source,
    trustStatus: profile.ftp.trustStatus,
  }, { valueWatts: 240, source: "user_provided", trustStatus: "user_confirmed" });
  assert.equal(profile.maxHeartRate, undefined);
});

test("clearing age also clears an estimate but leaves a user value intact", () => {
  const estimated = updateUserProfile(createUserProfile({ age: 35 }, T0), { age: null }, T1);
  assert.equal(estimated.maxHeartRate, undefined);
  const userValue = updateUserProfile(createUserProfile({ age: 35, maxHeartRateBpm: 192 }, T0), { age: null }, T1);
  assert.equal(userValue.maxHeartRate?.valueBpm, 192);
});

test("range checks reject unsafe or accidental values", () => {
  assert.throws(() => createUserProfile({ age: 9 }, T0), ProfileValidationError);
  assert.throws(() => createUserProfile({ heightCm: 400 }, T0), ProfileValidationError);
  assert.throws(() => createUserProfile({ ftpWatts: 0 }, T0), ProfileValidationError);
  assert.equal(estimateMaxHeartRate(35), 185);
});

test("profile serialization round-trips and malformed data is rejected", () => {
  const profile = createUserProfile({ age: 35, heightCm: 175, weightKg: 70, ftpWatts: 240 }, T0);
  assert.deepEqual(deserializeUserProfile(serializeUserProfile(profile)), profile);
  assert.equal(deserializeUserProfile("{}"), null);
  assert.equal(deserializeUserProfile("not-json"), null);
});

test("form values preserve blank optional fields as null", () => {
  assert.deepEqual(parseProfileInput({ age: "35", heightCm: "", weightKg: "70", maxHeartRateBpm: "", ftpWatts: "240" }), {
    age: 35,
    heightCm: null,
    weightKg: 70,
    maxHeartRateBpm: null,
    ftpWatts: 240,
  });
});

test("demo baseline is fully filled, user-provided and stable", () => {
  const profile = demoBaselineProfile();
  assert.equal(profile.age?.value, 28);
  assert.equal(profile.heightCm?.value, 175);
  assert.equal(profile.weightKg?.value, 72);
  // 192 is not the 220 − 28 estimate path: it is recorded as the user's own value.
  assert.equal(profile.maxHeartRate?.valueBpm, 192);
  assert.equal(profile.maxHeartRate?.source, "user_provided");
  assert.equal(profile.ftp?.valueWatts, 220);
  assert.equal(profile.ftp?.trustStatus, "user_confirmed");
  assert.equal(profile.updatedAt, DEMO_PROFILE_BASELINE_TIMESTAMP);
  // Stable across calls: the demo page must not drift between renders.
  assert.deepEqual(demoBaselineProfile(), profile);
  // An explicit timestamp still wins, so the demo page can opt into "just now".
  assert.equal(demoBaselineProfile(T0).updatedAt, T0);
});

test("an empty profile is distinguishable from a recorded one", () => {
  assert.equal(hasAnyProfileFact(null), false);
  assert.equal(hasAnyProfileFact(createUserProfile({}, T0)), false);
  assert.equal(hasAnyProfileFact(createUserProfile({ age: 28 }, T0)), true);
  assert.equal(hasAnyProfileFact(demoBaselineProfile()), true);
});
