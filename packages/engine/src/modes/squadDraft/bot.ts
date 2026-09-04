/**
 * Squad Draft — the baseline bot. Deterministic: same state, same move.
 *
 * Drafting, it takes the strongest legal card by overall, nudged by need:
 * a squad with no keeper wants one once the draft is half done, and a squad
 * short of bowling wants bowlers while it still can. Building, it submits
 * the greedy auto-roster.
 */
import type { PlayerId } from "../../types.js";
import { autoRoster, legalPicks } from "./apply.js";
import { onTheClock } from "./reducer.js";
import { BOWL_WEIGHT, KEEPER_ROLE, overall, roleOf } from "./scoring.js";
import type { SquadDraftCommand, SquadDraftState } from "./types.js";

const KEEPER_NEED = 15;
const BOWLER_NEED = 20;

export function squadDraftBot(
  state: SquadDraftState,
  playerId: PlayerId,
): SquadDraftCommand | null {
  if (!state.active[playerId] || state.phase === "finished") return null;

  if (state.phase === "building") {
    if (state.rosters[playerId] != null) return null;
    return { type: "SUBMIT_XI", playerId, roster: autoRoster(state, playerId) };
  }

  if (onTheClock(state) !== playerId) return null;
  const { config } = state;
  const cards = new Map(config.cards.map((c) => [c.id, c]));
  const squad = (state.squads[playerId] ?? [])
    .map((id) => cards.get(id))
    .filter((c) => c !== undefined);
  const picksLeft = config.squadSize - squad.length;
  const hasKeeper = squad.some((c) => roleOf(c) === KEEPER_ROLE);
  const bowlingArms = squad.filter((c) => (BOWL_WEIGHT[roleOf(c)] ?? 0.5) >= 1).length;
  const wantsKeeper = !hasKeeper && squad.length >= Math.floor(config.squadSize / 2);
  const wantsBowler =
    bowlingArms < config.bowlerCount && picksLeft <= config.bowlerCount - bowlingArms + 1;

  let best: string | null = null;
  let bestScore = -Infinity;
  for (const id of legalPicks(state, playerId)) {
    const card = cards.get(id);
    if (card === undefined) continue;
    let score = overall(card, config);
    const role = roleOf(card);
    if (wantsKeeper && role === KEEPER_ROLE) score += KEEPER_NEED;
    if (wantsBowler && (BOWL_WEIGHT[role] ?? 0.5) >= 1) score += BOWLER_NEED;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best === null
    ? { type: "AUTO_PLAY", playerId }
    : { type: "DRAFT_PICK", playerId, cardId: best };
}
