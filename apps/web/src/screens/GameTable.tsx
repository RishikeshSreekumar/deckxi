/**
 * The game table (mobile-first), in the cardboard look (mockup turn 7): the
 * opponents in a row of seats, your top card as a cream piece whose stat rows
 * *are* the picker, and the rest of your hand fanned under it. On a desktop the
 * seats sit around a green field with the call in the middle, and your card
 * takes a column beside it.
 *
 * Power trumps adds two rows around your card: a picker for which of your
 * top three you play, and the three power chips. The leader still calls by
 * tapping a stat row; everyone else answers with a Play button (or, with
 * DRS armed, by tapping the stat they overrule with). Everything lives in
 * the same fixed shell, so a phone never has to scroll to find its move.
 *
 * The reveal happens on the table: every player's card — yours included —
 * turns face up in the middle where the call was, and the verdict rises from
 * the bottom edge. Nothing leaves the screen at the one moment the player is
 * watching it.
 */
import { useEffect, useRef, useState } from "react";
import {
  POWER_INFO,
  type PowerKindView,
  type PowerPlayView,
  type RoomView,
  type TurnTimerView,
} from "@deckxi/shared";
import type { ClientGameState, DeclaredPower, ResolvedRound } from "../game/clientGame.js";
import { Dialog, PowerCard, TrumpCard, formatStatValue, getCardInfo, statName } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { EmoteBar } from "../components/EmoteBar.js";
import { GameChat } from "../components/GameChat.js";
import { MuteButton, SmileIcon } from "../components/Chrome.js";
import { sounds } from "../lib/sounds.js";
import { haptics } from "../lib/haptics.js";

type Stage = "flip" | "verdict";

const POWER_ORDER: readonly PowerKindView[] = ["powerplay", "drs", "super-over"];

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
    // A round with powers in it has more to read; hold the verdict longer.
    const busy = round.power !== null && round.power.outcomes.length > 0;
    const verdictMs = revealTiming.verdictMs + (busy ? 1400 : 0);
    timers.current.push(
      window.setTimeout(() => {
        setStage("verdict");
        if (round.result.kind === "tie") {
          sounds.tie();
          haptics.lose();
        } else if (finalHolder(round) === selfId) {
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
      }, revealTiming.flipMs + verdictMs),
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

/** Who ended up with the round's cards once any Super Over has played out. */
function finalHolder(round: ResolvedRound): string | null {
  if (round.result.kind !== "won") return null;
  let holder: string = round.result.winner;
  for (const so of round.power?.superOvers ?? []) if (so.winner !== null) holder = so.winner;
  return holder;
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

/**
 * One seat's tally: the name, then the count as its own badge, so "Asha 9"
 * never reads as one word and a long name cannot push the number out of
 * sight. The label carries the full sentence for a screen reader.
 */
function ScoreChip({
  name,
  count,
  powers,
  className,
  testId,
}: {
  name: string;
  count: number;
  /** Power trumps: unused powers, shown as dots. */
  powers?: number | undefined;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={`score-chip ${className ?? ""}`.trim()}
      aria-label={`${name}: ${count} ${count === 1 ? "card" : "cards"}${
        powers === undefined ? "" : `, ${powers} ${powers === 1 ? "power" : "powers"} left`
      }`}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      <span className="score-chip-name" aria-hidden="true">
        {name}
      </span>
      {powers !== undefined && (
        <span className="score-chip-powers" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <i key={i} className={i < powers ? "power-dot power-dot--on" : "power-dot"} />
          ))}
        </span>
      )}
      <span className="score-chip-count" aria-hidden="true">
        {count}
      </span>
    </span>
  );
}

function powerLabel(power: DeclaredPower | null): string | null {
  return power === null ? null : POWER_INFO[power.kind].short;
}

/** Short first name for a card, for the picker chips. */
function cardShortName(editionId: string, cardId: string | null): string {
  if (cardId === null) return "—";
  const { player } = getCardInfo(editionId, cardId);
  const name = player?.name ?? cardId;
  const parts = name.split(/\s+/);
  return parts.length > 1 ? (parts.at(-1) as string) : name;
}

