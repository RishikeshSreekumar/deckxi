/**
 * Client-side mirror of a Squad Draft, folded from the wire events. Almost
 * nothing in a draft is hidden, so this is close to the engine's own state:
 * the pool, every squad, who is on the clock, who has an XI in. The one
 * secret — everyone else's XI — arrives with MATCHES_PLAYED.
 */
import type {
  RosterView,
  SquadDraftConfigView,
  SquadDraftWireEvent,
  SquadLeagueView,
} from "@deckxi/shared";

export interface SquadClientState {
  config: SquadDraftConfigView;
  phase: "drafting" | "building" | "finished";
  pool: string[];
  pickOrder: string[];
  /** Index of the next slot to fill; on-the-clock skips inactive seats from here. */
  pickIndex: number;
  squads: Record<string, string[]>;
  active: Record<string, boolean>;
  /** Who has an XI in (public); the XI itself is yours only until the reveal. */
  submitted: Record<string, boolean>;
  yourRoster: RosterView | null;
  /** Every XI, once the matches are played. */
  rosters: Record<string, RosterView> | null;
  form: Record<string, number> | null;
  league: SquadLeagueView | null;
  lastPick: { playerId: string; cardId: string; pick: number; auto: boolean } | null;
  finished: boolean;
  winner: string | null;
  endReason: "league" | "opponents-forfeited" | null;
  seq: number;
}

/** The seat whose pick it is, or null outside the draft / once it is done. */
export function onTheClock(state: SquadClientState): string | null {
  if (state.phase !== "drafting") return null;
  for (let i = state.pickIndex; i < state.pickOrder.length; i++) {
    const id = state.pickOrder[i] as string;
    if (state.active[id]) return id;
  }
  return null;
}

/** 1-based number of the pick in progress (or the last one, once done). */
export function currentPick(state: SquadClientState): number {
  for (let i = state.pickIndex; i < state.pickOrder.length; i++) {
    if (state.active[state.pickOrder[i] as string]) return i + 1;
  }
  return state.pickOrder.length;
}

/** How many cards of each nation a squad holds — for the cap readout. */
export function nationCounts(state: SquadClientState, playerId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of state.squads[playerId] ?? []) {
    const nation = state.config.cards.find((c) => c.id === id)?.nation;
    if (nation !== undefined) counts.set(nation, (counts.get(nation) ?? 0) + 1);
  }
  return counts;
}

/** Pool cards a player may take right now, mirroring the engine (cap waived when nothing is legal). */
export function legalPicks(state: SquadClientState, playerId: string): Set<string> {
  const counts = nationCounts(state, playerId);
  const legal = state.pool.filter((id) => {
    const nation = state.config.cards.find((c) => c.id === id)?.nation;
    return nation === undefined || (counts.get(nation) ?? 0) < state.config.nationCap;
  });
  return new Set(legal.length > 0 ? legal : state.pool);
}

export function applySquadEvent(
  state: SquadClientState | null,
  event: SquadDraftWireEvent,
  selfId: string | null,
): SquadClientState {
  if (event.type === "GAME_STARTED") {
    const squads: Record<string, string[]> = {};
    const active: Record<string, boolean> = {};
    const submitted: Record<string, boolean> = {};
    for (const id of event.config.players) {
      squads[id] = [];
      active[id] = true;
      submitted[id] = false;
    }
    return {
      config: event.config,
      phase: "drafting",
      pool: [...event.pool],
      pickOrder: [...event.pickOrder],
      pickIndex: 0,
      squads,
      active,
      submitted,
      yourRoster: null,
      rosters: null,
      form: null,
      league: null,
      lastPick: null,
      finished: false,
      winner: null,
      endReason: null,
      seq: event.seq,
    };
  }
  if (state === null) throw new Error(`applySquadEvent: ${event.type} before GAME_STARTED`);
  if (event.seq <= state.seq) return state;
  const next: SquadClientState = { ...state, seq: event.seq };

  switch (event.type) {
    case "CARD_DRAFTED":
      next.pool = state.pool.filter((id) => id !== event.cardId);
      next.squads = {
        ...state.squads,
        [event.playerId]: [...(state.squads[event.playerId] ?? []), event.cardId],
      };
      next.pickIndex = event.pick;
      next.lastPick = {
        playerId: event.playerId,
        cardId: event.cardId,
        pick: event.pick,
        auto: event.auto,
      };
      return next;
    case "DRAFT_COMPLETED":
      next.phase = "building";
      return next;
    case "XI_SUBMITTED":
      next.submitted = { ...state.submitted, [event.playerId]: true };
      if (event.playerId === selfId && event.roster !== null) next.yourRoster = event.roster;
      return next;
    case "PLAYER_FORFEITED":
      next.active = { ...state.active, [event.playerId]: false };
      return next;
    case "MATCHES_PLAYED":
      next.rosters = event.rosters;
      next.form = event.form;
      next.league = event.league;
      return next;
    case "GAME_ENDED":
      next.phase = "finished";
      next.finished = true;
      next.winner = event.winner;
      next.endReason = event.reason;
      return next;
  }
}

export function applySquadEvents(
  state: SquadClientState | null,
  events: readonly SquadDraftWireEvent[],
  selfId: string | null,
): SquadClientState | null {
  let current = state;
  for (const event of events) current = applySquadEvent(current, event, selfId);
  return current;
}
