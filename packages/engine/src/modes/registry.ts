/**
 * The mode registry — the one place a mode id becomes a `GameMode`. Rooms,
 * the socket layer, the replay debugger and the client all look modes up
 * here; adding a game to the platform is adding a line to `MODES`.
 */
import type { AnyGameMode } from "../mode.js";
import { squadDraft } from "./squadDraft/index.js";
import { classicTrumps, powerTrumps } from "./trumps.js";

const MODES: readonly AnyGameMode[] = [classicTrumps, powerTrumps, squadDraft];

const byId = new Map<string, AnyGameMode>(MODES.map((m) => [m.id, m]));

export function listModes(): readonly AnyGameMode[] {
  return MODES;
}

export function findMode(id: string): AnyGameMode | undefined {
  return byId.get(id);
}

/** Throws on an id nobody registered — a room can never be in an unknown mode. */
export function getMode(id: string): AnyGameMode {
  const mode = byId.get(id);
  if (mode === undefined) throw new Error(`unknown game mode: ${id}`);
  return mode;
}

/** Fold any mode's event log to its state at `count` events. */
export function replayMode(
  modeId: string,
  events: readonly unknown[],
  count = events.length,
): unknown {
  const mode = getMode(modeId);
  if (events.length === 0) throw new Error("replay: empty event log");
  let state: unknown;
  for (let i = 0; i < Math.min(count, events.length); i++) state = mode.reduce(state, events[i]);
  return state;
}
