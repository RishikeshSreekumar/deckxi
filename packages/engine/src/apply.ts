/**
 * `applyCommand(state, command) → events[]` — validates a command against the
 * current state and emits the events that record its consequences, win
 * detection included. It never mutates state; callers fold the returned
 * events with `reduce`.
 *
 * Classic trumps resolves the round the moment the leader calls. Power
 * trumps opens a responding window instead: the leader's call commits a
 * card (and maybe a power), every other active player answers with theirs,
 * and the round resolves once the last answer is in — see
 * `docs/games/power-trumps.md`.
 */
import { nextActivePlayer, reduce } from "./reducer.js";
import { beats, chooseBestStat, statValue } from "./stats.js";
import {
  CHOICE_DEPTH,
  CommandRejectedError,
  type CardDefinition,
  type CardId,
  type CardTransfer,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
  type PowerOutcome,
  type PowerPlay,
  type PowerRound,
  type RevealedCard,
  type StatDefinition,
  type StatKey,
  type SuperOverResult,
} from "./types.js";

function cardById(state: GameState, id: string): CardDefinition {
  const card = state.config.cards.find((c) => c.id === id);
  if (card === undefined) throw new Error(`unknown card ${id}`);
  return card;
}

function statDef(state: GameState, key: StatKey): StatDefinition {
  const def = state.config.stats.find((s) => s.key === key);
  if (def === undefined) throw new CommandRejectedError("unknown-stat", key);
  return def;
}

/** Active players in seat order starting from `from` (inclusive). */
function activeFrom(state: GameState, from: PlayerId): PlayerState[] {
  const start = state.players.findIndex((p) => p.id === from);
  const rotated = [...state.players.slice(start), ...state.players.slice(0, start)];
  return rotated.filter((p) => p.active);
}

function isPowerMode(state: GameState): boolean {
  return state.config.mode === "power-trumps";
}

/**
 * The stats a leader may call this round: everything on the card, minus the
 * one that decided the last round (power trumps) — unless that would leave
 * nothing to call.
 */
export function callableStats(state: GameState, card: CardDefinition): StatDefinition[] {
  const onCard = state.config.stats.filter((s) => s.key in card.stats);
  if (!isPowerMode(state) || state.lastStat === null) return onCard;
  const fresh = onCard.filter((s) => s.key !== state.lastStat);
  return fresh.length > 0 ? fresh : onCard;
}

/** The cards a player may choose from this round (power trumps: the top three). */
export function choosableCards(state: GameState, player: PlayerState): CardId[] {
  return isPowerMode(state) ? player.hand.slice(0, CHOICE_DEPTH) : player.hand.slice(0, 1);
}

export function applyCommand(state: GameState, command: Command): GameEvent[] {
  if (state.phase === "finished") throw new CommandRejectedError("game-finished");

  const player = state.players.find((p) => p.id === command.playerId);
  if (player === undefined) throw new CommandRejectedError("unknown-player", command.playerId);
  if (!player.active) throw new CommandRejectedError("player-inactive", command.playerId);

  if (command.type === "FORFEIT") return applyForfeit(state, player.id);

  if (command.type === "PLAY_CARD") {
    if (!isPowerMode(state) || state.phase !== "responding" || state.pending === null) {
      throw new CommandRejectedError("not-responding", player.id);
    }
    return applyResponse(state, player, command.cardIndex, command.power ?? null, false);
  }

  if (command.type === "AUTO_PLAY" && state.phase === "responding") {
    return applyResponse(state, player, 0, null, true);
  }

  // SELECT_STAT / AUTO_PLAY while selecting — leader only.
  if (state.leader !== player.id) throw new CommandRejectedError("not-leader", player.id);
  if (state.phase !== "selecting") throw new CommandRejectedError("already-played", player.id);

  const choices = choosableCards(state, player);
  const cardIndex = command.type === "AUTO_PLAY" ? 0 : (command.cardIndex ?? 0);
  const cardId = choices[cardIndex];
  if (cardId === undefined) {
    if (choices.length === 0) throw new Error(`active leader ${player.id} has an empty hand`);
    throw new CommandRejectedError("bad-card-index", String(cardIndex));
  }
  const card = cardById(state, cardId);

  let stat: StatKey;
  if (command.type === "AUTO_PLAY") {
    stat = chooseBestStat(card, callableStats(state, card));
  } else {
    statDef(state, command.stat);
    if (!(command.stat in card.stats)) {
      throw new CommandRejectedError("stat-not-on-card", command.stat);
    }
    if (!callableStats(state, card).some((s) => s.key === command.stat)) {
      throw new CommandRejectedError("stat-repeated", command.stat);
    }
    stat = command.stat;
  }

  const auto = command.type === "AUTO_PLAY";
  if (!isPowerMode(state)) return resolveClassic(state, player.id, stat, auto);

  const power = command.type === "AUTO_PLAY" ? null : (command.power ?? null);
  validatePower(state, player, power, stat);
  const call: GameEvent = { type: "STAT_SELECTED", playerId: player.id, stat, auto, cardId, power };
  const next = reduce(state, call);
  // Nobody to answer (everyone else is gone): the round resolves at once.
  if (allPlaysIn(next)) return [call, ...resolvePower(next)];
  return [call];
}

