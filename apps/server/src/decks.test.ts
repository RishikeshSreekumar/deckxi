/**
 * The operator-curated deck catalogue (#142).
 */
import { describe, expect, it } from "vitest";
import { WWE_EDITION_ID, loadEdition } from "@deckxi/data";
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

  it("offers each edition its own decks, and nobody else's", () => {
    const decks = catalogue();
    expect(decks.catalogue().map((d) => d.id)).toEqual([
      "all-stars",
      "legends",
      "batters-xi",
      "bowlers-union",
    ]);
    expect(decks.catalogue(WWE_EDITION_ID).map((d) => d.id)).toEqual([
      "all-stars",
      "hall-of-fame",
      "the-giants",
      "workrate",
    ]);
    // Same id, different edition, different cards: "all-stars" is whichever
    // edition asked for it.
    expect(decks.summarise(decks.resolve("all-stars"), undefined).cardCount).toBe(
      loadEdition().players.length,
    );
    expect(
      decks.summarise(decks.resolve("all-stars", WWE_EDITION_ID), WWE_EDITION_ID).cardCount,
    ).toBe(loadEdition(WWE_EDITION_ID).players.length);
    // A cricket room asking for a wrestling deck gets the fallback, not a
    // deck that resolves to nothing.
    expect(decks.resolve("workrate").id).toBe("all-stars");
  });

  it("refuses a role the edition never declared", async () => {
    const decks = catalogue();
    await expect(
      decks.create({
        id: "technicians",
        name: "Technicians",
        blurb: "A role from another sport.",
        roles: ["technician"],
      }),
    ).rejects.toThrow(/has no role technician/);
    // The same deck is fine on the edition that has the role.
    const deck = await decks.create(
      {
        id: "technicians",
        name: "Technicians",
        blurb: "Mat wrestlers only.",
        roles: ["technician"],
      },
      WWE_EDITION_ID,
    );
    expect(decks.get("technicians", WWE_EDITION_ID)?.name).toBe("Technicians");
    expect(decks.get("technicians")).toBeUndefined();
    expect(deck.id).toBe("technicians");
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
