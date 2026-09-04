/**
 * Squad Draft rules — the edge-case table in docs/games/squad-draft.md, one
 * test per ruling, plus the scoring model's arithmetic.
 */
import { describe, expect, it } from "vitest";
import { CommandRejectedError, type CardDefinition, type StatDefinition } from "../../types.js";
import { InvalidConfigError } from "../../setup.js";
import { applySquadDraft, autoRoster, legalPicks, rosterProblem } from "./apply.js";
import { squadDraftBot } from "./bot.js";
import { nextPickIndex, onTheClock, reduceSquadDraft } from "./reducer.js";
import {
  BAT_WEIGHT,
  BOWL_WEIGHT,
  KEEPER_BONUS,
  facetScore,
  overall,
  playLeague,
  playMatch,
  rollForm,
} from "./scoring.js";
import { initSquadDraft, snakeOrder, squadDraftPoolSize } from "./setup.js";
import type { Roster, SquadDraftEvent, SquadDraftState } from "./types.js";

const stats: StatDefinition[] = [
  { key: "battingAvg", direction: "higher", min: 0, max: 50 },
  { key: "strikeRate", direction: "higher", min: 0, max: 200 },
  { key: "wickets", direction: "higher", min: 0, max: 100 },
  { key: "economy", direction: "lower", min: 0, max: 15 },
  { key: "catches", direction: "higher", min: 0, max: 100 },
];

const ROLES = ["batter", "bowler", "all-rounder", "keeper"] as const;
const NATIONS = ["India", "Australia", "England", "Pakistan", "New Zealand", "Nepal"];

/** A deterministic pool with all four roles and a spread of nations. */
function pool(n: number, salt = 0): CardDefinition[] {
  return Array.from({ length: n }, (_, i) => {
    const base = i * 37 + salt * 11;
    return {
      id: `c${i}`,
      role: ROLES[i % ROLES.length],
      nation: NATIONS[(i + salt) % NATIONS.length],
      stats: {
        battingAvg: base % 51,
        strikeRate: (base * 3) % 201,
        wickets: (base * 7) % 101,
        economy: 4 + ((base * 5) % 110) / 10,
        catches: (base * 11) % 101,
      },
    } satisfies CardDefinition;
  });
}

function start(players = ["a", "b"], cards = pool(squadDraftPoolSize(players.length)), seed = 1) {
  const started = initSquadDraft({ players, cards, stats, seed });
  return { started, state: reduceSquadDraft(undefined, started) };
}

function fold(state: SquadDraftState, events: SquadDraftEvent[]): SquadDraftState {
  return events.reduce(reduceSquadDraft, state as SquadDraftState | undefined) as SquadDraftState;
}

/** Drive the draft to completion with the bot. */
function draftOut(state: SquadDraftState): SquadDraftState {
  let s = state;
  while (s.phase === "drafting") {
    const picker = onTheClock(s) as string;
    const move = squadDraftBot(s, picker);
    if (move === null) throw new Error("bot stuck");
    s = fold(s, applySquadDraft(s, move));
  }
  return s;
}

