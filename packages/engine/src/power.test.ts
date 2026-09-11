/**
 * Power trumps — the rules in `docs/games/power-trumps.md`, one case each:
 * card choice, burned stats, rotating lead, the responding window,
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
  opts: {
    leader?: string;
    pot?: CardDefinition[];
    lastStat?: string;
    /** Stats already called on a card, keyed by card id. */
    burned?: Record<string, string[]>;
    maxRounds?: number;
  } = {},
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
      choiceDepth: 3,
      powerRecharge: "never",
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
    burnedByCard: opts.burned ?? {},
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
  it("defaults to a choice of two, and the host may set one to three (#135)", () => {
    const cards = [
      card("a1", 1),
      card("a2", 2),
      card("a3", 3),
      card("b1", 4),
      card("b2", 5),
      card("b3", 6),
    ];
    const base = { players: ["a", "b"], cards, stats, seed: 7 };
    const two = reduceAll([initGame({ ...base, mode: "power-trumps" })]);
    expect(two.config.choiceDepth).toBe(2);
    expect(() =>
      applyCommand(two, { type: "SELECT_STAT", playerId: two.leader, stat: "runs", cardIndex: 2 }),
    ).toThrow(/bad-card-index/);
    expect(
      applyCommand(two, { type: "SELECT_STAT", playerId: two.leader, stat: "runs", cardIndex: 1 }),
    ).not.toHaveLength(0);

    const three = reduceAll([initGame({ ...base, mode: "power-trumps", choiceDepth: 3 })]);
    expect(
      applyCommand(three, {
        type: "SELECT_STAT",
        playerId: three.leader,
        stat: "runs",
        cardIndex: 2,
      }),
    ).not.toHaveLength(0);

    // Classic always plays the top card, whatever the setting says.
    expect(reduceAll([initGame({ ...base, choiceDepth: 3 })]).config.choiceDepth).toBe(1);
    expect(() => initGame({ ...base, mode: "power-trumps", choiceDepth: 4 })).toThrow(
      /choiceDepth/,
    );
  });

  it("reads an old log without the field as a choice of three", () => {
    const started = initGame({
      players: ["a", "b"],
      cards: [card("a1", 1), card("a2", 2), card("b1", 3), card("b2", 4)],
      stats,
      seed: 3,
      mode: "power-trumps",
    });
    if (started.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    const { choiceDepth: _dropped, ...legacy } = started.config;
    void _dropped;
    const state = reduceAll([{ ...started, config: legacy as typeof started.config }]);
    expect(state.config.choiceDepth).toBe(3);
  });

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

describe("burned stats and rotation", () => {
  it("a card may not be called twice on the same stat", () => {
    const s0 = makeState(three, { burned: { a1: ["runs"] } });
    expect(() => applyCommand(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" })).toThrow(
      /stat-burned/,
    );
    const { events } = play(s0, { type: "AUTO_PLAY", playerId: "a" });
    expect(events[0]).toMatchObject({ type: "STAT_SELECTED", stat: "economy", auto: true });
  });

  it("the burn is the card's, not the table's (#137)", () => {
    const c = (id: string, runs: number) => ({ id, stats: { runs, economy: 8 } });
    const s0 = makeState({
      a: [c("a1", 10), c("a2", 10), c("a3", 10), c("a4", 10)],
      b: [c("b1", 90), c("b2", 10), c("b3", 10), c("b4", 10)],
    });
    const { state: s1 } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    // Only the card that called it is marked; the answering card is untouched.
    expect(s1.burnedByCard).toEqual({ a1: ["runs"] });
    // b leads now with a fresh card, so runs is still there to be called.
    expect(applyCommand(s1, { type: "SELECT_STAT", playerId: "b", stat: "runs" })).not.toHaveLength(
      0,
    );
    const { state: s2 } = play(
      s1,
      { type: "SELECT_STAT", playerId: "b", stat: "runs" },
      { type: "PLAY_CARD", playerId: "a", cardIndex: 0 },
    );
    expect(s2.burnedByCard).toEqual({ a1: ["runs"], b2: ["runs"] });
  });

  it("a card whose every stat is burned may still be called on (nothing is never callable)", () => {
    const s0 = makeState(three, { burned: { a1: ["runs", "economy"] } });
    expect(applyCommand(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" })).not.toHaveLength(
      0,
    );
  });

  it("DRS may not review on a stat its own card has already been called on", () => {
    const s0 = makeState(three, { burned: { b1: ["economy"] } });
    const { state: s1 } = play(s0, { type: "SELECT_STAT", playerId: "a", stat: "runs" });
    expect(() =>
      applyCommand(s1, {
        type: "PLAY_CARD",
        playerId: "b",
        cardIndex: 0,
        power: { kind: "drs", stat: "economy" },
      }),
    ).toThrow(/already been called/);
    // The same review on another of b's cards is fine.
    expect(
      applyCommand(s1, {
        type: "PLAY_CARD",
        playerId: "b",
        cardIndex: 1,
        power: { kind: "drs", stat: "economy" },
      }),
    ).not.toHaveLength(0);
  });

  it("a DRS burns the reviewing card on the stat it overruled with", () => {
    const s0 = makeState(three);
    const { state: s1 } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      {
        type: "PLAY_CARD",
        playerId: "b",
        cardIndex: 0,
        power: { kind: "drs", stat: "economy" },
      },
    );
    // The leader's card keeps the call it made; the reviewer's card keeps theirs.
    expect(s1.burnedByCard).toEqual({ a1: ["runs"], b1: ["economy"] });
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

  it("wins against a holder who played their last own card (#132)", () => {
    // b's hand after the settle is nothing but this round's winnings, so the
    // defender's card is the first of them. It must change hands exactly once.
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 95), card("a3", 5)],
      b: [card("b1", 90)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "super-over" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    const so = resolved(events).power?.superOvers[0];
    expect(so).toMatchObject({ challenger: "a", defender: "b", winner: "a" });
    expect(so?.defenderCard.cardId).toBe("a1");
    expect(hand(state, "a")).toEqual(["a3", "a1", "b1", "a2"]);
    expect(hand(state, "b")).toEqual([]);
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe("a");
    const transfers = resolved(events).power?.transfers ?? [];
    expect(transfers.filter((t) => t.cardId === "a1")).toHaveLength(1);
  });

  it("loses against a holder who played their last own card", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 20), card("a3", 5)],
      b: [card("b1", 90)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "super-over" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );
    // b's next card is a1 (10): a2 (20) beats it.
    expect(resolved(events).power?.superOvers[0]?.winner).toBe("a");
    expect(hand(state, "a")).toEqual(["a3", "a1", "b1", "a2"]);
    expect(hand(state, "b")).toEqual([]);
  });

  it("chains: the second challenger plays whoever holds the winnings now", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 95), card("a3", 5)],
      b: [card("b1", 90)],
      c: [card("c1", 20), card("c2", 99), card("c3", 1)],
    });
    const { state, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "super-over" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0, power: { kind: "super-over" } },
    );
    const sos = resolved(events).power?.superOvers ?? [];
    expect(sos.map((s) => [s.challenger, s.defender, s.winner])).toEqual([
      ["a", "b", "a"],
      ["c", "a", "c"],
    ]);
    // c's a2 (95) lost to c2 (99): c takes everything a just took, plus a's
    // new top card, and keeps its own Super Over card at the bottom.
    expect(hand(state, "c")).toEqual(["c3", "a1", "b1", "c1", "a2", "a3", "c2"]);
    expect(hand(state, "a")).toEqual([]);
    expect(hand(state, "b")).toEqual([]);
    const all = [...state.players.flatMap((p) => p.hand), ...state.pot].sort();
    expect(all).toEqual(["a1", "a2", "a3", "b1", "c1", "c2", "c3"]);
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

