import { describe, expect, it } from "vitest";
import { mulberry32, randomInt, shuffle } from "./rng.js";
import { initGame, InvalidConfigError } from "./setup.js";
import { reduce } from "./reducer.js";
import { replay, replayUntil } from "./replay.js";
import type { CardDefinition, GameConfigInput, GameEvent } from "./types.js";

function cards(n: number): CardDefinition[] {
  return Array.from({ length: n }, (_, i) => ({ id: `card-${i}`, stats: { runs: i } }));
}

function config(overrides: Partial<GameConfigInput> = {}): GameConfigInput {
  return {
    players: ["a", "b", "c"],
    cards: cards(12),
    stats: [{ key: "runs", direction: "higher", min: 0, max: 100 }],
    seed: 123,
    ...overrides,
  };
}

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("yields values in [0, 1) and ints in range", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = randomInt(rng, 6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });

  it("shuffle is a permutation and leaves the input untouched", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(mulberry32(9), input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(out).not.toEqual(input); // vanishingly unlikely for this seed
  });
});

describe("initGame", () => {
  it("is fully deterministic for a given seed", () => {
    expect(initGame(config())).toEqual(initGame(config()));
    expect(initGame(config())).not.toEqual(initGame(config({ seed: 999 })));
  });

  it("deals every card exactly once, round-robin from seat 0", () => {
    const event = initGame(config());
    if (event.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    const dealt = Object.values(event.hands).flat();
    expect(dealt).toHaveLength(12);
    expect(new Set(dealt).size).toBe(12);
    expect(event.hands["a"]).toHaveLength(4);
    expect(event.hands["b"]).toHaveLength(4);
    expect(event.hands["c"]).toHaveLength(4);
  });

  it("gives earlier seats the extra card on uneven decks", () => {
    const event = initGame(config({ cards: cards(13) }));
    if (event.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    expect(event.hands["a"]).toHaveLength(5);
    expect(event.hands["b"]).toHaveLength(4);
    expect(event.hands["c"]).toHaveLength(4);
  });

  it("picks the first leader from the players", () => {
    const event = initGame(config());
    if (event.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    expect(["a", "b", "c"]).toContain(event.firstLeader);
  });

  it("defaults maxRounds to 1000", () => {
    const event = initGame(config());
    if (event.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    expect(event.config.maxRounds).toBe(1000);
  });

  it("rejects invalid configs", () => {
    expect(() => initGame(config({ players: ["a"] }))).toThrow(InvalidConfigError);
    expect(() => initGame(config({ players: ["a", "b", "c", "d", "e", "f", "g"] }))).toThrow(
      /player count/,
    );
    expect(() => initGame(config({ players: ["a", "a", "b"] }))).toThrow(/duplicate player/);
    expect(() => initGame(config({ cards: cards(2) }))).toThrow(/at least one card per player/);
    expect(() => initGame(config({ stats: [] }))).toThrow(/at least one stat/);
    expect(() =>
      initGame(config({ stats: [{ key: "x", direction: "higher", min: 5, max: 1 }] })),
    ).toThrow(/invalid bounds/);
    expect(() => initGame(config({ maxRounds: 0 }))).toThrow(/maxRounds/);
  });
});

describe("replay", () => {
  it("rebuilds the same state as live reduction", () => {
    const log: GameEvent[] = [
      initGame(config()),
      { type: "PLAYER_FORFEITED", playerId: "b" },
      { type: "GAME_ENDED", winner: "a", reason: "opponents-forfeited" },
    ];
    let live = undefined as ReturnType<typeof replay> | undefined;
    for (const e of log) live = reduce(live, e);
    expect(replay(log)).toEqual(live);
  });

  it("replayUntil stops mid-log", () => {
    const log: GameEvent[] = [initGame(config()), { type: "PLAYER_FORFEITED", playerId: "b" }];
    expect(replayUntil(log, 1).players[1]?.active).toBe(true);
    expect(replayUntil(log, 2).players[1]?.active).toBe(false);
  });

  it("rejects logs not starting with GAME_STARTED", () => {
    expect(() => replay([{ type: "PLAYER_FORFEITED", playerId: "a" }])).toThrow(/GAME_STARTED/);
    expect(() => replay([])).toThrow(/empty/);
  });
});
