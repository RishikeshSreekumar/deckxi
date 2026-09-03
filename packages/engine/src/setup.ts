/**
 * Game setup: config validation, seeded shuffle + round-robin deal, and the
 * GAME_STARTED event. All randomness in a game happens here.
 */
import { mulberry32, randomInt, shuffle } from "./rng.js";
import {
  DEFAULT_MAX_ROUNDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type CardId,
  type GameConfig,
  type GameConfigInput,
  type GameEvent,
  type PlayerId,
} from "./types.js";

export class InvalidConfigError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "InvalidConfigError";
  }
}

function validateConfig(config: GameConfig): void {
  const { players, cards, stats } = config;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new InvalidConfigError(
      `player count must be ${MIN_PLAYERS}–${MAX_PLAYERS}, got ${players.length}`,
    );
  }
  if (new Set(players).size !== players.length) {
    throw new InvalidConfigError("duplicate player ids");
  }
  if (cards.length < players.length) {
    throw new InvalidConfigError(
      `need at least one card per player (${players.length}), got ${cards.length}`,
    );
  }
  if (new Set(cards.map((c) => c.id)).size !== cards.length) {
    throw new InvalidConfigError("duplicate card ids");
  }
  if (stats.length === 0) {
    throw new InvalidConfigError("at least one stat definition required");
  }
  if (new Set(stats.map((s) => s.key)).size !== stats.length) {
    throw new InvalidConfigError("duplicate stat keys");
  }
  for (const stat of stats) {
    if (!Number.isFinite(stat.min) || !Number.isFinite(stat.max) || stat.min > stat.max) {
      throw new InvalidConfigError(
        `stat ${stat.key} has invalid bounds [${stat.min}, ${stat.max}]`,
      );
    }
  }
  if (!Number.isInteger(config.maxRounds) || config.maxRounds < 1) {
    throw new InvalidConfigError(`maxRounds must be a positive integer, got ${config.maxRounds}`);
  }
}

/**
 * Validates the config, shuffles and deals with the seeded RNG, and returns
 * the game's first event. `reduce(undefined, event)` yields the initial state.
 */
export function initGame(input: GameConfigInput): GameEvent {
  const config: GameConfig = {
    ...input,
    maxRounds: input.maxRounds ?? DEFAULT_MAX_ROUNDS,
    mode: input.mode ?? "classic-trumps",
  };
  validateConfig(config);

  const rng = mulberry32(config.seed);
  const deck = shuffle(
    rng,
    config.cards.map((c) => c.id),
  );

  // Round-robin from seat 0; all cards dealt, earlier seats may get one extra.
  const hands: Record<PlayerId, CardId[]> = {};
  for (const id of config.players) hands[id] = [];
  deck.forEach((cardId, i) => {
    const seat = config.players[i % config.players.length] as PlayerId;
    hands[seat]?.push(cardId);
  });

  const firstLeader = config.players[randomInt(rng, config.players.length)] as PlayerId;

  return { type: "GAME_STARTED", config, firstLeader, hands };
}
