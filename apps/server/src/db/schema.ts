/**
 * Drizzle schema for match persistence. Three tables:
 *  - matches: one row per game (result columns filled on finish)
 *  - match_players: who sat where (room session ids, plus the user behind them)
 *  - match_events: the full engine event log, one row per event
 *
 * Plus app_config: the handful of settings an operator changes on a running
 * server (#70), where a redeploy would be the wrong tool because a redeploy
 * ends every live game.
 */
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export * from "./auth-schema.js";

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
    /** The account behind the seat; null for pre-auth guests and bots. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
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

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
