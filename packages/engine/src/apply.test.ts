import { describe, expect, it } from "vitest";
import { applyCommand } from "./apply.js";
import { reduceAll } from "./reducer.js";
import { chooseBestStat, normalizedValue } from "./stats.js";
import {
  CommandRejectedError,
  type CardDefinition,
  type Command,
  type GameState,
  type StatDefinition,
} from "./types.js";

const stats: StatDefinition[] = [
  { key: "runs", direction: "higher", min: 0, max: 100 },
  { key: "economy", direction: "lower", min: 2, max: 12 },
];

/** Build a state directly with per-player hands: { a: [card, ...], ... } */
function makeState(
  hands: Record<string, CardDefinition[]>,
  opts: { leader?: string; pot?: CardDefinition[]; round?: number; maxRounds?: number } = {},
): GameState {
  const players = Object.keys(hands);
  const potCards = opts.pot ?? [];
  const cards = [...Object.values(hands).flat(), ...potCards];
  return {
    config: { players, cards, stats, seed: 1, maxRounds: opts.maxRounds ?? 1000 },
    phase: "selecting",
    round: opts.round ?? 1,
    leader: opts.leader ?? (players[0] as string),
    players: players.map((id) => ({
      id,
      hand: (hands[id] ?? []).map((c) => c.id),
      active: (hands[id] ?? []).length > 0,
    })),
    pot: potCards.map((c) => c.id),
    winner: null,
  };
}

const card = (id: string, runs: number, economy?: number): CardDefinition => ({
  id,
  stats: economy === undefined ? { runs } : { runs, economy },
});

function play(state: GameState, command: Command): GameState {
  return reduceAll(applyCommand(state, command), state);
}

const select = (playerId: string, stat: string): Command => ({
  type: "SELECT_STAT",
  playerId,
  stat,
});

describe("round resolution", () => {
  it("higher-wins stat: best value takes revealed cards and leads", () => {
    const state = makeState({
      a: [card("a1", 50), card("a2", 10)],
      b: [card("b1", 90), card("b2", 20)],
      c: [card("c1", 30), card("c2", 40)],
    });
    const next = play(state, select("a", "runs"));
    expect(next.leader).toBe("b");
    expect(next.players[1]?.hand).toEqual(["b2", "a1", "b1", "c1"]);
    expect(next.round).toBe(2);
    expect(next.phase).toBe("selecting");
  });

  it("lower-wins stat: lowest economy wins", () => {
    const state = makeState({
      a: [card("a1", 0, 8), card("a2", 1)],
      b: [card("b1", 0, 4), card("b2", 1)],
    });
    const next = play(state, select("a", "economy"));
    expect(next.leader).toBe("b");
  });

  it("a card missing the stat is treated as worst possible", () => {
    const state = makeState({
      a: [card("a1", 0, 11.9), card("a2", 1)],
      b: [{ id: "b1", stats: { runs: 99 } }, card("b2", 1)], // no economy
    });
    // economy: a has 11.9 (bad but present), b missing → treated as 12
    const next = play(state, select("a", "economy"));
    expect(next.leader).toBe("a");
  });

  it("leader cannot select a stat their card lacks", () => {
    const state = makeState({
      a: [{ id: "a1", stats: { runs: 5 } }, card("a2", 1)],
      b: [card("b1", 1, 3), card("b2", 1)],
    });
    expect(() => applyCommand(state, select("a", "economy"))).toThrow(CommandRejectedError);
    try {
      applyCommand(state, select("a", "economy"));
    } catch (e) {
      expect((e as CommandRejectedError).reason).toBe("stat-not-on-card");
    }
  });

  it("tie for best: all revealed cards join the pot, same leader", () => {
    const state = makeState({
      a: [card("a1", 50), card("a2", 1)],
      b: [card("b1", 50), card("b2", 1)],
      c: [card("c1", 10), card("c2", 1)],
    });
    const next = play(state, select("a", "runs"));
    expect(next.pot).toEqual(["a1", "b1", "c1"]);
    expect(next.leader).toBe("a");
    expect(next.phase).toBe("selecting");
  });

  it("next winner takes the carried pot", () => {
    const state = makeState(
      {
        a: [card("a1", 60)],
        b: [card("b1", 50), card("b2", 1)],
      },
      { pot: [card("p1", 0), card("p2", 0)] },
    );
    const next = play(state, select("a", "runs"));
    expect(next.players[0]?.hand).toEqual(["p1", "p2", "a1", "b1"]);
    expect(next.pot).toEqual([]);
    // b lost its... b still has b2, game continues
    expect(next.phase).toBe("selecting");
  });
});

