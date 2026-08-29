/**
 * Drizzle schema for match persistence. Three tables:
 *  - matches: one row per game (result columns filled on finish)
 *  - match_players: who sat where (session ids until Phase 6 adds users)
 *  - match_events: the full engine event log, one row per event
 */
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey(),
  roomId: uuid("room_id").notNull(),
  roomCode: text("room_code").notNull(),
  editionId: text("edition_id").notNull(),
  gameMode: text("game_mode").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  winnerSessionId: text("winner_session_id"),
  endReason: text("end_reason"),
  rounds: integer("rounds"),
});

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    name: text("name").notNull(),
    seat: integer("seat").notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.sessionId] })],
);

export const matchEvents = pgTable(
  "match_events",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    /** The full engine event, verbatim — replayable server truth. */
    payload: jsonb("payload").notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.seq] })],
);
