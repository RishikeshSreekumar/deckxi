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

/**
 * Player ratings (#80). One row per player per mode per season, where a
 * season is a data edition: a new edition changes what the cards are worth,
 * so carrying ratings across one would score two different games on one
 * ladder.
 */
export const ratings = pgTable(
  "ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    gameMode: text("game_mode").notNull(),
    seasonId: text("season_id").notNull(),
    rating: integer("rating").notNull(),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.gameMode, table.seasonId] })],
);

/**
 * Collection meta (#84): which cards a player has actually won rounds with.
 * Keyed by edition as well as card, because a card id is only unique inside
 * one — and a card you won with in an old edition is a different card now.
 */
export const cardCollection = pgTable(
  "card_collection",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    editionId: text("edition_id").notNull(),
    cardId: text("card_id").notNull(),
    /** Rounds this card took for you. */
    wins: integer("wins").notNull().default(0),
    firstWonAt: timestamp("first_won_at", { withTimezone: true }).notNull().defaultNow(),
    lastWonAt: timestamp("last_won_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.editionId, table.cardId] })],
);

/**
 * The one card a player puts on their profile. Its own table rather than a
 * column on better-auth's `user`, which is generated and should stay theirs.
 */
export const profileShowcase = pgTable("profile_showcase", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  editionId: text("edition_id").notNull(),
  cardId: text("card_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Shareable replays (#83). A finished match is private until a player who sat
 * at it makes a link; the token is what the link carries, so revoking a share
 * is deleting one row and no URL survives it.
 */
export const matchShares = pgTable("match_shares", {
  token: text("token").primaryKey(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  /** Who made the link; null once that account is deleted. */
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Friends (#82). Deliberately one-directional: adding someone is saving them
 * to your own list, not asking their permission. There is nothing to accept,
 * nothing to decline, and no notification to send — the list exists so you
 * can find the people you play with, and the invite link is still the only
 * way into a room.
 */
export const friends = pgTable(
  "friends",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.friendId] })],
);

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
