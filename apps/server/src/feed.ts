/**
 * Live event feed (#68) — the last few hundred things that happened, in
 * memory, for the admin dashboard to poll.
 *
 * It is a **tee off the logger**, not a second instrumentation pass. Every
 * `log.info({ event: "..." })` call already made for #65 becomes a feed entry
 * with its correlation ids attached, which means the feed and the logs can
 * never disagree about what happened, and a new logged event shows up in the
 * dashboard for free. Lines without an `event` field — Fastify's own request
 * logging, mostly — are skipped: the feed is about the game, not about HTTP.
 *
 * Bounded on purpose. A ring buffer of 500 entries with truncated values costs
 * a few hundred KB at worst and can never grow; the durable record is the log
 * stream, which is retained. Losing the tail of a busy minute in the dashboard
 * is not a real loss when `gcloud logging read` has all of it.
 */
import type { Logger } from "./logging.js";

export interface FeedEntry {
  /** Monotonic across the process; the dashboard's polling cursor. */
  seq: number;
  at: number;
  level: string;
  event: string;
  message: string | null;
  fields: Record<string, string | number | boolean | null>;
}

const DEFAULT_CAPACITY = 500;
/** No single field is worth more than this in a dashboard row. */
const MAX_VALUE_LENGTH = 200;

function flatten(fields: object): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "event") continue;
    if (value === null || value === undefined) out[key] = null;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, MAX_VALUE_LENGTH);
    else if (value instanceof Error) out[key] = value.message.slice(0, MAX_VALUE_LENGTH);
    else out[key] = JSON.stringify(value)?.slice(0, MAX_VALUE_LENGTH) ?? "";
  }
  return out;
}

export class EventFeed {
  private readonly entries: FeedEntry[] = [];
  private nextSeq = 1;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  push(level: string, fields: object, message?: string): void {
    const event = (fields as { event?: unknown }).event;
    if (typeof event !== "string") return;
    this.entries.push({
      seq: this.nextSeq++,
      at: Date.now(),
      level,
      event,
      message: message ?? null,
      fields: flatten(fields),
    });
    if (this.entries.length > this.capacity)
      this.entries.splice(0, this.entries.length - this.capacity);
  }

  /**
   * Entries after `since`, oldest first. A cursor pointing at entries that
   * have already scrolled out returns what is left rather than nothing —
   * the dashboard would rather show a gap than freeze.
   */
  since(cursor = 0, limit = 200, roomId?: string): { entries: FeedEntry[]; cursor: number } {
    let entries = this.entries.filter((e) => e.seq > cursor);
    if (roomId !== undefined) entries = entries.filter((e) => e.fields["roomId"] === roomId);
    if (entries.length > limit) entries = entries.slice(-limit);
    return { entries, cursor: this.entries.at(-1)?.seq ?? cursor };
  }
}

/**
 * A logger that writes through to `base` and copies structured events into the
 * feed. Child bindings are merged in, so a line logged on a socket's child
 * logger keeps its roomId in the feed too.
 */
export function teeLogger(base: Logger, feed: EventFeed, bindings: object = {}): Logger {
  const write =
    (level: "debug" | "info" | "warn" | "error") =>
    (fields: object, message?: string): void => {
      base[level](fields, message);
      feed.push(level, { ...bindings, ...fields }, message);
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (extra) => teeLogger(base.child(extra), feed, { ...bindings, ...extra }),
  };
}
