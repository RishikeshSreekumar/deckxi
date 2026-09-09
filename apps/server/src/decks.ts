/**
 * The deck catalogue (#142) — the decks a host can pick, curated by an
 * operator rather than compiled in.
 *
 * **Why runtime.** A deck is content, not code: it is the lever that keeps
 * the game fresh between quarterly editions, and "add a deck" should not be a
 * pull request, a build and a deploy. The four built-in decks stay in code as
 * the defaults every deployment boots with; storage overrides them and adds
 * to them.
 *
 * **Where it lives.** One row in `app_config`, through the same `ConfigStore`
 * the ops flags use. A deck catalogue is a handful of small records that
 * change a few times a quarter and are read on every lobby render — a cached,
 * written-through config row fits it exactly, and a dedicated table would buy
 * per-deck writes nobody needs. It survives a restart, which is the
 * requirement; without a database it still works and simply doesn't.
 *
 * **What a running game sees: nothing.** The cards are drawn and recorded in
 * GAME_STARTED when the game starts, so editing a deck mid-match cannot
 * change the pool under anyone — the same pinning the edition already has.
 */
import { z } from "zod";
import { CURRENT_EDITION_ID, listEditionIds, loadEdition } from "@deckxi/data";
import {
  DECK_ID_PATTERN,
  DEFAULT_DECK_ID,
  MAX_DECK_ID_LENGTH,
  deckPool,
  editionDecks,
  raritySchema,
  sortDecks,
  type DeckDefinition,
  type DeckSummary,
} from "@deckxi/shared";
import { nullLogger, type Logger } from "./logging.js";
import type { ConfigStore } from "./ops.js";

export const CONFIG_KEY = "decks";

/**
 * A deck too small to seat the smallest table is broken in a way that only
 * shows up as a room that will not start, so it is refused at write time.
 * Above that the lobby's own warning ("everyone gets fewer, or pick a bigger
 * deck") is the right place to say it — a curated XI is a legitimate deck.
 */
export const MIN_DECK_CARDS = 6;

