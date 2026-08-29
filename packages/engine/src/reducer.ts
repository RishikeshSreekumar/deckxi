/**
 * `reduce(state, event) → state` — the only way game state ever changes.
 *
 * The reducer is mechanical: it applies the facts an event records and makes
 * no rule decisions (those live in `applyCommand`, which emits the events).
 */
import type { GameEvent, GameState, PlayerId, PlayerState } from "./types.js";

/** Seat-order-clockwise next active player, starting after `from`. */
export function nextActivePlayer(players: PlayerState[], from: PlayerId): PlayerId | null {
  const start = players.findIndex((p) => p.id === from);
  if (start === -1) return null;
  for (let i = 1; i <= players.length; i++) {
    const candidate = players[(start + i) % players.length];
    if (candidate !== undefined && candidate.active) return candidate.id;
  }
  return null;
}

export function reduce(state: GameState | undefined, event: GameEvent): GameState {
  if (event.type === "GAME_STARTED") {
    return {
      config: event.config,
      phase: "selecting",
      round: 1,
      leader: event.firstLeader,
      players: event.config.players.map((id) => ({
        id,
        hand: [...(event.hands[id] ?? [])],
        active: (event.hands[id] ?? []).length > 0,
      })),
      pot: [],
      winner: null,
    };
  }

  if (state === undefined) {
    throw new Error(`reduce: received ${event.type} before GAME_STARTED`);
  }

  switch (event.type) {
    case "STAT_SELECTED":
      // Informational (drives UI/log); the state change arrives with ROUND_RESOLVED.
      return state;

    case "ROUND_RESOLVED": {
      // Remove each revealed player's top card.
      const players = state.players.map((p) => {
        const revealed = event.revealed.find((r) => r.playerId === p.id);
        if (revealed === undefined) return p;
        if (p.hand[0] !== revealed.cardId) {
          throw new Error(
            `reduce: revealed card ${revealed.cardId} is not ${p.id}'s top card (${p.hand[0]})`,
          );
        }
        return { ...p, hand: p.hand.slice(1) };
      });

      const revealedCards = event.revealed.map((r) => r.cardId);

      if (event.result.kind === "won") {
        const winnerId = event.result.winner;
        return {
          ...state,
          round: event.round + 1,
          leader: winnerId,
          pot: [],
          players: players.map((p) =>
            p.id === winnerId ? { ...p, hand: [...p.hand, ...state.pot, ...revealedCards] } : p,
          ),
        };
      }

      // Tie: everything revealed joins the pot; leader unchanged here (a
      // following PLAYER_ELIMINATED event reassigns it if the leader is out).
      return {
        ...state,
        round: event.round + 1,
        pot: [...state.pot, ...revealedCards],
        players,
      };
    }

    case "PLAYER_ELIMINATED": {
      const players = state.players.map((p) =>
        p.id === event.playerId ? { ...p, active: false } : p,
      );
      const leader =
        state.leader === event.playerId
          ? (nextActivePlayer(players, event.playerId) ?? state.leader)
          : state.leader;
      return { ...state, players, leader };
    }

    case "PLAYER_FORFEITED": {
      const forfeiter = state.players.find((p) => p.id === event.playerId);
      if (forfeiter === undefined) {
        throw new Error(`reduce: PLAYER_FORFEITED for unknown player ${event.playerId}`);
      }
      const players = state.players.map((p) =>
        p.id === event.playerId ? { ...p, hand: [], active: false } : p,
      );
      const leader =
        state.leader === event.playerId
          ? (nextActivePlayer(players, event.playerId) ?? state.leader)
          : state.leader;
      // The forfeiter's hand joins the pot, top card first.
      return { ...state, players, leader, pot: [...state.pot, ...forfeiter.hand] };
    }

    case "GAME_ENDED":
      return { ...state, phase: "finished", winner: event.winner };
  }
}

/** Fold a full event log into a state. The first event must be GAME_STARTED. */
export function reduceAll(events: readonly GameEvent[], initial?: GameState): GameState {
  let state: GameState | undefined = initial;
  for (const event of events) state = reduce(state, event);
  if (state === undefined) throw new Error("reduceAll: empty event log");
  return state;
}
