/**
 * `applyCommand(state, command) → events[]` — validates a command against the
 * current state and emits the events that record its consequences, win
 * detection included. It never mutates state; callers fold the returned
 * events with `reduce`.
 */
import { reduce } from "./reducer.js";
import { beats, chooseBestStat, statValue } from "./stats.js";
import {
  CommandRejectedError,
  type CardDefinition,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
  type RevealedCard,
  type StatDefinition,
  type StatKey,
} from "./types.js";

function cardById(state: GameState, id: string): CardDefinition {
  const card = state.config.cards.find((c) => c.id === id);
  if (card === undefined) throw new Error(`unknown card ${id}`);
  return card;
}

/** Active players in seat order starting from `from` (inclusive). */
function activeFrom(state: GameState, from: PlayerId): PlayerState[] {
  const start = state.players.findIndex((p) => p.id === from);
  const rotated = [...state.players.slice(start), ...state.players.slice(0, start)];
  return rotated.filter((p) => p.active);
}

export function applyCommand(state: GameState, command: Command): GameEvent[] {
  if (state.phase === "finished") throw new CommandRejectedError("game-finished");

  const player = state.players.find((p) => p.id === command.playerId);
  if (player === undefined) throw new CommandRejectedError("unknown-player", command.playerId);
  if (!player.active) throw new CommandRejectedError("player-inactive", command.playerId);

  if (command.type === "FORFEIT") return applyForfeit(state, player.id);

  // SELECT_STAT / AUTO_PLAY — leader only.
  if (state.leader !== player.id) throw new CommandRejectedError("not-leader", player.id);
  const topCardId = player.hand[0];
  if (topCardId === undefined) throw new Error(`active leader ${player.id} has an empty hand`);
  const topCard = cardById(state, topCardId);

  let stat: StatKey;
  if (command.type === "AUTO_PLAY") {
    stat = chooseBestStat(topCard, state.config.stats);
  } else {
    const def = state.config.stats.find((s) => s.key === command.stat);
    if (def === undefined) throw new CommandRejectedError("unknown-stat", command.stat);
    if (!(command.stat in topCard.stats)) {
      throw new CommandRejectedError("stat-not-on-card", command.stat);
    }
    stat = command.stat;
  }

  return resolveRound(state, player.id, stat, command.type === "AUTO_PLAY");
}

function resolveRound(
  state: GameState,
  leader: PlayerId,
  stat: StatKey,
  auto: boolean,
): GameEvent[] {
  const def = state.config.stats.find((s) => s.key === stat) as StatDefinition;

  // Reveal: every active player's top card, seat order from the leader.
  const revealed: RevealedCard[] = activeFrom(state, leader).map((p) => {
    const cardId = p.hand[0];
    if (cardId === undefined) throw new Error(`active player ${p.id} has an empty hand`);
    return { playerId: p.id, cardId, value: statValue(cardById(state, cardId), def) };
  });

  // Best value wins, respecting direction; shared best is a tie.
  let best = revealed[0] as RevealedCard;
  for (const r of revealed.slice(1)) if (beats(r.value, best.value, def)) best = r;
  const winners = revealed.filter((r) => r.value === best.value);

  const events: GameEvent[] = [
    { type: "STAT_SELECTED", playerId: leader, stat, auto },
    {
      type: "ROUND_RESOLVED",
      round: state.round,
      stat,
      revealed,
      result:
        winners.length === 1
          ? { kind: "won", winner: (winners[0] as RevealedCard).playerId }
          : { kind: "tie", tiedPlayers: winners.map((w) => w.playerId) },
    },
  ];
  let next = events.reduce(reduce, state as GameState | undefined) as GameState;

  // Eliminations: anyone left with an empty hand, seat order from the leader.
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

function applyForfeit(state: GameState, playerId: PlayerId): GameEvent[] {
  const events: GameEvent[] = [{ type: "PLAYER_FORFEITED", playerId }];
  const remaining = state.players.filter((p) => p.active && p.id !== playerId);
  if (remaining.length === 1) {
    events.push({
      type: "GAME_ENDED",
      winner: (remaining[0] as PlayerState).id,
      reason: "opponents-forfeited",
    });
  }
  return events;
}
