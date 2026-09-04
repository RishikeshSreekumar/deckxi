/**
 * Multi-instance readiness (#86).
 *
 * Rooms are authoritative in-process objects: a `RoomManager` holds the state,
 * the timers and the event log, and every rule in the game assumes it can act
 * on that state synchronously. Externalising all of it into Redis would mean
 * re-deriving state per command behind a lock, which is a different (and much
 * more fragile) server than the one we have.
 *
 * So a room stays owned by the instance that created it, and the cluster is
 * made of two small pieces instead:
 *
 *   - a **directory**, so any instance can answer "who owns join code ABC123"
 *     and so two instances cannot mint the same code;
 *   - a **bus**, so an instance that is *not* the owner can forward a player's
 *     message to the one that is, and so an owner can push events back to a
 *     socket connected elsewhere.
 *
 * That is the actor model, and it keeps the property the game depends on:
 * exactly one process ever decides what a room does. The cost is one network
 * hop for players who happen to land on the wrong instance — which sticky
 * routing, where the platform offers it, avoids entirely.
 *
 * Everything here has an in-memory implementation used by tests and by the
 * single-instance default. Without `REDIS_URL` nothing in this file changes
 * how the server behaves.
 */
import { randomUUID } from "node:crypto";

/** Who owns a room. */
export interface RoomLocation {
  roomId: string;
  code: string;
  instanceId: string;
}

export interface RoomDirectory {
  /** Claim a code for this instance. False when another instance holds it. */
  register(location: RoomLocation): Promise<boolean>;
  lookupByCode(code: string): Promise<RoomLocation | null>;
  lookupByRoom(roomId: string): Promise<RoomLocation | null>;
  unregister(roomId: string): Promise<void>;
  /** Codes this instance holds, so a restart can clean up after itself. */
  close(): Promise<void>;
}

/** A message forwarded between instances. */
export type BusMessage =
  | {
      kind: "command";
      /** The room's owner handles this. */
      sessionId: string;
      event: string;
      payload: unknown;
    }
  | {
      kind: "join";
      code: string;
      name: string;
      spectator: boolean;
      userId: string | null;
      /** Where to send this session's events afterwards. */
      socketId: string;
      originInstance: string;
    }
  | {
      kind: "resume";
      roomId: string;
      resumeToken: string;
      socketId: string;
      originInstance: string;
    }
  | { kind: "disconnect"; sessionId: string }
  | {
      /** Owner → the instance holding the socket: deliver this event. */
      kind: "emit";
      socketId: string;
      event: string;
      args: unknown[];
    };

export interface BusReply {
  ok: boolean;
  /** Present when ok; the shape depends on the message. */
  data?: unknown;
  /** An `ErrorCode` when the owner rejected the message. */
  code?: string;
  message?: string;
}

export interface MessageBus {
  /** Send to one instance and wait for its reply. */
  request(instanceId: string, message: BusMessage): Promise<BusReply>;
  /** Register this instance's handler. One per bus. */
  handle(instanceId: string, handler: (message: BusMessage) => Promise<BusReply>): void;
  close(): Promise<void>;
}

/** This process's identity in the cluster. Stable for its lifetime. */
export function instanceId(): string {
  // Cloud Run gives every revision instance a name; falling back to a UUID
  // keeps local runs and tests distinct from each other.
  return process.env["INSTANCE_ID"] ?? process.env["K_REVISION"] ?? `local-${randomUUID()}`;
}

/**
 * Single-instance directory: correct, and exactly as useful as the deployment
 * it runs in. The Redis one has the same shape with a TTL.
 */
export class InMemoryRoomDirectory implements RoomDirectory {
  private readonly byCode = new Map<string, RoomLocation>();
  private readonly byRoom = new Map<string, RoomLocation>();

  register(location: RoomLocation): Promise<boolean> {
    const existing = this.byCode.get(location.code);
    if (existing !== undefined && existing.roomId !== location.roomId)
      return Promise.resolve(false);
    this.byCode.set(location.code, location);
    this.byRoom.set(location.roomId, location);
    return Promise.resolve(true);
  }

  lookupByCode(code: string): Promise<RoomLocation | null> {
    return Promise.resolve(this.byCode.get(code) ?? null);
  }

  lookupByRoom(roomId: string): Promise<RoomLocation | null> {
    return Promise.resolve(this.byRoom.get(roomId) ?? null);
  }

