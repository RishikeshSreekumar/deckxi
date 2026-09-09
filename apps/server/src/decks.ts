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
import { loadEdition } from "@deckxi/data";
import {
  BUILT_IN_DECKS,
  DECK_ID_PATTERN,
  DEFAULT_DECK_ID,
  MAX_DECK_ID_LENGTH,
  deckPool,
  playerRoleSchema,
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
  name: z.string().trim().min(1).max(40),
  blurb: z.string().trim().min(1).max(160),
  roles: z.array(playerRoleSchema).min(1).optional(),
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
    roles: z.array(playerRoleSchema).min(1).nullable().optional(),
    rarities: z.array(raritySchema).min(1).nullable().optional(),
  });

export class DeckError extends Error {}

function toRecord(deck: DeckDefinition): DeckRecord {
  return deckRecordSchema.parse({
    id: deck.id,
    name: deck.name,
    blurb: deck.blurb,
    ...(deck.roles !== undefined ? { roles: [...deck.roles] } : {}),
    ...(deck.rarities !== undefined ? { rarities: [...deck.rarities] } : {}),
    ...(deck.cardIds !== undefined ? { cardIds: [...deck.cardIds] } : {}),
    enabled: deck.enabled ?? true,
    sort: deck.sort ?? 0,
  });
}

export class DeckCatalogue {
  private decks: DeckRecord[] = BUILT_IN_DECKS.map(toRecord);

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

  /** Every deck, retired ones included; the admin console wants the lot. */
  list(): DeckDefinition[] {
    return sortDecks(this.decks);
  }

  /** The decks a host may pick, as the public catalogue publishes them. */
  catalogue(): DeckSummary[] {
    return this.list()
      .filter((deck) => deck.enabled !== false)
      .map((deck) => this.summarise(deck));
  }

  get(id: string): DeckDefinition | undefined {
    return this.decks.find((deck) => deck.id === id);
  }

  /**
   * The deck a room is set to, or the default when its id no longer exists —
   * a deck deleted under a waiting lobby must not make the room unstartable.
   */
  resolve(id: string): DeckDefinition {
    return this.get(id) ?? this.get(DEFAULT_DECK_ID) ?? (this.decks[0] as DeckRecord);
  }

  summarise(deck: DeckDefinition): DeckSummary {
    return {
      id: deck.id,
      name: deck.name,
      blurb: deck.blurb,
      cardCount: this.cardCount(deck),
      enabled: deck.enabled !== false,
    };
  }

  private cardCount(deck: DeckDefinition): number {
    try {
      return deckPool(loadEdition(), deck).length;
    } catch {
      return 0;
    }
  }

  async create(input: unknown): Promise<DeckDefinition> {
    const parsed = deckRecordSchema.safeParse(input);
    if (!parsed.success) throw new DeckError(parsed.error.issues[0]?.message ?? "invalid deck");
    if (this.get(parsed.data.id) !== undefined) {
      throw new DeckError(`a deck called ${parsed.data.id} already exists`);
    }
    const deck = this.validate(parsed.data);
    await this.commit([...this.decks, deck]);
    return deck;
  }

  async update(id: string, patch: unknown): Promise<DeckDefinition> {
    const current = this.require(id);
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
  async setCards(id: string, cardIds: unknown): Promise<DeckDefinition> {
    const current = this.require(id);
    const parsed = z.array(z.string()).nullable().safeParse(cardIds);
    if (!parsed.success) throw new DeckError("cardIds must be a list of card ids, or null");
    const next: DeckRecord = { ...current };
    // Null hands the deck back to its filters.
    if (parsed.data === null) delete next.cardIds;
    else next.cardIds = parsed.data;
    return await this.replace(this.validate(next));
  }

  async remove(id: string): Promise<void> {
    this.require(id);
    if (id === DEFAULT_DECK_ID) {
      throw new DeckError(`${DEFAULT_DECK_ID} is the deck every room falls back to`);
    }
    await this.commit(this.decks.filter((deck) => deck.id !== id));
  }

  private require(id: string): DeckRecord {
    const deck = this.decks.find((d) => d.id === id);
    if (deck === undefined) throw new DeckError(`no deck called ${id}`);
    return deck;
  }

  /**
   * Every edit produces a schema-valid, playable deck or is rejected whole —
   * the same discipline the edition editor uses. A deck that cannot seat a
   * game fails at room start, which is the worst possible place to find out.
   */
  private validate(deck: DeckRecord): DeckRecord {
    const edition = loadEdition();
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
    const count = deckPool(edition, deck).length;
    if (count < MIN_DECK_CARDS) {
      throw new DeckError(`${deck.name} holds ${count} cards; a table needs ${MIN_DECK_CARDS}`);
    }
    return deck;
  }

  private async replace(deck: DeckRecord): Promise<DeckDefinition> {
    await this.commit(this.decks.map((d) => (d.id === deck.id ? deck : d)));
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
