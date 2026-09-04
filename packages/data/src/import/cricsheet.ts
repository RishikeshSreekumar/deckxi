/**
 * Cricsheet ball-by-ball → per-player career aggregates.
 *
 * Reads the JSON match files Cricsheet publishes (https://cricsheet.org,
 * format v1.x) and folds every delivery into batting, bowling and fielding
 * totals per person, keyed by the Cricsheet register identifier so a player
 * whose printed name changes (or clashes) never splits into two people.
 *
 * Only aggregates are kept — the eight card stats are derived from these in
 * `select.ts`, so a refresh is a re-run rather than a hand edit.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The subset of a Cricsheet match file the importer reads. */
export interface CricsheetMatch {
  info: {
    dates: string[];
    gender: string;
    match_type: string;
    team_type?: string;
    teams: string[];
    players: Record<string, string[]>;
    registry: { people: Record<string, string> };
  };
  innings: {
    team: string;
    overs?: {
      over: number;
      deliveries: {
        batter: string;
        bowler: string;
        non_striker: string;
        runs: { batter: number; extras: number; total: number };
        extras?: Partial<Record<"wides" | "noballs" | "byes" | "legbyes" | "penalty", number>>;
        wickets?: {
          kind: string;
          player_out: string;
          fielders?: { name?: string; substitute?: boolean }[];
        }[];
      }[];
    }[];
  }[];
}

export interface PlayerAggregate {
  /** Cricsheet register identifier. */
  id: string;
  /** Scorecard-style name as printed by Cricsheet, e.g. "V Kohli". */
  name: string;
  /** Appearances per team; the modal team is the player's nation. */
  teams: Record<string, number>;
  matches: number;
  firstMatch: string;
  lastMatch: string;
  innings: number;
  runs: number;
  ballsFaced: number;
  dismissals: number;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  catches: number;
  stumpings: number;
  /** Highest individual score (not-out marker not tracked). */
  highest: number;
  /** Innings bowled in. */
  spells: number;
  /** Best bowling analysis in an innings: most wickets, then fewest runs. */
  bestWickets: number;
  bestRuns: number;
}

/** Dismissals credited to the bowler. */
const BOWLER_WICKETS = new Set([
  "bowled",
  "caught",
  "caught and bowled",
  "lbw",
  "stumped",
  "hit wicket",
]);
/** "Out" for batting-average purposes — anything that ends the innings but a retirement. */
const NOT_A_DISMISSAL = new Set(["retired hurt", "retired not out"]);

export interface MatchFilter {
  gender?: string;
  matchType?: string;
  teamType?: string;
}

export function matchesFilter(match: CricsheetMatch, filter: MatchFilter): boolean {
  const { info } = match;
  if (filter.gender !== undefined && info.gender !== filter.gender) return false;
  if (filter.matchType !== undefined && info.match_type !== filter.matchType) return false;
  if (filter.teamType !== undefined && info.team_type !== filter.teamType) return false;
  return true;
}

function blank(id: string, name: string, date: string): PlayerAggregate {
  return {
    id,
    name,
    teams: {},
    matches: 0,
    firstMatch: date,
    lastMatch: date,
    innings: 0,
    runs: 0,
    ballsFaced: 0,
    dismissals: 0,
    ballsBowled: 0,
    runsConceded: 0,
    wickets: 0,
    catches: 0,
    stumpings: 0,
    highest: 0,
    spells: 0,
    bestWickets: 0,
    bestRuns: 0,
  };
}

