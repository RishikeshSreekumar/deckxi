/**
 * Squad Draft — card strength and the match simulation.
 *
 * A card has three facets (batting, bowling, fielding), each the mean of its
 * normalised stats for that facet on a 0–100 scale. Roles weight what a card
 * is asked to do: a bowler bats at 60%, a batter bowls at 50%, a keeper at
 * 25%. Form is a per-card multiplier in [0.9, 1.1] rolled once per game from
 * the seed, so the same two XIs do not always produce the same scorecard —
 * but the better side is still the better side.
 *
 * A match is three phases, each a duel between one group of batters and one
 * group of bowlers (or, in the last phase, the tail and the field). Every
 * number here is a plain average so group sizes never bias a phase.
 */
import { mulberry32 } from "../../rng.js";
import { normalizedValue } from "../../stats.js";
import type { CardDefinition, CardId, PlayerId } from "../../types.js";
import type {
  Facets,
  LeagueResult,
  MatchReport,
  PhaseReport,
  Roster,
  SquadDraftConfig,
  SquadPhaseKey,
  TableRow,
} from "./types.js";

export type Facet = keyof Facets;

/** What card strength needs from a config — the client passes its wire view. */
export type ScoringConfig = Pick<SquadDraftConfig, "facets" | "stats">;

/** Weight of a card's batting facet when it bats, by role. */
export const BAT_WEIGHT: Record<string, number> = {
  batter: 1,
  keeper: 1,
  "all-rounder": 1,
  bowler: 0.6,
};
/** Weight of a card's bowling facet when it is asked to bowl, by role. */
export const BOWL_WEIGHT: Record<string, number> = {
  bowler: 1,
  "all-rounder": 1,
  batter: 0.5,
  keeper: 0.25,
};
export const KEEPER_ROLE = "keeper";
/** A keeper-role card behind the stumps adds this; anyone else costs it. */
export const KEEPER_BONUS = 10;

/** The role a card plays, or "batter" when the edition gave it none. */
export function roleOf(card: CardDefinition): string {
  return card.role ?? "batter";
}

/** Raw facet strength 0–100 (0 when the facet has no stats the card carries). */
export function facetScore(card: CardDefinition, facet: Facet, config: ScoringConfig): number {
  const keys = config.facets[facet];
  if (keys.length === 0) return 0;
  const defs = new Map(config.stats.map((s) => [s.key, s]));
  let total = 0;
  for (const key of keys) {
    const def = defs.get(key);
    if (def !== undefined) total += normalizedValue(card, def);
  }
  return round1((100 * total) / keys.length);
}

/** Batting strength as it counts in a match: facet × role weight. */
export function battingStrength(card: CardDefinition, config: ScoringConfig): number {
  return facetScore(card, "batting", config) * (BAT_WEIGHT[roleOf(card)] ?? 1);
}

/** Bowling strength as it counts in a match: facet × role weight. */
export function bowlingStrength(card: CardDefinition, config: ScoringConfig): number {
  return facetScore(card, "bowling", config) * (BOWL_WEIGHT[roleOf(card)] ?? 0.5);
}

export function fieldingStrength(card: CardDefinition, config: ScoringConfig): number {
  return facetScore(card, "fielding", config);
}

/**
 * One number for "how good is this card", for auto-picks and the bot.
 * Batting and bowling dominate; fielding is the tie-breaker it is in life.
 */
