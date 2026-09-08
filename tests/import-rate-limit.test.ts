import assert from "node:assert/strict";
import test from "node:test";

import { ImportRateLimiter } from "../src/imports/import-rate-limit.ts";

test("sliding window allows up to max imports inside the window and reports retry-after", () => {
  const limiter = new ImportRateLimiter(3, 60_000);
  const t0 = 1_000_000;

  assert.deepEqual(limiter.check("owner-a", t0), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check("owner-a", t0 + 10_000), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check("owner-a", t0 + 20_000), { allowed: true, retryAfterSeconds: 0 });

  const denied = limiter.check("owner-a", t0 + 30_000);
  assert.equal(denied.allowed, false);
  // 最早一次命中在 t0，窗口 60s，在 t0+30s 被拒后需等待约 30s。
  assert.equal(denied.retryAfterSeconds, 30);
});

test("rate limit windows slide: old hits expire and the owner can import again", () => {
  const limiter = new ImportRateLimiter(2, 60_000);
  const t0 = 5_000_000;

  assert.equal(limiter.check("owner-a", t0).allowed, true);
  assert.equal(limiter.check("owner-a", t0 + 1_000).allowed, true);
  assert.equal(limiter.check("owner-a", t0 + 2_000).allowed, false);

  // t0 的命中滑出窗口后恢复配额。
  assert.equal(limiter.check("owner-a", t0 + 60_001).allowed, true);
});

test("rate limit is scoped per owner and does not leak across sessions", () => {
  const limiter = new ImportRateLimiter(1, 60_000);
  const t0 = 9_000_000;

  assert.equal(limiter.check("owner-a", t0).allowed, true);
  assert.equal(limiter.check("owner-a", t0 + 1).allowed, false);
  assert.equal(limiter.check("owner-b", t0 + 1).allowed, true);
});

test("retry-after is at least 1 second even at the window edge", () => {
  const limiter = new ImportRateLimiter(1, 60_000);
  const t0 = 2_000_000;
  limiter.check("owner-a", t0);
  const denied = limiter.check("owner-a", t0 + 59_999);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
});
