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
  type StoredMatch,
  type UserMatchSummary,
  type UserStats,
} from "../store.js";
import { matchEvents, matchPlayers, matches } from "./schema.js";

export class PostgresMatchStore implements MatchStore {
  private readonly pool: pg.Pool;
  private readonly db: NodePgDatabase;

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

    return {
      games: totals?.games ?? 0,
      wins: totals?.wins ?? 0,
      favouriteStat: favourite?.stat ?? null,
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
  }

  async anonymizeUser(userId: string): Promise<void> {
    await this.db
      .update(matchPlayers)
      .set({ userId: null, name: DELETED_PLAYER_NAME })
      .where(eq(matchPlayers.userId, userId));
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Pick the store for this environment: Postgres when configured, else RAM. */
export function createStore(databaseUrl: string | undefined): MatchStore {
  return databaseUrl === undefined ? new InMemoryMatchStore() : new PostgresMatchStore(databaseUrl);
}
