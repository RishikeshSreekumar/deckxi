import { describe, expect, it } from "vitest";
import { reduce, reduceAll } from "./reducer.js";
import type { GameConfig, GameEvent, GameState } from "./types.js";

const config: GameConfig = {
  players: ["a", "b", "c"],
  cards: [],
  stats: [{ key: "runs", direction: "higher", min: 0, max: 100 }],
  seed: 42,
  maxRounds: 1000,
};

const started: GameEvent = {
  type: "GAME_STARTED",
  config,
  firstLeader: "a",
  hands: { a: ["c1", "c2"], b: ["c3", "c4"], c: ["c5", "c6"] },
};

function start(): GameState {
  return reduce(undefined, started);
}

describe("reduce", () => {
  it("GAME_STARTED builds the initial state", () => {
    const state = start();
    expect(state.phase).toBe("selecting");
    expect(state.round).toBe(1);
    expect(state.leader).toBe("a");
    expect(state.pot).toEqual([]);
    expect(state.winner).toBeNull();
    expect(state.players.map((p) => p.hand)).toEqual([
      ["c1", "c2"],
      ["c3", "c4"],
      ["c5", "c6"],
    ]);
    expect(state.players.every((p) => p.active)).toBe(true);
  });

  it("rejects events before GAME_STARTED", () => {
    expect(() =>
      reduce(undefined, { type: "STAT_SELECTED", playerId: "a", stat: "runs", auto: false }),
    ).toThrow(/before GAME_STARTED/);
  });

  it("ROUND_RESOLVED (won): winner takes pot + revealed to hand bottom, leads next", () => {
    const state = { ...start(), pot: ["p1"] };
    const next = reduce(state, {
      type: "ROUND_RESOLVED",
      round: 1,
      stat: "runs",
      revealed: [
        { playerId: "a", cardId: "c1", value: 50 },
        { playerId: "b", cardId: "c3", value: 90 },
        { playerId: "c", cardId: "c5", value: 10 },
      ],
      result: { kind: "won", winner: "b" },
    });
    expect(next.round).toBe(2);
    expect(next.leader).toBe("b");
    expect(next.pot).toEqual([]);
    // pot first (oldest first), then revealed in seat order from the leader
    expect(next.players[1]?.hand).toEqual(["c4", "p1", "c1", "c3", "c5"]);
    expect(next.players[0]?.hand).toEqual(["c2"]);
    expect(next.players[2]?.hand).toEqual(["c6"]);
  });

  it("ROUND_RESOLVED (tie): all revealed cards join the pot, leader unchanged", () => {
    const next = reduce(start(), {
      type: "ROUND_RESOLVED",
      round: 1,
      stat: "runs",
      revealed: [
        { playerId: "a", cardId: "c1", value: 50 },
        { playerId: "b", cardId: "c3", value: 50 },
        { playerId: "c", cardId: "c5", value: 10 },
      ],
      result: { kind: "tie", tiedPlayers: ["a", "b"] },
    });
    expect(next.pot).toEqual(["c1", "c3", "c5"]);
    expect(next.leader).toBe("a");
    expect(next.round).toBe(2);
    expect(next.players.map((p) => p.hand)).toEqual([["c2"], ["c4"], ["c6"]]);
  });

  it("throws if a revealed card is not the player's top card", () => {
    expect(() =>
      reduce(start(), {
        type: "ROUND_RESOLVED",
        round: 1,
        stat: "runs",
        revealed: [{ playerId: "a", cardId: "c2", value: 1 }],
        result: { kind: "won", winner: "a" },
      }),
    ).toThrow(/not a's top card/);
  });

  it("PLAYER_ELIMINATED deactivates and passes leadership clockwise", () => {
    const next = reduce(start(), { type: "PLAYER_ELIMINATED", playerId: "a", round: 1 });
    expect(next.players[0]?.active).toBe(false);
    expect(next.leader).toBe("b");
  });

  it("PLAYER_FORFEITED moves the hand to the pot and reassigns the leader", () => {
    const next = reduce(start(), { type: "PLAYER_FORFEITED", playerId: "a" });
    expect(next.players[0]?.active).toBe(false);
    expect(next.players[0]?.hand).toEqual([]);
    expect(next.pot).toEqual(["c1", "c2"]);
    expect(next.leader).toBe("b");
  });

  it("non-leader forfeit leaves the leader alone", () => {
    const next = reduce(start(), { type: "PLAYER_FORFEITED", playerId: "c" });
    expect(next.leader).toBe("a");
    expect(next.pot).toEqual(["c5", "c6"]);
  });

  it("GAME_ENDED finishes the game", () => {
    const next = reduce(start(), { type: "GAME_ENDED", winner: "c", reason: "last-standing" });
    expect(next.phase).toBe("finished");
    expect(next.winner).toBe("c");
  });

  it("reduceAll folds a log", () => {
    const state = reduceAll([
      started,
      { type: "PLAYER_FORFEITED", playerId: "b" },
      { type: "GAME_ENDED", winner: "a", reason: "opponents-forfeited" },
    ]);
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe("a");
  });
});
