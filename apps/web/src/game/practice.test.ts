/**
 * Offline practice (#85). The point of these tests is that the local host is
 * the *same* game: the events it produces fold through the ordinary client
 * reducer, hands stay secret the way the server keeps them secret, and a game
 * played entirely against bots reaches a real ending.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { RedactedGameEvent } from "@deckxi/shared";
import { applyRedactedEvents, type ClientGameState } from "./clientGame.js";
import {
  endPractice,
  practiceCommand,
  practiceFinished,
  practiceForfeit,
  practiceRunning,
  PRACTICE_SELF_ID,
  startPractice,
} from "./practice.js";

const fold = (state: ClientGameState | null, events: unknown[]) =>
  applyRedactedEvents(state, events as RedactedGameEvent[], PRACTICE_SELF_ID);

beforeEach(() => {
  endPractice();
});

describe("startPractice", () => {
  it("seats you with bots and deals a hand nobody else can see", () => {
    const table = startPractice({ gameMode: "classic-trumps", name: "Solo", seed: 7 });

    expect(table.selfId).toBe(PRACTICE_SELF_ID);
    expect(table.room.phase).toBe("playing");
    expect(table.room.players).toHaveLength(3);
    expect(table.room.players[0]?.name).toBe("Solo");
    expect(practiceRunning()).toBe(true);

    const game = fold(null, table.events);
    // Your own hand is card ids; theirs are counts only — the same redaction
    // the server applies, because it is the same `mode.redact`.
    expect(game?.yourHand?.every((c) => typeof c === "string")).toBe(true);
    expect(Object.keys(game?.handCounts ?? {})).toHaveLength(3);
  });

  it("stops with the table waiting on you", () => {
    const table = startPractice({ gameMode: "classic-trumps", name: "Solo", seed: 11 });
    const game = fold(null, table.events);
    // Bots move in the same burst that starts the game, so by the time the
    // events land it is either your call or the game has moved to a round
    // you must answer.
    expect(game?.finished).toBe(false);
    expect(game?.phase).toBe("selecting");
    expect(game?.leader).toBe(PRACTICE_SELF_ID);
  });
});

describe("playing a practice game", () => {
  it("runs to a finish against the bots", () => {
    const table = startPractice({ gameMode: "classic-trumps", name: "Solo", seed: 3 });
    let game = fold(null, table.events);

    for (let turn = 0; turn < 500 && game !== null && !game.finished; turn++) {
      expect(game.leader).toBe(PRACTICE_SELF_ID);
      const top = game.yourHand?.[0];
      expect(top).toBeTypeOf("string");
      const stat = game.config.stats[turn % game.config.stats.length]?.key as string;
      game = fold(game, practiceCommand({ type: "SELECT_STAT", stat }));
    }

    expect(game?.finished).toBe(true);
    expect(practiceFinished()).toBe(true);
    expect(game?.winner).not.toBeNull();
  });

  it("rejects a move the engine would not allow", () => {
    startPractice({ gameMode: "classic-trumps", name: "Solo", seed: 5 });
    expect(() => practiceCommand({ type: "SELECT_STAT", stat: "not-a-stat" })).toThrow();
  });

  it("ends the game when you forfeit", () => {
    const table = startPractice({ gameMode: "classic-trumps", name: "Solo", seed: 9 });
    const game = fold(fold(null, table.events), practiceForfeit());

    expect(game?.finished).toBe(true);
    expect(game?.winner).not.toBe(PRACTICE_SELF_ID);
  });

  it("refuses to play once nothing is running", () => {
    endPractice();
    expect(practiceRunning()).toBe(false);
    expect(() => practiceCommand({ type: "SELECT_STAT", stat: "runs" })).toThrow(
      /no practice game/,
    );
  });
});
