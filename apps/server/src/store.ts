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

export interface UserStats {
  games: number;
  wins: number;
  /** The stat this user picks most when leading (auto-plays excluded). */
  favouriteStat: string | null;
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

export class InMemoryMatchStore implements MatchStore {
  readonly matches = new Map<string, StoredMatch>();

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
    const statPicks = new Map<string, number>();
    for (const match of this.matches.values()) {
      const me = match.players.find((p) => p.userId === userId);
      if (me === undefined) continue;
      games++;
      if (match.result?.winnerSessionId === me.sessionId) wins++;
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
    return Promise.resolve({ games, wins, favouriteStat });
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
    for (const match of this.matches.values()) {
      for (const player of match.players) {
        if (player.userId === fromUserId) player.userId = toUserId;
      }
    }
    return Promise.resolve();
  }

  anonymizeUser(userId: string): Promise<void> {
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

  ping(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
