/**
 * The operator-curated deck catalogue (#142).
 */
import { describe, expect, it } from "vitest";
import { loadEdition } from "@deckxi/data";
import { DEFAULT_DECK_ID, deckPool } from "@deckxi/shared";
import { DeckCatalogue, DeckError, MIN_DECK_CARDS } from "./decks.js";
import { InMemoryConfigStore } from "./ops.js";

const catalogue = (store = new InMemoryConfigStore()): DeckCatalogue => new DeckCatalogue(store);

describe("deck catalogue", () => {
  it("boots on the built-in decks, resolved against the edition", () => {
    const decks = catalogue();
    expect(decks.list().map((d) => d.id)).toEqual([
      "all-stars",
      "legends",
      "batters-xi",
      "bowlers-union",
    ]);
    const allStars = decks.summarise(decks.resolve("all-stars"));
    expect(allStars.cardCount).toBe(loadEdition().players.length);
  });

  it("creates, patches and retires a deck", async () => {
    const decks = catalogue();
    await decks.create({
      id: "keepers-only",
      name: "Keepers",
      blurb: "Gloves on.",
      roles: ["keeper", "batter"],
    });
    expect(decks.get("keepers-only")?.name).toBe("Keepers");

    await decks.update("keepers-only", { name: "The Gloves", enabled: false });
    expect(decks.get("keepers-only")?.name).toBe("The Gloves");
    // A retired deck is still in the catalogue, but no host is offered it.
    expect(decks.catalogue().some((d) => d.id === "keepers-only")).toBe(false);
    expect(decks.list().some((d) => d.id === "keepers-only")).toBe(true);

    await decks.remove("keepers-only");
    expect(decks.get("keepers-only")).toBeUndefined();
  });

  it("clears a filter when it is explicitly nulled, and leaves it alone otherwise", async () => {
    const decks = catalogue();
    await decks.update("legends", { blurb: "Still the legends." });
    expect(decks.get("legends")?.rarities).toEqual(["star", "legend"]);
    await decks.update("legends", { rarities: null });
    expect(decks.get("legends")?.rarities).toBeUndefined();
    expect(decks.summarise(decks.resolve("legends")).cardCount).toBe(loadEdition().players.length);
  });

  it("takes an explicit card list, which overrides the filters", async () => {
    const decks = catalogue();
    const ids = loadEdition()
      .players.slice(0, 8)
      .map((p) => p.id);
    await decks.setCards("bowlers-union", ids);
    const deck = decks.resolve("bowlers-union");
    expect(deckPool(loadEdition(), deck).map((p) => p.id)).toEqual(ids);
    // Null hands it back to the role filter it was built with.
    await decks.setCards("bowlers-union", null);
    expect(decks.resolve("bowlers-union").cardIds).toBeUndefined();
    expect(deckPool(loadEdition(), decks.resolve("bowlers-union")).length).toBeGreaterThan(8);
  });

  it("refuses an edit that would break a room", async () => {
    const decks = catalogue();
    await expect(decks.create({ id: "Not A Slug", name: "x", blurb: "y" })).rejects.toThrow(
      DeckError,
    );
    await expect(decks.create({ id: "legends", name: "x", blurb: "y" })).rejects.toThrow(
      /already exists/,
    );
    await expect(decks.setCards("legends", ["nobody-by-that-name"])).rejects.toThrow(
      /not in edition/,
    );
    const two = loadEdition()
      .players.slice(0, 2)
      .map((p) => p.id);
    await expect(decks.setCards("legends", two)).rejects.toThrow(
      new RegExp(`needs ${MIN_DECK_CARDS}`),
    );
    // The whole edit is refused, not half-applied.
    expect(decks.get("legends")?.cardIds).toBeUndefined();
    await expect(decks.remove(DEFAULT_DECK_ID)).rejects.toThrow(/falls back/);
  });

  it("survives a restart, and ignores a corrupt row rather than failing to boot", async () => {
    const store = new InMemoryConfigStore();
    const first = catalogue(store);
    await first.create({ id: "rivals-xi", name: "Rivals XI", blurb: "The needle games." });

    const second = catalogue(store);
    await second.load();
    expect(second.get("rivals-xi")?.name).toBe("Rivals XI");

    await store.write("decks", { decks: [{ nonsense: true }] });
    const third = catalogue(store);
    await third.load();
    expect(third.list().map((d) => d.id)).toContain(DEFAULT_DECK_ID);
  });

  it("falls back to the default deck when a room names one that is gone", () => {
    const decks = catalogue();
    expect(decks.resolve("was-deleted").id).toBe(DEFAULT_DECK_ID);
  });
});
