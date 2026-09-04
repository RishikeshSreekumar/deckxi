/**
 * Match persistence: every game's full event log plus a result record, so any
 * match can be reconstructed (replay debugger, match history, disputes).
 *
 * The manager writes through this interface fire-and-forget — a database
 * outage degrades persistence, never gameplay. Postgres implementation in
 * `db/`; the in-memory store backs dev without DATABASE_URL and the tests.
 */
import type { SeqEvent } from "./redact.js";

export interface MatchRecord {
  matchId: string;
  roomId: string;
  roomCode: string;
  editionId: string;
  gameMode: string;
  startedAt: Date;
  players: { sessionId: string; userId: string | null; name: string; seat: number }[];
}

export interface MatchResult {
  finishedAt: Date;
  winnerSessionId: string;
  endReason: string;
  /** Rounds actually resolved. */
  rounds: number;
}

/** One row of a user's match history page. */
export interface UserMatchSummary {
  matchId: string;
  roomCode: string;
  editionId: string;
  gameMode: string;
  startedAt: Date;
  finishedAt: Date | null;
  rounds: number | null;
  endReason: string | null;
  players: { name: string; userId: string | null }[];
  outcome: "won" | "lost" | "unfinished";
}

export interface ModeStats {
  games: number;
  wins: number;
}

export interface UserStats {
  games: number;
  wins: number;
  /** The stat this user picks most when leading (auto-plays excluded). */
  favouriteStat: string | null;
  /** The same tallies split by game mode (Phase 9); modes never played are absent. */
  byMode: Record<string, ModeStats>;
}

/** One row of the admin match list (#69) — enough to pick a replay. */
export interface MatchListRow {
  matchId: string;
  roomCode: string;
  editionId: string;
  gameMode: string;
  startedAt: Date;
  finishedAt: Date | null;
  rounds: number | null;
  endReason: string | null;
  playerNames: string[];
}

/** A player's standing in one mode and season (#80). */
export interface RatingRow {
  userId: string;
  name: string | null;
  gameMode: string;
  seasonId: string;
  rating: number;
  games: number;
  wins: number;
}

/** What a finished match does to one player's rating. */
export interface RatingUpdate {
  userId: string;
  gameMode: string;
  seasonId: string;
  rating: number;
  won: boolean;
}

/** One card in a player's collection (#84). */
export interface CollectionRow {
  editionId: string;
  cardId: string;
  wins: number;
  firstWonAt: Date;
  lastWonAt: Date;
}

/** The card a player shows on their profile; null once they clear it. */
export interface ShowcaseCard {
  editionId: string;
  cardId: string;
}

/** A share link for a finished match (#83). */
export interface MatchShare {
  token: string;
  matchId: string;
  createdBy: string | null;
  createdAt: Date;
}

/** Someone you play with — a friend, or a face from a recent table (#82). */
export interface PlayerSummary {
  userId: string;
  name: string;
  image: string | null;
  /** Recent players only: when you last shared a table. */
  lastPlayedAt?: Date;
  /** True when this player is already on your friends list. */
  isFriend: boolean;
}

