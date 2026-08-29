/**
 * @deckxi/engine — pure, deterministic, event-sourced game engine.
 * No I/O, no `Math.random()`, no `Date.now()` — ever.
 */
export const ENGINE_NAME = "@deckxi/engine";

export * from "./types.js";
export { reduce, reduceAll, nextActivePlayer } from "./reducer.js";
