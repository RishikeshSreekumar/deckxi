/**
 * The game table (mobile-first): opponents across the top, the action in the
 * middle, your hand at the bottom. The reveal presenter drains resolved
 * rounds one at a time and gives each its animation beat — this is *the*
 * moment of the game.
 */
import { useEffect, useRef, useState } from "react";
import type { RoomView } from "@deckxi/shared";
import type { ResolvedRound } from "../game/clientGame.js";
import { Dialog, TimerRing, TrumpCard, statName } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { EmoteBar } from "../components/EmoteBar.js";
import { MuteButton } from "../components/Chrome.js";
import { sounds } from "../lib/sounds.js";

type Stage = "flip" | "verdict";

const FLIP_MS = 1100;
const VERDICT_MS = 2100;

function useRevealPresenter(selfId: string | null) {
  const pending = useStore((s) => s.pendingReveals);
  const shiftReveal = useStore((s) => s.shiftReveal);
  const setPresenting = useStore((s) => s.setPresenting);
  const [current, setCurrent] = useState<ResolvedRound | null>(null);
  const [stage, setStage] = useState<Stage>("flip");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (current !== null || pending.length === 0) return;
    const round = pending[0];
    if (round === undefined) return;
    shiftReveal();
    setCurrent(round);
    setStage("flip");
    setPresenting(true);
    sounds.flip();
    timers.current.push(
      window.setTimeout(() => {
        setStage("verdict");
        if (round.result.kind === "tie") sounds.tie();
        else if (round.result.winner === selfId) sounds.roundWin();
        else sounds.roundLose();
      }, FLIP_MS),
      window.setTimeout(() => {
        setCurrent(null);
        setPresenting(false);
      }, FLIP_MS + VERDICT_MS),
    );
  }, [current, pending, selfId, shiftReveal, setPresenting]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  return { current, stage };
}

