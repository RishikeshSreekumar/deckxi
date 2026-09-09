/**
 * The game table (mobile-first), in the cardboard look (mockup turn 7): the
 * opponents in a row of seats, your top card as a cream piece whose stat rows
 * *are* the picker, and the rest of your hand fanned under it. On a desktop the
 * seats sit around a green field with the call in the middle, and your card
 * takes a column beside it.
 *
 * Power trumps adds two rows around your card: a picker for which of your
 * top cards you play (two by default, the host's call), and the three power chips. Every move is two taps
 * (#130): the leader taps a stat row to arm it and a Call button to send it
 * (tapping the armed row again also sends); everyone else picks a card and
 * taps Play (with DRS armed, they tap the stat they overrule with first).
 * Nothing on the table is decided by a single tap. Everything lives in the
 * same fixed shell, so a phone never has to scroll to find its move.
 *
 * The reveal happens on the table: every player's card — yours included —
 * turns face up in the middle where the call was, and the verdict rises from
 * the bottom edge. Nothing leaves the screen at the one moment the player is
 * watching it.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  POWER_INFO,
  type PowerKindView,
  type PowerPlayView,
  type RoomView,
  type TurnTimerView,
} from "@deckxi/shared";
import type { ClientGameState, DeclaredPower, ResolvedRound } from "../game/clientGame.js";
import { Dialog, TrumpCard, formatStatValue, getCardInfo, statName } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { EmoteBar } from "../components/EmoteBar.js";
/**
 * Voice is opt-in and needs WebRTC plumbing nobody who never taps "join voice"
 * should download (#107's budget, #89's feature): the controls are their own
 * chunk, and the table renders without them until they arrive.
 */
const VoiceControls = lazy(() =>
  import("../components/VoiceControls.js").then((m) => ({ default: m.VoiceControls })),
);
import { GameChat } from "../components/GameChat.js";
import { MuteButton, SmileIcon } from "../components/Chrome.js";
/** The log and the rules sheet: reading matter, loaded when someone asks. */
const RoundLog = lazy(() =>
  import("../components/RoundLog.js").then((m) => ({ default: m.RoundLog })),
);
/** The power-card legend: only power trumps, only on the "?" tap. */
const PowerRules = lazy(() =>
  import("../components/PowerRules.js").then((m) => ({ default: m.PowerRules })),
);
const HowToPlay = lazy(() =>
  import("../components/HowToPlay.js").then((m) => ({ default: m.HowToPlay })),
);
import { sounds } from "../lib/sounds.js";
import { haptics } from "../lib/haptics.js";
import { powerLines } from "../game/powerLines.js";
import { ordinal, revealTiming } from "./tableShared.js";
import "./gameTable.css";
import { loadPowersSeen, savePowersSeen } from "../lib/session.js";

type Stage = "flip" | "verdict";

