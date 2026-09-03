import { describe, expect, it } from "vitest";
import {
  addPlayer,
  regenAllRatings,
  removePlayer,
  setPlayerRarity,
  setPlayerStat,
} from "./admin.js";
import { loadEdition } from "./editions.js";
import { computeRating } from "./rating.js";
import type { Player } from "@deckxi/shared";

// The fictional fixture: its bounds are wide enough for the edits below.
const edition = loadEdition("edition-fixture");
const first = edition.players[0] as Player;

describe("admin operations", () => {
  it("set-stat updates the value, re-derives the rating and bumps version", () => {
    const next = setPlayerStat(edition, first.id, "battingAvg", 60);
    const player = next.players.find((p) => p.id === first.id) as Player;
    expect(player.stats["battingAvg"]).toBe(60);
    expect(player.rating).toBe(computeRating(player, next.stats));
    expect(next.version).toBe(edition.version + 1);
  });

  it("set-stat rejects out-of-bounds values and unknown stats/players", () => {
    expect(() => setPlayerStat(edition, first.id, "battingAvg", 500)).toThrow(/invalid/);
    expect(() => setPlayerStat(edition, first.id, "sixes", 1)).toThrow(/no such stat/);
    expect(() => setPlayerStat(edition, "ghost", "battingAvg", 1)).toThrow(/no such player/);
  });

  it("set-rarity bumps rarity", () => {
    const next = setPlayerRarity(edition, first.id, "legend");
    expect(next.players.find((p) => p.id === first.id)?.rarity).toBe("legend");
  });

  it("add-player derives the rating and rejects duplicates", () => {
    const input: Omit<Player, "rating"> = {
      id: "new-signing",
      name: "New Signing",
      role: "batter",
      teamId: first.teamId,
      nationality: "India",
      rarity: "regular",
      stats: { battingAvg: 40, strikeRate: 130, runs: 4000, wickets: 5, economy: 9, catches: 60 },
    };
    const next = addPlayer(edition, input);
    const added = next.players.find((p) => p.id === "new-signing") as Player;
    expect(added.rating).toBe(computeRating(added, next.stats));
    expect(() => addPlayer(next, input)).toThrow(/already exists/);
  });

  it("remove-player deletes and keeps the edition valid", () => {
    const next = removePlayer(edition, first.id);
    expect(next.players).toHaveLength(edition.players.length - 1);
  });

  it("regen-ratings is idempotent on already-fresh data (except version)", () => {
    const next = regenAllRatings(edition);
    expect(next.players).toEqual(edition.players);
    expect(next.version).toBe(edition.version + 1);
  });
});
