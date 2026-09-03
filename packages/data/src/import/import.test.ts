import { describe, expect, it } from "vitest";
import { aggregateMatch, matchesFilter, type CricsheetMatch } from "./cricsheet.js";
import {
  assignRarity,
  deriveStats,
  fitBounds,
  inferRole,
  selectSquads,
  slugify,
} from "./select.js";
import type { PlayerAggregate } from "./cricsheet.js";

/** A two-over match: enough to hit every branch of the fold. */
function match(): CricsheetMatch {
  return {
    info: {
      dates: ["2026-01-01"],
      gender: "male",
      match_type: "T20",
      team_type: "international",
      teams: ["A", "B"],
      players: { A: ["Bat One", "Bat Two", "Keep A"], B: ["Bowl One", "Field B"] },
      registry: {
        people: {
          "Bat One": "p1",
          "Bat Two": "p2",
          "Keep A": "k1",
          "Bowl One": "b1",
          "Field B": "f1",
        },
      },
    },
    innings: [
      {
        team: "A",
        overs: [
          {
            over: 0,
            deliveries: [
              {
                batter: "Bat One",
                bowler: "Bowl One",
                non_striker: "Bat Two",
                runs: { batter: 4, extras: 0, total: 4 },
              },
              // Wide: not a ball faced, not a legal ball, runs against the bowler.
              {
                batter: "Bat One",
                bowler: "Bowl One",
                non_striker: "Bat Two",
                runs: { batter: 0, extras: 1, total: 1 },
                extras: { wides: 1 },
              },
              // No-ball: faced, not legal, runs against the bowler.
              {
                batter: "Bat One",
                bowler: "Bowl One",
                non_striker: "Bat Two",
                runs: { batter: 2, extras: 1, total: 3 },
                extras: { noballs: 1 },
              },
              // Leg byes do not count against the bowler.
              {
                batter: "Bat One",
                bowler: "Bowl One",
                non_striker: "Bat Two",
                runs: { batter: 0, extras: 2, total: 2 },
                extras: { legbyes: 2 },
              },
              {
                batter: "Bat One",
                bowler: "Bowl One",
                non_striker: "Bat Two",
                runs: { batter: 0, extras: 0, total: 0 },
                wickets: [
                  { kind: "caught", player_out: "Bat One", fielders: [{ name: "Field B" }] },
                ],
              },
              // Run out of the non-striker who never faced: an innings, not a bowler's wicket.
              {
                batter: "Bat Two",
                bowler: "Bowl One",
                non_striker: "Keep A",
                runs: { batter: 1, extras: 0, total: 1 },
                wickets: [
                  { kind: "run out", player_out: "Keep A", fielders: [{ name: "Field B" }] },
                ],
              },
            ],
          },
        ],
      },
      {
        team: "B",
        overs: [
          {
            over: 0,
            deliveries: [
              {
                batter: "Field B",
                bowler: "Bat Two",
                non_striker: "Bowl One",
                runs: { batter: 0, extras: 0, total: 0 },
                wickets: [
                  { kind: "stumped", player_out: "Field B", fielders: [{ name: "Keep A" }] },
                ],
              },
              {
                batter: "Bowl One",
                bowler: "Bat Two",
                non_striker: "Field B",
                runs: { batter: 0, extras: 0, total: 0 },
                wickets: [
                  {
                    kind: "caught",
                    player_out: "Bowl One",
                    fielders: [{ name: "Sub", substitute: true }],
                  },
                ],
              },
              {
                batter: "Bowl One",
                bowler: "Bat Two",
                non_striker: "Field B",
                runs: { batter: 6, extras: 0, total: 6 },
                wickets: [{ kind: "retired hurt", player_out: "Bowl One" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("aggregateMatch", () => {
  const acc = new Map<string, PlayerAggregate>();
  aggregateMatch(acc, match());
  const get = (id: string) => acc.get(id) as PlayerAggregate;

  it("credits batting: runs, balls faced (no wides), dismissals", () => {
    const p1 = get("p1");
    expect(p1.runs).toBe(6);
    expect(p1.ballsFaced).toBe(4); // the wide is not faced
    expect(p1.dismissals).toBe(1);
    expect(p1.innings).toBe(1);
    expect(p1.matches).toBe(1);
    expect(p1.teams).toEqual({ A: 1 });
    expect(p1.highest).toBe(6);
  });

  it("keeps the best innings with bat and ball", () => {
    expect(get("p2").highest).toBe(1);
    // b1's one spell: 1 wicket for 9; p2's: 2 wickets for 6.
    expect(get("b1").spells).toBe(1);
    expect([get("b1").bestWickets, get("b1").bestRuns]).toEqual([1, 9]);
    expect([get("p2").bestWickets, get("p2").bestRuns]).toEqual([2, 6]);
    expect(get("p1").spells).toBe(0);
  });

  it("credits bowling: legal balls, runs conceded without byes, wickets by kind", () => {
    const b1 = get("b1");
    expect(b1.ballsBowled).toBe(4);
    expect(b1.runsConceded).toBe(4 + 1 + 3 + 0 + 0 + 1);
    expect(b1.wickets).toBe(1); // the catch, not the run out
    // Retired hurt is neither a dismissal nor a wicket.
    expect(b1.dismissals).toBe(1); // the substitute catch still dismisses him
    expect(get("p2").wickets).toBe(2);
  });

  it("credits fielding: catches (not substitutes), stumpings", () => {
    expect(get("f1").catches).toBe(1);
    expect(get("k1").stumpings).toBe(1);
    expect(get("k1").innings).toBe(1); // run out without facing
    expect([...acc.keys()]).not.toContain("Sub");
  });

  it("filters by gender / type", () => {
    expect(matchesFilter(match(), { gender: "male", matchType: "T20" })).toBe(true);
    expect(matchesFilter(match(), { gender: "female" })).toBe(false);
    expect(matchesFilter(match(), { teamType: "club" })).toBe(false);
  });
});

function agg(over: Partial<PlayerAggregate>): PlayerAggregate {
  return {
    id: "x",
    name: "X",
    teams: { India: 10 },
    matches: 50,
    firstMatch: "2020-01-01",
    lastMatch: "2026-01-01",
    innings: 40,
    runs: 1000,
    ballsFaced: 800,
    dismissals: 30,
    ballsBowled: 0,
    runsConceded: 0,
    wickets: 0,
    catches: 20,
    stumpings: 0,
    highest: 0,
    spells: 0,
    bestWickets: 0,
    bestRuns: 0,
    ...over,
  };
}

describe("deriveStats / inferRole", () => {
  it("derives the eight card stats, with worst-case bowling for non-bowlers", () => {
    expect(deriveStats(agg({}))).toEqual({
      battingAvg: 33.3,
      strikeRate: 125,
      runs: 1000,
      highest: 0,
      wickets: 0,
      economy: 12,
      catches: 20,
      bestBowling: 0,
    });
    // 3/17 packs above 2/5, and any spell beats never having bowled.
    expect(deriveStats(agg({ spells: 4, bestWickets: 3, bestRuns: 17 })).bestBowling).toBe(382);
    expect(deriveStats(agg({ ballsBowled: 600, runsConceded: 700 })).economy).toBe(7);
    expect(deriveStats(agg({ dismissals: 0 })).battingAvg).toBe(1000);
  });

  it("reads the role off the career shape", () => {
    expect(inferRole(agg({}))).toBe("batter");
    expect(inferRole(agg({ stumpings: 5, catches: 30 }))).toBe("keeper");
    expect(inferRole(agg({ ballsBowled: 1000, runs: 100 }))).toBe("bowler");
    expect(inferRole(agg({ ballsBowled: 1000, runs: 900 }))).toBe("all-rounder");
    expect(inferRole(agg({ ballsBowled: 400, runs: 900 }))).toBe("all-rounder");
  });
});

describe("selectSquads", () => {
  const teams = [{ id: "india", name: "India", shortName: "IND", color: "#000000" }];
  const pool = [
    agg({ id: "bat-a", runs: 3000 }),
    agg({ id: "bat-b", runs: 2000 }),
    agg({ id: "keep", stumpings: 9, catches: 40, runs: 500 }),
    agg({ id: "bowl", ballsBowled: 1200, wickets: 80, runs: 50 }),
    agg({ id: "few", runs: 9999, matches: 3 }),
    agg({ id: "elsewhere", teams: { Nepal: 40 }, runs: 5000 }),
  ];
  const picked = selectSquads(pool, {
    teams,
    minMatches: 15,
    squad: { batter: 1, keeper: 1, "all-rounder": 1, bowler: 1 },
    roleOverrides: { "bat-b": "all-rounder" },
    tiers: { legend: 0.25, star: 0.25 },
  });

  it("fills each role, honours overrides and thresholds, ignores other nations", () => {
    expect(picked.map((p) => `${p.agg.id}:${p.role}`)).toEqual([
      "bat-a:batter",
      "keep:keeper",
      "bat-b:all-rounder",
      "bowl:bowler",
    ]);
  });

  it("passes over deprioritized players unless the squad would come up short", () => {
    const withFaces = selectSquads(pool, {
      teams,
      minMatches: 15,
      squad: { batter: 1, keeper: 1, "all-rounder": 1, bowler: 1 },
      roleOverrides: { "bat-b": "all-rounder" },
      tiers: { legend: 0.25, star: 0.25 },
      deprioritized: new Set(["bat-a", "bowl"]),
    });
    // bat-a loses the batter seat to nobody (bat-b is the all-rounder), so
    // the batter seat is filled from the deprioritized pass; the bowler seat
    // likewise — but only after every preferred player has had a look.
    expect(withFaces.map((p) => `${p.agg.id}:${p.role}`)).toEqual([
      "keep:keeper",
      "bat-b:all-rounder",
      "bat-a:batter",
      "bowl:bowler",
    ]);
    expect(withFaces).toHaveLength(4);
  });

  it("back-fills a short role from the best of the rest", () => {
    const short = selectSquads(pool, {
      teams,
      minMatches: 15,
      squad: { batter: 1, keeper: 2, "all-rounder": 0, bowler: 1 },
      roleOverrides: {},
      tiers: { legend: 0.25, star: 0.25 },
    });
    expect(short).toHaveLength(4);
    expect(short.map((p) => p.agg.id)).toContain("bat-b");
  });
});

describe("fitBounds / assignRarity / slugify", () => {
  it("rounds bounds outwards to a nice step", () => {
    const [runs, econ] = fitBounds(
      [
        { key: "runs", name: "Runs", direction: "higher", format: "integer", min: 0, max: 1 },
        { key: "economy", name: "Econ", direction: "lower", format: "decimal", min: 0, max: 1 },
      ],
      [{ stats: { runs: 4545, economy: 6.6 } }, { stats: { runs: 10, economy: 13.5 } }],
    );
    expect([runs?.min, runs?.max]).toEqual([0, 5000]);
    expect([econ?.min, econ?.max]).toEqual([6, 14]);
  });

  it("tiers by rating rank, ties broken by id", () => {
    const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, rating: 80 - i * 5 }));
    const tiered = assignRarity(players, { legend: 0.125, star: 0.25 });
    expect(tiered.map((p) => p.rarity)).toEqual([
      "legend",
      "star",
      "star",
      "regular",
      "regular",
      "regular",
      "regular",
      "regular",
    ]);
  });

  it("slugifies names with accents and apostrophes", () => {
    expect(slugify("Kevin O'Brien")).toBe("kevin-o-brien");
    expect(slugify("Roelof van der Merwe")).toBe("roelof-van-der-merwe");
    expect(slugify("Ángel  Núñez")).toBe("angel-nunez");
  });
});
