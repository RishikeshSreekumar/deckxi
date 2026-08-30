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
 * Admin routes are read-only here; moderation actions arrive in #70.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { userFromHeaders, type Auth } from "./auth.js";
import type { RoomManager, Room } from "./rooms.js";
import type { Logger } from "./logging.js";

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
    round: room.game?.state.round ?? null,
    idleSeconds: Math.round((now - room.lastActivityAt) / 1000),
  };
}

export interface AdminRoutesOptions {
  auth: Auth;
  rooms: RoomManager;
  config: AdminConfig;
  log: Logger;
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
}