const POWER_ORDER: readonly PowerKindView[] = ["powerplay", "drs", "super-over"];

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
  const voiceLive = useStore((s) => s.voiceLive);
  const [menuOpen, setMenuOpen] = useState(false);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // First power game in this browser: open the power cards once, before the
  // first call, so the chips are not three cryptic badges (#131).
  const powerModeNow = game?.config.mode === "power-trumps";
  useEffect(() => {
    if (!powerModeNow || spectator || loadPowersSeen()) return;
    savePowersSeen();
    setRulesOpen(true);
  }, [powerModeNow, spectator]);
  const [howToOpen, setHowToOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const { current, stage } = useRevealPresenter(spectator ? null : selfId);

  // Power trumps: which of your top cards is face up, and the power armed
  // for it. Both reset when the round moves on.
  const [pick, setPick] = useState(0);
  const [armed, setArmed] = useState<PowerKindView | null>(null);
  // The stat you have tapped but not yet sent — the leader's call, or the
  // stat a DRS reviews on. A second tap on the row, or the Call/Play button,
  // is what commits it (#130: a mis-tap on a stat row used to decide the round).
  const [armedStat, setArmedStat] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const roundKey = game === null ? "" : `${game.round}:${game.phase}`;
  useEffect(() => {
    setPick(0);
    setArmed(null);
    setArmedStat(null);
    setSending(false);
  }, [roundKey]);

  const names: Record<string, string> = {};
  for (const p of room.players) names[p.id] = p.name;

  const move = game === null ? null : yourMove(game, selfId, spectator, current !== null);
  const yourTurn = move !== null;

  const activeTimer: TurnTimerView | null = current === null ? timer : null;
  // The server's deadline includes the reveal hold, so the raw count can
  // read 34s on a 30s timer; the display never exceeds the setting.
  const rawSeconds = useCountdown(activeTimer?.deadline ?? null);
  const seconds =
    rawSeconds === null ? null : Math.min(rawSeconds, Math.max(1, room.settings.turnTimerSeconds));
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

  // The tab title says so too, for a player who switched away (#136).
  const baseTitle = useRef<string | null>(null);
  useEffect(() => {
    baseTitle.current ??= document.title;
    document.title = yourTurn ? `● Your move · ${baseTitle.current}` : baseTitle.current;
    return () => {
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, [yourTurn]);

  if (game === null) {
    return (
      <main className="screen table-screen">
        <p className="hint">Dealing…</p>
      </main>
    );
  }

  const powerMode = game.config.mode === "power-trumps";
  // While the cards are still flipping the tallies stay as they were: the
  // playtest's whole table read the winner off the score strip before a
  // single card turned. They catch up with the verdict.
  const counts = current !== null && stage === "flip" ? current.countsBefore : game.handCounts;
  const editionId = game.config.editionId;
  const opponents = game.config.players.filter((id) => id !== selfId);
  const hand = game.yourHand;
  // Old logs carry no choice depth; they were played with the top three.
  const choiceDepth = powerMode ? (game.config.choiceDepth ?? 3) : 1;
  const choices = hand === null ? [] : hand.slice(0, choiceDepth);
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
  // optimistic pick, else whatever the leader has locked in, else the stat
  // you have armed but not sent.
  const hotStat = current?.stat ?? pendingStat ?? game.selected?.stat ?? armedStat ?? null;
  const armedOnly =
    current === null && pendingStat === null && game.selected === null && armedStat !== null;

  // The bar drains with the turn timer.
  const totalSeconds = room.settings.turnTimerSeconds;
  const meter =
    seconds !== null && totalSeconds > 0
      ? `${Math.round(Math.min(1, seconds / totalSeconds) * 100)}%`
      : "100%";

  const myPowers = selfId === null ? [] : (game.powers[selfId] ?? []);
  // The bet slip (#131): what the armed power will do with *your* cards. The
  // extra card a lost bet costs is your next top card once the chosen one
  // has gone; "the winner" is whoever that turns out to be.
  const nextCard = hand?.filter((_, i) => i !== safePick)[0] ?? null;
  const nextName =
    nextCard === null || nextCard === undefined
      ? "your next card"
      : cardShortName(editionId, nextCard);
  const rivals = game.config.players
    .filter((id) => id !== selfId && game.active[id])
    .map((id) => names[id] ?? id);
  const rivalList =
    rivals.length <= 3
      ? rivals.join(", ")
      : `${rivals.slice(0, 2).join(", ")} and ${rivals.length - 2} more`;
  const slipStat = hotStat !== null ? statName(editionId, hotStat) : "the called stat";
  const betSlip =
    armed === null || move === null
      ? null
      : armed === "powerplay"
        ? `Win → take 1 extra card from each of ${rivalList}. Lose → ${nextName} goes to the winner. Tie → it goes to the pot.`
        : armed === "drs"
          ? armedStat === null
            ? `Tap the stat to review on. Win → your stat decides, you take the pot and lead next. Lose → ${nextName} goes to the winner.`
            : `${statName(editionId, armedStat)} decides instead of ${slipStat}. Win → the pot, and you lead next. Lose → ${nextName} goes to the winner.`
          : `Only if you lose: ${nextName} plays the winner's next card on ${slipStat}. Beat it → everything they won is yours. Miss → ${nextName} is theirs too.`;
  // The picker is live only while you still have a move to make with it.
  const pickerLocked = move === null || game.yourPlay !== null;
  const waitingNames = (timer?.waitingOn ?? [])
    .filter((id) => id !== selfId)
    .map((id) => names[id] ?? id);

  const commit = async (stat: string | null) => {
    if (sending || move === null) return;
    const cardIndex = safePick;
    const reviewStat = stat ?? armedStat;
    if (armed === "drs" && reviewStat === null) return;
    const power: PowerPlayView | null =
      armed === null
        ? null
        : armed === "drs"
          ? { kind: "drs", stat: reviewStat ?? "" }
          : { kind: armed };
    haptics.tap();
    if (move === "call") {
      if (stat === null) return;
      setSending(true);
      if (powerMode) await selectStat(stat, { cardIndex, power });
      else await selectStat(stat);
      setSending(false);
      return;
    }
    setSending(true);
    try {
      await playCard(cardIndex, power);
    } catch {
      setSending(false);
    }
  };

  // A stat row tap arms the stat; tapping the armed row again sends it.
  const armStat = (key: string) => {
    if (armedStat === key) {
      void commit(key);
      return;
    }
    haptics.tap();
    setArmedStat(key);
  };

  // The centre of the table says two things, in this order: whose move it
  // is (big), then what to do about it (small). The playtest had it the other
  // way round — "Pick a stat" in bold on every screen with a draining bar
  // under it — and three players spent turns jabbing at a card that was not
  // theirs to play.
  const out = !spectator && selfId !== null && !game.active[selfId];
  const leaderIsYou = game.leader === selfId && !spectator;
  // One word for the whole screen to key its look off (#136): the table
  // looks different when it is your move, not just the headline.
  const turnState = game.finished
    ? "over"
    : current !== null
      ? "reveal"
      : move !== null
        ? "yours"
        : out
          ? "out"
          : "theirs";
  const leaderName = names[game.leader] ?? "…";
  const headline = game.finished
    ? "Game over"
    : move === "call"
      ? "Your call"
      : move === "answer"
        ? "Your answer"
        : out
          ? "You're out"
          : game.phase === "responding"
            ? waitingNames.length > 0
              ? `Waiting on ${waitingNames.join(", ")}`
              : "All cards in"
            : leaderIsYou
              ? "Your call"
              : `Waiting for ${leaderName}`;
  const instruction = game.finished
    ? ""
    : move === "call"
      ? armedStat !== null
        ? "Tap Call to lock it in — or another stat to change"
        : powerMode && game.burnedStats.length > 0
          ? `Tap a stat on your card, then Call — ${game.burnedStats.length === 1 ? "1 stat is" : `${game.burnedStats.length} stats are`} burned`
          : "Tap a stat on your card, then Call"
      : move === "answer"
        ? armed === "drs"
          ? armedStat !== null
            ? `Tap Play to review on ${statName(editionId, armedStat)}`
            : "DRS armed — tap the stat you overrule with"
          : "Pick a card, then play it"
        : hotStat !== null
          ? `${leaderIsYou ? "You" : (names[game.selected?.playerId ?? game.leader] ?? "They")} called ${statName(editionId, hotStat)}`
          : out
            ? "Spectating until the match ends"
            : powerMode
              ? `${leaderName} is picking a stat — your turn to answer comes next`
              : `${leaderName} is picking a stat — your top card plays itself`;

  // The leader's send button. Disabled until a stat is armed, so its label
  // doubles as the instruction on a phone where the centre panel is small.
  const callButton = (
    <button
      type="button"
      className="button button--primary play-button call-button"
      disabled={sending || armedStat === null}
      data-testid="call-stat"
      onClick={() => void commit(armedStat)}
    >
      {sending
        ? "Calling…"
        : armedStat === null
          ? "Tap a stat to call"
          : `Call ${statName(editionId, armedStat)}${armed !== null ? ` · ${POWER_INFO[armed].name}` : ""}`}
    </button>
  );

  return (
    <main
      className={`screen table-screen ${powerMode ? "table-screen--power" : ""}`.trim()}
      data-testid="game-table"
      data-mode={game.config.mode}
      data-turn={turnState}
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
            count={counts[selfId ?? ""] ?? 0}
            powers={powerMode ? myPowers.length : undefined}
            className="score-chip--mine"
          />
        )}
        {opponents.map((id) => (
          <ScoreChip
            key={id}
            name={names[id] ?? id}
            count={counts[id] ?? 0}
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
            // Whoever the table is waiting on wears the clock: the leader while
            // they pick, every seat still to answer while cards come in.
            const onClock =
              current === null &&
              !game.finished &&
              game.active[id] === true &&
              (game.phase === "selecting" ? game.leader === id : !(id in game.plays));
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
                        : "beaten"
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
                  onClock ? "seat--clock" : "",
                  stage === "verdict" && id === holderId ? "seat--winner" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={
                  {
                    "--seat-index": index,
                    ...(onClock && seconds !== null ? { "--seat-meter": meter } : {}),
                  } as React.CSSProperties
                }
                data-testid={`seat-${id}`}
              >
                <span className="seat-avatar" aria-hidden="true">
                  {(names[id] ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="seat-plate">
                  <span className="seat-name">
                    {names[id] ?? id}
                    {voiceLive.includes(id) && (
                      <span
                        className="seat-mic"
                        title={`${names[id] ?? "This player"} has a live mic`}
                        aria-label="live mic"
                      >
                        ●
                      </span>
                    )}
                  </span>
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
                : `${statName(editionId, current.stat)}${current.auto ? " · the timer's pick" : ""} · cards on the table`}
            </span>
            <ul
              className={`reveal-cards ${current.revealed.length > 3 ? "reveal-cards--many" : ""}`.trim()}
              style={{ "--reveal-count": current.revealed.length } as React.CSSProperties}
            >
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
            {/* The same reveal as a line each, for a phone with five cards on
                it — and a comparison anyone can read at a glance. */}
            <ol className="reveal-values" aria-label="Values played">
              {current.revealed.map((r) => {
                const isSelf = r.playerId === selfId && !spectator;
                const won = stage === "verdict" && r.playerId === winnerId;
                return (
                  <li
                    key={r.playerId}
                    className={won ? "reveal-value reveal-value--win" : "reveal-value"}
                  >
                    <span className="reveal-value-who">
                      {isSelf ? "You" : (names[r.playerId] ?? r.playerId)}
                    </span>
                    <span className="reveal-value-card">{cardShortName(editionId, r.cardId)}</span>
                    <b>{formatStatValue(editionId, current.stat, r.value)}</b>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div
            className={`called-panel ${yourTurn ? "called-panel--yours" : ""}`.trim()}
            data-turn={yourTurn ? "yours" : "theirs"}
          >
            <span className="called-stat" data-testid="turn-line">
              {hotStat !== null ? statName(editionId, hotStat) : headline}
            </span>
            <span className="called-label">
              {hotStat !== null && !armedOnly ? headline : instruction}
            </span>
            {waitingOnYou && (
              <span className="called-meter" aria-hidden="true">
                <span style={{ width: meter }} />
              </span>
            )}
            {game.pot.length > 0 && (
              <span className="called-pot">{game.pot.length} in the pot</span>
            )}
            {powerMode && game.burnedStats.length > 0 && (
              <ul className="burned-tray" aria-label="Burned stats" data-testid="burned-tray">
                {game.burnedStats.map((key) => (
                  <li key={key}>{statName(editionId, key)}</li>
                ))}
              </ul>
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
              {counts[selfId ?? ""] ?? hand.length}
              <small>in hand</small>
            </span>
          )}
          {(turnState === "yours" || turnState === "theirs") && (
            <span
              className={`hand-turn-pill ${turnState === "yours" ? "hand-turn-pill--yours" : ""}`.trim()}
              role="status"
              data-testid="turn-pill"
            >
              {turnState === "yours"
                ? move === "call"
                  ? "Your call"
                  : "Your answer"
                : game.phase === "responding"
                  ? waitingNames.length > 0
                    ? `Waiting on ${waitingNames.length === 1 ? waitingNames[0] : `${waitingNames.length} players`}`
                    : "Card in"
                  : `${leaderName}'s call`}
            </span>
          )}
          {powerMode && !spectator && hand !== null && choices.length > 1 && (
            <div className="hand-pick-row">
              <span className="hand-pick-label">
                {pickerLocked ? "Playing" : `Your top ${choices.length} — tap to swap`}
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
            <div className="out-panel" role="status" data-testid="out-panel">
              <p className="out-title">
                {game.active[selfId ?? ""] ? "Out of cards" : "You're out"}
              </p>
              <p className="out-sub">
                {(() => {
                  const inRound = game.eliminatedIn[selfId ?? ""];
                  // Fixed at the moment you went out — everyone who outlasted
                  // you, plus one — so it agrees with the results screen.
                  const outlasted = game.config.players.filter((id) => {
                    const theirs = game.eliminatedIn[id];
                    return id !== selfId && (theirs === undefined || theirs > (inRound ?? 0));
                  }).length;
                  const place = outlasted + 1;
                  const shared = game.config.players.some(
                    (id) => id !== selfId && game.eliminatedIn[id] === inRound,
                  );
                  const total = game.config.players.length;
                  return inRound === undefined
                    ? "Your last card is on the table."
                    : `Eliminated in round ${inRound} · ${shared ? "=" : ""}${place}${ordinal(place)} of ${total}`;
                })()}
              </p>
              <p className="sub">Spectating until the match ends.</p>
              <div className="out-actions">
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => setLogOpen(true)}
                >
                  Round log
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="hand-face" key={topCard ?? "none"}>
                <TrumpCard
                  editionId={editionId}
                  cardId={topCard}
                  size="full"
                  {...(myStats !== null ? { stats: myStats } : {})}
                  {...(hotStat !== null ? { highlightStat: hotStat } : {})}
                  {...(armedStat !== null ? { pendingStat: armedStat } : {})}
                  {...(move === "call" && powerMode && game.burnedStats.length > 0
                    ? { disabledStats: game.burnedStats }
                    : {})}
                  {...(move === "call" || (move === "answer" && armed === "drs")
                    ? { onSelectStat: armStat }
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
                    <span>
                      {info.name}
                      <small> · {info.tag}</small>
                    </span>
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
            {betSlip !== null && (
              <p className="power-slip" role="status" data-testid="power-slip">
                <b>{POWER_INFO[armed as PowerKindView].name}</b> {betSlip}
              </p>
            )}
            {move === "call" && callButton}
            {move === "answer" && (
              <button
                type="button"
                className="button button--primary play-button"
                disabled={sending || (armed === "drs" && armedStat === null)}
                data-testid="play-card"
                onClick={() => void commit(null)}
              >
                {sending
                  ? "Playing…"
                  : armed === "drs"
                    ? armedStat === null
                      ? "Tap the stat to review on"
                      : `Play · DRS on ${statName(editionId, armedStat)}`
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
        ) : move === "call" ? (
          <div className="power-row call-row" data-testid="call-row">
            {callButton}
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
        <Suspense fallback={null}>
          <VoiceControls />
        </Suspense>
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
          aria-label="Round log"
          title="Round log"
          data-testid="open-log"
          onClick={() => setLogOpen(true)}
        >
          ≡
        </button>
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
        <Suspense fallback={null}>
          <PowerRules myPowers={spectator ? null : myPowers} onClose={() => setRulesOpen(false)} />
        </Suspense>
      )}

      {logOpen && (
        <Dialog title="Round log" onClose={() => setLogOpen(false)}>
          <Suspense fallback={null}>
            <RoundLog
              history={game.history}
              editionId={editionId}
              names={names}
              selfId={spectator ? null : selfId}
            />
          </Suspense>
          <button type="button" className="button" onClick={() => setLogOpen(false)}>
            Back to the game
          </button>
        </Dialog>
      )}

      {howToOpen && (
        <Suspense fallback={null}>
          <HowToPlay
            editionId={editionId}
            gameMode={room.settings.gameMode}
            onClose={() => setHowToOpen(false)}
          />
        </Suspense>
      )}

      {menuOpen && (
        <Dialog title="Game menu" onClose={() => setMenuOpen(false)}>
          <button
            type="button"
            className="button"
            onClick={() => {
              setMenuOpen(false);
              setHowToOpen(true);
            }}
          >
            How to play
          </button>
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
