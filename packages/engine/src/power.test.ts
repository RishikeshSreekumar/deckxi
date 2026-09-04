/**
 * Power trumps — the rules in `docs/games/power-trumps.md`, one case each:
 * card choice, the no-repeat call, rotating lead, the responding window,
 * and the three powers winning, losing and (Super Over) sitting out.
 */
import { describe, expect, it } from "vitest";
import { applyCommand } from "./apply.js";
import { runBotGame } from "./bot.js";
import { reduceAll } from "./reducer.js";
import { initGame } from "./setup.js";
import {
  CommandRejectedError,
  POWER_KINDS,
  type CardDefinition,
  type Command,
  type GameEvent,
  type GameState,
  type StatDefinition,
} from "./types.js";

const stats: StatDefinition[] = [
  { key: "runs", direction: "higher", min: 0, max: 100 },
  { key: "economy", direction: "lower", min: 2, max: 12 },
];

const card = (id: string, runs: number, economy = 8): CardDefinition => ({
  id,
  stats: { runs, economy },
});

function makeState(
  hands: Record<string, CardDefinition[]>,
  opts: { leader?: string; pot?: CardDefinition[]; lastStat?: string; maxRounds?: number } = {},
): GameState {
  const players = Object.keys(hands);
  const potCards = opts.pot ?? [];
  const cards = [...Object.values(hands).flat(), ...potCards];
  return {
    config: {
      players,
      cards,
      stats,
      seed: 1,
      maxRounds: opts.maxRounds ?? 1000,
      mode: "power-trumps",
    },
    phase: "selecting",
    round: 1,
    leader: opts.leader ?? (players[0] as string),
    players: players.map((id) => ({
      id,
      hand: (hands[id] ?? []).map((c) => c.id),
      active: (hands[id] ?? []).length > 0,
      powers: [...POWER_KINDS],
    })),
    pot: potCards.map((c) => c.id),
    winner: null,
    lastStat: opts.lastStat ?? null,
    pending: null,
  };
}

function play(state: GameState, ...commands: Command[]): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let next = state;
  for (const command of commands) {
    const produced = applyCommand(next, command);
    events.push(...produced);
    next = reduceAll(produced, next);
  }
  return { state: next, events };
}

const hand = (state: GameState, id: string): string[] =>
  state.players.find((p) => p.id === id)?.hand ?? [];
const powers = (state: GameState, id: string): string[] =>
  state.players.find((p) => p.id === id)?.powers ?? [];
const resolved = (events: GameEvent[]) =>
  events.find((e) => e.type === "ROUND_RESOLVED") as Extract<GameEvent, { type: "ROUND_RESOLVED" }>;

const three = {
  a: [card("a1", 10), card("a2", 50), card("a3", 90)],
  b: [card("b1", 60), card("b2", 20)],
};

describe("responding window", () => {
  it("the call opens the window; the last answer resolves the round", () => {
    const s0 = makeState(three);
    const { state: s1, events: e1 } = play(s0, {
      type: "SELECT_STAT",
      playerId: "a",
      stat: "runs",
    });
    expect(e1.map((e) => e.type)).toEqual(["STAT_SELECTED"]);
    expect(s1.phase).toBe("responding");
    expect(s1.pending?.plays["a"]?.cardId).toBe("a1");

    const { state: s2, events: e2 } = play(s1, { type: "PLAY_CARD", playerId: "b", cardIndex: 0 });
    expect(e2.map((e) => e.type)).toEqual(["CARD_PLAYED", "ROUND_RESOLVED"]);
    expect(s2.phase).toBe("selecting");
    expect(hand(s2, "b")).toEqual(["b2", "a1", "b1"]);
  });

  it("rejects answers before a call, from the leader, and twice", () => {
    const s0 = makeState(three);
    expect(() => applyCommand(s0, { type: "PLAY_CARD", playerId: "b", cardIndex: 0 })).toThrow(
      CommandRejectedError,
    );
    const { state: s1 } = play(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" });
    expect(() => applyCommand(s1, { type: "PLAY_CARD", playerId: "a", cardIndex: 0 })).toThrow(
      /already-played/,
    );
    expect(() => applyCommand(s1, { type: "SELECT_STAT", playerId: "a", stat: "runs" })).toThrow(
      /already-played/,
    );
  });

  it("auto-play answers with the top card and no power", () => {
    const s0 = makeState(three);
    const { state: s1 } = play(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" });
    const { events } = play(s1, { type: "AUTO_PLAY", playerId: "b" });
    const played = events[0];
    expect(played).toMatchObject({ type: "CARD_PLAYED", cardId: "b1", power: null, auto: true });
  });
});

describe("card choice", () => {
  it("lets a player commit any of the top three", () => {
    const s0 = makeState(three);
    const { state } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", cardIndex: 2 },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 1 },
    );
    expect(hand(state, "a")).toEqual(["a1", "a2", "a3", "b2"]);
    expect(hand(state, "b")).toEqual(["b1"]);
  });

  it("rejects a card index past the choice window or the hand", () => {
    const s0 = makeState(three);
    expect(() =>
      applyCommand(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs", cardIndex: 3 }),
    ).toThrow(/bad-card-index/);
    const { state: s1 } = play(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" });
    expect(() => applyCommand(s1, { type: "PLAY_CARD", playerId: "b", cardIndex: 2 })).toThrow(
      /bad-card-index/,
    );
  });
});

describe("no-repeat call and rotation", () => {
  it("the leader may not call the stat that decided the last round", () => {
    const s0 = makeState(three, { lastStat: "runs" });
    expect(() => applyCommand(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" })).toThrow(
      /stat-repeated/,
    );
    const { events } = play(s0, { type: "AUTO_PLAY", playerId: "a" });
    expect(events[0]).toMatchObject({ type: "STAT_SELECTED", stat: "economy", auto: true });
  });

  it("the lead rotates clockwise, tie or not, never to the winner by default", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 10), card("a3", 10)],
      b: [card("b1", 90), card("b2", 10), card("b3", 10)],
      c: [card("c1", 50), card("c2", 10), card("c3", 10)],
    });
    const { state: s1 } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0 },
    );
    expect(s1.leader).toBe("b");
    expect(s1.lastStat).toBe("runs");
    const { state: s2 } = play(
      s1,
      { type: "SELECT_STAT", playerId: "b", stat: "economy" },
      { type: "PLAY_CARD", playerId: "a", cardIndex: 0 },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0 },
    );
    expect(s2.pot.length).toBe(3); // all economy 8: a tie
    expect(s2.leader).toBe("c");
  });
});

