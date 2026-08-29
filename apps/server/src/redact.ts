/**
 * Redaction — the anti-cheat boundary. The full engine event log (seed, all
 * hands) never leaves the server; each viewer gets a copy with only what
 * they're entitled to see: their own hand, everyone's card counts, and the
 * public reveal/round events.
 */
import type { GameEvent } from "@deckxi/engine";
import type { RedactedGameEvent } from "@deckxi/shared";

export interface SeqEvent {
  seq: number;
  event: GameEvent;
}

/**
 * Redact one logged event for a viewer (`null` = spectator). Everything but
 * GAME_STARTED is public by construction — reveals only ever contain cards
 * that just left a hand.
 */
export function redactEvent(
  { seq, event }: SeqEvent,
  viewerId: string | null,
  editionId: string,
): RedactedGameEvent {
  if (event.type !== "GAME_STARTED") return { seq, ...event };

  const handCounts: Record<string, number> = {};
  for (const [playerId, hand] of Object.entries(event.hands)) {
    handCounts[playerId] = hand.length;
  }
  const { config } = event;
  return {
    seq,
    type: "GAME_STARTED",
    config: {
      players: [...config.players],
      cards: config.cards.map((c) => ({ id: c.id, stats: { ...c.stats } })),
      stats: config.stats.map((s) => ({
        key: s.key,
        direction: s.direction,
        min: s.min,
        max: s.max,
      })),
      maxRounds: config.maxRounds,
      editionId,
    },
    firstLeader: event.firstLeader,
    yourHand: viewerId !== null && event.hands[viewerId] ? [...event.hands[viewerId]] : null,
    handCounts,
  };
}

export function redactLog(
  log: readonly SeqEvent[],
  viewerId: string | null,
  editionId: string,
): RedactedGameEvent[] {
  return log.map((e) => redactEvent(e, viewerId, editionId));
}
