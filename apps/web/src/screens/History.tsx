/**
 * Match history: your recent games (backed by Phase 4's match records),
 * newest first — result, opponents, rounds, and when.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ensureSession } from "../lib/auth.js";
import { fetchMatches, fetchProfile, type MatchSummary } from "../lib/api.js";
import { AppBar } from "../components/Chrome.js";

const OUTCOME_COPY = { won: "Won", lost: "Lost", unfinished: "Unfinished" } as const;

function when(iso: string): string {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}

export function HistoryScreen() {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureSession()
      .then(async () => {
        const [profile, list] = await Promise.all([fetchProfile(), fetchMatches()]);
        setSelfId(profile.user.id);
        setMatches(list);
      })
      .catch(() => setError("Couldn't load your match history — is the server up?"));
  }, []);

  return (
    <main className="screen history">
      <AppBar title="Match history">
        <Link to="/" className="button button--ghost">
          Back
        </Link>
      </AppBar>

      {error !== null && <p className="notice">{error}</p>}
      {error === null && matches === null && <p className="hint">Loading…</p>}

      {matches !== null && matches.length === 0 && (
        <div className="panel">
          <p className="hint">
            No matches yet — <Link to="/">play your first game</Link> and it'll show up here.
          </p>
        </div>
      )}

      {matches !== null && matches.length > 0 && (
        <ul className="match-list">
          {matches.map((m) => {
            const opponents = m.players
              .filter((p) => p.userId !== selfId || selfId === null)
              .map((p) => p.name);
            return (
              <li key={m.matchId} className={`panel match-row match-row--${m.outcome}`}>
                <span className={`match-outcome match-outcome--${m.outcome}`}>
                  {OUTCOME_COPY[m.outcome]}
                </span>
                <div className="match-detail">
                  <strong>vs {opponents.length > 0 ? opponents.join(", ") : "—"}</strong>
                  <span className="hint">
                    {when(m.startedAt)}
                    {m.rounds !== null ? ` · ${m.rounds} rounds` : ""} · room {m.roomCode}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="hint">
        <Link to="/profile">← Back to profile</Link>
      </p>
    </main>
  );
}