function RevealOverlay({
  round,
  stage,
  editionId,
  names,
  selfId,
}: {
  round: ResolvedRound;
  stage: Stage;
  editionId: string;
  names: Record<string, string>;
  selfId: string | null;
}) {
  const winnerId = round.result.kind === "won" ? round.result.winner : null;
  const winnerIndex = round.revealed.findIndex((r) => r.playerId === winnerId);
  return (
    <div className={`reveal reveal--${stage}`} data-testid="reveal">
      <p className="reveal-stat">
        Round {round.round} · <strong>{statName(editionId, round.stat)}</strong>
      </p>
      <div className="reveal-cards">
        {round.revealed.map((r, i) => (
          <div
            key={r.playerId}
            className="reveal-slot"
            style={{ "--slot-index": i } as React.CSSProperties}
          >
            <span className="reveal-owner">
              {r.playerId === selfId ? "You" : (names[r.playerId] ?? r.playerId)}
            </span>
            <div
              className={[
                "reveal-flipper",
                stage === "verdict" && r.playerId !== winnerId
                  ? winnerId === null
                    ? "sweep-to-pot"
                    : "sweep-to-winner"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--sweep-x": `${(winnerIndex - i) * 110}%` } as React.CSSProperties}
            >
              <TrumpCard
                editionId={editionId}
                cardId={r.cardId}
                size="reveal"
                highlightStat={round.stat}
                outcome={
                  stage === "verdict" ? (r.playerId === winnerId ? "winner" : "loser") : undefined
                }
              />
            </div>
            <span
              className={`reveal-value ${stage === "verdict" && r.playerId === winnerId ? "reveal-value--win" : ""}`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
      {stage === "verdict" && (
        <p className="reveal-verdict" data-testid="verdict">
          {round.result.kind === "tie"
            ? "Tie! Cards go to the pot."
            : winnerId === selfId
              ? `You take the round${round.potTaken > 0 ? ` + ${round.potTaken} from the pot` : ""}!`
              : `${names[winnerId ?? ""] ?? "Someone"} takes the round.`}
        </p>
      )}
    </div>
  );
}

export function GameTable({ room }: { room: RoomView }) {
  const selfId = useStore((s) => s.selfId);
  const spectator = useStore((s) => s.spectator);
  const game = useStore((s) => s.game);
  const timer = useStore((s) => s.timer);
  const pendingStat = useStore((s) => s.pendingStat);
  const selectStat = useStore((s) => s.selectStat);
  const forfeit = useStore((s) => s.forfeit);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const [menuOpen, setMenuOpen] = useState(false);
  const { current, stage } = useRevealPresenter(spectator ? null : selfId);

  const names: Record<string, string> = {};
  for (const p of room.players) names[p.id] = p.name;

  const yourTurn =
    !spectator && game !== null && !game.finished && game.leader === selfId && current === null;

  // Nudge when it becomes your pick.
  const nudged = useRef(false);
  useEffect(() => {
    if (yourTurn && !nudged.current) {
      nudged.current = true;
      sounds.yourTurn();
    }
    if (!yourTurn) nudged.current = false;
  }, [yourTurn]);

  if (game === null) {
    return (
      <main className="screen table-screen">
        <p className="hint">Dealing…</p>
      </main>
    );
  }

  const editionId = game.config.editionId;
  const opponents = game.config.players.filter((id) => id !== selfId);
  const topCard = game.yourHand?.[0] ?? null;
  const leaderName = game.leader === selfId ? "you" : (names[game.leader] ?? "…");

  return (
    <main className="screen table-screen" data-testid="game-table">
      <header className="table-head">
        <span className="round-chip" data-testid="round-chip">
          Round {game.round}
        </span>
        <div className="head-actions">
          <MuteButton />
          <button
            type="button"
            className="icon-button"
            aria-label="Menu"
            onClick={() => setMenuOpen(true)}
          >
            ⋯
          </button>
        </div>
      </header>

      <section className="opponents" aria-label="Opponents">
        {opponents.map((id) => {
          const isLeader = game.leader === id && !game.finished;
          const away = room.players.find((p) => p.id === id)?.connected === false;
          return (
            <div
              key={id}
              className={[
                "opponent",
                game.active[id] ? "" : "opponent--out",
                isLeader ? "opponent--leader" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="player-avatar" aria-hidden="true">
                {(names[id] ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="opponent-name">
                {names[id] ?? id}
                {away && <span className="tag tag--away">away</span>}
              </span>
              <span className="opponent-cards" data-testid={`cards-${id}`}>
                🂠 {game.handCounts[id] ?? 0}
              </span>
              {isLeader && timer !== null && timer.playerId === id && (
                <TimerRing
                  deadline={timer.deadline}
                  seconds={room.settings.turnTimerSeconds}
                  onTick={() => sounds.tick()}
                />
              )}
            </div>
          );
        })}
      </section>

      <section className="table-center">
        {current !== null ? (
          <RevealOverlay
            round={current}
            stage={stage}
            editionId={editionId}
            names={names}
            selfId={spectator ? null : selfId}
          />
        ) : (
          <div className="table-status">
            {game.pot.length > 0 && (
              <div className="pot" aria-label={`${game.pot.length} cards in the pot`}>
                <span className="pot-stack" aria-hidden="true">
                  {"🂠".repeat(Math.min(game.pot.length, 5))}
                </span>
                <span>{game.pot.length} in the pot</span>
              </div>
            )}
            {!game.finished && (
              <p className="turn-line" data-testid="turn-line">
                {yourTurn ? (
                  <strong>Your pick — choose a stat on your card</strong>
                ) : (
                  <>Waiting for {leaderName} to pick a stat…</>
                )}
              </p>
            )}
          </div>
        )}
      </section>

      <section className={`your-area ${yourTurn ? "your-area--turn" : ""}`}>
        {spectator || game.yourHand === null ? (
          <p className="hint">Spectating — {game.config.players.length} players in the match.</p>
        ) : game.yourHand.length === 0 ? (
          <p className="hint">
            You're out of cards{game.active[selfId ?? ""] ? "" : " — eliminated"}.
          </p>
        ) : (
          <div className="hand">
            <div className="hand-top">
              {yourTurn && timer !== null && timer.playerId === selfId && (
                <TimerRing
                  deadline={timer.deadline}
                  seconds={room.settings.turnTimerSeconds}
                  onTick={() => sounds.tick()}
                />
              )}
              <div className="deal-in" key={`${game.round}-${topCard ?? "none"}`}>
                <TrumpCard
                  editionId={editionId}
                  cardId={topCard}
                  size="full"
                  {...(yourTurn ? { onSelectStat: (stat: string) => void selectStat(stat) } : {})}
                  {...(pendingStat !== null ? { pendingStat } : {})}
                />
              </div>
            </div>
            <div className="hand-rest" aria-label={`${game.yourHand.length} cards in hand`}>
              {game.yourHand.slice(1, 8).map((_, i) => (
                <span
                  key={i}
                  className="hand-card-back"
                  style={{ "--i": i } as React.CSSProperties}
                />
              ))}
              <span className="hand-count" data-testid="hand-count">
                {game.yourHand.length}
              </span>
            </div>
          </div>
        )}
      </section>

      {!spectator && <EmoteBar />}

      {menuOpen && (
        <Dialog title="Game menu" onClose={() => setMenuOpen(false)}>
          {!spectator && !game.finished && (
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                setMenuOpen(false);
                void forfeit().catch(() => undefined);
              }}
            >
              Forfeit the game
            </button>
          )}
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setMenuOpen(false);
              void leaveRoom();
            }}
          >
            Leave room
          </button>
          <button type="button" className="button" onClick={() => setMenuOpen(false)}>
            Back to the game
          </button>
        </Dialog>
      )}
    </main>
  );
}
