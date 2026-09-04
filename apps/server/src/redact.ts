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
 * Redact one logged event for a viewer (`null` = spectator). Reveals are
 * public by construction — they only ever contain cards that just left a
 * hand — but a committed card stays hidden until then, and a DRS stat is
 * the reviewer's secret until the reveal.
 */
export function redactEvent(
  { seq, event }: SeqEvent,
  viewerId: string | null,
  editionId: string,
): RedactedGameEvent {
  if (event.type === "STAT_SELECTED") {
    if (event.cardId === undefined) return { seq, ...event };
    const mine = viewerId === event.playerId;
    return {
      seq,
      type: "STAT_SELECTED",
      playerId: event.playerId,
      stat: event.stat,
      auto: event.auto,
      cardId: mine ? event.cardId : null,
      power: event.power ?? null,
    };
  }
  if (event.type === "CARD_PLAYED") {
    const mine = viewerId === event.playerId;
    const power =
      event.power?.kind === "drs" && !mine ? ({ kind: "drs" } as const) : (event.power ?? null);
    return {
      seq,
      type: "CARD_PLAYED",
      playerId: event.playerId,
      cardId: mine ? event.cardId : null,
      power,
      auto: event.auto,
    };
  }
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
      mode: config.mode ?? "classic-trumps",
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
