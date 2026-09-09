/**
 * Decks (#134): the sets of cards a room can play with. Each deck is a
 * curated subset of the pinned edition — same cards, same stats, same
 * provenance — so a deck changes what turns up on the table without touching
 * ratings, seasons, the collection, or the client bundle. A room carries
 * `deckId` next to `editionId`; the server draws the game's cards from the
 * deck's pool.
 */
import type { Edition, Player, PlayerRole, Rarity } from "./edition.js";

export const DECK_IDS = ["all-stars", "legends", "batters-xi", "bowlers-union"] as const;
export type DeckId = (typeof DECK_IDS)[number];
export const DEFAULT_DECK_ID: DeckId = "all-stars";

export interface DeckDefinition {
  id: DeckId;
  name: string;
  blurb: string;
  /** Cards must match every filter present. Absent filters match everything. */
  roles?: readonly PlayerRole[];
  rarities?: readonly Rarity[];
}

export const DECKS: Record<DeckId, DeckDefinition> = {
  "all-stars": {
    id: "all-stars",
    name: "All Stars",
    blurb: "The whole edition. Every role, every rarity.",
  },
  legends: {
    id: "legends",
    name: "Legends",
    blurb: "Star and legend cards only. Big numbers everywhere — a close game.",
    rarities: ["star", "legend"],
  },
  "batters-xi": {
    id: "batters-xi",
    name: "Batters' XI",
    blurb: "Batters and keepers. Averages, strike rates and runs decide.",
    roles: ["batter", "keeper"],
  },
  "bowlers-union": {
    id: "bowlers-union",
    name: "Bowlers' Union",
    blurb: "Bowlers and all-rounders. Wickets, economy and best figures rule.",
    roles: ["bowler", "all-rounder"],
  },
};

/** The cards a deck draws from, in edition order. */
export function deckPool(edition: Pick<Edition, "players">, deckId: DeckId): Player[] {
  const deck = DECKS[deckId];
  return edition.players.filter(
    (p) =>
      (deck.roles === undefined || deck.roles.includes(p.role)) &&
      (deck.rarities === undefined || deck.rarities.includes(p.rarity)),
  );
}
