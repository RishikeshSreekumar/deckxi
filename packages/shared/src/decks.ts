/**
 * Decks (#134): the sets of cards a room can play with. Each deck is a
 * curated subset of the pinned edition — same cards, same stats, same
 * provenance — so a deck changes what turns up on the table without touching
 * ratings, seasons, the collection, or the client bundle. A room carries
 * `deckId` next to `editionId`; the server draws the game's cards from the
 * deck's pool.
 *
 * Decks are **runtime data** (#142): an operator curates them from the admin
 * console, so a deck id is a validated slug on the wire rather than a
 * compile-time union, and the catalogue reaches the client over the API. The
 * four decks below stay in code as the defaults every deployment boots with
 * and the client falls back to — a deck list that needs a server round-trip
 * before the lobby can print a name is a lobby that flickers.
 */
import type { Edition, Player, PlayerRole, Rarity } from "./edition.js";

/**
 * A deck id is a slug, not an enum: the set is open, so the wire validates
 * the shape and the catalogue decides whether it exists.
 */
export const DECK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_DECK_ID_LENGTH = 40;
export type DeckId = string;

export const BUILT_IN_DECK_IDS = ["all-stars", "legends", "batters-xi", "bowlers-union"] as const;
export type BuiltInDeckId = (typeof BUILT_IN_DECK_IDS)[number];
/** The decks that ship in the bundle. Runtime decks are added to these. */
export const DECK_IDS = BUILT_IN_DECK_IDS;
export const DEFAULT_DECK_ID: BuiltInDeckId = "all-stars";

export interface DeckDefinition {
  id: DeckId;
  name: string;
  blurb: string;
  /** Cards must match every filter present. Absent filters match everything. */
  roles?: readonly PlayerRole[] | undefined;
  rarities?: readonly Rarity[] | undefined;
  /**
   * Explicit membership (#142). When present the filters are ignored and the
   * deck is exactly these cards, in this order — the difference between "the
   * bowlers" and a hand-picked XI.
   */
  cardIds?: readonly string[] | undefined;
  /** Hosts may pick it. Off retires a deck without deleting its history. */
  enabled?: boolean | undefined;
  /** Order in the picker; lower first, ties fall back to the name. */
  sort?: number | undefined;
}

export const DECKS: Record<BuiltInDeckId, DeckDefinition> = {
  "all-stars": {
    id: "all-stars",
    name: "All Stars",
    blurb: "The whole edition. Every role, every rarity.",
    sort: 0,
  },
  legends: {
    id: "legends",
    name: "Legends",
    blurb: "Star and legend cards only. Big numbers everywhere — a close game.",
    rarities: ["star", "legend"],
    sort: 1,
  },
  "batters-xi": {
    id: "batters-xi",
    name: "Batters' XI",
    blurb: "Batters and keepers. Averages, strike rates and runs decide.",
    roles: ["batter", "keeper"],
    sort: 2,
  },
  "bowlers-union": {
    id: "bowlers-union",
    name: "Bowlers' Union",
    blurb: "Bowlers and all-rounders. Wickets, economy and best figures rule.",
    roles: ["bowler", "all-rounder"],
    sort: 3,
  },
};

/** The built-ins as a list, in picker order. */
export const BUILT_IN_DECKS: readonly DeckDefinition[] = BUILT_IN_DECK_IDS.map((id) => DECKS[id]);

/** The cards a deck draws from: curated order for a list, edition order otherwise. */
export function deckPool(
  edition: Pick<Edition, "players">,
  deck: DeckId | DeckDefinition,
): Player[] {
  const definition = typeof deck === "string" ? DECKS[deck as BuiltInDeckId] : deck;
  if (definition === undefined) throw new Error(`unknown deck ${String(deck)}`);
  if (definition.cardIds !== undefined) {
    const byId = new Map(edition.players.map((p) => [p.id, p]));
    return definition.cardIds.map((id) => byId.get(id)).filter((p): p is Player => p !== undefined);
  }
  return edition.players.filter(
    (p) =>
      (definition.roles === undefined || definition.roles.includes(p.role)) &&
      (definition.rarities === undefined || definition.rarities.includes(p.rarity)),
  );
}

/** Picker order: `sort` first, then the name, so a catalogue reads the same everywhere. */
export function sortDecks(decks: readonly DeckDefinition[]): DeckDefinition[] {
  return [...decks].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
}

/** One deck as the catalogue endpoints publish it. */
export interface DeckSummary {
  id: DeckId;
  name: string;
  blurb: string;
  /** Cards this deck resolves to in the pinned edition. */
  cardCount: number;
  enabled: boolean;
}
