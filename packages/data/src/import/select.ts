/**
 * From career aggregates to a squad of cards: derive the eight card stats,
 * infer a role, pick a fixed-size squad per nation, then size the stat
 * bounds and rarity tiers to the real distribution.
 *
 * Everything here is deterministic given the aggregates, so a refresh from
 * newer source data is a re-run, and every judgement call that cannot be
 * derived (a role the numbers get wrong, a name) lives in an overrides file
 * rather than in code.
 */
import {
  packFigures,
  type Player,
  type PlayerRole,
  type Rarity,
  type StatDefinition,
  type Team,
} from "@deckxi/shared";
import type { PlayerAggregate } from "./cricsheet.js";

export interface SquadShape {
  batter: number;
  keeper: number;
  "all-rounder": number;
  bowler: number;
}

export interface SelectionConfig {
  teams: Team[];
  /** Minimum appearances before a player is eligible for a card. */
  minMatches: number;
  squad: SquadShape;
  /** Cricsheet id → forced role (for the cases the heuristic gets wrong). */
  roleOverrides: Record<string, PlayerRole>;
  /** Share of the deck in each tier; the remainder is regular. */
  tiers: { legend: number; star: number };
  /**
   * Cricsheet ids to pick only when a nation would otherwise come up short —
   * players we know have no usable photograph. A card with a face beats a
   * marginally better card without one.
   */
  deprioritized?: ReadonlySet<string>;
}

/** Raw card stats, rounded the way the card prints them. */
export function deriveStats(agg: PlayerAggregate): Record<string, number> {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const oversBowled = agg.ballsBowled / 6;
  return {
    battingAvg: round1(agg.runs / Math.max(1, agg.dismissals)),
    strikeRate: round1(agg.ballsFaced === 0 ? 0 : (agg.runs / agg.ballsFaced) * 100),
    runs: agg.runs,
    highest: agg.highest,
    wickets: agg.wickets,
    // A player who never bowled has no economy; treat as the worst plausible
    // figure so "lower wins" never rewards not bowling.
    economy: round1(agg.ballsBowled < 12 ? 12 : agg.runsConceded / oversBowled),
    catches: agg.catches,
    // Packed "w/r"; 0 is the never-bowled sentinel the card prints as a dash.
    bestBowling: agg.spells === 0 ? 0 : packFigures(agg.bestWickets, agg.bestRuns),
  };
}

/**
 * Role from the shape of a career. Keepers are the people who stump;
 * bowlers bowl most overs and bat little; all-rounders do a meaningful
 * amount of both; everyone else is a batter.
 */
export function inferRole(agg: PlayerAggregate): PlayerRole {
  const ballsPerMatch = agg.ballsBowled / agg.matches;
  const runsPerMatch = agg.runs / agg.matches;
  if (agg.stumpings >= 2 && agg.stumpings + agg.catches >= agg.matches * 0.4) return "keeper";
  if (ballsPerMatch >= 12) return runsPerMatch >= 10 ? "all-rounder" : "bowler";
  if (ballsPerMatch >= 6 && runsPerMatch >= 10) return "all-rounder";
  if (ballsPerMatch >= 6) return "bowler";
  return "batter";
}

/** Involvement — what a squad is picked by. Runs, then wickets, then hands. */
function involvement(agg: PlayerAggregate): number {
  return agg.runs + 25 * agg.wickets + 8 * agg.catches + 12 * agg.stumpings;
}

function modalTeam(agg: PlayerAggregate): string {
  let best = "";
  let count = -1;
  for (const [team, n] of Object.entries(agg.teams)) {
    if (n > count) [best, count] = [team, n];
  }
  return best;
}

/** Sort key for a role's shortlist: what that role is picked for. */
function roleRank(role: PlayerRole, agg: PlayerAggregate): number {
  switch (role) {
    case "batter":
      return agg.runs;
    case "bowler":
      return agg.wickets * 25 + agg.runs * 0.1;
    case "keeper":
      return agg.runs + 12 * agg.stumpings + 8 * agg.catches;
    case "all-rounder":
      return involvement(agg);
  }
}

