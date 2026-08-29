/**
 * Server assembly: Fastify (HTTP: health, future REST) + Socket.IO (realtime)
 * sharing one listener. The socket handshake enforces protocol version and
 * assigns a guest identity (session tokens arrive in Phase 6).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@deckxi/shared";
import { registerSockets, type SocketOptions } from "./sockets.js";
import type { RoomManager, RoomManagerOptions } from "./rooms.js";

/** Inbound payloads are tiny (commands, chat); anything bigger is abuse. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

export interface SocketData {
  /** Anonymous guest identity for this connection (Phase 6 swaps in users). */
  guestId: string;
  /** Room-scoped session this socket is attached to, once joined. */
  sessionId: string | null;
  roomId: string | null;
}

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

export interface AppOptions {
  corsOrigins?: string[];
  logger?: boolean;
  rooms?: RoomManagerOptions;
  limits?: SocketOptions["limits"];
}

export interface App {
  fastify: FastifyInstance;
  io: GameServer;
  rooms: RoomManager;
  /** Bind and return the actual port (pass 0 for an ephemeral test port). */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function buildApp(options: AppOptions = {}): App {
  const fastify = Fastify({ logger: options.logger ?? false });

  fastify.get("/healthz", async () => ({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  const io: GameServer = new Server(fastify.server, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: {
      origin: options.corsOrigins ?? ["http://localhost:5173"],
      methods: ["GET", "POST"],
    },
  });

  // Handshake: reject clients speaking a different protocol version so a
  // stale tab fails loudly instead of desyncing mid-game.
  io.use((socket, next) => {
    const version: unknown = socket.handshake.auth["protocolVersion"];
    if (version !== PROTOCOL_VERSION) {
      next(new Error(`protocol version mismatch: server speaks v${PROTOCOL_VERSION}`));
      return;
    }
    socket.data.guestId = randomUUID();
    socket.data.sessionId = null;
    socket.data.roomId = null;
    next();
  });

  const rooms = registerSockets(io, { rooms: options.rooms, limits: options.limits });
  const reaper = setInterval(() => rooms.reapIdle(), 60_000);
  reaper.unref();

  return {
    fastify,
    io,
    rooms,
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
    },
  };
}
