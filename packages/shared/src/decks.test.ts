import { describe, expect, it } from "vitest";
import { ALL_CARDS_DECK, DEFAULT_DECK_ID, deckPool, editionDecks } from "./decks.js";
import type { Edition, Player } from "./edition.js";

const player = (id: string, role: Player["role"], rarity: Player["rarity"]): Player => ({
  id,
  name: id,
  role,
  teamId: "t",
  nationality: "X",
  rarity,
  rating: 50,
  stats: {},
});

describe("decks", () => {
  const players = [
    player("bat", "batter", "regular"),
    player("keep", "keeper", "star"),
    player("bowl", "bowler", "legend"),
    player("ar", "all-rounder", "regular"),
  ];
  // The decks are the edition's own (#143); these are a cricket edition's.
  const decks: Edition["decks"] = [
    { id: DEFAULT_DECK_ID, name: "All Stars", blurb: "Everything.", sort: 0 },
    { id: "legends", name: "Legends", blurb: "The big names.", rarities: ["star", "legend"] },
    { id: "batters-xi", name: "Batters' XI", blurb: "Bat first.", roles: ["batter", "keeper"] },
    { id: "one-card", name: "One card", blurb: "A hand-picked list.", cardIds: ["bowl"] },
  ];
  const edition = { players, decks };

  it("the default deck is the whole edition", () => {
    expect(deckPool(edition, DEFAULT_DECK_ID).map((p) => p.id)).toEqual(players.map((p) => p.id));
  });

  it("filters by role and rarity, and takes an explicit list", () => {
    expect(deckPool(edition, "batters-xi").map((p) => p.id)).toEqual(["bat", "keep"]);
    expect(deckPool(edition, "legends").map((p) => p.id)).toEqual(["keep", "bowl"]);
    expect(deckPool(edition, "one-card").map((p) => p.id)).toEqual(["bowl"]);
  });

  it("refuses a deck the edition never declared", () => {
    expect(() => deckPool(edition, "bowlers-union")).toThrow(/unknown deck/);
  });

  it("an edition that declares no decks still has one: all of it", () => {
    const bare = { players };
    expect(editionDecks(bare)).toEqual([ALL_CARDS_DECK]);
    expect(deckPool(bare, DEFAULT_DECK_ID).map((p) => p.id)).toEqual(players.map((p) => p.id));
  });

  it("lists decks in picker order", () => {
    expect(editionDecks(edition).map((d) => d.id)).toEqual([
      "all-stars",
      "batters-xi",
      "legends",
      "one-card",
    ]);
  });
});
