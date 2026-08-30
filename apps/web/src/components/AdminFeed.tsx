/**
 * Live event feed (#68) — the tail of the server's own structured log,
 * newest first, optionally narrowed to one room.
 *
 * Cursor-based polling: each request asks for everything after the last seq
 * seen, so a slow tab or a backgrounded one catches up instead of missing
 * events. The buffer on the server is bounded, so a tab left closed for an
 * hour will have a gap — the durable record is the log stream, and the feed
 * says so rather than pretending to be it.
 */
import { useEffect, useRef, useState } from "react";
import { fetchAdminEvents, NotAdminError, type FeedEntry } from "../lib/admin.js";

const POLL_MS = 3000;
const KEEP = 200;

/** Fields already shown as the row's headline, or too noisy to repeat. */
const HEADLINE_FIELDS = new Set(["roomId", "socketId", "sessionId", "reqId"]);

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

function summarise(entry: FeedEntry): string {
  const parts = Object.entries(entry.fields)
    .filter(([key, value]) => !HEADLINE_FIELDS.has(key) && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.join(" ");
}

export function AdminFeed({ roomId }: { roomId?: string }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [denied, setDenied] = useState(false);
  const cursor = useRef(0);

  useEffect(() => {
    // A room filter changes what "everything after the cursor" means, so the
    // feed restarts rather than mixing two queries' results.
    cursor.current = 0;
    setEntries([]);
    let cancelled = false;

    const tick = (): void => {
      if (document.visibilityState !== "visible") return;
      fetchAdminEvents(cursor.current, roomId)
        .then((page) => {
          if (cancelled) return;
          cursor.current = page.cursor;
          if (page.entries.length === 0) return;
          setEntries((previous) => [...page.entries].reverse().concat(previous).slice(0, KEEP));
        })
        .catch((error: unknown) => {
          if (error instanceof NotAdminError) setDenied(true);
        });
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomId]);

  if (denied) return null;

  return (
    <section className="panel admin-feed" data-testid="admin-feed">
      <h3 className="admin-feed-title">Event feed</h3>
      {entries.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          Nothing yet. Events appear here as they happen.
        </p>
      ) : (
        <ol className="admin-feed-list">
          {entries.map((entry) => (
            <li key={entry.seq} className={`admin-feed-row admin-feed-row--${entry.level}`}>
              <span className="admin-feed-time">{time(entry.at)}</span>
              <span className="admin-feed-event">{entry.event}</span>
              <span className="admin-feed-fields">{summarise(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