// ---------------------------------------------------------------------------
// Classic trumps
// ---------------------------------------------------------------------------

function resolveClassic(
  state: GameState,
  leader: PlayerId,
  stat: StatKey,
  auto: boolean,
): GameEvent[] {
  const def = statDef(state, stat);

  // Reveal: every active player's top card, seat order from the leader.
  const revealed: RevealedCard[] = activeFrom(state, leader).map((p) => {
    const cardId = p.hand[0];
    if (cardId === undefined) throw new Error(`active player ${p.id} has an empty hand`);
    return { playerId: p.id, cardId, value: statValue(cardById(state, cardId), def) };
  });

  const { result, winners } = judge(revealed, def);
  const events: GameEvent[] = [
    { type: "STAT_SELECTED", playerId: leader, stat, auto },
    { type: "ROUND_RESOLVED", round: state.round, stat, revealed, result },
  ];
  return [...events, ...settle(state, events, leader, winners)];
}

type RoundResultOf = Extract<GameEvent, { type: "ROUND_RESOLVED" }>["result"];

/** Best value wins, respecting direction; shared best is a tie. */
function judge(
  revealed: RevealedCard[],
  def: StatDefinition,
): { result: RoundResultOf; winners: RevealedCard[] } {
  let best = revealed[0] as RevealedCard;
  for (const r of revealed.slice(1)) if (beats(r.value, best.value, def)) best = r;
  const winners = revealed.filter((r) => r.value === best.value);
  const result: RoundResultOf =
    winners.length === 1
      ? { kind: "won", winner: (winners[0] as RevealedCard).playerId }
      : { kind: "tie", tiedPlayers: winners.map((w) => w.playerId) };
  return { result, winners };
}

/**
 * After a round: fold the events so far, eliminate empty hands (seat order
 * from the leader) and check the win conditions. Shared by both modes.
 */
