/**
 * @deckxi/engine — pure, deterministic, event-sourced game engine.
 * No I/O, no `Math.random()`, no `Date.now()` — ever.
 */
export const ENGINE_NAME = "@deckxi/engine";

export * from "./types.js";
export { reduce, reduceAll, nextActivePlayer } from "./reducer.js";
export { mulberry32, randomInt, shuffle, type Rng } from "./rng.js";
export { initGame, InvalidConfigError } from "./setup.js";
export { replay, replayUntil } from "./replay.js";
export { applyCommand } from "./apply.js";
export { beats, chooseBestStat, normalizedValue, statValue, worstValue } from "./stats.js";
