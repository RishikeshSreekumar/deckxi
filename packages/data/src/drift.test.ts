import { describe, expect, it } from "vitest";
import { analyzeBalance } from "./balance.js";
import { driftEdition, topMovers } from "./drift.js";
import { loadEdition } from "./editions.js";

// Drift is for invented data, so it is exercised on the fictional fixture.
const edition = loadEdition("edition-fixture");
const AT = "2026-09-05T06:00:00Z";

describe("driftEdition", () => {
  it("is deterministic per seed and differs across seeds", () => {
    expect(driftEdition(edition, 7, AT)).toEqual(driftEdition(edition, 7, AT));
    expect(driftEdition(edition, 7, AT).edition.players).not.toEqual(
      driftEdition(edition, 8, AT).edition.players,
    );
  });

  it("bumps version, stamps generatedAt, keeps id and rosters", () => {
    const { edition: next } = driftEdition(edition, 7, AT);
    expect(next.version).toBe(edition.version + 1);
    expect(next.generatedAt).toBe(AT);
    expect(next.id).toBe(edition.id);
    expect(next.players.map((p) => p.id)).toEqual(edition.players.map((p) => p.id));
    expect(next.teams).toEqual(edition.teams);
  });

  it("keeps every value in bounds and passes the balance gate", () => {
    // Chain several weeks of drift and re-check.
    let current = edition;
    for (const seed of [1, 2, 3, 4, 5]) {
      current = driftEdition(current, seed, AT).edition;
    }
    for (const def of current.stats) {
      for (const p of current.players) {
        const v = p.stats[def.key] ?? NaN;
        expect(v).toBeGreaterThanOrEqual(def.min);
        expect(v).toBeLessThanOrEqual(def.max);
      }
    }
    expect(analyzeBalance(current).staleRatings).toEqual([]);
  });

  it("actually moves values and records form factors", () => {
    const { edition: next, formFactors } = driftEdition(edition, 7, AT);
    expect(next.players).not.toEqual(edition.players);
    expect(Object.keys(formFactors)).toHaveLength(edition.players.length);
    const factors = Object.values(formFactors);
    expect(Math.max(...factors)).toBeGreaterThan(1);
    expect(Math.min(...factors)).toBeLessThan(1);
  });

  it("improves lower-wins stats when form is high", () => {
    const { edition: next, formFactors } = driftEdition(edition, 7, AT);
    const hot = edition.players.find((p) => (formFactors[p.id] ?? 1) > 1.05);
    expect(hot).toBeDefined();
    if (hot === undefined) return;
    const after = next.players.find((p) => p.id === hot.id);
    expect(after?.stats["economy"]).toBeLessThanOrEqual(hot.stats["economy"] ?? Infinity);
  });
});

describe("topMovers", () => {
  it("returns the biggest absolute rating deltas", () => {
    const { edition: next } = driftEdition(edition, 7, AT);
    const movers = topMovers(edition, next, 3);
    expect(movers).toHaveLength(3);
    const deltas = movers.map((m) => Math.abs(m.delta));
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });
});