  unregister(roomId: string): Promise<void> {
    const location = this.byRoom.get(roomId);
    if (location !== undefined) {
      this.byRoom.delete(roomId);
      this.byCode.delete(location.code);
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * An in-process bus. Two servers built in one test share one of these and
 * behave exactly as two processes sharing Redis would — which is the only way
 * the forwarding path gets tested without standing up a broker in CI.
 */
export class InMemoryMessageBus implements MessageBus {
  private readonly handlers = new Map<string, (message: BusMessage) => Promise<BusReply>>();

  handle(id: string, handler: (message: BusMessage) => Promise<BusReply>): void {
    this.handlers.set(id, handler);
  }

  async request(id: string, message: BusMessage): Promise<BusReply> {
    const handler = this.handlers.get(id);
    // An instance that has gone away is the same answer as a room that has:
    // whatever the player was reaching for is not there any more.
    if (handler === undefined)
      return { ok: false, code: "room-not-found", message: "instance gone" };
    return await handler(message);
  }

  close(): Promise<void> {
    this.handlers.clear();
    return Promise.resolve();
  }
}

export interface Cluster {
  id: string;
  directory: RoomDirectory;
  bus: MessageBus;
}

/** The default: one instance, talking to nobody. */
export function localCluster(id = instanceId()): Cluster {
  return { id, directory: new InMemoryRoomDirectory(), bus: new InMemoryMessageBus() };
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

/**
 * The slice of a Redis client this file needs. Typed structurally so the
 * `redis` package is a runtime detail and the tests can hand in a fake.
 */
export interface RedisLike {
  set(key: string, value: string, options?: { NX?: boolean; EX?: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string | string[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe?(channel: string): Promise<unknown>;
  duplicate(): RedisLike;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
}

const CODE_KEY = (code: string): string => `deckxi:room:code:${code}`;
const ROOM_KEY = (roomId: string): string => `deckxi:room:id:${roomId}`;

/** A room registration lives this long; the owner refreshes it while it runs. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

/**
 * Redis-backed directory. `SET NX` is what makes a join code unique across the
 * cluster: whoever claims it first owns it, and a second instance that minted
 * the same code learns immediately rather than at the moment a player is sent
 * to the wrong table.
 *
 * Entries expire. A crashed instance's rooms are gone anyway — its state was
 * in its heap — so a stale pointer that outlived the process would send
 * players to a machine that would only tell them the room does not exist.
 */
export class RedisRoomDirectory implements RoomDirectory {
  constructor(private readonly redis: RedisLike) {}

  async register(location: RoomLocation): Promise<boolean> {
    const value = JSON.stringify(location);
    const claimed = await this.redis.set(CODE_KEY(location.code), value, {
      NX: true,
      EX: ROOM_TTL_SECONDS,
    });
    if (claimed === null) {
      const existing = await this.lookupByCode(location.code);
      // Re-registering our own room (a refresh) is fine; someone else's is not.
      if (existing?.roomId !== location.roomId) return false;
    }
    await this.redis.set(ROOM_KEY(location.roomId), value, { EX: ROOM_TTL_SECONDS });
    return true;
  }

  async lookupByCode(code: string): Promise<RoomLocation | null> {
    return parse(await this.redis.get(CODE_KEY(code)));
  }

  async lookupByRoom(roomId: string): Promise<RoomLocation | null> {
    return parse(await this.redis.get(ROOM_KEY(roomId)));
  }

  async unregister(roomId: string): Promise<void> {
    const location = await this.lookupByRoom(roomId);
    if (location === null) return;
    await this.redis.del([CODE_KEY(location.code), ROOM_KEY(roomId)]);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

function parse(raw: string | null): RoomLocation | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as RoomLocation;
  } catch {
    return null;
  }
}

interface Envelope {
  id: string;
  replyTo?: string;
  message?: BusMessage;
  reply?: BusReply;
}

/**
 * Request/reply over Redis pub-sub. Each instance subscribes to its own
 * channel; a request carries the channel to answer on.
 *
 * Timeouts are the important part: an instance that has died mid-request must
 * not leave a player's tap hanging, and "the room is gone" is both the honest
 * answer and the one the client already knows how to show.
 */
export class RedisMessageBus implements MessageBus {
  private readonly pending = new Map<string, (reply: BusReply) => void>();
  private subscriber: RedisLike | null = null;
  private handler: ((message: BusMessage) => Promise<BusReply>) | null = null;
  private selfId = "";

  constructor(
    private readonly redis: RedisLike,
    private readonly timeoutMs = 5000,
  ) {}

  handle(id: string, handler: (message: BusMessage) => Promise<BusReply>): void {
    this.selfId = id;
    this.handler = handler;
    void this.listen(channel(id));
    void this.listen(replyChannel(id));
  }

  private async listen(name: string): Promise<void> {
    this.subscriber ??= this.redis.duplicate();
    await this.subscriber.connect().catch(() => undefined);
    await this.subscriber.subscribe(name, (raw) => {
      void this.onMessage(raw);
    });
  }

  private async onMessage(raw: string): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.reply !== undefined) {
      this.pending.get(envelope.id)?.(envelope.reply);
      this.pending.delete(envelope.id);
      return;
    }
    if (envelope.message === undefined || this.handler === null) return;
    const reply = await this.handler(envelope.message).catch((): BusReply => ({
      ok: false,
      code: "bad-request",
      message: "handler failed",
    }));
    if (envelope.replyTo !== undefined) {
      await this.redis.publish(envelope.replyTo, JSON.stringify({ id: envelope.id, reply }));
    }
  }

  async request(instanceId: string, message: BusMessage): Promise<BusReply> {
    const id = randomUUID();
    const answer = new Promise<BusReply>((resolve) => {
      this.pending.set(id, resolve);
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        resolve({
          ok: false,
          code: "room-not-found",
          message: "the other instance did not answer",
        });
      }, this.timeoutMs);
      timer.unref();
    });
    await this.redis.publish(
      channel(instanceId),
      JSON.stringify({ id, replyTo: replyChannel(this.selfId), message } satisfies Envelope),
    );
    return await answer;
  }

  async close(): Promise<void> {
    this.pending.clear();
    if (this.subscriber !== null) await this.subscriber.quit().catch(() => undefined);
  }
}

const channel = (id: string): string => `deckxi:bus:${id}`;
const replyChannel = (id: string): string => `deckxi:bus:${id}:reply`;

/** A cluster backed by one Redis connection. */
export function redisCluster(redis: RedisLike, id = instanceId()): Cluster {
  return { id, directory: new RedisRoomDirectory(redis), bus: new RedisMessageBus(redis) };
}