/** The lines the verdict adds for what the powers did. */
function powerLines(
  round: ResolvedRound,
  editionId: string,
  names: Record<string, string>,
  selfId: string | null,
): string[] {
  const power = round.power;
  if (power === null) return [];
  const who = (id: string) => (id === selfId ? "You" : (names[id] ?? id));
  const lines: string[] = [];
  if (power.drsBy !== null) {
    lines.push(
      `${who(power.drsBy)} called DRS: ${statName(editionId, round.stat)} overrules ${statName(editionId, power.calledStat)}`,
    );
  }
  for (const o of power.outcomes) {
    if (o.power === "drs") {
      lines.push(
        o.outcome === "won"
          ? `DRS stands — ${who(o.playerId)} lead${o.playerId === selfId ? "" : "s"} next`
          : `DRS fails — ${who(o.playerId)} give${o.playerId === selfId ? "" : "s"} one extra card`,
      );
    } else if (o.power === "powerplay") {
      lines.push(
        o.outcome === "won"
          ? `Powerplay pays: ${who(o.playerId)} take${o.playerId === selfId ? "" : "s"} one extra from everyone`
          : `Powerplay backfires: ${who(o.playerId)} give${o.playerId === selfId ? "" : "s"} one extra`,
      );
    } else if (o.outcome === "void") {
      lines.push(`${who(o.playerId)}: Super Over not needed — handed back`);
    }
  }
  for (const so of power.superOvers) {
    const c = formatStatValue(editionId, round.stat, so.challengerCard.value);
    const d = formatStatValue(editionId, round.stat, so.defenderCard.value);
    lines.push(
      so.winner === null
        ? `Super Over: ${who(so.challenger)} ${c} v ${d} — falls short, card lost`
        : `Super Over: ${who(so.challenger)} ${c} v ${d} — takes the lot!`,
    );
  }
  return lines;
}

/**
 * What the local player is asked to do right now, if anything.
 * `call`: leader, pick a stat. `answer`: responding, commit a card.
 */
function yourMove(
  game: ClientGameState,
  selfId: string | null,
  spectator: boolean,
  presenting: boolean,
): "call" | "answer" | null {
  if (spectator || selfId === null || game.finished || presenting) return null;
  if (game.phase === "selecting") return game.leader === selfId ? "call" : null;
  if (game.phase === "responding") {
    return game.active[selfId] && !(selfId in game.plays) ? "answer" : null;
  }
  return null;
}

