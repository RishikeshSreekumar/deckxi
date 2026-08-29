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
  players: { sessionId: string; name: string; seat: number }[];
}

export interface MatchResult {
  finishedAt: Date;
  winnerSessionId: string;
  endReason: string;
  /** Rounds actually resolved. */
  rounds: number;
}

export interface MatchStore {
  createMatch(record: MatchRecord): Promise<void>;
  appendEvents(matchId: string, events: readonly SeqEvent[]): Promise<void>;
  finishMatch(matchId: string, result: MatchResult): Promise<void>;
  /** Health probe; rejects when the backing store is unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface StoredMatch extends MatchRecord {
  events: SeqEvent[];
  result: MatchResult | null;
}

export class InMemoryMatchStore implements MatchStore {
  readonly matches = new Map<string, StoredMatch>();

  createMatch(record: MatchRecord): Promise<void> {
    this.matches.set(record.matchId, { ...record, events: [], result: null });
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

  ping(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
