/**
 * Typed Socket.IO client singleton. All commands go through `call`, which
 * unwraps the server's `Ack<T>` envelope into a resolved value or `AckError`.
 */
import { io, type Socket } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  type Ack,
  type ClientToServerEvents,
  type ErrorCode,
  type ServerToClientEvents,
} from "@deckxi/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export class AckError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AckError";
  }
}

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  socket ??= io(API_URL, {
    auth: { protocolVersion: PROTOCOL_VERSION },
    // Reconnection is on by default; the store resumes the room on 'connect'.
    transports: ["websocket", "polling"],
    // Send the better-auth session cookie so the server knows who we are.
    withCredentials: true,
  });
  return socket;
}

const CALL_TIMEOUT_MS = 8000;

/** Emit a command and unwrap its ack; throws `AckError` on a server rejection. */
export async function call<E extends keyof ClientToServerEvents, T>(
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<T> {
  // Socket.IO's emitWithAck typing fights the mapped event union; the
  // payload/event pair above is already statically checked by our signature.
  const s = getSocket() as unknown as {
    timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<unknown> };
  };
  const reply = (await s.timeout(CALL_TIMEOUT_MS).emitWithAck(event, payload)) as Ack<T>;
  if (!reply.ok) throw new AckError(reply.code, reply.message);
  return reply.data;
}

/** Human copy for server error codes surfaced in toasts. */
export function errorMessage(error: unknown): string {
  if (error instanceof AckError) {
    const copy: Partial<Record<ErrorCode, string>> = {
      "room-not-found": "That room doesn't exist (or has closed).",
      "room-full": "That room is full — you can join as a spectator.",
      "not-host": "Only the host can do that.",
      "not-enough-players": "You need at least 2 players to start.",
      "players-not-ready": "Everyone needs to be ready first.",
      "rate-limited": "Whoa — slow down a little.",
      "resume-failed": "Couldn't rejoin your game.",
      "server-full": "The server is at capacity right now. Try again shortly.",
      "protocol-mismatch": "Your game is out of date — refresh the page.",
    };
    return copy[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message.includes("operation has timed out")) {
    return "The server didn't respond — check your connection.";
  }
  return "Something went wrong.";
}