export function GameTable({ room }: { room: RoomView }) {
  const selfId = useStore((s) => s.selfId);
  const spectator = useStore((s) => s.spectator);
  const game = useStore((s) => s.game);
  const timer = useStore((s) => s.timer);
  const pendingStat = useStore((s) => s.pendingStat);
  const selectStat = useStore((s) => s.selectStat);
  const playCard = useStore((s) => s.playCard);
  const forfeit = useStore((s) => s.forfeit);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const [menuOpen, setMenuOpen] = useState(false);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { current, stage } = useRevealPresenter(spectator ? null : selfId);

  // Power trumps: which of your top cards is face up, and the power armed
  // for it. Both reset when the round moves on.
  const [pick, setPick] = useState(0);
  const [armed, setArmed] = useState<PowerKindView | null>(null);
  const [sending, setSending] = useState(false);
  const roundKey = game === null ? "" : `${game.round}:${game.phase}`;
  useEffect(() => {
    setPick(0);
    setArmed(null);
    setSending(false);
  }, [roundKey]);

  const names: Record<string, string> = {};
  for (const p of room.players) names[p.id] = p.name;

  const move = game === null ? null : yourMove(game, selfId, spectator, current !== null);
  const yourTurn = move !== null;

  const activeTimer: TurnTimerView | null = current === null ? timer : null;
  const seconds = useCountdown(activeTimer?.deadline ?? null);
  const waitingOnYou =
    activeTimer !== null &&
    selfId !== null &&
    (activeTimer.waitingOn ?? [activeTimer.playerId]).includes(selfId);
  useTickSound(seconds, waitingOnYou);

  // Nudge when it becomes your move.
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

  const powerMode = game.config.mode === "power-trumps";
  const editionId = game.config.editionId;
  const opponents = game.config.players.filter((id) => id !== selfId);
  const hand = game.yourHand;
  const choices = hand === null ? [] : hand.slice(0, powerMode ? 3 : 1);
  const safePick = Math.min(pick, Math.max(0, choices.length - 1));

  // The store has already moved on to the next round while a reveal is
  // presenting, so your hand's top is the *next* card. Until the reveal has
  // played out, your face stays the card you put on the table — and once
  // you have committed a card this round, that is the one you look at.
  const playedCard =
    current !== null && !spectator
      ? (current.revealed.find((r) => r.playerId === selfId)?.cardId ?? null)
      : null;
  const topCard = playedCard ?? game.yourPlay?.cardId ?? choices[safePick] ?? hand?.[0] ?? null;
  const leaderName = game.leader === selfId ? "you" : (names[game.leader] ?? "…");

  // The engine's own numbers, not the edition's — the config is what resolved
  // the round, so the bars and the result can never disagree.
  const myStats = game.config.cards.find((c) => c.id === topCard)?.stats ?? null;

  const winnerId = current !== null && current.result.kind === "won" ? current.result.winner : null;
  const holderId = current !== null ? finalHolder(current) : null;
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

  const myPowers = selfId === null ? [] : (game.powers[selfId] ?? []);
  // The picker is live only while you still have a move to make with it.
  const pickerLocked = move === null || game.yourPlay !== null;
  const waitingNames = (timer?.waitingOn ?? [])
    .filter((id) => id !== selfId)
    .map((id) => names[id] ?? id);

  const commit = async (stat: string | null) => {
    if (sending || move === null) return;
    const cardIndex = safePick;
    const power: PowerPlayView | null =
      armed === null ? null : armed === "drs" ? { kind: "drs", stat: stat ?? "" } : { kind: armed };
    haptics.tap();
    if (move === "call") {
      if (stat === null) return;
      if (powerMode) await selectStat(stat, { cardIndex, power });
      else await selectStat(stat);
      return;
    }
    setSending(true);
    try {
      await playCard(cardIndex, power);
    } catch {
      setSending(false);
    }
  };

  const callLabel = game.finished
    ? "game over"
    : move === "call"
      ? "Your call — tap a stat"
      : move === "answer"
        ? armed === "drs"
          ? "DRS armed — tap the stat you overrule with"
          : "Your answer — pick a card, then play"
        : game.phase === "responding"
          ? waitingNames.length > 0
            ? `Waiting on ${waitingNames.join(", ")}…`
            : "All cards in…"
          : `Waiting on ${leaderName}…`;

  return (
    <main
      className={`screen table-screen ${powerMode ? "table-screen--power" : ""}`.trim()}
      data-testid="game-table"
      data-mode={game.config.mode}
    >
      <TableHead
        round={current?.round ?? game.round}
        maxRounds={game.config.maxRounds}
        seconds={current === null && !game.finished ? seconds : null}
        urgent={seconds !== null && seconds <= 5}
        label={
          current === null
            ? move === "answer"
              ? "your answer"
              : "your call"
            : stage === "flip"
              ? "revealing"
              : "round over"
        }
      />

      <div className="score-strip" aria-label="Cards in hand">
        {!spectator && (
          <ScoreChip
            name="You"
            count={game.handCounts[selfId ?? ""] ?? 0}
            powers={powerMode ? myPowers.length : undefined}
            className="score-chip--mine"
          />
        )}
        {opponents.map((id) => (
          <ScoreChip
            key={id}
            name={names[id] ?? id}
            count={game.handCounts[id] ?? 0}
            powers={powerMode ? (game.powers[id] ?? []).length : undefined}
            className={game.active[id] ? "" : "score-chip--out"}
            testId={`cards-${id}`}
          />
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
            const play = game.plays[id];
            const declared = play === undefined ? null : powerLabel(play.power);
            const status = out
              ? "out"
              : away
                ? "away"
                : current !== null
                  ? stage === "flip"
                    ? "flipping…"
                    : current.result.kind === "tie"
                      ? "tie"
                      : id === holderId
                        ? "takes it"
                        : "short"
                  : isLeader
                    ? game.phase === "responding"
                      ? "called"
                      : "picking…"
                    : game.phase === "responding"
                      ? play !== undefined
                        ? "played"
                        : "thinking…"
                      : "waiting";
            return (
              <div
                key={id}
                className={[
                  "seat",
                  out ? "seat--out" : "",
                  isLeader ? "seat--leader" : "",
                  stage === "verdict" && id === holderId ? "seat--winner" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--seat-index": index } as React.CSSProperties}
                data-testid={`seat-${id}`}
              >
                <span className="seat-avatar" aria-hidden="true">
                  {(names[id] ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="seat-plate">
                  <span className="seat-name">{names[id] ?? id}</span>
                  <span className="seat-status">
                    {status}
                    {declared !== null && current === null && (
                      <b
                        className="seat-power"
                        title={play?.power ? POWER_INFO[play.power.kind].name : ""}
                      >
                        {declared}
                      </b>
                    )}
                  </span>
                </div>
                <div
                  className={`seat-card seat-card--down ${
                    (reveal !== undefined && current !== null) || play !== undefined
                      ? "seat-card--played"
                      : ""
                  }`}
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
              {current.power?.drsBy != null
                ? `DRS · ${statName(editionId, current.stat)} overrules ${statName(editionId, current.power.calledStat)}`
                : `${statName(editionId, current.stat)} · cards on the table`}
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
              {callLabel}
            </span>
            <span className="called-stat">
              {hotStat !== null
                ? statName(editionId, hotStat)
                : powerMode && game.lastStat !== null
                  ? `Not ${statName(editionId, game.lastStat)} again`
                  : "Pick a stat"}
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
        <div className="hand-top">
          {!spectator && hand !== null && hand.length > 0 && (
            <span className="hand-count" data-testid="hand-count">
              {hand.length}
              <small>in hand</small>
            </span>
          )}
          {powerMode && !spectator && hand !== null && choices.length > 1 && (
            <div className="hand-pick-row">
              <span className="hand-pick-label">
                {pickerLocked ? "Playing" : "Your top 3 — tap to swap"}
              </span>
              <div
                className={`hand-picker ${pickerLocked ? "hand-picker--locked" : ""}`.trim()}
                role="radiogroup"
                aria-label="Which card to play"
                data-testid="hand-picker"
              >
                {choices.map((cardId, index) => {
                  const committed = game.yourPlay?.cardId ?? playedCard;
                  const on = committed !== null ? committed === cardId : index === safePick;
                  return (
                    <button
                      key={`${index}-${cardId ?? "?"}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? "pick-chip pick-chip--on" : "pick-chip"}
                      disabled={pickerLocked}
                      data-testid={`pick-${index}`}
                      onClick={() => {
                        haptics.tap();
                        setPick(index);
                      }}
                    >
                      <i>{index + 1}</i>
                      <span>{cardShortName(editionId, cardId)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <section
          className={[
            "your-area",
            yourTurn ? "your-area--turn" : "",
            current !== null ? "your-area--waiting" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {spectator || hand === null ? (
            <p className="hint">Spectating — {game.config.players.length} players in the match.</p>
          ) : hand.length === 0 ? (
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
                  {...(move === "call" && powerMode && game.lastStat !== null
                    ? { disabledStats: [game.lastStat] }
                    : {})}
                  {...(move === "call" || (move === "answer" && armed === "drs")
                    ? {
                        onSelectStat: (key: string) => {
                          void commit(key);
                        },
                      }
                    : {})}
                />
              </div>
            </>
          )}
        </section>
        {powerMode && !spectator && hand !== null && hand.length > 0 ? (
          <div className="power-row" data-testid="power-row">
            <div className="power-chips" role="group" aria-label="Power cards">
              {POWER_ORDER.map((kind) => {
                const info = POWER_INFO[kind];
                const spent = !myPowers.includes(kind);
                const declared = game.yourPlay?.power?.kind === kind;
                // DRS answers a call; the leader has nothing to overrule.
                const usable = !spent && move !== null && !(kind === "drs" && move === "call");
                const on = declared || armed === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={on}
                    className={[
                      "power-chip",
                      `power-chip--${kind}`,
                      on ? "power-chip--on" : "",
                      spent ? "power-chip--spent" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!usable}
                    title={`${info.name}: ${info.blurb}`}
                    aria-label={`${info.name}${spent ? " (used)" : ""}: ${info.blurb}`}
                    data-testid={`power-${kind}`}
                    onClick={() => {
                      haptics.tap();
                      setArmed(armed === kind ? null : kind);
                    }}
                  >
                    <b>{info.short}</b>
                    <span>{info.name}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="icon-button power-help"
                aria-label="How the powers work"
                onClick={() => setRulesOpen(true)}
              >
                ?
              </button>
            </div>
            {move === "answer" && armed !== "drs" && (
              <button
                type="button"
                className="button button--primary play-button"
                disabled={sending}
                data-testid="play-card"
                onClick={() => void commit(null)}
              >
                {sending
                  ? "Playing…"
                  : armed !== null
                    ? `Play · ${POWER_INFO[armed].name}`
                    : hotStat !== null
                      ? `Play this card on ${statName(editionId, hotStat)}`
                      : "Play this card"}
              </button>
            )}
            {move === null && game.yourPlay !== null && current === null && (
              <p className="power-note" role="status">
                Card in
                {game.yourPlay.power ? ` with ${POWER_INFO[game.yourPlay.power.kind].name}` : ""}.
                {waitingNames.length > 0 ? ` Waiting on ${waitingNames.join(", ")}…` : ""}
              </p>
            )}
          </div>
        ) : (
          hand !== null &&
          hand.length > 1 && (
            <div className="hand-fan" aria-hidden="true">
              {Array.from({ length: Math.min(3, hand.length - 1) }, (_, i) => (
                <span key={i} className="hand-fan-card" />
              ))}
              <span className="hand-fan-card hand-fan-card--face">XI</span>
            </div>
          )
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
            className={`verdict-sheet ${holderId === selfId && !spectator ? "verdict-sheet--won" : ""}`}
            data-testid="verdict"
            role="status"
          >
            <p className="verdict-title">
              {current.result.kind === "tie"
                ? "Tie — cards go to the pot"
                : holderId === selfId && !spectator
                  ? "You take the round"
                  : `${names[holderId ?? ""] ?? "Someone"} takes it`}
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
            {current.power !== null && (
              <ul className="verdict-powers" data-testid="verdict-powers">
                {powerLines(current, editionId, names, spectator ? null : selfId).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
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

      {rulesOpen && (
        <Dialog title="Power trumps" onClose={() => setRulesOpen(false)}>
          <ul className="power-legend">
            <li>
              <strong>Your play</strong>
              <span className="sub">
                Pick any of your top three cards. The leader calls a stat, but never the one that
                decided the last round. The call goes round the table.
              </span>
            </li>
            <li>
              <strong>Every power is a bet</strong>
              <span className="sub">
                Works: a big win. Fails: exactly one extra card. One power per round, each once a
                game.
              </span>
            </li>
          </ul>
          <div className="power-card-row-strip" aria-label="Power cards">
            {POWER_ORDER.map((kind) => (
              <PowerCard
                key={kind}
                kind={kind}
                size="full"
                spent={!spectator && !myPowers.includes(kind)}
              />
            ))}
          </div>
          <button type="button" className="button" onClick={() => setRulesOpen(false)}>
            Got it
          </button>
        </Dialog>
      )}

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
