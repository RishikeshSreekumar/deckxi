/**
 * Baseline bot: plays its best stat. Used by tests, room backfill and the
 * future "play vs computer" mode. Deterministic — same state, same move.
 */
import { reduceAll } from "./reducer.js";
import { applyCommand, callableStats, choosableCards } from "./apply.js";
import { initGame } from "./setup.js";
import { normalizedValue } from "./stats.js";
import type {
  Command,
  GameConfigInput,
  GameEvent,
  GameState,
  PlayerId,
  StatDefinition,
} from "./types.js";

/**
 * The bot's move for `playerId`, or null when it has none (not its turn,
 * inactive, or the game is over).
 *
 * As leader it picks the highest normalised stat among the stats it may
 * call, ties broken by stat-definition order; in power trumps it looks at
 * every card it may choose from and takes the best card/stat pair, ties to
 * the shallower card. Answering a call it plays the card that scores best
 * on the called stat. It never declares a power.
 */
export function baselineBot(state: GameState, playerId: PlayerId): Command | null {
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined || !player.active) return null;

  if (state.phase === "responding") {
    const pending = state.pending;
    if (pending === null || playerId in pending.plays) return null;
    const def = state.config.stats.find((s) => s.key === pending.stat);
    if (def === undefined) return { type: "AUTO_PLAY", playerId };
    let bestIndex = 0;
    let bestScore = -1;
    choosableCards(state, player).forEach((cardId, index) => {
      const card = state.config.cards.find((c) => c.id === cardId);
      const score = card === undefined ? 0 : normalizedValue(card, def);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return { type: "PLAY_CARD", playerId, cardIndex: bestIndex };
  }

  if (state.phase !== "selecting" || state.leader !== playerId) return null;

  let best: { cardIndex: number; stat: StatDefinition; score: number } | null = null;
  choosableCards(state, player).forEach((cardId, cardIndex) => {
    const card = state.config.cards.find((c) => c.id === cardId);
    if (card === undefined) return;
    for (const def of callableStats(state, card)) {
      const score = normalizedValue(card, def);
      if (best === null || score > best.score) best = { cardIndex, stat: def, score };
    }
  });
  if (best === null) {
    // Degenerate card with no known stats: let the engine's auto-play rule
    // pick (it tolerates missing stats; a manual select would be rejected).
    return { type: "AUTO_PLAY", playerId };
  }
  const pick = best as { cardIndex: number; stat: StatDefinition; score: number };
  return state.config.mode === "power-trumps"
    ? { type: "SELECT_STAT", playerId, stat: pick.stat.key, cardIndex: pick.cardIndex }
    : { type: "SELECT_STAT", playerId, stat: pick.stat.key };
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
  // Each iteration is one command; a power-trumps round takes one per player.
  const commandCap = cap * (state.config.players.length + 1);
  for (let i = 0; i < commandCap && state.phase !== "finished"; i++) {
    const mover =
      state.phase === "responding"
        ? state.players.find((p) => p.active && !(p.id in (state.pending?.plays ?? {})))?.id
        : state.leader;
    const command = mover === undefined ? null : baselineBot(state, mover);
    if (command === null) throw new Error(`bot has no move for ${mover ?? "nobody"}`);
    const newEvents = applyCommand(state, command);
    events.push(...newEvents);
    state = reduceAll(newEvents, state);
  }
  if (state.phase !== "finished") throw new Error("bot game did not terminate within the cap");
  return { events, finalState: state, rounds: state.round - 1 };
}
