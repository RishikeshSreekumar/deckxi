/**
 * Replay: reconstruct game state from an event log. Because the engine is
 * deterministic and the GAME_STARTED event stores the config (seed included)
 * and the dealt hands, a log is a complete record of a game.
 */
import { reduce } from "./reducer.js";
import type { GameEvent, GameState } from "./types.js";

/** Replay a full log to its final state. */
export function replay(events: readonly GameEvent[]): GameState {
  return replayUntil(events, events.length);
}

/**
 * Replay the first `count` events — the backbone of the Phase 8 replay
 * debugger (step through a match) and client reconnection (rebuild state).
 */
export function replayUntil(events: readonly GameEvent[], count: number): GameState {
  if (events.length === 0) throw new Error("replay: empty event log");
  if (events[0]?.type !== "GAME_STARTED") {
    throw new Error(`replay: log must start with GAME_STARTED, got ${events[0]?.type}`);
  }
  let state: GameState | undefined;
  for (let i = 0; i < Math.min(count, events.length); i++) {
    state = reduce(state, events[i] as GameEvent);
  }
  return state as GameState;
}
