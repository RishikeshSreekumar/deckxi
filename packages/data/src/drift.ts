/**
 * Form drift: the weekly "data refresh" heuristic. Not real feeds — plausible
 * seeded randomness. Every player gets a small form factor; a few run hot or
 * cold. Values stay inside stat bounds, ratings are re-derived, the edition
 * version bumps. Pure and deterministic: (edition, seed, date) → edition.
 */
import { editionSchema, type Edition, type Player } from "@deckxi/shared";
import { regenerateRatings } from "./rating.js";

/** Same PRNG family as the engine; duplicated to keep data engine-free. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Base weekly wobble ±4%; ~1 in 5 players runs hot or cold for ±8% more. */
const BASE_DRIFT = 0.04;
const STREAK_CHANCE = 0.2;
const STREAK_DRIFT = 0.08;

export interface DriftResult {
  edition: Edition;
  /** player id → form factor applied (1 = unchanged). */
  formFactors: Record<string, number>;
}

export function driftEdition(edition: Edition, seed: number, generatedAt: string): DriftResult {
  const rng = mulberry32(seed);
  const formFactors: Record<string, number> = {};

  const players: Player[] = edition.players.map((player) => {
    let factor = 1 + (rng() * 2 - 1) * BASE_DRIFT;
    const streak = rng();
    if (streak < STREAK_CHANCE / 2) factor += STREAK_DRIFT;
    else if (streak < STREAK_CHANCE) factor -= STREAK_DRIFT;
    formFactors[player.id] = Math.round(factor * 1000) / 1000;

    const stats: Player["stats"] = {};
    for (const def of edition.stats) {
      const value = player.stats[def.key] ?? def.min;
      // "Better" moves with form regardless of direction: lower-wins stats
      // improve by shrinking.
      // A packed bowling analysis is a record, not a rate: form leaves it alone.
      if (def.format === "figures") {
        stats[def.key] = value;
        continue;
      }
      const drifted = def.direction === "higher" ? value * factor : value / factor;
      const dp = def.format === "integer" ? 1 : 10;
      stats[def.key] = Math.min(def.max, Math.max(def.min, Math.round(drifted * dp) / dp));
    }
    return { ...player, stats };
  });

  const next: Edition = {
    ...edition,
    version: edition.version + 1,
    generatedAt,
    players: regenerateRatings(players, edition.stats),
  };
  // A drift must never produce an invalid edition.
  const parsed = editionSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(`drift produced an invalid edition: ${parsed.error.message}`);
  }
  return { edition: parsed.data, formFactors };
}

/** Top movers by rating delta, for the PR body / script output. */
export function topMovers(
  before: Edition,
  after: Edition,
  count = 5,
): { id: string; name: string; delta: number }[] {
  const prev = new Map(before.players.map((p) => [p.id, p.rating]));
  return after.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      delta: Math.round((p.rating - (prev.get(p.id) ?? 0)) * 10) / 10,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, count);
}
