/**
 * Squad Draft — `apply(state, command) → events[]`. Validates a command and
 * emits what follows from it: a pick, the draft completing, an XI landing,
 * the matches playing out, the game ending. Never mutates state.
 */
import {
  CommandRejectedError,
  type CardDefinition,
  type CardId,
  type PlayerId,
} from "../../types.js";
import { nextPickIndex, onTheClock, reduceSquadDraft } from "./reducer.js";
import {
  battingStrength,
  bowlingStrength,
  fieldingStrength,
  KEEPER_ROLE,
  overall,
  playLeague,
  roleOf,
  rollForm,
} from "./scoring.js";
import type { Roster, SquadDraftCommand, SquadDraftEvent, SquadDraftState } from "./types.js";

function cardById(state: SquadDraftState, id: CardId): CardDefinition {
  const card = state.config.cards.find((c) => c.id === id);
  if (card === undefined) throw new Error(`unknown card ${id}`);
  return card;
}

/** How many cards of each nation a squad holds. */
function nationCounts(state: SquadDraftState, playerId: PlayerId): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of state.squads[playerId] ?? []) {
    const nation = cardById(state, id).nation;
    if (nation !== undefined) counts.set(nation, (counts.get(nation) ?? 0) + 1);
  }
  return counts;
}

/**
 * The pool cards this player may take right now: everything under the
 * nation cap — or, when nothing is (spec edge case 3), the whole pool.
 */
export function legalPicks(state: SquadDraftState, playerId: PlayerId): CardId[] {
  const counts = nationCounts(state, playerId);
  const under = state.pool.filter((id) => {
    const nation = cardById(state, id).nation;
    return nation === undefined || (counts.get(nation) ?? 0) < state.config.nationCap;
  });
  return under.length > 0 ? under : [...state.pool];
}

