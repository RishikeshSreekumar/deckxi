/**
 * Curation operations behind the admin CLI. Every operation returns a new,
 * schema-validated edition with a bumped version and fresh derived ratings —
 * hand edits can never produce an invalid dataset.
 */
import { editionSchema, type Edition, type Player, type Rarity } from "@deckxi/shared";
import { computeRating, regenerateRatings } from "./rating.js";

function finalize(edition: Edition, players: Player[]): Edition {
  const next: Edition = {
    ...edition,
    version: edition.version + 1,
    players: regenerateRatings(players, edition.stats),
  };
  const parsed = editionSchema.safeParse(next);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new Error(`edit rejected — edition would be invalid:\n${issues}`);
  }
  return parsed.data;
}

function requirePlayer(edition: Edition, playerId: string): Player {
  const player = edition.players.find((p) => p.id === playerId);
  if (player === undefined) throw new Error(`no such player: ${playerId}`);
  return player;
}

export function setPlayerStat(
  edition: Edition,
  playerId: string,
  statKey: string,
  value: number,
): Edition {
  requirePlayer(edition, playerId);
  const def = edition.stats.find((s) => s.key === statKey);
  if (def === undefined) throw new Error(`no such stat: ${statKey}`);
  return finalize(
    edition,
    edition.players.map((p) =>
      p.id === playerId ? { ...p, stats: { ...p.stats, [statKey]: value } } : p,
    ),
  );
}

export function setPlayerRarity(edition: Edition, playerId: string, rarity: Rarity): Edition {
  requirePlayer(edition, playerId);
  return finalize(
    edition,
    edition.players.map((p) => (p.id === playerId ? { ...p, rarity } : p)),
  );
}

/** Add a player; `rating` is derived, so the input omits it. */
export function addPlayer(edition: Edition, input: Omit<Player, "rating">): Edition {
  if (edition.players.some((p) => p.id === input.id)) {
    throw new Error(`player ${input.id} already exists`);
  }
  const player: Player = {
    ...input,
    rating: computeRating({ ...input, rating: 0 }, edition.stats),
  };
  return finalize(edition, [...edition.players, player]);
}

export function removePlayer(edition: Edition, playerId: string): Edition {
  requirePlayer(edition, playerId);
  return finalize(
    edition,
    edition.players.filter((p) => p.id !== playerId),
  );
}

/** Re-derive every rating (e.g. after changing the rating formula). */
export function regenAllRatings(edition: Edition): Edition {
  return finalize(edition, [...edition.players]);
}
