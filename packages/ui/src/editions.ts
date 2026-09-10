/**
 * Edition lookup for card display. Game events carry only card ids + raw stat
 * values (that's all the engine needs); names, teams, roles and rarity come
 * from the edition dataset, bundled statically per known edition id.
 */
import { editionSchema, unpackFigures, type Edition, type Player, type Team } from "@deckxi/shared";
import edition2026q3 from "@deckxi/data/editions/edition-2026-q3.json";

const bundled: Record<string, unknown> = {
  "edition-2026-q3": edition2026q3,
};

/**
 * Editions this build can fetch on demand (#143). Only the default one is in
 * the initial payload: a second edition is another 12 kB of gzipped JSON for
 * a deck most sessions never open, and the perf budget is the reason the
 * lobby loads as fast as it does. `ensureEdition` pulls one in when a room,
 * a deck page or a credits page actually names it.
 */
const fetchable: Record<string, () => Promise<{ default: unknown }>> = {
  "edition-wwe-2026-q4": () => import("@deckxi/data/editions/edition-wwe-2026-q4.json"),
};

const listeners = new Set<() => void>();

/** Told when an edition finishes loading, so a screen can render its cards. */
export function subscribeEditions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The editions this build *offers* — what a picker lists. Snapshotted before
 * anything calls `registerEdition`, so a test or visual fixture registered at
 * runtime is resolvable without turning up in the UI as a deck to play.
 */
const OFFERED = [...new Set([...Object.keys(bundled), ...Object.keys(fetchable)])].sort();

export function knownEditionIds(): string[] {
  return [...OFFERED];
}

const loading = new Map<string, Promise<Edition | null>>();

/**
 * The edition, fetching it first if this build has it but has not loaded it.
 * Resolves to null for an id nobody bundled — the card fallback's job.
 */
export async function ensureEdition(editionId: string): Promise<Edition | null> {
  const already = getEdition(editionId);
  if (already !== null) return already;
  const load = fetchable[editionId];
  if (load === undefined) return null;
  const pending =
    loading.get(editionId) ??
    load().then((module) => {
      registerEdition(editionId, module.default);
      const edition = getEdition(editionId);
      for (const listener of listeners) listener();
      return edition;
    });
  loading.set(editionId, pending);
  return await pending;
}

/**
 * Make another edition resolvable at runtime — how the visual-regression
 * build adds the fictional fixture without shipping it to players.
 */
export function registerEdition(id: string, raw: unknown): void {
  bundled[id] = raw;
  cache.delete(id);
}

/** The edition this build labels stats with when no game context exists. */
export const DEFAULT_EDITION_ID = "edition-2026-q3";

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
  if (def?.format === "figures") {
    const figures = unpackFigures(value);
    return figures === null ? "—" : `${figures.wickets}/${figures.runs}`;
  }
  return String(Math.round(value));
}
