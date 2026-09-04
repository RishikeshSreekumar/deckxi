/**
 * Client-side mirror of the game state, folded from *redacted* events.
 *
 * The server never sends other players' hands, so this mirrors the engine
 * reducer on public information only: your own hand card-by-card, everyone's
 * hand counts, and the pot as an ordered list where cards that entered it
 * hidden (a forfeiter's hand) are `null` until revealed.
 */
import type {
  PowerKindView,
  PowerPlayView,
  PowerRoundView,
  RedactedGameConfig,
  RedactedGameEvent,
  RevealedCardView,
  RoundResultView,
} from "@deckxi/shared";

const ALL_POWERS: readonly PowerKindView[] = ["powerplay", "drs", "super-over"];

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
  /** Power trumps: what the powers did. */
  power: PowerRoundView | null;
}

/** A declared power as this client sees it (a DRS stat is its owner's secret). */
export type DeclaredPower = PowerPlayView | { kind: "drs" };

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
  /** `responding` (power trumps): the call is in, waiting on answers. */
  phase: "selecting" | "responding" | "finished";
  /** Power trumps: who has committed a card this round and the power they declared. */
  plays: Record<string, { power: DeclaredPower | null }>;
  /** Power trumps: your committed card this round, once you have played it. */
  yourPlay: { cardId: string; power: PowerPlayView | null } | null;
  /** Power trumps: the stat that decided the last round — the leader may not call it. */
  lastStat: string | null;
  /** Power trumps: unused powers per player (public — a spent power is seen by all). */
  powers: Record<string, PowerKindView[]>;
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
    const powers: Record<string, PowerKindView[]> = {};
    const dealt = event.config.mode === "power-trumps" ? ALL_POWERS : [];
    for (const id of event.config.players) {
      active[id] = (event.handCounts[id] ?? 0) > 0;
      powers[id] = [...dealt];
    }
    return {
      config: event.config,
      round: 1,
      leader: event.firstLeader,
      yourHand: event.yourHand === null ? null : [...event.yourHand],
      handCounts: { ...event.handCounts },
      pot: [],
      active,
      selected: null,
      phase: "selecting",
      plays: {},
      yourPlay: null,
      lastStat: null,
      powers,
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
      if (event.cardId !== undefined) {
        // Power trumps: the call opens the responding window.
        next.phase = "responding";
        next.plays = { [event.playerId]: { power: event.power ?? null } };
        if (event.playerId === selfId && event.cardId !== null) {
          next.yourPlay = { cardId: event.cardId, power: ownPower(event.power ?? null) };
        }
      }
      return next;

    case "CARD_PLAYED":
      next.plays = { ...state.plays, [event.playerId]: { power: event.power } };
      if (event.playerId === selfId && event.cardId !== null) {
        next.yourPlay = { cardId: event.cardId, power: ownPower(event.power) };
      }
      return next;

    case "ROUND_RESOLVED": {
      const handCounts = { ...state.handCounts };
      for (const r of event.revealed) {
        handCounts[r.playerId] = Math.max(0, (handCounts[r.playerId] ?? 0) - 1);
      }
      let yourHand = state.yourHand;
      const mine = event.revealed.find((r) => r.playerId === selfId);
      if (yourHand !== null && mine !== undefined) {
        // Classic: always the top card. Power trumps: whichever was chosen.
        const index = yourHand.indexOf(mine.cardId);
        yourHand = index === -1 ? yourHand.slice(1) : yourHand.filter((_, i) => i !== index);
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

      if (event.power !== undefined) {
        // The ledger names every card that moved, so even a card we never
        // saw becomes known the moment it changes hands.
        for (const t of event.power.transfers) {
          if (t.from === "pot") {
            pot = removeOne(pot, t.cardId);
          } else {
            handCounts[t.from] = Math.max(0, (handCounts[t.from] ?? 0) - 1);
            if (yourHand !== null && t.from === selfId) yourHand = removeOne(yourHand, t.cardId);
          }
          if (t.to === "pot") {
            pot = [...pot, t.cardId];
          } else {
            handCounts[t.to] = (handCounts[t.to] ?? 0) + 1;
            if (yourHand !== null && t.to === selfId) yourHand = [...yourHand, t.cardId];
          }
        }
        next.leader = event.power.nextLeader;
        const powers = { ...state.powers };
        for (const o of event.power.outcomes) {
          if (o.outcome === "void") continue;
          powers[o.playerId] = (powers[o.playerId] ?? []).filter((k) => k !== o.power);
        }
        next.powers = powers;
      }

      next.round = event.round + 1;
      next.handCounts = handCounts;
      next.yourHand = yourHand;
      next.pot = pot;
      next.selected = null;
      next.phase = "selecting";
      next.plays = {};
      next.yourPlay = null;
      next.lastStat = event.stat;
      next.lastResolved = {
        seq: event.seq,
        round: event.round,
        stat: event.stat,
        revealed: event.revealed,
        result: event.result,
        potTaken,
        power: event.power ?? null,
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
      if (event.playerId in state.plays) {
        const plays = { ...state.plays };
        delete plays[event.playerId];
        next.plays = plays;
      }
      return next;
    }

    case "GAME_ENDED":
      next.finished = true;
      next.phase = "finished";
      next.winner = event.winner;
      next.endReason = event.reason;
      return next;
  }
}

/** Remove the first `cardId` (or, for a card we never saw, one unknown slot). */
function removeOne(cards: MaybeCardId[], cardId: string): MaybeCardId[] {
  let index = cards.indexOf(cardId);
  if (index === -1) index = cards.indexOf(null);
  if (index === -1) return cards;
  return cards.filter((_, i) => i !== index);
}

/** Our own declaration always carries its DRS stat; narrow the wire type back. */
function ownPower(power: DeclaredPower | null): PowerPlayView | null {
  if (power === null) return null;
  if (power.kind === "drs" && !("stat" in power)) return null;
  return power as PowerPlayView;
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
