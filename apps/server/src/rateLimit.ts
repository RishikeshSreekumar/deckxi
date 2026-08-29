/**
 * Token-bucket rate limiter: `capacity` is the burst budget, `refillPerSec`
 * the sustained rate. Cheap enough for one bucket per socket per class.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  tryTake(now: number = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export const DEFAULT_LIMITS = {
  /** Every inbound message, any type — a hard abuse ceiling per socket. */
  global: { capacity: 30, refillPerSec: 10 },
  chat: { capacity: 5, refillPerSec: 0.5 },
  reactions: { capacity: 8, refillPerSec: 1 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimits = { [K in keyof typeof DEFAULT_LIMITS]: RateLimitConfig };
