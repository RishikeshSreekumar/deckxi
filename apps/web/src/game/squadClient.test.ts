import { describe, expect, it } from "vitest";
import type { SquadDraftConfigView, SquadDraftWireEvent } from "@deckxi/shared";
import { applySquadEvents, currentPick, legalPicks, onTheClock } from "./squadClient.js";

const config: SquadDraftConfigView = {
  mode: "squad-draft",
  players: ["a", "b"],
  cards: Array.from({ length: 31 }, (_, i) => ({
    id: `c${i}`,
    stats: { runs: i },
    role: i % 4 === 0 ? "keeper" : "batter",
    nation: i < 6 ? "India" : "England",
  })),
  stats: [{ key: "runs", direction: "higher", min: 0, max: 100 }],
  editionId: "edition-test",
  squadSize: 13,
  xiSize: 11,
  bowlerCount: 5,
  nationCap: 4,
  facets: { batting: ["runs"], bowling: [], fielding: [] },
};

const pickOrder = ["a", "b", "b", "a", "a", "b"];
const started: SquadDraftWireEvent = {
  seq: 0,
  type: "GAME_STARTED",
  config,
  pool: config.cards.map((c) => c.id),
  pickOrder,
};

describe("squad draft client fold", () => {
  it("starts with the pool laid out and seat a on the clock", () => {
    const state = applySquadEvents(null, [started], "a");
    if (state === null) throw new Error("no state");
    expect(state.phase).toBe("drafting");
    expect(state.pool).toHaveLength(31);
    expect(onTheClock(state)).toBe("a");
    expect(currentPick(state)).toBe(1);
  });

  it("moves picks from the pool to squads and follows the snake", () => {
    const state = applySquadEvents(
      null,
      [
        started,
        { seq: 1, type: "CARD_DRAFTED", playerId: "a", cardId: "c3", pick: 1, auto: false },
        { seq: 2, type: "CARD_DRAFTED", playerId: "b", cardId: "c9", pick: 2, auto: true },
      ],
      "a",
    );
    if (state === null) throw new Error("no state");
    expect(state.squads).toEqual({ a: ["c3"], b: ["c9"] });
    expect(state.pool).not.toContain("c3");
    expect(onTheClock(state)).toBe("b");
    expect(currentPick(state)).toBe(3);
    expect(state.lastPick).toMatchObject({ playerId: "b", auto: true });
  });

  it("skips a forfeited seat and drops duplicate seqs", () => {
    const state = applySquadEvents(
      null,
      [
        started,
        { seq: 1, type: "CARD_DRAFTED", playerId: "a", cardId: "c3", pick: 1, auto: false },
        { seq: 2, type: "PLAYER_FORFEITED", playerId: "b" },
        { seq: 2, type: "PLAYER_FORFEITED", playerId: "b" },
      ],
      "a",
    );
    if (state === null) throw new Error("no state");
    expect(state.active["b"]).toBe(false);
    expect(onTheClock(state)).toBe("a");
    expect(state.seq).toBe(2);
  });

  it("enforces the nation cap the way the engine does", () => {
    const state = applySquadEvents(
      null,
      [
        started,
        { seq: 1, type: "CARD_DRAFTED", playerId: "a", cardId: "c0", pick: 1, auto: false },
        { seq: 2, type: "CARD_DRAFTED", playerId: "b", cardId: "c9", pick: 2, auto: false },
        { seq: 3, type: "CARD_DRAFTED", playerId: "b", cardId: "c10", pick: 3, auto: false },
        { seq: 4, type: "CARD_DRAFTED", playerId: "a", cardId: "c1", pick: 4, auto: false },
        { seq: 5, type: "CARD_DRAFTED", playerId: "a", cardId: "c2", pick: 5, auto: false },
        { seq: 6, type: "CARD_DRAFTED", playerId: "b", cardId: "c11", pick: 6, auto: false },
      ],
      "a",
    );
    if (state === null) throw new Error("no state");
    // a holds three Indians: a fourth is fine, a fifth would not be.
    const legal = legalPicks(state, "a");
    expect(legal.has("c3")).toBe(true);
    const fourth: SquadClientStateLike = {
      ...state,
      squads: { ...state.squads, a: ["c0", "c1", "c2", "c3"] },
    };
    const capped = legalPicks(fourth, "a");
    expect(capped.has("c4")).toBe(false);
    expect(capped.has("c7")).toBe(true);
  });

  it("keeps your XI, hides theirs, then reveals everything with the league", () => {
    const roster = { order: ["c1"], bowlers: ["c1"], keeper: "c1" };
    const league = {
      matches: [],
      table: [
        { playerId: "b", played: 1, won: 1, drawn: 0, lost: 0, points: 2, margin: 3.5 },
        { playerId: "a", played: 1, won: 0, drawn: 0, lost: 1, points: 0, margin: -3.5 },
      ],
    };
    const state = applySquadEvents(
      null,
      [
        started,
        { seq: 1, type: "DRAFT_COMPLETED" },
        { seq: 2, type: "XI_SUBMITTED", playerId: "a", roster, auto: false },
        { seq: 3, type: "XI_SUBMITTED", playerId: "b", roster: null, auto: true },
        {
          seq: 4,
          type: "MATCHES_PLAYED",
          rosters: { a: roster, b: roster },
          form: { c1: 1 },
          league,
        },
        { seq: 5, type: "GAME_ENDED", winner: "b", reason: "league" },
      ],
      "a",
    );
    if (state === null) throw new Error("no state");
    expect(state.phase).toBe("finished");
    expect(state.submitted).toEqual({ a: true, b: true });
    expect(state.yourRoster).toEqual(roster);
    expect(state.rosters?.["b"]).toEqual(roster);
    expect(state.league?.table[0]?.playerId).toBe("b");
    expect(state.winner).toBe("b");
    expect(state.endReason).toBe("league");
  });
});

type SquadClientStateLike = NonNullable<ReturnType<typeof applySquadEvents>>;