function settle(
  state: GameState,
  soFar: readonly GameEvent[],
  leader: PlayerId,
  winners: readonly RevealedCard[],
): GameEvent[] {
  const events: GameEvent[] = [];
  let next = soFar.reduce(reduce, state as GameState | undefined) as GameState;

  for (const p of activeFrom(next, leader)) {
    if (p.hand.length === 0) {
      const event: GameEvent = { type: "PLAYER_ELIMINATED", playerId: p.id, round: state.round };
      events.push(event);
      next = reduce(next, event);
    }
  }

  const active = next.players.filter((p) => p.active);
  if (active.length === 1) {
    events.push({
      type: "GAME_ENDED",
      winner: (active[0] as PlayerState).id,
      reason: "last-standing",
    });
  } else if (active.length === 0) {
    // Final tie: the last players eliminated each other. Lowest seat index
    // among the tied players wins (spec edge case 6).
    const tied = new Set(winners.map((w) => w.playerId));
    const winner = state.players.find((p) => tied.has(p.id)) as PlayerState;
    events.push({ type: "GAME_ENDED", winner: winner.id, reason: "final-tie" });
  } else if (next.round > next.config.maxRounds) {
    // Round limit: most cards in hand wins; tie-break lowest seat index.
    let winner = active[0] as PlayerState;
    for (const p of active) if (p.hand.length > winner.hand.length) winner = p;
    events.push({ type: "GAME_ENDED", winner: winner.id, reason: "round-limit" });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Power trumps
// ---------------------------------------------------------------------------

function validatePower(
  state: GameState,
  player: PlayerState,
  power: PowerPlay | null,
  calledStat: StatKey,
): void {
  if (power === null) return;
  if (!player.powers.includes(power.kind)) {
    throw new CommandRejectedError("power-unavailable", power.kind);
  }
  if (power.kind === "drs") {
    if (state.leader === player.id) {
      throw new CommandRejectedError(
        "power-not-allowed",
        "the leader cannot review their own call",
      );
    }
    statDef(state, power.stat);
    if (power.stat === calledStat) {
      throw new CommandRejectedError("power-not-allowed", "DRS must name a different stat");
    }
    const taken = Object.values(state.pending?.plays ?? {}).some((p) => p.power?.kind === "drs");
    if (taken) throw new CommandRejectedError("power-not-allowed", "DRS already called this round");
  }
}

function allPlaysIn(state: GameState): boolean {
  if (state.pending === null) return false;
  return state.players.filter((p) => p.active).every((p) => p.id in state.pending!.plays);
}

function applyResponse(
  state: GameState,
  player: PlayerState,
  cardIndex: number,
  power: PowerPlay | null,
  auto: boolean,
): GameEvent[] {
  const pending = state.pending;
  if (pending === null) throw new CommandRejectedError("not-responding", player.id);
  if (player.id in pending.plays) throw new CommandRejectedError("already-played", player.id);

  const cardId = choosableCards(state, player)[cardIndex];
  if (cardId === undefined) throw new CommandRejectedError("bad-card-index", String(cardIndex));
  validatePower(state, player, power, pending.stat);

  const played: GameEvent = { type: "CARD_PLAYED", playerId: player.id, cardId, power, auto };
  const next = reduce(state, played);
  if (allPlaysIn(next)) return [played, ...resolvePower(next)];
  return [played];
}

/** A mutable scratch copy of the table used to work out the ledger. */
interface Table {
  hands: Map<PlayerId, CardId[]>;
  pot: CardId[];
  transfers: CardTransfer[];
}

function move(table: Table, cardId: CardId, from: PlayerId | "pot", to: PlayerId | "pot"): void {
  if (from === "pot") {
    table.pot.splice(table.pot.indexOf(cardId), 1);
  } else {
    const hand = table.hands.get(from) as CardId[];
    hand.splice(hand.indexOf(cardId), 1);
  }
  if (to === "pot") table.pot.push(cardId);
  else (table.hands.get(to) as CardId[]).push(cardId);
  table.transfers.push({ cardId, from, to });
}

/** The card a losing bet costs: the loser's next top card, if they have one. */
function forfeitOne(table: Table, from: PlayerId, to: PlayerId | "pot"): void {
  const top = table.hands.get(from)?.[0];
  if (top !== undefined) move(table, top, from, to);
}

/**
 * Every play is in: reveal the committed cards on the deciding stat, settle
 * the pot the classic way, then let the powers play out in seat order from
 * the leader — DRS and Powerplay first, Super Overs last — as one explicit
 * card ledger the reducer applies verbatim.
 */
function resolvePower(state: GameState): GameEvent[] {
  const pending = state.pending;
  if (pending === null) throw new Error("resolvePower: no call pending");
  const leader = pending.leader;

  const seats = activeFrom(state, leader);
  const drs = seats.find((p) => pending.plays[p.id]?.power?.kind === "drs");
  const drsPower = drs === undefined ? null : (pending.plays[drs.id]?.power as PowerPlay);
  const stat = drsPower?.kind === "drs" ? drsPower.stat : pending.stat;
  const def = statDef(state, stat);

  const revealed: RevealedCard[] = seats.map((p) => {
    const play = pending.plays[p.id];
    if (play === undefined) throw new Error(`resolvePower: ${p.id} has not played`);
    return {
      playerId: p.id,
      cardId: play.cardId,
      value: statValue(cardById(state, play.cardId), def),
    };
  });
  const { result, winners } = judge(revealed, def);
  const winner = result.kind === "won" ? result.winner : null;

  // Scratch table after the classic settlement.
  const base = reduce(state, {
    type: "ROUND_RESOLVED",
    round: state.round,
    stat,
    revealed,
    result,
  });
  const table: Table = {
    hands: new Map(base.players.map((p) => [p.id, [...p.hand]])),
    pot: [...base.pot],
    transfers: [],
  };
  const outcomes: PowerOutcome[] = [];
  const superOvers: SuperOverResult[] = [];
  let nextLeader = nextActivePlayer(state.players, leader) ?? leader;
  /** Who holds this round's winnings right now (a Super Over can move them). */
  let holder = winner;

  for (const p of seats) {
    const power = pending.plays[p.id]?.power;
    if (power === undefined || power === null || power.kind === "super-over") continue;
    const won = winner === p.id;
    outcomes.push({ playerId: p.id, power: power.kind, outcome: won ? "won" : "lost" });
    if (power.kind === "drs") {
      if (won) nextLeader = p.id;
      else forfeitOne(table, p.id, winner ?? "pot");
    } else if (won) {
      for (const loser of seats) if (loser.id !== p.id) forfeitOne(table, loser.id, p.id);
    } else {
      forfeitOne(table, p.id, winner ?? "pot");
    }
  }

  // Everything the winner took this round — the pot, the reveal, any
  // Powerplay forfeits — is what a Super Over is played for.
  let winnings: CardId[] = [];
  if (winner !== null) {
    const ownBefore = new Set(state.players.find((p) => p.id === winner)?.hand ?? []);
    ownBefore.delete(pending.plays[winner]?.cardId ?? "");
    winnings = (table.hands.get(winner) ?? []).filter((c) => !ownBefore.has(c));
  }

  for (const p of seats) {
    const power = pending.plays[p.id]?.power;
    if (power?.kind !== "super-over") continue;
    const challengerCardId = table.hands.get(p.id)?.[0];
    if (holder === null || holder === p.id || challengerCardId === undefined) {
      // Not a loss (a tie, or they won), or nothing left to play: the bet is off.
      outcomes.push({ playerId: p.id, power: "super-over", outcome: "void" });
      continue;
    }
    const defenderCardId = table.hands.get(holder)?.[0];
    if (defenderCardId === undefined) throw new Error(`resolvePower: holder ${holder} has no card`);
    const challengerCard: RevealedCard = {
      playerId: p.id,
      cardId: challengerCardId,
      value: statValue(cardById(state, challengerCardId), def),
    };
    const defenderCard: RevealedCard = {
      playerId: holder,
      cardId: defenderCardId,
      value: statValue(cardById(state, defenderCardId), def),
    };
    const challengerWins = beats(challengerCard.value, defenderCard.value, def);
    superOvers.push({
      challenger: p.id,
      defender: holder,
      challengerCard,
      defenderCard,
      winner: challengerWins ? p.id : null,
    });
    if (challengerWins) {
      outcomes.push({ playerId: p.id, power: "super-over", outcome: "won" });
      // The winnings change hands, then both Super Over cards join them.
      for (const cardId of winnings) move(table, cardId, holder, p.id);
      move(table, defenderCardId, holder, p.id);
      move(table, challengerCardId, p.id, p.id);
      winnings = [...winnings, defenderCardId, challengerCardId];
      holder = p.id;
    } else {
      outcomes.push({ playerId: p.id, power: "super-over", outcome: "lost" });
      move(table, challengerCardId, p.id, holder);
    }
  }

  const power: PowerRound = {
    calledStat: pending.stat,
    drsBy: drs?.id ?? null,
    outcomes,
    superOvers,
    transfers: table.transfers,
    nextLeader,
  };
  const resolved: GameEvent = {
    type: "ROUND_RESOLVED",
    round: state.round,
    stat,
    revealed,
    result,
    power,
  };
  return [resolved, ...settle(state, [resolved], leader, winners)];
}

// ---------------------------------------------------------------------------
// Forfeit
// ---------------------------------------------------------------------------

function applyForfeit(state: GameState, playerId: PlayerId): GameEvent[] {
  const forfeited: GameEvent = { type: "PLAYER_FORFEITED", playerId };
  const events: GameEvent[] = [forfeited];
  const remaining = state.players.filter((p) => p.active && p.id !== playerId);
  if (remaining.length === 1) {
    events.push({
      type: "GAME_ENDED",
      winner: (remaining[0] as PlayerState).id,
      reason: "opponents-forfeited",
    });
    return events;
  }
  // Power trumps: if the table was only waiting on the player who left, the
  // round plays out among those still in.
  const next = reduce(state, forfeited);
  if (next.phase === "responding" && allPlaysIn(next)) events.push(...resolvePower(next));
  return events;
}
