import { describe, expect, it } from "vitest";
import { CURRENT_EDITION_ID, listEditionIds, loadEdition } from "./editions.js";
import { computeRating, regenerateRatings } from "./rating.js";

describe("seed edition", () => {
  const edition = loadEdition();

  it("is listed and is the current edition", () => {
    expect(listEditionIds()).toContain(CURRENT_EDITION_ID);
    expect(edition.id).toBe(CURRENT_EDITION_ID);
  });

  it("has 64 players across 8 teams", () => {
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

  it("covers every role on every team", () => {
    for (const team of edition.teams) {
      const roles = new Set(edition.players.filter((p) => p.teamId === team.id).map((p) => p.role));
      expect(roles).toEqual(new Set(["batter", "bowler", "all-rounder", "keeper"]));
    }
  });

  it("stores up-to-date derived ratings", () => {
    for (const player of edition.players) {
      expect(player.rating).toBe(computeRating(player, edition.stats));
    }
  });

  it("regenerateRatings is idempotent on the seed data", () => {
    expect(regenerateRatings(edition.players, edition.stats)).toEqual(edition.players);
  });

  it("rejects unknown edition ids", () => {
    expect(() => loadEdition("edition-1999-q9")).toThrow(/invalid edition id/);
    expect(() => loadEdition("nope" as string)).toThrow(/invalid edition id/);
  });
});