/** The auto-pick: the strongest legal card by overall, pool order on ties. */
export function bestAvailable(state: SquadDraftState, playerId: PlayerId): CardId | null {
  let best: CardId | null = null;
  let bestScore = -1;
  for (const id of legalPicks(state, playerId)) {
    const score = overall(cardById(state, id), state.config);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * Check an XI against the spec: `xiSize` distinct cards from the squad in
 * batting order, `bowlerCount` distinct bowlers drawn from them (in bowling
 * order), and a keeper who is one of them. Returns the reason it fails, or
 * null when it is legal.
 */
export function rosterProblem(
  state: SquadDraftState,
  playerId: PlayerId,
  roster: Roster,
): string | null {
  const squad = new Set(state.squads[playerId] ?? []);
  const { xiSize, bowlerCount } = state.config;
  if (roster.order.length !== xiSize) return `an XI is ${xiSize} cards, got ${roster.order.length}`;
  if (new Set(roster.order).size !== roster.order.length) return "a card appears twice in the XI";
  for (const id of roster.order) if (!squad.has(id)) return `${id} is not in your squad`;
  const xi = new Set(roster.order);
  if (roster.bowlers.length !== bowlerCount) {
    return `name ${bowlerCount} bowlers, got ${roster.bowlers.length}`;
  }
  if (new Set(roster.bowlers).size !== roster.bowlers.length) return "a bowler is named twice";
  for (const id of roster.bowlers) if (!xi.has(id)) return `bowler ${id} is not in the XI`;
  if (!xi.has(roster.keeper)) return "the keeper must be in the XI";
  return null;
}

/**
 * A legal XI from a squad, greedily: the best keeper-role card keeps (else
 * the best fielder in the side), the strongest `bowlerCount` bowlers bowl,
 * the strongest batters fill the rest, and the batting order is by batting
 * strength. Used for auto-play and offered to players as "Auto XI".
 */
export function autoRoster(state: SquadDraftState, playerId: PlayerId): Roster {
  const { config } = state;
  const squad = (state.squads[playerId] ?? []).map((id) => cardById(state, id));
  const bat = (c: CardDefinition): number => battingStrength(c, config);
  const bowl = (c: CardDefinition): number => bowlingStrength(c, config);
  const field = (c: CardDefinition): number => fieldingStrength(c, config);
  const byDesc = (score: (c: CardDefinition) => number) => (a: CardDefinition, b: CardDefinition) =>
    score(b) - score(a) || squad.indexOf(a) - squad.indexOf(b);

  const chosen: CardDefinition[] = [];
  const take = (card: CardDefinition | undefined): void => {
    if (card !== undefined && !chosen.includes(card)) chosen.push(card);
  };

  const keeperCard = squad
    .filter((c) => roleOf(c) === KEEPER_ROLE)
    .sort(byDesc((c) => bat(c) + field(c)))[0];
  take(keeperCard);
  const bowlers = squad
    .filter((c) => c !== keeperCard)
    .sort(byDesc(bowl))
    .slice(0, config.bowlerCount);
  for (const c of bowlers) take(c);
  for (const c of squad.filter((c) => !chosen.includes(c)).sort(byDesc(bat))) {
    if (chosen.length >= config.xiSize) break;
    take(c);
  }
  // A squad smaller than an XI cannot happen in play (a full squad is drafted
  // before building opens), but stay total: fill with whatever is left.
  for (const c of squad) if (chosen.length < config.xiSize) take(c);

  const order = [...chosen].sort(byDesc(bat)).map((c) => c.id);
  const keeper = keeperCard ?? [...chosen].sort(byDesc(field))[0];
  return {
    order,
    bowlers: bowlers.map((c) => c.id),
    keeper: (keeper as CardDefinition).id,
  };
}

function fold(state: SquadDraftState, events: SquadDraftEvent[]): SquadDraftState {
  return events.reduce(reduceSquadDraft, state as SquadDraftState | undefined) as SquadDraftState;
}

export function applySquadDraft(
  state: SquadDraftState,
  command: SquadDraftCommand,
): SquadDraftEvent[] {
  if (state.phase === "finished") throw new CommandRejectedError("game-finished");
  if (!(command.playerId in state.active)) {
    throw new CommandRejectedError("unknown-player", command.playerId);
  }
  if (!state.active[command.playerId]) {
    throw new CommandRejectedError("player-inactive", command.playerId);
  }

  switch (command.type) {
    case "FORFEIT":
      return applyForfeit(state, command.playerId);
    case "DRAFT_PICK":
      return applyPick(state, command.playerId, command.cardId, false);
    case "SUBMIT_XI":
      return applySubmit(state, command.playerId, command.roster, false);
    case "AUTO_PLAY": {
      if (state.phase === "drafting") {
        const cardId = bestAvailable(state, command.playerId);
        if (cardId === null) throw new Error("auto-play: empty pool");
        return applyPick(state, command.playerId, cardId, true);
      }
      return applySubmit(state, command.playerId, autoRoster(state, command.playerId), true);
    }
  }
}

function applyPick(
  state: SquadDraftState,
  playerId: PlayerId,
  cardId: CardId,
  auto: boolean,
): SquadDraftEvent[] {
  if (state.phase !== "drafting" || onTheClock(state) !== playerId) {
    throw new CommandRejectedError("not-on-the-clock", playerId);
  }
  if (!state.pool.includes(cardId)) throw new CommandRejectedError("card-not-in-pool", cardId);
  if (!legalPicks(state, playerId).includes(cardId)) {
    throw new CommandRejectedError("nation-cap", cardById(state, cardId).nation ?? cardId);
  }
  const index = nextPickIndex(state) as number;
  const events: SquadDraftEvent[] = [
    { type: "CARD_DRAFTED", playerId, cardId, pick: index + 1, auto },
  ];
  const next = fold(state, events);
  if (nextPickIndex(next) === null) events.push({ type: "DRAFT_COMPLETED" });
  return events;
}

function applySubmit(
  state: SquadDraftState,
  playerId: PlayerId,
  roster: Roster,
  auto: boolean,
): SquadDraftEvent[] {
  if (state.phase !== "building") throw new CommandRejectedError("not-building", playerId);
  if (state.rosters[playerId] != null)
    throw new CommandRejectedError("already-submitted", playerId);
  const problem = rosterProblem(state, playerId, roster);
  if (problem !== null) throw new CommandRejectedError("invalid-roster", problem);
  const clean: Roster = {
    order: [...roster.order],
    bowlers: [...roster.bowlers],
    keeper: roster.keeper,
  };
  const events: SquadDraftEvent[] = [{ type: "XI_SUBMITTED", playerId, roster: clean, auto }];
  const next = fold(state, events);
  if (allRostersIn(next)) events.push(...settle(next));
  return events;
}

function allRostersIn(state: SquadDraftState): boolean {
  return state.config.players.every((id) => !state.active[id] || state.rosters[id] != null);
}

/** Every XI is in: roll form, play the league, crown the table's top row. */
function settle(state: SquadDraftState): SquadDraftEvent[] {
  const rosters: Record<PlayerId, Roster> = {};
  for (const id of state.config.players) {
    const roster = state.rosters[id];
    if (state.active[id] && roster != null) rosters[id] = roster;
  }
  const form = rollForm(state.config, rosters);
  const league = playLeague(state.config, rosters, form);
  const top = league.table[0];
  if (top === undefined) throw new Error("settle: league with no table");
  return [
    { type: "MATCHES_PLAYED", rosters, form, league },
    { type: "GAME_ENDED", winner: top.playerId, reason: "league" },
  ];
}

function applyForfeit(state: SquadDraftState, playerId: PlayerId): SquadDraftEvent[] {
  const events: SquadDraftEvent[] = [{ type: "PLAYER_FORFEITED", playerId }];
  const next = fold(state, events);
  const remaining = next.config.players.filter((id) => next.active[id]);
  if (remaining.length === 1) {
    events.push({
      type: "GAME_ENDED",
      winner: remaining[0] as PlayerId,
      reason: "opponents-forfeited",
    });
    return events;
  }
  if (next.phase === "drafting" && nextPickIndex(next) === null) {
    // The only picks left were theirs: the draft is over for those still in.
    events.push({ type: "DRAFT_COMPLETED" });
    const built = fold(next, [{ type: "DRAFT_COMPLETED" }]);
    if (allRostersIn(built)) events.push(...settle(built));
    return events;
  }
  if (next.phase === "building" && allRostersIn(next)) events.push(...settle(next));
  return events;
}
