/**
 * Room state inspector (#68) — what the server believes about one room,
 * including the hands, which no player's client is ever told.
 *
 * Rendered as data, not as a game: the question here is "is the server's state
 * what I expect", and a pretty table of cards would hide exactly the detail
 * (seat, session id, active flag, pot contents) that answers it. Watching a
 * game as a game is what the replay debugger is for (#69).
 */
import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { AdminFeed } from "../components/AdminFeed.js";
import {
  closeAdminRoom,
  fetchAdminRoom,
  kickAdminSession,
  type AdminRoomDetail,
} from "../lib/admin.js";
import { AdminNotFound, usePolled } from "./Admin.js";

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="admin-field">
      <span className="hint">{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

export function AdminRoomScreen() {
  const { roomId = "" } = useParams();
  const load = useCallback(() => fetchAdminRoom(roomId), [roomId]);
  const { data, denied, refresh } = usePolled<{ room: AdminRoomDetail | null }>(load, 3000);

  if (denied) return <AdminNotFound />;

  const room = data?.room ?? null;
  if (data !== null && room === null) {
    return (
      <main className="screen admin">
        <div className="panel">
          <h2>Room is gone</h2>
          <p>
            It closed, was reaped for idleness, or never existed. Finished games are still
            replayable from the <Link to="/admin">dashboard</Link>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen admin" data-testid="admin-room">
      <div className="screen-head">
        <Link to="/admin" className="brand brand--small" style={{ textDecoration: "none" }}>
          ← Ops
        </Link>
        <h2 style={{ margin: 0 }}>{room?.code ?? "…"}</h2>
        <span />
      </div>

      <section className="panel admin-grid">
        <Field label="Phase" value={room?.phase ?? null} />
        <Field label="Round" value={room?.round ?? null} />
        <Field label="Idle" value={room === undefined ? null : `${room?.idleSeconds ?? 0}s`} />
        <Field label="Edition" value={room?.editionId ?? null} />
        <Field label="Match" value={room?.matchId ?? null} />
        <Field label="Events" value={room?.game?.events ?? null} />
      </section>

      <section className="panel">
        <h3 className="admin-feed-title">Seats</h3>
        <ul className="admin-seats">
          {(room?.sessions ?? []).map((session) => {
            const hand = room?.game?.players.find((p) => p.id === session.id);
            return (
              <li key={session.id} className="admin-seat">
                <strong>
                  {session.name}
                  {session.id === room?.hostId && " · host"}
                  {session.spectator && " · spectator"}
                </strong>
                <span className="hint">
                  {session.connected ? "connected" : "disconnected"}
                  {!session.spectator && ` · seat ${session.seat}`}
                  {session.ready && " · ready"}
                  {session.id === room?.game?.leader && " · leading"}
                  {hand !== undefined &&
                    ` · ${hand.hand.length} cards${hand.active ? "" : " · out"}`}
                </span>
                {hand !== undefined && hand.hand.length > 0 && (
                  <code className="admin-hand">{hand.hand.join(", ")}</code>
                )}
                <button
                  type="button"
                  className="button button--danger button--sm"
                  onClick={() => {
                    void kickAdminSession(roomId, session.id).then(refresh);
                  }}
                >
                  Kick
                </button>
              </li>
            );
          })}
        </ul>
        {room?.game !== null && room?.game !== undefined && room.game.pot.length > 0 && (
          <p className="hint">Pot: {room.game.pot.join(", ")}</p>
        )}
      </section>

      <section className="panel">
        <h3 className="admin-feed-title">Moderation</h3>
        <p className="hint">
          Closing ends the game for everyone in it, immediately. Mid-game, kicking one player is a
          forfeit — the same path as walking out, because a second way to lose a player is a second
          way for the state machine to go wrong.
        </p>
        <button
          type="button"
          className="button button--danger button--sm"
          onClick={() => {
            void closeAdminRoom(roomId).then(refresh);
          }}
        >
          Close this room
        </button>
      </section>

      <AdminFeed roomId={roomId} />
    </main>
  );
}
