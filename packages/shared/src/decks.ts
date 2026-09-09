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
 * compile-time union, and the catalogue reaches the client over the API.
 *
 * The defaults are the **edition's own** (#143). "Batters' XI" is a cricket
 * idea; a wrestling edition ships "The Bloodline" instead, and neither word
 * belongs in this package. What is left here is the shape of a deck, the one
 * deck every edition has (all of it), and how a deck resolves to cards.
 */
import type { Edition, Player, PlayerRoleId, Rarity } from "./edition.js";

/**
 * A deck id is a slug, not an enum: the set is open, so the wire validates
 * the shape and the catalogue decides whether it exists.
 */
export const DECK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_DECK_ID_LENGTH = 40;
export type DeckId = string;

/**
 * The deck every edition has and every room falls back to. An edition may
 * redefine it (a name, a blurb of its own); it may not do without it.
 */
export const DEFAULT_DECK_ID = "all-stars";

export interface DeckDefinition {
  id: DeckId;
  name: string;
  blurb: string;
  /**
   * Cards must match every filter present. Absent filters match everything.
   * Role ids are the edition's (#143), so a role filter only means anything
   * on the edition it was written for.
   */
  roles?: readonly PlayerRoleId[] | undefined;
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

/** The whole edition, for an edition that declares no decks of its own. */
export const ALL_CARDS_DECK: DeckDefinition = {
  id: DEFAULT_DECK_ID,
  name: "All Stars",
  blurb: "The whole edition. Every card in it.",
  sort: 0,
};

/** The decks an edition ships with, in picker order. */
export function editionDecks(edition: Pick<Edition, "decks">): DeckDefinition[] {
  const declared: readonly DeckDefinition[] = edition.decks ?? [ALL_CARDS_DECK];
  return sortDecks(declared);
}

/** The cards a deck draws from: curated order for a list, edition order otherwise. */
export function deckPool(
  edition: Pick<Edition, "players" | "decks">,
  deck: DeckId | DeckDefinition,
): Player[] {
  const definition =
    typeof deck === "string" ? editionDecks(edition).find((d) => d.id === deck) : deck;
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