export interface Selected {
  agg: PlayerAggregate;
  team: Team;
  role: PlayerRole;
}

/** Pick a squad per team. Short roles are back-filled by overall involvement. */
export function selectSquads(
  aggregates: Iterable<PlayerAggregate>,
  config: SelectionConfig,
): Selected[] {
  const byTeam = new Map<string, PlayerAggregate[]>();
  for (const agg of aggregates) {
    if (agg.matches < config.minMatches) continue;
    const team = modalTeam(agg);
    if (!config.teams.some((t) => t.name === team)) continue;
    byTeam.set(team, [...(byTeam.get(team) ?? []), agg]);
  }

  const deprioritized = config.deprioritized ?? new Set<string>();
  const picked: Selected[] = [];
  for (const team of config.teams) {
    const everyone = byTeam.get(team.name) ?? [];
    const role = (agg: PlayerAggregate) => config.roleOverrides[agg.id] ?? inferRole(agg);
    const taken = new Set<string>();
    const squadSize = Object.values(config.squad).reduce((a, b) => a + b, 0);
    const count = () => picked.filter((p) => p.team.id === team.id).length;

    // Preferred players first — role seats, then the leftover seats by
    // involvement — and only for the seats still empty, the rest. A face
    // beats the squad's shape: a nation with no photographed keeper fields
    // an extra batter rather than a silhouette.
    const pools = [
      everyone.filter((a) => !deprioritized.has(a.id)),
      everyone.filter((a) => deprioritized.has(a.id)),
    ];
    for (const pool of pools) {
      for (const r of Object.keys(config.squad) as PlayerRole[]) {
        const have = picked.filter((p) => p.team.id === team.id && p.role === r).length;
        const shortlist = pool
          .filter((a) => !taken.has(a.id) && role(a) === r)
          .sort((a, b) => roleRank(r, b) - roleRank(r, a) || a.id.localeCompare(b.id))
          .slice(0, Math.max(0, Math.min(config.squad[r] - have, squadSize - count())));
        for (const agg of shortlist) {
          taken.add(agg.id);
          picked.push({ agg, team, role: r });
        }
      }
      const fill = pool
        .filter((a) => !taken.has(a.id))
        .sort((a, b) => involvement(b) - involvement(a) || a.id.localeCompare(b.id));
      while (count() < squadSize && fill.length > 0) {
        const agg = fill.shift() as PlayerAggregate;
        taken.add(agg.id);
        picked.push({ agg, team, role: role(agg) });
      }
    }
  }
  return picked;
}

/** Stat bounds sized to the selected deck: a rounded floor and ceiling. */
export function fitBounds(
  defs: readonly StatDefinition[],
  players: readonly { stats: Record<string, number> }[],
): StatDefinition[] {
  const niceStep = (span: number) => {
    const pow = 10 ** Math.floor(Math.log10(Math.max(1, span)));
    return span / pow >= 5 ? pow : pow / 2;
  };
  return defs.map((def) => {
    const values = players.map((p) => p.stats[def.key] ?? 0);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const step = niceStep(hi - lo);
    const min = def.format !== "decimal" && lo >= 0 ? 0 : Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    return { ...def, min, max: max > min ? max : min + step };
  });
}

/** Rarity by rating rank: the top slice are legends, the next stars. */
export function assignRarity<P extends { rating: number; id: string }>(
  players: readonly P[],
  tiers: SelectionConfig["tiers"],
): (P & { rarity: Rarity })[] {
  const ranked = [...players].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  const legends = Math.round(players.length * tiers.legend);
  const stars = Math.round(players.length * tiers.star);
  const tier = new Map<string, Rarity>();
  ranked.forEach((p, i) =>
    tier.set(p.id, i < legends ? "legend" : i < legends + stars ? "star" : "regular"),
  );
  return players.map((p) => ({ ...p, rarity: tier.get(p.id) ?? "regular" }));
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type Card = Omit<Player, "rating" | "rarity">;
