/**
 * Postgres-backed MatchStore (Neon in staging/production). Falls back to the
 * in-memory store when DATABASE_URL is unset so dev needs no database.
 */
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SeqEvent } from "../redact.js";
import {
  DELETED_PLAYER_NAME,
  InMemoryMatchStore,
  type MatchListRow,
  type MatchRecord,
  type MatchResult,
  type MatchStore,
  type ModeStats,
  type CollectionRow,
  type RatingRow,
  type RatingUpdate,
  type ShowcaseCard,
  type StoredMatch,
  type UserMatchSummary,
  type UserStats,
} from "../store.js";
import {
  appConfig,
  cardCollection,
  matchEvents,
  matchPlayers,
  matches,
  profileShowcase,
  ratings,
  user,
} from "./schema.js";
import { InMemoryConfigStore, type ConfigStore } from "../ops.js";

export class PostgresMatchStore implements MatchStore {
  private readonly pool: pg.Pool;
  private readonly db: NodePgDatabase;

  /** Exposed so the config store can share this pool. */
  get database(): NodePgDatabase {
    return this.db;
  }

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    this.db = drizzle(this.pool);
  }

  async createMatch(record: MatchRecord): Promise<void> {
    await this.db.insert(matches).values({
      id: record.matchId,
      roomId: record.roomId,
      roomCode: record.roomCode,
      editionId: record.editionId,
      gameMode: record.gameMode,
      startedAt: record.startedAt,
    });
    await this.db.insert(matchPlayers).values(
      record.players.map((p) => ({
        matchId: record.matchId,
        sessionId: p.sessionId,
        userId: p.userId,
        name: p.name,
        seat: p.seat,
      })),
    );
  }

  async appendEvents(matchId: string, events: readonly SeqEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.db.insert(matchEvents).values(
      events.map((e) => ({
        matchId,
        seq: e.seq,
        type: e.event.type,
        payload: e.event,
      })),
    );
  }

  async finishMatch(matchId: string, result: MatchResult): Promise<void> {
    await this.db
      .update(matches)
      .set({
        finishedAt: result.finishedAt,
        winnerSessionId: result.winnerSessionId,
        endReason: result.endReason,
        rounds: result.rounds,
      })
      .where(eq(matches.id, matchId));
  }

  async listUserMatches(userId: string, limit = 50): Promise<UserMatchSummary[]> {
    const mine = await this.db
      .select({
        matchId: matches.id,
        roomCode: matches.roomCode,
        editionId: matches.editionId,
        gameMode: matches.gameMode,
        startedAt: matches.startedAt,
        finishedAt: matches.finishedAt,
        rounds: matches.rounds,
        endReason: matches.endReason,
        winnerSessionId: matches.winnerSessionId,
        mySessionId: matchPlayers.sessionId,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(eq(matchPlayers.userId, userId))
      .orderBy(desc(matches.startedAt))
      .limit(limit);
    if (mine.length === 0) return [];

    const ids = mine.map((m) => m.matchId);
    const everyone = await this.db
      .select({
        matchId: matchPlayers.matchId,
        name: matchPlayers.name,
        userId: matchPlayers.userId,
        seat: matchPlayers.seat,
      })
      .from(matchPlayers)
      .where(inArray(matchPlayers.matchId, ids))
      .orderBy(matchPlayers.seat);

    return mine.map((m) => ({
      matchId: m.matchId,
      roomCode: m.roomCode,
      editionId: m.editionId,
      gameMode: m.gameMode,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      rounds: m.rounds,
      endReason: m.endReason,
      players: everyone
        .filter((p) => p.matchId === m.matchId)
        .map((p) => ({ name: p.name, userId: p.userId })),
      outcome:
        m.finishedAt === null ? "unfinished" : m.winnerSessionId === m.mySessionId ? "won" : "lost",
    }));
  }

  async userStats(userId: string): Promise<UserStats> {
    const [totals] = await this.db
      .select({
        games: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matches.winnerSessionId} = ${matchPlayers.sessionId})::int`,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(eq(matchPlayers.userId, userId));

    const [favourite] = await this.db
      .select({ stat: sql<string>`${matchEvents.payload}->>'stat'` })
      .from(matchEvents)
      .innerJoin(
        matchPlayers,
        and(
          eq(matchPlayers.matchId, matchEvents.matchId),
          sql`${matchPlayers.sessionId} = ${matchEvents.payload}->>'playerId'`,
        ),
      )
      .where(
        and(
          eq(matchPlayers.userId, userId),
          eq(matchEvents.type, "STAT_SELECTED"),
          sql`(${matchEvents.payload}->>'auto')::boolean = false`,
        ),
      )
      .groupBy(sql`${matchEvents.payload}->>'stat'`)
      .orderBy(sql`count(*) desc`)
      .limit(1);

    const perMode = await this.db
      .select({
        mode: matches.gameMode,
        games: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${matches.winnerSessionId} = ${matchPlayers.sessionId})::int`,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(eq(matchPlayers.userId, userId))
      .groupBy(matches.gameMode);
    const byMode: Record<string, ModeStats> = {};
    for (const row of perMode) byMode[row.mode] = { games: row.games, wins: row.wins };

    return {
      games: totals?.games ?? 0,
      wins: totals?.wins ?? 0,
      favouriteStat: favourite?.stat ?? null,
      byMode,
    };
  }

  /** Recent matches across everyone — the replay debugger's picker (#69). */
  async listMatches(limit = 50): Promise<MatchListRow[]> {
    const rows = await this.db
      .select({
        matchId: matches.id,
        roomCode: matches.roomCode,
        editionId: matches.editionId,
        gameMode: matches.gameMode,
        startedAt: matches.startedAt,
        finishedAt: matches.finishedAt,
        rounds: matches.rounds,
        endReason: matches.endReason,
      })
      .from(matches)
      .orderBy(desc(matches.startedAt))
      .limit(limit);
    if (rows.length === 0) return [];

    const names = await this.db
      .select({ matchId: matchPlayers.matchId, name: matchPlayers.name })
      .from(matchPlayers)
      .where(
        inArray(
          matchPlayers.matchId,
          rows.map((r) => r.matchId),
        ),
      )
      .orderBy(matchPlayers.seat);

    return rows.map((row) => ({
      ...row,
      playerNames: names.filter((n) => n.matchId === row.matchId).map((n) => n.name),
    }));
  }

  async getMatch(matchId: string): Promise<StoredMatch | null> {
    const [match] = await this.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (match === undefined) return null;
    const players = await this.db
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(matchPlayers.seat);
    const events = await this.db
      .select({ seq: matchEvents.seq, payload: matchEvents.payload })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(matchEvents.seq);

    return {
      matchId: match.id,
      roomId: match.roomId,
      roomCode: match.roomCode,
      editionId: match.editionId,
      gameMode: match.gameMode,
      startedAt: match.startedAt,
      players: players.map((p) => ({
        sessionId: p.sessionId,
        userId: p.userId,
        name: p.name,
        seat: p.seat,
      })),
      events: events.map((e) => ({ seq: e.seq, event: e.payload as SeqEvent["event"] })),
      result:
        match.finishedAt === null
          ? null
          : {
              finishedAt: match.finishedAt,
              winnerSessionId: match.winnerSessionId ?? "",
              endReason: match.endReason ?? "unknown",
              rounds: match.rounds ?? 0,
            },
    };
  }

  async reassignUser(fromUserId: string, toUserId: string): Promise<void> {
    await this.db
      .update(matchPlayers)
      .set({ userId: toUserId })
      .where(eq(matchPlayers.userId, fromUserId));
    // A guest who signs up keeps the rating they earned as a guest, unless
    // the account already has one for that mode and season — then the
    // account's own history wins and the guest row is dropped.
    await this.db.execute(sql`
      update ratings as r
         set user_id = ${toUserId}
       where r.user_id = ${fromUserId}
         and not exists (
           select 1 from ratings existing
            where existing.user_id = ${toUserId}
              and existing.game_mode = r.game_mode
              and existing.season_id = r.season_id
         )
    `);
    await this.db.delete(ratings).where(eq(ratings.userId, fromUserId));
    // Same shape for the collection: move what does not collide, drop the rest.
    await this.db.execute(sql`
      update card_collection as c
         set user_id = ${toUserId}
       where c.user_id = ${fromUserId}
         and not exists (
           select 1 from card_collection existing
            where existing.user_id = ${toUserId}
              and existing.edition_id = c.edition_id
              and existing.card_id = c.card_id
         )
    `);
    await this.db.delete(cardCollection).where(eq(cardCollection.userId, fromUserId));
    await this.db.execute(sql`
      update profile_showcase set user_id = ${toUserId}
       where user_id = ${fromUserId}
         and not exists (select 1 from profile_showcase where user_id = ${toUserId})
    `);
    await this.db.delete(profileShowcase).where(eq(profileShowcase.userId, fromUserId));
  }

  async anonymizeUser(userId: string): Promise<void> {
    // The ladder row goes with the account — a rating is personal data, and a
    // nameless ghost on a leaderboard helps nobody.
    await this.db.delete(ratings).where(eq(ratings.userId, userId));
    await this.db.delete(cardCollection).where(eq(cardCollection.userId, userId));
    await this.db.delete(profileShowcase).where(eq(profileShowcase.userId, userId));
    await this.db
      .update(matchPlayers)
      .set({ userId: null, name: DELETED_PLAYER_NAME })
      .where(eq(matchPlayers.userId, userId));
  }

  async getRatings(
    userIds: readonly string[],
    gameMode: string,
    seasonId: string,
  ): Promise<RatingRow[]> {
    if (userIds.length === 0) return [];
    return await this.ratingQuery(
      and(
        inArray(ratings.userId, [...userIds]),
        eq(ratings.gameMode, gameMode),
        eq(ratings.seasonId, seasonId),
      ),
    );
  }

  /**
   * One upsert per player. `games`/`wins` are incremented in SQL rather than
   * read-modify-written here: two games finishing at once would otherwise
   * both write the count they read, and one of them would vanish.
   */
  async saveRatings(updates: readonly RatingUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.db
        .insert(ratings)
        .values({
          userId: update.userId,
          gameMode: update.gameMode,
          seasonId: update.seasonId,
          rating: update.rating,
          games: 1,
          wins: update.won ? 1 : 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [ratings.userId, ratings.gameMode, ratings.seasonId],
          set: {
            rating: update.rating,
            games: sql`${ratings.games} + 1`,
            wins: sql`${ratings.wins} + ${update.won ? 1 : 0}`,
            updatedAt: new Date(),
          },
        });
    }
  }

  async leaderboard(gameMode: string, seasonId: string, limit = 50): Promise<RatingRow[]> {
    return await this.ratingQuery(
      and(eq(ratings.gameMode, gameMode), eq(ratings.seasonId, seasonId)),
      limit,
    );
  }

  async userRatings(userId: string): Promise<RatingRow[]> {
    return await this.ratingQuery(eq(ratings.userId, userId));
  }

  /** Ratings joined to their display name, best first. */
  private async ratingQuery(
    where: ReturnType<typeof eq> | undefined,
    limit?: number,
  ): Promise<RatingRow[]> {
    const query = this.db
      .select({
        userId: ratings.userId,
        name: user.name,
        gameMode: ratings.gameMode,
        seasonId: ratings.seasonId,
        rating: ratings.rating,
        games: ratings.games,
        wins: ratings.wins,
      })
      .from(ratings)
      .leftJoin(user, eq(user.id, ratings.userId))
      .where(where)
      .orderBy(desc(ratings.rating), desc(ratings.games));
    const rows = limit === undefined ? await query : await query.limit(limit);
    return rows.map((row) => ({ ...row, name: row.name ?? null }));
  }

  async addCardWins(
    userId: string,
    editionId: string,
    cards: readonly { cardId: string; wins: number }[],
  ): Promise<void> {
    if (cards.length === 0) return;
    const now = new Date();
    for (const card of cards) {
      await this.db
        .insert(cardCollection)
        .values({
          userId,
          editionId,
          cardId: card.cardId,
          wins: card.wins,
          firstWonAt: now,
          lastWonAt: now,
        })
        .onConflictDoUpdate({
          target: [cardCollection.userId, cardCollection.editionId, cardCollection.cardId],
          // Accumulated in SQL: two matches finishing at once would otherwise
          // both write the total they read, and one would vanish.
          set: { wins: sql`${cardCollection.wins} + ${card.wins}`, lastWonAt: now },
        });
    }
  }

  async collection(userId: string): Promise<CollectionRow[]> {
    return await this.db
      .select({
        editionId: cardCollection.editionId,
        cardId: cardCollection.cardId,
        wins: cardCollection.wins,
        firstWonAt: cardCollection.firstWonAt,
        lastWonAt: cardCollection.lastWonAt,
      })
      .from(cardCollection)
      .where(eq(cardCollection.userId, userId))
      .orderBy(desc(cardCollection.wins), cardCollection.cardId);
  }

  async getShowcase(userId: string): Promise<ShowcaseCard | null> {
    const [row] = await this.db
      .select({ editionId: profileShowcase.editionId, cardId: profileShowcase.cardId })
      .from(profileShowcase)
      .where(eq(profileShowcase.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async setShowcase(userId: string, card: ShowcaseCard | null): Promise<void> {
    if (card === null) {
      await this.db.delete(profileShowcase).where(eq(profileShowcase.userId, userId));
      return;
    }
    await this.db
      .insert(profileShowcase)
      .values({ userId, editionId: card.editionId, cardId: card.cardId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: profileShowcase.userId,
        set: { editionId: card.editionId, cardId: card.cardId, updatedAt: new Date() },
      });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Live ops flags (#70). One row, read at boot and written on change — small
 * enough that a table of its own beats any cleverer scheme.
 */
export class PostgresConfigStore implements ConfigStore {
  constructor(private readonly db: NodePgDatabase) {}

  async read(key: string): Promise<unknown> {
    const [row] = await this.db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, key))
      .limit(1);
    return row?.value ?? null;
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(appConfig)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appConfig.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

/** Pick the store for this environment: Postgres when configured, else RAM. */
export function createStore(databaseUrl: string | undefined): MatchStore {
  return databaseUrl === undefined ? new InMemoryMatchStore() : new PostgresMatchStore(databaseUrl);
}

/**
 * Config store for this environment. Shares the match store's pool when there
 * is one — two settings do not deserve a second set of connections against a
 * free-tier database.
 */
export function createConfigStore(store: MatchStore): ConfigStore {
  return store instanceof PostgresMatchStore
    ? new PostgresConfigStore(store.database)
    : new InMemoryConfigStore();
}
