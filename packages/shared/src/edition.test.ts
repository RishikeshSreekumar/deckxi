import { describe, expect, it } from "vitest";
import { editionSchema, type Edition } from "./edition.js";

const stats = [
  {
    key: "battingAvg",
    name: "Batting average",
    direction: "higher",
    format: "decimal",
    min: 0,
    max: 70,
  },
  {
    key: "strikeRate",
    name: "Strike rate",
    direction: "higher",
    format: "decimal",
    min: 40,
    max: 250,
  },
  { key: "runs", name: "Career runs", direction: "higher", format: "integer", min: 0, max: 15000 },
  { key: "wickets", name: "Wickets", direction: "higher", format: "integer", min: 0, max: 600 },
  { key: "economy", name: "Economy", direction: "lower", format: "decimal", min: 3, max: 15 },
  { key: "catches", name: "Catches", direction: "higher", format: "integer", min: 0, max: 350 },
] as const;

function makeEdition(): Edition {
  const teams = [
    { id: "team-a", name: "Team A", shortName: "TA", color: "#112233" },
    { id: "team-b", name: "Team B", shortName: "TB", color: "#445566" },
  ];
  const players = Array.from({ length: 8 }, (_, i) => ({
    id: `player-${i}`,
    name: `Player ${i}`,
    role: "batter" as const,
    teamId: i % 2 === 0 ? "team-a" : "team-b",
    nationality: "India",
    rarity: "regular" as const,
    rating: 50,
    stats: { battingAvg: 40, strikeRate: 130, runs: 5000, wickets: 10, economy: 8, catches: 50 },
  }));
  return {
    id: "edition-2026-q3",
    name: "Test Edition",
    version: 1,
    generatedAt: "2026-08-29T00:00:00Z",
    stats: [...stats] as Edition["stats"],
    teams,
    players,
  };
}

describe("editionSchema", () => {
  it("accepts a well-formed edition", () => {
    expect(editionSchema.safeParse(makeEdition()).success).toBe(true);
  });

  const failsWith = (mutate: (e: Edition) => void, pattern: RegExp) => {
    const edition = makeEdition();
    mutate(edition);
    const result = editionSchema.safeParse(edition);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join("\n")).toMatch(pattern);
    }
  };

  it("accepts a photo credit and declared sources", () => {
    const edition = makeEdition();
    (edition.players[0] as Edition["players"][number]).photo = {
      src: "/cards/edition-2026-q3/player-0.webp",
      author: "Someone",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      source: "https://commons.wikimedia.org/wiki/File:Player_0.jpg",
    };
    edition.sources = [{ name: "Cricsheet", url: "https://cricsheet.org/", license: "ODC-By 1.0" }];
    expect(editionSchema.safeParse(edition).success).toBe(true);
  });

  it("accepts fixture-style ids and rejects malformed ones", () => {
    expect(editionSchema.safeParse({ ...makeEdition(), id: "edition-fixture" }).success).toBe(true);
    expect(editionSchema.safeParse({ ...makeEdition(), id: "Edition-2026" }).success).toBe(false);
    expect(editionSchema.safeParse({ ...makeEdition(), id: "2026-q3" }).success).toBe(false);
  });

  it("rejects unknown teamId", () => {
    failsWith((e) => {
      (e.players[0] as Edition["players"][number]).teamId = "team-zz";
    }, /unknown teamId/);
  });

  it("rejects a missing stat on a player", () => {
    failsWith((e) => {
      delete (e.players[0] as Edition["players"][number]).stats["economy"];
    }, /missing stat economy/);
  });

  it("rejects out-of-bounds stat values", () => {
    failsWith((e) => {
      (e.players[0] as Edition["players"][number]).stats["battingAvg"] = 99;
    }, /outside \[0, 70\]/);
  });

  it("rejects stats not defined by the edition", () => {
    failsWith((e) => {
      (e.players[0] as Edition["players"][number]).stats["sixes"] = 3;
    }, /unknown stat sixes/);
  });

  it("rejects duplicate player ids", () => {
    failsWith((e) => {
      (e.players[1] as Edition["players"][number]).id = "player-0";
    }, /duplicate player id/);
  });

  it("rejects bad edition ids and ratings", () => {
    failsWith((e) => {
      e.id = "Edition Latest" as Edition["id"];
    }, /edition-<slug>/);
    failsWith((e) => {
      (e.players[0] as Edition["players"][number]).rating = 101;
    }, /<=100|less than or equal/i);
  });
});
