/**
 * `reduce(state, event) → state` — the only way game state ever changes.
 *
 * The reducer is mechanical: it applies the facts an event records and makes
 * no rule decisions (those live in `applyCommand`, which emits the events).
 */
import {
  POWER_KINDS,
  type CardId,
  type CardTransfer,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
} from "./types.js";

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

/** Remove one card by id from a hand, wherever it sits. Throws if absent. */
function withoutCard(owner: PlayerId, hand: CardId[], cardId: CardId): CardId[] {
  const index = hand.indexOf(cardId);
  if (index === -1) throw new Error(`reduce: card ${cardId} is not in ${owner}'s hand`);
  return [...hand.slice(0, index), ...hand.slice(index + 1)];
}

/** Apply a card ledger in order: each card leaves `from` and joins the bottom of `to`. */
function applyTransfers(
  players: PlayerState[],
  pot: CardId[],
  transfers: readonly CardTransfer[],
): { players: PlayerState[]; pot: CardId[] } {
  const hands = new Map(players.map((p) => [p.id, [...p.hand]]));
  let nextPot = [...pot];
  const take = (from: PlayerId | "pot", cardId: CardId): void => {
    if (from === "pot") {
      const index = nextPot.indexOf(cardId);
      if (index === -1) throw new Error(`reduce: card ${cardId} is not in the pot`);
      nextPot = [...nextPot.slice(0, index), ...nextPot.slice(index + 1)];
      return;
    }
    const hand = hands.get(from);
    if (hand === undefined) throw new Error(`reduce: transfer from unknown player ${from}`);
    hands.set(from, withoutCard(from, hand, cardId));
  };
  const give = (to: PlayerId | "pot", cardId: CardId): void => {
    if (to === "pot") {
      nextPot = [...nextPot, cardId];
      return;
    }
    const hand = hands.get(to);
    if (hand === undefined) throw new Error(`reduce: transfer to unknown player ${to}`);
    hands.set(to, [...hand, cardId]);
  };
  for (const t of transfers) {
    take(t.from, t.cardId);
    give(t.to, t.cardId);
  }
  return {
    players: players.map((p) => ({ ...p, hand: hands.get(p.id) ?? p.hand })),
    pot: nextPot,
  };
}

export function reduce(state: GameState | undefined, event: GameEvent): GameState {
  if (event.type === "GAME_STARTED") {
    const powers = event.config.mode === "power-trumps" ? [...POWER_KINDS] : [];
    return {
      config: event.config,
      phase: "selecting",
      round: 1,
      leader: event.firstLeader,
      players: event.config.players.map((id) => ({
        id,
        hand: [...(event.hands[id] ?? [])],
        active: (event.hands[id] ?? []).length > 0,
        powers: [...powers],
      })),
      pot: [],
      winner: null,
      lastStat: null,
      pending: null,
    };
  }

  if (state === undefined) {
    throw new Error(`reduce: received ${event.type} before GAME_STARTED`);
  }

  switch (event.type) {
    case "STAT_SELECTED": {
      // Classic: informational (drives UI/log); the state change arrives with
      // ROUND_RESOLVED. Power trumps: the call opens the responding window.
      if (event.cardId === undefined) return state;
      return {
        ...state,
        phase: "responding",
        pending: {
          leader: event.playerId,
          stat: event.stat,
          plays: { [event.playerId]: { cardId: event.cardId, power: event.power ?? null } },
        },
      };
    }

    case "CARD_PLAYED": {
      if (state.pending === null) throw new Error("reduce: CARD_PLAYED with no call pending");
      return {
        ...state,
        pending: {
          ...state.pending,
          plays: {
            ...state.pending.plays,
            [event.playerId]: { cardId: event.cardId, power: event.power },
          },
        },
      };
    }

    case "ROUND_RESOLVED": {
      // Remove each revealed card from its owner's hand. Classic trumps only
      // ever reveals the top card; power trumps reveals the chosen one.
      let players = state.players.map((p) => {
        const revealed = event.revealed.find((r) => r.playerId === p.id);
        if (revealed === undefined) return p;
        if (state.config.mode !== "power-trumps" && p.hand[0] !== revealed.cardId) {
          throw new Error(
            `reduce: revealed card ${revealed.cardId} is not ${p.id}'s top card (${p.hand[0]})`,
          );
        }
        return { ...p, hand: withoutCard(p.id, p.hand, revealed.cardId) };
      });

      const revealedCards = event.revealed.map((r) => r.cardId);
      let pot: CardId[];
      let leader: PlayerId;

      if (event.result.kind === "won") {
        const winnerId = event.result.winner;
        pot = [];
        leader = winnerId;
        players = players.map((p) =>
          p.id === winnerId ? { ...p, hand: [...p.hand, ...state.pot, ...revealedCards] } : p,
        );
      } else {
        // Tie: everything revealed joins the pot; leader unchanged here (a
        // following PLAYER_ELIMINATED event reassigns it if the leader is out).
        pot = [...state.pot, ...revealedCards];
        leader = state.leader;
      }

      if (event.power !== undefined) {
        const settled = applyTransfers(players, pot, event.power.transfers);
        players = settled.players;
        pot = settled.pot;
        leader = event.power.nextLeader;
        // A power that played out is spent; a void one goes back in the hand.
        const spent = event.power.outcomes.filter((o) => o.outcome !== "void");
        players = players.map((p) => {
          const mine = spent.filter((o) => o.playerId === p.id).map((o) => o.power);
          return mine.length === 0
            ? p
            : { ...p, powers: p.powers.filter((k) => !mine.includes(k)) };
        });
      }

      return {
        ...state,
        phase: "selecting",
        round: event.round + 1,
        leader,
        pot,
        players,
        lastStat: event.stat,
        pending: null,
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
      // A committed play is withdrawn with the player; the card goes to the
      // pot along with the rest of their hand.
      let pending = state.pending ?? null;
      if (pending !== null && event.playerId in pending.plays) {
        const plays = { ...pending.plays };
        delete plays[event.playerId];
        pending = { ...pending, plays };
      }
      // The forfeiter's hand joins the pot, top card first.
      return { ...state, players, leader, pending, pot: [...state.pot, ...forfeiter.hand] };
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
