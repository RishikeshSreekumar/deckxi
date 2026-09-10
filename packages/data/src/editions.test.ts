import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deckPool } from "@deckxi/shared";
import { CURRENT_EDITION_ID, editionsDir, listEditionIds, loadEdition } from "./editions.js";
import { computeRating, regenerateRatings } from "./rating.js";
import { T20I_ASSOCIATES } from "./import/config.js";
import { WWE_EDITION_ID } from "./wwe/config.js";

/** The smallest deck a table can be seated from; the server's own floor. */
const MIN_DECK_CARDS = 6;

describe("current edition (real T20I data)", () => {
  const edition = loadEdition();

  it("is listed and is the current edition", () => {
    expect(listEditionIds()).toContain(CURRENT_EDITION_ID);
    expect(edition.id).toBe(CURRENT_EDITION_ID);
  });

  it("declares its sources and their licences", () => {
    expect(edition.sources?.map((s) => s.name)).toEqual([
      "Cricsheet",
      "Wikidata",
      "Wikimedia Commons",
    ]);
    for (const source of edition.sources ?? []) expect(source.license).not.toBe("");
  });

  it("fields fifteen cards a full member and at most ten an associate", () => {
    expect(edition.players.length).toBeGreaterThanOrEqual(180);
    expect(edition.teams).toHaveLength(14);
    for (const team of edition.teams) {
      const cards = edition.players.filter((p) => p.teamId === team.id).length;
      // Associates play a fraction of the calendar, so they earn fewer cards
      // and only with a real body of work behind them (docs/data-sources.md).
      if (T20I_ASSOCIATES.includes(team.id)) expect(cards).toBeLessThanOrEqual(10);
      else expect(cards).toBe(15);
    }
    const associates = edition.players.filter((p) => T20I_ASSOCIATES.includes(p.teamId)).length;
    expect(associates / edition.players.length).toBeLessThan(0.3);
  });

  it("prints eight stats, four with the bat and four with the ball", () => {
    expect(edition.stats.map((s) => s.key)).toEqual([
      "battingAvg",
      "strikeRate",
      "runs",
      "highest",
      "wickets",
      "economy",
      "catches",
      "bestBowling",
    ]);
  });

  it("carries a shirt number on most cards", () => {
    const withJersey = edition.players.filter((p) => p.jerseyNumber !== undefined).length;
    expect(withJersey / edition.players.length).toBeGreaterThanOrEqual(0.7);
  });

  it("uses nations as teams — no franchise identities", () => {
    for (const player of edition.players) {
      const team = edition.teams.find((t) => t.id === player.teamId);
      expect(team?.name).toBe(player.nationality);
    }
  });

  it("fields bat and ball for every team, and every role somewhere in the deck", () => {
    // A photographed player of any role beats a silhouette, so a nation
    // short of photographed keepers may field none (docs/data-sources.md).
    for (const team of edition.teams) {
      const roles = new Set(edition.players.filter((p) => p.teamId === team.id).map((p) => p.role));
      expect(roles.has("batter")).toBe(true);
      expect(roles.has("bowler") || roles.has("all-rounder")).toBe(true);
    }
    expect(new Set(edition.players.map((p) => p.role))).toEqual(
      new Set(["batter", "bowler", "all-rounder", "keeper"]),
    );
  });

  it("prints a photograph on most cards", () => {
    // Associate nations (Scotland, Nepal, the Netherlands) are thinly
    // photographed on Commons; the full-member squads are near-complete.
    const withPhoto = edition.players.filter((p) => p.photo !== undefined).length;
    expect(withPhoto / edition.players.length).toBeGreaterThanOrEqual(0.8);
  });

  it("tiers rarity by rating: 1 in 8 legends, 1 in 4 stars", () => {
    const count = (r: string) => edition.players.filter((p) => p.rarity === r).length;
    expect(count("legend")).toBe(Math.round(edition.players.length / 8));
    expect(count("star")).toBe(Math.round(edition.players.length / 4));
    const minLegend = Math.min(
      ...edition.players.filter((p) => p.rarity === "legend").map((p) => p.rating),
    );
    const maxStar = Math.max(
      ...edition.players.filter((p) => p.rarity === "star").map((p) => p.rating),
    );
    const maxRegular = Math.max(
      ...edition.players.filter((p) => p.rarity === "regular").map((p) => p.rating),
    );
    expect(minLegend).toBeGreaterThanOrEqual(maxStar);
    expect(maxStar).toBeGreaterThanOrEqual(maxRegular);
  });

  it("stores up-to-date derived ratings", () => {
    for (const player of edition.players) {
      expect(player.rating).toBe(computeRating(player, edition.stats));
    }
    expect(regenerateRatings(edition.players, edition.stats)).toEqual(edition.players);
  });

  it("carries a licensed, on-disk photo for most cards", () => {
    const webPublic = join(editionsDir(), "..", "..", "..", "apps", "web", "public");
    const withPhoto = edition.players.filter((p) => p.photo !== undefined);
    expect(withPhoto.length).toBeGreaterThanOrEqual(edition.players.length / 2);
    for (const player of withPhoto) {
      const photo = player.photo as NonNullable<typeof player.photo>;
      expect(photo.src.startsWith(`/cards/${edition.id}/`)).toBe(true);
      expect(existsSync(join(webPublic, photo.src))).toBe(true);
      expect(photo.license).toMatch(/^(CC BY(-SA)?|CC0|Public domain|PDM|PD|GODL|OGL|FAL|GFDL)/i);
      expect(photo.source).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });

  it("declares its vocabulary, its columns and its decks", () => {
    expect(edition.sport).toBe("cricket");
    expect(edition.roles.map((r) => r.id)).toEqual(["batter", "bowler", "all-rounder", "keeper"]);
    expect(edition.statGroups?.map((g) => g.id)).toEqual(["bat", "ball"]);
    expect(edition.decks?.map((d) => d.id)).toContain("bowlers-union");
    expect(edition.supportedModes).toContain("squad-draft");
  });

  it("rejects unknown edition ids", () => {
    expect(() => loadEdition("edition-1999-q9")).toThrow(/ENOENT/);
    expect(() => loadEdition("nope" as string)).toThrow(/invalid edition id/);
    expect(() => loadEdition("edition-../x" as string)).toThrow(/invalid edition id/);
  });
});

describe("fixture edition (fictional)", () => {
  const edition = loadEdition("edition-fixture");

  it("is listed, fictional and unchanged in shape: 64 players across 8 teams", () => {
    expect(listEditionIds()).toContain("edition-fixture");
    expect(edition.sources).toBeUndefined();
    expect(edition.players).toHaveLength(64);
    expect(edition.teams).toHaveLength(8);
    for (const team of edition.teams) {
      expect(edition.players.filter((p) => p.teamId === team.id)).toHaveLength(8);
    }
  });

  it("has the planned rarity distribution (8 legends, 16 stars, 40 regular)", () => {
    const count = (r: string) => edition.players.filter((p) => p.rarity === r).length;
    expect(count("legend")).toBe(8);
    expect(count("star")).toBe(16);
    expect(count("regular")).toBe(40);
  });

  it("stores up-to-date derived ratings", () => {
    expect(regenerateRatings(edition.players, edition.stats)).toEqual(edition.players);
  });
});

/**
 * The second sport (#143). It exists to prove the platform is edition-driven,
 * so what is asserted here is that it shares no vocabulary with cricket: its
 * own roles, its own columns, its own decks, and no Squad Draft.
 */
describe("WWE edition", () => {
  const edition = loadEdition(WWE_EDITION_ID);

  it("is a wrestling edition that plays the trumps modes only", () => {
    expect(edition.sport).toBe("wrestling");
    expect(edition.series).toBe("WWE");
    expect(edition.supportedModes).toEqual(["classic-trumps", "power-trumps"]);
  });

  it("brings its own roles, columns and decks", () => {
    expect(edition.roles.map((r) => r.id)).toEqual([
      "main-eventer",
      "powerhouse",
      "high-flyer",
      "technician",
    ]);
    expect(edition.statGroups?.map((g) => g.name)).toEqual(["The gold", "Ring craft"]);
    expect(edition.decks?.map((d) => d.id)).toEqual([
      "all-stars",
      "hall-of-fame",
      "the-giants",
      "workrate",
    ]);
    // Every card is one of the edition's roles, and every role is on a card.
    expect(new Set(edition.players.map((p) => p.role))).toEqual(
      new Set(edition.roles.map((r) => r.id)),
    );
  });

  it("keeps one stat that lower wins, so the deck is not all big numbers", () => {
    const lower = edition.stats.filter((s) => s.direction === "lower");
    expect(lower.map((s) => s.key)).toEqual(["debutYear"]);
    for (const stat of edition.stats) {
      const values = edition.players.map((p) => p.stats[stat.key] as number);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(stat.min);
      expect(Math.max(...values)).toBeLessThanOrEqual(stat.max);
    }
  });

  it("seats a full table from any of its decks", () => {
    for (const deck of edition.decks ?? []) {
      expect(deckPool(edition, deck.id).length).toBeGreaterThanOrEqual(MIN_DECK_CARDS);
    }
  });

  it("carries a licensed, on-disk photo for nearly every card", () => {
    const webPublic = join(editionsDir(), "..", "..", "..", "apps", "web", "public");
    const withPhoto = edition.players.filter((p) => p.photo !== undefined);
    expect(withPhoto.length / edition.players.length).toBeGreaterThanOrEqual(0.9);
    for (const player of withPhoto) {
      const photo = player.photo as NonNullable<typeof player.photo>;
      expect(existsSync(join(webPublic, photo.src))).toBe(true);
      expect(photo.license).toMatch(/^(CC BY(-SA)?|CC0|Public domain|PDM|PD|GODL|OGL|FAL|GFDL)/i);
      expect(photo.author).not.toBe("");
      expect(photo.source).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });

  it("stores up-to-date derived ratings", () => {
    expect(regenerateRatings(edition.players, edition.stats)).toEqual(edition.players);
  });

  it("re-skins the powers without touching the rules", () => {
    expect(edition.powers?.["powerplay"]?.name).toBe("Run-In");
    expect(edition.powers?.["drs"]?.name).toBe("Cash-In");
    expect(edition.powers?.["super-over"]?.name).toBe("Rematch Clause");
    // The mechanics lines still describe the mode's own rules.
    expect(edition.powers?.["powerplay"]?.win).toMatch(/one extra card/i);
  });

  it("re-skins the powers without touching the rules", () => {
    expect(edition.powers?.["powerplay"]?.name).toBe("Run-In");
    expect(edition.powers?.["drs"]?.name).toBe("Cash-In");
    expect(edition.powers?.["super-over"]?.name).toBe("Rematch Clause");
    // The mechanics lines still describe the mode's own rules.
    expect(edition.powers?.["powerplay"]?.win).toMatch(/one extra card/i);
  });
});
