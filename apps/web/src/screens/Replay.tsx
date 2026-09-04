/**
 * Shareable replays (#83) — the player-facing skin over what the admin replay
 * debugger (#69) already does.
 *
 * Two differences from the debugger, and both are the point. It is redacted
 * as a spectator, so a shared link shows exactly what the table saw and never
 * a hand that was not turned over — sharing a game should not hand out
 * information the players themselves were denied while it ran. And it reads
 * round by round rather than event by event, because "what happened" is a
 * story about rounds; the events are an implementation detail.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TrumpCard, formatStatValue, statName } from "@deckxi/ui";
import type { RedactedGameEvent } from "@deckxi/shared";
import {
  applyRedactedEvents,
  type ClientGameState,
  type ResolvedRound,
} from "../game/clientGame.js";
import { fetchReplay, type ReplayMatch } from "../lib/api.js";
import { AppBar } from "../components/Chrome.js";

const STEP_MS = 2200;

/** Fold the whole log once, keeping a snapshot after each resolved round. */
function roundsOf(events: RedactedGameEvent[]): ResolvedRound[] {
  let state: ClientGameState | null = null;
  const rounds: ResolvedRound[] = [];
  for (const event of events) {
    state = applyRedactedEvents(state, [event], null);
    if (event.type === "ROUND_RESOLVED" && state?.lastResolved != null) {
      rounds.push(state.lastResolved);
    }
  }
  return rounds;
}

export function ReplayScreen() {
  const { token = "" } = useParams();
  const [data, setData] = useState<{ match: ReplayMatch; events: RedactedGameEvent[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    fetchReplay(token)
      .then((replay) =>
        setData({ match: replay.match, events: replay.events as RedactedGameEvent[] }),
      )
      .catch(() => setError("That replay link doesn't work — it may have been revoked."));
  }, [token]);

  const rounds = useMemo(() => (data === null ? [] : roundsOf(data.events)), [data]);
  const last = Math.max(0, rounds.length - 1);

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(last, Math.max(0, current + delta)));
    },
    [last],
  );

  useEffect(() => {
    if (!playing || rounds.length === 0) return;
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
  }, [playing, last, rounds.length]);

  // Arrow keys and space, same as the debugger — anyone stepping through a
  // game reaches for them.
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

  if (error !== null) {
    return (
      <main className="screen replay">
        <AppBar title="Replay" back />
        <div className="panel">
          <p className="hint">{error}</p>
          <Link className="button" to="/">
            Play a game instead
          </Link>
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="screen replay">
        <AppBar title="Replay" back />
        <p className="hint">Loading…</p>
      </main>
    );
  }

  const { match } = data;
  const nameOf = (sessionId: string): string =>
    match.players.find((p) => p.sessionId === sessionId)?.name ?? "Someone";
  const round = rounds[index];
  const winnerName = match.winnerSessionId === null ? null : nameOf(match.winnerSessionId);

  return (
    <main className="screen replay" data-testid="replay">
      <AppBar title={`Room ${match.roomCode}`} back />

      <p className="hint">
        {match.players.map((p) => p.name).join(", ")}
        {winnerName !== null ? ` · ${winnerName} won` : ""}
        {match.rounds !== null ? ` · ${match.rounds} rounds` : ""}
      </p>

      {rounds.length === 0 && (
        <div className="panel">
          <p className="hint">This game ended before a round was played.</p>
        </div>
      )}

      {round !== undefined && (
        <>
          <div className="reveal-panel" data-testid="replay-round">
            <span className="called-label">
              Round {round.round} · {statName(match.editionId, round.stat)}
            </span>
            <ul className="reveal-cards">
              {round.revealed.map((card, seat) => {
                const won = round.result.kind === "won" && card.playerId === round.result.winner;
                return (
                  <li
                    key={card.playerId}
                    className={`reveal-card${won ? " reveal-card--win" : ""}`}
                    style={{ "--seat-index": seat } as React.CSSProperties}
                  >
                    <span className="reveal-card-owner">{nameOf(card.playerId)}</span>
                    <TrumpCard
                      editionId={match.editionId}
                      cardId={card.cardId}
                      size="reveal"
                      highlightStat={round.stat}
                      outcome={won ? "winner" : round.result.kind === "won" ? "loser" : undefined}
                    />
                    <span className="hint">
                      {formatStatValue(match.editionId, round.stat, card.value)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="hint">
              {round.result.kind === "won"
                ? `${nameOf(round.result.winner)} took the round`
                : "Tie — the cards went to the pot"}
            </p>
          </div>

          <div className="replay-controls">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => step(-1)}
              disabled={index === 0}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setPlaying((p) => !p)}
              data-testid="replay-play"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => step(1)}
              disabled={index >= last}
            >
              Next →
            </button>
          </div>
          <p className="hint">
            Round {index + 1} of {rounds.length}
          </p>
        </>
      )}

      <p className="hint">
        <Link to="/">Play your own game →</Link>
      </p>
    </main>
  );
}