export interface MatchStore {
  createMatch(record: MatchRecord): Promise<void>;
  appendEvents(matchId: string, events: readonly SeqEvent[]): Promise<void>;
  finishMatch(matchId: string, result: MatchResult): Promise<void>;
  /** Most recent matches this user played in, newest first. */
  listUserMatches(userId: string, limit?: number): Promise<UserMatchSummary[]>;
  userStats(userId: string): Promise<UserStats>;
  /** Recent matches across everyone, newest first (admin replay list). */
  listMatches(limit?: number): Promise<MatchListRow[]>;
  /** A match with its full, unredacted event log; null when unknown. */
  getMatch(matchId: string): Promise<StoredMatch | null>;
  /** Guest→account upgrade: move all match participation to the new user. */
  reassignUser(fromUserId: string, toUserId: string): Promise<void>;
  /** Account deletion: unlink and scrub the display name from match rows. */
  anonymizeUser(userId: string): Promise<void>;
  /**
   * Ratings for these users in one mode and season. Missing users are simply
   * absent — the caller starts them at the default rather than the store
   * inventing rows for players who have never finished a game.
   */
  getRatings(userIds: readonly string[], gameMode: string, seasonId: string): Promise<RatingRow[]>;
  /** Write a finished match's rating changes; upserts each player's row. */
  saveRatings(updates: readonly RatingUpdate[]): Promise<void>;
  /** The ladder for one mode and season, best first. */
  leaderboard(gameMode: string, seasonId: string, limit?: number): Promise<RatingRow[]>;
  /** Every rating this user holds, for their profile. */
  userRatings(userId: string): Promise<RatingRow[]>;
  /** Add rounds won with these cards; upserts and accumulates. */
  addCardWins(
    userId: string,
    editionId: string,
    cards: readonly { cardId: string; wins: number }[],
  ): Promise<void>;
  /** Everything this user has won a round with, most-won first. */
  collection(userId: string): Promise<CollectionRow[]>;
  /** The card on this user's profile, or null. */
  getShowcase(userId: string): Promise<ShowcaseCard | null>;
  /** Set (or, with null, clear) the profile card. */
  setShowcase(userId: string, card: ShowcaseCard | null): Promise<void>;
  /** Create (or return the existing) share link for a match. */
  shareMatch(matchId: string, token: string, createdBy: string | null): Promise<MatchShare>;
  /** Resolve a share token; null when it never existed or was revoked. */
  getShare(token: string): Promise<MatchShare | null>;
  /** Revoke a share. Only the player who made it may call this. */
  revokeShare(token: string, userId: string): Promise<void>;
  /** Your friends list, alphabetical. */
  listFriends(userId: string): Promise<PlayerSummary[]>;
  /** Save someone to your list. Adding twice is a no-op, not an error. */
  addFriend(userId: string, friendId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  /** Accounts you have shared a table with, most recent first. */
  recentPlayers(userId: string, limit?: number): Promise<PlayerSummary[]>;
  /** Health probe; rejects when the backing store is unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface StoredMatch extends MatchRecord {
  events: SeqEvent[];
  result: MatchResult | null;
}

export const DELETED_PLAYER_NAME = "Departed player";

const HISTORY_LIMIT = 50;
const LEADERBOARD_LIMIT = 50;

const ratingKey = (userId: string, gameMode: string, seasonId: string): string =>
  `${userId}|${gameMode}|${seasonId}`;

export class InMemoryMatchStore implements MatchStore {
  readonly matches = new Map<string, StoredMatch>();
  /** Keyed `userId|mode|season`, mirroring the Postgres primary key. */
  readonly ratings = new Map<string, RatingRow>();
  /** Keyed `userId|editionId|cardId`, mirroring the Postgres primary key. */
  readonly cards = new Map<string, CollectionRow & { userId: string }>();
  readonly showcases = new Map<string, ShowcaseCard>();
  readonly shares = new Map<string, MatchShare>();
  /** `userId` → the accounts they saved. */
  readonly friendships = new Map<string, Set<string>>();

  createMatch(record: MatchRecord): Promise<void> {
    this.matches.set(record.matchId, {
      ...record,
      players: record.players.map((p) => ({ ...p })),
      events: [],
      result: null,
    });
    return Promise.resolve();
  }

  appendEvents(matchId: string, events: readonly SeqEvent[]): Promise<void> {
    this.matches.get(matchId)?.events.push(...events);
    return Promise.resolve();
  }

  finishMatch(matchId: string, result: MatchResult): Promise<void> {
    const match = this.matches.get(matchId);
    if (match !== undefined) match.result = result;
    return Promise.resolve();
  }

  listUserMatches(userId: string, limit = HISTORY_LIMIT): Promise<UserMatchSummary[]> {
    const rows: UserMatchSummary[] = [];
    for (const match of this.matches.values()) {
      const me = match.players.find((p) => p.userId === userId);
      if (me === undefined) continue;
      rows.push({
        matchId: match.matchId,
        roomCode: match.roomCode,
        editionId: match.editionId,
        gameMode: match.gameMode,
        startedAt: match.startedAt,
        finishedAt: match.result?.finishedAt ?? null,
        rounds: match.result?.rounds ?? null,
        endReason: match.result?.endReason ?? null,
        players: match.players.map((p) => ({ name: p.name, userId: p.userId })),
        outcome:
          match.result === null
            ? "unfinished"
            : match.result.winnerSessionId === me.sessionId
              ? "won"
              : "lost",
      });
    }
    rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return Promise.resolve(rows.slice(0, limit));
  }

  userStats(userId: string): Promise<UserStats> {
    let games = 0;
    let wins = 0;
    const byMode: Record<string, ModeStats> = {};
    const statPicks = new Map<string, number>();
    for (const match of this.matches.values()) {
      const me = match.players.find((p) => p.userId === userId);
      if (me === undefined) continue;
      games++;
      const won = match.result?.winnerSessionId === me.sessionId;
      if (won) wins++;
      const mode = (byMode[match.gameMode] ??= { games: 0, wins: 0 });
      mode.games++;
      if (won) mode.wins++;
      for (const { event } of match.events) {
        if (event.type === "STAT_SELECTED" && event.playerId === me.sessionId && !event.auto) {
          statPicks.set(event.stat, (statPicks.get(event.stat) ?? 0) + 1);
        }
      }
    }
    let favouriteStat: string | null = null;
    let best = 0;
    for (const [stat, count] of statPicks) {
      if (count > best) {
        best = count;
        favouriteStat = stat;
      }
    }
    return Promise.resolve({ games, wins, favouriteStat, byMode });
  }

  listMatches(limit = HISTORY_LIMIT): Promise<MatchListRow[]> {
    const rows = [...this.matches.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((match) => ({
        matchId: match.matchId,
        roomCode: match.roomCode,
        editionId: match.editionId,
        gameMode: match.gameMode,
        startedAt: match.startedAt,
        finishedAt: match.result?.finishedAt ?? null,
        rounds: match.result?.rounds ?? null,
        endReason: match.result?.endReason ?? null,
        playerNames: match.players.map((p) => p.name),
      }));
    return Promise.resolve(rows);
  }

  getMatch(matchId: string): Promise<StoredMatch | null> {
    return Promise.resolve(this.matches.get(matchId) ?? null);
  }

  reassignUser(fromUserId: string, toUserId: string): Promise<void> {
    for (const [key, row] of this.cards) {
      if (row.userId !== fromUserId) continue;
      this.cards.delete(key);
      this.cards.set(`${toUserId}|${row.editionId}|${row.cardId}`, { ...row, userId: toUserId });
    }
    const showcase = this.showcases.get(fromUserId);
    if (showcase !== undefined && !this.showcases.has(toUserId)) {
      this.showcases.set(toUserId, showcase);
    }
    this.showcases.delete(fromUserId);
    for (const [key, row] of this.ratings) {
      if (row.userId !== fromUserId) continue;
      this.ratings.delete(key);
      this.ratings.set(ratingKey(toUserId, row.gameMode, row.seasonId), {
        ...row,
        userId: toUserId,
      });
    }
    for (const match of this.matches.values()) {
      for (const player of match.players) {
        if (player.userId === fromUserId) player.userId = toUserId;
      }
    }
    return Promise.resolve();
  }

  anonymizeUser(userId: string): Promise<void> {
    // A rating is personal data like any other: deleting the account deletes
    // the ladder entry rather than leaving a nameless ghost on it. The same
    // goes for a collection, which is a record of what someone played.
    for (const [key, row] of this.ratings) {
      if (row.userId === userId) this.ratings.delete(key);
    }
    for (const [key, row] of this.cards) {
      if (row.userId === userId) this.cards.delete(key);
    }
    this.showcases.delete(userId);
    // Both directions: your list goes, and you leave everyone else's.
    this.friendships.delete(userId);
    for (const set of this.friendships.values()) set.delete(userId);
    for (const match of this.matches.values()) {
      for (const player of match.players) {
        if (player.userId === userId) {
          player.userId = null;
          player.name = DELETED_PLAYER_NAME;
        }
      }
    }
    return Promise.resolve();
  }

  getRatings(userIds: readonly string[], gameMode: string, seasonId: string): Promise<RatingRow[]> {
    const rows = userIds
      .map((userId) => this.ratings.get(ratingKey(userId, gameMode, seasonId)))
      .filter((row): row is RatingRow => row !== undefined);
    return Promise.resolve(rows);
  }

  saveRatings(updates: readonly RatingUpdate[]): Promise<void> {
    for (const update of updates) {
      const key = ratingKey(update.userId, update.gameMode, update.seasonId);
      const existing = this.ratings.get(key);
      this.ratings.set(key, {
        userId: update.userId,
        name: existing?.name ?? this.nameOf(update.userId),
        gameMode: update.gameMode,
        seasonId: update.seasonId,
        rating: update.rating,
        games: (existing?.games ?? 0) + 1,
        wins: (existing?.wins ?? 0) + (update.won ? 1 : 0),
      });
    }
    return Promise.resolve();
  }

  leaderboard(gameMode: string, seasonId: string, limit = LEADERBOARD_LIMIT): Promise<RatingRow[]> {
    const rows = [...this.ratings.values()]
      .filter((row) => row.gameMode === gameMode && row.seasonId === seasonId)
      .sort((a, b) => b.rating - a.rating || b.games - a.games)
      .slice(0, limit);
    return Promise.resolve(rows);
  }

  userRatings(userId: string): Promise<RatingRow[]> {
    return Promise.resolve([...this.ratings.values()].filter((row) => row.userId === userId));
  }

  /** Best-effort display name from the matches this user has played. */
  private nameOf(userId: string): string | null {
    for (const match of this.matches.values()) {
      const seat = match.players.find((p) => p.userId === userId);
      if (seat !== undefined) return seat.name;
    }
    return null;
  }

  addCardWins(
    userId: string,
    editionId: string,
    cards: readonly { cardId: string; wins: number }[],
  ): Promise<void> {
    const now = new Date();
    for (const card of cards) {
      const key = `${userId}|${editionId}|${card.cardId}`;
      const existing = this.cards.get(key);
      this.cards.set(key, {
        userId,
        editionId,
        cardId: card.cardId,
        wins: (existing?.wins ?? 0) + card.wins,
        firstWonAt: existing?.firstWonAt ?? now,
        lastWonAt: now,
      });
    }
    return Promise.resolve();
  }

  collection(userId: string): Promise<CollectionRow[]> {
    const rows = [...this.cards.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.wins - a.wins || a.cardId.localeCompare(b.cardId))
      .map(({ editionId, cardId, wins, firstWonAt, lastWonAt }) => ({
        editionId,
        cardId,
        wins,
        firstWonAt,
        lastWonAt,
      }));
    return Promise.resolve(rows);
  }

  getShowcase(userId: string): Promise<ShowcaseCard | null> {
    return Promise.resolve(this.showcases.get(userId) ?? null);
  }

  setShowcase(userId: string, card: ShowcaseCard | null): Promise<void> {
    if (card === null) this.showcases.delete(userId);
    else this.showcases.set(userId, card);
    return Promise.resolve();
  }

  shareMatch(matchId: string, token: string, createdBy: string | null): Promise<MatchShare> {
    // One link per match per player: sharing twice should hand back the link
    // already in someone's chat thread, not orphan it.
    for (const share of this.shares.values()) {
      if (share.matchId === matchId && share.createdBy === createdBy) return Promise.resolve(share);
    }
    const share: MatchShare = { token, matchId, createdBy, createdAt: new Date() };
    this.shares.set(token, share);
    return Promise.resolve(share);
  }

  getShare(token: string): Promise<MatchShare | null> {
    return Promise.resolve(this.shares.get(token) ?? null);
  }

  revokeShare(token: string, userId: string): Promise<void> {
    const share = this.shares.get(token);
    if (share?.createdBy === userId) this.shares.delete(token);
    return Promise.resolve();
  }

  listFriends(userId: string): Promise<PlayerSummary[]> {
    const ids = [...(this.friendships.get(userId) ?? [])];
    const rows = ids
      .map((friendId) => ({
        userId: friendId,
        name: this.nameOf(friendId) ?? "Someone",
        image: null,
        isFriend: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return Promise.resolve(rows);
  }

  addFriend(userId: string, friendId: string): Promise<void> {
    const set = this.friendships.get(userId) ?? new Set<string>();
    set.add(friendId);
    this.friendships.set(userId, set);
    return Promise.resolve();
  }

  removeFriend(userId: string, friendId: string): Promise<void> {
    this.friendships.get(userId)?.delete(friendId);
    return Promise.resolve();
  }

  recentPlayers(userId: string, limit = 20): Promise<PlayerSummary[]> {
    const friends = this.friendships.get(userId) ?? new Set<string>();
    const seen = new Map<string, { name: string; lastPlayedAt: Date }>();
    const matches = [...this.matches.values()].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    );
    for (const match of matches) {
      if (!match.players.some((p) => p.userId === userId)) continue;
      for (const player of match.players) {
        if (player.userId === null || player.userId === userId) continue;
        if (!seen.has(player.userId)) {
          seen.set(player.userId, { name: player.name, lastPlayedAt: match.startedAt });
        }
      }
    }
    const rows = [...seen].slice(0, limit).map(([id, { name, lastPlayedAt }]) => ({
      userId: id,
      name,
      image: null,
      lastPlayedAt,
      isFriend: friends.has(id),
    }));
    return Promise.resolve(rows);
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
