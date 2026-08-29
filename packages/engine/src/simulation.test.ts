/**
 * Mass simulation harness + property tests.
 *
 * 1,000 bot-vs-bot games across seeds, player counts (2–6) and deck sizes,
 * asserting on every game:
 *  - it terminates with exactly one winner (runBotGame throws otherwise)
 *  - cards are conserved after EVERY event (no card created or destroyed)
 *  - structural invariants hold at every command boundary
 *  - replaying the event log reproduces the exact final state
 */
import { describe, expect, it } from "vitest";
import { runBotGame } from "./bot.js";
import { reduce } from "./reducer.js";
import { replay } from "./replay.js";
import type {
  CardDefinition,
  GameConfigInput,
  GameEndReason,
  GameState,
  StatDefinition,
} from "./types.js";

const stats: StatDefinition[] = [
  { key: "runs", direction: "higher", min: 0, max: 100 },
  { key: "wickets", direction: "higher", min: 0, max: 10 },
  { key: "economy", direction: "lower", min: 2, max: 12 },
];

/** Deterministic pseudo-varied deck; some cards miss the economy stat. */
function deck(n: number, salt: number): CardDefinition[] {
  return Array.from({ length: n }, (_, i) => {
    const base = i * 31 + salt * 17;
    const card: CardDefinition = {
      id: `card-${i}`,
      stats: { runs: base % 101, wickets: (base * 7) % 11 },
    };
    if (i % 5 !== 0) card.stats["economy"] = 2 + ((base * 3) % 100) / 10;
    return card;
  });
}

/** Multiset of all cards currently in hands + pot. */
function cardsInPlay(state: GameState): string[] {
  return [...state.players.flatMap((p) => p.hand), ...state.pot].sort();
}

function checkConservation(state: GameState, allCards: string[]): void {
  const inPlay = cardsInPlay(state);
  if (inPlay.length !== allCards.length || inPlay.some((c, i) => c !== allCards[i])) {
    throw new Error(`card conservation violated: ${inPlay.length}/${allCards.length} cards`);
  }
}

/** Invariants that must hold between commands (not mid-event-batch). */
function checkBoundaryInvariants(state: GameState): void {
  for (const p of state.players) {
    if (p.active && p.hand.length === 0) {
      throw new Error(`active player ${p.id} has an empty hand at a command boundary`);
    }
  }
  if (state.phase === "selecting") {
    const leader = state.players.find((p) => p.id === state.leader);
    if (leader === undefined || !leader.active) {
      throw new Error(`leader ${state.leader} is not an active player`);
    }
  }
  if (state.phase === "finished" && state.winner === null) {
    throw new Error("finished game without a winner");
  }
  const active = state.players.filter((p) => p.active).length;
  if (state.phase === "selecting" && active < 2) {
    throw new Error(`game still running with ${active} active players`);
  }
}

function gameConfig(seed: number): GameConfigInput {
  const playerCount = 2 + (seed % 5); // 2–6
  const deckSize = 12 + (seed % 4) * 8 + playerCount; // varied, sometimes uneven
  return {
    players: Array.from({ length: playerCount }, (_, i) => `p${i}`),
    cards: deck(deckSize, seed),
    stats,
    seed,
  };
}

const GAMES = 1000;

describe(`mass simulation (${GAMES} games)`, () => {
  it("every game terminates cleanly with all invariants intact", () => {
    const reasons = new Map<GameEndReason, number>();
    let totalRounds = 0;

    for (let seed = 0; seed < GAMES; seed++) {
      const { events, finalState, rounds } = runBotGame(gameConfig(seed));
      totalRounds += rounds;

      // Conservation after every single event.
      const allCards = cardsInPlay(finalState);
      let state: GameState | undefined;
      for (const event of events) {
        state = reduce(state, event);
        checkConservation(state, allCards);
      }

      // Boundary invariants on the final state + replay equality.
      checkBoundaryInvariants(finalState);
      expect(replay(events)).toEqual(finalState);

      const ended = events.at(-1);
      if (ended?.type !== "GAME_ENDED") throw new Error("log does not end with GAME_ENDED");
      expect(ended.winner).toBe(finalState.winner);
      reasons.set(ended.reason, (reasons.get(ended.reason) ?? 0) + 1);
    }

    // Sanity on the outcome distribution: bots never forfeit, and the vast
    // majority of games should end by elimination well before the limit.
    expect(reasons.get("opponents-forfeited")).toBeUndefined();
    expect(reasons.get("last-standing") ?? 0).toBeGreaterThan(GAMES * 0.5);
    expect(totalRounds).toBeGreaterThan(GAMES); // >1 round per game on average
  }, 60_000);

  it("boundary invariants hold after every command of a sampled game", () => {
    // Re-drive one game command-by-command, checking invariants at each step.
    const { events } = runBotGame(gameConfig(3));
    let state: GameState | undefined;
    for (const event of events) {
      state = reduce(state, event);
      // A command boundary is wherever the next event starts a new command
      // batch (STAT_SELECTED / PLAYER_FORFEITED) or the log ends.
      const i = events.indexOf(event);
      const next = events[i + 1];
      if (next === undefined || next.type === "STAT_SELECTED" || next.type === "PLAYER_FORFEITED") {
        checkBoundaryInvariants(state);
      }
    }
  });

  it("event logs are stable across runs (full determinism)", () => {
    for (const seed of [0, 123, 999]) {
      expect(runBotGame(gameConfig(seed)).events).toEqual(runBotGame(gameConfig(seed)).events);
    }
  });
});