describe("elimination and win conditions", () => {
  it("losing your last card eliminates you; last standing wins", () => {
    const state = makeState({
      a: [card("a1", 90), card("a2", 1)],
      b: [card("b1", 10)],
    });
    const next = play(state, select("a", "runs"));
    expect(next.players[1]?.active).toBe(false);
    expect(next.phase).toBe("finished");
    expect(next.winner).toBe("a");
  });

  it("three players: eliminating one continues the game", () => {
    const state = makeState({
      a: [card("a1", 90), card("a2", 1)],
      b: [card("b1", 10)],
      c: [card("c1", 20), card("c2", 1)],
    });
    const next = play(state, select("a", "runs"));
    expect(next.players[1]?.active).toBe(false);
    expect(next.phase).toBe("selecting");
    expect(next.winner).toBeNull();
  });

  it("tie on your last card eliminates you and passes leadership", () => {
    const state = makeState({
      a: [card("a1", 50)],
      b: [card("b1", 50)],
      c: [card("c1", 10), card("c2", 1)],
    });
    const next = play(state, select("a", "runs"));
    // a and b tied on their last cards → both eliminated → c last standing
    expect(next.phase).toBe("finished");
    expect(next.winner).toBe("c");
    expect(next.pot).toEqual(["a1", "b1", "c1"]);
  });

  it("final tie between the last two: lowest seat index wins", () => {
    const state = makeState({
      a: [card("a1", 50)],
      b: [card("b1", 50)],
    });
    const events = applyCommand(state, select("a", "runs"));
    const last = events.at(-1);
    expect(last).toEqual({ type: "GAME_ENDED", winner: "a", reason: "final-tie" });
  });

  it("round limit: most cards wins, tie-break lowest seat", () => {
    const state = makeState(
      {
        a: [card("a1", 90), card("a2", 1)],
        b: [card("b1", 10), card("b2", 1), card("b3", 1)],
      },
      { maxRounds: 1 },
    );
    const next = play(state, select("a", "runs"));
    expect(next.phase).toBe("finished");
    // a won the round: a has 3 cards (a2, a1, b1), b has 2 → a wins on count
    expect(next.winner).toBe("a");
  });
});

describe("forfeit", () => {
  it("hand goes to the pot, leadership passes, game continues", () => {
    const state = makeState({
      a: [card("a1", 1), card("a2", 1)],
      b: [card("b1", 1)],
      c: [card("c1", 1)],
    });
    const next = play(state, { type: "FORFEIT", playerId: "a" });
    expect(next.players[0]?.active).toBe(false);
    expect(next.pot).toEqual(["a1", "a2"]);
    expect(next.leader).toBe("b");
    expect(next.phase).toBe("selecting");
  });

  it("forfeit leaving one player ends the game immediately", () => {
    const state = makeState({
      a: [card("a1", 1)],
      b: [card("b1", 99)],
    });
    const next = play(state, { type: "FORFEIT", playerId: "b" });
    expect(next.phase).toBe("finished");
    expect(next.winner).toBe("a");
  });
});

describe("auto-play", () => {
  it("plays the leader's best normalised stat deterministically", () => {
    // runs 80 → 0.8; economy 4 → (4-2)/10 = 0.2 → inverted 0.8... make asymmetric:
    const top = card("a1", 30, 3); // runs 0.3, economy (3-2)/10=0.1 → 0.9 → economy wins
    expect(chooseBestStat(top, stats)).toBe("economy");
    expect(normalizedValue(top, stats[1] as StatDefinition)).toBeCloseTo(0.9);

    const state = makeState({
      a: [top, card("a2", 1)],
      b: [card("b1", 99, 2.5), card("b2", 1)],
    });
    const events = applyCommand(state, { type: "AUTO_PLAY", playerId: "a" });
    expect(events[0]).toEqual({
      type: "STAT_SELECTED",
      playerId: "a",
      stat: "economy",
      auto: true,
    });
    const next = reduceAll(events, state);
    expect(next.leader).toBe("b"); // b's 2.5 economy beats a's 3
  });

  it("breaks normalisation ties by stat order", () => {
    const top: CardDefinition = { id: "x", stats: { runs: 50, economy: 7 } }; // 0.5 / 0.5
    expect(chooseBestStat(top, stats)).toBe("runs");
  });
});

describe("command validation", () => {
  const base = makeState({
    a: [card("a1", 1), card("a2", 1)],
    b: [card("b1", 1), card("b2", 1)],
  });

  it("rejects commands in a finished game", () => {
    const done: GameState = { ...base, phase: "finished", winner: "a" };
    expect(() => applyCommand(done, select("a", "runs"))).toThrow(/game-finished/);
  });

  it("rejects unknown players", () => {
    expect(() => applyCommand(base, select("zz", "runs"))).toThrow(/unknown-player/);
  });

  it("rejects inactive players", () => {
    const state: GameState = {
      ...base,
      players: base.players.map((p) => (p.id === "b" ? { ...p, active: false } : p)),
    };
    expect(() => applyCommand(state, { type: "FORFEIT", playerId: "b" })).toThrow(
      /player-inactive/,
    );
  });

  it("rejects non-leader selects and auto-plays", () => {
    expect(() => applyCommand(base, select("b", "runs"))).toThrow(/not-leader/);
    expect(() => applyCommand(base, { type: "AUTO_PLAY", playerId: "b" })).toThrow(/not-leader/);
  });

  it("rejects unknown stats", () => {
    expect(() => applyCommand(base, select("a", "sixes"))).toThrow(/unknown-stat/);
  });

  it("rejected commands change nothing and emit no events", () => {
    const snapshot = structuredClone(base);
    expect(() => applyCommand(base, select("b", "runs"))).toThrow(CommandRejectedError);
    expect(base).toEqual(snapshot);
  });
});