describe("power recharge (#133)", () => {
  // Six cards, two seats: a deck cycle is three rounds. a wins round 1 with a
  // Powerplay, b takes round 2 on economy, a takes round 3 — nobody goes out.
  const table = () => ({
    a: [card("a1", 90), card("a2", 10), card("a3", 60)],
    b: [card("b1", 10), card("b2", 50), card("b3", 50, 3)],
  });
  const threeRounds = (s0: GameState) =>
    play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "powerplay" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
      { type: "SELECT_STAT", playerId: "b", stat: "economy" },
      { type: "PLAY_CARD", playerId: "a", cardIndex: 0 },
      { type: "SELECT_STAT", playerId: "a", stat: "runs" },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
    );

  it("each-cycle: hands every power back after one pass of the deck", () => {
    const s0 = makeState(table());
    s0.config.powerRecharge = "each-cycle";
    const { state, events } = threeRounds(s0);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "POWERS_RECHARGED")).toHaveLength(1);
    expect(events.find((e) => e.type === "POWERS_RECHARGED")).toMatchObject({ round: 3 });
    expect(state.phase).toBe("selecting");
    expect(powers(state, "a")).toEqual([...POWER_KINDS]);
  });

  it("each-elimination: recharges the table when a seat goes out", () => {
    const s0 = makeState({
      a: [card("a1", 10), card("a2", 10), card("a3", 10)],
      b: [card("b1", 90), card("b2", 5)],
      c: [card("c1", 1)],
    });
    s0.config.powerRecharge = "each-elimination";
    const { state: s1, events } = play(
      s0,
      { type: "SELECT_STAT", playerId: "a", stat: "runs", power: { kind: "powerplay" } },
      { type: "PLAY_CARD", playerId: "b", cardIndex: 0 },
      { type: "PLAY_CARD", playerId: "c", cardIndex: 0 },
    );
    const types = events.map((e) => e.type);
    expect(types.indexOf("POWERS_RECHARGED")).toBeGreaterThan(types.indexOf("PLAYER_ELIMINATED"));
    expect(powers(s1, "a")).toEqual([...POWER_KINDS]);
    expect(s1.players.find((p) => p.id === "c")?.active).toBe(false);
  });

  it("never: the original one-shot rule, and what old logs default to", () => {
    const { state, events } = threeRounds(makeState(table()));
    expect(events.map((e) => e.type)).not.toContain("POWERS_RECHARGED");
    expect(powers(state, "a")).toEqual(["drs", "super-over"]);

    const cards = Object.values(table()).flat();
    const started = initGame({ players: ["a", "b"], cards, stats, seed: 1, mode: "power-trumps" });
    if (started.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    expect(started.config.powerRecharge).toBe("each-cycle");
    const { powerRecharge: _dropped, ...legacy } = started.config;
    void _dropped;
    const replayed = reduceAll([{ ...started, config: legacy as typeof started.config }]);
    expect(replayed.config.powerRecharge).toBe("never");
    // Classic never recharges, whatever is asked for.
    const classic = initGame({
      players: ["a", "b"],
      cards,
      stats,
      seed: 1,
      powerRecharge: "each-cycle",
    });
    if (classic.type !== "GAME_STARTED") throw new Error("expected GAME_STARTED");
    expect(classic.config.powerRecharge).toBe("never");
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

describe("powers under random declarations", () => {
  /** Tiny seeded LCG so the fuzz is reproducible. */
  const lcg = (seed: number) => () =>
    (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  it("conserve cards and never throw across 200 seeded games", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = lcg(seed);
      const players = 2 + Math.floor(rnd() * 4);
      const cards = Array.from({ length: players * (3 + Math.floor(rnd() * 3)) }, (_, i) =>
        card(`k${i}`, Math.floor(rnd() * 101), 2 + Math.floor(rnd() * 100) / 10),
      );
      const ids = Array.from({ length: players }, (_, i) => `p${i}`);
      let state = reduceAll([
        {
          type: "GAME_STARTED",
          config: {
            players: ids,
            cards,
            stats,
            seed,
            maxRounds: 60,
            mode: "power-trumps",
            choiceDepth: 3,
            powerRecharge:
              seed % 3 === 0 ? "each-cycle" : seed % 3 === 1 ? "each-elimination" : "never",
          },
          hands: Object.fromEntries(
            ids.map((id, i) => [id, cards.filter((_, j) => j % players === i).map((c) => c.id)]),
          ),
          firstLeader: "p0",
        },
      ]);
      const allCards = cards.map((c) => c.id).sort();
      let guard = 0;
      while (state.phase !== "finished" && guard++ < 2000) {
        const mover =
          state.phase === "responding"
            ? state.players.find((p) => p.active && !(p.id in (state.pending?.plays ?? {})))
            : state.players.find((p) => p.id === state.leader);
        if (mover === undefined) throw new Error("nobody to move");
        const depth = Math.min(3, mover.hand.length);
        const cardIndex = Math.floor(rnd() * depth);
        const kinds = mover.powers.filter((k) => state.phase === "responding" || k !== "drs");
        const kind =
          rnd() < 0.5 && kinds.length > 0 ? kinds[Math.floor(rnd() * kinds.length)] : null;
        const called = state.pending?.stat ?? "runs";
        const review = called === "runs" ? "economy" : "runs";
        const myCard = mover.hand[cardIndex] ?? "";
        const burned = state.burnedByCard[myCard] ?? [];
        const power =
          kind === null || (kind === "drs" && burned.includes(review))
            ? null
            : kind === "drs"
              ? { kind, stat: review }
              : { kind };
        let events: GameEvent[];
        try {
          events =
            state.phase === "responding"
              ? applyCommand(state, { type: "PLAY_CARD", playerId: mover.id, cardIndex, power })
              : applyCommand(state, {
                  type: "SELECT_STAT",
                  playerId: mover.id,
                  stat: burned.includes("runs") ? "economy" : "runs",
                  cardIndex,
                  power,
                });
        } catch (error) {
          if (error instanceof CommandRejectedError) continue; // e.g. second DRS this round
          throw new Error(`seed ${seed}: ${(error as Error).message}`);
        }
        state = reduceAll(events, state);
        const inPlay = [...state.players.flatMap((p) => p.hand), ...state.pot].sort();
        expect(inPlay, `seed ${seed}`).toEqual(allCards);
      }
      expect(state.phase, `seed ${seed} did not finish`).toBe("finished");
    }
  });
});
