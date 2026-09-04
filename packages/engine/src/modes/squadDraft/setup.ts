/**
 * Squad Draft — setup: config validation, the seeded pool shuffle and the
 * snake order. All the randomness of the draft phase happens here; the
 * matches roll their own form from the seed later (see scoring.ts).
 */
import { InvalidConfigError } from "../../setup.js";
import { mulberry32, shuffle } from "../../rng.js";
import type { PlayerId } from "../../types.js";
import {
  BOWLER_COUNT,
  DEFAULT_FACETS,
  MAX_SQUAD_PLAYERS,
  MIN_SQUAD_PLAYERS,
  NATION_CAP,
  POOL_SPARE,
  SQUAD_DRAFT_MODE,
  SQUAD_SIZE,
  XI_SIZE,
  type Facets,
  type SquadDraftConfig,
  type SquadDraftConfigInput,
  type SquadDraftEvent,
} from "./types.js";

/** How many cards a table of `playerCount` needs in its pool. */
export function squadDraftPoolSize(playerCount: number, squadSize = SQUAD_SIZE): number {
  return squadSize * playerCount + POOL_SPARE;
}

/** The full snake: seat order one round, reversed the next. */
export function snakeOrder(players: readonly PlayerId[], rounds: number): PlayerId[] {
  const order: PlayerId[] = [];
  for (let r = 0; r < rounds; r++) {
    const pass = r % 2 === 0 ? [...players] : [...players].reverse();
    order.push(...pass);
  }
  return order;
}

function validate(config: SquadDraftConfig): void {
  const { players, cards, stats } = config;
  if (players.length < MIN_SQUAD_PLAYERS || players.length > MAX_SQUAD_PLAYERS) {
    throw new InvalidConfigError(
      `player count must be ${MIN_SQUAD_PLAYERS}–${MAX_SQUAD_PLAYERS}, got ${players.length}`,
    );
  }
  if (new Set(players).size !== players.length)
    throw new InvalidConfigError("duplicate player ids");
  if (new Set(cards.map((c) => c.id)).size !== cards.length) {
    throw new InvalidConfigError("duplicate card ids");
  }
  const needed = squadDraftPoolSize(players.length, config.squadSize);
  if (cards.length < needed) {
    throw new InvalidConfigError(
      `need at least ${needed} cards for ${players.length} players, got ${cards.length}`,
    );
  }
  if (stats.length === 0) throw new InvalidConfigError("at least one stat definition required");
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
  if (config.xiSize > config.squadSize) throw new InvalidConfigError("xiSize exceeds squadSize");
  if (config.bowlerCount > config.xiSize)
    throw new InvalidConfigError("bowlerCount exceeds xiSize");
  if (config.nationCap < 1) throw new InvalidConfigError("nationCap must be at least 1");
}

/** Drop facet keys the edition does not define; a facet may end up empty (scores 0). */
function trimFacets(facets: Facets, keys: Set<string>): Facets {
  return {
    batting: facets.batting.filter((k) => keys.has(k)),
    bowling: facets.bowling.filter((k) => keys.has(k)),
    fielding: facets.fielding.filter((k) => keys.has(k)),
  };
}

export function initSquadDraft(input: SquadDraftConfigInput): SquadDraftEvent {
  const config: SquadDraftConfig = {
    mode: SQUAD_DRAFT_MODE,
    players: [...input.players],
    cards: input.cards,
    stats: input.stats,
    seed: input.seed,
    squadSize: input.squadSize ?? SQUAD_SIZE,
    xiSize: input.xiSize ?? XI_SIZE,
    bowlerCount: input.bowlerCount ?? BOWLER_COUNT,
    nationCap: input.nationCap ?? NATION_CAP,
    facets: trimFacets(input.facets ?? DEFAULT_FACETS, new Set(input.stats.map((s) => s.key))),
  };
  validate(config);
  const rng = mulberry32(config.seed);
  const pool = shuffle(
    rng,
    config.cards.map((c) => c.id),
  );
  return {
    type: "GAME_STARTED",
    config,
    pool,
    pickOrder: snakeOrder(config.players, config.squadSize),
  };
}
