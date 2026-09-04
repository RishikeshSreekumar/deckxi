/**
 * @deckxi/engine — pure, deterministic, event-sourced game engine.
 * No I/O, no `Math.random()`, no `Date.now()` — ever.
 *
 * Two layers: the trumps state machine (the original engine, exported flat
 * for the client's replay tooling and tests), and the `GameMode` plugin
 * contract with its registry, which is how every game — trumps included —
 * plugs into rooms, the server and the lobby.
 */
export const ENGINE_NAME = "@deckxi/engine";

export * from "./types.js";
export { reduce, reduceAll, nextActivePlayer } from "./reducer.js";
export { mulberry32, randomInt, shuffle, type Rng } from "./rng.js";
export { initGame, InvalidConfigError } from "./setup.js";
export { replay, replayUntil } from "./replay.js";
export { applyCommand, callableStats, choosableCards } from "./apply.js";
export { beats, chooseBestStat, normalizedValue, statValue, worstValue } from "./stats.js";
export { baselineBot, runBotGame, type BotGameResult } from "./bot.js";

// Game-mode framework (Phase 9)
export type { AnyGameMode, GameMode, ModeInspection, ModeSetup, ModeStatus } from "./mode.js";
export { findMode, getMode, listModes, replayMode } from "./modes/registry.js";
export {
  classicTrumps,
  powerTrumps,
  redactTrumpsEvent,
  trumpsWaitingOn,
  type TrumpsMode,
} from "./modes/trumps.js";
export * from "./modes/squadDraft/index.js";
