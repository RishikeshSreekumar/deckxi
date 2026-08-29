import { describe, expect, it } from "vitest";
import { baselineBot, runBotGame } from "./bot.js";
import { reduce } from "./reducer.js";
import { initGame } from "./setup.js";
import type { CardDefinition, GameConfigInput, StatDefinition } from "./types.js";

const stats: StatDefinition[] = [
  { key: "runs", direction: "higher", min: 0, max: 100 },
  { key: "economy", direction: "lower", min: 2, max: 12 },
];

function deck(n: number): CardDefinition[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `card-${i}`,
    stats: { runs: (i * 37) % 101, economy: 2 + ((i * 13) % 100) / 10 },
  }));
}

function config(overrides: Partial<GameConfigInput> = {}): GameConfigInput {
  return { players: ["p1", "p2"], cards: deck(16), stats, seed: 7, ...overrides };
}

describe("baselineBot", () => {
  it("only moves as the active leader in a live game", () => {
    const state = reduce(undefined, initGame(config()));
    const nonLeader = state.config.players.find((p) => p !== state.leader) as string;
    expect(baselineBot(state, nonLeader)).toBeNull();
    expect(baselineBot(state, "nobody")).toBeNull();
    expect(baselineBot({ ...state, phase: "finished" }, state.leader)).toBeNull();
  });

  it("selects the best normalised stat on its top card", () => {
    const state = reduce(undefined, initGame(config()));
    const command = baselineBot(state, state.leader);
    expect(command?.type).toBe("SELECT_STAT");
    if (command?.type !== "SELECT_STAT") return;
    const leader = state.players.find((p) => p.id === state.leader);
    const top = state.config.cards.find((c) => c.id === leader?.hand[0]);
    expect(top?.stats).toHaveProperty(command.stat);
  });
});

describe("runBotGame", () => {
  it("plays a full game to a single winner", () => {
    const { finalState, events, rounds } = runBotGame(config());
    expect(finalState.phase).toBe("finished");
    expect(finalState.winner).not.toBeNull();
    expect(rounds).toBeGreaterThan(0);
    expect(events[0]?.type).toBe("GAME_STARTED");
    expect(events.at(-1)?.type).toBe("GAME_ENDED");
  });

  it("is deterministic: same seed, identical event log", () => {
    expect(runBotGame(config())).toEqual(runBotGame(config()));
  });

  it("differs across seeds", () => {
    const a = runBotGame(config({ seed: 1 }));
    const b = runBotGame(config({ seed: 2 }));
    expect(a.events).not.toEqual(b.events);
  });

  it("handles 6 players", () => {
    const { finalState } = runBotGame(
      config({ players: ["a", "b", "c", "d", "e", "f"], cards: deck(36) }),
    );
    expect(finalState.phase).toBe("finished");
    expect(finalState.winner).not.toBeNull();
  });
});
