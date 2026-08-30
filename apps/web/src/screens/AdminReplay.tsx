/**
 * Replay debugger (#69).
 *
 * Because the engine is deterministic and event-sourced, "debug a live game"
 * is just "replay its log": `replayUntil(events, n)` gives the exact state the
 * server held after n events, from the same bytes the server acted on. There
 * is nothing to record and nothing that can drift — if the replay disagrees
 * with what a player saw, the bug is real and it is in the engine.
 *
 * Cards render through the real `TrumpCard`, so what you see is what the
 * player saw, minus the redaction: every hand is face up here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { replayUntil, type GameEvent, type GameState } from "@deckxi/engine";
import { TrumpCard } from "@deckxi/ui";
import {
  fetchAdminMatch,
  fetchAdminMatches,
  type MatchListRow,
  type StoredMatch,
} from "../lib/admin.js";
import { AdminNotFound, usePolled } from "./Admin.js";

const STEP_MS = 900;

/** The stat under comparison at this point, for the card highlight. */
function highlightAt(events: GameEvent[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "ROUND_RESOLVED") return undefined;
    if (event?.type === "STAT_SELECTED") return event.stat;
  }
  return undefined;
}

function describe(event: GameEvent): string {
  switch (event.type) {
    case "GAME_STARTED":
      return `${event.config.players.length} players, ${event.config.cards.length} cards, seed ${event.config.seed}`;
    case "STAT_SELECTED":
      return `${event.playerId.slice(0, 8)} picked ${event.stat}${event.auto ? " (auto)" : ""}`;
    case "ROUND_RESOLVED":
      return `round ${event.round} on ${event.stat}: ${
        event.result.kind === "won" ? `won by ${event.result.winner.slice(0, 8)}` : "tie"
      }`;
    case "PLAYER_ELIMINATED":
      return `${event.playerId.slice(0, 8)} out in round ${event.round}`;
    case "PLAYER_FORFEITED":
      return `${event.playerId.slice(0, 8)} forfeited`;
    case "GAME_ENDED":
      return `${event.winner.slice(0, 8)} wins — ${event.reason}`;
    default:
      return "";
  }
}

