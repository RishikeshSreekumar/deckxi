/**
 * Results: the winner takes the spotlight; the host can spin up a rematch
 * (same room, same seats, fresh ready check).
 */
import { useEffect, useRef, useState } from "react";
import type { RoomView } from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { sounds } from "../lib/sounds.js";
import { AppBar, LeaveIcon, MuteButton } from "../components/Chrome.js";
import { LeagueTable } from "../components/LeagueTable.js";
import { RoundLog } from "../components/RoundLog.js";
import { GameChat } from "../components/GameChat.js";
import { ordinal } from "./tableShared.js";
import "./results.css";

/**
 * Final placings. Cards in hand first; among the empty-handed, whoever
 * lasted longer places higher; anyone still level shares the place — the
 * playtest had three players on 0 cards ranked 3rd, 4th and 5th with no
 * reason given, and all three asked why.
 */
function placings(
  players: RoomView["players"],
  cards: Record<string, number>,
  eliminatedIn: Record<string, number>,
): {
  id: string;
  name: string;
  connected: boolean;
  cards: number;
  outIn: number | null;
  place: number;
}[] {
  const rows = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      cards: cards[p.id] ?? 0,
      outIn: eliminatedIn[p.id] ?? null,
    }))
    .sort((a, b) => b.cards - a.cards || (b.outIn ?? Infinity) - (a.outIn ?? Infinity));
  let place = 0;
  return rows.map((row, i) => {
    const prev = rows[i - 1];
    const level = prev !== undefined && prev.cards === row.cards && prev.outIn === row.outIn;
    if (!level) place = i + 1;
    return { ...row, place };
  });
}

const REASON_COPY = {
  "last-standing": "took every card on the table",
  "opponents-forfeited": "wins — everyone else forfeited",
  "round-limit": "led when the round limit hit",
  "final-tie": "edges a dead-even finish",
  league: "topped the table",
} as const;

export function Results({ room }: { room: RoomView }) {
  const selfId = useStore((s) => s.selfId);
  const spectator = useStore((s) => s.spectator);
  const game = useStore((s) => s.game);
  const squad = useStore((s) => s.squad);
  const rematch = useStore((s) => s.rematch);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const practice = useStore((s) => s.practice);
  const [logOpen, setLogOpen] = useState(false);

  const isSquad = room.settings.gameMode === "squad-draft";
  const winnerId = (isSquad ? squad?.winner : game?.winner) ?? null;
  const youWon = !spectator && winnerId === selfId;
  const winnerName =
    winnerId === null ? "?" : (room.players.find((p) => p.id === winnerId)?.name ?? winnerId);
  const isHost = selfId === room.hostId;

  const played = useRef(false);
  useEffect(() => {
    if (played.current || (game === null && squad === null)) return;
    played.current = true;
    if (spectator) return;
    if (youWon) sounds.gameWin();
    else sounds.gameLose();
  }, [game, squad, youWon, spectator]);

  const standings = game === null ? [] : placings(room.players, game.handCounts, game.eliminatedIn);
  const shared = new Set(
    standings
      .filter((p, i, all) => all.some((q, j) => j !== i && q.place === p.place))
      .map((p) => p.place),
  );
  const names = Object.fromEntries(room.players.map((p) => [p.id, p.name]));
  const editionId = game?.config.editionId ?? room.settings.editionId;

  return (
    <main className="screen results" data-testid="results">
      <AppBar title="Final">
        <MuteButton />
      </AppBar>

      <div className={`panel results-panel ${youWon ? "results-panel--won" : ""}`}>
        <p className="results-trophy" aria-hidden="true">
          {youWon ? "🏆" : "🏏"}
        </p>
        <h2 className="results-title" data-testid="winner-line">
          {youWon ? "You win!" : `${winnerName} wins!`}
        </h2>
        {!isSquad && game?.endReason != null && (
          <p className="results-reason">
            {youWon ? "You" : winnerName} {REASON_COPY[game.endReason]} after {game.round - 1}{" "}
            {game.round - 1 === 1 ? "round" : "rounds"}.
          </p>
        )}
        {isSquad && squad?.endReason != null && (
          <p className="results-reason">
            {youWon ? "You" : winnerName} {REASON_COPY[squad.endReason]}
            {squad.league !== null
              ? ` across ${squad.league.matches.length} ${squad.league.matches.length === 1 ? "match" : "matches"}.`
              : "."}
          </p>
        )}

        {isSquad && squad?.league != null && (
          <LeagueTable
            state={squad}
            names={Object.fromEntries(room.players.map((p) => [p.id, p.name]))}
            selfId={spectator ? null : selfId}
          />
        )}

        <ul className="standings" hidden={isSquad}>
          {standings.map((p) => (
            <li
              key={p.id}
              className={p.id === winnerId ? "standing standing--winner" : "standing"}
              data-testid={`standing-${p.id}`}
            >
              <span className="standing-place">
                {shared.has(p.place) ? "=" : ""}
                {p.place}
                {ordinal(p.place)}
              </span>
              <span className="standing-name">
                {p.id === selfId ? "You" : p.name}
                {!p.connected && <span className="tag tag--away">away</span>}
                {p.outIn !== null && p.id !== winnerId && (
                  <span className="standing-note">out in round {p.outIn}</span>
                )}
              </span>
              <span>
                {p.cards} {p.cards === 1 ? "card" : "cards"}
              </span>
            </li>
          ))}
        </ul>

        {!isSquad && game !== null && game.history.length > 0 && (
          <div className="results-log" data-testid="results-log">
            <button
              type="button"
              className="button button--sm"
              aria-expanded={logOpen}
              onClick={() => setLogOpen(!logOpen)}
            >
              {logOpen
                ? "Hide the round log"
                : `How it went — ${game.history.length} ${game.history.length === 1 ? "round" : "rounds"}`}
            </button>
            {logOpen && (
              <RoundLog
                history={game.history}
                editionId={editionId}
                names={names}
                selfId={spectator ? null : selfId}
              />
            )}
          </div>
        )}

        <div className="results-actions">
          {isHost ? (
            <button
              type="button"
              className="button button--primary"
              data-testid="rematch"
              onClick={() => void rematch().catch(() => undefined)}
            >
              Rematch
            </button>
          ) : (
            <p className="hint">Waiting for the host to start a rematch…</p>
          )}
          {!spectator && !practice && (
            <div className="results-chat">
              <GameChat />
            </div>
          )}
          <button
            type="button"
            className="button button--ghost button--icon"
            onClick={() => void leaveRoom()}
          >
            <LeaveIcon size={18} />
            Leave room
          </button>
        </div>
      </div>
    </main>
  );
}
