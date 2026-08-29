/**
 * Stat comparison helpers — directionality, missing-stat handling and the
 * deterministic normalisation used by auto-play and the baseline bot.
 */
import type { CardDefinition, StatDefinition, StatKey } from "./types.js";

/** The value a card is treated as when it lacks the selected stat. */
export function worstValue(def: StatDefinition): number {
  return def.direction === "higher" ? def.min : def.max;
}

/** A card's value for a stat, worst-possible when missing. */
export function statValue(card: CardDefinition, def: StatDefinition): number {
  return card.stats[def.key] ?? worstValue(def);
}

/** True if `a` beats `b` on this stat (strictly better, respecting direction). */
export function beats(a: number, b: number, def: StatDefinition): boolean {
  return def.direction === "higher" ? a > b : a < b;
}

/**
 * Normalised strength in [0, 1]: `(value − min) / (max − min)`, inverted for
 * lower-wins stats. Missing stats and degenerate bounds (min === max) → 0.
 */
export function normalizedValue(card: CardDefinition, def: StatDefinition): number {
  const value = card.stats[def.key];
  if (value === undefined || def.max === def.min) return 0;
  const n = Math.min(1, Math.max(0, (value - def.min) / (def.max - def.min)));
  return def.direction === "higher" ? n : 1 - n;
}

/**
 * The deterministic "best stat" pick used by auto-play and the baseline bot:
 * highest normalised value, ties broken by stat-definition order.
 */
export function chooseBestStat(card: CardDefinition, stats: readonly StatDefinition[]): StatKey {
  const first = stats[0];
  if (first === undefined) throw new Error("chooseBestStat: no stat definitions");
  let bestKey = first.key;
  let bestScore = normalizedValue(card, first);
  for (const def of stats.slice(1)) {
    const score = normalizedValue(card, def);
    if (score > bestScore) {
      bestScore = score;
      bestKey = def.key;
    }
  }
  return bestKey;
}
