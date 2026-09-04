/**
 * Redaction — the anti-cheat boundary. The full engine event log (seed, all
 * hands) never leaves the server; each viewer gets a copy with only what
 * they're entitled to see. What that is depends on the game, so the rules
 * live with each mode (`GameMode.redact`); this file adds the sequence
 * number and fans a log out.
 */
import type { AnyGameMode, GameEvent } from "@deckxi/engine";
import type { WireGameEvent } from "@deckxi/shared";

export interface SeqEvent {
  seq: number;
  /**
   * Typed as the trumps event for the persistence layer's `type` column and
   * the tests; at runtime this is whatever the room's mode emitted.
   */
  event: GameEvent;
}

/** Redact one logged event for a viewer (`null` = spectator). */
export function redactEvent(
  mode: AnyGameMode,
  { seq, event }: SeqEvent,
  viewerId: string | null,
  editionId: string,
): WireGameEvent {
  return { seq, ...(mode.redact(event, viewerId, editionId) as object) } as WireGameEvent;
}

export function redactLog(
  mode: AnyGameMode,
  log: readonly SeqEvent[],
  viewerId: string | null,
  editionId: string,
): WireGameEvent[] {
  return log.map((e) => redactEvent(mode, e, viewerId, editionId));
}
