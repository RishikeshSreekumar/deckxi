/**
 * Squad Draft mass simulation: bot-vs-bot games across seeds and table
 * sizes (2–4), asserting on every game that it terminates with exactly one
 * winner, that cards are conserved after every event (pool + squads is the
 * whole deck, always), that every XI in the final league is legal, and that
 * replaying the log reproduces the final state byte for byte.
 */
import { describe, expect, it } from "vitest";
import { getMode } from "../registry.js";
import type { CardDefinition, StatDefinition } from "../../types.js";
import { rosterProblem } from "./apply.js";
import { squadDraftBot } from "./bot.js";
import { onTheClock, reduceSquadDraft } from "./reducer.js";
import { initSquadDraft, squadDraftPoolSize } from "./setup.js";
import { applySquadDraft } from "./apply.js";
import { squadDraftWaitingOn } from "./mode.js";
import type { SquadDraftEvent, SquadDraftState } from "./types.js";

const stats: StatDefinition[] = [
  { key: "battingAvg", direction: "higher", min: 0, max: 50 },
  { key: "strikeRate", direction: "higher", min: 0, max: 200 },
  { key: "runs", direction: "higher", min: 0, max: 5000 },
  { key: "wickets", direction: "higher", min: 0, max: 200 },
  { key: "economy", direction: "lower", min: 0, max: 15 },
  { key: "catches", direction: "higher", min: 0, max: 100 },
];
const ROLES = ["batter", "bowler", "all-rounder", "keeper", "batter", "bowler"];
const NATIONS = ["IN", "AU", "EN", "PK", "NZ", "SA", "WI", "SL"];

function pool(n: number, salt: number): CardDefinition[] {
  return Array.from({ length: n }, (_, i) => {
    const base = i * 53 + salt * 19;
    const card: CardDefinition = {
      id: `card-${i}`,
      role: ROLES[(i + salt) % ROLES.length] as string,
      stats: {
        battingAvg: base % 51,
        strikeRate: (base * 3) % 201,
        runs: (base * 13) % 5001,
        wickets: (base * 7) % 201,
        catches: (base * 11) % 101,
      },
    };
    // Some cards carry no nation and some no economy — the engine must cope.
    if (i % 7 !== 0) card.nation = NATIONS[(base >> 2) % NATIONS.length] as string;
    if (i % 5 !== 0) card.stats["economy"] = 3 + ((base * 5) % 100) / 10;
    return card;
  });
}

interface Run {
  events: SquadDraftEvent[];
  finalState: SquadDraftState;
}

function runGame(seed: number): Run {
  const playerCount = 2 + (seed % 3);
  const players = Array.from({ length: playerCount }, (_, i) => `p${i}`);
  const started = initSquadDraft({
    players,
    cards: pool(squadDraftPoolSize(playerCount) + (seed % 4), seed),
    stats,
    seed,
  });
  const events: SquadDraftEvent[] = [started];
  let state = reduceSquadDraft(undefined, started);
  const cap = playerCount * 13 + playerCount + 5;
  for (let i = 0; i < cap && state.phase !== "finished"; i++) {
    const mover = state.phase === "drafting" ? onTheClock(state) : squadDraftWaitingOn(state)[0];
    if (mover === undefined || mover === null) throw new Error("nobody to move");
    // Every fifth building move times out instead, to exercise auto-play.
    const move =
      state.phase === "building" && i % 5 === 0
        ? { type: "AUTO_PLAY" as const, playerId: mover }
        : squadDraftBot(state, mover);
    if (move === null) throw new Error(`bot has no move for ${mover}`);
    const produced = applySquadDraft(state, move);
    events.push(...produced);
    state = produced.reduce(
      reduceSquadDraft,
      state as SquadDraftState | undefined,
    ) as SquadDraftState;
  }
  if (state.phase !== "finished") throw new Error("game did not terminate");
  return { events, finalState: state };
}

function inPlay(state: SquadDraftState): string[] {
  return [...state.pool, ...Object.values(state.squads).flat()].sort();
}

const GAMES = 300;

describe(`squad draft simulation (${GAMES} games)`, () => {
  it("every game terminates with one winner, conserved cards and a replayable log", () => {
    let matches = 0;
    for (let seed = 0; seed < GAMES; seed++) {
      const { events, finalState } = runGame(seed);
      const all = finalState.config.cards.map((c) => c.id).sort();
      let state: SquadDraftState | undefined;
      for (const event of events) {
        state = reduceSquadDraft(state, event);
        expect(inPlay(state)).toEqual(all);
      }
      expect(state).toEqual(finalState);
      expect(finalState.winner).not.toBeNull();
      const ended = events.at(-1);
      expect(ended?.type).toBe("GAME_ENDED");
      if (ended?.type === "GAME_ENDED") expect(ended.winner).toBe(finalState.winner);

      // Every squad is full, every XI legal, the table crowns the winner.
      for (const id of finalState.config.players) {
        expect(finalState.squads[id]).toHaveLength(13);
        const roster = finalState.rosters[id];
        expect(roster).not.toBeNull();
        if (roster != null) expect(rosterProblem(finalState, id, roster)).toBeNull();
      }
      const league = finalState.league;
      if (league === null) throw new Error("no league");
      const n = finalState.config.players.length;
      expect(league.matches).toHaveLength((n * (n - 1)) / 2);
      expect(league.table[0]?.playerId).toBe(finalState.winner);
      matches += league.matches.length;
    }
    expect(matches).toBeGreaterThan(GAMES);
  }, 60_000);

  it("is deterministic per seed and replays through the registry", () => {
    for (const seed of [0, 17, 123]) {
      const a = runGame(seed);
      const b = runGame(seed);
      expect(a.events).toEqual(b.events);
      const mode = getMode("squad-draft");
      let state: unknown;
      for (const event of a.events) state = mode.reduce(state, event);
      expect(state).toEqual(a.finalState);
      expect(mode.status(a.finalState)).toMatchObject({
        finished: true,
        winner: a.finalState.winner,
      });
    }
  });

  it("the bot builds squads with a keeper and enough bowling", () => {
    let keepers = 0;
    let arms = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { finalState } = runGame(seed);
      for (const id of finalState.config.players) {
        const cards = (finalState.squads[id] ?? []).map(
          (c) => finalState.config.cards.find((x) => x.id === c) as CardDefinition,
        );
        if (cards.some((c) => c.role === "keeper")) keepers++;
        if (cards.filter((c) => c.role === "bowler" || c.role === "all-rounder").length >= 5)
          arms++;
      }
    }
    // Pools always carry keepers and bowlers; the bot should nearly always find them.
    expect(keepers).toBeGreaterThan(100);
    expect(arms).toBeGreaterThan(100);
  });
});
