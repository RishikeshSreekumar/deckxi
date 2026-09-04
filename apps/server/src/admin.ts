/**
 * Admin API (#67) — the operator's view of a running server.
 *
 * **Authorisation.** Two ways in, no roles table:
 *
 *  - a **session** whose account email is in `ADMIN_EMAILS`. Deliberately not
 *    a `role` column: a column needs a migration, an editor, and a way to
 *    grant — three moving parts to express "these two people". An env var is
 *    revoked by redeploying, which is the same latency as a column and has no
 *    write path an attacker can reach.
 *  - a **bearer token** (`ADMIN_TOKEN`), for curl and scripts.
 *
 * **Everything unauthorised is a 404**, never 401 or 403. An operator endpoint
 * that answers "unauthorised" has confirmed it exists; one that answers "not
 * found" has said nothing. The cost is that the dashboard cannot tell "not an
 * admin" from "route missing" — which is fine, because for a non-admin those
 * are the same fact.
 *
 * Most routes here only read. The four that write — the ops flags, closing a
 * room, kicking a player — are logged with the operator behind them (#70):
 * an action that ends someone's game should never be anonymous.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { userFromHeaders, type Auth } from "./auth.js";
import type { GameInstance, Room, RoomManager } from "./rooms.js";
import type { Logger } from "./logging.js";
import type { EventFeed } from "./feed.js";
import type { MatchStore } from "./store.js";
import { opsFlagsSchema, type OpsConfig } from "./ops.js";

export interface AdminAccess {
  /** How this caller proved it: a signed-in admin, or the shared token. */
  via: "session" | "token";
  /** The admin's account email, when they came in with a session. */
  email: string | null;
}

export interface AdminConfig {
  token?: string | undefined;
  /** Account emails allowed in, compared case-insensitively. */
  emails?: string[] | undefined;
}

/** Constant-time-ish compare: same length or bust, then char by char. */
function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const offered = presented.startsWith("Bearer ") ? presented.slice(7) : presented;
  if (offered.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ offered.charCodeAt(i);
  }
  return diff === 0;
}

