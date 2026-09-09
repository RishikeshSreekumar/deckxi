import { describe, expect, it } from "vitest";
import { DECKS, DECK_IDS, DEFAULT_DECK_ID, deckPool } from "./decks.js";
import type { Player } from "./edition.js";

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

  it("the default deck is the whole edition", () => {
    expect(DECKS[DEFAULT_DECK_ID].roles).toBeUndefined();
    expect(deckPool({ players }, DEFAULT_DECK_ID).map((p) => p.id)).toEqual(
      players.map((p) => p.id),
    );
  });

  it("filters by role and rarity", () => {
    expect(deckPool({ players }, "batters-xi").map((p) => p.id)).toEqual(["bat", "keep"]);
    expect(deckPool({ players }, "bowlers-union").map((p) => p.id)).toEqual(["bowl", "ar"]);
    expect(deckPool({ players }, "legends").map((p) => p.id)).toEqual(["keep", "bowl"]);
  });

  it("every deck id has a definition with a name and blurb", () => {
    for (const id of DECK_IDS) {
      expect(DECKS[id].id).toBe(id);
      expect(DECKS[id].name.length).toBeGreaterThan(0);
      expect(DECKS[id].blurb.length).toBeGreaterThan(0);
    }
  });
});
