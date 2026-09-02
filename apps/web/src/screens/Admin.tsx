/**
 * Admin dashboard (#67) — live rooms on the running server.
 *
 * Lazy-loaded and off every player path, so none of it lands in the initial
 * bundle the mobile budget gates (#107).
 *
 * Polled, not socketed. A dashboard that refreshes every few seconds is
 * indistinguishable from a live one at this scale, and it needs no new socket
 * events, no admin room to broadcast into, and nothing that could leak room
 * state to a player's connection. Polling stops while the tab is hidden — a
 * forgotten dashboard tab must not keep a scale-to-zero instance warm.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppBar } from "../components/Chrome.js";
import { AdminFeed } from "../components/AdminFeed.js";
import { AdminOps } from "../components/AdminOps.js";
import {
  fetchAdminRooms,
  fetchAdminSession,
  NotAdminError,
  type AdminRooms,
  type AdminSession,
} from "../lib/admin.js";

const POLL_MS = 5000;

/** Poll `load` while the tab is visible; `denied` on a 404 from the server. */
export function usePolled<T>(
  load: () => Promise<T>,
  intervalMs: number,
): { data: T | null; denied: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    load()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof NotAdminError) setDenied(true);
        else setError(cause instanceof Error ? cause.message : "Request failed");
      });
  }, [load]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, denied, error, refresh };
}

/** What a non-admin sees: the same nothing the API told them. */
export function AdminNotFound() {
  return (
    <main className="screen">
      <div className="panel">
        <h2>Not found</h2>
        <p>
          There's nothing here. <Link to="/">Back to the game</Link>.
        </p>
      </div>
    </main>
  );
}

function relative(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function AdminScreen() {
  const session = usePolled<AdminSession>(fetchAdminSession, 60_000);
  const rooms = usePolled<AdminRooms>(fetchAdminRooms, POLL_MS);

  if (session.denied || rooms.denied) return <AdminNotFound />;

  return (
    <main className="screen admin" data-testid="admin-screen">
      <AppBar title="Ops" back />

      <div className="admin-summary">
        <div className="stat-tile">
          <strong>{rooms.data?.counts.rooms ?? "—"}</strong>
          <span>Rooms</span>
        </div>
        <div className="stat-tile">
          <strong>{rooms.data?.counts.games ?? "—"}</strong>
          <span>In game</span>
        </div>
      </div>

      <AdminOps />

      {rooms.error !== null && (
        <p className="hint" role="status">
          Couldn't reach the server ({rooms.error}). Retrying.
        </p>
      )}

      {rooms.data !== null && rooms.data.rooms.length === 0 ? (
        <div className="panel">
          <p style={{ margin: 0 }}>No rooms open right now.</p>
        </div>
      ) : (
        <ul className="match-list admin-rooms">
          {(rooms.data?.rooms ?? []).map((room) => (
            <li key={room.roomId} className="panel match-row admin-room">
              <span className={`match-outcome admin-phase admin-phase--${room.phase}`}>
                {room.phase}
              </span>
              <div className="match-detail">
                <strong>
                  <Link to={`/admin/rooms/${room.roomId}`}>{room.code}</Link> ·{" "}
                  {room.hostName ?? "no host"}
                </strong>
                <span className="hint">
                  {room.players} player{room.players === 1 ? "" : "s"}
                  {room.disconnected > 0 && ` (${room.disconnected} dropped)`}
                  {room.spectators > 0 && ` · ${room.spectators} watching`}
                  {room.round !== null && ` · round ${room.round}`}
                  {` · idle ${relative(room.idleSeconds)}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        <Link to="/admin/replay">Replay a finished match →</Link>
      </p>

      <AdminFeed />

      <p className="hint">
        Signed in as {session.data?.email ?? session.data?.via ?? "…"} · refreshing every{" "}
        {POLL_MS / 1000}s while this tab is visible.
      </p>
    </main>
  );
}
