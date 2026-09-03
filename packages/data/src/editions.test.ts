import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_EDITION_ID, editionsDir, listEditionIds, loadEdition } from "./editions.js";
import { computeRating, regenerateRatings } from "./rating.js";

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

  it("has at least 200 cards, fifteen per nation", () => {
    expect(edition.players.length).toBeGreaterThanOrEqual(200);
    expect(edition.teams).toHaveLength(14);
    for (const team of edition.teams) {
      expect(edition.players.filter((p) => p.teamId === team.id)).toHaveLength(15);
    }
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