export const deckRecordSchema = z.object({
  id: z.string().max(MAX_DECK_ID_LENGTH).regex(DECK_ID_PATTERN),
  /**
   * The edition this deck is for (#143). A deck is a cut of one edition's
   * cards, and "Bowlers' Union" means nothing to a wrestling deck; absent
   * means every edition, which is what a pre-#143 stored row is.
   */
  editionId: z
    .string()
    .regex(/^edition-[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  name: z.string().trim().min(1).max(40),
  blurb: z.string().trim().min(1).max(160),
  // Role ids are the edition's vocabulary (#143), so the wire validates the
  // shape and `validate` checks them against the pinned edition.
  roles: z.array(z.string().regex(DECK_ID_PATTERN)).min(1).optional(),
  rarities: z.array(raritySchema).min(1).optional(),
  cardIds: z.array(z.string()).min(1).optional(),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).max(999).default(0),
});
export type DeckRecord = z.infer<typeof deckRecordSchema>;

const storedSchema = z.object({ decks: z.array(deckRecordSchema) });

/** Everything a create or patch may set; `id` is chosen once and never moves. */
export const deckPatchSchema = deckRecordSchema
  .omit({ id: true })
  .partial()
  // `null` clears a filter back to "matches everything" — a JSON body has no
  // way to say "remove this key", and dropping it would mean "leave it alone".
  .extend({
    roles: z.array(z.string().regex(DECK_ID_PATTERN)).min(1).nullable().optional(),
    rarities: z.array(raritySchema).min(1).nullable().optional(),
  });

export class DeckError extends Error {}

function toRecord(deck: DeckDefinition, editionId: string): DeckRecord {
  return deckRecordSchema.parse({
    id: deck.id,
    editionId,
    name: deck.name,
    blurb: deck.blurb,
    ...(deck.roles !== undefined ? { roles: [...deck.roles] } : {}),
    ...(deck.rarities !== undefined ? { rarities: [...deck.rarities] } : {}),
    ...(deck.cardIds !== undefined ? { cardIds: [...deck.cardIds] } : {}),
    enabled: deck.enabled ?? true,
    sort: deck.sort ?? 0,
  });
}

/**
 * The decks every bundled edition ships with, which is what a deployment
 * boots on before an operator has curated anything.
 */
function shippedDecks(): DeckRecord[] {
  const out: DeckRecord[] = [];
  for (const editionId of listEditionIds()) {
    try {
      for (const deck of editionDecks(loadEdition(editionId))) out.push(toRecord(deck, editionId));
    } catch {
      // An edition that will not load is not this class's problem to report.
    }
  }
  return out;
}

/** A deck is on offer for an edition when it names it, or names none at all. */
function isFor(deck: DeckRecord, editionId: string): boolean {
  return deck.editionId === undefined || deck.editionId === editionId;
}

export class DeckCatalogue {
  private decks: DeckRecord[] = shippedDecks();

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger = nullLogger,
  ) {}

  /**
   * Load the curated catalogue at boot. A corrupt row is ignored rather than
   * fatal: booting on the built-in decks beats not booting.
   */
  async load(): Promise<void> {
    try {
      const stored = await this.store.read(CONFIG_KEY);
      if (stored === null || stored === undefined) return;
      const parsed = storedSchema.safeParse(stored);
      if (parsed.success && parsed.data.decks.length > 0) this.decks = parsed.data.decks;
      else this.log.warn({ event: "decks.invalid" }, "stored decks ignored");
    } catch (error) {
      this.log.error({ event: "decks.load_failed", err: error }, "could not load decks");
    }
  }

  /** Every deck of one edition, retired ones included; the admin console wants the lot. */
  list(editionId: string = CURRENT_EDITION_ID): DeckRecord[] {
    return sortDecks(this.decks.filter((deck) => isFor(deck, editionId))) as DeckRecord[];
  }

  /** The decks a host may pick, as the public catalogue publishes them. */
  catalogue(editionId: string = CURRENT_EDITION_ID): DeckSummary[] {
    return this.list(editionId)
      .filter((deck) => deck.enabled !== false)
      .map((deck) => this.summarise(deck, editionId));
  }

  get(id: string, editionId: string = CURRENT_EDITION_ID): DeckRecord | undefined {
    // An edition's own deck wins over one left untagged by an older write.
    return (
      this.decks.find((deck) => deck.id === id && deck.editionId === editionId) ??
      this.decks.find((deck) => deck.id === id && deck.editionId === undefined)
    );
  }

  /**
   * The deck a room is set to, or the default when its id no longer exists —
   * a deck deleted under a waiting lobby must not make the room unstartable.
   */
  resolve(id: string, editionId: string = CURRENT_EDITION_ID): DeckDefinition {
    const fallback = this.list(editionId)[0] ?? (this.decks[0] as DeckRecord);
    return this.get(id, editionId) ?? this.get(DEFAULT_DECK_ID, editionId) ?? fallback;
  }

  summarise(deck: DeckDefinition, editionId?: string): DeckSummary {
    return {
      id: deck.id,
      name: deck.name,
      blurb: deck.blurb,
      cardCount: this.cardCount(deck, editionId),
      enabled: deck.enabled !== false,
    };
  }

  private cardCount(deck: DeckDefinition, editionId?: string): number {
    try {
      return deckPool(loadEdition(editionId ?? CURRENT_EDITION_ID), deck).length;
    } catch {
      return 0;
    }
  }

  async create(input: unknown, editionId: string = CURRENT_EDITION_ID): Promise<DeckDefinition> {
    const parsed = deckRecordSchema.safeParse({ editionId, ...(input as object) });
    if (!parsed.success) throw new DeckError(parsed.error.issues[0]?.message ?? "invalid deck");
    if (this.get(parsed.data.id, editionId) !== undefined) {
      throw new DeckError(`a deck called ${parsed.data.id} already exists`);
    }
    const deck = this.validate(parsed.data);
    await this.commit([...this.decks, deck]);
    return deck;
  }

  async update(
    id: string,
    patch: unknown,
    editionId: string = CURRENT_EDITION_ID,
  ): Promise<DeckDefinition> {
    const current = this.require(id, editionId);
    const parsed = deckPatchSchema.safeParse(patch);
    if (!parsed.success) throw new DeckError(parsed.error.issues[0]?.message ?? "invalid patch");
    const { roles, rarities, ...rest } = parsed.data;
    // A key the body left out keeps its value; only what was sent is applied.
    const sent = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    ) as Partial<DeckRecord>;
    const next: DeckRecord = { ...current, ...sent };
    // Explicit null clears a filter; an absent key leaves it alone.
    if (roles !== undefined) {
      if (roles === null) delete next.roles;
      else next.roles = roles;
    }
    if (rarities !== undefined) {
      if (rarities === null) delete next.rarities;
      else next.rarities = rarities;
    }
    return await this.replace(this.validate(next));
  }

  /** Explicit membership: the deck becomes exactly these cards, in this order. */
  async setCards(
    id: string,
    cardIds: unknown,
    editionId: string = CURRENT_EDITION_ID,
  ): Promise<DeckDefinition> {
    const current = this.require(id, editionId);
    const parsed = z.array(z.string()).nullable().safeParse(cardIds);
    if (!parsed.success) throw new DeckError("cardIds must be a list of card ids, or null");
    const next: DeckRecord = { ...current };
    // Null hands the deck back to its filters.
    if (parsed.data === null) delete next.cardIds;
    else next.cardIds = parsed.data;
    return await this.replace(this.validate(next));
  }

  async remove(id: string, editionId: string = CURRENT_EDITION_ID): Promise<void> {
    const deck = this.require(id, editionId);
    if (id === DEFAULT_DECK_ID) {
      throw new DeckError(`${DEFAULT_DECK_ID} is the deck every room falls back to`);
    }
    await this.commit(this.decks.filter((d) => d !== deck));
  }

  private require(id: string, editionId: string): DeckRecord {
    const deck = this.get(id, editionId);
    if (deck === undefined) throw new DeckError(`no deck called ${id}`);
    return deck;
  }

  /**
   * Every edit produces a schema-valid, playable deck or is rejected whole —
   * the same discipline the edition editor uses. A deck that cannot seat a
   * game fails at room start, which is the worst possible place to find out.
   */
  private validate(deck: DeckRecord): DeckRecord {
    const edition = loadEdition(deck.editionId ?? CURRENT_EDITION_ID);
    if (deck.cardIds !== undefined) {
      const known = new Set(edition.players.map((p) => p.id));
      const missing = deck.cardIds.filter((id) => !known.has(id));
      if (missing.length > 0) {
        throw new DeckError(`not in ${edition.id}: ${missing.slice(0, 5).join(", ")}`);
      }
      if (new Set(deck.cardIds).size !== deck.cardIds.length) {
        throw new DeckError("the same card is listed twice");
      }
    }
    if (deck.roles !== undefined) {
      const known = new Set(edition.roles.map((r) => r.id));
      const unknown = deck.roles.filter((role) => !known.has(role));
      if (unknown.length > 0) {
        throw new DeckError(`${edition.id} has no role ${unknown.join(", ")}`);
      }
    }
    const count = deckPool(edition, deck).length;
    if (count < MIN_DECK_CARDS) {
      throw new DeckError(`${deck.name} holds ${count} cards; a table needs ${MIN_DECK_CARDS}`);
    }
    return deck;
  }

  private async replace(deck: DeckRecord): Promise<DeckDefinition> {
    await this.commit(
      this.decks.map((d) => (d.id === deck.id && d.editionId === deck.editionId ? deck : d)),
    );
    return deck;
  }

  private async commit(decks: DeckRecord[]): Promise<void> {
    this.decks = decks;
    try {
      await this.store.write(CONFIG_KEY, { decks });
    } catch (error) {
      // The edit stands in memory; it just won't survive a restart. Loud,
      // because an operator who curated a deck deserves to know it didn't stick.
      this.log.error({ event: "decks.save_failed", err: error }, "decks not persisted");
    }
  }
}
