/**
 * The game table (mobile-first), in the cardboard look (mockup turn 7): the
 * opponents in a row of seats, your top card as a cream piece whose stat rows
 * *are* the picker, and the rest of your hand fanned under it. On a desktop the
 * seats sit around a green field with the call in the middle, and your card
 * takes a column beside it.
 *
 * The reveal happens on the table: every player's card — yours included —
 * turns face up in the middle where the call was, and the verdict rises from
 * the bottom edge. Nothing leaves the screen at the one moment the player is
 * watching it.
 */
import { useEffect, useRef, useState } from "react";
import type { RoomView, TurnTimerView } from "@deckxi/shared";
import type { ResolvedRound } from "../game/clientGame.js";
import { Dialog, TrumpCard, formatStatValue, statName } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { EmoteBar } from "../components/EmoteBar.js";
import { GameChat } from "../components/GameChat.js";
import { MuteButton, SmileIcon } from "../components/Chrome.js";
import { sounds } from "../lib/sounds.js";
import { haptics } from "../lib/haptics.js";

type Stage = "flip" | "verdict";

/**
 * How long each beat of the reveal holds. Mutable so the visual-regression
 * fixtures can freeze the verdict for a screenshot instead of racing it;
 * nothing in the running app writes to it.
 */
export const revealTiming = { flipMs: 1100, verdictMs: 2100 };

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
        if (round.result.kind === "tie") {
          sounds.tie();
          haptics.lose();
        } else if (round.result.winner === selfId) {
          sounds.roundWin();
          haptics.win();
        } else {
          sounds.roundLose();
          haptics.lose();
        }
      }, revealTiming.flipMs),
      window.setTimeout(() => {
        setCurrent(null);
        setPresenting(false);
      }, revealTiming.flipMs + revealTiming.verdictMs),
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

/**
 * Whole seconds left on the server deadline. The design shows the countdown as
 * a number and a draining bar rather than a ring, so the ring's own clock is
 * not reusable here — but the deadline is still the server's, so drift only
 * ever affects the picture.
 */
function useCountdown(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const read = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    read();
    const id = setInterval(read, 200);
    return () => clearInterval(id);
  }, [deadline]);

  return left;
}

/** Tick on each of the last five seconds — the old TimerRing's onTick beat. */
function useTickSound(seconds: number | null, active: boolean): void {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!active || seconds === null) {
      last.current = null;
      return;
    }
    if (seconds !== last.current && seconds <= 5 && seconds > 0) sounds.tick();
    last.current = seconds;
  }, [seconds, active]);
}