export function createAdminGuard(
  auth: Auth,
  config: AdminConfig,
): (request: FastifyRequest) => Promise<AdminAccess | null> {
  const emails = new Set((config.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const token = config.token;

  return async (request) => {
    if (
      token !== undefined &&
      token.length > 0 &&
      tokenMatches(token, request.headers.authorization)
    ) {
      return { via: "token", email: null };
    }
    if (emails.size === 0) return null;
    const user = await userFromHeaders(auth, request.headers);
    // Guests carry a placeholder email; an allowlist must never match one.
    if (user === null || user.isAnonymous) return null;
    const email = user.email.toLowerCase();
    return emails.has(email) ? { via: "session", email } : null;
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** One row of the live rooms table. */
export interface AdminRoomSummary {
  roomId: string;
  code: string;
  phase: string;
  gameMode: string;
  editionId: string;
  hostName: string | null;
  players: number;
  /** Players whose socket is currently gone (in their reconnect grace). */
  disconnected: number;
  spectators: number;
  matchId: string | null;
  /** Round in progress, 1-based; null outside a game. */
  round: number | null;
  idleSeconds: number;
}

export function toAdminRoomSummary(room: Room, now: number = Date.now()): AdminRoomSummary {
  return {
    roomId: room.id,
    code: room.code,
    phase: room.phase,
    gameMode: room.settings.gameMode,
    editionId: room.settings.editionId,
    hostName: room.players.find((p) => p.id === room.hostId)?.name ?? null,
    players: room.players.length,
    disconnected: room.players.filter((p) => !p.connected).length,
    spectators: room.spectators.length,
    matchId: room.game?.matchId ?? null,
    round: room.game === null ? null : room.game.mode.status(room.game.state).round,
    idleSeconds: Math.round((now - room.lastActivityAt) / 1000),
  };
}

/**
 * The room as the server actually holds it (#68) — including every hand.
 * This is the one view in the system that is deliberately unredacted: the
 * point of an inspector is to answer "what does the server think", and a
 * redacted inspector answers "what does one player think", which is the
 * question you already had a client for.
 */
export interface AdminRoomDetail extends AdminRoomSummary {
  settings: Record<string, unknown>;
  hostId: string;
  sessions: {
    id: string;
    name: string;
    userId: string | null;
    seat: number;
    spectator: boolean;
    ready: boolean;
    connected: boolean;
  }[];
  game: {
    matchId: string;
    editionId: string;
    mode: string;
    phase: string;
    round: number;
    /** Whose move it is: the trumps leader, the drafter on the clock. */
    leader: string | null;
    /** Cards nobody holds: the trumps pot, a draft's pool. */
    pot: string[];
    winner: string | null;
    startedAt: number;
    turnDeadline: number | null;
    events: number;
    players: { id: string; active: boolean; hand: string[] }[];
    /** Whatever else the mode wants an operator to see. */
    detail: Record<string, unknown>;
  } | null;
  /** Tail of this match's event log, unredacted, oldest first. */
  recentEvents: { seq: number; type: string; event: unknown }[];
}

const RECENT_EVENTS = 30;

function inspectGame(game: GameInstance): NonNullable<AdminRoomDetail["game"]> {
  const view = game.mode.inspect(game.state);
  return {
    matchId: game.matchId,
    editionId: game.editionId,
    mode: game.mode.id,
    phase: view.phase,
    round: view.round,
    leader: view.leader,
    pot: [...view.loose],
    winner: view.winner,
    startedAt: game.startedAt,
    turnDeadline: game.turnDeadline,
    events: game.log.length,
    players: view.players.map((p) => ({ id: p.id, active: p.active, hand: [...p.cards] })),
    detail: view.detail,
  };
}

export function toAdminRoomDetail(room: Room, now: number = Date.now()): AdminRoomDetail {
  const game = room.game;
  return {
    ...toAdminRoomSummary(room, now),
    settings: { ...room.settings },
    hostId: room.hostId,
    sessions: [...room.players, ...room.spectators].map((s) => ({
      id: s.id,
      name: s.name,
      userId: s.userId,
      seat: s.seat,
      spectator: s.spectator,
      ready: s.ready,
      connected: s.connected,
    })),
    game: game === null ? null : inspectGame(game),
    recentEvents:
      game === null
        ? []
        : game.log
            .slice(-RECENT_EVENTS)
            .map((e) => ({ seq: e.seq, type: e.event.type, event: e.event })),
  };
}

export interface AdminRoutesOptions {
  auth: Auth;
  rooms: RoomManager;
  config: AdminConfig;
  log: Logger;
  /** Recent server events, tee'd off the logger (#68). */
  feed: EventFeed;
  /** Persisted matches, for the replay debugger (#69). */
  store: MatchStore;
  /** Maintenance notice and mode kill switches (#70). */
  ops: OpsConfig;
}

export function registerAdminRoutes(fastify: FastifyInstance, options: AdminRoutesOptions): void {
  const { rooms, log } = options;
  const guard = createAdminGuard(options.auth, options.config);

  /** Wrap a handler so unauthorised callers get an indistinguishable 404. */
  const admin =
    <T>(handler: (request: FastifyRequest, access: AdminAccess) => T) =>
    async (
      request: FastifyRequest,
      reply: { status(code: number): { send(body: unknown): unknown } },
    ) => {
      const access = await guard(request);
      if (access === null) {
        log.warn(
          { event: "admin.denied", reqId: request.id, url: request.url },
          "admin route refused",
        );
        return reply.status(404).send({ error: "not found" });
      }
      return handler(request, access);
    };

  /** Identity probe — the dashboard's "am I allowed in" call. */
  fastify.get(
    "/api/admin/session",
    admin((_request, access) => ({ admin: true, via: access.via, email: access.email })),
  );

  fastify.get(
    "/api/admin/rooms",
    admin(() => {
      const now = Date.now();
      const list = rooms
        .listRooms()
        .map((room) => toAdminRoomSummary(room, now))
        // Busiest first: what an operator wants is the room in trouble, and
        // a full table in round 12 is more interesting than an empty lobby.
        .sort((a, b) => b.players + b.spectators - (a.players + a.spectators));
      return { rooms: list, counts: { rooms: list.length, games: rooms.activeGames } };
    }),
  );

  /** Server truth for one room, hands included (#68). */
  fastify.get(
    "/api/admin/rooms/:roomId",
    admin((request, _access) => {
      const { roomId } = request.params as { roomId: string };
      const room = rooms.getRoom(roomId);
      // A closed room is genuinely gone from memory; its match log lives on in
      // the replay debugger (#69), which is where that question belongs.
      if (room === undefined) return { room: null };
      return { room: toAdminRoomDetail(room) };
    }),
  );

  /**
   * Replay debugger (#69). The engine is deterministic and event-sourced, so
   * "debug a game" is "replay its log" — no special recording, no snapshots,
   * and the same bytes the server actually acted on. The client folds the log
   * with the same reducer the server used, which is why this endpoint ships
   * the raw events rather than a rendered sequence of states.
   */
  fastify.get(
    "/api/admin/matches",
    admin(async (request) => {
      const { limit } = request.query as { limit?: string };
      const size = Number(limit ?? 50);
      return { matches: await options.store.listMatches(Number.isFinite(size) ? size : 50) };
    }),
  );

  fastify.get(
    "/api/admin/matches/:matchId",
    admin(async (request) => {
      const { matchId } = request.params as { matchId: string };
      const match = await options.store.getMatch(matchId);
      return { match };
    }),
  );

  /**
   * Live event feed. Cursor-based rather than time-based: the dashboard asks
   * for everything after the last seq it saw, so a slow poll skips nothing it
   * could still have had.
   */
  fastify.get(
    "/api/admin/events",
    admin((request) => {
      const query = request.query as { since?: string; roomId?: string };
      const since = Number(query.since ?? 0);
      return options.feed.since(Number.isFinite(since) && since > 0 ? since : 0, 200, query.roomId);
    }),
  );

  // -------------------------------------------------------------------------
  // Moderation and live ops (#70). These are the only admin routes that write,
  // and each one is logged with the operator behind it — an action that ends
  // someone's game should never be anonymous.
  // -------------------------------------------------------------------------

  fastify.get(
    "/api/admin/flags",
    admin(() => ({ flags: options.ops.current })),
  );

  fastify.put(
    "/api/admin/flags",
    admin(async (request, access) => {
      const parsed = opsFlagsSchema.partial().safeParse(request.body);
      if (!parsed.success)
        return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
      log.warn(
        { event: "admin.flags_set", by: access.email ?? access.via, reqId: request.id },
        "ops flags changed by an operator",
      );
      return { ok: true, flags: await options.ops.update(parsed.data) };
    }),
  );

  fastify.post(
    "/api/admin/rooms/:roomId/close",
    admin((request, access) => {
      const { roomId } = request.params as { roomId: string };
      const closed = rooms.closeRoomById(roomId);
      log.warn(
        { event: "admin.room_closed", roomId, by: access.email ?? access.via, closed },
        "room closed by an operator",
      );
      return { ok: closed };
    }),
  );

  fastify.post(
    "/api/admin/rooms/:roomId/kick",
    admin((request, access) => {
      const { sessionId } = (request.body ?? {}) as { sessionId?: unknown };
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        return { ok: false, error: "sessionId required" };
      }
      const kicked = rooms.kick(sessionId);
      log.warn(
        { event: "admin.kicked", sessionId, by: access.email ?? access.via, kicked },
        "player kicked by an operator",
      );
      return { ok: kicked };
    }),
  );
}
