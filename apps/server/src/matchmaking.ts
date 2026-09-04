/**
 * Quick match (#81).
 *
 * The room-code flow assumes you already have people to play with. Quick match
 * is for when you do not: one tap, and either the server pairs you with
 * whoever else is waiting or — after a short wait — it fills the table with
 * bots and starts anyway.
 *
 * The backfill is the important half. A queue that can leave someone waiting
 * indefinitely is worse than no queue: the honest promise is "you will be
 * playing in a few seconds", and the engine's baseline bot is what keeps it
 * when nobody else is around.
 *
 * Deliberately in-memory and per-process: matchmaking across instances needs
 * the shared state #86 is about, and a queue that silently paired players on
 * different machines would produce rooms nobody could reach.
 */
import type { GameModeId } from "@deckxi/shared";

/** How long we look for a human before filling the table with bots. */
export const DEFAULT_BOT_WAIT_MS = 12_000;

export interface QueueEntry<T> {
  /** Whatever the transport needs to seat this player (a socket, in practice). */
  client: T;
  joinedAt: number;
}

export interface MatchmakerOptions {
  botWaitMs?: number;
  /** Seats a mode needs before a game can start. */
  minPlayers: (mode: GameModeId) => number;
  /** Table size quick match aims for; smaller games start faster. */
  targetPlayers?: number;
  /** Injected by tests. */
  now?: () => number;
}

export interface Pairing<T> {
  mode: GameModeId;
  clients: T[];
  /** How many bot seats to add so the table can start. */
  bots: number;
}

/**
 * The queue itself: pure bookkeeping. It never touches rooms or sockets — the
 * caller asks it what to do (`take`) and does it. That keeps the waiting rules
 * testable without a server, and means the socket layer holds no policy.
 */
export class Matchmaker<T> {
  private readonly queues = new Map<GameModeId, QueueEntry<T>[]>();
  private readonly botWaitMs: number;
  private readonly targetPlayers: number;
  private readonly now: () => number;

  constructor(private readonly options: MatchmakerOptions) {
    this.botWaitMs = options.botWaitMs ?? DEFAULT_BOT_WAIT_MS;
    this.targetPlayers = options.targetPlayers ?? 2;
    this.now = options.now ?? Date.now;
  }

  /** Everyone waiting in one mode, oldest first. */
  waiting(mode: GameModeId): readonly QueueEntry<T>[] {
    return this.queues.get(mode) ?? [];
  }

  size(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }

  join(mode: GameModeId, client: T): void {
    this.leave(client);
    const queue = this.queues.get(mode) ?? [];
    queue.push({ client, joinedAt: this.now() });
    this.queues.set(mode, queue);
  }

  /** Remove a client from whichever queue holds it. Safe to call twice. */
  leave(client: T): boolean {
    for (const [mode, queue] of this.queues) {
      const index = queue.findIndex((entry) => entry.client === client);
      if (index === -1) continue;
      queue.splice(index, 1);
      if (queue.length === 0) this.queues.delete(mode);
      return true;
    }
    return false;
  }

  /**
   * The next table to make, or null when everyone waiting should keep
   * waiting. Called on every join and on a tick, so the two paths — "enough
   * humans turned up" and "we waited long enough, bring bots" — are the same
   * decision made with different inputs.
   */
  take(mode: GameModeId): Pairing<T> | null {
    const queue = this.queues.get(mode);
    if (queue === undefined || queue.length === 0) return null;
    const min = this.options.minPlayers(mode);
    const target = Math.max(min, this.targetPlayers);

    if (queue.length >= target) {
      const clients = queue.splice(0, target).map((entry) => entry.client);
      if (queue.length === 0) this.queues.delete(mode);
      return { mode, clients, bots: 0 };
    }

    // Nobody else came. The oldest entry decides: once it has waited out the
    // threshold, everyone in this queue plays together and bots fill the rest.
    const oldest = queue[0];
    if (oldest === undefined || this.now() - oldest.joinedAt < this.botWaitMs) return null;
    const clients = queue.splice(0).map((entry) => entry.client);
    this.queues.delete(mode);
    return { mode, clients, bots: Math.max(0, min - clients.length) };
  }

  /** Every table ready right now, across modes. Used by the tick. */
  takeAll(): Pairing<T>[] {
    const pairings: Pairing<T>[] = [];
    for (const mode of [...this.queues.keys()]) {
      for (;;) {
        const pairing = this.take(mode);
        if (pairing === null) break;
        pairings.push(pairing);
      }
    }
    return pairings;
  }
}
