/**
 * Server assembly: Fastify (HTTP: health, auth, profile REST) + Socket.IO
 * (realtime) sharing one listener. The socket handshake enforces protocol
 * version and resolves the better-auth session cookie into a user identity;
 * connections without a session still work as anonymous one-offs.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Server, type Socket } from "socket.io";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@deckxi/shared";
import { originMatcher } from "./origins.js";
import { registerSockets, type SocketOptions } from "./sockets.js";
import type { RoomManager, RoomManagerOptions } from "./rooms.js";
import { InMemoryMatchStore, type MatchStore } from "./store.js";
import {
  createAuth,
  toWebHeaders,
  userFromHeaders,
  type Auth,
  type MagicLinkMail,
} from "./auth.js";

/** Inbound payloads are tiny (commands, chat); anything bigger is abuse. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

export interface SocketData {
  /** Signed-in user behind this connection; null for cookie-less clients. */
  userId: string | null;
  userName: string | null;
  /** Room-scoped session this socket is attached to, once joined. */
  sessionId: string | null;
  roomId: string | null;
}

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

export interface AuthOptions {
  /** Postgres for real deployments; omitted → in-memory (dev/tests). */
  databaseUrl?: string | undefined;
  secret?: string;
  /** The server's public URL (OAuth/magic-link callbacks build on it). */
  baseURL?: string;
  google?: { clientId: string; clientSecret: string } | undefined;
  /** Magic-link delivery; dev default logs the URL. */
  sendMagicLink?: (mail: MagicLinkMail) => void | Promise<void>;
}

export interface AppOptions {
  corsOrigins?: string[];
  logger?: boolean;
  rooms?: RoomManagerOptions;
  limits?: SocketOptions["limits"];
  /** Match persistence; defaults to in-memory (no DATABASE_URL needed). */
  store?: MatchStore;
  auth?: AuthOptions;
}

export interface App {
  fastify: FastifyInstance;
  io: GameServer;
  rooms: RoomManager;
  auth: Auth;
  /** Bind and return the actual port (pass 0 for an ephemeral test port). */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** Dev-only fallback; real deployments must set BETTER_AUTH_SECRET. */
const DEV_SECRET = "deckxi-dev-secret-not-for-production";

export function buildApp(options: AppOptions = {}): App {
  const fastify = Fastify({ logger: options.logger ?? false });
  const store = options.store ?? new InMemoryMatchStore();
  const corsOrigins = options.corsOrigins ?? ["http://localhost:5173"];
  const allowOrigin = originMatcher(corsOrigins);

  const authBundle = createAuth({
    databaseUrl: options.auth?.databaseUrl,
    secret: options.auth?.secret ?? DEV_SECRET,
    baseURL: options.auth?.baseURL ?? "http://localhost:3001",
    trustedOrigins: corsOrigins,
    google: options.auth?.google,
    ...(options.auth?.sendMagicLink !== undefined
      ? { sendMagicLink: options.auth.sendMagicLink }
      : {}),
    store,
  });
  const auth = authBundle.auth;

  void fastify.register(cors, {
    // A disallowed origin simply gets no CORS header — the browser blocks the
    // response. Erroring here would turn probes into noisy 500s.
    origin: (origin, cb) => {
      cb(null, allowOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });

  fastify.get("/healthz", async (_request, reply) => {
    try {
      await store.ping();
    } catch {
      return reply.status(503).send({ ok: false, db: "unreachable" });
    }
    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // ---------------------------------------------------------------------
  // better-auth: every /api/auth/* route is handled by its fetch handler.
  // ---------------------------------------------------------------------
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: toWebHeaders(request.headers),
          ...(request.body != null ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        // Set-Cookie must not be comma-joined; handled separately below.
        if (key.toLowerCase() !== "set-cookie") void reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header("set-cookie", cookies);
      return reply.send(response.body !== null ? await response.text() : "");
    },
  });

  // ---------------------------------------------------------------------
  // Profile REST — session-cookie authenticated.
  // ---------------------------------------------------------------------
  const requireUser = async (request: FastifyRequest) =>
    await userFromHeaders(auth, request.headers);

  fastify.get("/api/me", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) return reply.status(401).send({ error: "not signed in" });
    const stats = await store.userStats(user.id);
    return {
      user: {
        id: user.id,
        name: user.name,
        image: user.image,
        isAnonymous: user.isAnonymous,
        // Guests carry a placeholder email — never surface it.
        email: user.isAnonymous ? null : user.email,
      },
      stats,
    };
  });

  fastify.get("/api/me/matches", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) return reply.status(401).send({ error: "not signed in" });
    return { matches: await store.listUserMatches(user.id) };
  });

  const io: GameServer = new Server(fastify.server, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: {
      origin: (origin, cb) => {
        cb(null, allowOrigin(origin ?? undefined) ? (origin ?? true) : false);
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Handshake: reject clients speaking a different protocol version so a
  // stale tab fails loudly instead of desyncing mid-game; then resolve the
  // session cookie (if any) into the user identity behind this socket.
  io.use((socket, next) => {
    // Websocket upgrades aren't subject to the browser's CORS preflight, so
    // the allowlist is enforced here too rather than only in the cors option.
    if (!allowOrigin(socket.handshake.headers.origin)) {
      next(new Error("origin not allowed"));
      return;
    }
    const version: unknown = socket.handshake.auth["protocolVersion"];
    if (version !== PROTOCOL_VERSION) {
      next(new Error(`protocol version mismatch: server speaks v${PROTOCOL_VERSION}`));
      return;
    }
    socket.data.userId = null;
    socket.data.userName = null;
    socket.data.sessionId = null;
    socket.data.roomId = null;
    userFromHeaders(auth, socket.handshake.headers)
      .then((user) => {
        if (user !== null) {
          socket.data.userId = user.id;
          socket.data.userName = user.name;
        }
        next();
      })
      .catch(() => {
        // Auth store hiccup — let them play as a one-off anonymous client.
        next();
      });
  });

  const rooms = registerSockets(io, {
    rooms: { store, ...options.rooms },
    limits: options.limits,
  });
  const reaper = setInterval(() => rooms.reapIdle(), 60_000);
  reaper.unref();

  return {
    fastify,
    io,
    rooms,
    auth,
    async listen(port, host = "127.0.0.1") {
      await fastify.listen({ port, host });
      const address = fastify.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("server has no TCP address");
      }
      return address.port;
    },
    async close() {
      clearInterval(reaper);
      rooms.closeAll();
      io.disconnectSockets(true);
      await io.close();
      await fastify.close();
      await authBundle.close();
      await store.close();
    },
  };
}