export function overall(card: CardDefinition, config: ScoringConfig): number {
  return round1(
    0.45 * battingStrength(card, config) +
      0.4 * bowlingStrength(card, config) +
      0.15 * fieldingStrength(card, config),
  );
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Roll every card's form for the game: one seeded stream, consumed in a
 * fixed order (active players in seat order, each XI in batting order) so
 * the roll is a pure function of the seed and the rosters.
 */
export function rollForm(
  config: SquadDraftConfig,
  rosters: Record<PlayerId, Roster>,
): Record<CardId, number> {
  // Decorrelate from the pool shuffle without leaving the seed behind.
  const rng = mulberry32((config.seed ^ 0x5eed5eed) >>> 0);
  const form: Record<CardId, number> = {};
  for (const playerId of config.players) {
    const roster = rosters[playerId];
    if (roster === undefined) continue;
    for (const cardId of roster.order) form[cardId] = round1(0.9 + 0.2 * rng());
  }
  return form;
}

interface Side {
  playerId: PlayerId;
  roster: Roster;
}

function cardMap(config: SquadDraftConfig): Map<CardId, CardDefinition> {
  return new Map(config.cards.map((c) => [c.id, c]));
}

/** Simulate one match. `form` may be empty (every card at 1.0) for previews. */
export function playMatch(
  config: SquadDraftConfig,
  home: Side,
  away: Side,
  form: Record<CardId, number>,
): MatchReport {
  const cards = cardMap(config);
  const f = (id: CardId): number => form[id] ?? 1;
  const card = (id: CardId): CardDefinition => {
    const found = cards.get(id);
    if (found === undefined) throw new Error(`playMatch: unknown card ${id}`);
    return found;
  };
  const bat = (ids: CardId[]): number =>
    mean(ids.map((id) => battingStrength(card(id), config) * f(id)));
  const bowl = (ids: CardId[]): number =>
    mean(ids.map((id) => bowlingStrength(card(id), config) * f(id)));
  const field = (ids: CardId[]): number =>
    mean(ids.map((id) => fieldingStrength(card(id), config) * f(id)));
  const gloves = (side: Side): number =>
    roleOf(card(side.roster.keeper)) === KEEPER_ROLE ? KEEPER_BONUS : -KEEPER_BONUS;

  const duel = (
    key: SquadPhaseKey,
    batters: (r: Roster) => CardId[],
    bowlers: (r: Roster) => CardId[],
  ): PhaseReport => {
    const h = bat(batters(home.roster)) - bowl(bowlers(away.roster));
    const a = bat(batters(away.roster)) - bowl(bowlers(home.roster));
    return report(key, h, a, home.playerId, away.playerId);
  };

  const phases: PhaseReport[] = [
    duel(
      "powerplay",
      (r) => r.order.slice(0, 3),
      (r) => r.bowlers.slice(0, 2),
    ),
    duel(
      "middle",
      (r) => r.order.slice(3, 7),
      (r) => r.bowlers.slice(2, 5),
    ),
    report(
      "finish",
      bat(home.roster.order.slice(7)) + field(home.roster.order) + gloves(home),
      bat(away.roster.order.slice(7)) + field(away.roster.order) + gloves(away),
      home.playerId,
      away.playerId,
    ),
  ];

  const homePhases = phases.filter((p) => p.winner === home.playerId).length;
  const awayPhases = phases.filter((p) => p.winner === away.playerId).length;
  const margin = round1(phases.reduce((sum, p) => sum + (p.home - p.away), 0));
  const result: MatchReport["result"] =
    homePhases !== awayPhases
      ? homePhases > awayPhases
        ? "home"
        : "away"
      : margin !== 0
        ? margin > 0
          ? "home"
          : "away"
        : "draw";
  return {
    home: home.playerId,
    away: away.playerId,
    phases,
    homePhases,
    awayPhases,
    margin,
    result,
  };
}

function report(
  key: SquadPhaseKey,
  home: number,
  away: number,
  homeId: PlayerId,
  awayId: PlayerId,
): PhaseReport {
  const h = round1(home);
  const a = round1(away);
  return { key, home: h, away: a, winner: h === a ? null : h > a ? homeId : awayId };
}

/**
 * Every active side plays every other once (home = the earlier seat). Two
 * points a win, one a draw. Table order: points, margin, seat.
 */
export function playLeague(
  config: SquadDraftConfig,
  rosters: Record<PlayerId, Roster>,
  form: Record<CardId, number>,
): LeagueResult {
  const sides: Side[] = config.players
    .filter((id) => rosters[id] !== undefined)
    .map((id) => ({ playerId: id, roster: rosters[id] as Roster }));
  const rows = new Map<PlayerId, TableRow>(
    sides.map((s) => [
      s.playerId,
      { playerId: s.playerId, played: 0, won: 0, drawn: 0, lost: 0, points: 0, margin: 0 },
    ]),
  );
  const matches: MatchReport[] = [];
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const home = sides[i] as Side;
      const away = sides[j] as Side;
      const match = playMatch(config, home, away, form);
      matches.push(match);
      const h = rows.get(home.playerId) as TableRow;
      const a = rows.get(away.playerId) as TableRow;
      h.played++;
      a.played++;
      h.margin = round1(h.margin + match.margin);
      a.margin = round1(a.margin - match.margin);
      if (match.result === "draw") {
        h.drawn++;
        a.drawn++;
        h.points++;
        a.points++;
      } else if (match.result === "home") {
        h.won++;
        a.lost++;
        h.points += 2;
      } else {
        a.won++;
        h.lost++;
        a.points += 2;
      }
    }
  }
  const seat = new Map(config.players.map((id, i) => [id, i]));
  const table = [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.margin - x.margin ||
      (seat.get(x.playerId) ?? 0) - (seat.get(y.playerId) ?? 0),
  );
  return { matches, table };
}
