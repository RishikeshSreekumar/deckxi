/**
 * Edition lookup for card display. Game events carry only card ids + raw stat
 * values (that's all the engine needs); names, teams, roles and rarity come
 * from the edition dataset, bundled statically per known edition id.
 */
import { editionSchema, type Edition, type Player, type Team } from "@deckxi/shared";
import edition2026q3 from "@deckxi/data/editions/edition-2026-q3.json";

const bundled: Record<string, unknown> = {
  "edition-2026-q3": edition2026q3,
};

const cache = new Map<string, Edition | null>();

/** Load a bundled edition; null when this client doesn't know the id. */
export function getEdition(editionId: string): Edition | null {
  const cached = cache.get(editionId);
  if (cached !== undefined) return cached;
  const raw = bundled[editionId];
  const edition = raw === undefined ? null : editionSchema.parse(raw);
  cache.set(editionId, edition);
  return edition;
}

export interface CardInfo {
  player: Player | null;
  team: Team | null;
}

/** Resolve a card id to its player + team; nulls when unknown to this build. */
export function getCardInfo(editionId: string, cardId: string): CardInfo {
  const edition = getEdition(editionId);
  const player = edition?.players.find((p) => p.id === cardId) ?? null;
  const team =
    player === null ? null : (edition?.teams.find((t) => t.id === player.teamId) ?? null);
  return { player, team };
}

/** Display name for a stat key, falling back to the raw key. */
export function statName(editionId: string, key: string): string {
  const edition = getEdition(editionId);
  return edition?.stats.find((s) => s.key === key)?.name ?? key;
}

export function formatStatValue(editionId: string, key: string, value: number): string {
  const def = getEdition(editionId)?.stats.find((s) => s.key === key);
  if (def?.format === "decimal") return value.toFixed(2);
  return String(Math.round(value));
}