describe("powerplay", () => {
  it("wins: one extra card from every loser", () => {
    const s0 = makeState({
      a: [card("a1", 90), card("a2", 1)],
      b: [card("b1", 10), card("b2", 2), card("b3", 3)],
      c: [card("c1", 20), card("c2", 4)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "powerplay" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0 },
    );
    expect(hand(state, "a")).toEqual(["a2", "a1", "b1", "c1", "b2", "c2"]);
    expect(hand(state, "b")).toEqual(["b3"]);
    expect(hand(state, "c")).toEqual([]);
    expect(powers(state, "a")).toEqual(["drs", "super-over"]);
    expect(resolved(events).power?.outcomes).toEqual([
      { playerId: "a", power: "powerplay", outcome: "won" },
    ]);
    expect(events.some((e) => e.type === "PLAYER_ELIMINATED" && e.playerId === "c")).toBe(true);
  });

  it("loses: one extra card to the winner", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 1)],
      b: [card("b1", 90), card("b2", 2)],
    });
    const { state } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "powerplay" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    expect(hand(state, "a")).toEqual([]);
    expect(hand(state, "b")).toEqual(["b2", "a1", "b1", "a2"]);
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe("b");
  });

  it("on a tie the extra card goes to the pot", () => {
    const s0 = makeState({
      a: [card("a1", 50), card("a2", 1)],
      b: [card("b1", 50), card("b2", 2)],
    });
    const { state } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0, power: { kind: "powerplay" } },
    );
    expect(state.pot).toEqual(["a1", "b1", "b2"]);
    expect(hand(state, "b")).toEqual([]);
    expect(powers(state, "b")).not.toContain("powerplay");
  });

  it("a power may only be used once", () => {
    const s0 = makeState(three);
    s0.players[0]!.powers = ["drs", "super-over"];
    expect(() =>
      applyCommand(s0, {
        type: "SELECT_STAT",
        playerId: "a",
        stat: "runs",
        power: { kind: "powerplay" },
      }),
    ).toThrow(/power-unavailable/);
  });
});

describe("drs", () => {
  it("overrules the call; a win also takes the next lead", () => {
    const s0 = makeState({
      a: [card("a1", 90, 10), card("a2", 1)],
      b: [card("b1", 10, 4), card("b2", 2)],
      c: [card("c1", 20, 6), card("c2", 3)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0, power: { kind: "drs", stat: "economy" } },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0 },
    );
    const r = resolved(events);
    expect(r.stat).toBe("economy");
    expect(r.power?.calledStat).toBe("runs");
    expect(r.power?.drsBy).toBe("b");
    expect(r.result).toEqual({ kind: "won", winner: "b" });
    expect(state.leader).toBe("b");
    expect(state.lastStat).toBe("economy");
    expect(hand(state, "b")).toEqual(["b2", "a1", "b1", "c1"]);
  });

  it("loses: one extra card to the winner, lead rotates as normal", () => {
    const s0 = makeState({
      a: [card("a1", 90, 4), card("a2", 1)],
      b: [card("b1", 10, 10), card("b2", 2)],
      c: [card("c1", 20, 6), card("c2", 3)],
    });
    const { state } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0, power: { kind: "drs", stat: "economy" } },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0 },
    );
    expect(hand(state, "a")).toEqual(["a2", "a1", "b1", "c1", "b2"]);
    expect(hand(state, "b")).toEqual([]);
    expect(state.leader).toBe("c");
  });

  it("is refused to the leader, on the called stat, and a second time in a round", () => {
    const s0 = makeState({
      a: [card("a1", 1), card("a2", 1)],
      b: [card("b1", 1), card("b2", 1)],
      c: [card("c1", 1), card("c2", 1)],
    });
    expect(() =>
      applyCommand(s0, {
        type: "SELECT_STAT",
        playerId: "a",
        stat: "runs",
        power: { kind: "drs", stat: "economy" },
      }),
    ).toThrow(/power-not-allowed/);
    const { state: s1 } = play(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" });
    expect(() =>
      applyCommand(s1, {
        type: "PLAY_CARD",
        playerId: "b",
        cardIndex: 0,
        power: { kind: "drs", stat: "runs" },
      }),
    ).toThrow(/power-not-allowed/);
    const { state: s2 } = play(s1, {
      type: "PLAY_CARD",
      playerId: "b",
      cardIndex: 0,
      power: { kind: "drs", stat: "economy" },
    });
    expect(() =>
      applyCommand(s2, {
        type: "PLAY_CARD",
        playerId: "c",
        cardIndex: 0,
        power: { kind: "drs", stat: "economy" },
      }),
    ).toThrow(/power-not-allowed/);
  });
});

