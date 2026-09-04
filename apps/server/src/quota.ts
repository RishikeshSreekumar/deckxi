/**
 * Abuse and cost quotas (#87).
 *
 * The per-socket token buckets in `rateLimit.ts` stop one connection shouting.
 * They do nothing about the three things that actually cost us money or ruin
 * a Saturday: a script opening hundreds of sockets, a script creating rooms
 * until the process is full, and a script sweeping the six-character join-code
 * space (or the magic-link endpoint, where every request is an email we pay
 * for). Those are counted per *source*, not per socket, and survive the socket
 * being closed and reopened.
 *
 * A source is the account id when there is one and the client IP otherwise.
 * Accounts are cheap to make, so the IP is still counted alongside — an
 * attacker who signs up a hundred guests hits the IP ceiling anyway.
 *
 * Counters live in memory. That is the honest shape for a single instance
 * (#86 externalizes room state to Redis; these move with it), and the failure
 * mode of a restart is a quota window resetting, not a security hole.
 */

/** How long a window lasts and how much fits in it. */
export interface QuotaRule {
  limit: number;
  windowMs: number;
}

export interface QuotaConfig {
  /** Sockets open at once from one IP. Several tabs and a phone are normal; a hundred are not. */
  connectionsPerIp: number;
  /** Rooms created per source. A host opening a table per game is nowhere near this. */
  createRooms: QuotaRule;
  /** Failed joins per source — the signal for someone guessing join codes. */
  failedJoins: QuotaRule;
  /** Requests to the auth endpoints per IP. Every magic link is an email we pay to send. */
  authRequests: QuotaRule;
}

export const DEFAULT_QUOTAS: QuotaConfig = {
  connectionsPerIp: 24,
  createRooms: { limit: 30, windowMs: 60 * 60 * 1000 },
  failedJoins: { limit: 20, windowMs: 10 * 60 * 1000 },
  authRequests: { limit: 20, windowMs: 10 * 60 * 1000 },
};

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter per key. Fixed rather than sliding on purpose: the
 * numbers here are ceilings for scripts, not fine-grained fairness, and a
 * fixed window costs one object per key instead of a list of timestamps.
 */
export class QuotaCounter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly rule: QuotaRule) {}

  /** Count one use. False means the key is over its limit for this window. */
  take(key: string, now: number = Date.now()): boolean {
    const window = this.windows.get(key);
    if (window === undefined || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.rule.windowMs });
      return true;
    }
    window.count += 1;
    return window.count <= this.rule.limit;
  }

  /** Current count without recording a use — the abuse signal reads this. */
  count(key: string, now: number = Date.now()): number {
    const window = this.windows.get(key);
    if (window === undefined || now >= window.resetAt) return 0;
    return window.count;
  }

  /** Drop expired windows. Called on a timer so an idle key cannot leak. */
  prune(now: number = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

/** Live socket counts per IP. Incremented on connect, decremented on close. */
export class ConnectionCounter {
  private readonly open = new Map<string, number>();

  constructor(private readonly max: number) {}

  /** Register a connection; false means this IP already holds the maximum. */
  add(ip: string): boolean {
    if (isLoopback(ip)) return true;
    const current = this.open.get(ip) ?? 0;
    if (current >= this.max) return false;
    this.open.set(ip, current + 1);
    return true;
  }

  remove(ip: string): void {
    if (isLoopback(ip)) return;
    const current = this.open.get(ip) ?? 0;
    if (current <= 1) this.open.delete(ip);
    else this.open.set(ip, current - 1);
  }

  count(ip: string): number {
    return this.open.get(ip) ?? 0;
  }

  get size(): number {
    return this.open.size;
  }
}

/**
 * Everything above, wired together and named. One instance per process; the
 * socket layer and the HTTP layer share it, because an abusive client does
 * not politely use one door.
 */
export class Quotas {
  readonly connections: ConnectionCounter;
  readonly createRooms: QuotaCounter;
  readonly failedJoins: QuotaCounter;
  readonly authRequests: QuotaCounter;
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly config: QuotaConfig = DEFAULT_QUOTAS) {
    this.connections = new ConnectionCounter(config.connectionsPerIp);
    this.createRooms = new QuotaCounter(config.createRooms);
    this.failedJoins = new QuotaCounter(config.failedJoins);
    this.authRequests = new QuotaCounter(config.authRequests);
  }

  /**
   * Sweep expired windows every five minutes. Unref'd: a counter cleanup is
   * never a reason to keep the process alive.
   */
  startSweeper(intervalMs = 5 * 60 * 1000): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.prune();
    }, intervalMs);
    this.timer.unref();
  }

  stopSweeper(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  prune(now: number = Date.now()): void {
    this.createRooms.prune(now);
    this.failedJoins.prune(now);
    this.authRequests.prune(now);
  }

  /**
   * Has this source behaved like a script? Right now that means sweeping join
   * codes: a human mistypes a code once or twice, not fifteen times. What we
   * do about it is the caller's business — the server asks for a CAPTCHA when
   * one is configured (`captcha.ts`) and otherwise just refuses.
   */
  suspicious(source: string, now: number = Date.now()): boolean {
    return this.failedJoins.count(source, now) >= Math.ceil(this.config.failedJoins.limit / 2);
  }
}

/**
 * The key a quota counts against: the account when we know it, the IP
 * otherwise. Both are checked for room creation, so signing up a fresh guest
 * per room buys nothing.
 */
export function quotaKeys(userId: string | null, ip: string): string[] {
  return userId === null ? [`ip:${ip}`] : [`user:${userId}`, `ip:${ip}`];
}

/**
 * Loopback is us: health checks, the dev client, the test suite, and (where a
 * sidecar proxy terminates TLS) the proxy itself. Never counted against the
 * connection ceiling — a real client's address arrives in `x-forwarded-for`
 * and is counted there.
 */
export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";
}

/**
 * The client's address. Behind Cloud Run / Fly / Cloudflare the socket peer is
 * a proxy, so the forwarded header is the only useful value — and it is
 * attacker-controlled, which is why the *first* entry (the one the edge
 * appends for the real client) is taken and nothing else in the chain is
 * trusted.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  fallback: string | undefined,
): string {
  const forwarded = headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return fallback ?? "unknown";
}
