/**
 * Squad Draft — `reduce(state, event) → state`. Mechanical, like the trumps
 * reducer: it records what an event says happened and decides nothing.
 */
import type { PlayerId } from "../../types.js";
import type { Roster, SquadDraftEvent, SquadDraftState } from "./types.js";

/** Index of the next pick slot at or after `from` whose seat is still in the draft. */
export function nextPickIndex(state: SquadDraftState, from = state.pickIndex): number | null {
  for (let i = from; i < state.pickOrder.length; i++) {
    const playerId = state.pickOrder[i] as PlayerId;
    if (state.active[playerId]) return i;
  }
  return null;
}

/** Who picks next, or null once the draft is done. */
export function onTheClock(state: SquadDraftState): PlayerId | null {
  if (state.phase !== "drafting") return null;
  const index = nextPickIndex(state);
  return index === null ? null : (state.pickOrder[index] as PlayerId);
}

export function reduceSquadDraft(
  state: SquadDraftState | undefined,
  event: SquadDraftEvent,
): SquadDraftState {
  if (event.type === "GAME_STARTED") {
    const squads: Record<PlayerId, string[]> = {};
    const active: Record<PlayerId, boolean> = {};
    const rosters: Record<PlayerId, Roster | null> = {};
    for (const id of event.config.players) {
      squads[id] = [];
      active[id] = true;
      rosters[id] = null;
    }
    return {
      config: event.config,
      phase: "drafting",
      pool: [...event.pool],
      pickOrder: [...event.pickOrder],
      pickIndex: 0,
      squads,
      active,
      rosters,
      form: null,
      league: null,
      winner: null,
    };
  }
  if (state === undefined) throw new Error(`reduce: received ${event.type} before GAME_STARTED`);

  switch (event.type) {
    case "CARD_DRAFTED": {
      const index = state.pool.indexOf(event.cardId);
      if (index === -1) throw new Error(`reduce: card ${event.cardId} is not in the pool`);
      return {
        ...state,
        pool: state.pool.filter((_, i) => i !== index),
        squads: {
          ...state.squads,
          [event.playerId]: [...(state.squads[event.playerId] ?? []), event.cardId],
        },
        // The event names its slot; the next on-the-clock is derived lazily
        // so a forfeit between picks never leaves a stale pointer.
        pickIndex: event.pick,
      };
    }
    case "DRAFT_COMPLETED":
      return { ...state, phase: "building" };
    case "XI_SUBMITTED":
      return { ...state, rosters: { ...state.rosters, [event.playerId]: event.roster } };
    case "PLAYER_FORFEITED":
      return { ...state, active: { ...state.active, [event.playerId]: false } };
    case "MATCHES_PLAYED":
      return { ...state, form: event.form, league: event.league };
    case "GAME_ENDED":
      return { ...state, phase: "finished", winner: event.winner };
  }
}
