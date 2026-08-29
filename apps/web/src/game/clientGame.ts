/**
 * Client-side mirror of the game state, folded from *redacted* events.
 *
 * The server never sends other players' hands, so this mirrors the engine
 * reducer on public information only: your own hand card-by-card, everyone's
 * hand counts, and the pot as an ordered list where cards that entered it
 * hidden (a forfeiter's hand) are `null` until revealed.
 */
import type {
  RedactedGameConfig,
  RedactedGameEvent,
  RevealedCardView,
  RoundResultView,
} from "@deckxi/shared";

/** `null` = a card whose identity this client has never seen. */
export type MaybeCardId = string | null;

export interface ResolvedRound {
  seq: number;
  round: number;
  stat: string;
  revealed: RevealedCardView[];
  result: RoundResultView;
  /** How many pot cards the winner swept along with the reveal. */
  potTaken: number;
}

export interface ClientGameState {
  config: RedactedGameConfig;
  round: number;
  leader: string;
  /** Your cards in engine order, top first; null entries are unseen cards. Spectators: null. */
  yourHand: MaybeCardId[] | null;
  handCounts: Record<string, number>;
  /** Pot in engine order; null entries entered hidden (forfeited hands). */
  pot: MaybeCardId[];
  active: Record<string, boolean>;
  /** The current round's stat pick, cleared when the round resolves. */
  selected: { playerId: string; stat: string; auto: boolean } | null;
  lastResolved: ResolvedRound | null;
  finished: boolean;
  winner: string | null;
  endReason: "last-standing" | "opponents-forfeited" | "round-limit" | "final-tie" | null;
  /** Highest event sequence number applied (for resume dedup). */
  seq: number;
}

/** Seat-order next active player after `from` — mirrors the engine reducer. */
function nextActive(
  players: readonly string[],
  active: Record<string, boolean>,
  from: string,
): string | null {
  const start = players.indexOf(from);
  if (start === -1) return null;
  for (let i = 1; i <= players.length; i++) {
    const candidate = players[(start + i) % players.length];
    if (candidate !== undefined && active[candidate]) return candidate;
  }
  return null;
}

/**
 * Apply one redacted event. `selfId` is this client's player id (null for
 * spectators) — the redacted log itself never names its viewer.
 */
export function applyRedactedEvent(
  state: ClientGameState | null,
  event: RedactedGameEvent,
  selfId: string | null,
): ClientGameState {
  if (event.type === "GAME_STARTED") {
    const active: Record<string, boolean> = {};
    for (const id of event.config.players) active[id] = (event.handCounts[id] ?? 0) > 0;
    return {
      config: event.config,
      round: 1,
      leader: event.firstLeader,
      yourHand: event.yourHand === null ? null : [...event.yourHand],
      handCounts: { ...event.handCounts },
      pot: [],
      active,
      selected: null,
      lastResolved: null,
      finished: false,
      winner: null,
      endReason: null,
      seq: event.seq,
    };
  }

  if (state === null) throw new Error(`applyRedactedEvent: ${event.type} before GAME_STARTED`);
  // Resume snapshots can overlap with live pushes; drop anything already applied.
  if (event.seq <= state.seq) return state;
  const next: ClientGameState = { ...state, seq: event.seq };

  switch (event.type) {
    case "STAT_SELECTED":
      next.selected = { playerId: event.playerId, stat: event.stat, auto: event.auto };
      return next;

    case "ROUND_RESOLVED": {
      const handCounts = { ...state.handCounts };
      for (const r of event.revealed) {
        handCounts[r.playerId] = Math.max(0, (handCounts[r.playerId] ?? 0) - 1);
      }
      let yourHand = state.yourHand;
      if (yourHand !== null && event.revealed.some((r) => r.playerId === selfId)) {
        yourHand = yourHand.slice(1);
      }

      const revealedIds = event.revealed.map((r) => r.cardId);
      let pot = state.pot;
      let potTaken = 0;
      if (event.result.kind === "won") {
        const winnerId = event.result.winner;
        potTaken = pot.length;
        handCounts[winnerId] = (handCounts[winnerId] ?? 0) + pot.length + revealedIds.length;
        if (yourHand !== null && selfId === winnerId) {
          yourHand = [...yourHand, ...pot, ...revealedIds];
        }
        pot = [];
        next.leader = winnerId;
      } else {
        pot = [...pot, ...revealedIds];
      }

      next.round = event.round + 1;
      next.handCounts = handCounts;
      next.yourHand = yourHand;
      next.pot = pot;
      next.selected = null;
      next.lastResolved = {
        seq: event.seq,
        round: event.round,
        stat: event.stat,
        revealed: event.revealed,
        result: event.result,
        potTaken,
      };
      return next;
    }

    case "PLAYER_ELIMINATED": {
      const active = { ...state.active, [event.playerId]: false };
      next.active = active;
      if (state.leader === event.playerId) {
        next.leader = nextActive(state.config.players, active, event.playerId) ?? state.leader;
      }
      return next;
    }

    case "PLAYER_FORFEITED": {
      const active = { ...state.active, [event.playerId]: false };
      const handCounts = { ...state.handCounts };
      const dumped = handCounts[event.playerId] ?? 0;
      handCounts[event.playerId] = 0;
      next.active = active;
      next.handCounts = handCounts;
      if (state.yourHand !== null && selfId === event.playerId) {
        // Our own hand joins the pot face-down, but we know the cards.
        next.pot = [...state.pot, ...state.yourHand];
        next.yourHand = [];
      } else {
        // A hidden hand joins the pot: track size and position, not identity.
        next.pot = [...state.pot, ...(Array(dumped).fill(null) as MaybeCardId[])];
      }
      if (state.leader === event.playerId) {
        next.leader = nextActive(state.config.players, active, event.playerId) ?? state.leader;
      }
      return next;
    }

    case "GAME_ENDED":
      next.finished = true;
      next.winner = event.winner;
      next.endReason = event.reason;
      return next;
  }
}

/** Fold a batch of redacted events into a state. */
export function applyRedactedEvents(
  state: ClientGameState | null,
  events: readonly RedactedGameEvent[],
  selfId: string | null,
): ClientGameState | null {
  let current = state;
  for (const event of events) current = applyRedactedEvent(current, event, selfId);
  return current;
}
