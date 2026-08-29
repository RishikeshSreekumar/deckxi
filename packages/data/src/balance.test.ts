import { describe, expect, it } from "vitest";
import { analyzeBalance, dominates, formatBalanceReport } from "./balance.js";
import { loadEdition } from "./editions.js";
import { regenerateRatings } from "./rating.js";
import type { Edition, Player } from "@deckxi/shared";

const edition = loadEdition();

describe("dominates", () => {
  const base = edition.players[0] as Player;
  it("detects strict dominance respecting direction", () => {
    const better: Player = {
      ...base,
      id: "better",
      stats: { ...base.stats, economy: (base.stats["economy"] ?? 10) - 1 },
    };
    expect(dominates(better, base, edition.stats)).toBe(true);
    expect(dominates(base, better, edition.stats)).toBe(false);
  });

  it("equal cards dominate neither way", () => {
    expect(dominates(base, { ...base, id: "clone" }, edition.stats)).toBe(false);
  });
});

describe("analyzeBalance on the seed edition", () => {
  const report = analyzeBalance(edition);

  it("finds no strictly dominant card and no problems", () => {
    expect(report.strictlyDominantCards).toEqual([]);
    expect(report.staleRatings).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it("reports a row per stat with sane spread", () => {
    expect(report.statRows).toHaveLength(edition.stats.length);
    for (const row of report.statRows) expect(row.min).toBeLessThan(row.max);
  });

  it("formats a markdown report", () => {
    const text = formatBalanceReport(report);
    expect(text).toContain("# Balance report — edition-2026-q3");
    expect(text).toContain("| battingAvg |");
    expect(text).toContain("Strictly dominant cards: none");
  });
});

describe("analyzeBalance failure modes", () => {
  it("flags a strictly dominant card and stale ratings", () => {
    const god: Player = {
      ...(edition.players[0] as Player),
      id: "god-card",
      stats: {
        battingAvg: 70,
        strikeRate: 250,
        runs: 15000,
        wickets: 600,
        economy: 3,
        catches: 350,
      },
    };
    const broken: Edition = {
      ...edition,
      players: [...regenerateRatings([god], edition.stats), ...edition.players.slice(1)],
    };
    const report = analyzeBalance(broken);
    expect(report.strictlyDominantCards).toEqual(["god-card"]);
    expect(report.problems.join("\n")).toMatch(/strictly dominant/);
  });

  it("flags stale ratings", () => {
    const stale: Edition = {
      ...edition,
      players: edition.players.map((p, i) => (i === 0 ? { ...p, rating: 1 } : p)),
    };
    const report = analyzeBalance(stale);
    expect(report.staleRatings).toEqual([edition.players[0]?.id]);
  });
});
