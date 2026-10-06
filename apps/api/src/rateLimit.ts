export interface RateLimitOptions { limit: number; windowMs: number; now?: () => number }
export interface RateLimitDecision { allowed: boolean; remaining: number; retryAfterSeconds?: number }

export class InMemoryRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly options: RateLimitOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || !Number.isFinite(options.windowMs) || options.windowMs < 1) {
      throw new RangeError("Rate limit and window must be positive.");
    }
  }
  take(key: string): RateLimitDecision {
    const now = (this.options.now ?? Date.now)();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.options.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, remaining: this.options.limit - 1 };
    }
    if (current.count >= this.options.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((this.options.windowMs - (now - current.startedAt)) / 1000)) };
    }
    current.count += 1;
    return { allowed: true, remaining: this.options.limit - current.count };
  }
}
