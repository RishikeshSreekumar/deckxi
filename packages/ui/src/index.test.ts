import { describe, expect, it } from "vitest";
import { DEFAULT_EDITION_ID, formatStatValue, getCardInfo, getEdition, statName } from "./index.js";
import { darkPalette, lightPalette } from "./tokens.js";

describe("@deckxi/ui editions lookup", () => {
  it("loads the bundled default edition", () => {
    const edition = getEdition(DEFAULT_EDITION_ID);
    expect(edition).not.toBeNull();
    expect(edition?.players.length).toBeGreaterThanOrEqual(8);
  });

  it("returns null for unknown editions", () => {
    expect(getEdition("edition-1999-q1")).toBeNull();
  });

  it("resolves card info with team", () => {
    const edition = getEdition(DEFAULT_EDITION_ID);
    const first = edition?.players[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const info = getCardInfo(DEFAULT_EDITION_ID, first.id);
    expect(info.player?.id).toBe(first.id);
    expect(info.team?.id).toBe(first.teamId);
  });

  it("falls back to the raw key for unknown stats", () => {
    expect(statName(DEFAULT_EDITION_ID, "nonsense")).toBe("nonsense");
  });

  it("formats decimal stats to two places", () => {
    const edition = getEdition(DEFAULT_EDITION_ID);
    const decimal = edition?.stats.find((s) => s.format === "decimal");
    expect(decimal).toBeDefined();
    if (decimal === undefined) return;
    expect(formatStatValue(DEFAULT_EDITION_ID, decimal.key, 12.345)).toBe("12.35");
  });
});

describe("@deckxi/ui tokens", () => {
  it("defines the same palette keys for both themes", () => {
    expect(Object.keys(lightPalette).sort()).toEqual(Object.keys(darkPalette).sort());
  });
});