describe("super over", () => {
  it("wins: the challenger's next card beats the winner's, and takes everything", () => {
    const s0 = makeState(
      {
        a: [card("a1", 10), card("a2", 95), card("a3", 5)],
        b: [card("b1", 90), card("b2", 30), card("b3", 7)],
      },
      { pot: [card("p1", 0)] },
    );
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "super-over" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    const so = resolved(events).power?.superOvers[0];
    expect(so).toMatchObject({ challenger: "a", defender: "b", winner: "a" });
    expect(so?.challengerCard.cardId).toBe("a2");
    expect(so?.defenderCard.cardId).toBe("b2");
    // a keeps a3, then the pot, the reveal, and both Super Over cards.
    expect(hand(state, "a")).toEqual(["a3", "p1", "a1", "b1", "b2", "a2"]);
    expect(hand(state, "b")).toEqual(["b3"]);
    expect(state.pot).toEqual([]);
    expect(state.leader).toBe("b");
  });

  it("loses: the Super Over card goes to the winner too", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 20), card("a3", 5)],
      b: [card("b1", 90), card("b2", 30)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "super-over" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    expect(resolved(events).power?.superOvers[0]?.winner).toBeNull();
    expect(hand(state, "a")).toEqual(["a3"]);
    expect(hand(state, "b")).toEqual(["b2", "a1", "b1", "a2"]);
  });

  it("is void on a tie or a win and is handed back", () => {
    const s0 = makeState({
      a: [card("a1", 50), card("a2", 1)],
      b: [card("b1", 50), card("b2", 1)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "super-over" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    expect(resolved(events).power?.outcomes).toEqual([
      { playerId: "a", power: "super-over", outcome: "void" },
    ]);
    expect(powers(state, "a")).toContain("super-over");
    expect(state.pot).toEqual(["a1", "b1"]);
  });
});

describe("forfeit mid-round", () => {
  it("resolves the round among those still in when the last answer was theirs", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 1)],
      b: [card("b1", 90), card("b2", 2)],
      c: [card("c1", 20), card("c2", 3)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
      { type: "FORFEIT", playerId: "c" },
    );
    expect(events.map((e) => e.type)).toEqual([
      "STAT_SELECTED",
      "CARD_PLAYED",
      "PLAYER_FORFEITED",
      "ROUND_RESOLVED",
    ]);
    expect(state.phase).toBe("selecting");
    // c's hand went to the pot and b swept it with the round.
    expect(hand(state, "b")).toEqual(["b2", "c1", "c2", "a1", "b1"]);
    expect(state.leader).toBe("b");
  });
});

describe("bot games", () => {
  it("bots finish a power-trumps game from a real deal", () => {
    const cards = Array.from({ length: 24 }, (_, i) =>
      card(`card-${i}`, (i * 37) % 101, 2 + ((i * 13) % 100) / 10),
    );
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = runBotGame({
        players: ["p1", "p2", "p3"],
        cards,
        stats,
        seed,
        maxRounds: 200,
        mode: "power-trumps",
      });
      expect(result.finalState.phase).toBe("finished");
      expect(result.events[0]).toMatchObject({ type: "GAME_STARTED" });
      const total = result.finalState.players.reduce((n, p) => n + p.hand.length, 0);
      expect(total + result.finalState.pot.length).toBe(24);
    }
  });

  it("deals every power to every player in power trumps and none in classic", () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, i));
    const power = reduceAll([
      initGame({ players: ["x", "y"], cards, stats, seed: 3, mode: "power-trumps" }),
    ]);
    expect(power.players.every((p) => p.powers.length === 3)).toBe(true);
    const classic = reduceAll([initGame({ players: ["x", "y"], cards, stats, seed: 3 })]);
    expect(classic.players.every((p) => p.powers.length === 0)).toBe(true);
    expect(classic.config.mode).toBe("classic-trumps");
  });
});
