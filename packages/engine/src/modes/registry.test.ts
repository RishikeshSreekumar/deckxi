/**
 * The mode registry and the plugin contract: every registered mode can be
 * driven end to end through the interface alone — the way the server does.
 */
import { GAME_MODE_INFO, GAME_MODES } from "@deckxi/shared";
import { describe, expect, it } from "vitest";
import type { AnyGameMode } from "../mode.js";
import type { CardDefinition, StatDefinition } from "../types.js";
import { CommandRejectedError } from "../types.js";
import { findMode, getMode, listModes, replayMode } from "./registry.js";

const stats: StatDefinition[] = [
  { key: "battingAvg", direction: "higher", min: 0, max: 50 },
  { key: "wickets", direction: "higher", min: 0, max: 200 },
  { key: "economy", direction: "lower", min: 0, max: 15 },
  { key: "catches", direction: "higher", min: 0, max: 100 },
];
const ROLES = ["batter", "bowler", "all-rounder", "keeper"];

function cards(n: number): CardDefinition[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    role: ROLES[i % 4] as string,
    nation: `N${i % 6}`,
    stats: {
      battingAvg: (i * 7) % 51,
      wickets: (i * 13) % 201,
      economy: 3 + ((i * 5) % 100) / 10,
      catches: (i * 3) % 101,
    },
  }));
}

/** Play a whole game through nothing but the mode interface, host-style. */
function playThrough(mode: AnyGameMode, players: string[]): { events: unknown[]; state: unknown } {
  const deck = cards(mode.deckSize(5, players.length));
  const started: unknown = mode.init({ players, cards: deck, stats, seed: 7, maxRounds: 60 });
  const events: unknown[] = [started];
  let state: unknown = mode.reduce(undefined, started);
  for (let i = 0; i < 2000; i++) {
    const status = mode.status(state);
    if (status.finished) break;
    const mover = status.waitingOn[0];
    if (mover === undefined) throw new Error(`${mode.id}: nobody to move`);
    // Alternate the bot with the host's timeout play so both paths run.
    const command: unknown =
      i % 3 === 0 ? mode.autoPlay(mover) : (mode.bot(state, mover) ?? mode.autoPlay(mover));
    const produced: unknown[] = mode.apply(state, command);
    events.push(...produced);
    for (const e of produced) state = mode.reduce(state, e);
  }
  return { events, state };
}

describe("mode registry", () => {
  it("registers every mode the protocol lists, with matching seat limits", () => {
    expect(
      listModes()
        .map((m) => m.id)
        .sort(),
    ).toEqual([...GAME_MODES].sort());
    for (const id of GAME_MODES) {
      expect(getMode(id).players).toEqual(GAME_MODE_INFO[id].players);
    }
    expect(findMode("bingo")).toBeUndefined();
    expect(() => getMode("bingo")).toThrow(/unknown game mode/);
  });

  it.each(GAME_MODES)("%s plays to a finish through the plugin contract alone", (id) => {
    const mode = getMode(id);
    const players = ["p0", "p1", "p2"];
    const { events, state } = playThrough(mode, players);
    const status = mode.status(state);
    expect(status.finished).toBe(true);
    expect(players).toContain(status.winner);
    expect(status.waitingOn).toEqual([]);
    expect((events.at(-1) as { type: string }).type).toBe("GAME_ENDED");

    // Replaying through the registry lands on the same state.
    expect(replayMode(id, events)).toEqual(state);
    expect(replayMode(id, events, 1)).toEqual(mode.reduce(undefined, events[0]));

    // Redaction never throws for any viewer and keeps the seed off the wire.
    for (const viewer of [...players, null]) {
      for (const e of events) {
        const view = mode.redact(e, viewer, "edition-test") as {
          type: string;
          config?: { seed?: unknown };
        };
        expect(view.type).toBe((e as { type: string }).type);
        if (view.config !== undefined) expect(view.config.seed).toBeUndefined();
      }
    }

    // The inspector reports every seat.
    const inspection = mode.inspect(state);
    expect(inspection.players.map((p) => p.id)).toEqual(players);
  });

  it("modes reject client commands they do not speak", () => {
    expect(() =>
      getMode("classic-trumps").clientCommand("p0", { type: "DRAFT_PICK", cardId: "x" }),
    ).toThrow(CommandRejectedError);
    expect(() =>
      getMode("squad-draft").clientCommand("p0", { type: "SELECT_STAT", stat: "runs" }),
    ).toThrow(/unknown-command/);
    expect(
      getMode("power-trumps").clientCommand("p0", { type: "PLAY_CARD", cardIndex: 1, power: null }),
    ).toEqual({
      type: "PLAY_CARD",
      playerId: "p0",
      cardIndex: 1,
      power: null,
    });
    expect(
      getMode("squad-draft").clientCommand("p0", { type: "DRAFT_PICK", cardId: "c1" }),
    ).toEqual({
      type: "DRAFT_PICK",
      playerId: "p0",
      cardId: "c1",
    });
  });

  it("a forfeit through the contract leaves one winner", () => {
    for (const id of GAME_MODES) {
      const mode = getMode(id);
      const players = ["p0", "p1"];
      const started: unknown = mode.init({
        players,
        cards: cards(mode.deckSize(5, 2)),
        stats,
        seed: 3,
      });
      const state: unknown = mode.reduce(undefined, started);
      const produced: { type: string; winner?: string }[] = mode.apply(state, mode.forfeit("p1"));
      expect(produced.at(-1)).toMatchObject({
        type: "GAME_ENDED",
        winner: "p0",
        reason: "opponents-forfeited",
      });
    }
  });
});