function TableHead({
  round,
  maxRounds,
  seconds,
  urgent,
  label,
}: {
  round: number;
  maxRounds: number;
  seconds: number | null;
  urgent: boolean;
  label: string;
}) {
  return (
    <header className="table-head">
      <span className="table-wordmark">
        Deck<span>XI</span>
      </span>
      <span className="round-chip" data-testid="round-chip">
        Round {round} of {maxRounds}
      </span>
      <span
        className={`turn-timer ${urgent ? "turn-timer--urgent" : ""}`}
        {...(seconds !== null ? { role: "timer" } : {})}
      >
        {seconds !== null ? `${seconds}s` : label}
      </span>
    </header>
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
  const [emotesOpen, setEmotesOpen] = useState(false);
  const { current, stage } = useRevealPresenter(spectator ? null : selfId);

  const names: Record<string, string> = {};
  for (const p of room.players) names[p.id] = p.name;

  const yourTurn =
    !spectator && game !== null && !game.finished && game.leader === selfId && current === null;

  const activeTimer: TurnTimerView | null = current === null ? timer : null;
  const seconds = useCountdown(activeTimer?.deadline ?? null);
  useTickSound(seconds, activeTimer !== null && activeTimer.playerId === selfId);

  // Nudge when it becomes your pick.
  const nudged = useRef(false);
  useEffect(() => {
    if (yourTurn && !nudged.current) {
      nudged.current = true;
      sounds.yourTurn();
      haptics.yourTurn();
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
  // The store has already moved on to the next round while a reveal is
  // presenting, so your hand's top is the *next* card. Until the reveal has
  // played out, your face stays the card you put on the table.
  const playedCard =
    current !== null && !spectator
      ? (current.revealed.find((r) => r.playerId === selfId)?.cardId ?? null)
      : null;
  const topCard = playedCard ?? game.yourHand?.[0] ?? null;
  const leaderName = game.leader === selfId ? "you" : (names[game.leader] ?? "…");

  // The engine's own numbers, not the edition's — the config is what resolved
  // the round, so the bars and the result can never disagree.
  const myStats = game.config.cards.find((c) => c.id === topCard)?.stats ?? null;

  const winnerId = current !== null && current.result.kind === "won" ? current.result.winner : null;
  const revealedBy: Record<string, { cardId: string; value: number }> = {};
  if (current !== null) {
    for (const r of current.revealed) revealedBy[r.playerId] = { cardId: r.cardId, value: r.value };
  }

  // The stat under the spotlight: the round being revealed, else your own
  // optimistic pick, else whatever the leader has locked in.
  const hotStat = current?.stat ?? pendingStat ?? game.selected?.stat ?? null;

  // The bar drains with the turn timer.
  const totalSeconds = room.settings.turnTimerSeconds;
  const meter =
    seconds !== null && totalSeconds > 0
      ? `${Math.round(Math.min(1, seconds / totalSeconds) * 100)}%`
      : "100%";

  return (
    <main className="screen table-screen" data-testid="game-table">
      <TableHead
        round={game.round}
        maxRounds={game.config.maxRounds}
        seconds={current === null && !game.finished ? seconds : null}
        urgent={seconds !== null && seconds <= 5}
        label={current === null ? "your call" : stage === "flip" ? "revealing" : "round over"}
      />

      <div className="score-strip" aria-label="Cards in hand">
        {!spectator && (
          <span className="score-chip score-chip--mine">
            You {game.handCounts[selfId ?? ""] ?? 0}
          </span>
        )}
        {opponents.map((id) => (
          <span
            key={id}
            className={`score-chip ${game.active[id] ? "" : "score-chip--out"}`}
            data-testid={`cards-${id}`}
          >
            {names[id] ?? id} {game.handCounts[id] ?? 0}
          </span>
        ))}
      </div>

      <section
        className="table-field"
        aria-label="Table"
        data-testid={current !== null ? "reveal" : undefined}
      >
        <div className="field-seats">
          {opponents.map((id, index) => {
            const isLeader = game.leader === id && !game.finished && current === null;
            const away = room.players.find((p) => p.id === id)?.connected === false;
            const out = !game.active[id];
            const reveal = revealedBy[id];
            const status = out
              ? "out"
              : away
                ? "away"
                : current !== null
                  ? stage === "flip"
                    ? "flipping…"
                    : current.result.kind === "tie"
                      ? "tie"
                      : id === winnerId
                        ? "takes it"
                        : "short"
                  : isLeader
                    ? "picking…"
                    : "waiting";
            return (
              <div
                key={id}
                className={[
                  "seat",
                  out ? "seat--out" : "",
                  isLeader ? "seat--leader" : "",
                  stage === "verdict" && id === winnerId ? "seat--winner" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--seat-index": index } as React.CSSProperties}
              >
                <span className="seat-avatar" aria-hidden="true">
                  {(names[id] ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="seat-plate">
                  <span className="seat-name">{names[id] ?? id}</span>
                  <span className="seat-status">{status}</span>
                </div>
                <div
                  className={`seat-card seat-card--down ${reveal !== undefined && current !== null ? "seat-card--played" : ""}`}
                  aria-hidden="true"
                >
                  XI
                </div>
              </div>
            );
          })}
        </div>

        {current !== null ? (
          <div className="reveal-panel" data-testid="reveal-cards">
            <span className="called-label" data-testid="turn-line">
              {statName(editionId, current.stat)} · cards on the table
            </span>
            <ul className="reveal-cards">
              {current.revealed.map((r, index) => {
                const isSelf = r.playerId === selfId && !spectator;
                const won = stage === "verdict" && r.playerId === winnerId;
                return (
                  <li
                    key={r.playerId}
                    className={[
                      "reveal-card",
                      isSelf ? "reveal-card--mine" : "",
                      won ? "reveal-card--win" : "",
                      stage === "verdict" && !won && current.result.kind === "won"
                        ? "reveal-card--lost"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ "--seat-index": index } as React.CSSProperties}
                    data-testid={`reveal-card-${r.playerId}`}
                  >
                    <span className="reveal-card-owner">
                      {isSelf ? "You" : (names[r.playerId] ?? r.playerId)}
                    </span>
                    <TrumpCard
                      editionId={editionId}
                      cardId={r.cardId}
                      size="hand"
                      highlightStat={current.stat}
                      stats={{ [current.stat]: r.value }}
                      {...(won
                        ? { outcome: "winner" as const }
                        : stage === "verdict" && current.result.kind === "won"
                          ? { outcome: "loser" as const }
                          : {})}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="called-panel">
            <span className="called-label" data-testid="turn-line">
              {game.finished
                ? "game over"
                : yourTurn
                  ? "Your call — tap a stat"
                  : `Waiting on ${leaderName}…`}
            </span>
            <span className="called-stat">
              {hotStat !== null ? statName(editionId, hotStat) : "Pick a stat"}
            </span>
            <span className="called-meter" aria-hidden="true">
              <span style={{ width: meter }} />
            </span>
            {game.pot.length > 0 && (
              <span className="called-pot">{game.pot.length} in the pot</span>
            )}
          </div>
        )}
      </section>

      {/* .your-hand carries the fanned backs of the rest of your hand; the card
          face inside it scrolls its own stat rows, so the backs cannot live on
          it or they would scroll away with the table. */}
      <div className="your-hand">
        {!spectator && game.yourHand !== null && game.yourHand.length > 0 && (
          <span className="hand-count" data-testid="hand-count">
            {game.yourHand.length}
            <small>in hand</small>
          </span>
        )}
        <section
          className={[
            "your-area",
            yourTurn ? "your-area--turn" : "",
            current !== null ? "your-area--waiting" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {spectator || game.yourHand === null ? (
            <p className="hint">Spectating — {game.config.players.length} players in the match.</p>
          ) : game.yourHand.length === 0 ? (
            <p className="hint">
              You're out of cards{game.active[selfId ?? ""] ? "" : " — eliminated"}.
            </p>
          ) : (
            <>
              <div className="hand-face" key={topCard ?? "none"}>
                <TrumpCard
                  editionId={editionId}
                  cardId={topCard}
                  size="full"
                  {...(myStats !== null ? { stats: myStats } : {})}
                  {...(hotStat !== null ? { highlightStat: hotStat } : {})}
                  {...(yourTurn
                    ? {
                        onSelectStat: (key: string) => {
                          haptics.tap();
                          void selectStat(key);
                        },
                      }
                    : {})}
                />
              </div>
            </>
          )}
        </section>
        {game.yourHand !== null && game.yourHand.length > 1 && (
          <div className="hand-fan" aria-hidden="true">
            {Array.from({ length: Math.min(3, game.yourHand.length - 1) }, (_, i) => (
              <span key={i} className="hand-fan-card" />
            ))}
            <span className="hand-fan-card hand-fan-card--face">XI</span>
          </div>
        )}
      </div>

      <div className="table-social">
        {emotesOpen && !spectator && (
          <div className="emote-tray">
            <EmoteBar />
          </div>
        )}
        {current !== null && stage === "verdict" && (
          <div
            className={`verdict-sheet ${winnerId === selfId && !spectator ? "verdict-sheet--won" : ""}`}
            data-testid="verdict"
            role="status"
          >
            <p className="verdict-title">
              {current.result.kind === "tie"
                ? "Tie — cards go to the pot"
                : winnerId === selfId && !spectator
                  ? "You take the round"
                  : `${names[winnerId ?? ""] ?? "Someone"} takes it`}
            </p>
            <p className="verdict-sub">
              {statName(editionId, current.stat)}
              {" · "}
              {current.result.kind === "tie"
                ? `${current.revealed.length} cards to the pot`
                : `${formatStatValue(editionId, current.stat, current.revealed.find((r) => r.playerId === winnerId)?.value ?? 0)} was the number`}
              {current.potTaken > 0 && winnerId === selfId && !spectator
                ? ` · +${current.potTaken} from the pot`
                : ""}
            </p>
          </div>
        )}

        <MuteButton />
        <button
          type="button"
          className="icon-button"
          aria-label="Menu"
          onClick={() => setMenuOpen(true)}
        >
          ⋯
        </button>
        {!spectator && (
          <button
            type="button"
            className="icon-button icon-button--accent"
            aria-label={emotesOpen ? "Hide reactions" : "Reactions"}
            aria-expanded={emotesOpen}
            onClick={() => setEmotesOpen(!emotesOpen)}
          >
            <SmileIcon />
          </button>
        )}
        <GameChat />
      </div>

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
