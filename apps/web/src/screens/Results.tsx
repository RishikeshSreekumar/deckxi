/**
 * Results: the winner takes the spotlight; the host can spin up a rematch
 * (same room, same seats, fresh ready check).
 */
import { useEffect, useRef } from "react";
import type { RoomView } from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { sounds } from "../lib/sounds.js";
import { MuteButton, ThemeToggle } from "../components/Chrome.js";

const REASON_COPY = {
  "last-standing": "took every card on the table",
  "opponents-forfeited": "wins — everyone else forfeited",
  "round-limit": "led when the round limit hit",
  "final-tie": "edges a dead-even finish",
} as const;

export function Results({ room }: { room: RoomView }) {
  const selfId = useStore((s) => s.selfId);
  const spectator = useStore((s) => s.spectator);
  const game = useStore((s) => s.game);
  const rematch = useStore((s) => s.rematch);
  const leaveRoom = useStore((s) => s.leaveRoom);

  const winnerId = game?.winner ?? null;
  const youWon = !spectator && winnerId === selfId;
  const winnerName =
    winnerId === null ? "?" : (room.players.find((p) => p.id === winnerId)?.name ?? winnerId);
  const isHost = selfId === room.hostId;

  const played = useRef(false);
  useEffect(() => {
    if (played.current || game === null) return;
    played.current = true;
    if (spectator) return;
    if (youWon) sounds.gameWin();
    else sounds.gameLose();
  }, [game, youWon, spectator]);

  const standings =
    game === null
      ? []
      : [...room.players]
          .map((p) => ({ ...p, cards: game.handCounts[p.id] ?? 0 }))
          .sort((a, b) => b.cards - a.cards);

  return (
    <main className="screen results" data-testid="results">
      <header className="screen-head">
        <h1 className="brand brand--small">
          Deck<span className="brand-xi">XI</span>
        </h1>
        <div className="head-actions">
          <ThemeToggle />
          <MuteButton />
        </div>
      </header>

      <div className={`panel results-panel ${youWon ? "results-panel--won" : ""}`}>
        <p className="results-trophy" aria-hidden="true">
          {youWon ? "🏆" : "🏏"}
        </p>
        <h2 className="results-title" data-testid="winner-line">
          {youWon ? "You win!" : `${winnerName} wins!`}
        </h2>
        {game?.endReason != null && (
          <p className="results-reason">
            {youWon ? "You" : winnerName} {REASON_COPY[game.endReason]} after {game.round - 1}{" "}
            {game.round - 1 === 1 ? "round" : "rounds"}.
          </p>
        )}

        <ul className="standings">
          {standings.map((p, i) => (
            <li key={p.id} className={p.id === winnerId ? "standing standing--winner" : "standing"}>
              <span>{i + 1}.</span>
              <span className="standing-name">
                {p.id === selfId ? "You" : p.name}
                {!p.connected && <span className="tag tag--away">away</span>}
              </span>
              <span>{p.cards} cards</span>
            </li>
          ))}
        </ul>

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
          <button type="button" className="button button--ghost" onClick={() => void leaveRoom()}>
            Leave room
          </button>
        </div>
      </div>
    </main>
  );
}
