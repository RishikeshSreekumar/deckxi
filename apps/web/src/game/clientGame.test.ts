/**
 * The client mirror must track exactly what the engine reducer tracks, minus
 * hidden information — driven here with hand-built redacted event logs and a
 * cross-check against the real engine playing a full game.
 */
import { describe, expect, it } from "vitest";
import { applyCommand, initGame, reduce, type GameState } from "@deckxi/engine";
import type { RedactedGameEvent } from "@deckxi/shared";
import { applyRedactedEvent, applyRedactedEvents, type ClientGameState } from "./clientGame.js";

const config = {
  players: ["a", "b"],
  cards: [
    { id: "c1", stats: { runs: 10 } },
    { id: "c2", stats: { runs: 20 } },
    { id: "c3", stats: { runs: 30 } },
    { id: "c4", stats: { runs: 40 } },
  ],
  stats: [{ key: "runs", direction: "higher" as const, min: 0, max: 100 }],
  maxRounds: 100,
  editionId: "edition-2026-q3",
};

function started(yourHand: string[] | null): RedactedGameEvent {
  return {
    seq: 0,
    type: "GAME_STARTED",
    config,
    firstLeader: "a",
    yourHand,
    handCounts: { a: 2, b: 2 },
  };
}

describe("applyRedactedEvent", () => {
  it("initialises from GAME_STARTED", () => {
    const s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    expect(s.leader).toBe("a");
    expect(s.round).toBe(1);
    expect(s.yourHand).toEqual(["c1", "c3"]);
    expect(s.handCounts).toEqual({ a: 2, b: 2 });
    expect(s.active).toEqual({ a: true, b: true });
  });

  it("keeps a null hand for spectators", () => {
    const s = applyRedactedEvent(null, started(null), null);
    expect(s.yourHand).toBeNull();
  });

  it("moves cards on a won round, mirroring engine order", () => {
    let s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    s = applyRedactedEvent(
      s,
      {
        seq: 1,
        type: "ROUND_RESOLVED",
        round: 1,
        stat: "runs",
        revealed: [
          { playerId: "a", cardId: "c1", value: 10 },
          { playerId: "b", cardId: "c2", value: 20 },
        ],
        result: { kind: "won", winner: "b" },
      },
      "a",
    );
    expect(s.round).toBe(2);
    expect(s.leader).toBe("b");
    expect(s.yourHand).toEqual(["c3"]);
    expect(s.handCounts).toEqual({ a: 1, b: 3 });
    expect(s.pot).toEqual([]);
  });

  it("appends won cards to your own hand (pot first, then reveals)", () => {
    let s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    // Tie: both cards to the pot.
    s = applyRedactedEvent(
      s,
      {
        seq: 1,
        type: "ROUND_RESOLVED",
        round: 1,
        stat: "runs",
        revealed: [
          { playerId: "a", cardId: "c1", value: 10 },
          { playerId: "b", cardId: "c2", value: 10 },
        ],
        result: { kind: "tie", tiedPlayers: ["a", "b"] },
      },
      "a",
    );
    expect(s.pot).toEqual(["c1", "c2"]);
    expect(s.yourHand).toEqual(["c3"]);
    // You win the next round and sweep the pot.
    s = applyRedactedEvent(
      s,
      {
        seq: 2,
        type: "ROUND_RESOLVED",
        round: 2,
        stat: "runs",
        revealed: [
          { playerId: "a", cardId: "c3", value: 30 },
          { playerId: "b", cardId: "c4", value: 20 },
        ],
        result: { kind: "won", winner: "a" },
      },
      "a",
    );
    expect(s.yourHand).toEqual(["c1", "c2", "c3", "c4"]);
    expect(s.handCounts).toEqual({ a: 4, b: 0 });
    expect(s.pot).toEqual([]);
    expect(s.lastResolved?.potTaken).toBe(2);
  });

  it("tracks a forfeited hidden hand as unknown pot cards", () => {
    let s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    s = applyRedactedEvent(s, { seq: 1, type: "PLAYER_FORFEITED", playerId: "b" }, "a");
    expect(s.pot).toEqual([null, null]);
    expect(s.handCounts["b"]).toBe(0);
    expect(s.active["b"]).toBe(false);
  });

  it("reassigns the leader when the leader is eliminated", () => {
    let s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    s = applyRedactedEvent(s, { seq: 1, type: "PLAYER_ELIMINATED", playerId: "a", round: 1 }, "a");
    expect(s.leader).toBe("b");
  });

  it("ignores events at or below the applied sequence (resume overlap)", () => {
    let s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    const dup: RedactedGameEvent = { seq: 0, type: "PLAYER_FORFEITED", playerId: "b" };
    s = applyRedactedEvent(s, dup, "a");
    expect(s.active["b"]).toBe(true);
  });

  it("records the end of the game", () => {
    let s = applyRedactedEvent(null, started(["c1", "c3"]), "a");
    s = applyRedactedEvent(
      s,
      { seq: 1, type: "GAME_ENDED", winner: "b", reason: "last-standing" },
      "a",
    );
    expect(s.finished).toBe(true);
    expect(s.winner).toBe("b");
    expect(s.endReason).toBe("last-standing");
  });
});