export function AdminReplayListScreen() {
  const { data, denied } = usePolled<{ matches: MatchListRow[] }>(fetchAdminMatches, 30_000);
  if (denied) return <AdminNotFound />;

  return (
    <main className="screen admin" data-testid="admin-replays">
      <div className="screen-head">
        <Link to="/admin" className="brand brand--small" style={{ textDecoration: "none" }}>
          ← Ops
        </Link>
        <h2 style={{ margin: 0 }}>Replays</h2>
        <span />
      </div>

      {data !== null && data.matches.length === 0 ? (
        <div className="panel">
          <p style={{ margin: 0 }}>
            No matches recorded yet. Without a database the store is in-memory, so this list is
            empty after every restart.
          </p>
        </div>
      ) : (
        <ul className="match-list">
          {(data?.matches ?? []).map((match) => (
            <li key={match.matchId} className="panel match-row">
              <span className="match-outcome">{match.rounds ?? "—"}r</span>
              <div className="match-detail">
                <strong>
                  <Link to={`/admin/replay/${match.matchId}`}>{match.roomCode}</Link> ·{" "}
                  {match.playerNames.join(" v ")}
                </strong>
                <span className="hint">
                  {new Date(match.startedAt).toLocaleString()} · {match.endReason ?? "unfinished"} ·{" "}
                  {match.editionId}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function AdminReplayScreen() {
  const { matchId = "" } = useParams();
  const [match, setMatch] = useState<StoredMatch | null | "missing">(null);
  const [denied, setDenied] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetchAdminMatch(matchId)
      .then(({ match: found }) => setMatch(found ?? "missing"))
      .catch(() => setDenied(true));
  }, [matchId]);

  const events = useMemo<GameEvent[]>(
    () =>
      match === null || match === "missing"
        ? []
        : match.events.map((e) => e.event as unknown as GameEvent),
    [match],
  );

  // One fold per position rather than an incremental cursor: replaying a few
  // hundred events is microseconds, and recomputing from the log is the whole
  // guarantee — an incrementally-mutated view could drift from the engine.
  const state = useMemo<GameState | null>(() => {
    if (events.length === 0 || index === 0) return null;
    try {
      return replayUntil(events, index);
    } catch {
      return null;
    }
  }, [events, index]);

  const last = events.length;
  const step = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(last, Math.max(0, current + delta)));
    },
    [last],
  );

  useEffect(() => {
    // Land on the first event so something is on screen straight away.
    if (events.length > 0) setIndex((current) => (current === 0 ? 1 : current));
  }, [events.length]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= last) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (denied) return <AdminNotFound />;
  if (match === "missing") {
    return (
      <main className="screen admin">
        <div className="panel">
          <h2>No such match</h2>
          <p>
            Nothing is stored under that id. <Link to="/admin/replay">Back to replays</Link>.
          </p>
        </div>
      </main>
    );
  }

  const nameOf = (sessionId: string): string =>
    match === null
      ? sessionId
      : (match.players.find((p) => p.sessionId === sessionId)?.name ?? sessionId.slice(0, 8));
  const current = index > 0 ? events[index - 1] : undefined;
  const editionId = match?.editionId ?? "";
  const highlight = highlightAt(events, index);

  return (
    <main className="screen admin" data-testid="admin-replay">
      <div className="screen-head">
        <Link to="/admin/replay" className="brand brand--small" style={{ textDecoration: "none" }}>
          ← Replays
        </Link>
        <h2 style={{ margin: 0 }}>{match?.roomCode ?? "…"}</h2>
        <span />
      </div>

      <section className="panel replay-controls">
        <div className="update-bar-actions">
          <button type="button" className="button button--sm" onClick={() => setIndex(1)}>
            ⏮
          </button>
          <button type="button" className="button button--sm" onClick={() => step(-1)}>
            ◀
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="button button--sm" onClick={() => step(1)}>
            ▶
          </button>
          <button type="button" className="button button--sm" onClick={() => setIndex(last)}>
            ⏭
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          aria-label="Event position"
          onChange={(e) => setIndex(Number(e.target.value))}
        />
        <p className="hint" style={{ margin: 0 }}>
          Event {index} of {last}
          {current !== undefined && ` · ${current.type} — ${describe(current)}`}
        </p>
      </section>

      {state !== null && (
        <>
          <section className="panel admin-grid">
            <div className="admin-field">
              <span className="hint">Round</span>
              <strong>{state.round}</strong>
            </div>
            <div className="admin-field">
              <span className="hint">Leader</span>
              <strong>{nameOf(state.leader)}</strong>
            </div>
            <div className="admin-field">
              <span className="hint">Phase</span>
              <strong>{state.phase}</strong>
            </div>
            <div className="admin-field">
              <span className="hint">Pot</span>
              <strong>{state.pot.length}</strong>
            </div>
            <div className="admin-field">
              <span className="hint">Winner</span>
              <strong>{state.winner === null ? "—" : nameOf(state.winner)}</strong>
            </div>
          </section>

          <section className="replay-hands">
            {state.players.map((player) => (
              <div key={player.id} className="replay-hand">
                <strong>
                  {nameOf(player.id)}
                  {!player.active && " · out"}
                  {player.id === state.leader && " · leading"}
                </strong>
                <span className="hint">{player.hand.length} cards</span>
                <TrumpCard
                  editionId={editionId}
                  cardId={player.hand[0] ?? null}
                  size="hand"
                  {...(highlight !== undefined ? { highlightStat: highlight } : {})}
                />
              </div>
            ))}
          </section>
        </>
      )}

      <p className="hint">← → step, space plays. State is folded from the log at every position.</p>
    </main>
  );
}