describe("setup", () => {
  it("shuffles the pool with the seed and lays out a snake", () => {
    const { started } = start();
    if (started.type !== "GAME_STARTED") throw new Error("not started");
    expect(started.pool).toHaveLength(31);
    expect(new Set(started.pool).size).toBe(31);
    expect(started.pickOrder).toEqual(snakeOrder(["a", "b"], 13));
    expect(started.pickOrder.slice(0, 4)).toEqual(["a", "b", "b", "a"]);
    expect(started).toEqual(start().started);
    expect(start(undefined, undefined, 2).started).not.toEqual(started);
  });

  it("refuses bad configs", () => {
    expect(() => initSquadDraft({ players: ["a"], cards: pool(40), stats, seed: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(() =>
      initSquadDraft({ players: ["a", "b", "c", "d", "e"], cards: pool(80), stats, seed: 1 }),
    ).toThrow(InvalidConfigError);
    expect(() => initSquadDraft({ players: ["a", "b"], cards: pool(30), stats, seed: 1 })).toThrow(
      /need at least 31 cards/,
    );
  });

  it("drops facet keys the edition does not define", () => {
    const { state } = start();
    expect(state.config.facets).toEqual({
      batting: ["battingAvg", "strikeRate"],
      bowling: ["wickets", "economy"],
      fielding: ["catches"],
    });
  });
});

describe("drafting", () => {
  it("only the player on the clock may pick, and only from the pool", () => {
    const { state } = start();
    expect(onTheClock(state)).toBe("a");
    const card = state.pool[0] as string;
    expect(() =>
      applySquadDraft(state, { type: "DRAFT_PICK", playerId: "b", cardId: card }),
    ).toThrow(/not-on-the-clock/);
    expect(() =>
      applySquadDraft(state, { type: "DRAFT_PICK", playerId: "a", cardId: "nope" }),
    ).toThrow(/card-not-in-pool/);
    const events = applySquadDraft(state, { type: "DRAFT_PICK", playerId: "a", cardId: card });
    expect(events).toEqual([
      { type: "CARD_DRAFTED", playerId: "a", cardId: card, pick: 1, auto: false },
    ]);
    const next = fold(state, events);
    expect(next.squads["a"]).toEqual([card]);
    expect(next.pool).not.toContain(card);
    expect(onTheClock(next)).toBe("b");
    // Picking twice in a row: b, then b again (snake), then a.
    const b1 = fold(next, applySquadDraft(next, { type: "AUTO_PLAY", playerId: "b" }));
    expect(onTheClock(b1)).toBe("b");
    const b2 = fold(b1, applySquadDraft(b1, { type: "AUTO_PLAY", playerId: "b" }));
    expect(onTheClock(b2)).toBe("a");
  });

  it("enforces the nation cap at draft time (edge cases 2 & 3)", () => {
    // Every card Indian: the cap must be waived once nothing is legal.
    const cards = pool(31).map((c) => ({ ...c, nation: "India" }));
    let { state } = start(["a", "b"], cards);
    for (let i = 0; i < 4; i++) {
      state = fold(state, applySquadDraft(state, { type: "AUTO_PLAY", playerId: "a" }));
      if (onTheClock(state) === "b")
        state = fold(state, applySquadDraft(state, { type: "AUTO_PLAY", playerId: "b" }));
      if (onTheClock(state) === "b")
        state = fold(state, applySquadDraft(state, { type: "AUTO_PLAY", playerId: "b" }));
    }
    expect(state.squads["a"]).toHaveLength(4);
    // Cap reached, but with nothing else in the pool the whole pool is legal.
    expect(legalPicks(state, "a")).toEqual(state.pool);

    // Mixed pool: a fifth Indian is refused while other nations remain.
    const mixed = pool(31).map((c, i) => ({ ...c, nation: i < 6 ? "India" : "England" }));
    const m = start(["a", "b"], mixed).state;
    const indian = m.pool.filter((id) => mixed.find((c) => c.id === id)?.nation === "India");
    const stacked: SquadDraftState = {
      ...m,
      squads: { a: indian.slice(0, 4), b: [] },
      pool: m.pool.filter((id) => !indian.slice(0, 4).includes(id)),
    };
    const fifth = indian[4] as string;
    expect(legalPicks(stacked, "a")).not.toContain(fifth);
    expect(() =>
      applySquadDraft(stacked, { type: "DRAFT_PICK", playerId: "a", cardId: fifth }),
    ).toThrow(/nation-cap/);
  });

  it("auto-play takes the strongest legal card and the draft completes into building", () => {
    const { state } = start();
    const events = applySquadDraft(state, { type: "AUTO_PLAY", playerId: "a" });
    const first = events[0];
    if (first?.type !== "CARD_DRAFTED") throw new Error("expected a pick");
    expect(first.auto).toBe(true);
    const bestScore = Math.max(
      ...state.pool.map((id) =>
        overall(state.config.cards.find((c) => c.id === id) as CardDefinition, state.config),
      ),
    );
    expect(
      overall(
        state.config.cards.find((c) => c.id === first.cardId) as CardDefinition,
        state.config,
      ),
    ).toBe(bestScore);

    const done = draftOut(state);
    expect(done.phase).toBe("building");
    expect(done.squads["a"]).toHaveLength(13);
    expect(done.squads["b"]).toHaveLength(13);
    expect(done.pool).toHaveLength(5);
    expect(nextPickIndex(done)).toBeNull();
  });

  it("skips a forfeited seat's picks (edge case 5)", () => {
    const { state } = start(["a", "b", "c"], pool(squadDraftPoolSize(3)));
    const one = fold(state, applySquadDraft(state, { type: "AUTO_PLAY", playerId: "a" }));
    expect(onTheClock(one)).toBe("b");
    const gone = fold(one, applySquadDraft(one, { type: "FORFEIT", playerId: "b" }));
    expect(gone.phase).toBe("drafting");
    expect(onTheClock(gone)).toBe("c");
    const done = draftOut(gone);
    expect(done.squads["b"]).toHaveLength(0);
    expect(done.squads["a"]).toHaveLength(13);
    expect(done.squads["c"]).toHaveLength(13);
  });
});

describe("building", () => {
  function built(): SquadDraftState {
    return draftOut(start().state);
  }

  it("validates the XI shape against the squad", () => {
    const state = built();
    const squad = state.squads["a"] as string[];
    const good = autoRoster(state, "a");
    expect(rosterProblem(state, "a", good)).toBeNull();
    expect(rosterProblem(state, "a", { ...good, order: good.order.slice(0, 10) })).toMatch(
      /11 cards/,
    );
    expect(
      rosterProblem(state, "a", {
        ...good,
        order: [...good.order.slice(0, 10), good.order[0] as string],
      }),
    ).toMatch(/twice/);
    const foreign = state.squads["b"]?.[0] as string;
    expect(
      rosterProblem(state, "a", { ...good, order: [...good.order.slice(0, 10), foreign] }),
    ).toMatch(/not in your squad/);
    expect(rosterProblem(state, "a", { ...good, bowlers: good.bowlers.slice(0, 4) })).toMatch(
      /5 bowlers/,
    );
    const benched = squad.find((id) => !good.order.includes(id)) as string;
    expect(
      rosterProblem(state, "a", { ...good, bowlers: [...good.bowlers.slice(0, 4), benched] }),
    ).toMatch(/not in the XI/);
    expect(rosterProblem(state, "a", { ...good, keeper: benched })).toMatch(/keeper/);
    expect(() =>
      applySquadDraft(state, {
        type: "SUBMIT_XI",
        playerId: "a",
        roster: { ...good, keeper: benched },
      }),
    ).toThrow(CommandRejectedError);
  });

  it("refuses picks and double submissions while building", () => {
    const state = built();
    expect(() =>
      applySquadDraft(state, {
        type: "DRAFT_PICK",
        playerId: "a",
        cardId: state.pool[0] as string,
      }),
    ).toThrow(/not-on-the-clock/);
    const once = fold(
      state,
      applySquadDraft(state, { type: "SUBMIT_XI", playerId: "a", roster: autoRoster(state, "a") }),
    );
    expect(() =>
      applySquadDraft(once, { type: "SUBMIT_XI", playerId: "a", roster: autoRoster(once, "a") }),
    ).toThrow(/already-submitted/);
    expect(() =>
      applySquadDraft(start().state, {
        type: "SUBMIT_XI",
        playerId: "a",
        roster: autoRoster(state, "a"),
      }),
    ).toThrow(/not-building/);
  });

  it("the last XI in plays the league and ends the game with one winner", () => {
    const state = built();
    const a = fold(
      state,
      applySquadDraft(state, { type: "SUBMIT_XI", playerId: "a", roster: autoRoster(state, "a") }),
    );
    expect(a.phase).toBe("building");
    const events = applySquadDraft(a, { type: "AUTO_PLAY", playerId: "b" });
    expect(events.map((e) => e.type)).toEqual(["XI_SUBMITTED", "MATCHES_PLAYED", "GAME_ENDED"]);
    const done = fold(a, events);
    expect(done.phase).toBe("finished");
    expect(done.league?.matches).toHaveLength(1);
    expect(done.winner).toBe(done.league?.table[0]?.playerId);
    // A forfeit-free two-side game: the table has exactly one row per side.
    expect(done.league?.table.map((r) => r.playerId).sort()).toEqual(["a", "b"]);
  });

  it("a forfeit while building settles among those left (edge case 6)", () => {
    const state = draftOut(start(["a", "b", "c"], pool(squadDraftPoolSize(3))).state);
    const a = fold(
      state,
      applySquadDraft(state, { type: "SUBMIT_XI", playerId: "a", roster: autoRoster(state, "a") }),
    );
    const b = fold(
      a,
      applySquadDraft(a, { type: "SUBMIT_XI", playerId: "b", roster: autoRoster(a, "b") }),
    );
    const events = applySquadDraft(b, { type: "FORFEIT", playerId: "c" });
    expect(events.map((e) => e.type)).toEqual(["PLAYER_FORFEITED", "MATCHES_PLAYED", "GAME_ENDED"]);
    const done = fold(b, events);
    expect(done.league?.table.map((r) => r.playerId).sort()).toEqual(["a", "b"]);
  });

  it("everyone else leaving wins the game outright (edge case 7)", () => {
    const { state } = start();
    const events = applySquadDraft(state, { type: "FORFEIT", playerId: "b" });
    expect(events).toEqual([
      { type: "PLAYER_FORFEITED", playerId: "b" },
      { type: "GAME_ENDED", winner: "a", reason: "opponents-forfeited" },
    ]);
  });
});

describe("scoring", () => {
  const { state } = start();
  const { config } = state;

  it("facets are the mean of normalised stats on 0–100", () => {
    const card: CardDefinition = {
      id: "x",
      role: "batter",
      stats: { battingAvg: 25, strikeRate: 200, wickets: 0, economy: 15, catches: 50 },
    };
    expect(facetScore(card, "batting", config)).toBe(75);
    expect(facetScore(card, "bowling", config)).toBe(0);
    expect(facetScore(card, "fielding", config)).toBe(50);
    expect(facetScore({ id: "y", stats: {} }, "batting", config)).toBe(0);
  });

  it("roles weight what a card is asked to do", () => {
    expect(BAT_WEIGHT["bowler"]).toBeLessThan(1);
    expect(BOWL_WEIGHT["keeper"]).toBeLessThan(BOWL_WEIGHT["batter"] as number);
    expect(BOWL_WEIGHT["all-rounder"]).toBe(1);
  });

  it("a real keeper is worth the gloves bonus, an impostor costs it", () => {
    const built = draftOut(state);
    const ra = autoRoster(built, "a");
    const rb = autoRoster(built, "b");
    const keeperIn = playMatch(
      config,
      { playerId: "a", roster: ra },
      { playerId: "b", roster: rb },
      {},
    );
    const impostor: Roster = {
      ...ra,
      keeper: ra.order.find(
        (id) => config.cards.find((c) => c.id === id)?.role !== "keeper",
      ) as string,
    };
    const keeperOut = playMatch(
      config,
      { playerId: "a", roster: impostor },
      { playerId: "b", roster: rb },
      {},
    );
    const finishIn = keeperIn.phases[2]?.home as number;
    const finishOut = keeperOut.phases[2]?.home as number;
    expect(finishIn - finishOut).toBeCloseTo(2 * KEEPER_BONUS, 1);
  });

  it("form is rolled from the seed alone and stays within 0.9–1.1", () => {
    const built = draftOut(state);
    const rosters = { a: autoRoster(built, "a"), b: autoRoster(built, "b") };
    const form = rollForm(config, rosters);
    expect(Object.keys(form)).toHaveLength(22);
    for (const f of Object.values(form)) {
      expect(f).toBeGreaterThanOrEqual(0.9);
      expect(f).toBeLessThanOrEqual(1.1);
    }
    expect(rollForm(config, rosters)).toEqual(form);
    expect(rollForm({ ...config, seed: 99 }, rosters)).not.toEqual(form);
  });

  it("the league awards two for a win, one for a draw, and orders the table", () => {
    const built = draftOut(start(["a", "b", "c"], pool(squadDraftPoolSize(3))).state);
    const rosters = {
      a: autoRoster(built, "a"),
      b: autoRoster(built, "b"),
      c: autoRoster(built, "c"),
    };
    const league = playLeague(built.config, rosters, {});
    expect(league.matches).toHaveLength(3);
    const points = league.table.reduce((sum, r) => sum + r.points, 0);
    expect(points).toBe(6);
    for (let i = 1; i < league.table.length; i++) {
      const prev = league.table[i - 1] as (typeof league.table)[number];
      const row = league.table[i] as (typeof league.table)[number];
      expect(
        prev.points > row.points || (prev.points === row.points && prev.margin >= row.margin),
      ).toBe(true);
    }
    const margins = league.table.reduce((sum, r) => sum + r.margin, 0);
    expect(Math.abs(margins)).toBeLessThan(0.5);
  });

  it("a mirror match is a draw", () => {
    const built = draftOut(state);
    const r = autoRoster(built, "a");
    const match = playMatch(config, { playerId: "a", roster: r }, { playerId: "b", roster: r }, {});
    expect(match.result).toBe("draw");
    expect(match.margin).toBe(0);
  });
});
