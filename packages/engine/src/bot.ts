/**
 * Baseline bot: plays its best stat. Used by tests, room backfill and the
 * future "play vs computer" mode. Deterministic — same state, same move.
 */
import { reduceAll } from "./reducer.js";
import { applyCommand } from "./apply.js";
import { initGame } from "./setup.js";
import { normalizedValue } from "./stats.js";
import type { Command, GameConfigInput, GameEvent, GameState, PlayerId } from "./types.js";

/**
 * The bot's move for `playerId`, or null when it has none (not the leader,
 * inactive, or the game is over). Picks the highest normalised stat among
 * the stats present on its top card, ties broken by stat-definition order.
 */
export function baselineBot(state: GameState, playerId: PlayerId): Command | null {
  if (state.phase !== "selecting" || state.leader !== playerId) return null;
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined || !player.active) return null;

  const topCardId = player.hand[0];
  const topCard = state.config.cards.find((c) => c.id === topCardId);
  if (topCard === undefined) return null;

  const present = state.config.stats.filter((s) => s.key in topCard.stats);
  if (present.length === 0) {
    // Degenerate card with no known stats: let the engine's auto-play rule
    // pick (it tolerates missing stats; a manual select would be rejected).
    return { type: "AUTO_PLAY", playerId };
  }

  let best = present[0] as (typeof present)[number];
  let bestScore = normalizedValue(topCard, best);
  for (const def of present.slice(1)) {
    const score = normalizedValue(topCard, def);
    if (score > bestScore) {
      bestScore = score;
      best = def;
    }
  }
  return { type: "SELECT_STAT", playerId, stat: best.key };
}

export interface BotGameResult {
  events: GameEvent[];
  finalState: GameState;
  /** Number of rounds resolved. */
  rounds: number;
}

/** Play a full bot-vs-bot game from a config. Deterministic per seed. */
export function runBotGame(input: GameConfigInput): BotGameResult {
  const started = initGame(input);
  const events: GameEvent[] = [started];
  let state = reduceAll(events);

  // maxRounds guarantees termination; the cap is a belt-and-braces guard so a
  // rule bug fails the run instead of hanging it.
  const cap = state.config.maxRounds + state.config.players.length + 10;
  for (let i = 0; i < cap && state.phase !== "finished"; i++) {
    const command = baselineBot(state, state.leader);
    if (command === null) throw new Error(`bot has no move as leader ${state.leader}`);
    const newEvents = applyCommand(state, command);
    events.push(...newEvents);
    state = reduceAll(newEvents, state);
  }
  if (state.phase !== "finished") throw new Error("bot game did not terminate within the cap");
  return { events, finalState: state, rounds: state.round - 1 };
}
