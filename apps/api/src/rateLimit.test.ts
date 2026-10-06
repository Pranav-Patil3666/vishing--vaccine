import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRateLimiter } from "./rateLimit.js";

test("in-memory limiter allows within the window, rejects over limit, and resets", () => {
  let now = 1_000;
  const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
  assert.equal(limiter.take("k").allowed, true);
  assert.equal(limiter.take("k").allowed, true);
  const rejected = limiter.take("k");
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 1);
  now += 1_000;
  assert.equal(limiter.take("k").allowed, true);
});