describe("client mirror vs real engine", () => {
  it("stays consistent with engine hand counts through a full bot game", () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      stats: { runs: (i * 37) % 50, wickets: (i * 13) % 30 },
    }));
    const stats = [
      { key: "runs", direction: "higher" as const, min: 0, max: 50 },
      { key: "wickets", direction: "higher" as const, min: 0, max: 30 },
    ];
    const startEvents = [initGame({ players: ["a", "b"], cards, stats, seed: 42, maxRounds: 60 })];
    let engine: GameState | undefined;
    for (const e of startEvents) engine = reduce(engine, e);
    if (engine === undefined) throw new Error("no engine state");

    let seq = 0;
    const redact = (e: (typeof startEvents)[number]): RedactedGameEvent => {
      if (e.type === "GAME_STARTED") {
        return {
          seq: seq++,
          type: "GAME_STARTED",
          config: {
            players: e.config.players,
            cards: e.config.cards,
            stats: e.config.stats,
            maxRounds: e.config.maxRounds,
            editionId: "edition-2026-q3",
          },
          firstLeader: e.firstLeader,
          yourHand: [...(e.hands["a"] ?? [])],
          handCounts: Object.fromEntries(
            Object.entries(e.hands).map(([id, hand]) => [id, hand.length]),
          ),
        };
      }
      return { seq: seq++, ...e };
    };

    let client: ClientGameState | null = applyRedactedEvents(null, startEvents.map(redact), "a");

    let guard = 0;
    while (engine.phase !== "finished" && guard++ < 200) {
      const leader = engine.players.find((p) => p.id === engine?.leader);
      const top = leader?.hand[0];
      if (leader === undefined || top === undefined) break;
      const card = cards.find((c) => c.id === top);
      const stat = (card?.stats.runs ?? 0) >= (card?.stats.wickets ?? 0) ? "runs" : "wickets";
      const events = applyCommand(engine, { type: "SELECT_STAT", playerId: leader.id, stat });
      for (const e of events) engine = reduce(engine, e);
      client = applyRedactedEvents(client, events.map(redact), "a");

      if (client === null) throw new Error("client state lost");
      for (const p of engine.players) {
        expect(client.handCounts[p.id]).toBe(p.hand.length);
      }
      const engineA = engine.players.find((p) => p.id === "a");
      expect(client.yourHand).toEqual(engineA?.hand);
      expect(client.pot.length).toBe(engine.pot.length);
      expect(client.leader).toBe(engine.leader);
      expect(client.round).toBe(engine.round);
    }

    expect(engine.phase).toBe("finished");
    expect(client?.finished).toBe(true);
    expect(client?.winner).toBe(engine.winner);
  });
});