/** Fold one match into the running aggregates (mutates `acc`). */
export function aggregateMatch(acc: Map<string, PlayerAggregate>, match: CricsheetMatch): void {
  const { info } = match;
  const people = info.registry.people;
  const date = info.dates[0] ?? "";
  const get = (name: string): PlayerAggregate | undefined => {
    const id = people[name];
    if (id === undefined) return undefined;
    let agg = acc.get(id);
    if (agg === undefined) {
      agg = blank(id, name, date);
      acc.set(id, agg);
    }
    return agg;
  };

  for (const [team, names] of Object.entries(info.players)) {
    for (const name of names) {
      const agg = get(name);
      if (agg === undefined) continue;
      agg.matches += 1;
      agg.teams[team] = (agg.teams[team] ?? 0) + 1;
      if (date < agg.firstMatch) agg.firstMatch = date;
      if (date > agg.lastMatch) agg.lastMatch = date;
    }
  }

  for (const inning of match.innings) {
    const batted = new Set<string>();
    const scores = new Map<string, number>();
    const spells = new Map<string, { wickets: number; runs: number }>();
    for (const over of inning.overs ?? []) {
      for (const d of over.deliveries) {
        const wides = d.extras?.wides ?? 0;
        const noballs = d.extras?.noballs ?? 0;
        const byes = (d.extras?.byes ?? 0) + (d.extras?.legbyes ?? 0);
        const penalty = d.extras?.penalty ?? 0;

        const batter = get(d.batter);
        if (batter !== undefined) {
          if (!batted.has(d.batter)) {
            batted.add(d.batter);
            batter.innings += 1;
          }
          batter.runs += d.runs.batter;
          scores.set(d.batter, (scores.get(d.batter) ?? 0) + d.runs.batter);
          // A wide is not a ball faced; a no-ball is.
          if (wides === 0) batter.ballsFaced += 1;
        }
        const bowler = get(d.bowler);
        let spell: { wickets: number; runs: number } | undefined;
        if (bowler !== undefined) {
          if (wides === 0 && noballs === 0) bowler.ballsBowled += 1;
          const conceded = d.runs.total - byes - penalty;
          bowler.runsConceded += conceded;
          spell = spells.get(d.bowler) ?? { wickets: 0, runs: 0 };
          spell.runs += conceded;
          spells.set(d.bowler, spell);
        }

        for (const w of d.wickets ?? []) {
          const out = get(w.player_out);
          if (out !== undefined) {
            if (!batted.has(w.player_out)) {
              // Non-striker run out before facing still counts as an innings.
              batted.add(w.player_out);
              out.innings += 1;
            }
            if (!NOT_A_DISMISSAL.has(w.kind)) out.dismissals += 1;
          }
          if (bowler !== undefined && BOWLER_WICKETS.has(w.kind)) {
            bowler.wickets += 1;
            if (spell !== undefined) spell.wickets += 1;
          }
          if (w.kind === "caught and bowled" && bowler !== undefined) bowler.catches += 1;
          if (w.kind === "caught" || w.kind === "stumped") {
            for (const f of w.fielders ?? []) {
              if (f.substitute === true || f.name === undefined) continue;
              const fielder = get(f.name);
              if (fielder === undefined) continue;
              if (w.kind === "caught") fielder.catches += 1;
              else fielder.stumpings += 1;
            }
          }
        }
      }
    }
    for (const [name, score] of scores) {
      const agg = get(name);
      if (agg !== undefined && score > agg.highest) agg.highest = score;
    }
    for (const [name, spell] of spells) {
      const agg = get(name);
      if (agg === undefined) continue;
      const better =
        agg.spells === 0 ||
        spell.wickets > agg.bestWickets ||
        (spell.wickets === agg.bestWickets && spell.runs < agg.bestRuns);
      agg.spells += 1;
      if (better) {
        agg.bestWickets = spell.wickets;
        agg.bestRuns = spell.runs;
      }
    }
  }
}

/** Aggregate every `*.json` match file in a directory that passes the filter. */
export function aggregateDirectory(
  dir: string,
  filter: MatchFilter,
): { players: Map<string, PlayerAggregate>; matches: number; lastMatch: string } {
  const players = new Map<string, PlayerAggregate>();
  let matches = 0;
  let lastMatch = "";
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const match = JSON.parse(readFileSync(join(dir, file), "utf8")) as CricsheetMatch;
    if (!matchesFilter(match, filter)) continue;
    aggregateMatch(players, match);
    matches += 1;
    const date = match.info.dates[0] ?? "";
    if (date > lastMatch) lastMatch = date;
  }
  return { players, matches, lastMatch };
}
