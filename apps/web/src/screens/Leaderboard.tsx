/**
 * The ladder (#80). One board per mode, per season — and a season is a data
 * edition, because a new edition changes what the cards are worth and a
 * single ladder across two of them would be scoring two different games.
 *
 * Your own row is called out wherever it lands, and shown beneath the board
 * when you are outside the top of it: a leaderboard you cannot find yourself
 * on is somebody else's news.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GAME_MODE_INFO, GAME_MODES, type GameModeId } from "@deckxi/shared";
import { ensureSession } from "../lib/auth.js";
import {
  fetchLeaderboard,
  fetchProfile,
  type Leaderboard,
  type LeaderboardRow,
} from "../lib/api.js";
import { AppBar } from "../components/Chrome.js";

/** Squad Draft rates too, so every mode gets a board. */
const BOARD_MODES: readonly GameModeId[] = GAME_MODES;

function Row({ row, isSelf }: { row: LeaderboardRow; isSelf: boolean }) {
  return (
    <li className={`panel ladder-row${isSelf ? " ladder-row--self" : ""}`}>
      <span className="ladder-rank">{row.rank}</span>
      <div className="ladder-detail">
        <strong>{row.name ?? "Someone"}</strong>
        <span className="hint">
          {row.games} {row.games === 1 ? "game" : "games"} · {row.wins} won
        </span>
      </div>
      <span className="ladder-rating">{row.rating}</span>
    </li>
  );
}

export function LeaderboardScreen() {
  const [mode, setMode] = useState<GameModeId>("classic-trumps");
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBoard(null);
    setError(null);
    fetchLeaderboard(mode)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the ladder — is the server up?");
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Best-effort: knowing who you are only decides which row is highlighted.
  useEffect(() => {
    void ensureSession()
      .then(fetchProfile)
      .then(({ user }) => setSelfId(user.id))
      .catch(() => undefined);
  }, []);

  const mine = board?.rows.find((row) => row.userId === selfId) ?? null;
  const inTop = mine !== null && board !== null && board.rows.slice(0, 20).includes(mine);

  return (
    <main className="screen ladder">
      <AppBar title="Leaderboard" back />

      <div className="mode-tabs" role="tablist" aria-label="Game mode">
        {BOARD_MODES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`button button--ghost${mode === id ? " is-active" : ""}`}
            onClick={() => setMode(id)}
          >
            {GAME_MODE_INFO[id].name}
          </button>
        ))}
      </div>

      {error !== null && <p className="notice">{error}</p>}
      {error === null && board === null && <p className="hint">Loading…</p>}

      {board !== null && board.rows.length === 0 && (
        <div className="panel">
          <p className="hint">
            Nobody has finished a rated game in this mode yet. <Link to="/">Play one</Link> and the
            ladder starts with you.
          </p>
        </div>
      )}

      {board !== null && board.rows.length > 0 && (
        <>
          <ul className="ladder-list" data-testid="ladder">
            {board.rows.slice(0, 20).map((row) => (
              <Row key={row.userId} row={row} isSelf={row.userId === selfId} />
            ))}
          </ul>
          {mine !== null && !inTop && (
            <>
              <p className="hint">Your place</p>
              <ul className="ladder-list">
                <Row row={mine} isSelf />
              </ul>
            </>
          )}
        </>
      )}

      <p className="hint">
        Ratings start at 1200 and only move in games between signed-in players. A season runs for
        one card edition — this one is {board?.season ?? "the current edition"}.
      </p>
    </main>
  );
}
