/**
 * Postgres-backed MatchStore (Neon in staging/production). Falls back to the
 * in-memory store when DATABASE_URL is unset so dev needs no database.
 */
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import type { SeqEvent } from "../redact.js";
import {
  InMemoryMatchStore,
  type MatchRecord,
  type MatchResult,
  type MatchStore,
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
