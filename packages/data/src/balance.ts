/**
 * Balance analysis for an edition: stat distributions, dominance detection
 * ("is any card strictly dominant?") and derived-rating freshness. Run in CI
 * on every change to the dataset.
 */
import type { Edition, Player, StatDefinition } from "@deckxi/shared";
import { computeRating } from "./rating.js";

/** True if `a` is at least as good as `b` on every stat and better on one. */
export function dominates(a: Player, b: Player, stats: readonly StatDefinition[]): boolean {
  let strict = false;
  for (const def of stats) {
    const av = a.stats[def.key] ?? (def.direction === "higher" ? def.min : def.max);
    const bv = b.stats[def.key] ?? (def.direction === "higher" ? def.min : def.max);
    const better = def.direction === "higher" ? av > bv : av < bv;
    const worse = def.direction === "higher" ? av < bv : av > bv;
    if (worse) return false;
    if (better) strict = true;
  }
  return strict;
}

export interface BalanceReport {
  editionId: string;
  statRows: { key: string; min: number; mean: number; max: number }[];
  /** Pairs [dominator, dominated]. Some are expected (legends over regulars). */
  dominatedPairs: [string, string][];
  /** Cards that dominate EVERY other card — always a balance failure. */
  strictlyDominantCards: string[];
  /** Players whose stored rating disagrees with the derived formula. */
  staleRatings: string[];
  problems: string[];
}

export function analyzeBalance(edition: Edition): BalanceReport {
  const { players, stats } = edition;

  const statRows = stats.map((def) => {
    const values = players.map((p) => p.stats[def.key] ?? 0);
    return {
      key: def.key,
      min: Math.min(...values),
      mean: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
      max: Math.max(...values),
    };
  });

  const dominatedPairs: [string, string][] = [];
  const dominationCount = new Map<string, number>();
  for (const a of players) {
    for (const b of players) {
      if (a.id !== b.id && dominates(a, b, stats)) {
        dominatedPairs.push([a.id, b.id]);
        dominationCount.set(a.id, (dominationCount.get(a.id) ?? 0) + 1);
      }
    }
  }
  const strictlyDominantCards = players
    .filter((p) => dominationCount.get(p.id) === players.length - 1)
    .map((p) => p.id);

  const staleRatings = players.filter((p) => p.rating !== computeRating(p, stats)).map((p) => p.id);

  const problems: string[] = [];
  if (strictlyDominantCards.length > 0) {
    problems.push(`strictly dominant card(s): ${strictlyDominantCards.join(", ")}`);
  }
  if (staleRatings.length > 0) {
    problems.push(`stale derived ratings (run regen-ratings): ${staleRatings.join(", ")}`);
  }
  // Every stat should have spread — a flat stat is never worth picking.
  for (const row of statRows) {
    if (row.min === row.max) problems.push(`stat ${row.key} is flat (${row.min}) across all cards`);
  }

  return {
    editionId: edition.id,
    statRows,
    dominatedPairs,
    strictlyDominantCards,
    staleRatings,
    problems,
  };
}

export function formatBalanceReport(report: BalanceReport): string {
  const lines = [
    `# Balance report — ${report.editionId}`,
    "",
    "| stat | min | mean | max |",
    "| --- | --- | --- | --- |",
    ...report.statRows.map((r) => `| ${r.key} | ${r.min} | ${r.mean} | ${r.max} |`),
    "",
    `Dominated pairs: ${report.dominatedPairs.length}`,
    `Strictly dominant cards: ${report.strictlyDominantCards.length === 0 ? "none" : report.strictlyDominantCards.join(", ")}`,
  ];
  if (report.problems.length > 0) {
    lines.push("", "## Problems", ...report.problems.map((p) => `- ${p}`));
  }
  return lines.join("\n");
}
